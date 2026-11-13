import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  WaBilling, WaBillingView, WaCredits, WaSender, WaSettings, inr, waPaymentLabel,
} from '../../../core/services/whatsapp.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { WaBillingCardComponent, parseAmount } from './wa-billing-card.component';

/**
 * Lab settings → "WhatsApp usage & billing". Own-number mode (the lab pays
 * Meta): usage + ₹ with its source, the payment chip and the Add-payment deep
 * link with Meta's steps, the PREPAID BALANCE labelled estimated (Meta has no
 * balance API) with "I added funds" through DialogService.prompt, the alert
 * levels; shared mode: counts only + the credits Prefrontal granted; never a
 * native control; the server's cache is read, "Refresh usage" is a POST.
 */

const SENDER = (over: Partial<WaSender> = {}): WaSender => ({
  source: 'platform', state: 'not_connected', displayName: 'Prefrontal', status: 'not_connected',
  tokenStored: false, canConnect: false, ...over,
});
const OWN_SENDER = SENDER({ source: 'tenant', state: 'connected', status: 'connected', tokenStored: true, phoneNumberId: 'pn-1', wabaId: '9876543210', paymentStatus: 'set' });
const SETTINGS = (sender: WaSender): WaSettings => ({
  autoSendEnabled: true, sendUpdatedReports: false, sender,
  platform: { enabled: true, configured: true, webhookConfigured: true, defaultTemplateName: 'lab_report_ready', defaultTemplateLanguage: 'en' },
});

const LINKS = {
  paymentMethods: 'https://business.facebook.com/latest/billing_hub/payment_methods/?business_id=1234567890',
  accountBilling: 'https://business.facebook.com/billing_hub/accounts/details/?asset_id=9876543210&business_id=1234567890',
  manager: 'https://business.facebook.com/wa/manage/home/?business_id=1234567890&waba_id=9876543210',
  insights: 'https://business.facebook.com/wa/manage/insights/?business_id=1234567890&waba_id=9876543210',
  helpAddPaymentMethod: 'https://www.facebook.com/business/help/488291839463771',
  helpAboutBilling: 'https://www.facebook.com/business/help/2225184664363779',
  helpPaymentThreshold: 'https://www.facebook.com/business/help/535561817791563',
  precise: true,
};
const DELIVERY = (o: Partial<WaBilling['delivery']['thisMonth']> = {}) => ({
  month: '2026-09', sent: 120, delivered: 110, read: 80, failed: 3, own: 120, shared: 0, held: 2, queued: 0, ...o,
});
const OWN_BILLING = (over: Partial<WaBilling> = {}): WaBilling => ({
  own: true, wabaId: '9876543210', businessId: '1234567890', currency: 'INR', currencyWarning: null,
  usage: {
    thisMonth: { month: '2026-09', messages: 120, cost: 13.8, costSource: 'meta', byCategory: [{ category: 'utility', volume: 118, cost: 13.57, source: 'meta' }, { category: 'marketing', volume: 2, cost: 1.73, source: 'meta' }], syncedAt: '2026-09-29T06:00:00Z' },
    lastMonth: { month: '2026-08', messages: 400, cost: 46, costSource: 'estimate', byCategory: [], syncedAt: null },
    syncedAt: '2026-09-29T06:00:00Z', nextSyncAt: '2026-09-29T12:00:00Z', syncError: null,
  },
  delivery: { thisMonth: DELIVERY(), lastMonth: DELIVERY({ month: '2026-08' }) },
  payment: { status: 'set', reason: null, checkedAt: '2026-09-29T06:00:00Z', failedAt: null, fallingBack: false },
  balance: { source: null, reported: null, reportedAt: null, spentSince: 0, messagesSince: 0, estimated: null, threshold: 200, isLow: false, isOut: false },
  spend: { monthlyThreshold: null, thisMonth: 13.8, percent: null },
  links: LINKS,
  steps: ['Sign in to Meta Business Suite…', 'Open WhatsApp Manager → Overview…', 'Add payment method → Visa or Mastercard…'],
  rates: { currency: 'INR', utility: 0.115, marketing: 0.8631, authentication: 0.115, authenticationInternational: 2.4971, service: 0.115, note: 'Meta India per-message rates', url: 'https://developers.facebook.com/docs/whatsapp/pricing' },
  ...over,
});
const SHARED_BILLING = (): WaBilling => OWN_BILLING({
  own: false, wabaId: null, businessId: null, currency: null,
  usage: { thisMonth: null, lastMonth: null, syncedAt: null, nextSyncAt: null, syncError: null },
  delivery: { thisMonth: DELIVERY({ own: 0, shared: 57, sent: 57, delivered: 50, read: 30, failed: 1, held: 0 }), lastMonth: DELIVERY({ month: '2026-08' }) },
  payment: { status: 'unknown', reason: null, checkedAt: null, failedAt: null, fallingBack: false },
  balance: null,
  links: { ...LINKS, paymentMethods: 'https://business.facebook.com/billing_hub', precise: false },
});
const CREDITS = (over: Partial<WaCredits> = {}): WaCredits => ({
  tracked: false, balance: null, lowThreshold: null,
  usedThisMonth: 0, grantedTotal: 0, usedTotal: 0, isLow: false, isExhausted: false, ledger: [], ...over,
});
const VIEW = (billing: WaBilling, credits: WaCredits = CREDITS()): WaBillingView => ({ billing, credits });

