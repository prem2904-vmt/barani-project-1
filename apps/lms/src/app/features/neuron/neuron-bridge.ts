import { Injectable, signal } from '@angular/core';

/**
 * The Neuron spreadsheet lives in a SAME-ORIGIN iframe (`/neuron-engine/…`, the static Neuron build; NOT `/neuron/`, which is the LMS route) and talks to the
 * LMS page through plain window messages (`?host=parent`). This file is the ONE place that knows the protocol:
 *
 *   app → page   neuron:ready  {}                 the app is listening — send the file now
 *   page → app   neuron:open   {name, bytes}      open a workbook (bytes TRANSFERRED)
 *   app → page   neuron:save   {name, bytes}      Save gives an .xlsx, Export as PDF a .pdf (told apart by header)
 *   app → page   neuron:dirty  {dirty}            unsaved changes appeared / went away
 *   page → app   neuron:theme   {theme}              'light' | 'dark' | 'system' (follows the LMS toggle)
 *   page → app   neuron:readonly {readonly}          view-only for roles that cannot save
 *   app → page   neuron:failed {error}            the app could not start (no WebGL2 / WebGPU …)
 *
 * Rules: accept a message ONLY from the iframe's own window AND our own origin; never send non-xlsx bytes to the app
 * (it would open them as CSV text instead of failing).
 */
/** The ONE place that knows the message prefix of the embedded app's protocol. */
export const NEURON_MSG_PREFIX = 'neuron:';
export const msg = {
  ready: `${NEURON_MSG_PREFIX}ready`, open: `${NEURON_MSG_PREFIX}open`, save: `${NEURON_MSG_PREFIX}save`,
  dirty: `${NEURON_MSG_PREFIX}dirty`, failed: `${NEURON_MSG_PREFIX}failed`, theme: `${NEURON_MSG_PREFIX}theme`,
  readonly: `${NEURON_MSG_PREFIX}readonly`,
} as const;
export type NeuronTheme = 'light' | 'dark' | 'system';

export const NEURON_FAILED_MESSAGE =
  "This computer can't show the spreadsheet because graphics acceleration is turned off. Try Chrome or Edge, or ask your IT person to turn on hardware acceleration.";
export const NOT_A_SPREADSHEET_MESSAGE = "That file isn't a spreadsheet Neuron can open. Nothing was changed.";

export type FileSniff = 'xlsx' | 'pdf' | 'other';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Cross-realm safe: bytes posted by the iframe are ArrayBuffers of the FRAME's realm, so `instanceof ArrayBuffer` is false. */
export const isArrayBuffer = (v: unknown): v is ArrayBuffer => Object.prototype.toString.call(v) === '[object ArrayBuffer]';
const view = (b: ArrayBuffer | ArrayBufferView): Uint8Array =>
  ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b);

/** What the first bytes say: `PK\x03\x04` = a zip package (.xlsx), `%PDF` = a PDF. */
export function sniffBytes(bytes: ArrayBuffer | ArrayBufferView | null | undefined): FileSniff {
  if (!bytes) return 'other';
  const v = view(bytes);
  if (v.length >= 4 && v[0] === 0x50 && v[1] === 0x4b && v[2] === 0x03 && v[3] === 0x04) return 'xlsx';
  if (v.length >= 4 && v[0] === 0x25 && v[1] === 0x50 && v[2] === 0x44 && v[3] === 0x46) return 'pdf';
  return 'other';
}
export const isXlsxBytes = (b: ArrayBuffer | ArrayBufferView | null | undefined): boolean => sniffBytes(b) === 'xlsx';

/** A saved file coming out of the app, routed by its HEADER first and its extension second (a mislabelled name never wins). */
export function routeSaved(bytes: ArrayBuffer | ArrayBufferView): 'xlsx' | 'pdf' | 'unknown' {
  const sniff = sniffBytes(bytes);
  if (sniff === 'pdf') return 'pdf';
  if (sniff === 'xlsx') return 'xlsx';
  return 'unknown';
}

export interface SavedFile { name: string; bytes: ArrayBuffer; kind: 'xlsx' | 'pdf'; }

