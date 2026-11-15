import { Injectable, inject } from '@angular/core';
import { FilesApp, MAX_DEVICE_BYTES, bytesFit, extOf, extensionAllowed } from './files-registry';
import { downloadBytes, mimeForName } from './files-bridge';

/**
 * Where an open file lives. `lab` = Prefrontal's own storage (the API); `device` = a file on THIS computer / phone:
 *   - Chromium / Edge: a File System Access handle (save in place; the browser asks permission once),
 *   - the desktop app: an opaque token main handed out (save in place),
 *   - Safari / Firefox / phones: nothing to hold on to (open = a file chooser, save = a download of a copy).
 */
export type FileTarget =
  | { kind: 'lab'; id: string }
  | { kind: 'device'; name: string; handle?: unknown; token?: string };

export type DeviceMode = 'fsa' | 'electron' | 'fallback';
export interface DeviceOpened { target: FileTarget & { kind: 'device' }; name: string; bytes: ArrayBuffer }
export interface DeviceSaved { target: FileTarget & { kind: 'device' }; name: string; inPlace: boolean }
/** A plain refusal (wrong type, too big, empty): `message` goes to the person as it is. */
export class DeviceFileError extends Error {}

/** Null when this name + size may be opened here / saved from here. Pure. */
export function checkDeviceFile(app: FilesApp, name: string, size: number): string | null {
  if (!extensionAllowed(app, name)) return `Only .${app.exts.join(', .')} files can be used with ${app.name}.`;
  if (!(size > 0)) return 'That file is empty.';
  if (size > MAX_DEVICE_BYTES) return 'That file is too large (the limit is 25 MB).';
  return null;
}

interface PickerWindow {
  showOpenFilePicker?: (o: unknown) => Promise<{ getFile(): Promise<File>; name: string }[]>;
  showSaveFilePicker?: (o: unknown) => Promise<{ name: string; createWritable(): Promise<{ write(b: BufferSource): Promise<void>; close(): Promise<void> }>; requestPermission?: (o: unknown) => Promise<string> }>;
  electronAPI?: { files?: { openLocal(kind: string): Promise<unknown>; saveLocal(p: unknown): Promise<unknown> } };
}

const pickerTypes = (app: FilesApp) => [{ description: app.name, accept: { [app.mime === 'image/png' ? 'image/*' : app.mime]: app.exts.map(e => `.${e}`) } }];
const isAbort = (e: unknown): boolean => (e as { name?: string })?.name === 'AbortError';

/**
 * Open from / save to THIS device, in addition to lab storage. Triggered only by our own buttons (the engine's File screen goes through
 * the same calls), never by a native-looking control of ours. One abstraction over the three ways a client can touch local files.
 * Whether a LAB file may leave for the device (patient-data rule) is the page's job BEFORE it calls save (OfficeService.deviceExport).
 */
@Injectable({ providedIn: 'root' })
export class FilesDeviceService {
  /** Test seam. */
  win: PickerWindow = (typeof window !== 'undefined' ? window : {}) as unknown as PickerWindow;
  doc: Document | null = typeof document !== 'undefined' ? document : null;