function make(view: WaBillingView | unknown, opts: { perms?: string[]; sender?: WaSender; prompt?: string | null; fail?: boolean } = {}) {
  const perms = opts.perms ?? ['manage_tenant'];
  const api = {
    get: vi.fn((url: string) => url === '/api/whatsapp/billing'
      ? (opts.fail ? throwError(() => new ApiError('Forbidden', 'forbidden')) : of(view))
      : of(SETTINGS(opts.sender ?? OWN_SENDER))),
    post: vi.fn(() => of(view)),
    put: vi.fn((_url: string, _body: unknown) => of(view)),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  const dialog = { prompt: vi.fn(async () => opts.prompt ?? null), confirm: vi.fn(async () => true) };
  TestBed.configureTestingModule({
    imports: [WaBillingCardComponent],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toasts },
      { provide: DialogService, useValue: dialog },
      { provide: AuthService, useValue: { hasPermission: (p: string) => perms.includes(p) } },
    ],
  });
  const f = TestBed.createComponent(WaBillingCardComponent);
  f.componentRef.setInput('settings', SETTINGS(opts.sender ?? OWN_SENDER));
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const q = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  return { f, el, q, api, toasts, dialog, cmp: f.componentInstance };
}

async function settle(f: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  await Promise.resolve();
  await Promise.resolve();
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
}

