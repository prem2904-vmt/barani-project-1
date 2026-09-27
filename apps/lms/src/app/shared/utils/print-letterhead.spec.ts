import { of } from 'rxjs';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { buildReportPdf, type ReportPdfInput } from './report-pdf';
import { askPrintLetterhead, PRINT_CHOICE_LETTERHEAD, PRINT_CHOICE_PLAIN } from './print-letterhead';
import { buildReportBlobUrl, buildReportPrintBlobUrl } from './report-blob';
import { ReportLayoutService } from '../../core/services/report-layout.service';
import { PlatformService } from '../../core/services/platform.service';
import { DialogService } from '../../core/services/dialog.service';
import { ReportQueueComponent } from '../../features/reports/report-queue/report-queue.component';
import { ReportViewerComponent } from '../../features/reports/report-viewer/report-viewer.component';
import { PublicReportComponent } from '../../features/reports/public-report/public-report.component';

/**
 * Pre-printed letterpad (owner's rule, 2026-09-27): DIGITAL outputs always
 * carry the lab's header & footer; only PRINTING asks — letterhead paper
 * (header & footer blank) vs plain paper — and only when the setting is on.
 * Every assertion reads the rendered PDF's text back.
 */
const LAB = 'Zephyrine Diagnostics';
const snapshot = {
  patient: { displayName: 'Test Patient', age: 40, sex: 'M' },
  order: { id: 'o1', orderNumber: 'LAB-2609-000001', createdAt: '2026-09-27T00:00:00Z' },
  type: 'final',
  tests: [{ testId: 'hb', name: 'Haemoglobin', result: { values: { hb: 13.2 } } }],
};
const report = { id: 'r1', type: 'final', createdAt: '2026-09-27T00:00:00Z', data: JSON.stringify(snapshot), qrToken: 'qr1' } as any;
const tplOn = { labName: LAB, letterpadMode: true, letterpadHeaderMm: 45, letterpadFooterMm: 30 } as any;
const tplOff = { labName: LAB, letterpadMode: false } as any;

const readBlob = (b: Blob) => new Promise<ArrayBuffer>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result as ArrayBuffer);
  r.onerror = () => rej(r.error);
  r.readAsArrayBuffer(b);
});
const pdfText = async (b: Blob | ArrayBuffer) =>
  Buffer.from(b instanceof ArrayBuffer ? b : await readBlob(b)).toString('latin1');
/** Header = the lab's name in the letterhead; footer = the bottom strip. */
function hasHeader(t: string) { return t.includes('(ZEPHYRINE)'); }   // wordmark prints word by word
function hasFooter(t: string) { return t.includes('Generated on'); }

function dialogPicking(value: string | null) {
  return { choose: vi.fn(async () => value) };
}

// ── The renderer ────────────────────────────────────────────────────────────
describe('buildReportPdf — blankLetterhead is a per-render option, not the template flag', () => {
  const input = (template: unknown): ReportPdfInput =>
    ({ report, template, resolvedLayouts: {} }) as never;

  it('letterpad setting ON alone still renders the header & footer (every digital output)', async () => {
    const t = await pdfText(buildReportPdf(input(tplOn)).output('arraybuffer'));
    expect(hasHeader(t)).toBe(true);
    expect(hasFooter(t)).toBe(true);
  });

  it('blankLetterhead: true leaves the header & footer blank, the body still prints', async () => {
    const t = await pdfText(buildReportPdf({ ...input(tplOn), blankLetterhead: true }).output('arraybuffer'));
    expect(hasHeader(t)).toBe(false);
    expect(hasFooter(t)).toBe(false);
    expect(t).toContain('(Test Patient)');   // the body still prints
  });

  it('module state resets: a header render after a blank one has the header again', async () => {
    buildReportPdf({ ...input(tplOn), blankLetterhead: true });
    const t = await pdfText(buildReportPdf(input(tplOn)).output('arraybuffer'));
    expect(hasHeader(t)).toBe(true);
  });
});

