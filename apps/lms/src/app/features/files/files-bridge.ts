import { Injectable, signal } from '@angular/core';
import { FILES_APPS, FilesApp, bytesFit, filesApp, sniff } from './files-registry';

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
 *   page → app   neuron:home   {recent, templates, canCreate, canOpenDevice, placeName}   the app's START SCREEN data (see StartHome)
 *   app → page   neuron:openRecent {id}              a Recent row was clicked on the start screen
 *   app → page   neuron:newFromTemplate {id}         a template tile was clicked (id from home.templates)
 *   app → page   neuron:started {}                   the app left its start screen into a new blank file on its own
 *
 * Rules: accept a message ONLY from the iframe's own window AND our own origin; never send non-xlsx bytes to the app
 * (it would open them as CSV text instead of failing).
 */
/** The message names of one app's protocol (`neuron:ready`, `synapse:ready` …): the ONE place that builds them from the registry prefix. */
export const messagesFor = (prefix: string) => ({
  ready: `${prefix}ready`, open: `${prefix}open`, save: `${prefix}save`,
  dirty: `${prefix}dirty`, failed: `${prefix}failed`, theme: `${prefix}theme`,
  readonly: `${prefix}readonly`,
  home: `${prefix}home`, openRecent: `${prefix}openRecent`, newFromTemplate: `${prefix}newFromTemplate`, started: `${prefix}started`,
}) as const;
export type FilesTheme = 'light' | 'dark' | 'system';

/** One row of an app's start screen "Recent": a stored file OF THIS APP'S KIND. `containsPhi` shows the patient-data shield. */
export interface StartRecent { id: string; name: string; updatedAt: string; updatedByName: string | null; containsPhi: boolean }
/** One template tile: built-in (the engine builds it) or the lab's own (a stored file copied on use). */
export interface StartTemplate { id: string; name: string; source: 'builtin' | 'lab' }
/** What the host tells an engine's start screen (`<prefix>home`); the engine renders Recent and templates from THIS, never from its local list. */
export interface StartHome { recent: StartRecent[]; templates: StartTemplate[]; canCreate: boolean; canOpenDevice: boolean; placeName: string }

export const ENGINE_FAILED_MESSAGE =
  "This computer can't show the editor because graphics acceleration is turned off. Try Chrome or Edge, or ask your IT person to turn on hardware acceleration.";
/** Plain words for "these bytes are not a file this app opens" (Nothing was changed). */
export const notThisKindMessage = (app: FilesApp): string => `That file isn't ${/^[aeiou]/i.test(app.noun) ? 'an' : 'a'} ${app.noun} ${app.name} can open. Nothing was changed.`;
export const NOT_A_SPREADSHEET_MESSAGE = notThisKindMessage(FILES_APPS[0]);

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Cross-realm safe: bytes posted by the iframe are ArrayBuffers of the FRAME's realm, so `instanceof ArrayBuffer` is false. */
export const isArrayBuffer = (v: unknown): v is ArrayBuffer => Object.prototype.toString.call(v) === '[object ArrayBuffer]';

/** Kept for callers that only care about spreadsheets. */
export const isXlsxBytes = (b: ArrayBuffer | ArrayBufferView | null | undefined): boolean => sniff(b) === 'zip';

/** A saved file coming out of an app, routed by its HEADER first (a mislabelled name never wins): `file` = the app's own format (stored),
 *  `pdf` = a PDF export from an app that is not Myelin (a plain download), `copy` = anything else the File screen exports (CSV, web page). */
export type SavedKind = 'file' | 'pdf' | 'copy';
export function routeSaved(bytes: ArrayBuffer | ArrayBufferView, app: FilesApp = FILES_APPS[0]): SavedKind {
  if (bytesFit(app, bytes)) return 'file';
  return sniff(bytes) === 'pdf' ? 'pdf' : 'copy';
}
/** `saveAs` is the engine's own word (Synapse, Axon, Myelin): true = the file becomes the document's file under a new name (File → Save As), false = Save or an export / copy. Neuron does not send it (undefined). */
export interface SavedFile { name: string; bytes: ArrayBuffer; kind: SavedKind; saveAs?: boolean; /** The engine says this save changed only comments (what a "Can comment" share may save). */ commentOnly?: boolean }