describe('WhatsApp billing card — own number', () => {
  it('loads the cached view (one GET, no POST), shows usage with its source, delivery counts and the Set chip', () => {
    const p = make(VIEW(OWN_BILLING()));
    expect(p.api.get).toHaveBeenCalledWith('/api/whatsapp/billing');
    expect(p.api.post).not.toHaveBeenCalled();   // never a Meta refresh on load
    const card = p.q('ls-wa-billing-card')!;
    expect(card.getAttribute('data-mode')).toBe('own');
    expect(p.q('wab-payment')!.textContent).toContain('Payment method set');
    const usage = p.q('wab-usage')!.textContent!;
    expect(usage).toContain('120');
    expect(usage).toContain('₹13.80');
    expect(usage).toContain('from Meta');
    expect(usage).toContain('₹46.00');
    expect(usage).toContain('estimated');
    expect(p.q('wab-delivery')!.textContent).toContain('110 · 80 · 3');
    expect(p.q('wab-delivery')!.textContent).toContain('2 on hold');
    expect(p.q('wab-categories')!.textContent).toContain('Utility');
    expect(p.q('wab-synced')!.textContent).toContain('Usage synced');
    expect(p.q('wab-payment-alert')).toBeNull();
    // Deep links open the lab's own Meta pages in a new tab; the card never says "recharge".
    const add = p.q('wab-add-payment') as HTMLAnchorElement;
    expect(add.href).toBe(LINKS.paymentMethods);
    expect(add.target).toBe('_blank');
    expect(add.rel).toContain('noopener');
    expect(add.classList.contains('pf-btn--primary')).toBe(true);
    expect(p.el.querySelectorAll('.pf-btn--primary').length).toBe(1);
    expect((p.q('wab-account-billing') as HTMLAnchorElement).href).toBe(LINKS.accountBilling);
    expect(p.el.textContent).not.toMatch(/recharge/i);
    expect(p.el.querySelector('select, datalist, input[type="checkbox"], input[type="number"]')).toBeNull();
    expect(p.q('wab-credits')).toBeNull();
  });

  it('payment failed: red alert with the fallback note, the primary button says update, steps expand', () => {
    const p = make(VIEW(OWN_BILLING({ payment: { status: 'failed', reason: 'Meta refused to send: payment method error (131042).', checkedAt: null, failedAt: '2026-09-29T05:00:00Z', fallingBack: true } })));
    expect(p.q('wab-payment')!.getAttribute('data-status')).toBe('failed');
    const alert = p.q('wab-payment-alert')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('WhatsApp messages are failing: payment method needed');
    expect(alert.textContent).toContain('131042');
    expect(alert.textContent).toContain("reports go from Prefrontal's shared number");
    expect(p.q('wab-add-payment')!.textContent).toContain('Add or update payment method');
    expect(p.q('wab-steps')).toBeNull();
    (p.q('wab-steps-toggle') as HTMLButtonElement).click();
    p.f.detectChanges();
    const steps = p.q('wab-steps')!;
    expect(steps.querySelectorAll('li').length).toBe(4);   // Meta's steps + the prepaid "Add funds" line
    expect(steps.textContent).toContain('Add funds');
    expect(steps.textContent).toContain('UPI');
  });

  it('payment missing: amber alert; imprecise links say so; a non-INR account gets the 2026 warning', () => {
    const p = make(VIEW(OWN_BILLING({
      payment: { status: 'missing', reason: null, checkedAt: null, failedAt: null, fallingBack: false },
      links: { ...LINKS, precise: false, paymentMethods: 'https://business.facebook.com/billing_hub' },
      currency: 'USD', currencyWarning: 'This WhatsApp account bills in USD. Meta requires Indian customers to move to INR by 31 December 2026.',
    })));
    expect(p.q('wab-payment-alert')!.getAttribute('data-tone')).toBe('wait');
    expect(p.q('wab-payment-alert')!.textContent).toContain('Add a payment method');
    expect(p.el.textContent).toContain("don't know your Meta business id yet");
    expect(p.q('wab-currency-warning')!.textContent).toContain('31 December 2026');
  });

  it('prepaid balance: not tracked → "Start tracking"; tracked → estimated amount, confirmed line, Low / Used up flags', () => {
    const none = make(VIEW(OWN_BILLING()));
    expect(none.q('wab-balance')!.getAttribute('data-state')).toBe('none');
    expect(none.q('wab-balance-update')!.textContent).toContain('Start tracking');
    expect(none.q('wab-balance')!.textContent).toContain('does not share your prepaid balance');
    TestBed.resetTestingModule();

    const low = make(VIEW(OWN_BILLING({ balance: { source: 'estimate', reported: 500, reportedAt: '2026-09-20T04:30:00Z', spentSince: 350.75, messagesSince: 3050, estimated: 149.25, threshold: 200, isLow: true, isOut: false } })));
    expect(low.q('wab-balance')!.getAttribute('data-state')).toBe('low');
    expect(low.q('wab-balance-amount')!.textContent).toContain('₹149.25');
    expect(low.q('wab-balance-amount')!.textContent).toContain('Low');
    expect(low.q('wab-balance')!.textContent).toContain('estimated');
    expect(low.q('wab-balance')!.textContent).toContain('You confirmed ₹500.00');
    expect(low.q('wab-balance')!.textContent).toContain('3050 message(s)');
    expect(low.q('wab-balance-update')!.textContent).toContain('I added funds');
    TestBed.resetTestingModule();

    const out = make(VIEW(OWN_BILLING({ balance: { source: 'estimate', reported: 100, reportedAt: '2026-09-20T04:30:00Z', spentSince: 101, messagesSince: 878, estimated: -1, threshold: 200, isLow: false, isOut: true } })));
    expect(out.q('wab-balance')!.getAttribute('data-state')).toBe('out');
    expect(out.q('wab-balance-amount')!.textContent).toContain('Used up');
  });

  it('"I added funds" asks through DialogService.prompt (never window.prompt) and PUTs the amount', async () => {
    const p = make(VIEW(OWN_BILLING()), { prompt: '₹ 1,250.50' });
    (p.q('wab-balance-update') as HTMLButtonElement).click();
    await settle(p.f);
    expect(p.dialog.prompt).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Save' }));
    expect(p.api.put).toHaveBeenCalledWith('/api/whatsapp/billing/balance', { amount: 1250.5 });
    expect(p.toasts.success).toHaveBeenCalledWith(expect.stringContaining('₹1,250.50'));
    TestBed.resetTestingModule();

    const cancelled = make(VIEW(OWN_BILLING()), { prompt: null });
    (cancelled.q('wab-balance-update') as HTMLButtonElement).click();
    await settle(cancelled.f);
    expect(cancelled.api.put).not.toHaveBeenCalled();
    TestBed.resetTestingModule();

    const junk = make(VIEW(OWN_BILLING()), { prompt: 'five hundred' });
    (junk.q('wab-balance-update') as HTMLButtonElement).click();
    await settle(junk.f);
    expect(junk.api.put).not.toHaveBeenCalled();
    expect(junk.toasts.error).toHaveBeenCalled();
  });

  it('alert levels: Save is enabled only when changed and PUTs the settings; Refresh usage POSTs', async () => {
    const p = make(VIEW(OWN_BILLING({ spend: { monthlyThreshold: 500, thisMonth: 410, percent: 82 } })));
    await settle(p.f);   // ngModel writes the input value asynchronously
    expect(p.q('wab-limit-progress')!.textContent).toContain('82% of ₹500.00');
    const save = p.q('wab-save-thresholds') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const limit = p.q('wab-limit') as HTMLInputElement;
    expect(limit.value).toBe('500');
    expect(limit.getAttribute('inputmode')).toBe('decimal');
    limit.value = '750';
    limit.dispatchEvent(new Event('input'));
    p.f.detectChanges();
    expect(save.disabled).toBe(false);
    save.click();
    p.f.detectChanges();
    expect(p.api.put).toHaveBeenCalledWith('/api/whatsapp/billing/settings', { monthlySpendThreshold: 750, lowBalanceThreshold: 200 });
    (p.q('wab-refresh') as HTMLButtonElement).click();
    expect(p.api.post).toHaveBeenCalledWith('/api/whatsapp/billing/refresh', {});
    expect(p.toasts.success).toHaveBeenCalledWith('WhatsApp usage refreshed');
  });

  it('without manage_tenant: read-only (no Start tracking, no alert levels, no Refresh) but the pay links stay', () => {
    const p = make(VIEW(OWN_BILLING()), { perms: ['manage_lab_settings'] });
    expect(p.q('wab-balance-update')).toBeNull();
    expect(p.q('wab-thresholds')).toBeNull();
    expect(p.q('wab-refresh')).toBeNull();
    expect(p.q('wab-add-payment')).not.toBeNull();
  });

  it('a failed load shows the error; a non-billing payload (older server) shows nothing', () => {
    const err = make(VIEW(OWN_BILLING()), { fail: true });
    expect(err.q('ls-wa-billing-card')).toBeNull();
    expect(err.q('ls-wa-billing-error')!.textContent).toContain('Forbidden');
    TestBed.resetTestingModule();
    const old = make([]);
    expect(old.q('ls-wa-billing-card')).toBeNull();
    expect(old.q('ls-wa-billing-error')).toBeNull();
  });
});

