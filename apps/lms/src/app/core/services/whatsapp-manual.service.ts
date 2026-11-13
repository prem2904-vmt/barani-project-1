import { Injectable, inject } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { DialogService } from './dialog.service';
import { ToastService } from './toast.service';
import { WhatsAppService } from './whatsapp.service';
import {
  WA_TAB_NAME, isClickToChatUrl, waClickToChatUrl, waDisplayPhone, waDoctorReportMessage, waE164, waInvoiceMessage, waMeUrl, waReportMessage,
} from '../../shared/utils/whatsapp-manual';

/** window.electronAPI.whatsapp — electron/preload.js (the docked panel). */
export interface ElectronWhatsAppBridge {
  open(url: string): Promise<{ ok: boolean; error?: string }>;
  close(): Promise<unknown>;
  signOut(): Promise<unknown>;
  state(): Promise<WaDockState>;
  onState(cb: (s: WaDockState) => void): () => void;
  openElsewhere(kind: 'browser' | 'app'): Promise<unknown>;
  /** `copyToClipboard`: main puts the PDF on OUR OS clipboard (the person pastes it into the chat and
   *  presses Send). Nothing is sent to, run in or read from WhatsApp. Only for one-click sends from our button. */
  setPdf(p: { name: string; bytes: Uint8Array; copyToClipboard?: boolean }): Promise<{ ok: boolean }>;
  startDrag(): void;
}

/** Where the PDF is: on the clipboard ('copied'), or the copy failed (drag instead). */
export type WaClipboardState = 'idle' | 'copied' | 'failed';

/** What main tells the page about the panel (electron/whatsapp-dock.js). */
export interface WaDockState {
  open: boolean;
  /** CSS px the panel takes on the right; `top` = the header strip height. */
  width: number;
  top: number;
  loading: boolean;
  failed: boolean;
  /** A report PDF is ready to drag into the chat. */
  pdfName: string | null;
  /** Our OS clipboard: 'copied' → the person presses Ctrl/Cmd+V in the chat. */
  clipboard?: WaClipboardState;
}

export function whatsAppBridge(): ElectronWhatsAppBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { electronAPI?: { whatsapp?: ElectronWhatsAppBridge } }).electronAPI?.whatsapp ?? null;
}

function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(blob);
  });
}

/** One manual send. */
export interface WaManualRequest {
  phone: string | null | undefined;
  patientName?: string | null;
  labName?: string | null;
  /** The public, identity-checked report link. */
  link?: string | null;
  /** Extra paragraphs (an outside lab's report line). */
  extra?: (string | null | undefined)[];
  /** A ready-made message (an invoice). Replaces the report wording; `link` / `extra` are then unused. */
  message?: string | null;
  /** Report id: reads the patient's WhatsApp opt-out (best-effort). */
  reportId?: string | null;
  /** Desktop only: the report PDF for the "drag it into the chat" helper. */
  pdf?: () => Promise<Blob | null>;
  pdfName?: string;
  /** Say "attach the PDF" on EVERY web send (invoices: the staff must attach it; the first-time-only hint was missed). */
  hintAlways?: boolean;
  /** The order's REFERRAL DOCTOR (reports only). With a valid mobile that is not the patient's own,
   *  the person picks "Send to patient" / "Send to doctor" (DialogService) unless `to` already says. */
  doctor?: WaDoctorContact | null;
  /** The recipient already picked (the front desk's Share menu shows both rows). */
  to?: WaRecipient;
}

export interface WaDoctorContact { name?: string | null; phone?: string | null }
export type WaRecipient = 'patient' | 'doctor';

/** The doctor's mobile when a "Send to doctor" choice makes sense: valid AND not the patient's own number. */
export function waDoctorPhone(patientPhone: string | null | undefined, doctor: WaDoctorContact | null | undefined): string | null {
  const d = waE164(doctor?.phone);
  return d && d !== waE164(patientPhone) ? d : null;
}

