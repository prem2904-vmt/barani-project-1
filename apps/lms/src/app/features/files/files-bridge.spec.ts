import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import {
  FIT_COLUMNS, ENGINE_FAILED_MESSAGE, NOT_A_SPREADSHEET_MESSAGE, FilesBridge, messagesFor, acceptedMessage, downloadBytes, isXlsxBytes, filesFrameUrl,
  routeSaved, withExtension, notThisKindMessage,
} from './files-bridge';
import { FILES_APPS, sniff as sniffBytes } from './files-registry';

const NEURON = FILES_APPS[0];
const NEURON_MSG_PREFIX = NEURON.prefix;
const msg = messagesFor(NEURON_MSG_PREFIX);
const neuronFrameUrl = (base: string, author: string, theme?: 'light' | 'dark' | 'system', ro?: boolean) => filesFrameUrl(NEURON, base, author, theme, ro);
const NeuronBridge = FilesBridge;
const NEURON_FAILED_MESSAGE = ENGINE_FAILED_MESSAGE;

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
    expect(sniffBytes(PK)).toBe('zip');
    expect(sniffBytes(buf(PK))).toBe('zip');
    expect(sniffBytes(PDF)).toBe('pdf');
    expect(sniffBytes(CSV)).toBe('other');
    expect(sniffBytes(new Uint8Array([0x50, 0x4b]))).toBe('other');
    expect(sniffBytes(null)).toBe('other');
    expect(isXlsxBytes(CSV)).toBe(false);
  });
  it('a saved file is routed by its header, not its name', () => {
    expect(routeSaved(PDF)).toBe('pdf');
    expect(routeSaved(PK)).toBe('file');
    expect(routeSaved(CSV)).toBe('copy');
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
    expect(withExtension('', 'xlsx')).toBe('File.xlsx');
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

  it('commands handed to open() wait for the OPENED workbook (not the app\'s empty starter one), then run once', async () => {
    vi.useFakeTimers();
    const { bridge, win, postMessage } = make();
    const execute = vi.fn();
    let title = 'Book1';
    const docInspect = vi.fn(async () => ({ title }));
    (win as unknown as { neuron: unknown }).neuron = { execute, docInspect };
    bridge.open('Results.xlsx', buf(PK), [FIT_COLUMNS]);
    expect(execute).not.toHaveBeenCalled();
    bridge.handle(from(win, { type: 'neuron:ready' }));
    expect(postMessage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(execute, 'the starter workbook must not be touched').not.toHaveBeenCalled();
    title = 'Results.xlsx';
    await vi.advanceTimersByTimeAsync(400);
    expect(execute.mock.calls).toEqual([['home.autofitColumnWidth', { cols: 'A:Z' }]]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(execute).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('without docInspect (an older engine) the commands run right after the file is sent', () => {
    const { bridge, win } = make();
    const execute = vi.fn();
    (win as unknown as { neuron: unknown }).neuron = { execute };
    bridge.open('Results.xlsx', buf(PK), [FIT_COLUMNS]);
    bridge.handle(from(win, { type: 'neuron:ready' }));
    expect(execute.mock.calls).toEqual([['home.autofitColumnWidth', { cols: 'A:Z' }]]);
  });

  it('a plain open() asks the engine for nothing else', async () => {
    vi.useFakeTimers();
    const { bridge, win } = make();
    const execute = vi.fn();
    const docInspect = vi.fn(async () => ({ title: 'A.xlsx' }));
    (win as unknown as { neuron: unknown }).neuron = { execute, docInspect };
    bridge.open('A.xlsx', buf(PK));
    bridge.handle(from(win, { type: 'neuron:ready' }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(execute).not.toHaveBeenCalled();
    expect(docInspect).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('gives up quietly when the opened workbook never shows up', async () => {
    vi.useFakeTimers();
    const { bridge, win } = make();
    const execute = vi.fn();
    (win as unknown as { neuron: unknown }).neuron = { execute, docInspect: vi.fn(async () => ({ title: 'Book1' })) };
    bridge.open('Results.xlsx', buf(PK), [FIT_COLUMNS]);
    bridge.handle(from(win, { type: 'neuron:ready' }));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(execute).not.toHaveBeenCalled();
    vi.useRealTimers();
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
  it('an xlsx save, a PDF and a copy (CSV) are told apart by their header', () => {
    const { bridge, win } = make();
    const saved = vi.fn();
    bridge.onSave = saved;
    bridge.handle(from(win, { type: 'neuron:save', name: 'Budget.xlsx', bytes: buf(PK) }));
    bridge.handle(from(win, { type: 'neuron:save', name: 'Budget.pdf', bytes: buf(PDF) }));
    // a name that says .xlsx but carries PDF bytes is a PDF; CSV / HTML exports are plain copies (downloaded, never stored)
    bridge.handle(from(win, { type: 'neuron:save', name: 'Liar.xlsx', bytes: buf(PDF) }));
    bridge.handle(from(win, { type: 'neuron:save', name: 'x.csv', bytes: buf(CSV) }));
    expect(saved.mock.calls.map(c => [c[0].name, c[0].kind])).toEqual([['Budget.xlsx', 'file'], ['Budget.pdf', 'pdf'], ['Liar.xlsx', 'pdf'], ['x.csv', 'copy']]);
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
    expect(NEURON_FAILED_MESSAGE).toBe("This computer can't show the editor because graphics acceleration is turned off. Try Chrome or Edge, or ask your IT person to turn on hardware acceleration.");
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

describe('Files bridge: any app, its own prefix, global and file type', () => {
  const [, SYNAPSE, , MYELIN, RETINA] = FILES_APPS;
  const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

  it('messages are built from the registry prefix, and an app ignores another app\'s prefix', () => {
    expect(messagesFor('synapse:').open).toBe('synapse:open');
    const w = {};
    const ok = (type: string, prefix: string) => acceptedMessage({ origin: ORIGIN, source: w, data: { type } }, w, ORIGIN, prefix);
    expect(ok('synapse:ready', 'synapse:')).not.toBeNull();
    expect(ok('neuron:ready', 'synapse:')).toBeNull();
    expect(ok('myelin:save', 'axon:')).toBeNull();
  });

  it('the frame URL points at the app\'s own engine folder', () => {
    for (const a of FILES_APPS) expect(filesFrameUrl(a, `${ORIGIN}/`, 'Asha', 'dark', true)).toMatch(new RegExp(`/${a.enginePath}index\\.html\\?host=parent&chrome=notitlebar&author=Asha&theme=dark&readonly=1(&control=1)?$`));
  });

  it('a bridge speaks only its own app: the page gets Synapse messages, Neuron ones are dropped, bytes of the wrong type are not sent', () => {
    TestBed.configureTestingModule({ providers: [FilesBridge] });
    const b = TestBed.inject(FilesBridge);
    b.configure(SYNAPSE);
    const host = fakeHost(); const f = fakeFrame();
    b.attach(f.frame, host);
    b.handle(from(f.win, { type: 'neuron:ready' }));
    expect(b.state()).toBe('loading');
    b.handle(from(f.win, { type: 'synapse:ready' }));
    expect(b.state()).toBe('ready');
    expect(b.open('Letter.docx', buf(png))).toBe(false);                                   // an image is not a document
    expect(b.openProblem()).toBe(notThisKindMessage(SYNAPSE));
    expect(b.open('Letter.docx', buf(docx))).toBe(true);
    expect(f.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'synapse:open', name: 'Letter.docx' }), ORIGIN, expect.anything());
  });

  it('Myelin accepts a PDF and routes it as its own file; Retina accepts pictures; an engine\'s PDF export from another app is a download', () => {
    expect(routeSaved(PDF, MYELIN)).toBe('file');
    expect(routeSaved(PDF, SYNAPSE)).toBe('pdf');
    expect(routeSaved(png, RETINA)).toBe('file');
    expect(routeSaved(CSV, RETINA)).toBe('copy');
  });

  it('the engine\'s File → Open / Save As asks reach the page (own prefix only) and a template runs once the app is ready', () => {
    TestBed.configureTestingModule({ providers: [FilesBridge] });
    const b = TestBed.inject(FilesBridge);
    b.configure(FILES_APPS[2]);
    const reqs: string[] = [];
    b.onRequest = r => reqs.push(r);
    const host = fakeHost(); const f = fakeFrame();
    b.attach(f.frame, host);
    b.handle(from(f.win, { type: 'axon:openRequest' }));
    b.handle(from(f.win, { type: 'axon:saveAsRequest' }));
    b.handle(from(f.win, { type: 'neuron:openRequest' }));
    expect(reqs).toEqual(['open', 'saveAs']);
    const ran = vi.fn();
    b.whenReady(ran);
    expect(ran).not.toHaveBeenCalled();
    b.handle(from(f.win, { type: 'axon:ready' }));
    expect(ran).toHaveBeenCalledTimes(1);
  });

  it('Myelin\'s frame asks for control=1 (window.myelin); the others do not', () => {
    expect(filesFrameUrl(MYELIN, `${ORIGIN}/`, 'A')).toContain('control=1');
    for (const a of FILES_APPS.filter(x => x.id !== 'myelin')) expect(filesFrameUrl(a, `${ORIGIN}/`, 'A')).not.toContain('control');
  });

  it('a save message carries the engine\'s saveAs flag (true / false / absent)', () => {
    TestBed.configureTestingModule({ providers: [FilesBridge] });
    const b = TestBed.inject(FilesBridge);
    b.configure(SYNAPSE);
    const got: (boolean | undefined)[] = [];
    b.onSave = f => got.push(f.saveAs);
    const host = fakeHost(); const f = fakeFrame();
    b.attach(f.frame, host);
    b.handle(from(f.win, { type: 'synapse:ready' }));
    for (const saveAs of [true, false, undefined]) b.handle(from(f.win, { type: 'synapse:save', name: 'L.docx', bytes: buf(docx), ...(saveAs === undefined ? {} : { saveAs }) }));
    expect(got).toEqual([true, false, undefined]);
  });

  it('the engine\'s own File → Open / Save As requests are noticed (the page then needs no buttons of its own), Save As carries the name, and saveAsTo goes back', () => {
    TestBed.configureTestingModule({ providers: [FilesBridge] });
    const b = TestBed.inject(FilesBridge);
    b.configure(MYELIN);
    const reqs: [string, string | undefined][] = [];
    b.onRequest = (r, n) => reqs.push([r, n]);
    const host = fakeHost(); const f = fakeFrame();
    b.attach(f.frame, host);
    expect(b.engineRoutesFiles()).toBe(false);
    b.handle(from(f.win, { type: 'myelin:ready' }));
    b.handle(from(f.win, { type: 'myelin:saveAsRequest', name: 'Report.pdf' }));
    b.handle(from(f.win, { type: 'myelin:openRequest' }));
    expect(reqs).toEqual([['saveAs', 'Report.pdf'], ['open', undefined]]);
    expect(b.engineRoutesFiles()).toBe(true);
    expect(b.saveAsTo('Report.pdf')).toBe(true);
    expect(f.postMessage).toHaveBeenCalledWith({ type: 'myelin:saveAsTo', name: 'Report.pdf' }, ORIGIN);
  });

  it('phi and phiPaste reach the page; only a true phi flag counts (sticky: false never clears)', () => {
    TestBed.configureTestingModule({ providers: [FilesBridge] });
    const b = TestBed.inject(FilesBridge);
    b.configure(FILES_APPS[2]);
    const seen: string[] = [];
    b.onPhi = k => seen.push(k);
    const host = fakeHost(); const f = fakeFrame();
    b.attach(f.frame, host);
    b.handle(from(f.win, { type: 'axon:phi', flag: false }));
    b.handle(from(f.win, { type: 'axon:phi', flag: true }));
    b.handle(from(f.win, { type: 'axon:phiPaste' }));
    b.handle(from(f.win, { type: 'synapse:phi', flag: true }));                       // another app's prefix is ignored
    expect(seen).toEqual(['phi', 'paste']);
  });

  it('comments: the engine\'s count reaches the page (clean numbers only); canComment is sent with ready and live; a comment-only save says so', () => {
    TestBed.configureTestingModule({ providers: [FilesBridge] });
    const b = TestBed.inject(FilesBridge);
    b.configure(SYNAPSE);
    const seen: { count: number; open: number }[] = [];
    b.onComments = c => seen.push(c);
    const saves: (boolean | undefined)[] = [];
    b.onSave = f => saves.push(f.commentOnly);
    b.canComment = true;
    const host = fakeHost(); const f = fakeFrame();
    b.attach(f.frame, host);
    b.handle(from(f.win, { type: 'synapse:ready' }));
    expect(f.postMessage).toHaveBeenCalledWith({ type: 'synapse:canComment', allow: true }, ORIGIN);
    b.handle(from(f.win, { type: 'synapse:comments', count: 5, open: 3 }));
    b.handle(from(f.win, { type: 'synapse:comments', count: 'x', open: -4 }));
    b.handle(from(f.win, { type: 'neuron:comments', count: 9, open: 9 }));                  // another app's prefix: ignored
    expect(seen).toEqual([{ count: 5, open: 3 }, { count: 0, open: 0 }]);
    b.handle(from(f.win, { type: 'synapse:save', name: 'L.docx', bytes: buf(docx), saveAs: false, commentOnly: true }));
    b.handle(from(f.win, { type: 'synapse:save', name: 'L.docx', bytes: buf(docx), saveAs: false }));
    b.handle(from(f.win, { type: 'synapse:save', name: 'L.docx', bytes: buf(docx), saveAs: false, commentOnly: 'yes' }));
    expect(saves).toEqual([true, undefined, undefined]);
    b.setCanComment(false);
    expect(f.postMessage).toHaveBeenLastCalledWith({ type: 'synapse:canComment', allow: false }, ORIGIN);
  });
});

describe('Start screen messages (`<prefix>home`, openRecent, newFromTemplate, started)', () => {
  const HOME = {
    recent: [{ id: 'f1', name: 'Daily log.xlsx', updatedAt: '2026-11-16T05:00:00Z', updatedByName: 'Kavya', containsPhi: true }],
    templates: [{ id: 'neuron:qc', name: 'QC log', source: 'builtin' as const }, { id: 'own:t1', name: 'Our stock sheet', source: 'lab' as const }],
    canCreate: true, canOpenDevice: true, placeName: 'Micro World',
  };
  it('home is held until the engine says ready, then sent once with the contract fields', () => {
    const { bridge, win, postMessage } = make();
    bridge.setHome(HOME);
    expect(postMessage).not.toHaveBeenCalled();
    bridge.handle(from(win, { type: msg.ready }));
    const home = postMessage.mock.calls.map(c => c[0]).filter(m => m.type === 'neuron:home');
    expect(home).toHaveLength(1);
    expect(home[0]).toMatchObject({ type: 'neuron:home', canCreate: true, canOpenDevice: true, placeName: 'Micro World' });
    expect(home[0].recent).toEqual(HOME.recent);
    expect(home[0].templates.map((t: { source: string }) => t.source)).toEqual(['builtin', 'lab']);
    expect(postMessage.mock.calls.find(c => c[0].type === 'neuron:home')![1]).toBe(ORIGIN);
  });
  it('a later change is sent at once; clearing it stops sending and nothing is sent without data', () => {
    const { bridge, win, postMessage } = make();
    bridge.handle(from(win, { type: msg.ready }));
    expect(postMessage.mock.calls.some(c => c[0].type === 'neuron:home')).toBe(false);
    bridge.setHome(HOME);
    expect(postMessage.mock.calls.filter(c => c[0].type === 'neuron:home')).toHaveLength(1);
    bridge.setHome(null);
    expect(postMessage.mock.calls.filter(c => c[0].type === 'neuron:home')).toHaveLength(1);
  });
  it('a new frame forgets the start screen data (a file frame never gets it)', () => {
    const { bridge, win, postMessage } = make();
    bridge.setHome(HOME);
    bridge.prepareNewFrame();
    bridge.handle(from(win, { type: msg.ready }));
    expect(postMessage.mock.calls.some(c => c[0].type === 'neuron:home')).toBe(false);
  });
  it('openRecent / newFromTemplate / started reach the page; ids must be non-empty strings; strangers are ignored', () => {
    const { bridge, win } = make();
    const rec = vi.fn(), tpl = vi.fn(), st = vi.fn();
    bridge.onOpenRecent = rec; bridge.onNewFromTemplate = tpl; bridge.onStarted = st;
    bridge.handle(from(win, { type: 'neuron:openRecent', id: 'f1' }));
    bridge.handle(from(win, { type: 'neuron:newFromTemplate', id: 'neuron:qc' }));
    bridge.handle(from(win, { type: 'neuron:started' }));
    expect(rec).toHaveBeenCalledWith('f1'); expect(tpl).toHaveBeenCalledWith('neuron:qc'); expect(st).toHaveBeenCalledTimes(1);
    bridge.handle(from(win, { type: 'neuron:openRecent', id: 7 }));
    bridge.handle(from(win, { type: 'neuron:openRecent', id: '' }));
    bridge.handle(from(win, { type: 'neuron:newFromTemplate' }));
    bridge.handle(from({}, { type: 'neuron:openRecent', id: 'f9' }));                    // not the frame's window
    bridge.handle(from(win, { type: 'neuron:openRecent', id: 'f9' }, 'http://evil.example'));
    expect(rec).toHaveBeenCalledTimes(1); expect(tpl).toHaveBeenCalledTimes(1);
  });
  it('every app speaks its own prefix', () => {
    for (const a of FILES_APPS) expect(messagesFor(a.prefix)).toMatchObject({ home: `${a.prefix}home`, openRecent: `${a.prefix}openRecent`, newFromTemplate: `${a.prefix}newFromTemplate`, started: `${a.prefix}started` });
  });
});
