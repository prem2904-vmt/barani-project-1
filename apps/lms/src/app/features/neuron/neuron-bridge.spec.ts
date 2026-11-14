import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import {
  NEURON_FAILED_MESSAGE, NEURON_MSG_PREFIX, NOT_A_SPREADSHEET_MESSAGE, NeuronBridge, msg, acceptedMessage, downloadBytes, isXlsxBytes, neuronFrameUrl,
  routeSaved, sniffBytes, withExtension,
} from './neuron-bridge';

const PK = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
// built from plain arrays so they belong to THIS realm (jsdom): the bridge must not rely on instanceof
const PDF = new Uint8Array(Array.from(new TextEncoder().encode('%PDF-1.7 hello')));
const CSV = new Uint8Array(Array.from(new TextEncoder().encode('a,b,c\n1,2,3\n')));
const buf = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

const ORIGIN = 'http://localhost:4200';
function fakeFrame() {
  const postMessage = vi.fn();
  const win = { postMessage };
  const frame = { contentWindow: win, neuron: undefined } as unknown as HTMLIFrameElement;
  return { frame, win, postMessage };
}
function fakeHost() {
  const listeners = new Set<(e: MessageEvent) => void>();
  return {
    location: { origin: ORIGIN },
    addEventListener: (_t: string, fn: (e: MessageEvent) => void) => listeners.add(fn),
    removeEventListener: (_t: string, fn: (e: MessageEvent) => void) => listeners.delete(fn),
    listeners,
  } as unknown as Window & { listeners: Set<unknown> };
}
function make() {
  TestBed.configureTestingModule({ providers: [NeuronBridge] });
  const bridge = TestBed.inject(NeuronBridge);
  const host = fakeHost();
  const f = fakeFrame();
  bridge.attach(f.frame, host);
  return { bridge, host, ...f };
}
const from = (win: unknown, data: Record<string, unknown>, origin = ORIGIN) => ({ origin, source: win as MessageEventSource, data });

describe('Neuron bridge: byte sniffing', () => {
  it('PK header = xlsx, %PDF = pdf, anything else (CSV text) = other', () => {
    expect(sniffBytes(PK)).toBe('xlsx');
    expect(sniffBytes(buf(PK))).toBe('xlsx');
    expect(sniffBytes(PDF)).toBe('pdf');
    expect(sniffBytes(CSV)).toBe('other');
    expect(sniffBytes(new Uint8Array([0x50, 0x4b]))).toBe('other');
    expect(sniffBytes(null)).toBe('other');
    expect(isXlsxBytes(CSV)).toBe(false);
  });
  it('a saved file is routed by its header, not its name', () => {
    expect(routeSaved(PDF)).toBe('pdf');
    expect(routeSaved(PK)).toBe('xlsx');
    expect(routeSaved(CSV)).toBe('unknown');
  });
  it('the frame URL is same-origin relative with host=parent, chrome=notitlebar and the encoded author', () => {
    const u = new URL(neuronFrameUrl('http://localhost:4200/', 'Kavya D & Co'));
    expect(u.pathname).toBe('/neuron-engine/index.html');
    expect(u.searchParams.get('host')).toBe('parent');
    expect(u.searchParams.get('chrome')).toBe('notitlebar');
    expect(u.searchParams.get('theme')).toBe('system');
    expect(new URL(neuronFrameUrl('http://localhost:4200/', 'A', 'dark')).searchParams.get('theme')).toBe('dark');
    expect(u.searchParams.get('author')).toBe('Kavya D & Co');
    expect(u.search).toContain('author=Kavya+D+%26+Co');
    expect(u.origin).toBe('http://localhost:4200');
  });
  it('extensions: Glucose → Glucose.pdf, Glucose.xlsx → Glucose.pdf, blank → Sheet.pdf', () => {
    expect(withExtension('Glucose', 'pdf')).toBe('Glucose.pdf');
    expect(withExtension('Glucose.xlsx', 'pdf')).toBe('Glucose.pdf');
    expect(withExtension('', 'xlsx')).toBe('Sheet.xlsx');
  });
});