export type WaManualOutcome = 'opened' | 'cancelled' | 'no-phone' | 'blocked';

/** What the blank tab says while the report / PDF is fetched (web, the tab opened on the click). */
export const WA_TAB_WAITING = 'Opening WhatsApp…';

/** The consent reminder (no consent field on the patient yet — owner decision); shown once per device. */
export const WA_CONSENT_REMINDER = 'Only send if the patient agreed to get reports on WhatsApp.';
export const WA_REMINDER_KEY = 'pf.wa.manual.reminded';
/** First-ever web send: the one hint about the downloaded PDF (never again). */
export const WA_PDF_HINT = 'The PDF was downloaded — attach it with the paperclip.';
export const WA_PDF_HINT_KEY = 'pf.wa.manual.pdfhint';

/**
 * "WhatsApp Chat" — opens WhatsApp's click-to-chat with the patient's
 * chat and the message ready; the PERSON presses Send. See
 * shared/utils/whatsapp-manual.ts for the hard lines.
 *
 * - Desktop app → the docked panel on the right (IPC, main validates the URL) with the message drafted
 *   by WhatsApp's own click-to-chat link; main copies the PDF to OUR OS clipboard and our panel header
 *   says "press Ctrl+V" — the person pastes and presses Send. WhatsApp's page is never touched. No toast.
 * - Phone → ONE tap opens the share sheet with the PDF + the message (Web Share with files), else wa.me.
 * - Desktop browser → a NEW TAB with the text drafted, and the PDF downloaded at the same moment (a
 *   cross-origin page can't be attached to). Silent; one hint, first time only. A screen that fetches
 *   something first (the report, the PDF) calls `prime()` IN the click: the tab opens at once (blank,
 *   "Opening WhatsApp…") and is pointed at the chat when ready — opening it only after the network
 *   wait is what browsers block ("Your browser blocked the WhatsApp window", 2026-11-13).
 */
@Injectable({ providedIn: 'root' })
export class WhatsAppManualService {
  private readonly dialog = inject(DialogService);
  private readonly toasts = inject(ToastService);
  private readonly wa = inject(WhatsAppService);

  /** Specs swap these in; the app reads the real window. */
  win: Pick<Window, 'open' | 'screen' | 'navigator'> | undefined;
  bridge: () => ElectronWhatsAppBridge | null = whatsAppBridge;

  private w(): Pick<Window, 'open' | 'screen' | 'navigator'> { return this.win ?? window; }

  /** Who the last send opened WhatsApp for. Callers record the report's DELIVERY only for the patient:
   *  the referral doctor's copy is not the patient's hand-over (same rule as WhatsApp Auto). */
  lastRecipient: WaRecipient | null = null;

  /** The tab opened on the click (`prime()`), waiting for the chat URL. */
  private primed: Window | null = null;

  /** Web only: open the WhatsApp tab NOW, inside the click, so it survives the async work that follows
   *  (fetching the report / PDF). The next `send()` points it at the chat; `release()` closes it when
   *  nothing is sent. No-op on the desktop app (docked panel) and on phones (share sheet). */
  prime(): void {
    if (this.bridge() || this.isPhone()) return;
    if (this.primed && !this.primed.closed) return;
    let tab: Window | null = null;
    try { tab = this.w().open('about:blank', '_blank'); } catch { tab = null; }
    if (!tab) return;   // blocked even in the click: send() tries again and says so
    try {
      tab.document.title = 'WhatsApp';
      tab.document.body.textContent = WA_TAB_WAITING;
      tab.document.body.style.cssText = 'font:15px system-ui,sans-serif;color:#555;display:grid;place-items:center;height:100vh;margin:0';
    } catch { /* a stub / cross-origin: the blank tab is enough */ }
    this.primed = tab;
  }

