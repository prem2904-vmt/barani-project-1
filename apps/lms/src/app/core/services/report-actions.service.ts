import { Injectable, Injector, inject } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { ApiService } from './api.service';
import { DialogService } from './dialog.service';
import { ToastService } from './toast.service';
import { orderReportQrUrl } from '../../shared/utils/patient-strip-qr';
import { copyText, shareLink, shareRoute, shareHint, type ShareEnv, type ShareOutcome } from '../../shared/utils/report-share';
import { reportPublicLink, waDisplayPhone } from '../../shared/utils/whatsapp-manual';
import { printPdfBlobUrl } from '../../shared/utils/print-pdf';
import type { PfAction } from '../../shared/components/actions-menu/actions-menu.component';
import { WhatsAppSendService } from './whatsapp-send.service';
import { WhatsAppManualService, waDoctorPhone, type WaDoctorContact, type WaRecipient } from './whatsapp-manual.service';
import { CommsShareService, looksLikeEmail } from './comms-share.service';
import { WhatsAppService } from './whatsapp.service';
import type { EmailRecipient } from '../../shared/utils/email-share';
import { smsDoctorReportMessage, smsReportMessage } from '../../shared/utils/sms-link';

/** What a report row needs for the link / share / delivery actions. */
export interface ReportRef {
  id: string;
  orderId?: string | null;
  qrToken?: string | null;
  /** 'final' | 'partial' — only a final report goes through the server send. */
  type?: string | null;
}

/** The delivery note of a manual send (WhatsApp opened on this computer). */
export const WA_MANUAL_NOTE = 'WhatsApp opened (manual)';

/** ⋮ ids of the Email / SMS rows (see `channelActions`). */
export const EMAIL_ACTION = 'email';
export const SMS_ACTION = 'sms';
/** The delivery note of an SMS Chat hand-over (Messages opened on this phone). */
export const SMS_MANUAL_NOTE = 'SMS opened (manual)';

/** What a screen knows about the recipients. `undefined` = not known here (the server decides);
 *  `null` / '' = known to be missing. */
export interface ChannelContext {
  patientEmail?: string | null;
  doctorEmail?: string | null;
  doctorName?: string | null;
  patientPhone?: string | null;
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
 *   (`report-blob`, letterpad choice, Send on WhatsApp + `POST /deliver`).
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

  /** Download PDF — the STORED report (rendered + stored once if it has
   *  none yet); native → the share sheet (Save to Files), web → a download. */
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

  // ── WhatsApp: the lab's Cloud API sender + the manual flow ───────────

  private readonly waSend = inject(WhatsAppSendService);

  /** The ⋮ WhatsApp row for the delivery desk — ONE row: **WhatsApp Auto** when the
   *  lab has it (platform switch on + a sender set up, final report: the lab's
   *  number → the patient's), else **WhatsApp Chat** when that is on (WhatsApp
   *  opens with the chat + message ready, the person presses Send), else none. */
  whatsAppActions(r: ReportRef | null | undefined): PfAction[] {
    const mode = this.waSend.mode(r);
    if (mode === 'auto') return [{ id: WA_ACTION_SEND, label: 'WhatsApp Auto', icon: 'whatsapp', group: 'Share', hint: "The lab's WhatsApp number sends the report" }];
    if (mode === 'chat') return [{ id: WA_ACTION_MINE, label: 'WhatsApp Chat', icon: 'whatsapp', group: 'Share', hint: 'Opens WhatsApp with the report ready; you press Send' }];
    return [];
  }

  /** Warm the "lab sends from the server" flag (screens call it on init —
   *  never from inside a computed). */
  warmWhatsApp(): void { this.waSend.ensure(); }

  /** The ONE WhatsApp button: WhatsApp Auto when the lab has it, else WhatsApp Chat
   *  (when that is on), else nothing.
   *  WhatsApp Auto sends to the patient AND the order's referral doctor (server side, when the doctor
   *  record has a number). WhatsApp Chat: `opts.to` = the recipient already picked (front desk menu),
   *  else the person is asked "Send to patient / Send to doctor" when a doctor number exists. */
  async sendWhatsApp(rep: ReportRef & Record<string, unknown>, patient: { name?: string | null; phone?: string | null },
    opts: { to?: WaRecipient; doctor?: WaDoctorContact | null } = {}): Promise<void> {
    if (!this.auth.hasPermission('deliver_report')) return;
    if (this.waSend.canSend(rep)) {
      this.waManual.release();   // Auto needs no WhatsApp tab
      // The public link serves the archived PDF — archive it alongside (best-effort).
      void this.archive(rep);
      void this.waSend.send(rep.id);
      return;
    }
    if (this.waSend.chatAllowed()) await this.whatsApp(rep, patient, opts);
  }