/** The message data of an event we accept — or null. Source must be the frame's window, origin must be ours, name must carry the app's prefix. */
export function acceptedMessage(
  ev: { origin?: string; source?: unknown; data?: unknown },
  frameWindow: unknown,
  ownOrigin: string,
  prefix = FILES_APPS[0].prefix,
): { type: string; [k: string]: unknown } | null {
  if (!frameWindow || ev.source !== frameWindow) return null;
  if (ev.origin !== ownOrigin) return null;
  const d = ev.data as { type?: unknown } | null;
  if (!d || typeof d !== 'object' || typeof d.type !== 'string' || !d.type.startsWith(prefix)) return null;
  return d as { type: string };
}

/** The embedded app's window chrome in the frame: 'notitlebar' = the full app (File tab, ribbon, status bar) without its own
 * title bar, which the LMS band replaces. ONE constant. */
export const FRAME_CHROME: 'none' | 'minimal' | 'notitlebar' = 'notitlebar';

/** The iframe URL: `<base>/<app.enginePath>index.html?host=parent&chrome=<FRAME_CHROME>&author=<name>&theme=<light|dark|system>[&readonly=1]`. */
export function filesFrameUrl(app: FilesApp, baseUri: string, author: string, theme: FilesTheme = 'system', readonly = false): string {
  // `frameParams`: what an engine needs beyond the common ones (Myelin: control=1 installs window.myelin).
  const u = new URL(`${app.enginePath}index.html`, baseUri);
  u.searchParams.set('host', 'parent');
  u.searchParams.set('chrome', FRAME_CHROME);
  u.searchParams.set('author', author);
  u.searchParams.set('theme', theme);
  if (readonly) u.searchParams.set('readonly', '1');
  for (const [k, v] of Object.entries(app.frameParams ?? {})) u.searchParams.set(k, v);
  return u.toString();
}

const OPEN_POLL_MS = 150;
const OPEN_POLL_MAX = 80;   // about 12 seconds

/** One engine command (`window.neuron.execute(cmd, params)`). */
export interface EngineCommand { cmd: string; params: Record<string, unknown> }

/** Fit every used column to its text, with the engine's own font measure (so nothing shows as "P-0001 (r…"). */
export const FIT_COLUMNS: EngineCommand = { cmd: 'home.autofitColumnWidth', params: { cols: 'A:Z' } };

export type FrameState = 'idle' | 'loading' | 'ready' | 'failed';

/** The engine's own scripting handle (`iframe.contentWindow.<app.global>`). */
export interface EngineApi {
  execute(cmd: string, params?: unknown): unknown;
  request?(method: string, params?: unknown): unknown;
  docInspect?(params?: unknown): unknown;
}

/**
 * One bridge per open sheet (provided by the page, not root). The page attaches the iframe element; messages from
 * anything else are ignored. State is exposed as signals; stored-file work happens in the page through `onSave`.
 */
@Injectable()
export class FilesBridge {
  /** Which app this bridge speaks to: its message prefix, JS global and file type. Set before the frame attaches (the page does). */
  app: FilesApp = FILES_APPS[0];
  private get msg() { return messagesFor(this.app.prefix); }
  configure(app: FilesApp): void { this.app = app; }

  readonly state = signal<FrameState>('idle');
  /** The app's own unsaved-changes flag. */
  readonly dirty = signal(false);
  readonly failure = signal<string | null>(null);
  /** Set when the page tried to open bytes that are not an .xlsx (nothing was sent). */
  readonly openProblem = signal<string | null>(null);
  /** Sent to the app as soon as it is ready (the URL also carries it). */
  readonly: boolean | null = null;
  /** Sent with `ready` (and whenever it changes): a read-only document that still takes comments. */
  canComment = false;