  /** Close the primed tab when nothing will be sent (no report, an error, Auto took it). */
  release(): void {
    const tab = this.primed;
    this.primed = null;
    try { if (tab && !tab.closed) tab.close(); } catch { /* */ }
  }

  private takePrimed(): Window | null {
    const tab = this.primed;
    this.primed = null;
    return tab && !tab.closed ? tab : null;
  }

  private isPhone(): boolean {
    const w = this.w() as unknown as { Capacitor?: { isNativePlatform?: () => boolean }; navigator?: Navigator };
    if (w.Capacitor?.isNativePlatform?.()) return true;
    return /Android|iPhone|iPad|iPod/i.test(w.navigator?.userAgent ?? '');
  }

  async send(req: WaManualRequest): Promise<WaManualOutcome> {
    try {
      return await this.sendInner(req);
    } finally {
      this.release();   // a primed tab nobody used (no phone, cancelled, error) never lingers
    }
  }

  private async sendInner(input: WaManualRequest): Promise<WaManualOutcome> {
    this.lastRecipient = null;
    // Reports only: the referral doctor. The choice is a DialogService pick (never a native control);
    // its button press is a fresh click, so the tab still opens after it.
    // ONE short read (0.8 s max): the patient's opt-out + the order's referral doctor (when the caller
    // didn't bring it). Short so the click still counts for the tab when nothing is asked.
    const st = input.message ? { optOut: false, doctor: null } : await this.readStatus(input.reportId);
    const doctor = input.message ? null : (input.doctor ?? st.doctor);
    const req: WaManualRequest = { ...input, doctor };
    const doctorPhone = waDoctorPhone(req.phone, doctor);
    let to: WaRecipient = req.to === 'doctor' ? 'doctor' : 'patient';
    if (doctorPhone && !req.to) {
      this.release();   // a blank tab in front would hide the question
      const patientOk = !!waE164(req.phone);
      const pick = await this.dialog.actions({
        title: 'Send the report on WhatsApp',
        message: `Who should get it? ${req.doctor?.name?.trim() || 'The referral doctor'}: ${waDisplayPhone(doctorPhone)}.`,
        actions: [
          ...(patientOk ? [{ value: 'patient', label: 'Send to patient', variant: 'primary' as const }] : []),
          { value: 'doctor', label: 'Send to doctor', variant: patientOk ? 'secondary' as const : 'primary' as const },
        ],
      });
      if (pick.action !== 'patient' && pick.action !== 'doctor') return 'cancelled';
      to = pick.action;
    }
    if (to === 'doctor') {
      const phone = waE164(req.doctor?.phone);
      if (!phone) {
        this.release();
        await this.dialog.alert({ title: 'No mobile number', message: "The referral doctor has no valid mobile number on file.", confirmLabel: 'OK' });
        return 'no-phone';
      }
      const text = waDoctorReportMessage({ doctor: req.doctor?.name, patient: req.patientName, lab: req.labName, link: req.link, extra: req.extra });
      // The patient's opt-out is about the patient's own WhatsApp; the doctor referred the test.
      const out = await this.open({ ...req, phone }, text);
      if (out === 'opened') this.lastRecipient = 'doctor';
      return out;
    }
    return this.sendPatient(req, st.optOut);
  }

