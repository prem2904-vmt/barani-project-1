import { HttpClient } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { PlatformService } from './platform.service';
import { ApiError } from '../../shared/models/api-response.model';
import {
  OUTSOURCED_PAGE_SIZE, OutsourcedPage, OutsourcedServerCounts, OutsourcedStatusFilter, OutsourcedTube, PartnerReport,
  PdfParts, countByStatus, filterOutsourced, outsourcedPageUrl, partnerOptions,
} from '../../features/frontdesk/outsourced/outsourced-view';

/** The lab window the tab covers by default (DB optimisation: a
 *  wide-but-bounded window, paged, rather than everything in it loaded at
 *  once) — `windowDays()` below can widen it (P2-11: a custom work-card
 *  range further back than this must not be silently cut). */
const OUTSOURCED_DAYS_DEFAULT = 90;

/**
 * The Frontdesk outsourcing desk: the "Outsourced" tab's rows + filters, and
 * the partner-report upload → Completed flow (backend OutsourcingService).
 * The query is set by the work card's header search; status / partner are
 * the classic design's in-list filters (the new design has none).
 *
 * Server paging (release 2026-10-01): the unpaged endpoint loaded the WHOLE
 * 90-day window's relational graph on every call (~125 ms). `load()` now
 * pulls ONE page (status / partnerId applied server-side — changing either
 * resets to page 1); `loadMore()` appends the next page. An older server
 * (or no paging support) still answers a plain array — handled the same way
 * as the report queue (report-summary.ts / report-queue.component.ts).
 * The work card's free-text SEARCH stays client-side, over whatever pages
 * are currently loaded (it never had server support, and still doesn't) —
 * "Load more" (or narrow by status / partner) before searching an older row.
 */
