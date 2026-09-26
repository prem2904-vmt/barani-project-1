import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { SettingAdapter, WholeObjectStore } from './adapter';

type Obj = Record<string, unknown>;

/** Same defaults as the Bill designer (Billing Config → Invoice). */
const DEFAULTS: Obj = {
  documentMode: 'auto', showGstin: true, showTrackingQr: true, template: 'classic',
  accentColor: '#1B3A6B', showLogo: true, paperSize: 'a4',
};

/**
 * Bill look (GET / POST /api/config/invoice-template, whole object). The
 * letterhead text, logo and colours stay in the Bill designer; Settings only
 * flips the style, paper and what prints — every other field is re-fetched
 * and sent back untouched.
 */
@Injectable({ providedIn: 'root' })
export class InvoiceTemplateAdapter extends WholeObjectStore<Obj> implements SettingAdapter {
  private readonly api = inject(ApiService);

  protected fetch(): Observable<Obj> { return this.api.get<Obj>('/api/config/invoice-template'); }
  protected save(o: Obj): Observable<unknown> { return this.api.post('/api/config/invoice-template', o); }
  protected defaults(): Obj { return { ...DEFAULTS }; }

  read(key: string): unknown { return this.obj(null)[key] ?? DEFAULTS[key]; }
  write(key: string, value: unknown): Promise<void> { return this.mutate(null, (o) => ({ ...o, [key]: value })); }
}