describe('Neuron bridge: who we listen to', () => {
  it('accepts only the frame window AND our own origin', () => {
    const w = {};
    expect(acceptedMessage({ origin: ORIGIN, source: w, data: { type: 'neuron:ready' } }, w, ORIGIN)).toEqual({ type: 'neuron:ready' });
    expect(acceptedMessage({ origin: ORIGIN, source: {}, data: { type: 'neuron:ready' } }, w, ORIGIN)).toBeNull();
    expect(acceptedMessage({ origin: 'https://evil.test', source: w, data: { type: 'neuron:ready' } }, w, ORIGIN)).toBeNull();
    expect(acceptedMessage({ origin: ORIGIN, source: w, data: { type: 'something-else' } }, w, ORIGIN)).toBeNull();
    expect(acceptedMessage({ origin: ORIGIN, source: w, data: 'neuron:ready' }, w, ORIGIN)).toBeNull();
    expect(acceptedMessage({ origin: ORIGIN, source: w, data: { type: 'neuron:ready' } }, null, ORIGIN)).toBeNull();
  });

  it('ignores a message from another window or origin: no state change, no save', () => {
    const { bridge, win } = make();
    const saved = vi.fn();
    bridge.onSave = saved;
    bridge.handle(from({}, { type: 'neuron:ready' }));
    bridge.handle(from(win, { type: 'neuron:ready' }, 'https://evil.test'));
    bridge.handle(from({}, { type: 'neuron:save', name: 'x.xlsx', bytes: buf(PK) }));
    bridge.handle(from(win, { type: 'neuron:dirty', dirty: true }, 'https://evil.test'));
    expect(bridge.state()).toBe('loading');
    expect(bridge.dirty()).toBe(false);
    expect(saved).not.toHaveBeenCalled();
  });

  it('listens on the page window while a frame is attached and stops on detach', () => {
    const { bridge, host, frame } = make();
    expect((host as unknown as { listeners: Set<unknown> }).listeners.size).toBe(1);
    bridge.attach(null, host);
    expect((host as unknown as { listeners: Set<unknown> }).listeners.size).toBe(0);
    expect(bridge.state()).toBe('idle');
    expect(frame).toBeTruthy();
  });
});

describe('Neuron bridge: protocol constants and theme', () => {
  it('every message type comes from the ONE prefix constant', () => {
    expect(NEURON_MSG_PREFIX).toBe('neuron:');
    expect(Object.values(msg).every(t => t.startsWith(NEURON_MSG_PREFIX))).toBe(true);
    expect(msg.theme).toBe('neuron:theme');
  });
  it('setTheme posts {theme} to the frame once ready, pinned to our origin', () => {
    const { bridge, win, postMessage } = make();
    bridge.setTheme('dark');
    expect(postMessage).not.toHaveBeenCalled();
    bridge.handle(from(win, { type: msg.ready }));
    bridge.setTheme('dark');
    expect(postMessage).toHaveBeenCalledWith({ type: 'neuron:theme', theme: 'dark' }, ORIGIN);
  });
  it('readonly goes to the frame when ready; the URL carries readonly=1', () => {
    const { bridge, win, postMessage } = make();
    bridge.setReadonly(true);
    expect(postMessage).not.toHaveBeenCalled();
    bridge.handle(from(win, { type: msg.ready }));
    bridge.setReadonly(true);
    expect(postMessage).toHaveBeenCalledWith({ type: 'neuron:readonly', readonly: true }, ORIGIN);
    expect(new URL(neuronFrameUrl('http://localhost:4200/', 'A', 'light', true)).searchParams.get('readonly')).toBe('1');
    expect(new URL(neuronFrameUrl('http://localhost:4200/', 'A')).searchParams.has('readonly')).toBe(false);
  });
  it('a ready app is told readonly right away when the page asked for it', () => {
    const { bridge, win, postMessage } = make();
    bridge.readonly = true;
    bridge.handle(from(win, { type: msg.ready }));
    expect(postMessage).toHaveBeenCalledWith({ type: 'neuron:readonly', readonly: true }, ORIGIN);
  });
  it('the old prefix is not a neuron message', () => {
    const w = {};
    expect(acceptedMessage({ origin: ORIGIN, source: w, data: { type: 'grid' + 'craft:ready' } }, w, ORIGIN)).toBeNull();
  });
});