describe('WhatsApp billing card — shared Prefrontal number', () => {
  it('shows counts only, "Prefrontal pays", no balance / payment / thresholds', () => {
    const p = make(VIEW(SHARED_BILLING()), { sender: SENDER() });
    expect(p.q('ls-wa-billing-card')!.getAttribute('data-mode')).toBe('shared');
    expect(p.q('wab-payment')!.textContent).toContain('Prefrontal pays');
    expect(p.q('wab-shared-count')!.textContent).toBe('57');
    expect(p.el.textContent).toContain('50 delivered, 30 read, 1 failed');
    expect(p.q('wab-balance')).toBeNull();
    expect(p.q('wab-add-payment')).toBeNull();
    expect(p.q('wab-thresholds')).toBeNull();
    expect(p.q('wab-credits')).toBeNull();
    expect(p.q('wab-credits-untracked')!.textContent).toContain('Prefrontal pays for these messages');
  });

  it('with credits granted: balance, used, "Contact Prefrontal"; nothing the lab can change; low and exhausted flags with the hold notice', () => {
    const ok = make(VIEW(SHARED_BILLING(), CREDITS({ tracked: true, balance: 180, lowThreshold: 20, usedThisMonth: 20 })), { sender: SENDER() });
    const c = ok.q('wab-credits')!;
    expect(c.getAttribute('data-state')).toBe('ok');
    expect(ok.q('wab-credits-balance')!.textContent).toContain('180');
    expect(c.textContent).toContain('20 used this month');
    expect(c.textContent).toContain('Contact Prefrontal to add credits');
    expect(c.textContent).not.toMatch(/every month|allowance/i);
    expect(c.querySelector('button, input, a')).toBeNull();
    expect(c.textContent).not.toContain('on hold');
    TestBed.resetTestingModule();

    const low = make(VIEW(SHARED_BILLING(), CREDITS({ tracked: true, balance: 5, lowThreshold: 20, isLow: true })), { sender: SENDER() });
    expect(low.q('wab-credits')!.getAttribute('data-state')).toBe('low');
    expect(low.q('wab-credits')!.textContent).toContain('Running low');
    TestBed.resetTestingModule();

    const out = make(VIEW(SHARED_BILLING(), CREDITS({ tracked: true, balance: 0, lowThreshold: 20, isExhausted: true })), { sender: SENDER() });
    expect(out.q('wab-credits')!.getAttribute('data-state')).toBe('exhausted');
    expect(out.q('wab-credits')!.textContent).toContain('Used up');
    expect(out.q('wab-credits')!.textContent).toContain('on hold');
    expect(out.q('wab-credits')!.textContent).toContain('Contact Prefrontal to add credits');
  });

  it('a connected lab whose payment is failing (sending from the shared number meanwhile) sees its credits too', () => {
    const p = make(VIEW(OWN_BILLING({ payment: { status: 'failed', reason: null, checkedAt: null, failedAt: null, fallingBack: true } }),
      CREDITS({ tracked: true, balance: 40, lowThreshold: 20 })));
    expect(p.q('wab-credits')).not.toBeNull();
  });
});

describe('WhatsApp billing helpers', () => {
  it('formats rupees with Indian grouping and labels the payment status', () => {
    expect(inr(1234567.5)).toBe('₹12,34,567.50');
    expect(inr(0)).toBe('₹0.00');
    expect(inr(null)).toBe('—');
    expect(waPaymentLabel('set')).toEqual({ label: 'Payment method set', tone: 'ok' });
    expect(waPaymentLabel('missing').tone).toBe('wait');
    expect(waPaymentLabel('failed').tone).toBe('bad');
    expect(waPaymentLabel(undefined).label).toBe('Payment not checked yet');
  });

  it('parses typed amounts: blank = null, junk = undefined, rupee signs and commas ignored', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount(' ₹1,200.456 ')).toBe(1200.46);
    expect(parseAmount('-5')).toBeUndefined();
    expect(parseAmount('abc')).toBeUndefined();
  });
});