/** The message data of an event we accept — or null. Source must be the frame's window, origin must be ours. */
export function acceptedMessage(
  ev: { origin?: string; source?: unknown; data?: unknown },
  frameWindow: unknown,
  ownOrigin: string,
): { type: string; [k: string]: unknown } | null {
  if (!frameWindow || ev.source !== frameWindow) return null;
  if (ev.origin !== ownOrigin) return null;
  const d = ev.data as { type?: unknown } | null;
  if (!d || typeof d !== 'object' || typeof d.type !== 'string' || !d.type.startsWith(NEURON_MSG_PREFIX)) return null;
  return d as { type: string };
}

/** The embedded app's window chrome in the frame: 'notitlebar' = the full app (File tab, ribbon, status bar) without its own
 * title bar, which the LMS band replaces. ONE constant. */
export const FRAME_CHROME: 'none' | 'minimal' | 'notitlebar' = 'notitlebar';

/** The iframe URL: `<base>/neuron-engine/index.html?host=parent&chrome=<FRAME_CHROME>&author=<name>&theme=<light|dark|system>[&readonly=1]`. */
export function neuronFrameUrl(baseUri: string, author: string, theme: NeuronTheme = 'system', readonly = false): string {
  const u = new URL('neuron-engine/index.html', baseUri);
  u.searchParams.set('host', 'parent');
  u.searchParams.set('chrome', FRAME_CHROME);
  u.searchParams.set('author', author);
  u.searchParams.set('theme', theme);
  if (readonly) u.searchParams.set('readonly', '1');
  return u.toString();
}

export type FrameState = 'idle' | 'loading' | 'ready' | 'failed';

/** The engine's own scripting handle (`iframe.contentWindow.neuron`). */
export interface NeuronApi {
  execute(cmd: string, params?: unknown): unknown;
  request?(method: string, params?: unknown): unknown;
  docInspect?(params?: unknown): unknown;
}

/**
 * One bridge per open sheet (provided by the page, not root). The page attaches the iframe element; messages from
 * anything else are ignored. State is exposed as signals; stored-file work happens in the page through `onSave`.
 */
@Injectable()
export class NeuronBridge {
  readonly state = signal<FrameState>('idle');
  /** The app's own unsaved-changes flag. */
  readonly dirty = signal(false);
  readonly failure = signal<string | null>(null);
  /** Set when the page tried to open bytes that are not an .xlsx (nothing was sent). */
  readonly openProblem = signal<string | null>(null);
  /** Sent to the app as soon as it is ready (the URL also carries it). */
  readonly: boolean | null = null;

  /** Called with every file the app hands over (Save → xlsx, Export as PDF → pdf). */
  onSave: (f: SavedFile) => void = () => undefined;

  private frame: HTMLIFrameElement | null = null;
  private pending: { name: string; bytes: ArrayBuffer } | null = null;
  private listening = false;
  private ownOrigin = '';
  private readonly handler = (ev: MessageEvent) => this.handle(ev);

  /** Attach (or detach with null) the iframe. A new iframe starts in `loading`. */
  attach(frame: HTMLIFrameElement | null, win: Window = window): void {
    if (frame === this.frame) return;
    this.frame = frame;
    this.dirty.set(false);
    this.failure.set(null);
    if (!frame) { this.state.set('idle'); this.stop(win); return; }
    this.state.set('loading');
    this.ownOrigin = win.location.origin;
    if (!this.listening) { win.addEventListener('message', this.handler); this.listening = true; this.win = win; }
  }
  private win: Window | null = null;

  private stop(win: Window | null = this.win): void {
    if (this.listening) { (win ?? window).removeEventListener('message', this.handler); this.listening = false; }
  }
  destroy(): void { this.frame = null; this.stop(); }

  /** Open a workbook. Non-xlsx bytes are refused here (never sent). Held until the app says `ready`. */
  open(name: string, bytes: ArrayBuffer): boolean {
    if (!isXlsxBytes(bytes)) { this.openProblem.set(NOT_A_SPREADSHEET_MESSAGE); return false; }
    this.openProblem.set(null);
    this.pending = { name, bytes };
    if (this.state() === 'ready') this.flush();
    return true;
  }

  /** Tell the app which look to use (follows the LMS light / dark toggle). Safe before ready: the URL carries the first one. */
  setTheme(theme: NeuronTheme): void {
    const w = this.frame?.contentWindow;
    if (!w || this.state() !== 'ready') return;
    w.postMessage({ type: msg.theme, theme }, this.ownOrigin);
  }

