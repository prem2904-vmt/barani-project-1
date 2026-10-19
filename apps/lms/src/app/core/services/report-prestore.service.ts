import { Injectable, Injector, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { storedReportBlob } from '../../shared/utils/report-blob';

/** The slice of a report summary this service reads. */
interface ReportSummary { id: string; type?: string; storedPdfKey?: string | null }

/**
 * Store the order's FINAL report PDF right after a validation produces it —
 * in the validator's browser, in the background.
 *
 * The server auto-generates the final report when the last result is
 * validated, but never renders PDFs (report-immutable-blob: the browser
 * renders once from the saved snapshot and uploads). The WhatsApp auto-send
 * attaches that STORED PDF, so storing it now — instead of on the first staff
 * view — lets the patient's message carry the PDF within seconds. Never blocks
 * the validator and never shows an error: if it can't store now, the first
 * view stores it, and WhatsApp falls back to the link after its wait.
 */
@Injectable({ providedIn: 'root' })
export class ReportPrestoreService {
  private readonly api = inject(ApiService);
  private readonly injector = inject(Injector);

  /** The renderer/uploader — the shared stored-PDF path (swappable in specs). */
  store: (rep: ReportSummary) => Promise<unknown> = (rep) => storedReportBlob(rep, this.api, this.injector);

  /** Fire-and-forget after a validate call on an order's test. */
  afterValidation(orderId: string | null | undefined): void {
    if (!orderId) return;
    void this.run(orderId);
  }

  /** Awaitable form (specs). True when a PDF was rendered + stored. */
  async run(orderId: string): Promise<boolean> {
    try {
      const rep = await firstValueFrom(this.api.get<ReportSummary | null>(
        `/api/reports/by-order/${encodeURIComponent(orderId)}?view=summary`));
      // Only the live FINAL (a partial never goes on WhatsApp); already stored → nothing to do.
      if (!rep || rep.type !== 'final' || rep.storedPdfKey) return false;
      await this.store(rep);
      return true;
    } catch {
      return false;   // not complete yet / offline — the first view stores it
    }
  }
}
