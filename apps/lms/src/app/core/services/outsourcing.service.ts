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

/** The lab window the tab covers (DB optimisation: a wide-but-bounded window,
 *  paged, rather than everything in it loaded at once). */
const OUTSOURCED_DAYS = 90;

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

  /** The front desk's DATE filter (work card range) — null = every row. Status
   *  and date are independent filters; counts follow the date range. */
  readonly dateWindow = signal<((t: OutsourcedTube) => boolean) | null>(null);
  private readonly windowed = computed(() => {
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
  private _page = 0;
  private _seq = 0;
  /** More pages beyond what's loaded (null total = an unpaged server, or
   *  nothing fetched yet — no "Load more" either way). */
  readonly hasMore = computed(() => {
    const t = this._total();
    return t != null && this._rows().length < t;
  });
  /** Rows the next page brings ("Load 50 more"). */
  readonly nextCount = computed(() =>
    Math.max(0, Math.min(OUTSOURCED_PAGE_SIZE, (this._total() ?? 0) - this._rows().length)));

  get apiBase(): string { return this.platform.getApiUrl(); }

  /** Page 1 for the current status / partner filter. */
  async load(): Promise<void> { await this.fetch('reset'); }

  /** The next page, appended. A no-op mid-fetch or once every row is loaded. */
  async loadMore(): Promise<void> {
    if (this._loadingMore() || !this.hasMore()) return;
    await this.fetch('more');
  }

  // status / partnerId are also applied server-side — either changing means
  // a different page 1, not just a different client-side slice of page 1.
  private readonly _refetchOnFilterChange = effect(() => {
    this.status(); this.partnerId(); // tracked
    untracked(() => {
      if (this._rows().length === 0 && this._total() === null) return; // nothing loaded yet — load() will do the first fetch
      void this.fetch('reset');
    });
  });
  private async fetch(mode: 'reset' | 'more'): Promise<void> {
    const seq = ++this._seq;
    const page = mode === 'more' ? this._page + 1 : 1;
    if (mode === 'more') this._loadingMore.set(true); else this._loading.set(true);
    try {
      const url = outsourcedPageUrl({
        days: OUTSOURCED_DAYS, page, pageSize: OUTSOURCED_PAGE_SIZE, status: this.status(), partnerId: this.partnerId(),
      });
      const res = await firstValueFrom(this.api.get<OutsourcedTube[] | OutsourcedPage | null>(url));
      if (seq !== this._seq) return;
      if (!res || Array.isArray(res)) {
        // No paging support (an older server) — the old unpaged array.
        this._rows.set(res ?? []);
        this._total.set(null);
        this._serverCounts.set(null);
        this._page = 1;
        return;
      }
      const items = res.items ?? [];
      if (mode === 'more') {
        const seen = new Set(this._rows().map(r => r.sampleId));
        this._rows.update(cur => [...cur, ...items.filter(r => !seen.has(r.sampleId))]);
      } else {
        this._rows.set(items);
      }
      this._total.set(res.total);
      this._serverCounts.set(res.counts);
      this._page = page;
    } catch {
      if (mode === 'reset') { this._rows.set([]); this._total.set(null); this._serverCounts.set(null); }
    } finally {
      if (seq === this._seq) { this._loading.set(false); this._loadingMore.set(false); }
    }
  }

  /** Drop the cached rows (branch switch: they belong to the old branch). */
  reset(): void {
    this._rows.set([]);
    this._total.set(null);
    this._serverCounts.set(null);
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