  private readonly waManual = inject(WhatsAppManualService);

  /** WhatsApp Chat — the manual flow (deliver_report): click-to-chat with
   *  the patient's chat and the report link ready; the person presses Send.
   *  Recorded as delivered once WhatsApp opened. */
  async whatsApp(rep: ReportRef & Record<string, unknown>, patient: { name?: string | null; phone?: string | null },
    opts: { to?: WaRecipient; doctor?: WaDoctorContact | null } = {}): Promise<boolean> {
    if (!this.auth.hasPermission('deliver_report') || !this.waSend.chatAllowed()) return false;
    // Archive the PDF first (background) so the public link serves the real file.
    if (rep.qrToken) void this.archive(rep);
    const out = await this.waManual.send({
      phone: patient.phone,
      patientName: patient.name,
      labName: this.auth.user()?.tenantName,
      link: reportPublicLink(this.base(), rep.qrToken),
      reportId: rep.id,
      pdf: () => this.pdfBlob(rep),
      pdfName: this.fileName(rep),
      to: opts.to,
      doctor: opts.doctor,
    });
    if (out !== 'opened') return false;
    // The referral doctor's copy is not the patient's hand-over: no delivery record.
    if (this.waManual.lastRecipient !== 'doctor') this.recordDelivery(rep, 'whatsapp');
    return true;
  }

  /** The stored PDF (desktop drag helper). */
  private async pdfBlob(rep: ReportRef & Record<string, unknown>): Promise<Blob | null> {
    const { storedReportBlob } = await import('../../shared/utils/report-blob');
    return storedReportBlob(rep, this.api, this.injector);
  }

  /** Make sure the report's PDF is STORED (the public link serves the stored
   *  file). A no-op when it already is; otherwise it is rendered once from
   *  the saved snapshot and stored. Best-effort. */
  private async archive(rep: ReportRef & Record<string, unknown>): Promise<void> {
    try {
      const { storedReportBlob } = await import('../../shared/utils/report-blob');
      await storedReportBlob(rep, this.api, this.injector);
    } catch { /* best-effort */ }
  }

  private recordDelivery(r: ReportRef, via: string): void {
    this.api.post(`/api/reports/${r.id}/deliver`, { via, note: via === 'whatsapp' ? WA_MANUAL_NOTE : null }).subscribe({
      next: () => { if (via !== 'whatsapp') this.toasts.success(`Delivered via ${via}`); },
      error: () => { /* the handover already happened; the record is best-effort */ },
    });
  }

  // ── Email + SMS Chat (2026-11-13) ────────────────────────────────────

  private readonly comms = inject(CommsShareService);
  private readonly wa = inject(WhatsAppService);

  /** Warm the email / SMS switches (screens call it on init, next to warmWhatsApp). */
  warmChannels(): void { this.comms.ensure(); }

  /** The ⋮ Email and SMS rows for the delivery desk. Email: the lab emails a FINAL report (patient,
   *  and the referral doctor when they have an email) — hidden when the screen knows nobody has one.
   *  SMS: phone / tablet only, opens the Messages app with the report link ready. */
  channelActions(r: ReportRef | null | undefined, ctx: ChannelContext = {}): PfAction[] {
    if (!r || !this.auth.hasPermission('deliver_report')) return [];
    const out: PfAction[] = [];
    const final = (r.type ?? 'final') === 'final';
    if (final && r.orderId && this.comms.emailOn() && this.emailPossible(ctx)) {
      out.push({ id: EMAIL_ACTION, label: 'Email', icon: 'mail', group: 'Share', hint: 'The lab emails the report PDF' });
    }
    if (this.comms.smsOn() && ctx.patientPhone !== null && ctx.patientPhone !== '') {
      out.push({ id: SMS_ACTION, label: 'SMS', icon: 'sms', group: 'Share', hint: 'Opens Messages with the report link ready; you press Send' });
    }
    return out;
  }

  /** Someone may have an email: either side known to have one, or nothing known here (the server decides). */
  private emailPossible(ctx: ChannelContext): boolean {
    return looksLikeEmail(ctx.patientEmail) || looksLikeEmail(ctx.doctorEmail)
      || ctx.patientEmail === undefined || ctx.doctorEmail === undefined;
  }