  /** View-only for a role that cannot save. */
  setReadonly(readonly: boolean): void { this.post({ type: msg.readonly, readonly }); }
  private post(m: Record<string, unknown>): void {
    const w = this.frame?.contentWindow;
    if (w && this.state() === 'ready') w.postMessage(m, this.ownOrigin);
  }

  /** A new sheet is about to replace the frame: the OLD frame's `ready` must not count, or the file would be posted to a window that
   *  is about to disappear. The new frame announces its own `ready`. */
  prepareNewFrame(): void {
    this.pending = null;
    this.openProblem.set(null);
    this.dirty.set(false);
    this.failure.set(null);
    this.state.set('loading');
  }

  /** Forget a file that was queued but not sent (a blank new sheet starts clean). */
  discardPending(): void { this.pending = null; this.openProblem.set(null); }

  /** The engine's scripting API, when the frame is up. */
  private api(): NeuronApi | null {
    try { return ((this.frame?.contentWindow as unknown as { neuron?: NeuronApi } | null)?.neuron) ?? null; } catch { return null; }
  }
  /** Ask the app to save (it answers with a save message). False if it isn't ready. */
  save(): boolean { return this.run('file.save'); }
  exportPdf(): boolean { return this.run('file.exportPdf'); }
  private run(cmd: string): boolean {
    const api = this.api();
    if (this.state() !== 'ready' || !api) return false;
    // Right after `ready` the workbook may still be opening ("no workbook open"): try again briefly instead of losing the click.
    const attempt = (n: number): void => {
      let r: unknown;
      try { r = api.execute(cmd, {}); } catch { return; }
      if (r && typeof (r as Promise<unknown>).catch === 'function') {
        (r as Promise<unknown>).catch((e: unknown) => { if (n < 20 && /no workbook open/i.test(String((e as Error)?.message ?? e))) setTimeout(() => attempt(n + 1), 300); });
      }
    };
    attempt(0);
    return true;
  }

  private flush(): void {
    const w = this.frame?.contentWindow;
    if (!w || !this.pending) return;
    const { name, bytes } = this.pending;
    this.pending = null;
    w.postMessage({ type: msg.open, name, bytes }, this.ownOrigin, [bytes]);
  }

  /** Public for specs: one window message. */
  handle(ev: Pick<MessageEvent, 'origin' | 'source' | 'data'>): void {
    const m = acceptedMessage(ev, this.frame?.contentWindow, this.ownOrigin);
    if (!m) return;
    switch (m.type) {
      case msg.ready:
        this.state.set('ready');
        if (this.readonly !== null) this.setReadonly(this.readonly);
        this.flush();
        break;
      case msg.dirty:
        this.dirty.set(m['dirty'] === true);
        break;
      case msg.failed:
        this.state.set('failed');
        this.failure.set(NEURON_FAILED_MESSAGE);
        break;
      case msg.save: {
        const bytes = m['bytes'];
        const name = typeof m['name'] === 'string' && m['name'] ? (m['name'] as string) : 'Sheet.xlsx';
        if (!isArrayBuffer(bytes) && !ArrayBuffer.isView(bytes)) return;
        // Copy into THIS window's realm: the frame's ArrayBuffer is a foreign object, and Safari's Blob / FormData do not take
        // it as bytes (the upload arrived empty).
        const src = isArrayBuffer(bytes) ? new Uint8Array(bytes) : new Uint8Array((bytes as ArrayBufferView).buffer, (bytes as ArrayBufferView).byteOffset, (bytes as ArrayBufferView).byteLength);
        const buf = src.slice().buffer as ArrayBuffer;
        const kind = routeSaved(buf);
        if (kind === 'unknown') return;
        this.onSave({ name, bytes: buf, kind });
        break;
      }
    }
  }
}

/** Browser download of bytes (a PDF export, an .xlsx export). */
export function downloadBytes(name: string, bytes: ArrayBuffer, mime: string, doc: Document = document): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = doc.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
  doc.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** File name with the right extension ("Glucose" → "Glucose.pdf"). */
export function withExtension(name: string, ext: 'xlsx' | 'pdf'): string {
  const base = (name || 'Sheet').trim().replace(/\.(xlsx|pdf|xls|csv)$/i, '') || 'Sheet';
  return `${base}.${ext}`;
}
