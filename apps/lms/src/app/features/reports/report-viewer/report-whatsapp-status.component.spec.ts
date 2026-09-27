import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ReportWhatsAppStatusComponent } from './report-whatsapp-status.component';
import { WaMessage, WaReportStatus, WhatsAppService } from '../../../core/services/whatsapp.service';
import { ToastService } from '../../../core/services/toast.service';

const MSG = (over: Partial<WaMessage> = {}): WaMessage => ({
  id: 'm1', reportId: 'rep-1', trigger: 'auto', kind: 'report_ready', status: 'delivered',
  attempts: 1, to: '••••••••3210', createdAt: '2026-09-27T10:00:00Z', sentAt: '2026-09-27T10:00:05Z',
  deliveredAt: '2026-09-27T10:00:09Z', ...over,
});
const STATUS = (over: Partial<WaReportStatus> = {}): WaReportStatus => ({
  reportId: 'rep-1', patientId: 'p1', patientOptOut: false, autoSendEnabled: true, configured: true,
  latest: MSG(), history: [MSG()], ...over,
});

afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); });

async function render(status: WaReportStatus | 'error', canDeliver = true, extra: Partial<Record<'resend' | 'setOptOut', unknown>> = {}) {
  const wa = {
    reportStatus: vi.fn(() => (status === 'error' ? throwError(() => new Error('403')) : of(status))),
    resend: vi.fn(() => extra.resend ?? of(MSG({ id: 'm2', trigger: 'resend', status: 'sent' }))),
    setOptOut: vi.fn(() => extra.setOptOut ?? of({ patientId: 'p1', optOut: true })),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  TestBed.configureTestingModule({
    imports: [ReportWhatsAppStatusComponent],
    providers: [{ provide: WhatsAppService, useValue: wa }, { provide: ToastService, useValue: toasts }],
  });
  const f = TestBed.createComponent(ReportWhatsAppStatusComponent);
  f.componentRef.setInput('reportId', 'rep-1');
  f.componentRef.setInput('canDeliver', canDeliver);
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, wa, toasts };
}

describe('Report WhatsApp auto-send status', () => {
  it('shows the delivered status with the masked number and a Resend action', async () => {
    const { el } = await render(STATUS());
    expect(el.querySelector('.pf-rwa__status')?.textContent).toContain('Delivered');
    expect(el.querySelector('.pf-rwa__status')?.getAttribute('data-tone')).toBe('good');
    expect(el.textContent).toContain('3210');
    expect(el.textContent).not.toContain('9876543210');
    const btn = el.querySelector('.pf-rwa__btn') as HTMLButtonElement;
    expect(btn.textContent).toContain('Resend');
    // SVG icon, never an emoji glyph.
    expect(btn.querySelector('svg')).not.toBeNull();
  });

  it('a failure shows Meta\'s readable reason', async () => {
    const { el } = await render(STATUS({ latest: MSG({ status: 'failed', errorCode: 131026, errorReason: 'Message undeliverable — the number may not be on WhatsApp.' }) }));
    expect(el.querySelector('.pf-rwa__status')?.textContent).toContain('Failed');
    expect(el.querySelector('.pf-rwa__reason--bad')?.textContent).toContain('undeliverable');
  });

  it('queued (payment still due / not yet sent) explains when it will go', async () => {
    const { el } = await render(STATUS({ latest: null, history: [] }));
    expect(el.textContent).toContain('once this final report is ready and the bill is fully paid');
    expect((el.querySelector('.pf-rwa__btn') as HTMLElement).textContent).toContain('Send now');
  });

  it('Resend posts, toasts and reloads', async () => {
    const { el, wa, toasts, f } = await render(STATUS());
    (el.querySelector('.pf-rwa__btn') as HTMLButtonElement).click();
    f.detectChanges();
    expect(wa.resend).toHaveBeenCalledWith('rep-1');
    expect(toasts.success).toHaveBeenCalledWith('Report link sent on WhatsApp');
    expect(wa.reportStatus).toHaveBeenCalledTimes(2);
  });

  it('a refused resend surfaces the server reason (e.g. balance due)', async () => {
    const err = Object.assign(new Error('Payment is still due on this order'), {});
    const { el, toasts, f } = await render(STATUS(), true, { resend: throwError(() => err) });
    (el.querySelector('.pf-rwa__btn') as HTMLButtonElement).click();
    f.detectChanges();
    expect(toasts.error).toHaveBeenCalledWith('Payment is still due on this order');
  });

  it('the opt-out switch saves and disables Resend', async () => {
    const { el, wa, f } = await render(STATUS());
    const sw = el.querySelector('.pf-rwa__opt') as HTMLButtonElement;
    expect(sw.getAttribute('role')).toBe('switch');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    sw.click();
    f.detectChanges();
    expect(wa.setOptOut).toHaveBeenCalledWith('p1', true);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect((el.querySelector('.pf-rwa__btn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('view-only users see the status but no Resend / opt-out', async () => {
    const { el } = await render(STATUS(), false);
    expect(el.querySelector('.pf-rwa__status')).not.toBeNull();
    expect(el.querySelector('.pf-rwa__btn')).toBeNull();
    expect(el.querySelector('.pf-rwa__opt')).toBeNull();
  });

  it('renders nothing when auto-send is off and nothing was ever sent', async () => {
    const { el } = await render(STATUS({ autoSendEnabled: false, latest: null, history: [] }));
    expect(el.querySelector('.pf-rwa')).toBeNull();
  });

  it('stays hidden when the status call fails (no permission / older server)', async () => {
    const { el } = await render('error');
    expect(el.querySelector('.pf-rwa')).toBeNull();
  });
});
