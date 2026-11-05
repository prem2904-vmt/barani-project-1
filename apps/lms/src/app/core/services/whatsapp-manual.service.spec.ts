import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { DialogService } from './dialog.service';
import { ToastService } from './toast.service';
import { WhatsAppService } from './whatsapp.service';
import { ElectronWhatsAppBridge, WA_CONSENT_REMINDER, WhatsAppManualService } from './whatsapp-manual.service';

/** "Send on WhatsApp" (manual): confirm → WhatsApp opens with the chat and
 *  message ready; the person presses Send. Desktop app = the docked panel,
 *  browser = ONE phone-shaped window on the right, phone = wa.me. */
const SCREEN = { availWidth: 1440, availHeight: 875, availLeft: 0, availTop: 25 } as unknown as Screen;
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36';

function setup(o: { confirm?: boolean; optOut?: boolean | 'error'; ua?: string; popup?: 'ok' | 'blocked'; bridge?: ElectronWhatsAppBridge | null } = {}) {
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
  svc.win = { open, screen: SCREEN, navigator: { userAgent: o.ua ?? DESKTOP_UA } } as never;
  svc.bridge = () => o.bridge ?? null;
  return { svc, dialog, toasts, wa, open, pop };
}
afterEach(() => TestBed.resetTestingModule());

const REQ = { phone: '98765 43210', patientName: 'Asha Rao', labName: 'Micro World', link: 'https://med.prefrontal.health/reports/public/t1', reportId: 'r1' };
const TEXT = 'Dear Asha Rao, your report from Micro World is ready. View it here: https://med.prefrontal.health/reports/public/t1';
const URL_ = `https://web.whatsapp.com/send?phone=919876543210&text=${encodeURIComponent(TEXT)}`;

describe('WhatsAppManualService — confirm', () => {
  it('asks first: the message, the number and the consent reminder (DialogService, never window.confirm)', async () => {
    const { svc, dialog } = setup();
    const native = vi.spyOn(window, 'confirm');
    await svc.send(REQ);
    expect(native).not.toHaveBeenCalled();
    expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Send on WhatsApp',
      items: [TEXT],
      question: WA_CONSENT_REMINDER,
      confirmLabel: 'Open WhatsApp',
      tone: 'primary',
    }));
    const msg = (dialog.confirm.mock.calls[0] as unknown as [{ message: string }])[0].message;
    expect(msg).toContain('+91 98765 43210');
    expect(msg).toContain('press Send in WhatsApp');
    native.mockRestore();
  });

  it('Cancel opens nothing', async () => {
    const { svc, open } = setup({ confirm: false });
    expect(await svc.send(REQ)).toBe('cancelled');
    expect(open).not.toHaveBeenCalled();
  });

  it('a patient who opted out: a warning, still allowed', async () => {
    const { svc, dialog, open } = setup({ optOut: true });
    expect(await svc.send(REQ)).toBe('opened');
    expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'This patient opted out of WhatsApp', confirmLabel: 'Send anyway', tone: 'danger',
    }));
    expect(open).toHaveBeenCalled();
  });

  it('the opt-out read failing never blocks the send', async () => {
    const { svc, dialog } = setup({ optOut: 'error' });
    expect(await svc.send(REQ)).toBe('opened');
    expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Send on WhatsApp' }));
  });

  it('no valid mobile: a plain message, nothing opens, no confirm', async () => {
    for (const phone of [null, '', '12345', '+1 555 123 4567']) {
      const { svc, dialog, open } = setup();
      expect(await svc.send({ ...REQ, phone })).toBe('no-phone');
      expect(dialog.alert).toHaveBeenCalledWith(expect.objectContaining({ title: 'No mobile number' }));
      expect(dialog.confirm).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      TestBed.resetTestingModule();
    }
  });
});

describe('WhatsAppManualService — web browser popup', () => {
  it('ONE named phone-shaped window flush right, full height; opener cut, focused', async () => {
    const { svc, open, pop } = setup();
    expect(await svc.send(REQ)).toBe('opened');
    expect(open).toHaveBeenCalledWith(URL_, 'pf-whatsapp', 'popup=yes,width=420,height=875,left=1020,top=25');
    expect(pop.opener).toBeNull();
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

  it('hands the PDF over for the drag helper (never attached)', async () => {
    const b = bridge();
    const { svc } = setup({ bridge: b });
    await svc.send({ ...REQ, pdf: async () => new Blob(['%PDF-1.4 x'], { type: 'application/pdf' }), pdfName: 'report-AB.pdf' });
    await vi.waitFor(() => expect(b.setPdf).toHaveBeenCalled());
    const arg = (b.setPdf.mock.calls[0] as unknown as [{ name: string; bytes: Uint8Array }])[0];
    expect(arg.name).toBe('report-AB.pdf');
    expect(arg.bytes.length).toBe(10);
  });

  it('main refusing → an error toast', async () => {
    const { svc, toasts } = setup({ bridge: bridge(false) });
    expect(await svc.send(REQ)).toBe('blocked');
    expect(toasts.error).toHaveBeenCalled();
  });
});
