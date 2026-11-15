import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { FilesDeviceService, DeviceFileError, checkDeviceFile } from './files-device.service';
import { FILES_APPS, MAX_DEVICE_BYTES } from './files-registry';

const [NEURON, SYNAPSE, , MYELIN, RETINA] = FILES_APPS;
const PK = new Uint8Array([0x50, 0x4b, 3, 4, 1]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 49]);
const file = (name: string, bytes: Uint8Array) => ({ name, size: bytes.length, arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer });
function make(win: Record<string, unknown>) {
  const svc = TestBed.inject(FilesDeviceService);
  svc.win = win as never;
  return svc;
}
const abort = () => Object.assign(new Error('x'), { name: 'AbortError' });

describe('checkDeviceFile', () => {
  it('extension allowlist per app, empty and oversize refused with plain words', () => {
    expect(checkDeviceFile(NEURON, 'a.xlsx', 5)).toBeNull();
    expect(checkDeviceFile(RETINA, 'a.JPEG', 5)).toBeNull();
    expect(checkDeviceFile(NEURON, 'a.docx', 5)).toBe('Only .xlsx files can be used with Neuron.');
    expect(checkDeviceFile(MYELIN, 'a.exe', 5)).toContain('Only .pdf');
    expect(checkDeviceFile(NEURON, 'a.xlsx', 0)).toBe('That file is empty.');
    expect(checkDeviceFile(NEURON, 'a.xlsx', MAX_DEVICE_BYTES + 1)).toBe('That file is too large (the limit is 25 MB).');
  });
});