// ── The question ────────────────────────────────────────────────────────────
describe('askPrintLetterhead', () => {
  it('setting OFF → no prompt, prints with the header', async () => {
    const d = dialogPicking(PRINT_CHOICE_LETTERHEAD);
    expect(await askPrintLetterhead(tplOff, d)).toEqual({ blankLetterhead: false });
    expect(await askPrintLetterhead(null, d)).toEqual({ blankLetterhead: false });
    expect(d.choose).not.toHaveBeenCalled();
  });

  it('setting ON → asks once, letterhead paper pre-selected', async () => {
    const d = dialogPicking(PRINT_CHOICE_LETTERHEAD);
    expect(await askPrintLetterhead(tplOn, d)).toEqual({ blankLetterhead: true });
    expect(d.choose).toHaveBeenCalledTimes(1);
    const req = (d.choose.mock.calls[0] as unknown[])[0] as { initialChoice: string; choices: Array<{ value: string }> };
    expect(req.initialChoice).toBe(PRINT_CHOICE_LETTERHEAD);
    expect(req.choices.map(c => c.value)).toEqual([PRINT_CHOICE_LETTERHEAD, PRINT_CHOICE_PLAIN]);
  });

  it('plain paper → with header; dismissed → null (print nothing)', async () => {
    expect(await askPrintLetterhead(tplOn, dialogPicking(PRINT_CHOICE_PLAIN))).toEqual({ blankLetterhead: false });
    expect(await askPrintLetterhead(tplOn, dialogPicking(null))).toBeNull();
  });

  it('DialogService.choose resolves the picked value, null on dismiss', async () => {
    const svc = new DialogService();
    const p = svc.choose({ title: 't', choices: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] });
    expect(svc.active()?.kind).toBe('choice');
    expect(svc.active()?.initialChoice).toBe('a');
    svc.resolve('b');
    expect(await p).toBe('b');
    const q = svc.choose({ title: 't', choices: [{ value: 'a', label: 'A' }] });
    svc.resolve(false);
    expect(await q).toBeNull();
  });
});

// ── Entry points ────────────────────────────────────────────────────────────
function injectorFor(dialog?: unknown) {
  const svc = { preview: vi.fn(async (testId: string) => ({ testId, sections: [], columns: [] })) };
  const platform = { getApiUrl: () => '' };
  return {
    get: (token: unknown) =>
      token === ReportLayoutService ? svc : token === PlatformService ? platform : token === DialogService ? dialog : null,
  };
}
function apiWith(template: unknown) {
  const posted: Blob[] = [];
  const api = {
    get: vi.fn((path: string) => of(path.includes('report-template') ? template : null)),
    post: vi.fn((_path: string, body: unknown) => {
      if (body instanceof FormData) posted.push(body.get('file') as Blob);
      return of(null);
    }),
  };
  return { api, posted };
}

/** Capture every PDF blob the code under test hands to URL.createObjectURL. */
function captureBlobs() {
  const blobs: Blob[] = [];
  const orig = URL.createObjectURL;
  URL.createObjectURL = ((b: Blob) => { blobs.push(b); return `blob:test/${blobs.length}`; }) as never;
  const origRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = (() => undefined) as never;
  return { blobs, restore: () => { URL.createObjectURL = orig; URL.revokeObjectURL = origRevoke; } };
}

