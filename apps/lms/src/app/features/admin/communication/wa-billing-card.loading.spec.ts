import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
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

function make(view: WaBillingView | unknown, opts: { perms?: string[]; sender?: WaSender; prompt?: string | null; fail?: boolean; get$?: Subject<unknown>; put$?: Subject<unknown> } = {}) {
  const perms = opts.perms ?? ['manage_tenant'];
  const api = {
    get: vi.fn((url: string) => url === '/api/whatsapp/billing'
      ? opts.get$ ?? (opts.fail ? throwError(() => new ApiError('Forbidden', 'forbidden')) : of(view))
      : of(SETTINGS(opts.sender ?? OWN_SENDER))),
    post: vi.fn(() => of(view)),
    put: vi.fn((_url: string, _body: unknown) => opts.put$ ?? of(view)),
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


describe('WhatsApp billing card — loading feedback', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('first load: the card\'s skeleton after 150ms, never a blank gap; gone when the view lands', () => {
    const get$ = new Subject<unknown>();
    const p = make(VIEW(OWN_BILLING()), { get$ });
    expect(p.q('ls-wa-billing-skeleton')).toBeNull();          // no flicker for a fast answer
    vi.advanceTimersByTime(150); p.f.detectChanges();
    expect(p.q('ls-wa-billing-skeleton')).not.toBeNull();
    get$.next(VIEW(OWN_BILLING())); get$.complete();
    p.f.detectChanges();
    expect(p.q('ls-wa-billing-card')).not.toBeNull();
    expect(p.q('ls-wa-billing-skeleton')).toBeNull();
  });

  it('"I added funds": only that button is busy (aria-busy, dots after 150ms); the others stay plain', async () => {
    vi.useRealTimers();
    const put$ = new Subject<unknown>();
    const p = make(VIEW(OWN_BILLING()), { prompt: '500', put$ });
    p.q('wab-balance-update')!.click();
    await settle(p.f);
    const funds = p.q('wab-balance-update')!;
    expect(funds.getAttribute('aria-busy')).toBe('true');
    expect((funds as HTMLButtonElement).disabled).toBe(true);
    expect(p.q('wab-refresh')!.getAttribute('aria-busy')).toBeNull();
    expect(p.q('wab-save-thresholds')!.getAttribute('aria-busy')).toBeNull();
    await new Promise(r => setTimeout(r, 170)); p.f.detectChanges();
    expect(funds.querySelector('pf-busy')).not.toBeNull();
    put$.next(VIEW(OWN_BILLING())); put$.complete();
    await new Promise(r => setTimeout(r, 320)); p.f.detectChanges();
    expect(p.q('wab-balance-update')!.getAttribute('aria-busy')).toBeNull();
  });
});