  private async sendPatient(req: WaManualRequest, optedOut: boolean): Promise<WaManualOutcome> {
    const e164 = waE164(req.phone);
    if (!e164) {
      this.release();
      await this.dialog.alert({
        title: 'No mobile number',
        message: "This patient has no valid mobile number on file. Add one on the patient's page, then try again.",
        confirmLabel: 'OK',
      });
      return 'no-phone';
    }
    const text = req.message?.trim() || waReportMessage({ patient: req.patientName, lab: req.labName, link: req.link, extra: req.extra });
    // One click: no confirm. The only stop is a patient who OPTED OUT of
    // WhatsApp (a recorded "no"). The read is kept short so the browser
    // still treats the window as opened by the click.
    if (optedOut) {
      this.release();   // the warning must be seen (the confirm's button is a fresh click)
      const who = (req.patientName ?? '').trim() || 'This patient';
      const ok = await this.dialog.confirm({
        title: 'This patient opted out of WhatsApp',
        message: `${who} asked not to get WhatsApp messages. Send anyway? WhatsApp opens with the message to ${waDisplayPhone(e164)}; you press Send there.`,
        items: [text],
        confirmLabel: 'Send anyway',
        cancelLabel: 'Cancel',
        tone: 'danger',
      });
      if (!ok) return 'cancelled';
    }
    const out = await this.open(req, text);
    if (out === 'opened') this.lastRecipient = 'patient';
    // The consent reminder is a toast: never on the desktop app's one-click path, nor when the PDF hint shows.
    if (out === 'opened' && !this.bridge() && !(req.pdf && !this.isPhone())) this.remindOnce();
    return out;
  }

  /** WhatsApp Chat for an INVOICE (OPS-126): the same flow as a report - the chat opens with the message
   *  drafted and the invoice PDF goes with it (desktop: our clipboard, paste + Send; web: downloaded; phone:
   *  the share sheet with the file). The person presses Send. */
  sendInvoice(p: {
    phone: string | null | undefined; patientName?: string | null; labName?: string | null;
    invoiceNumber?: string | null; amount?: number | string | null; balance?: number | null; extra?: (string | null | undefined)[];
    pdf: () => Promise<Blob | null>;
  }): Promise<WaManualOutcome> {
    const num = (p.invoiceNumber ?? '').toString().replace(/[^A-Za-z0-9._-]+/g, '-');
    return this.send({
      phone: p.phone,
      patientName: p.patientName,
      labName: p.labName,
      message: waInvoiceMessage({ patient: p.patientName, lab: p.labName, invoiceNumber: p.invoiceNumber, amount: p.amount, balance: p.balance, extra: p.extra }),
      pdf: p.pdf,
      pdfName: `${num || 'invoice'}.pdf`,
      hintAlways: true,
    });
  }

  /** The consent reminder, shown ONCE per device (first send), never again. */
  private remindOnce(): void {
    try {
      if (localStorage.getItem(WA_REMINDER_KEY)) return;
      localStorage.setItem(WA_REMINDER_KEY, '1');
    } catch { return; }
    this.toasts.info(WA_CONSENT_REMINDER);
  }

