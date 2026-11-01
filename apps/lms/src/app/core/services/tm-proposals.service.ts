import { Injectable, inject } from '@angular/core';
import { Observable, map, of, catchError } from 'rxjs';
import { ApiService } from './api.service';
import type { TmProposal, TmProposalPage } from '../../shared/models/tm-proposal.model';
import { TM_PROPOSALS_URL, tmProposalPath, tmSort } from '../../shared/utils/tm-proposals';

/** What the Pending view lists: the open rows (pending + stale + failed) or one closed status / all. */
export type TmListFilter = 'review' | 'approved' | 'rejected' | 'withdrawn' | 'expired' | 'all';

export interface TmListResult {
  items: TmProposal[];
  /** Rows matching the filter on the server (may exceed `items` — a page is ≤ 100). */
  total: number;
  /** Open rows (pending + stale + failed) the caller may see — the band badge. */
  openCount: number;
}

/**
 * Every HTTP call of the Test Master "Pending changes" inbox (prefrontal-mw
 * `api/tm-proposals`, beta `assistant`, dev only). ONE proposal per call —
 * there is no bulk method here, matching the server (owner rule).
 */
@Injectable({ providedIn: 'root' })
export class TmProposalsService {
  private readonly api = inject(ApiService);
  static readonly PAGE = 100;

  private page(status: string, take = TmProposalsService.PAGE, batchId: string | null = null): Observable<TmProposalPage> {
    const batch = batchId ? `&batchId=${encodeURIComponent(batchId)}` : '';
    return this.api.get<TmProposalPage>(`${TM_PROPOSALS_URL}?status=${encodeURIComponent(status)}&take=${take}${batch}`).pipe(
      map(p => ({
        items: Array.isArray(p?.items) ? p.items : [], total: Number(p?.total) || 0, pendingCount: Number(p?.pendingCount) || 0,
        counts: p?.counts ?? null,
      })),
    );
  }

  /** Open rows (pending + stale + failed) from the server's own counts; an older server without `counts` has only `pendingCount`. */
  private static open(p: TmProposalPage): number {
    const c = p.counts;
    return c ? (Number(c.pending) || 0) + (Number(c.stale) || 0) + (Number(c.failed) || 0) : p.pendingCount;
  }

  /**
   * The list for a filter. "Needs review" = ONE request for `pending,stale,failed`
   * (the server settles staleness first, so total, rows and counts agree). The badge
   * is the server's `counts` (pending + stale + failed), never a second read.
   */
  list(filter: TmListFilter, batchId: string | null = null): Observable<TmListResult> {
    const status = filter === 'review' ? 'pending,stale,failed' : filter;
    return this.page(status, TmProposalsService.PAGE, batchId).pipe(
      // `openCount` is the band badge: always the lab's whole open set, never just one rate-card batch.
      map(p => ({ items: tmSort(p.items), total: p.total, openCount: filter === 'review' && !batchId ? p.total : TmProposalsService.open(p) })),
    );
  }

  /** The band badge: open rows (pending + stale + failed). 0 on any failure (beta off / no permission / older server). */
  openCount(): Observable<number> {
    return this.page('pending,stale,failed', 1).pipe(
      map(p => TmProposalsService.open(p) || (p.counts ? 0 : p.total)),
      catchError(() => of(0)),
    );
  }

  get(id: string): Observable<TmProposal> {
    return this.api.get<TmProposal>(tmProposalPath(id));
  }

  /** Approve ONE change. `confirmClinical` only after the checkbox dialog (the server refuses without it). */
  approve(id: string, confirmClinical: boolean): Observable<TmProposal> {
    return this.api.post<TmProposal>(tmProposalPath(id, 'approve'), { confirmClinical });
  }

  reject(id: string, note: string | null): Observable<TmProposal> {
    const n = (note ?? '').trim();
    return this.api.post<TmProposal>(tmProposalPath(id, 'reject'), n ? { note: n } : {});
  }

  withdraw(id: string): Observable<TmProposal> {
    return this.api.post<TmProposal>(tmProposalPath(id, 'withdraw'), {});
  }

  /** "I re-checked": a changed-since-suggested (or failed) row is measured again and goes back to waiting. */
  reReview(id: string): Observable<TmProposal> {
    return this.api.post<TmProposal>(tmProposalPath(id, 're-review'), {});
  }
}
