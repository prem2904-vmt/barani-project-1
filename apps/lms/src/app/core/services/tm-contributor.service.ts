import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from '../auth/auth.service';
import { TM_CONTRIBUTOR_CHANGES_URL } from '../../shared/utils/tm-proposals';
import type { PriceWriteItem } from '../../shared/utils/test-pricing';

/** What the server answers for a contributor's save (TestMasterToolService ProposeResult). */
export interface TmSentForApproval {
  created: Array<{ id: string; kind: string; target: string; summary: string; clinical: boolean }>;
  skipped: Array<{ index: number; code: string; message: string }>;
}

/**
 * "Send for approval" (Settings access, owner 2026-11-18): a Test Master CONTRIBUTOR's Save goes here instead of the
 * direct write — each call stores PENDING changes a Test Master admin approves one by one (Pending changes). The server
 * decides (it refuses anyone who is not a contributor or editor); this only routes the save.
 */
@Injectable({ providedIn: 'root' })
export class TmContributorService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService, { optional: true });

  /** A contributor in Test Master — no editor permission of their own. No session (unit hosts) = not a contributor. */
  isContributor(): boolean {
    const a = this.auth;
    return !!a && typeof a.settingsLevel === 'function' && a.settingsLevel('test_master') === 'contributor';
  }

  /** One test's changed fields (the same keys the editor would PATCH). */
  proposeUpdate(testId: string, fields: Record<string, unknown>, reason?: string): Observable<TmSentForApproval> {
    return this.api.post<TmSentForApproval>(`${TM_CONTRIBUTOR_CHANGES_URL}/test-update`, { testId, fields, ...(reason ? { reason } : {}) });
  }

  /** A new test (the code is given at approval). */
  proposeCreate(fields: Record<string, unknown>, price?: number): Observable<TmSentForApproval> {
    const { price: _drop, taxSlab: _t, testCode: _c, ...rest } = fields as Record<string, unknown> & { price?: unknown; taxSlab?: unknown; testCode?: unknown };
    return this.api.post<TmSentForApproval>(`${TM_CONTRIBUTOR_CHANGES_URL}/test-create`, { fields: rest, ...(price != null && price > 0 ? { price } : {}) });
  }

  /** Price lines (the pricing table's / grid's / editor's price writes). */
  proposePrices(items: PriceWriteItem[]): Observable<TmSentForApproval> {
    const changes = items
      .filter((i) => i.price !== undefined || i.taxSlab !== undefined)
      .map((i) => ({ testId: i.testId, ...(i.price != null ? { price: i.price } : {}), ...(i.taxSlab != null ? { taxSlab: i.taxSlab } : {}),
        ...(i.specimenCode ? { specimenCode: i.specimenCode } : {}) }));
    return this.api.post<TmSentForApproval>(`${TM_CONTRIBUTOR_CHANGES_URL}/prices`, { changes });
  }
}
