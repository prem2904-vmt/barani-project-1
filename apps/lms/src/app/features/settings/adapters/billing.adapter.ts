import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { SettingAdapter, WholeObjectStore } from './adapter';

type Obj = Record<string, unknown>;

/** Same defaults as the Billing Config page (a tenant with no row yet). */
const DEFAULTS: Obj = {
  gstEnabled: true, gstScope: 'branch', filingFrequency: 'monthly',
  allowDiscounts: true, maxDiscountPct: 10, overrideDiscountPct: 25, approvalThresholdPct: 50,
  invoicePrefix: 'INV', invoiceStartNumber: 1000, invoiceOnFullPaymentOnly: false,
  frontdeskCanSeeWalletBalance: true,
};

/**
 * Billing config (GET / POST /api/config/billing — the POST takes the WHOLE
 * object). Re-fetch-then-write via WholeObjectStore, so a field another
 * admin changed meanwhile (or one this UI never shows, like
 * frontdeskCanSeeWalletBalance) is kept. The Bill designer page writes the
 * same store.
 */
@Injectable({ providedIn: 'root' })
export class BillingAdapter extends WholeObjectStore<Obj> implements SettingAdapter {
  private readonly api = inject(ApiService);

  protected fetch(): Observable<Obj> { return this.api.get<Obj>('/api/config/billing'); }
  protected save(o: Obj): Observable<unknown> {
    const t = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).trim() || null : o[k] ?? null);
    return this.api.post('/api/config/billing', {
      ...o,
      upiVpa: t('upiVpa'), upiPayeeName: t('upiPayeeName'),
      bankAccountName: t('bankAccountName'), bankAccountNumber: t('bankAccountNumber'),
      bankIfsc: t('bankIfsc'), bankName: t('bankName'),
    });
  }
  protected defaults(): Obj { return { ...DEFAULTS }; }

  read(key: string): unknown { return this.obj(null)[key] ?? DEFAULTS[key] ?? ''; }

  write(key: string, value: unknown): Promise<void> {
    if (key.endsWith('Pct') || key === 'invoiceStartNumber') {
      const n = Number(value);
      if (value === null || value === '' || !Number.isFinite(n) || n < 0) return Promise.reject(new Error('Type a number.'));
      if (key.endsWith('Pct') && n > 100) return Promise.reject(new Error('Keep it at 100% or less.'));
      value = n;
    }
    if (key === 'invoicePrefix' && !String(value ?? '').trim()) return Promise.reject(new Error('Type how bill numbers start.'));
    return this.mutate(null, (o) => ({ ...o, [key]: value }));
  }
}
