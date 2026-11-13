import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { DialogService } from './dialog.service';
import { ToastService } from './toast.service';
import { WhatsAppService } from './whatsapp.service';
import { ElectronWhatsAppBridge, WA_CONSENT_REMINDER, WA_PDF_HINT, WA_PDF_HINT_KEY, WA_REMINDER_KEY, WhatsAppManualService } from './whatsapp-manual.service';

/** "WhatsApp Chat" (manual): one click → WhatsApp opens with the chat and
 *  message ready; the person presses Send. Desktop app = the docked panel,
 *  browser = a NEW TAB (owner 2026-11-13; was a popup window), phone = wa.me. */
const SCREEN = { availWidth: 1440, availHeight: 875, availLeft: 0, availTop: 25 } as unknown as Screen;
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36';

function setup(o: {
  confirm?: boolean; optOut?: boolean | 'error'; ua?: string; popup?: 'ok' | 'blocked'; bridge?: ElectronWhatsAppBridge | null; nav?: Record<string, unknown>;
  doctor?: { name?: string | null; phone?: string | null } | null; pick?: string | null;
} = {}) {
  const dialog = {
    confirm: vi.fn(async () => o.confirm ?? true), alert: vi.fn(async () => undefined),
    actions: vi.fn(async () => ({ action: o.pick === undefined ? 'patient' : o.pick, checked: false })),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  const wa = {
    reportStatus: vi.fn(() => o.optOut === 'error' ? throwError(() => new Error('403')) : of({ patientOptOut: !!o.optOut, referralDoctor: o.doctor ?? null })),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: DialogService, useValue: dialog },
      { provide: ToastService, useValue: toasts },
      { provide: WhatsAppService, useValue: wa },
    ],
  });
  const svc = TestBed.inject(WhatsAppManualService);
  const pop = { opener: {} as unknown, focus: vi.fn(), closed: false, close: vi.fn(), location: { replace: vi.fn() }, document: { title: '', body: { textContent: '', style: { cssText: '' } } } };
  const open = vi.fn(() => (o.popup === 'blocked' ? null : pop));
  svc.win = { open, screen: SCREEN, navigator: { userAgent: o.ua ?? DESKTOP_UA, ...(o.nav ?? {}) } } as never;
  svc.bridge = () => o.bridge ?? null;
  return { svc, dialog, toasts, wa, open, pop };
}
afterEach(() => TestBed.resetTestingModule());

const REQ = { phone: '98765 43210', patientName: 'Asha Rao', labName: 'Micro World', link: 'https://med.prefrontal.health/reports/public/t1', reportId: 'r1' };
const TEXT = 'Dear Asha Rao, your report from Micro World is ready. View it here: https://med.prefrontal.health/reports/public/t1';
const URL_ = `https://web.whatsapp.com/send?phone=919876543210&text=${encodeURIComponent(TEXT)}`;

describe('WhatsAppManualService — one click', () => {
  beforeEach(() => localStorage.removeItem(WA_REMINDER_KEY));

  it('opens straight away: no confirm, never window.confirm', async () => {
    const { svc, dialog, open } = setup();
    const native = vi.spyOn(window, 'confirm');
    expect(await svc.send(REQ)).toBe('opened');
    expect(dialog.confirm).not.toHaveBeenCalled();
    expect(native).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
    native.mockRestore();
  });

  it('the consent reminder shows once per device, then never again', async () => {
    const first = setup();
    await first.svc.send(REQ);
    expect(first.toasts.info).toHaveBeenCalledWith(WA_CONSENT_REMINDER);
    TestBed.resetTestingModule();
    const second = setup();
    await second.svc.send(REQ);
    expect(second.toasts.info).not.toHaveBeenCalled();
  });

  it('a patient who opted out: the one warning, still allowed', async () => {
    const { svc, dialog, open } = setup({ optOut: true });
    expect(await svc.send(REQ)).toBe('opened');
    expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'This patient opted out of WhatsApp', confirmLabel: 'Send anyway', tone: 'danger', items: [TEXT],
    }));
    expect(open).toHaveBeenCalled();
  });

  it('opted out + Cancel opens nothing', async () => {
    const { svc, open } = setup({ optOut: true, confirm: false });
    expect(await svc.send(REQ)).toBe('cancelled');
    expect(open).not.toHaveBeenCalled();
  });

  it('the opt-out read failing never blocks the send (and asks nothing)', async () => {
    const { svc, dialog } = setup({ optOut: 'error' });
    expect(await svc.send(REQ)).toBe('opened');
    expect(dialog.confirm).not.toHaveBeenCalled();
  });

  it('no valid mobile: a plain message, nothing opens', async () => {
    for (const phone of [null, '', '12345', '+1 555 123 4567']) {
      const { svc, dialog, open } = setup();
      expect(await svc.send({ ...REQ, phone })).toBe('no-phone');
      expect(dialog.alert).toHaveBeenCalledWith(expect.objectContaining({ title: 'No mobile number' }));
      expect(open).not.toHaveBeenCalled();
      TestBed.resetTestingModule();
    }
  });
});