@Injectable({ providedIn: 'root' })
export class OutsourcingService {
  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);
  private readonly platform = inject(PlatformService);

  private readonly _rows = signal<OutsourcedTube[]>([]);
  private readonly _loading = signal(false);
  private readonly _loadingMore = signal(false);
  readonly rows = this._rows.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly loadingMore = this._loadingMore.asReadonly();

  readonly query = signal('');
  readonly status = signal<OutsourcedStatusFilter>('outsourced');
  readonly partnerId = signal<string | null>(null);
  /** The server `days` window (P2-11) — only ever widened by
   *  merged-outsourced-loader.ts, from the work card's date range; the
   *  dedicated Outsourced tab doesn't own window-sizing, it just inherits
   *  whatever the merged list last computed (or the default, 90). */
  readonly windowDays = signal(OUTSOURCED_DAYS_DEFAULT);

  /** The front desk's DATE filter (work card range) — null = every row. Status
   *  and date are independent filters; counts follow the date range. */
  readonly dateWindow = signal<((t: OutsourcedTube) => boolean) | null>(null);
  /** Every row within the current date window, BOTH statuses — unaffected by
   *  `status()` / `partnerId()` / `query()` (those layer on top, in
   *  `visible()`, for the dedicated Outsourced tab). The frontdesk merged
   *  work list reads this directly: it needs to know about a completed
   *  outsourced tube too (an order that is ONLY outsourced must still get a
   *  merged row — work-merge.ts's `synthesize`), not just whichever status
   *  the Outsourced tab's own filter happens to be showing. */
  readonly windowed = computed(() => {
    const w = this.dateWindow();
    return w ? this._rows().filter(w) : this._rows();
  });

  readonly visible = computed(() =>
    filterOutsourced(this.windowed(), { query: this.query(), status: this.status(), partnerId: this.partnerId() }));
  readonly partners = computed(() => partnerOptions(this._rows()));
  /** The server's whole-window totals when paging answered them (cheap, a
   *  lean scan — see OutsourcingService.CountsAsync, mw); the old
   *  client-computed-from-what's-loaded count otherwise (unpaged server, or
   *  before the first page lands). */
  private readonly _serverCounts = signal<OutsourcedServerCounts | null>(null);
  readonly counts = computed(() => this._serverCounts() ?? countByStatus(this.windowed()));

  private readonly _total = signal<number | null>(null);
  /** The SERVER's own hasMore flag (page*pageSize<total), set verbatim from
   *  each paged response — P0-1: deriving this from `_rows().length < total`
   *  instead broke under a shifting window (a new tube inserted ahead of the
   *  current offset shifts every later page, so a 'more' fetch can return
   *  rows we already have; after dedup `_rows().length` then never catches
   *  up to `_total()`, and since `_page` keeps incrementing regardless, the
   *  loop never terminated). The server's flag is authoritative and immune
   *  to client-side dedup. */
  private readonly _serverHasMore = signal(false);
  private _page = 0;
  private _seq = 0;
  /** More pages beyond what's loaded (false once an unpaged server answered,
   *  or nothing's been fetched yet — no "Load more" either way). */
  readonly hasMore = this._serverHasMore.asReadonly();
  /** Rows the next page brings ("Load 50 more") — an ESTIMATE from the
   *  deduped count vs the server total; can read a little off under a
   *  shifting window (see `hasMore` above), never a correctness issue since
   *  `hasMore`/`loadAll`'s own stop conditions don't depend on it. */
  readonly nextCount = computed(() =>
    Math.max(0, Math.min(OUTSOURCED_PAGE_SIZE, (this._total() ?? 0) - this._rows().length)));

  /** loadAll() stopped at the cap (or its iteration guard) with more rows
   *  still on the server — an honest "there's more than we're showing"
   *  signal (never silently dropped). Cleared on the next successful
   *  reset-mode fetch. */
  private readonly _truncated = signal(false);
  readonly truncated = this._truncated.asReadonly();
  private static readonly LOAD_ALL_CAP = 1000;

  get apiBase(): string { return this.platform.getApiUrl(); }

  /** What status/partnerId/days `_rows()` currently holds (null = nothing
   *  fetched yet, or the last fetch failed). Set from {@link fetch} on every
   *  successful reset — lets {@link ensureLoaded} / {@link loadAll} tell "we
   *  already have this filter's data" from "this is a different filter (or
   *  window), or nothing at all" without re-fetching just to find out.
   *  Deliberately NOT keyed on `_rows().length > 0` (P2-12): an empty result
   *  for a filter is still a loaded, current answer — without this, a
   *  tenant/branch/date range with zero outsourced rows would re-fetch on
   *  every single refresh() forever. */
  private _loadedFor: { status: OutsourcedStatusFilter; partnerId: string | null; days: number } | null = null;
  private matchesLoaded(): boolean {
    const f = this._loadedFor;
    return !!f && f.status === this.status() && f.partnerId === this.partnerId() && f.days === this.windowDays();
  }

  /** Page 1 for the current status / partner filter. */
  async load(): Promise<void> { await this.fetch('reset'); }

  /** Make sure SOMETHING is loaded for the current status / partnerId / days
   *  — a no-op when we already have it (same filter, same window), so the
   *  dedicated Outsourced tab never re-fetches page 1 just because it
   *  mounted, when the frontdesk merged list (or an earlier visit) already
   *  loaded this exact filter — same status ('all' in the new design, which
   *  is also what the merged list always uses), the same partner and the
   *  same day window. */
  async ensureLoaded(): Promise<void> {
    if (this.matchesLoaded()) return;
    await this.fetch('reset');
  }

  /** The next page, appended. A no-op mid-fetch or once every row is loaded. */
  async loadMore(): Promise<void> {
    if (this._loadingMore() || !this.hasMore()) return;
    await this.fetch('more');
  }

  /**
   * EVERY row for the current status / partnerId, not just one page — the
   * frontdesk merged list needs the whole window (an order that is only
   * outsourced must still show up, wherever its tube sorts in the window),
   * unlike the dedicated tab's own "Load more" pacing. Resumes a partial
   * load for the SAME filter instead of restarting it; capped at
   * {@link LOAD_ALL_CAP} rows AND at a hard iteration ceiling (P0-1 belt and
   * braces: stop the moment a page adds nothing new, or comes back shorter
   * than a full page — either means the server has nothing more to give,
   * REGARDLESS of what the row-count cap or `hasMore` say) — a pathological
   * or shifting window can never hang the UI. `truncated()` then reports
   * there's more than we loaded. A no-op once everything for this filter is
   * already in (no chip toggling between this and the dedicated tab ever
   * double-fetches the same page).
   */
  async loadAll(cap = OutsourcingService.LOAD_ALL_CAP): Promise<void> {
    if (!this.matchesLoaded()) await this.fetch('reset');
    const maxIterations = Math.ceil(cap / OUTSOURCED_PAGE_SIZE) + 2; // a hard ceiling, independent of hasMore/cap drift
    for (let i = 0; this.hasMore() && this._rows().length < cap && i < maxIterations; i++) {
      const result = await this.fetch('more');
      // `result.pageSize` is the SERVER's own stated page size (not just the
      // client's requested OUTSOURCED_PAGE_SIZE) — a short page always means
      // the last one, whatever size the server actually used.
      if (!result || result.added === 0 || result.rawCount < result.pageSize) break;
    }
    this._truncated.set(this.hasMore());
  }

  /** Sets status (+ the day window) and fetches the full window for them —
   *  used by the frontdesk merged list (merged-outsourced-loader.ts).
   *  Setting `status()` / `windowDays()` directly would ALSO trigger the
   *  generic filter-change effect below — a second, RACING reset that could
   *  supersede this method's own and leave it exiting early (P2-12). This
   *  owns the whole transition instead, so there's only ever one. */
  async loadAllFor(status: OutsourcedStatusFilter, days: number, cap = OutsourcingService.LOAD_ALL_CAP): Promise<void> {
    const changing = this.status() !== status || this.windowDays() !== days;
    if (changing) this._ownTransition = true;
    this.windowDays.set(days);
    this.status.set(status);
    try {
      await this.loadAll(cap);
    } finally {
      this._ownTransition = false;
    }
  }

  /** True while {@link loadAllFor} is managing a status/window transition
   *  itself — the generic effect below skips its own redundant reset. */
  private _ownTransition = false;
  // status / partnerId / days are also applied server-side — any changing
  // means a different page 1, not just a different client-side slice of one.
  private readonly _refetchOnFilterChange = effect(() => {
    this.status(); this.partnerId(); this.windowDays(); // tracked
    untracked(() => {
      if (this._ownTransition) return; // loadAllFor() already owns this transition
      if (this._rows().length === 0 && this._total() === null) return; // nothing loaded yet — load() will do the first fetch
      void this.fetch('reset');
    });
  });
  private async fetch(mode: 'reset' | 'more'): Promise<{ rawCount: number; added: number; pageSize: number } | null> {
    const seq = ++this._seq;
    const page = mode === 'more' ? this._page + 1 : 1;
    const filter = { status: this.status(), partnerId: this.partnerId(), days: this.windowDays() };
    // A fresh page-1 fetch starts a new story — any earlier loadAll() cap is
    // stale the moment the filter (or the branch) resets; loadAll() sets its
    // own truncated() again if THIS fetch also needs more than it gets.
    if (mode === 'reset') this._truncated.set(false);
    if (mode === 'more') this._loadingMore.set(true); else this._loading.set(true);
    try {
      const url = outsourcedPageUrl({ page, pageSize: OUTSOURCED_PAGE_SIZE, ...filter });
      const res = await firstValueFrom(this.api.get<OutsourcedTube[] | OutsourcedPage | null>(url));
      if (seq !== this._seq) return null;
      if (!res || Array.isArray(res)) {
        // No paging support (an older server) — the old unpaged array. There
        // is no "next page" concept here — report it as a short/last page so
        // a loadAll() loop never tries to continue past it.
        const items = res ?? [];
        this._rows.set(items);
        this._total.set(null);
        this._serverCounts.set(null);
        this._serverHasMore.set(false);
        this._page = 1;
        this._loadedFor = filter;
        return { rawCount: items.length, added: items.length, pageSize: items.length };
      }
      const items = res.items ?? [];
      let added = items.length;
      if (mode === 'more') {
        const seen = new Set(this._rows().map(r => r.sampleId));
        const fresh = items.filter(r => !seen.has(r.sampleId));
        added = fresh.length;
        this._rows.update(cur => [...cur, ...fresh]);
      } else {
        this._rows.set(items);
      }
      this._total.set(res.total);
      this._serverCounts.set(res.counts);
      this._serverHasMore.set(res.hasMore);
      this._page = page;
      this._loadedFor = filter;
      return { rawCount: items.length, added, pageSize: res.pageSize ?? OUTSOURCED_PAGE_SIZE };
    } catch {
      if (mode === 'reset') {
        this._rows.set([]); this._total.set(null); this._serverCounts.set(null);
        this._serverHasMore.set(false); this._loadedFor = null;
      }
      return null;
    } finally {
      if (seq === this._seq) { this._loading.set(false); this._loadingMore.set(false); }
    }
  }

  /** Drop the cached rows (branch switch: they belong to the old branch). */
  reset(): void {
    this._rows.set([]);
    this._total.set(null);
    this._serverHasMore.set(false);
    this._serverCounts.set(null);
    this._truncated.set(false);
    this._loadedFor = null;
    this._page = 0;
  }

  /** Upload the partner lab's report file; returns its stored URL. */
  async upload(file: File): Promise<string> {
    const fd = new FormData();
    fd.append('file', file, file.name);
    try {
      const resp = await firstValueFrom(this.http.post<{ success: boolean; data?: { url: string }; message?: string }>(
        `${this.apiBase}/api/uploads/external-report`, fd));
      if (!resp?.success || !resp.data?.url) throw new ApiError(resp?.message ?? 'Upload failed');
      return resp.data.url;
    } catch (e) {
      throw ApiError.from(e);
    }
  }

  /** Attach (or replace) the partner report and mark the lines Completed.
   *  `file` = null re-completes with the file already attached. */
  async complete(orderTestIds: string[], file: { url: string; name: string; type: string } | null,
                 attachToReport?: boolean): Promise<OutsourcedTube[]> {
    const updated = await firstValueFrom(this.api.post<OutsourcedTube[]>('/api/samples/outsourced/complete', {
      orderTestIds, fileUrl: file?.url ?? null, fileName: file?.name ?? null, contentType: file?.type ?? null,
      ...(attachToReport === undefined ? {} : { attachToReport }),
    }));
    this.merge(updated);
    return updated ?? [];
  }

  /** "Attach to our report" on / off later — the patient's combined PDF
   *  follows at once (it is derived on the server). */
  async setAttachToReport(orderTestIds: string[], attach: boolean): Promise<OutsourcedTube[]> {
    const updated = await firstValueFrom(this.api.post<OutsourcedTube[]>('/api/samples/outsourced/attach', { orderTestIds, attach }));
    this.merge(updated);
    return updated ?? [];
  }

  /** Undo Completed (caller confirms first). The file stays attached. */
  async reopen(orderTestIds: string[]): Promise<void> {
    const updated = await firstValueFrom(this.api.post<OutsourcedTube[]>('/api/samples/outsourced/reopen', { orderTestIds }));
    this.merge(updated);
  }

  /** What the report's delivered PDF actually contains, per attached
   *  partner file (joined or not, and why). */
  pdfParts(reportId: string): Promise<PdfParts> {
    return firstValueFrom(this.api.get<PdfParts>(`/api/reports/${encodeURIComponent(reportId)}/pdf-parts`));
  }

  partnerReports(orderId: string): Promise<PartnerReport[]> {
    return firstValueFrom(this.api.get<PartnerReport[]>(`/api/orders/${orderId}/partner-reports`));
  }

  private merge(updated: OutsourcedTube[] | null | undefined): void {
    if (!updated?.length) return;
    const byId = new Map(updated.map(r => [r.sampleId, r]));
    this._rows.update(list => list.map(r => byId.get(r.sampleId) ?? r));
  }
}
