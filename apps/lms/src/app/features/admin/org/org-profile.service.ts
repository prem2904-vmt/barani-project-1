import { Injectable, computed, inject } from '@angular/core';
import { Observable, concat, defer, map, of, switchMap, toArray } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import type { Tenant, TenantBrandingMode } from '../../../shared/models/tenant.model';

/** What the Organization profile page edits: set ONCE, used everywhere. */
export interface OrgProfile {
  name: string;
  brandingName: string;
  brandingMode: TenantBrandingMode;
  logoUrl: string;
}

/** The two letterhead stores that carry their own copy of the name + logo. Both keep their other fields untouched. */
export const REPORT_TEMPLATE_URL = '/api/config/report-template';
export const INVOICE_TEMPLATE_URL = '/api/config/invoice-template';

interface LetterheadRow { labName?: string; logoUrl?: string; [k: string]: unknown }

/** True when a letterhead store prints a different name or logo than the profile says. */
export function letterheadDiffers(row: LetterheadRow | null | undefined, p: Pick<OrgProfile, 'name' | 'logoUrl'>): boolean {
  if (!row) return !!(p.name || p.logoUrl);   // nothing saved yet: the first save writes the profile
  return (row.labName ?? '') !== p.name || (row.logoUrl ?? '') !== p.logoUrl;
}

/**
 * The ONE owner of the organization's name and logo (Settings re-home, owner 2026-11-17).
 *
 * The server still stores them in three places — the tenant (name, top-bar short name + logo), the report template
 * (`labName`, `logoUrl`) and the bill / invoice template (same two fields). No migration: this service is the single
 * WRITER, and saves all three through their existing APIs and payloads in one go. The report and bill editors only
 * READ the profile (read-only, "Change in Organization profile"); their other letterhead fields (tagline, NABL, colours,
 * signatory …) are merged back untouched.
 */
@Injectable({ providedIn: 'root' })
export class OrgProfileService {
  private readonly api = inject(ApiService);
  private readonly tenantState = inject(TenantStateService);

  /** The profile as the app knows it now (what the letterheads show read-only). */
  readonly name = computed(() => this.tenantState.tenant()?.name ?? '');
  readonly logoUrl = computed(() => this.tenantState.tenant()?.logoUrl ?? '');

  ensureLoaded(): void { this.tenantState.ensureLoaded(); }

  /** Write the profile everywhere. `prev` is what the page loaded, so a store is only written when it differs
   *  (the tenant's name and branding are two PATCHes, as before; the letterheads are re-posted with the other
   *  fields merged back). Emits once, when every write has finished. */
  saveEverywhere(next: OrgProfile, prev: OrgProfile): Observable<void> {
    const steps: Observable<unknown>[] = [];
    if (next.name.trim() !== prev.name) {
      steps.push(this.api.patch<Tenant>('/api/tenants/current', { name: next.name.trim() }).pipe(map(t => { if (t) this.tenantState.update(t); })));
    }
    if (next.brandingName !== prev.brandingName || next.brandingMode !== prev.brandingMode || next.logoUrl !== prev.logoUrl) {
      steps.push(this.api.patch<Tenant>('/api/tenants/current', {
        brandingName: next.brandingName || null,
        brandingMode: next.brandingMode,
        logoUrl: next.logoUrl || '',
      }).pipe(map(t => { if (t) this.tenantState.update(t); })));
    }
    const target = { name: next.name.trim(), logoUrl: next.logoUrl };
    for (const url of [REPORT_TEMPLATE_URL, INVOICE_TEMPLATE_URL]) steps.push(this.syncLetterhead(url, target));
    return concat(...steps).pipe(toArray(), map(() => undefined));
  }

  /** GET the letterhead row, and POST it back with the profile's name + logo only when they differ. */
  syncLetterhead(url: string, p: Pick<OrgProfile, 'name' | 'logoUrl'>): Observable<unknown> {
    return defer(() => this.api.get<LetterheadRow | null>(url)).pipe(
      switchMap(row => letterheadDiffers(row, p)
        ? this.api.post(url, { ...(row ?? {}), labName: p.name, logoUrl: p.logoUrl })
        : of(null)),
    );
  }

  /** What the two letterheads print now, for the "reports and bills" status line. */
  letterheadStatus(): Observable<{ report: LetterheadRow | null; invoice: LetterheadRow | null }> {
    return defer(() => this.api.get<LetterheadRow | null>(REPORT_TEMPLATE_URL)).pipe(
      switchMap(report => this.api.get<LetterheadRow | null>(INVOICE_TEMPLATE_URL).pipe(map(invoice => ({ report: report ?? null, invoice: invoice ?? null })))),
    );
  }
}