  /** Called with every file the app hands over (Save → the app's own format, Export as PDF → pdf). */
  onSave: (f: SavedFile) => void = () => undefined;
  /** The engine's File → Open / Save As asks to use the device (`<prefix>openRequest` / `<prefix>saveAsRequest`): the page shows its own choice. */
  onRequest: (r: 'open' | 'saveAs', name?: string) => void = () => undefined;
  /** The engine reports its comments (`<prefix>comments {count, open}`): the open count is what the Files list shows. */
  onComments: (c: { count: number; open: number }) => void = () => undefined;
  /** The engine reports that patient data is in the document (`<prefix>phi {flag}`) or was pasted from a flagged file (`<prefix>phiPaste`). Sticky: only `true` / paste count. */
  onPhi: (kind: 'phi' | 'paste') => void = () => undefined;
  /** The start screen's Recent row was clicked (`<prefix>openRecent {id}`). */
  onOpenRecent: (id: string) => void = () => undefined;
  /** A start-screen template tile was clicked (`<prefix>newFromTemplate {id}`). */
  onNewFromTemplate: (id: string) => void = () => undefined;
  /** The engine left its start screen into a new blank file by itself (`<prefix>started`). */
  onStarted: () => void = () => undefined;
  /** True once the engine has sent any of its own File → Open / Save As requests: the page then knows it need not offer its own buttons. */
  readonly engineRoutesFiles = signal(false);