describe('print entry points', () => {
  let cap: ReturnType<typeof captureBlobs>;
  beforeEach(() => { cap = captureBlobs(); });
  afterEach(() => { cap.restore(); document.querySelectorAll('iframe').forEach(f => f.remove()); });

  function queue(template: unknown, dialog: unknown) {
    const c = Object.create(ReportQueueComponent.prototype) as any;
    const { api, posted } = apiWith(template);
    c.injector = injectorFor(); c.api = api; c.dialog = dialog;
    c.toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
    c.refresh = vi.fn();
    return { c, api, posted };
  }

  it('queue Print, setting ON + letterhead paper → header-less PDF, delivery recorded', async () => {
    const d = dialogPicking(PRINT_CHOICE_LETTERHEAD);
    const { c, api } = queue(tplOn, d);
    await c.printReport(report);
    expect(d.choose).toHaveBeenCalledTimes(1);
    const t = await pdfText(cap.blobs.at(-1)!);
    expect(hasHeader(t)).toBe(false);
    expect(hasFooter(t)).toBe(false);
    expect(api.post).toHaveBeenCalledWith('/api/reports/r1/deliver', expect.objectContaining({ via: 'print' }));
  });

  it('queue Print, setting ON + plain paper → full header & footer', async () => {
    const { c } = queue(tplOn, dialogPicking(PRINT_CHOICE_PLAIN));
    await c.printReport(report);
    const t = await pdfText(cap.blobs.at(-1)!);
    expect(hasHeader(t)).toBe(true);
    expect(hasFooter(t)).toBe(true);
  });

  it('queue Print, dismissed → nothing printed, no delivery recorded', async () => {
    const { c, api } = queue(tplOn, dialogPicking(null));
    await c.printReport(report);
    expect(cap.blobs.length).toBe(0);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('queue Print, setting OFF → no prompt, full header', async () => {
    const d = dialogPicking(PRINT_CHOICE_LETTERHEAD);
    const { c } = queue(tplOff, d);
    await c.printReport(report);
    expect(d.choose).not.toHaveBeenCalled();
    expect(hasHeader(await pdfText(cap.blobs.at(-1)!))).toBe(true);
  });

  function viewer(template: unknown, dialog: unknown) {
    const c = Object.create(ReportViewerComponent.prototype) as any;
    const { api, posted } = apiWith(template);
    Object.defineProperty(c, 'injector', { value: injectorFor(dialog) });
    Object.defineProperty(c, 'api', { value: api });
    Object.defineProperty(c, 'toasts', { value: { success: vi.fn(), error: vi.fn(), info: vi.fn() } });
    Object.defineProperty(c, '_report', { value: signal(report) });
    Object.defineProperty(c, 'busy', { value: signal(null) });
    c.flash = vi.fn();
    c._pdfBlob = null; c._pdfInput = null;
    return { c, posted };
  }

  it('report viewer Print, setting ON → asks; each choice renders with / without the header', async () => {
    const d1 = dialogPicking(PRINT_CHOICE_LETTERHEAD);
    await viewer(tplOn, d1).c.print();
    expect(d1.choose).toHaveBeenCalledTimes(1);
    expect(hasHeader(await pdfText(cap.blobs.at(-1)!))).toBe(false);

    const d2 = dialogPicking(PRINT_CHOICE_PLAIN);
    await viewer(tplOn, d2).c.print();
    expect(hasHeader(await pdfText(cap.blobs.at(-1)!))).toBe(true);
  });

  it('report viewer Print, setting OFF → no prompt, full header', async () => {
    const d = dialogPicking(PRINT_CHOICE_LETTERHEAD);
    await viewer(tplOff, d).c.print();
    expect(d.choose).not.toHaveBeenCalled();
    expect(hasHeader(await pdfText(cap.blobs.at(-1)!))).toBe(true);
  });

  it('report viewer: a letterhead print never poisons the cached on-screen / archive PDF', async () => {
    const { c, posted } = viewer(tplOn, dialogPicking(PRINT_CHOICE_LETTERHEAD));
    await c.print();
    await c.archiveReportPdf(report);
    expect(hasHeader(await pdfText(posted[0]))).toBe(true);
  });

  it('My Work print (report blob print variant): asks when ON, header-less on letterhead paper', async () => {
    const { api } = apiWith(tplOn);
    const d = dialogPicking(PRINT_CHOICE_LETTERHEAD);
    const url = await buildReportPrintBlobUrl(report, api, injectorFor() as never, d);
    expect(url).toMatch(/^blob:/);
    expect(d.choose).toHaveBeenCalledTimes(1);
    expect(hasHeader(await pdfText(cap.blobs.at(-1)!))).toBe(false);
    expect(await buildReportPrintBlobUrl(report, api, injectorFor() as never, dialogPicking(null))).toBeNull();
  });

  it('My Work print, setting OFF → no prompt, full header', async () => {
    const { api } = apiWith(tplOff);
    const d = dialogPicking(PRINT_CHOICE_LETTERHEAD);
    await buildReportPrintBlobUrl(report, api, injectorFor() as never, d);
    expect(d.choose).not.toHaveBeenCalled();
    expect(hasHeader(await pdfText(cap.blobs.at(-1)!))).toBe(true);
  });
});

describe('digital outputs always carry the header & footer (setting ON)', () => {
  let cap: ReturnType<typeof captureBlobs>;
  beforeEach(() => { cap = captureBlobs(); });
  afterEach(() => cap.restore());

  it('queue WhatsApp → archived PDF (StoredPdfKey / public QR copy) has the header', async () => {
    const c = Object.create(ReportQueueComponent.prototype) as any;
    const { api, posted } = apiWith(tplOn);
    c.injector = injectorFor(); c.api = api; c.dialog = dialogPicking(PRINT_CHOICE_LETTERHEAD);
    c.auth = { user: () => ({ tenantName: LAB }) };
    c.canDeliver = () => true; c.toasts = { success: vi.fn(), error: vi.fn() }; c.refresh = vi.fn();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    c.deliver(report, 'whatsapp');
    await vi.waitFor(() => expect(posted.length).toBe(1));
    open.mockRestore();
    const t = await pdfText(posted[0]);
    expect(hasHeader(t)).toBe(true);
    expect(hasFooter(t)).toBe(true);
    expect(c.dialog.choose).not.toHaveBeenCalled();
  });

  it('queue Download → the downloaded (native share sheet) + archived PDF have the header', async () => {
    const c = Object.create(ReportQueueComponent.prototype) as any;
    const { api, posted } = apiWith(tplOn);
    c.injector = injectorFor(); c.api = api; c.toasts = { error: vi.fn() };
    // Native shell path: the "download" is the share sheet — capture its file.
    const w = window as unknown as { Capacitor?: unknown };
    const nav = navigator as unknown as { canShare?: unknown; share?: unknown };
    const prev = { cap: w.Capacitor, canShare: nav.canShare, share: nav.share };
    const shared: File[] = [];
    w.Capacitor = { isNativePlatform: () => true };
    nav.canShare = () => true;
    nav.share = async (d: { files: File[] }) => { shared.push(...d.files); };
    try { await c.downloadPdf(report); }
    finally { w.Capacitor = prev.cap; nav.canShare = prev.canShare; nav.share = prev.share; }
    expect(c.toasts.error).not.toHaveBeenCalled();
    expect(shared.length).toBe(1);
    expect(hasHeader(await pdfText(shared[0]))).toBe(true);
    expect(posted.length).toBe(1);
    expect(hasHeader(await pdfText(posted[0]))).toBe(true);
  });

  it('share / preview (lab orders, timeline) render has the header', async () => {
    const { api } = apiWith(tplOn);
    const url = await buildReportBlobUrl(report, api, injectorFor() as never);
    expect(url).toMatch(/^blob:/);
    expect(hasHeader(await pdfText(cap.blobs.at(-1)!))).toBe(true);
  });

  it('public patient link (client render when not archived) has the header', async () => {
    const c = Object.create(PublicReportComponent.prototype) as any;
    Object.defineProperty(c, 'rawPdfUrl', { value: signal('') });
    Object.defineProperty(c, 'pdfUrl', { value: signal(null) });
    Object.defineProperty(c, 'error', { value: signal(null) });
    Object.defineProperty(c, 'sanitizer', { value: { bypassSecurityTrustResourceUrl: (u: string) => u } });
    await c.renderFromSnapshot({ report, template: tplOn, assetUrls: {} });
    expect(c.error()).toBeNull();
    const t = await pdfText(cap.blobs.at(-1)!);
    expect(hasHeader(t)).toBe(true);
    expect(hasFooter(t)).toBe(true);
  });
});

// ── The dialog itself (DialogService, not native) ───────────────────────────
describe('print choice dialog (pf-dialog-host)', () => {
  it('renders both papers, letterhead pre-selected; picking plain + Print resolves "plain"', async () => {
    const { TestBed } = await import('@angular/core/testing');
    const { DialogHostComponent } = await import('../components/dialog-host/dialog-host.component');
    TestBed.configureTestingModule({ imports: [DialogHostComponent] });
    const fx = TestBed.createComponent(DialogHostComponent);
    const svc = TestBed.inject(DialogService);
    const pending = askPrintLetterhead(tplOn, svc);
    fx.detectChanges();
    const el = fx.nativeElement as HTMLElement;
    const cards = Array.from(el.querySelectorAll<HTMLButtonElement>('.pf-dh-choice'));
    expect(cards.map(c => c.dataset['choice'])).toEqual([PRINT_CHOICE_LETTERHEAD, PRINT_CHOICE_PLAIN]);
    expect(cards[0].getAttribute('aria-checked')).toBe('true');
    expect(el.textContent).toContain('Letterhead paper');
    expect(el.textContent).toContain('Plain paper');
    cards[1].click();
    fx.detectChanges();
    expect(cards[1].getAttribute('aria-checked')).toBe('true');
    fx.componentInstance.onConfirm();
    expect(await pending).toEqual({ blankLetterhead: false });
  });

  it('Cancel / Esc → null (nothing prints)', async () => {
    const { TestBed } = await import('@angular/core/testing');
    const { DialogHostComponent } = await import('../components/dialog-host/dialog-host.component');
    TestBed.configureTestingModule({ imports: [DialogHostComponent] });
    const fx = TestBed.createComponent(DialogHostComponent);
    const pending = askPrintLetterhead(tplOn, TestBed.inject(DialogService));
    fx.detectChanges();
    fx.componentInstance.onEscape();
    expect(await pending).toBeNull();
  });
});
