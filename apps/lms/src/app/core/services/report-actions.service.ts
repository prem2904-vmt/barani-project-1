import { Injectable, Injector, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { ApiService } from './api.service';
import { DialogService } from './dialog.service';
import { ToastService } from './toast.service';
import { orderReportQrUrl } from '../../shared/utils/patient-strip-qr';
import { copyText, shareLink, shareRoute, shareHint, type ShareEnv, type ShareOutcome } from '../../shared/utils/report-share';
import { waLink } from '../../shared/utils/whatsapp';
import { printPdfBlobUrl } from '../../shared/utils/print-pdf';
import type { PfAction } from '../../shared/components/actions-menu/actions-menu.component';
import { WhatsAppSendService } from './whatsapp-send.service';

/** What a report row needs for the link / share / delivery actions. */
export interface ReportRef {
  id: string;
  orderId?: string | null;
  qrToken?: string | null;
  /** 'final' | 'partial' — only a final report goes through the server send. */
  type?: string | null;
}

/** ⋮ ids of the two WhatsApp rows (see `whatsAppActions`). */
export const WA_ACTION_SEND = 'whatsapp';
export const WA_ACTION_MINE = 'whatsapp-mine';

/** `GET /api/orders/{id}/track-token` — its guard (TrackingController). */
export const TRACK_TOKEN_PERMS = ['create_bill', 'view_bill', 'view_order', 'create_order'];
/** `GET /api/reports/by-order/{id}` — its guard (ReportsController). */
export const REPORT_BY_ORDER_PERMS = ['view_report', 'deliver_report', 'view_order', 'create_bill'];
/** `/reports/view/:id` — its route guard (app.routes.ts). */
export const REPORT_VIEW_PERMS = ['deliver_report', 'view_report', 'validate_result'];
/** `/frontdesk/patients/:id` — its route guard. */
export const PATIENT_PROFILE_PERMS = ['view_patient', 'register_patient'];
/** `/lab/sample/:id` (read-only lab results) — its route guard. */
export const LAB_RESULTS_PERMS = ['enter_result', 'edit_result', 'validate_result'];

/**
 * The report ⋮ menu's SHARED actions — the pieces every report screen offers
 * the same way. Everything here reuses an endpoint and a flow that already
 * exist; nothing new is exposed publicly:
 *
 * - **Patient link**: the order's public tracking page `/track/{token}`
 *   (`GET /api/orders/{id}/track-token`, the invoice QR's token — it never
 *   expires). Without that permission (or if the call fails) it falls back to
 *   the report's own public link `/reports/public/{qrToken}` — the one the
 *   WhatsApp message already carries.
 * - **Share…**: the platform ladder in `shared/utils/report-share.ts`.
 * - **Download / Print / WhatsApp** for screens that only hold a stored
 *   report (patient profile): the same recipes the Results list runs
 *   (`report-blob`, letterpad choice, wa.me + `POST /deliver`).
 */
@Injectable({ providedIn: 'root' })
export class ReportActionsService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly injector = inject(Injector);

  /** Specs swap the platform in; the app reads the real window. */
  shareEnv: ShareEnv | undefined;

  /** orderId (or report id) → resolved link, so a prefetch on menu-open
   *  makes the tap instant (a share sheet needs the user's gesture). */
  private readonly links = new Map<string, Promise<string | null>>();

  /** Any of these permissions (hasPermission per code — works with every
   *  AuthService shape the specs provide). */
  private any(perms: string[]): boolean { return perms.some(p => this.auth.hasPermission(p)); }

  private base(): string { return (environment.reportPublicBaseUrl ?? '').replace(/\/+$/, ''); }

  /** May this user hand the patient link out (Share… / Copy patient link),
   *  and can one be produced? Handing a report to the patient is DELIVERY —
   *  the same deliver_report the WhatsApp send needs; view-only readers and
   *  validators never get it. */
  canLink(r: ReportRef | null | undefined): boolean {
    if (!r || !this.auth.hasPermission('deliver_report')) return false;
    return (!!r.orderId && this.any(TRACK_TOKEN_PERMS)) || !!r.qrToken;
  }

  /** The patient-facing link (see class doc), cached per order. */
  patientLink(r: ReportRef): Promise<string | null> {
    const key = r.orderId || r.id;
    let p = this.links.get(key);
    if (!p) {
      p = this.resolveLink(r);
      this.links.set(key, p);
      // A failure is not cached: the next tap retries.
      void p.then(v => { if (!v) this.links.delete(key); });
    }
    return p;
  }

  private async resolveLink(r: ReportRef): Promise<string | null> {
    if (r.orderId && this.any(TRACK_TOKEN_PERMS)) {
      try {
        const res = await firstValueFrom(this.api.get<{ token: string }>(`/api/orders/${r.orderId}/track-token`));
        const url = orderReportQrUrl(this.base(), res?.token);
        if (url) return url;
      } catch { /* fall back to the report's own public link */ }
    }
    return r.qrToken && this.base() ? `${this.base()}/reports/public/${encodeURIComponent(r.qrToken)}` : null;
  }

  /** Warm the link when a menu opens. */
  prefetch(r: ReportRef | null | undefined): void {
    if (r && this.canLink(r)) void this.patientLink(r);
  }

  /** "Opens the share sheet" / "Copies the patient link" for this device. */
  shareHint(): string { return shareHint(shareRoute(this.shareEnv)); }

  /** Share… — the OS sheet where there is one, else copy. */
  async share(r: ReportRef, patientName?: string | null): Promise<ShareOutcome> {
    const url = await this.patientLink(r);
    if (!url) { this.toasts.error('This report has no patient link yet.'); return 'failed'; }
    const lab = this.auth.user()?.tenantName || 'the lab';
    const out = await shareLink({
      title: 'Lab report',
      text: patientName ? `Lab report for ${patientName} from ${lab}` : `Lab report from ${lab}`,
      url,
    }, this.shareEnv);
    this.announce(out, url);
    return out;
  }

  /** Copy patient link. */
  async copyLink(r: ReportRef): Promise<ShareOutcome> {
    const url = await this.patientLink(r);
    if (!url) { this.toasts.error('This report has no patient link yet.'); return 'failed'; }
    const out: ShareOutcome = (await copyText(url, this.shareEnv)) ? 'copied' : 'failed';
    this.announce(out, url);
    return out;
  }

  private announce(out: ShareOutcome, url: string): void {
    if (out === 'copied') this.toasts.success('Patient report link copied');
    // Clipboard blocked too: show the link so it can still be read out / typed.
    else if (out === 'failed') {
      void this.dialog.prompt({
        title: 'Patient report link', message: 'Copying is blocked on this device. Select the link to copy it.',
        initialValue: url, confirmLabel: 'Done',
      });
    }
  }

  // ── Stored-report flows (patient profile) ────────────────────────────

  private isNative(): boolean {
    return !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
  }

  private fileName(r: ReportRef): string {
    return `report-${r.id.replace(/-/g, '').slice(-8).toUpperCase()}.pdf`;
  }

  /** Download PDF — same render as everywhere; native → the share sheet
   *  (Save to Files), web → a file download. */
  async download(rep: ReportRef & Record<string, unknown>): Promise<boolean> {
    const { buildReportBlobUrl } = await import('../../shared/utils/report-blob');
    const url = await buildReportBlobUrl(rep, this.api, this.injector);
    if (!url) { this.toasts.error('Could not download the report'); return false; }
    try {
      if (this.isNative()) {
        const blob = await (await fetch(url)).blob();
        const file = new File([blob], this.fileName(rep), { type: 'application/pdf' });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Download report' });
          return true;
        }
      }
      const a = document.createElement('a');
      a.href = url;
      a.download = this.fileName(rep);
      document.body.appendChild(a);
      a.click();
      a.remove();
      return true;
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return false;
      this.toasts.error('Could not download the report');
      return false;
    } finally {
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* */ } }, 60_000);
    }
  }

  /** Print — letterpad choice first; a delivery record only for the
   *  delivery desk (deliver_report), exactly like the Results list. */
  async print(rep: ReportRef & Record<string, unknown>): Promise<boolean> {
    const { buildReportPrintBlobUrl } = await import('../../shared/utils/report-blob');
    const url = await buildReportPrintBlobUrl(rep, this.api, this.injector, this.dialog);
    if (url === null) return false;   // letterpad question dismissed
    if (!url) { this.toasts.error('Could not build the report to print.'); return false; }
    printPdfBlobUrl(url, { revokeOnDone: true });
    if (this.auth.hasPermission('deliver_report')) this.recordDelivery(rep, 'print');
    return true;
  }

  // ── WhatsApp: the lab's Cloud API sender, else wa.me ─────────────────

  private readonly waSend = inject(WhatsAppSendService);

  /** The ⋮ WhatsApp rows for the delivery desk. Lab sends from the server
   *  (`WhatsAppSendService.cloud()`, final report): **Send WhatsApp** (the
   *  lab's number → the patient's) + **Share via my WhatsApp** (wa.me on this
   *  device, the secondary). Otherwise today's single wa.me row. */
  whatsAppActions(r: ReportRef | null | undefined): PfAction[] {
    if (!r || !this.auth.hasPermission('deliver_report')) return [];
    if (this.waSend.canSend(r)) {
      return [
        { id: WA_ACTION_SEND, label: 'Send WhatsApp', icon: 'whatsapp', group: 'Share', hint: "Sends the report link to the patient's number" },
        { id: WA_ACTION_MINE, label: 'Share via my WhatsApp', icon: 'share', group: 'Share', hint: 'Opens WhatsApp on this device with the report link' },
      ];
    }
    return [{ id: WA_ACTION_SEND, label: 'Send on WhatsApp', icon: 'whatsapp', group: 'Share', hint: 'Opens WhatsApp with the report link' }];
  }

  /** Warm the "lab sends from the server" flag (screens call it on init —
   *  never from inside a computed). */
  warmWhatsApp(): void { this.waSend.ensure(); }

  /** "Send WhatsApp": the server send when the lab has it, else wa.me. */
  sendWhatsApp(rep: ReportRef & Record<string, unknown>, patient: { name?: string | null; phone?: string | null }): void {
    if (!this.auth.hasPermission('deliver_report')) return;
    if (this.waSend.canSend(rep)) {
      // The public link serves the archived PDF — archive it alongside (best-effort).
      void this.archive(rep);
      void this.waSend.send(rep.id);
      return;
    }
    this.whatsApp(rep, patient);
  }

  /** Send on WhatsApp — wa.me pre-filled with the report link (deliver_report). */
  whatsApp(rep: ReportRef & Record<string, unknown>, patient: { name?: string | null; phone?: string | null }): void {
    if (!this.auth.hasPermission('deliver_report')) return;
    // Archive the PDF first (background) so the public link serves the real
    // file — fired before window.open so the popup is not blocked.
    if (rep.qrToken) void this.archive(rep);
    const lab = this.auth.user()?.tenantName || 'our lab';
    const link = rep.qrToken && this.base() ? `${this.base()}/reports/public/${rep.qrToken}` : '';
    const lines = [patient.name ? `Hi ${patient.name},` : 'Hi,', `Your lab report from ${lab} is ready.`];
    if (link) lines.push(`View & download your report:\n${link}`);
    lines.push('Please contact us if you have any questions.');
    window.open(waLink(patient.phone, lines.join('\n\n')), '_blank', 'noopener');
    this.recordDelivery(rep, 'whatsapp');
  }

  private async archive(rep: ReportRef & Record<string, unknown>): Promise<void> {
    try {
      const { buildReportBlobUrl } = await import('../../shared/utils/report-blob');
      const url = await buildReportBlobUrl(rep, this.api, this.injector);
      if (!url) return;
      const blob = await (await fetch(url)).blob();
      URL.revokeObjectURL(url);
      const fd = new FormData();
      fd.append('file', blob, `${rep.id}.pdf`);
      this.api.post(`/api/reports/${rep.id}/pdf`, fd).subscribe({ next: () => {}, error: () => {} });
    } catch { /* best-effort */ }
  }

  private recordDelivery(r: ReportRef, via: string): void {
    this.api.post(`/api/reports/${r.id}/deliver`, { via, note: via === 'whatsapp' ? 'wa.me link' : null }).subscribe({
      next: () => { if (via !== 'whatsapp') this.toasts.success(`Delivered via ${via}`); },
      error: () => { /* the handover already happened; the record is best-effort */ },
    });
  }
}