describe('WhatsAppManualService — web browser: a new tab', () => {
  it('opens the chat in a NEW TAB (no popup/window features); focused', async () => {
    const { svc, open, pop } = setup();
    expect(await svc.send(REQ)).toBe('opened');
    expect(open).toHaveBeenCalledWith(URL_, 'pf-whatsapp');
    expect((open.mock.calls[0] as unknown[]).length).toBe(2);   // no "popup=yes,width=…" → the browser makes a tab
    expect(pop.focus).toHaveBeenCalled();
  });

  it('a repeat click reuses the same named tab', async () => {
    const { svc, open } = setup();
    await svc.send(REQ);
    await svc.send({ ...REQ, phone: '9812345678' });
    expect(open).toHaveBeenCalledTimes(2);
    expect(open.mock.calls.map(c => (c as unknown[])[1])).toEqual(['pf-whatsapp', 'pf-whatsapp']);
    expect((open.mock.calls[1] as unknown[])[0]).toContain('phone=919812345678');
  });

  it('a reused window (WhatsApp page, cross-origin) does not break', async () => {
    const { svc, open } = setup();
    const crossOrigin = { focus: vi.fn() };
    Object.defineProperty(crossOrigin, 'opener', { get: () => null, set: () => { throw new DOMException('cross-origin', 'SecurityError'); } });
    open.mockReturnValue(crossOrigin as never);
    expect(await svc.send(REQ)).toBe('opened');
    expect(crossOrigin.focus).toHaveBeenCalled();
  });

  it('blocked: says so plainly (the WhatsApp tab)', async () => {
    const { svc, toasts } = setup({ popup: 'blocked' });
    expect(await svc.send(REQ)).toBe('blocked');
    expect(toasts.error).toHaveBeenCalledWith(expect.stringContaining('blocked the WhatsApp tab'));
    expect(toasts.error).toHaveBeenCalledWith(expect.stringContaining('Allow pop-ups'));
  });

  it('only the click-to-chat link is ever opened (nothing else, no file)', async () => {
    const { svc, open } = setup();
    await svc.send({ ...REQ, pdf: async () => new Blob(['%PDF-1.4']) });
    expect(open).toHaveBeenCalledTimes(1);
    expect(new URL((open.mock.calls[0] as unknown[])[0] as string).origin).toBe('https://web.whatsapp.com');
  });
});