  /** Open the chat. */
  private async open(req: WaManualRequest, text: string): Promise<WaManualOutcome> {
    const url = waClickToChatUrl(req.phone, text);
    if (!url || !isClickToChatUrl(url)) return 'no-phone';

    const dock = this.bridge();
    if (dock) {
      const res = await dock.open(url).catch(() => ({ ok: false }));
      if (!res?.ok) { this.toasts.error('Could not open WhatsApp. Try again.'); return 'blocked'; }
      // One click: the message is drafted by WhatsApp's own click-to-chat link; main copies the PDF to OUR
      // clipboard — the person pastes it (Ctrl/Cmd+V) and presses Send. Nothing touches WhatsApp's page.
      if (req.pdf) void this.handPdf(dock, req);
      return 'opened';
    }

    if (this.isPhone()) {
      const me = waMeUrl(req.phone, text)!;
      // ONE tap: the share sheet with the PDF + the message (the file goes straight to WhatsApp).
      if (req.pdf && this.canShareFiles()) {
        const blob = await req.pdf().catch(() => null);
        if (blob) {
          const file = new File([blob], req.pdfName || 'report.pdf', { type: 'application/pdf' });
          try {
            await (this.w().navigator as Navigator).share({ files: [file], text });
            return 'opened';
          } catch (e) {
            if ((e as { name?: string })?.name === 'AbortError') return 'cancelled';   // the person closed the sheet
            // Sharing refused (e.g. the tap's permission ran out): the chat with the text, as before.
          }
        }
      }
      this.w().open(me, '_blank', 'noopener');
      // The share sheet could not carry the file: it would reach the patient as text only, so save the PDF too.
      if (req.pdf && !(this.w() as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()) void this.downloadPdf(req);
      return 'opened';
    }

    // Web: a NEW TAB (owner 2026-11-13). The tab primed in the click is pointed at the chat (it was
    // opened while the click still counted); otherwise open one now.
    const primed = this.takePrimed();
    let tab: Window | null = null;
    if (primed) {
      try { primed.opener = null; } catch { /* */ }
      try { primed.location.replace(url); tab = primed; } catch { try { primed.close(); } catch { /* */ } }
    }
    // The opener is NOT cut on a fresh tab: disowning it would also stop the next click from finding
    // it by name. WhatsApp's own page sets Cross-Origin-Opener-Policy, which severs it anyway.
    if (!tab) tab = this.w().open(url, WA_TAB_NAME);
    if (!tab) {
      this.toasts.error('Your browser blocked the WhatsApp tab. Allow pop-ups for this site, then try again.');
      return 'blocked';
    }
    try { tab.focus(); } catch { /* */ }
    // A cross-origin chat can't be attached to: download the PDF at the same moment (no card).
    if (req.pdf) void this.downloadPdf(req);
    return 'opened';
  }

  /** Can this device hand a PDF file to another app (Web Share with files)? */
  canShareFiles(): boolean {
    const nav = this.w().navigator as Navigator | undefined;
    if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
    try { return nav.canShare({ files: [new File([''], 'report.pdf', { type: 'application/pdf' })] }); } catch { return false; }
  }

  /** Web: save the report PDF (the browser's own download indicator is the only UI). The very first
   *  time on a device, one toast says what to do with it. */
  private async downloadPdf(req: WaManualRequest): Promise<void> {
    try {
      const blob = await req.pdf!();
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = req.pdfName || 'report.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      try {
        if (req.hintAlways) this.toasts.info(WA_PDF_HINT);
        else if (!localStorage.getItem(WA_PDF_HINT_KEY)) { localStorage.setItem(WA_PDF_HINT_KEY, '1'); this.toasts.info(WA_PDF_HINT); }
      } catch { /* storage blocked: no hint */ }
    } catch { /* the link in the message is enough */ }
  }

  /** Desktop: hand the report PDF to main — it copies it to OUR clipboard and keeps it for the drag chip (best-effort). */
  private async handPdf(dock: ElectronWhatsAppBridge, req: WaManualRequest): Promise<void> {
    try {
      const blob = await req.pdf!();
      if (!blob) return;
      const bytes = new Uint8Array(await blobBytes(blob));
      const res = await dock.setPdf({ name: req.pdfName || 'report.pdf', bytes, copyToClipboard: true });
      if (req.hintAlways && !res?.ok) { this.toasts.warning('The PDF could not be copied. Download it and attach it in the chat.'); void this.downloadPdf(req); }
    } catch {
      if (req.hintAlways) { this.toasts.warning('The PDF could not be copied. Download it and attach it in the chat.'); void this.downloadPdf(req); }
      /* a report: the link in the message is enough */
    }
  }

  /** The patient's WhatsApp opt-out + the order's referral doctor, when the server knows them
   *  (0.8 s max — keeps the click's tab permission). A failed read = no opt-out, no doctor. */
  private async readStatus(reportId: string | null | undefined): Promise<{ optOut: boolean; doctor: WaDoctorContact | null }> {
    if (!reportId) return { optOut: false, doctor: null };
    try {
      const st = await firstValueFrom(this.wa.reportStatus(reportId).pipe(timeout(800)));
      const d = st?.referralDoctor;
      return { optOut: st?.patientOptOut === true, doctor: d?.phone ? { name: d.name ?? null, phone: d.phone } : null };
    } catch {
      return { optOut: false, doctor: null };
    }
  }
}
