import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { DialogService } from './dialog.service';
import { ToastService } from './toast.service';
import { WhatsAppService } from './whatsapp.service';
import { ElectronWhatsAppBridge, WA_CONSENT_REMINDER, WA_PDF_HINT, WA_PDF_HINT_KEY, WA_REMINDER_KEY, WhatsAppManualService } from './whatsapp-manual.service';

/** "WhatsApp Chat" (manual): one click → WhatsApp opens with the chat and
 *  message ready; the person presses Send. Desktop app = the docked panel,
 *  browser = ONE phone-shaped window on the right, phone = wa.me. */
const SCREEN = { availWidth: 1440, availHeight: 875, availLeft: 0, availTop: 25 } as unknown as Screen;
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36';

function setup(o: { confirm?: boolean; optOut?: boolean | 'error'; ua?: string; popup?: 'ok' | 'blocked'; bridge?: ElectronWhatsAppBridge | null; nav?: Record<string, unknown> } = {}) {
  const dialog = { confirm: vi.fn(async () => o.confirm ?? true), alert: vi.fn(async () => undefined) };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  const wa = {
    reportStatus: vi.fn(() => o.optOut === 'error' ? throwError(() => new Error('403')) : of({ patientOptOut: !!o.optOut })),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: DialogService, useValue: dialog },
      { provide: ToastService, useValue: toasts },
      { provide: WhatsAppService, useValue: wa },
    ],
  });
  const svc = TestBed.inject(WhatsAppManualService);
  const pop = { opener: {} as unknown, focus: vi.fn() };
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

describe('WhatsAppManualService — web browser popup', () => {
  it('ONE named phone-shaped window flush right, full height; focused', async () => {
    const { svc, open, pop } = setup();
    expect(await svc.send(REQ)).toBe('opened');
    expect(open).toHaveBeenCalledWith(URL_, 'pf-whatsapp', 'popup=yes,width=420,height=875,left=1020,top=25');
    expect(pop.focus).toHaveBeenCalled();
  });

  it('a repeat click reuses the same named window', async () => {
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

  it('blocked pop-up: says so plainly', async () => {
    const { svc, toasts } = setup({ popup: 'blocked' });
    expect(await svc.send(REQ)).toBe('blocked');
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

  it('hands the PDF over for the automatic attach (clipboard paste in main) + drag; the person presses Send', async () => {
    const b = bridge();
    const { svc } = setup({ bridge: b });
    await svc.send({ ...REQ, pdf: async () => new Blob(['%PDF-1.4 x'], { type: 'application/pdf' }), pdfName: 'report-AB.pdf' });
    await vi.waitFor(() => expect(b.setPdf).toHaveBeenCalled());
    const arg = (b.setPdf.mock.calls[0] as unknown as [{ name: string; bytes: Uint8Array }])[0];
    expect(arg.name).toBe('report-AB.pdf');
    expect(arg.bytes.length).toBe(10);
    expect((arg as unknown as { autoAttach: boolean }).autoAttach).toBe(true);
    // the message rides along: main drafts it as the attachment's caption
    expect((arg as unknown as { caption: string }).caption).toContain('your report from Micro World is ready');
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
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const third = setup();
    await third.svc.send({ ...REQ, pdf: async () => PDF() });
    await flush();
    expect(third.toasts.info).not.toHaveBeenCalled();
    get.mockRestore();
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
