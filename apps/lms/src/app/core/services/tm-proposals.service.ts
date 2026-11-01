import { Injectable, inject } from '@angular/core';
import { Observable, concat, forkJoin, map, of, toArray, catchError, last } from 'rxjs';
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

  private page(status: string, take = TmProposalsService.PAGE): Observable<TmProposalPage> {
    return this.api.get<TmProposalPage>(`${TM_PROPOSALS_URL}?status=${encodeURIComponent(status)}&take=${take}`).pipe(
      map(p => ({ items: Array.isArray(p?.items) ? p.items : [], total: Number(p?.total) || 0, pendingCount: Number(p?.pendingCount) || 0 })),
    );
  }

  /**
   * The list for a filter. "Needs review" = pending, then stale + failed — in that
   * ORDER: the pending read is what flips moved rows to stale (server, at list
   * time), so stale is read after it and never misses a row it just flipped.
   */
  list(filter: TmListFilter): Observable<TmListResult> {
    if (filter !== 'review') {
      return forkJoin({ page: this.page(filter), open: this.openCount() }).pipe(
        map(({ page, open }) => ({ items: tmSort(page.items), total: page.total, openCount: open })));
    }
    return concat(this.page('pending'), forkJoin([this.page('stale'), this.page('failed')])).pipe(
      toArray(),
      map(parts => {
        const pending = parts[0] as TmProposalPage;
        const [stale, failed] = parts[1] as [TmProposalPage, TmProposalPage];
        const items = tmSort([...pending.items, ...stale.items, ...failed.items]);
        // The pending read flips moved rows to stale AFTER counting, so its total can count a row the
        // stale page then lists too: trust the rows themselves unless a page was cut at PAGE.
        const cut = [pending, stale, failed].some(p => p.items.length >= TmProposalsService.PAGE);
        const total = cut ? pending.total + stale.total + failed.total : items.length;
        return { items, total, openCount: total };
      }),
    );
  }

  /** The band badge: open rows (pending + stale + failed). 0 on any failure (beta off / no permission / older server). */
  openCount(): Observable<number> {
    return concat(this.page('pending', 1), forkJoin([this.page('stale', 1), this.page('failed', 1)])).pipe(
      toArray(),
      map(parts => {
        const pending = parts[0] as TmProposalPage;
        const [stale, failed] = parts[1] as [TmProposalPage, TmProposalPage];
        return pending.total + stale.total + failed.total;
      }),
      last(),
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
