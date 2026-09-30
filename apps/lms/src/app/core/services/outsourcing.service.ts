import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { PlatformService } from './platform.service';
import { ApiError } from '../../shared/models/api-response.model';
import {
  OutsourcedStatusFilter, OutsourcedTube, PartnerReport, countByStatus, filterOutsourced, partnerOptions,
} from '../../features/frontdesk/outsourced/outsourced-view';

/**
 * The Frontdesk outsourcing desk: the "Outsourced" tab's rows + filters, and
 * the partner-report upload → Completed flow (backend OutsourcingService).
 * The query is set by the work card's header search; status / partner are
 * the classic design's in-list filters (the new design has none).
 */
@Injectable({ providedIn: 'root' })
export class OutsourcingService {
  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);
  private readonly platform = inject(PlatformService);

  private readonly _rows = signal<OutsourcedTube[]>([]);
  private readonly _loading = signal(false);
  readonly rows = this._rows.asReadonly();
  readonly loading = this._loading.asReadonly();

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
  readonly counts = computed(() => countByStatus(this.windowed()));

  get apiBase(): string { return this.platform.getApiUrl(); }

  async load(): Promise<void> {
    this._loading.set(true);
    try {
      this._rows.set((await firstValueFrom(this.api.get<OutsourcedTube[]>('/api/samples/outsourced?days=90'))) ?? []);
    } catch {
      this._rows.set([]);
    } finally {
      this._loading.set(false);
    }
  }

  /** Drop the cached rows (branch switch: they belong to the old branch). */
  reset(): void {
    this._rows.set([]);
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
  async complete(orderTestIds: string[], file: { url: string; name: string; type: string } | null): Promise<void> {
    const updated = await firstValueFrom(this.api.post<OutsourcedTube[]>('/api/samples/outsourced/complete', {
      orderTestIds, fileUrl: file?.url ?? null, fileName: file?.name ?? null, contentType: file?.type ?? null,
    }));
    this.merge(updated);
  }

  /** Undo Completed (caller confirms first). The file stays attached. */
  async reopen(orderTestIds: string[]): Promise<void> {
    const updated = await firstValueFrom(this.api.post<OutsourcedTube[]>('/api/samples/outsourced/reopen', { orderTestIds }));
    this.merge(updated);
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
