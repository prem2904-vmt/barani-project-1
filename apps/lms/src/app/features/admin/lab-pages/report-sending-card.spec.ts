import { of } from 'rxjs';
import { vi } from 'vitest';
import { ReportSendingCardComponent } from './report-sending-card.component';
import { WhatsAppService } from '../../../core/services/whatsapp.service';
import { renderLabPage, text } from './lab-pages.spec-helpers';

const settings = (over: Record<string, unknown> = {}) => ({
  autoSendEnabled: false, sendUpdatedReports: false, autoEntitled: true, canSend: true,
  sender: { source: 'platform' }, platform: { enabled: true, configured: true, webhookConfigured: true, defaultTemplateName: 't', defaultTemplateLanguage: 'en' },
  ...over,
});

function wa(s = settings()) {
  const svc = {
    settings: vi.fn(() => of(s)),
    saveSettings: vi.fn((b: any) => of({ ...s, ...b })),
  };
  return { svc, provider: { provide: WhatsAppService, useValue: svc } };
}

describe('Report design › Sending (WhatsApp Auto)', () => {
  it('WhatsApp Auto + send-again switches save through the same settings API (only the two switches)', async () => {
    const { svc, provider } = wa();
    const p = await renderLabPage(ReportSendingCardComponent, '/page', { providers: [provider] });
    p.el.querySelector<HTMLButtonElement>('[data-testid="rs-auto-switch"]')!.click();
    expect(svc.saveSettings).toHaveBeenCalledWith({ autoSendEnabled: true, sendUpdatedReports: false });
    p.harness.detectChanges();
    p.el.querySelector<HTMLButtonElement>('[data-testid="rs-resend-switch"]')!.click();
    expect(svc.saveSettings).toHaveBeenLastCalledWith({ autoSendEnabled: true, sendUpdatedReports: true });
    expect(p.toasts.success).toHaveBeenCalled();
  });

  it('rows: label on the left, the switch on the right; each save tells the host page (band save state)', async () => {
    const { provider } = wa();
    const p = await renderLabPage(ReportSendingCardComponent, '/page', { providers: [provider] });
    const seen: boolean[] = [];
    p.cmp.savingChange.subscribe((v: boolean) => seen.push(v));
    const rows = Array.from(p.el.querySelectorAll('pf-setting-row'));
    for (const r of rows.slice(0, 2)) expect(r.querySelector('.pf-srow__ctl [role="switch"]')).not.toBeNull();
    expect(text(rows[0].querySelector('.pf-srow__label'))).toBe('WhatsApp Auto');
    p.el.querySelector<HTMLButtonElement>('[data-testid="rs-auto-switch"]')!.click();
    expect(seen).toEqual([true, false]);
    expect(p.el.querySelector('pf-hero-band, .pf-hb-btn--primary')).toBeNull();
  });

  it('what the lab SENDS lives here; the account (number, templates, limits) is linked, not repeated', async () => {
    const { provider } = wa();
    const p = await renderLabPage(ReportSendingCardComponent, '/page', { providers: [provider] });
    expect(p.el.querySelector('[data-testid="rs-channels-link"]')!.getAttribute('href')).toBe('/admin/org/channels');
    expect(p.el.querySelector('pf-wa-connect-card, pf-wa-billing-card')).toBeNull();
    expect(text(p.el.querySelector('[data-testid="rs-sender"]'))).toContain('Sender');
  });

  it('turned off by Prefrontal: the switches are disabled and it says so', async () => {
    const { svc, provider } = wa(settings({ autoEntitled: false }));
    const p = await renderLabPage(ReportSendingCardComponent, '/page', { providers: [provider] });
    expect(p.el.querySelector('[data-testid="rs-auto-off"]')).not.toBeNull();
    expect(p.el.querySelector<HTMLButtonElement>('[data-testid="rs-auto-switch"]')!.disabled).toBe(true);
    p.el.querySelector<HTMLButtonElement>('[data-testid="rs-auto-switch"]')!.click();
    expect(svc.saveSettings).not.toHaveBeenCalled();
  });

  it('a person without the communication permission sees the state but cannot change it', async () => {
    const { svc, provider } = wa();
    const p = await renderLabPage(ReportSendingCardComponent, '/page', {
      providers: [provider], auth: { hasPermission: () => false },
    });
    expect(p.el.querySelector<HTMLButtonElement>('[data-testid="rs-auto-switch"]')!.disabled).toBe(true);
    expect(svc.saveSettings).not.toHaveBeenCalled();
  });
});