describe('WhatsAppManualService — phones', () => {
  it('a phone browser / the app opens wa.me (hands over to WhatsApp)', async () => {
    const { svc, open } = setup({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' });
    expect(await svc.send(REQ)).toBe('opened');
    expect(open).toHaveBeenCalledWith(`https://wa.me/919876543210?text=${encodeURIComponent(TEXT)}`, '_blank', 'noopener');
  });
});

describe('WhatsAppManualService — desktop app (docked panel)', () => {
  function bridge(ok = true) {
    return {
      open: vi.fn(async () => ({ ok })), close: vi.fn(), signOut: vi.fn(), state: vi.fn(), onState: vi.fn(),
      openElsewhere: vi.fn(), setPdf: vi.fn(async () => ({ ok: true })), startDrag: vi.fn(),
    } as unknown as ElectronWhatsAppBridge & { open: ReturnType<typeof vi.fn>; setPdf: ReturnType<typeof vi.fn> };
  }

  it('asks main to dock the click-to-chat link; no browser window', async () => {
    const b = bridge();
    const { svc, open } = setup({ bridge: b });
    expect(await svc.send(REQ)).toBe('opened');
    expect(b.open).toHaveBeenCalledWith(URL_);
    expect(open).not.toHaveBeenCalled();
  });

  it('hands the PDF to main for OUR clipboard (the person pastes it) + drag; nothing is attached for them', async () => {
    const b = bridge();
    const { svc } = setup({ bridge: b });
    await svc.send({ ...REQ, pdf: async () => new Blob(['%PDF-1.4 x'], { type: 'application/pdf' }), pdfName: 'report-AB.pdf' });
    await vi.waitFor(() => expect(b.setPdf).toHaveBeenCalled());
    const arg = (b.setPdf.mock.calls[0] as unknown as [{ name: string; bytes: Uint8Array }])[0];
    expect(arg.name).toBe('report-AB.pdf');
    expect(arg.bytes.length).toBe(10);
    expect((arg as unknown as { copyToClipboard: boolean }).copyToClipboard).toBe(true);
    // the message is drafted by the click-to-chat link itself; nothing else is sent to main for WhatsApp
    expect(Object.keys(arg).sort()).toEqual(['bytes', 'copyToClipboard', 'name']);
    expect(b.open).toHaveBeenCalledWith(URL_);
  });

  it('desktop one-click success is silent: no toast at all, not even the first-send reminder', async () => {
    const { svc, toasts } = setup({ bridge: bridge() });
    localStorage.removeItem(WA_REMINDER_KEY);
    expect(await svc.send({ ...REQ, pdf: async () => new Blob(['%PDF-1.4 x']) })).toBe('opened');
    expect(toasts.info).not.toHaveBeenCalled();
    expect(toasts.success).not.toHaveBeenCalled();
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it('main refusing → an error toast', async () => {
    const { svc, toasts } = setup({ bridge: bridge(false) });
    expect(await svc.send(REQ)).toBe('blocked');
    expect(toasts.error).toHaveBeenCalled();
  });
});


describe('WhatsAppManualService — seamless: no card, PDF with the message', () => {
  const PDF = () => new Blob(['%PDF-1.4 x'], { type: 'application/pdf' });
  const CAN_SHARE = () => ({ share: vi.fn(async () => undefined), canShare: vi.fn(() => true) });
  const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0)); };
  const stubDownloads = () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    return names;
  };
  beforeEach(() => { localStorage.removeItem(WA_PDF_HINT_KEY); localStorage.removeItem(WA_REMINDER_KEY); });
  afterEach(() => vi.restoreAllMocks());

  it('desktop browser: the chat popup opens with the text AND the PDF downloads at once; no card', async () => {
    const names = stubDownloads();
    const { svc, open, toasts } = setup();
    expect(await svc.send({ ...REQ, pdf: async () => PDF(), pdfName: 'report-AB.pdf' })).toBe('opened');
    await flush();
    expect(open).toHaveBeenCalledTimes(1);
    expect(names).toEqual(['report-AB.pdf']);
    expect((svc as unknown as Record<string, unknown>)['pdfCard']).toBeUndefined();
    // the very first time: ONE hint (and not the consent reminder on top of it)
    expect(toasts.info).toHaveBeenCalledTimes(1);
    expect(toasts.info).toHaveBeenCalledWith(WA_PDF_HINT);
  });

  it('the hint never shows again on this device; a blocked localStorage just means no hint', async () => {
    stubDownloads();
    const first = setup();
    await first.svc.send({ ...REQ, pdf: async () => PDF() });
    await flush();
    TestBed.resetTestingModule();
    const second = setup();
    await second.svc.send({ ...REQ, pdf: async () => PDF() });
    await flush();
    expect(second.toasts.info).not.toHaveBeenCalled();
    TestBed.resetTestingModule();
    localStorage.removeItem(WA_PDF_HINT_KEY);
    // Storage blocked (private window / site data off): every access throws.
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => {} });
    const third = setup();
    await third.svc.send({ ...REQ, pdf: async () => PDF() });
    await flush();
    expect(third.toasts.info).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('a PDF that cannot be produced still opens the chat with the link (silently)', async () => {
    const { svc, open, toasts } = setup();
    expect(await svc.send({ ...REQ, pdf: async () => null })).toBe('opened');
    await flush();
    expect(open).toHaveBeenCalledTimes(1);
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it('phone that can share files: ONE tap → the share sheet with the PDF AND the message; nothing else opens', async () => {
    const nav = CAN_SHARE();
    const { svc, open, toasts } = setup({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', nav });
    expect(await svc.send({ ...REQ, pdf: async () => PDF(), pdfName: 'r.pdf' })).toBe('opened');
    const arg = (nav.share.mock.calls[0] as unknown as [{ files: File[]; text: string }])[0];
    expect(arg.files[0].name).toBe('r.pdf');
    expect(arg.files[0].type).toBe('application/pdf');
    expect(arg.text).toBe(TEXT);
    expect(open).not.toHaveBeenCalled();
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it('phone: closing the share sheet cancels quietly (nothing recorded, nothing opened)', async () => {
    const nav = CAN_SHARE();
    nav.share.mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' }));
    const { svc, open, toasts } = setup({ ua: 'Mozilla/5.0 (Android 14)', nav });
    expect(await svc.send({ ...REQ, pdf: async () => PDF() })).toBe('cancelled');
    expect(open).not.toHaveBeenCalled();
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it('phone: the share refused for another reason falls back to wa.me with the text', async () => {
    const nav = CAN_SHARE();
    nav.share.mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    const { svc, open } = setup({ ua: 'Mozilla/5.0 (Android 14)', nav });
    expect(await svc.send({ ...REQ, pdf: async () => PDF() })).toBe('opened');
    expect(open).toHaveBeenCalledWith(`https://wa.me/919876543210?text=${encodeURIComponent(TEXT)}`, '_blank', 'noopener');
  });

  it('phone without file share: wa.me with the text, no card', async () => {
    const { svc, open } = setup({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' });
    expect(await svc.send({ ...REQ, pdf: async () => PDF() })).toBe('opened');
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('WhatsAppManualService.sendInvoice (OPS-126) - the invoice PDF goes with the drafted message', () => {
  const INV = { phone: '98765 43210', patientName: 'Asha Rao', labName: 'Arun Lab', invoiceNumber: 'INV-001031', amount: 400, extra: ['Your report will be shared here once it is ready.'] };
  const TXT = 'Hi Asha Rao, your invoice from Arun Lab:\nINV-001031 — Paid ₹400\nYour report will be shared here once it is ready.\nThank you for choosing us.';
  const pdf = async () => new Blob(['%PDF-1.4 x'], { type: 'application/pdf' });

  it('desktop: drafts the invoice text in the click-to-chat link and puts the PDF on OUR clipboard (no opt-out lookup)', async () => {
    const b = { open: vi.fn(async () => ({ ok: true })), setPdf: vi.fn(async () => ({ ok: true })) } as unknown as ElectronWhatsAppBridge & { open: ReturnType<typeof vi.fn>; setPdf: ReturnType<typeof vi.fn> };
    const { svc, wa } = setup({ bridge: b });
    expect(await svc.sendInvoice({ ...INV, pdf })).toBe('opened');
    expect(b.open).toHaveBeenCalledWith(`https://web.whatsapp.com/send?phone=919876543210&text=${encodeURIComponent(TXT)}`);
    await vi.waitFor(() => expect(b.setPdf).toHaveBeenCalled());
    const arg = (b.setPdf.mock.calls[0] as unknown as [{ name: string; copyToClipboard: boolean }])[0];
    expect(arg.name).toBe('INV-001031.pdf');
    expect(arg.copyToClipboard).toBe(true);
    expect(wa.reportStatus).not.toHaveBeenCalled();
  });

  it('phone: ONE share sheet with the invoice PDF + the text', async () => {
    const share = vi.fn(async () => undefined);
    const { svc, open } = setup({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', nav: { share, canShare: () => true } });
    expect(await svc.sendInvoice({ ...INV, pdf })).toBe('opened');
    const arg = (share.mock.calls[0] as unknown as [{ files: File[]; text: string }])[0];
    expect(arg.files[0].name).toBe('INV-001031.pdf');
    expect(arg.text).toBe(TXT);
    expect(open).not.toHaveBeenCalled();
  });

  it('no mobile number: says so, opens nothing', async () => {
    const { svc, open, dialog } = setup();
    expect(await svc.sendInvoice({ ...INV, phone: '', pdf })).toBe('no-phone');
    expect(dialog.alert).toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});

describe('WhatsAppManualService.sendInvoice (OPS-122) - the staff are always told what to do with the PDF', () => {
  const INV = { phone: '98765 43210', patientName: 'Asha Rao', labName: 'Arun Lab', invoiceNumber: 'INV-001031', amount: 400, pdf: async () => new Blob(['%PDF-1.4 x'], { type: 'application/pdf' }) };
  const flush = () => new Promise<void>(r => setTimeout(r, 0));
  const stubDownloads = () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    return names;
  };
  beforeEach(() => { localStorage.setItem(WA_PDF_HINT_KEY, '1'); });
  afterEach(() => vi.restoreAllMocks());

  it('web: the PDF downloads and the attach hint shows EVERY time (not just the first), even after the one-time hint was used', async () => {
    const names = stubDownloads();
    const { svc, toasts } = setup();
    await svc.sendInvoice(INV);
    await flush();
    await svc.sendInvoice(INV);
    await flush();
    expect(names).toEqual(['INV-001031.pdf', 'INV-001031.pdf']);
    expect(toasts.info).toHaveBeenCalledTimes(2);
    expect(toasts.info).toHaveBeenCalledWith(WA_PDF_HINT);
  });

  it('desktop: the clipboard copy failing downloads the PDF and says so', async () => {
    const names = stubDownloads();
    const b = { open: vi.fn(async () => ({ ok: true })), setPdf: vi.fn(async () => ({ ok: false })) } as unknown as ElectronWhatsAppBridge;
    const { svc, toasts } = setup({ bridge: b });
    await svc.sendInvoice(INV);
    await vi.waitFor(() => expect(toasts.warning).toHaveBeenCalledWith(expect.stringContaining('Download it and attach it')));
    await vi.waitFor(() => expect(names).toEqual(['INV-001031.pdf']));
  });

  it('phone where the share sheet cannot carry files: the text chat opens AND the PDF is saved with the hint', async () => {
    const names = stubDownloads();
    const { svc, toasts, open } = setup({ ua: 'Mozilla/5.0 (Linux; Android 14) Mobile', nav: {} });
    await svc.sendInvoice(INV);
    await vi.waitFor(() => expect(names).toEqual(['INV-001031.pdf']));
    expect(open).toHaveBeenCalledTimes(1);
    expect(toasts.info).toHaveBeenCalledWith(WA_PDF_HINT);
  });
});

describe('WhatsAppManualService — the tab survives async work (prime in the click)', () => {
  it('prime() opens a blank tab at once; send() after a network wait points THAT tab at the chat', async () => {
    const { svc, open, pop } = setup();
    svc.prime();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(pop.document.body.textContent).toBe('Opening WhatsApp…');
    await new Promise(r => setTimeout(r, 20));   // the screen fetching the report
    expect(await svc.send(REQ)).toBe('opened');
    expect(open).toHaveBeenCalledTimes(1);           // no second window.open after the wait
    expect(pop.location.replace).toHaveBeenCalledWith(URL_);
    expect(pop.opener).toBeNull();                  // severed before WhatsApp loads
    expect(pop.close).not.toHaveBeenCalled();
  });

  it('release() closes a primed tab nobody used', () => {
    const { svc, pop } = setup();
    svc.prime();
    svc.release();
    expect(pop.close).toHaveBeenCalled();
  });

  it('a send that opens nothing (no phone) closes the primed tab too', async () => {
    const { svc, pop } = setup();
    svc.prime();
    expect(await svc.send({ ...REQ, phone: '' })).toBe('no-phone');
    expect(pop.close).toHaveBeenCalled();
  });

  it('the opt-out warning closes the blank tab first (so the warning is seen), then opens on "Send anyway"', async () => {
    const { svc, open, pop } = setup({ optOut: true });
    svc.prime();
    expect(await svc.send(REQ)).toBe('opened');
    expect(pop.close).toHaveBeenCalled();
    expect(open).toHaveBeenLastCalledWith(URL_, 'pf-whatsapp');
  });

  it('prime blocked → send() tries again and reports "blocked" plainly', async () => {
    const { svc, open, toasts } = setup({ popup: 'blocked' });
    svc.prime();
    expect(await svc.send(REQ)).toBe('blocked');
    expect(open).toHaveBeenCalledTimes(2);
    expect(toasts.error).toHaveBeenCalledWith(expect.stringContaining('blocked the WhatsApp tab'));
  });

  it('desktop app: prime() is a no-op, the docked panel opens exactly as before', async () => {
    const b = { open: vi.fn(async () => ({ ok: true })), setPdf: vi.fn(async () => ({ ok: true })) } as unknown as ElectronWhatsAppBridge & { open: ReturnType<typeof vi.fn> };
    const { svc, open } = setup({ bridge: b });
    svc.prime();
    expect(await svc.send(REQ)).toBe('opened');
    expect(open).not.toHaveBeenCalled();
    expect(b.open).toHaveBeenCalledWith(URL_);
  });

  it('phone: prime() is a no-op, wa.me as before', async () => {
    const { svc, open } = setup({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' });
    svc.prime();
    expect(open).not.toHaveBeenCalled();
    expect(await svc.send(REQ)).toBe('opened');
    expect(open).toHaveBeenCalledWith(`https://wa.me/919876543210?text=${encodeURIComponent(TEXT)}`, '_blank', 'noopener');
  });
});

describe('WhatsAppManualService — referral doctor (WhatsApp Chat: Send to patient / Send to doctor)', () => {
  const DOC = { name: 'Dr. Ravi Kumar', phone: '98450 12345' };
  const DOC_TEXT = 'Dear Dr. Ravi Kumar, the report of Asha Rao from Micro World is ready. View it here: https://med.prefrontal.health/reports/public/t1';
  const DOC_URL = `https://web.whatsapp.com/send?phone=919845012345&text=${encodeURIComponent(DOC_TEXT)}`;

  it('no doctor number: no question, straight to the patient (as before)', async () => {
    const { svc, dialog, open } = setup();
    expect(await svc.send(REQ)).toBe('opened');
    expect(dialog.actions).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(URL_, 'pf-whatsapp');
  });

  it('a doctor WITHOUT a valid number, or the patient\'s own number: no question', async () => {
    for (const doctor of [{ name: 'Dr. X', phone: '123' }, { name: 'Dr. X', phone: '+91 98765 43210' }]) {
      const { svc, dialog } = setup({ doctor });
      expect(await svc.send(REQ)).toBe('opened');
      expect(dialog.actions).not.toHaveBeenCalled();
      TestBed.resetTestingModule();
    }
  });

  it('the server names a doctor with a number: ONE in-app choice (DialogService), never a native control', async () => {
    const native = vi.spyOn(window, 'confirm');
    const { svc, dialog } = setup({ doctor: DOC });
    await svc.send(REQ);
    expect(dialog.actions).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Send the report on WhatsApp',
      actions: [
        expect.objectContaining({ value: 'patient', label: 'Send to patient', variant: 'primary' }),
        expect.objectContaining({ value: 'doctor', label: 'Send to doctor' }),
      ],
    }));
    expect(native).not.toHaveBeenCalled();
    native.mockRestore();
  });

  it('"Send to patient" opens the patient\'s chat with the patient message', async () => {
    const { svc, open } = setup({ doctor: DOC, pick: 'patient' });
    expect(await svc.send(REQ)).toBe('opened');
    expect(open).toHaveBeenCalledWith(URL_, 'pf-whatsapp');
    expect(svc.lastRecipient).toBe('patient');
  });

  it('"Send to doctor" opens the DOCTOR\'s chat with the doctor message', async () => {
    const { svc, open } = setup({ doctor: DOC, pick: 'doctor' });
    expect(await svc.send(REQ)).toBe('opened');
    expect(open).toHaveBeenCalledWith(DOC_URL, 'pf-whatsapp');
    expect(svc.lastRecipient).toBe('doctor');
  });

  it('Cancel on the choice opens nothing', async () => {
    const { svc, open } = setup({ doctor: DOC, pick: null });
    expect(await svc.send(REQ)).toBe('cancelled');
    expect(open).not.toHaveBeenCalled();
  });

  it('a recipient already picked (front desk menu) asks nothing and goes to that number', async () => {
    const { svc, dialog, open } = setup();
    expect(await svc.send({ ...REQ, doctor: DOC, to: 'doctor' })).toBe('opened');
    expect(dialog.actions).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(DOC_URL, 'pf-whatsapp');
    TestBed.resetTestingModule();
    const b = setup({ doctor: DOC });
    expect(await b.svc.send({ ...REQ, to: 'patient' })).toBe('opened');
    expect(b.dialog.actions).not.toHaveBeenCalled();
    expect(b.open).toHaveBeenCalledWith(URL_, 'pf-whatsapp');
  });

  it('the choice closes a primed blank tab first (so the question is seen); the pick then opens the tab', async () => {
    const { svc, open, pop } = setup({ doctor: DOC, pick: 'doctor' });
    svc.prime();
    expect(await svc.send(REQ)).toBe('opened');
    expect(pop.close).toHaveBeenCalled();
    expect(open).toHaveBeenLastCalledWith(DOC_URL, 'pf-whatsapp');
  });

  it('the patient has no valid number: only "Send to doctor" is offered', async () => {
    const { svc, dialog, open } = setup({ doctor: DOC, pick: 'doctor' });
    expect(await svc.send({ ...REQ, phone: '' })).toBe('opened');
    const acts = (dialog.actions.mock.calls[0] as unknown as [{ actions: { value: string; variant: string }[] }])[0].actions;
    expect(acts.map(a => a.value)).toEqual(['doctor']);
    expect(acts[0].variant).toBe('primary');
    expect(open).toHaveBeenCalledWith(DOC_URL, 'pf-whatsapp');
  });

  it('the patient opted out: "Send to doctor" is not blocked by the patient\'s opt-out', async () => {
    const { svc, dialog, open } = setup({ doctor: DOC, pick: 'doctor', optOut: true });
    expect(await svc.send(REQ)).toBe('opened');
    expect(dialog.confirm).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(DOC_URL, 'pf-whatsapp');
  });

  it('desktop app: "Send to doctor" docks the doctor\'s chat (bridge path unchanged)', async () => {
    const b = { open: vi.fn(async () => ({ ok: true })), setPdf: vi.fn(async () => ({ ok: true })) } as unknown as ElectronWhatsAppBridge & { open: ReturnType<typeof vi.fn> };
    const { svc } = setup({ bridge: b, doctor: DOC, pick: 'doctor' });
    expect(await svc.send(REQ)).toBe('opened');
    expect(b.open).toHaveBeenCalledWith(DOC_URL);
  });

  it('an invoice never offers the doctor (reports only)', async () => {
    const { svc, dialog, wa } = setup({ doctor: DOC });
    expect(await svc.sendInvoice({ phone: '98765 43210', patientName: 'Asha Rao', labName: 'Arun Lab', invoiceNumber: 'INV-1', amount: 100, pdf: async () => null })).toBe('opened');
    expect(dialog.actions).not.toHaveBeenCalled();
    expect(wa.reportStatus).not.toHaveBeenCalled();
  });
});