  /** Run an Email / SMS row; false when the id is not one of them. */
  runChannel(id: string, rep: ReportRef & Record<string, unknown>, patient: { name?: string | null; phone?: string | null }, ctx: ChannelContext = {}): boolean {
    if (id === EMAIL_ACTION) { void this.sendEmail(rep, ctx); return true; }
    if (id === SMS_ACTION) { void this.sendSms(rep, patient); return true; }
    return false;
  }

  /** Email the report from the server. With both emails known the person picks (both first, the contract's
   *  default); otherwise the server sends to whoever has one ('both'). */
  async sendEmail(rep: ReportRef, ctx: ChannelContext = {}, to?: EmailRecipient): Promise<void> {
    if (!rep.orderId || !this.auth.hasPermission('deliver_report')) return;
    let pick: EmailRecipient | undefined = to;
    if (!pick) {
      const p = looksLikeEmail(ctx.patientEmail), d = looksLikeEmail(ctx.doctorEmail);
      if (p && d) {
        const res = await this.dialog.actions({
          title: 'Email the report',
          message: `Who should get it? ${ctx.doctorName?.trim() || 'The referral doctor'}: ${ctx.doctorEmail}.`,
          actions: [
            { value: 'both', label: 'Send to both', variant: 'primary' },
            { value: 'patient', label: 'Send to patient', variant: 'secondary' },
            { value: 'doctor', label: 'Send to doctor', variant: 'secondary' },
          ],
        });
        if (res.action !== 'both' && res.action !== 'patient' && res.action !== 'doctor') return;
        pick = res.action;
      } else if (d && ctx.patientEmail !== undefined && !p) pick = 'doctor';
      else if (p && ctx.doctorEmail !== undefined && !d) pick = 'patient';
      else pick = 'both';
    }
    // The server attaches the stored PDF: make sure there is one (best-effort, like WhatsApp).
    void this.archive(rep as ReportRef & Record<string, unknown>);
    await this.comms.emailReport(rep.orderId, pick);
  }

  /** SMS Chat: open the device's Messages app with the report link ready (the person presses Send).
   *  A referral doctor with their own mobile → "Send to patient / Send to doctor" (unless `opts.to`). */
  async sendSms(rep: ReportRef & Record<string, unknown>, patient: { name?: string | null; phone?: string | null },
    opts: { to?: WaRecipient; doctor?: WaDoctorContact | null } = {}): Promise<boolean> {
    if (!this.auth.hasPermission('deliver_report') || !this.comms.smsOn()) return false;
    if (rep.qrToken) void this.archive(rep);
    const link = reportPublicLink(this.base(), rep.qrToken);
    const lab = this.auth.user()?.tenantName;
    const doctor = opts.doctor !== undefined ? opts.doctor : await this.readDoctor(rep.id);
    const docPhone = doctor ? waDoctorPhone(patient.phone, doctor) : null;
    let to = opts.to;
    if (!to && docPhone) {
      const patientOk = !!patient.phone?.trim();
      const res = await this.dialog.actions({
        title: 'Send the report by SMS',
        message: `Who should get it? ${doctor?.name?.trim() || 'The referral doctor'}: ${waDisplayPhone(docPhone)}.`,
        actions: [
          ...(patientOk ? [{ value: 'patient', label: 'Send to patient', variant: 'primary' as const }] : []),
          { value: 'doctor', label: 'Send to doctor', variant: patientOk ? 'secondary' as const : 'primary' as const },
        ],
      });
      if (res.action !== 'patient' && res.action !== 'doctor') return false;
      to = res.action;
    }
    if (to === 'doctor') {
      return this.comms.openSms(doctor?.phone, smsDoctorReportMessage({ doctor: doctor?.name, patient: patient.name, lab, link }), 'doctor');
    }
    const opened = this.comms.openSms(patient.phone, smsReportMessage({ patient: patient.name, lab, link }));
    // Handing the link to the patient is the delivery (the doctor's copy is not) — no toast.
    if (opened) {
      this.api.post(`/api/reports/${rep.id}/deliver`, { via: 'sms', note: SMS_MANUAL_NOTE }).subscribe({ error: () => { /* best-effort */ } });
    }
    return opened;
  }

  /** The order's referral doctor as the server knows them (0.8 s max). A failed read = no doctor. */
  private async readDoctor(reportId: string | null | undefined): Promise<WaDoctorContact | null> {
    if (!reportId) return null;
    try {
      const st = await firstValueFrom(this.wa.reportStatus(reportId).pipe(timeout(800)));
      const d = st?.referralDoctor;
      return d?.phone ? { name: d.name ?? null, phone: d.phone } : null;
    } catch {
      return null;
    }
  }
}