  private frame: HTMLIFrameElement | null = null;
  private pending: { name: string; bytes: ArrayBuffer; then: EngineCommand[] } | null = null;
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
    if (this.missing) { this.failure.set(this.missing); this.state.set('failed'); }
    else this.state.set('loading');
    this.ownOrigin = win.location.origin;
    if (!this.listening) { win.addEventListener('message', this.handler); this.listening = true; this.win = win; }
  }
  private win: Window | null = null;

  private stop(win: Window | null = this.win): void {
    if (this.listening) { (win ?? window).removeEventListener('message', this.handler); this.listening = false; }
  }
  destroy(): void { this.frame = null; this.stop(); }

  /** Open a workbook. Non-xlsx bytes are refused here (never sent). Held until the app says `ready`. `then` = engine commands
   *  to run once it is open (the results workbook asks for its columns to be fitted). */
  open(name: string, bytes: ArrayBuffer, then: EngineCommand[] = []): boolean {
    if (!bytesFit(this.app, bytes)) { this.openProblem.set(notThisKindMessage(this.app)); return false; }
    this.openProblem.set(null);
    this.pending = { name, bytes, then };
    if (this.state() === 'ready') this.flush();
    return true;
  }

  /** The engine is not part of this build: the same "can't open here" state as a failed start, with its own plain words. */
  markUnavailable(message: string): void { this.pending = null; this.missing = message; this.failure.set(message); this.state.set('failed'); }
  /** Set while the engine is known to be missing: a newly attached frame must not turn it back into "loading". */
  private missing: string | null = null;

  /** Tell the app which look to use (follows the LMS light / dark toggle). Safe before ready: the URL carries the first one. */
  setTheme(theme: FilesTheme): void {
    const w = this.frame?.contentWindow;
    if (!w || this.state() !== 'ready') return;
    w.postMessage({ type: this.msg.theme, theme }, this.ownOrigin);
  }

  /** Tell the engine whether this person may add comments while the document is read-only (`<prefix>canComment {allow}`: "Can comment" shares). */
  setCanComment(allow: boolean): void { this.canComment = allow; this.post({ type: `${this.app.prefix}canComment`, allow }); }

  /** The start screen's data. Kept, and (re)sent whenever it changes and once the engine says `ready`. Never carries file contents. */
  private home: StartHome | null = null;
  setHome(h: StartHome | null): void { this.home = h; this.sendHome(); }
  private sendHome(): void { if (this.home) this.post({ type: this.msg.home, ...this.home }); }

  /** View-only for a role that cannot save. */
  setReadonly(readonly: boolean): void { this.post({ type: this.msg.readonly, readonly }); }
  private post(m: Record<string, unknown>): void {
    const w = this.frame?.contentWindow;
    if (w && this.state() === 'ready') w.postMessage(m, this.ownOrigin);
  }

  /** A new sheet is about to replace the frame: the OLD frame's `ready` must not count, or the file would be posted to a window that
   *  is about to disappear. The new frame announces its own `ready`. */
  prepareNewFrame(): void {
    this.pending = null;
    this.home = null;
    this.missing = null;
    this.readyWaiters = [];
    this.openProblem.set(null);
    this.dirty.set(false);
    this.failure.set(null);
    this.state.set('loading');
  }

  /** Forget a file that was queued but not sent (a blank new sheet starts clean). */
  discardPending(): void { this.pending = null; this.openProblem.set(null); }

  /** The engine's scripting API, when the frame is up. */
  private api(): EngineApi | null {
    try { return ((this.frame?.contentWindow as unknown as Record<string, EngineApi | undefined> | null)?.[this.app.global]) ?? null; } catch { return null; }
  }
  private readyWaiters: (() => void)[] = [];
  /** Run `fn` once the app says `ready` (now if it already has). */
  whenReady(fn: () => void): void { if (this.state() === 'ready') fn(); else this.readyWaiters.push(fn); }
  /** One engine command by name (a template's `file.new`). False if the app isn't up. */
  runCommand(cmd: string, params: Record<string, unknown> = {}): boolean { return this.run(cmd, params); }
  /** After the person chose where Save As goes: tell the engine to carry on (`<prefix>saveAsTo {name}`); it then answers with a save message (saveAs: true). */
  saveAsTo(name: string): boolean {
    const w = this.frame?.contentWindow;
    if (!w || this.state() !== 'ready') return false;
    w.postMessage({ type: `${this.app.prefix}saveAsTo`, name }, this.ownOrigin);
    return true;
  }
  /** Ask the app to save (it answers with a save message). False if it isn't ready. */
  save(): boolean { return this.run('file.save'); }
  exportPdf(): boolean { return this.run('file.exportPdf'); }
  private run(cmd: string, params: Record<string, unknown> = {}): boolean {
    const api = this.api();
    if (this.state() !== 'ready' || !api) return false;
    // Right after `ready` the workbook may still be opening ("no workbook open"): try again briefly instead of losing the click.
    const attempt = (n: number): void => {
      let r: unknown;
      try { r = api.execute(cmd, params); } catch { return; }
      if (r && typeof (r as Promise<unknown>).catch === 'function') {
        (r as Promise<unknown>).catch((e: unknown) => { if (n < 20 && /no workbook open/i.test(String((e as Error)?.message ?? e))) setTimeout(() => attempt(n + 1), 300); });
      }
    };
    attempt(0);
    return true;
  }

  /** Run commands on the workbook that was just sent. The app starts with an empty workbook of its own, so a command sent too early
   *  would land on THAT one (and mark it changed, which keeps the sheet looking unsaved): wait until the app reports the opened
   *  file's title, and give up quietly after a few seconds (the sheet is still usable, just not fitted). */
  private afterOpened(name: string, commands: EngineCommand[]): void {
    const api = this.api();
    const inspect = api?.docInspect;
    if (!api || typeof inspect !== 'function') { for (const c of commands) this.run(c.cmd, c.params); return; }
    const attempt = (n: number): void => {
      if (this.state() !== 'ready' || n > OPEN_POLL_MAX) return;
      let r: unknown;
      try { r = inspect.call(api, {}); } catch { r = null; }
      Promise.resolve(r).then(
        (i: unknown) => {
          if ((i as { title?: string } | null)?.title === name) for (const c of commands) this.run(c.cmd, c.params);
          else setTimeout(() => attempt(n + 1), OPEN_POLL_MS);
        },
        () => setTimeout(() => attempt(n + 1), OPEN_POLL_MS));
    };
    attempt(0);
  }

  private flush(): void {
    const w = this.frame?.contentWindow;
    if (!w || !this.pending) return;
    const { name, bytes, then } = this.pending;
    this.pending = null;
    w.postMessage({ type: this.msg.open, name, bytes }, this.ownOrigin, [bytes]);
    if (then.length) this.afterOpened(name, then);
  }

  /** Public for specs: one window message. */
  handle(ev: Pick<MessageEvent, 'origin' | 'source' | 'data'>): void {
    const m = acceptedMessage(ev, this.frame?.contentWindow, this.ownOrigin, this.app.prefix);
    const msg = this.msg;
    if (!m) return;
    switch (m.type) {
      case msg.ready:
        this.state.set('ready');
        if (this.readonly !== null) this.setReadonly(this.readonly);
        if (this.canComment) this.setCanComment(true);
        this.sendHome();
        this.flush();
        { const w = this.readyWaiters; this.readyWaiters = []; for (const fn of w) fn(); }
        break;
      case msg.openRecent:
        if (typeof m['id'] === 'string' && m['id']) this.onOpenRecent(m['id'] as string);
        break;
      case msg.newFromTemplate:
        if (typeof m['id'] === 'string' && m['id']) this.onNewFromTemplate(m['id'] as string);
        break;
      case msg.started:
        this.onStarted();
        break;
      case `${this.app.prefix}openRequest`:
        this.engineRoutesFiles.set(true);
        this.onRequest('open');
        break;
      case `${this.app.prefix}saveAsRequest`:
        this.engineRoutesFiles.set(true);
        this.onRequest('saveAs', typeof m['name'] === 'string' ? (m['name'] as string) : undefined);
        break;
      case `${this.app.prefix}comments`: {
        const count = Number(m['count']), open = Number(m['open']);
        this.onComments({ count: Number.isFinite(count) ? Math.max(0, count) : 0, open: Number.isFinite(open) ? Math.max(0, open) : 0 });
        break;
      }
      case `${this.app.prefix}phi`:
        if (m['flag'] === true) this.onPhi('phi');
        break;
      case `${this.app.prefix}phiPaste`:
        this.onPhi('paste');
        break;
      case msg.dirty:
        this.dirty.set(m['dirty'] === true);
        break;
      case msg.failed:
        this.state.set('failed');
        this.failure.set(ENGINE_FAILED_MESSAGE);
        break;
      case msg.save: {
        const bytes = m['bytes'];
        const name = typeof m['name'] === 'string' && m['name'] ? (m['name'] as string) : `${this.app.newName}.${this.app.exts[0]}`;
        if (!isArrayBuffer(bytes) && !ArrayBuffer.isView(bytes)) return;
        // Copy into THIS window's realm: the frame's ArrayBuffer is a foreign object, and Safari's Blob / FormData do not take
        // it as bytes (the upload arrived empty).
        const src = isArrayBuffer(bytes) ? new Uint8Array(bytes) : new Uint8Array((bytes as ArrayBufferView).buffer, (bytes as ArrayBufferView).byteOffset, (bytes as ArrayBufferView).byteLength);
        const buf = src.slice().buffer as ArrayBuffer;
        const kind = routeSaved(buf, this.app);
        this.onSave({ name, bytes: buf, kind, saveAs: typeof m['saveAs'] === 'boolean' ? (m['saveAs'] as boolean) : undefined, commentOnly: m['commentOnly'] === true ? true : undefined });
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
export function withExtension(name: string, ext: string): string {
  const base = (name || 'File').trim().replace(/\.(xlsx|docx|pptx|pdf|xls|csv|png|jpe?g|webp)$/i, '') || 'File';
  return `${base}.${ext}`;
}

/** MIME type of a downloaded copy by its extension. */
export function mimeForName(name: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  return ({
    csv: 'text/csv', html: 'text/html', htm: 'text/html', txt: 'text/plain', pdf: 'application/pdf', xlsx: XLSX_MIME,
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  } as Record<string, string>)[ext ?? ''] ?? 'application/octet-stream';
}