  mode(): DeviceMode {
    if (this.win.electronAPI?.files) return 'electron';
    if (typeof this.win.showOpenFilePicker === 'function' && typeof this.win.showSaveFilePicker === 'function') return 'fsa';
    return 'fallback';
  }
  /** Which client is asking (for the server's audit row). */
  client(): 'web' | 'electron' | 'ios' | 'android' {
    if (this.win.electronAPI?.files) return 'electron';
    const cap = (this.win as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.();
    return cap === 'ios' ? 'ios' : cap === 'android' ? 'android' : 'web';
  }
  /** Save in place is possible for this target (a handle or a token); otherwise a save is a Save As / a download. */
  canSaveInPlace(t: FileTarget | null | undefined): boolean {
    return !!t && t.kind === 'device' && (!!t.handle || !!t.token);
  }

  /** "Open from this device" on the Files screen: a file of ANY of the given apps; the app is the one whose extensions include the file's. Null = cancelled. */
  async openAny(apps: readonly FilesApp[]): Promise<(DeviceOpened & { app: FilesApp }) | null> {
    if (!apps.length) return null;
    const exts = apps.flatMap(a => a.exts);
    const appFor = (name: string): FilesApp => {
      const a = apps.find(x => x.exts.includes(extOf(name)));
      if (!a) throw new DeviceFileError(`Only ${[...new Set(exts)].map(e => '.' + e).join(', ')} files can be opened here.`);
      return a;
    };
    try {
      const mode = this.mode();
      let name: string; let bytes: ArrayBuffer; let target: FileTarget & { kind: 'device' };
      if (mode === 'electron') {
        const r = await this.win.electronAPI!.files!.openLocal('any') as { error?: string; token?: string; name?: string; bytes?: Uint8Array } | null;
        if (!r) return null;
        if (r.error) throw new DeviceFileError(r.error);
        name = r.name!; bytes = toBuffer(r.bytes!); target = { kind: 'device', name, token: r.token };
      } else if (mode === 'fsa') {
        const [h] = await this.win.showOpenFilePicker!({ types: apps.map(a => pickerTypes(a)[0]), multiple: false });
        const f = await h.getFile();
        name = f.name; bytes = await f.arrayBuffer(); target = { kind: 'device', name, handle: h };
      } else {
        const f = await this.chooseFileOf(exts);
        if (!f) return null;
        name = f.name; bytes = await f.arrayBuffer(); target = { kind: 'device', name };
      }
      const app = appFor(name);
      return { ...this.accept(app, target, name, bytes), app };
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
  }

  /** The person's own "Open from this device". Null = cancelled. Throws {@link DeviceFileError} with plain words. */
  async open(app: FilesApp): Promise<DeviceOpened | null> {
    const mode = this.mode();
    try {
      if (mode === 'electron') {
        const r = await this.win.electronAPI!.files!.openLocal(app.kind) as { error?: string; token?: string; name?: string; bytes?: Uint8Array } | null;
        if (!r) return null;
        if (r.error) throw new DeviceFileError(r.error);
        const bytes = toBuffer(r.bytes!);
        return this.accept(app, { kind: 'device', name: r.name!, token: r.token }, r.name!, bytes);
      }
      if (mode === 'fsa') {
        const [h] = await this.win.showOpenFilePicker!({ types: pickerTypes(app), multiple: false, excludeAcceptAllOption: true });
        const f = await h.getFile();
        const bad = checkDeviceFile(app, f.name, f.size);
        if (bad) throw new DeviceFileError(bad);
        return this.accept(app, { kind: 'device', name: f.name, handle: h }, f.name, await f.arrayBuffer());
      }
      const f = await this.chooseFile(app);
      if (!f) return null;
      const bad = checkDeviceFile(app, f.name, f.size);
      if (bad) throw new DeviceFileError(bad);
      return this.accept(app, { kind: 'device', name: f.name }, f.name, await f.arrayBuffer());
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
  }

  private accept(app: FilesApp, target: FileTarget & { kind: 'device' }, name: string, bytes: ArrayBuffer): DeviceOpened {
    const bad = checkDeviceFile(app, name, bytes.byteLength);
    if (bad) throw new DeviceFileError(bad);
    // The extension can lie: the bytes must look like the app's type too (the engine would show an error screen otherwise).
    if (!bytesFit(app, bytes, name)) throw new DeviceFileError(`That file isn't ${/^[aeiou]/i.test(app.noun) ? 'an' : 'a'} ${app.noun} ${app.name} can open.`);
    return { target, name, bytes };
  }

  /** Save to the device: in place when `target` allows it (and `saveAs` is not asked for), else a Save As / a download of a copy. Null = cancelled. */
  async save(app: FilesApp, name: string, bytes: ArrayBuffer, target: FileTarget | null = null, saveAs = false): Promise<DeviceSaved | null> {
    const bad = checkDeviceFile(app, name, bytes.byteLength);
    if (bad) throw new DeviceFileError(bad);
    const mode = this.mode();
    const dev = target && target.kind === 'device' ? target : null;
    try {
      if (mode === 'electron') {
        const r = await this.win.electronAPI!.files!.saveLocal({ token: saveAs ? undefined : dev?.token, kind: app.kind, name, bytes: new Uint8Array(bytes) }) as { error?: string; token?: string; name?: string } | null;
        if (!r) return null;
        if (r.error) throw new DeviceFileError(r.error);
        return { target: { kind: 'device', name: r.name!, token: r.token }, name: r.name!, inPlace: !!dev?.token && !saveAs };
      }
      if (mode === 'fsa') {
        let handle = !saveAs ? (dev?.handle as { name: string; createWritable(): Promise<{ write(b: BufferSource): Promise<void>; close(): Promise<void> }> } | undefined) : undefined;
        const inPlace = !!handle;
        handle ??= await this.win.showSaveFilePicker!({ suggestedName: name, types: pickerTypes(app) });
        const w = await handle.createWritable();
        await w.write(bytes);
        await w.close();
        return { target: { kind: 'device', name: handle.name, handle }, name: handle.name, inPlace };
      }
      // Safari / Firefox / phones: a download of a copy (the person picks where in their own browser).
      downloadBytes(name, bytes, mimeForName(name), this.doc ?? undefined);
      return { target: { kind: 'device', name }, name, inPlace: false };
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
  }

  /** A file chooser opened by our own button (the browsers without a picker API). */
  private chooseFile(app: FilesApp): Promise<File | null> { return this.chooseFileOf(app.exts); }
  private chooseFileOf(exts: readonly string[]): Promise<File | null> {
    const d = this.doc;
    if (!d) return Promise.resolve(null);
    return new Promise(resolve => {
      const input = d.createElement('input');
      input.type = 'file';
      input.accept = exts.map(e => `.${e}`).join(',');
      input.style.display = 'none';
      let done = false;
      const finish = (f: File | null) => { if (done) return; done = true; input.remove(); resolve(f); };
      input.addEventListener('change', () => finish(input.files?.[0] ?? null));
      input.addEventListener('cancel', () => finish(null));
      d.body.appendChild(input);
      input.click();
    });
  }

  /** The name a device file gets when saved from a lab file (`Name.ext` with the app's extension). */
  static nameFor(app: FilesApp, name: string): string {
    return extOf(name) && app.exts.includes(extOf(name)) ? name : `${name.replace(/\.[A-Za-z0-9]{1,8}$/, '')}.${app.exts[0]}`;
  }
}

function toBuffer(b: Uint8Array | ArrayBuffer): ArrayBuffer {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  return u.slice().buffer as ArrayBuffer;
}