describe('FilesDeviceService: one abstraction over three kinds of client', () => {
  it('picks the mode: desktop app, File System Access browser, or the fallback (Safari, Firefox, phones)', () => {
    expect(make({ electronAPI: { files: {} } }).mode()).toBe('electron');
    TestBed.resetTestingModule();
    expect(make({ showOpenFilePicker: () => 0, showSaveFilePicker: () => 0 }).mode()).toBe('fsa');
    TestBed.resetTestingModule();
    expect(make({}).mode()).toBe('fallback');
    TestBed.resetTestingModule();
    expect(make({ Capacitor: { getPlatform: () => 'ios' } }).client()).toBe('ios');
    TestBed.resetTestingModule();
    expect(make({ electronAPI: { files: {} } }).client()).toBe('electron');
  });

  it('Chromium: open returns a handle target; save goes back to the SAME handle in place, Save As asks the picker', async () => {
    const written: Uint8Array[] = [];
    const handle = { name: 'Letter.docx', getFile: async () => file('Letter.docx', PK), createWritable: async () => ({ write: async (b: BufferSource) => { written.push(new Uint8Array(b as ArrayBuffer)); }, close: async () => undefined }) };
    const picker = vi.fn(async () => [handle]);
    const savePicker = vi.fn(async () => ({ ...handle, name: 'Copy.docx' }));
    const svc = make({ showOpenFilePicker: picker, showSaveFilePicker: savePicker });
    const o = await svc.open(SYNAPSE);
    expect(o!.name).toBe('Letter.docx');
    expect(o!.target).toMatchObject({ kind: 'device', handle });
    expect(svc.canSaveInPlace(o!.target)).toBe(true);
    const inPlace = await svc.save(SYNAPSE, 'Letter.docx', PK.slice().buffer as ArrayBuffer, o!.target);
    expect(inPlace).toMatchObject({ inPlace: true, name: 'Letter.docx' });
    expect(savePicker).not.toHaveBeenCalled();
    expect(written).toHaveLength(1);
    const as = await svc.save(SYNAPSE, 'Letter.docx', PK.slice().buffer as ArrayBuffer, o!.target, true);
    expect(as).toMatchObject({ inPlace: false, name: 'Copy.docx' });
    expect(savePicker).toHaveBeenCalledTimes(1);
  });

  it('a cancelled picker is null, not an error', async () => {
    const svc = make({ showOpenFilePicker: async () => { throw abort(); }, showSaveFilePicker: async () => { throw abort(); } });
    expect(await svc.open(NEURON)).toBeNull();
    expect(await svc.save(NEURON, 'a.xlsx', PK.slice().buffer as ArrayBuffer, null)).toBeNull();
  });

  it('refuses the wrong extension, empty and oversize on open AND save, and bytes that lie about their type', async () => {
    const svc = make({ showOpenFilePicker: async () => [{ name: 'a.exe', getFile: async () => file('a.exe', PK) }], showSaveFilePicker: async () => { throw new Error('should not be asked'); } });
    await expect(svc.open(NEURON)).rejects.toThrow('Only .xlsx files');
    await expect(svc.save(NEURON, 'a.exe', PK.slice().buffer as ArrayBuffer)).rejects.toBeInstanceOf(DeviceFileError);
    await expect(svc.save(NEURON, 'a.xlsx', new ArrayBuffer(0))).rejects.toThrow('empty');
    await expect(svc.save(NEURON, 'a.xlsx', new ArrayBuffer(MAX_DEVICE_BYTES + 1))).rejects.toThrow('too large');
    TestBed.resetTestingModule();
    const liar = make({ showOpenFilePicker: async () => [{ name: 'Report.pdf', getFile: async () => file('Report.pdf', new Uint8Array([104, 105, 33, 33, 33])) }], showSaveFilePicker: async () => ({}) });
    await expect(liar.open(MYELIN)).rejects.toThrow("isn't a PDF Myelin can open");
  });

  it('the desktop app: open gives a token, save goes in place by token, a refusal from main comes back in its words', async () => {
    const openLocal = vi.fn(async () => ({ token: 'tok', name: 'Scan.pdf', bytes: PDF }));
    const saveLocal = vi.fn(async (p: { token?: string }) => ({ token: p.token ?? 'new', name: 'Scan.pdf' }));
    const svc = make({ electronAPI: { files: { openLocal, saveLocal } } });
    const o = await svc.open(MYELIN);
    expect(openLocal).toHaveBeenCalledWith('pdf');
    expect(o!.target).toMatchObject({ kind: 'device', token: 'tok' });
    const s = await svc.save(MYELIN, 'Scan.pdf', PDF.slice().buffer as ArrayBuffer, o!.target);
    expect(s).toMatchObject({ inPlace: true });
    expect(saveLocal).toHaveBeenLastCalledWith(expect.objectContaining({ token: 'tok', kind: 'pdf', name: 'Scan.pdf' }));
    const as = await svc.save(MYELIN, 'Scan.pdf', PDF.slice().buffer as ArrayBuffer, o!.target, true);
    expect(as!.inPlace).toBe(false);
    expect(saveLocal).toHaveBeenLastCalledWith(expect.objectContaining({ token: undefined }));
    openLocal.mockResolvedValueOnce({ error: 'Only .pdf files can be used here.' } as never);
    await expect(svc.open(MYELIN)).rejects.toThrow('Only .pdf files can be used here.');
    openLocal.mockResolvedValueOnce(null as never);
    expect(await svc.open(MYELIN)).toBeNull();
  });

  it('Safari / Firefox / phones: open uses a file chooser from our own button, save is a download of a copy', async () => {
    const svc = make({});
    const input = { type: '', accept: '', style: {} as Record<string, string>, files: [file('Log.xlsx', PK)], addEventListener: (ev: string, fn: () => void) => { if (ev === 'change') setTimeout(fn, 0); }, click: vi.fn(), remove: vi.fn() };
    const created: unknown[] = [];
    svc.doc = { createElement: (t: string) => { const el = t === 'input' ? input : { href: '', download: '', rel: '', style: {}, click: vi.fn(), remove: vi.fn() }; created.push(el); return el; }, body: { appendChild: vi.fn() } } as unknown as Document;
    const o = await svc.open(NEURON);
    expect(input.accept).toBe('.xlsx');
    expect(o!.name).toBe('Log.xlsx');
    expect(svc.canSaveInPlace(o!.target)).toBe(false);
    URL.createObjectURL = vi.fn(() => 'blob:x') as never;
    const s = await svc.save(NEURON, 'Log.xlsx', PK.slice().buffer as ArrayBuffer, o!.target);
    expect(s).toMatchObject({ inPlace: false, name: 'Log.xlsx' });
    const anchor = created[created.length - 1] as { download: string; click: ReturnType<typeof vi.fn> };
    expect(anchor.download).toBe('Log.xlsx');
    expect(anchor.click).toHaveBeenCalled();
  });

  it('nameFor gives a lab file its app extension', () => {
    expect(FilesDeviceService.nameFor(SYNAPSE, 'Letter')).toBe('Letter.docx');
    expect(FilesDeviceService.nameFor(SYNAPSE, 'Letter.docx')).toBe('Letter.docx');
    expect(FilesDeviceService.nameFor(RETINA, 'Wound.jpg')).toBe('Wound.jpg');
  });
});