describe('Neuron bridge: opening a file', () => {
  it('holds the file until ready, then transfers the bytes to the frame (origin pinned)', () => {
    const { bridge, win, postMessage } = make();
    const bytes = buf(PK);
    expect(bridge.open('Results.xlsx', bytes)).toBe(true);
    expect(postMessage).not.toHaveBeenCalled();
    bridge.handle(from(win, { type: 'neuron:ready' }));
    expect(bridge.state()).toBe('ready');
    expect(postMessage).toHaveBeenCalledTimes(1);
    const [msg, origin, transfer] = postMessage.mock.calls[0];
    expect(msg).toMatchObject({ type: 'neuron:open', name: 'Results.xlsx' });
    expect(origin).toBe(ORIGIN);
    expect(transfer).toEqual([msg.bytes]);
  });

  it('opens at once when already ready', () => {
    const { bridge, win, postMessage } = make();
    bridge.handle(from(win, { type: 'neuron:ready' }));
    bridge.open('A.xlsx', buf(PK));
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it('NEVER sends non-xlsx bytes (the app would open them as CSV text): refused with a plain message', () => {
    const { bridge, win, postMessage } = make();
    bridge.handle(from(win, { type: 'neuron:ready' }));
    expect(bridge.open('data.csv', buf(CSV))).toBe(false);
    expect(bridge.open('report.pdf', buf(PDF))).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
    expect(bridge.openProblem()).toBe(NOT_A_SPREADSHEET_MESSAGE);
  });

  it('a new frame replacing an old one never receives the file through the OLD frame\'s ready', () => {
    const { bridge, win, postMessage, host } = make();
    bridge.handle(from(win, { type: msg.ready }));            // old frame ready
    bridge.prepareNewFrame();                                // the next sheet replaces it
    expect(bridge.state()).toBe('loading');
    bridge.open('Next.xlsx', buf(PK));
    expect(postMessage).not.toHaveBeenCalled();              // NOT posted to the old window
    const next = fakeFrame();
    bridge.attach(next.frame, host);
    bridge.handle(from(next.win, { type: msg.ready }));
    expect(next.postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('discardPending forgets a queued file (a blank new sheet starts clean)', () => {
    const { bridge, win, postMessage } = make();
    bridge.open('Old.xlsx', buf(PK));
    bridge.discardPending();
    bridge.handle(from(win, { type: 'neuron:ready' }));
    expect(postMessage).not.toHaveBeenCalled();
  });
});

describe('Neuron bridge: saves, dirty and failure', () => {
  it('an xlsx save and a PDF save are told apart by their header', () => {
    const { bridge, win } = make();
    const saved = vi.fn();
    bridge.onSave = saved;
    bridge.handle(from(win, { type: 'neuron:save', name: 'Budget.xlsx', bytes: buf(PK) }));
    bridge.handle(from(win, { type: 'neuron:save', name: 'Budget.pdf', bytes: buf(PDF) }));
    // a name that says .xlsx but carries PDF bytes is a PDF; CSV bytes are dropped
    bridge.handle(from(win, { type: 'neuron:save', name: 'Liar.xlsx', bytes: buf(PDF) }));
    bridge.handle(from(win, { type: 'neuron:save', name: 'x.csv', bytes: buf(CSV) }));
    expect(saved.mock.calls.map(c => [c[0].name, c[0].kind])).toEqual([['Budget.xlsx', 'xlsx'], ['Budget.pdf', 'pdf'], ['Liar.xlsx', 'pdf']]);
  });

  it('accepts a typed-array view as the bytes', () => {
    const { bridge, win } = make();
    const saved = vi.fn();
    bridge.onSave = saved;
    bridge.handle(from(win, { type: 'neuron:save', name: 'V.xlsx', bytes: PK }));
    expect(saved).toHaveBeenCalledTimes(1);
    expect(saved.mock.calls[0][0].bytes.byteLength).toBe(PK.byteLength);
  });

  it('dirty follows the app and resets when a new frame is attached', () => {
    const { bridge, win, host } = make();
    bridge.handle(from(win, { type: 'neuron:dirty', dirty: true }));
    expect(bridge.dirty()).toBe(true);
    bridge.handle(from(win, { type: 'neuron:dirty', dirty: false }));
    expect(bridge.dirty()).toBe(false);
    bridge.handle(from(win, { type: 'neuron:dirty', dirty: true }));
    bridge.attach(fakeFrame().frame, host);
    expect(bridge.dirty()).toBe(false);
    expect(bridge.state()).toBe('loading');
  });

  it('neuron:failed gives the plain graphics-acceleration message', () => {
    const { bridge, win } = make();
    bridge.handle(from(win, { type: 'neuron:failed', error: 'no webgl2' }));
    expect(bridge.state()).toBe('failed');
    expect(bridge.failure()).toBe(NEURON_FAILED_MESSAGE);
    expect(NEURON_FAILED_MESSAGE).toBe("This computer can't show the spreadsheet because graphics acceleration is turned off. Try Chrome or Edge, or ask your IT person to turn on hardware acceleration.");
    expect(NEURON_FAILED_MESSAGE).not.toMatch(/webgl|wasm|error/i);
  });

  it('save() / exportPdf() call the engine only when it is ready', () => {
    const { bridge, win, frame } = make();
    const execute = vi.fn();
    (win as unknown as { neuron: unknown }).neuron = { execute };
    expect(bridge.save()).toBe(false);
    bridge.handle(from(win, { type: 'neuron:ready' }));
    expect(bridge.save()).toBe(true);
    expect(bridge.exportPdf()).toBe(true);
    expect(execute.mock.calls).toEqual([['file.save', {}], ['file.exportPdf', {}]]);
    expect(frame).toBeTruthy();
  });

  it('a save right after ready retries while the workbook is still opening ("no workbook open")', async () => {
    vi.useFakeTimers();
    const { bridge, win } = make();
    const execute = vi.fn().mockRejectedValueOnce(new Error('no workbook open')).mockResolvedValue(undefined);
    (win as unknown as { neuron: unknown }).neuron = { execute };
    bridge.handle(from(win, { type: msg.ready }));
    expect(bridge.save()).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(execute).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('downloadBytes clicks a download link for the file name', () => {
    const click = vi.fn();
    const a: Record<string, unknown> = { click, remove: vi.fn(), style: {} };
    const doc = { createElement: () => a, body: { appendChild: vi.fn() } } as unknown as Document;
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    downloadBytes('Out.pdf', buf(PDF), 'application/pdf', doc);
    expect(a['download']).toBe('Out.pdf');
    expect(click).toHaveBeenCalledTimes(1);
    create.mockRestore();
  });
});
