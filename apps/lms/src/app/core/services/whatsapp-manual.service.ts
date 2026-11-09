import { Injectable, inject } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { DialogService } from './dialog.service';
import { ToastService } from './toast.service';
import { WhatsAppService } from './whatsapp.service';
import {
  WA_POPUP_NAME, isClickToChatUrl, waClickToChatUrl, waDisplayPhone, waE164, waInvoiceMessage, waMeUrl, waPopupFeatures, waReportMessage,
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
}

export type WaManualOutcome = 'opened' | 'cancelled' | 'no-phone' | 'blocked';

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
 * - Desktop browser → ONE named phone-shaped window with the text drafted, and the PDF downloaded at
 *   the same moment (a cross-origin page can't be attached to). Silent; one hint, first time only.
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

  private isPhone(): boolean {
    const w = this.w() as unknown as { Capacitor?: { isNativePlatform?: () => boolean }; navigator?: Navigator };
    if (w.Capacitor?.isNativePlatform?.()) return true;
    return /Android|iPhone|iPad|iPod/i.test(w.navigator?.userAgent ?? '');
  }

  async send(req: WaManualRequest): Promise<WaManualOutcome> {
    const e164 = waE164(req.phone);
    if (!e164) {
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
    if (await this.optedOut(req.reportId)) {
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
    // The consent reminder is a toast: never on the desktop app's one-click path, nor when the PDF hint shows.
    if (out === 'opened' && !this.bridge() && !(req.pdf && !this.isPhone())) this.remindOnce();
    return out;
  }

  /** WhatsApp Chat for an INVOICE (OPS-126): the same flow as a report - the chat opens with the message
   *  drafted and the invoice PDF goes with it (desktop: our clipboard, paste + Send; web: downloaded; phone:
   *  the share sheet with the file). The person presses Send. */
  sendInvoice(p: {
    phone: string | null | undefined; patientName?: string | null; labName?: string | null;
    invoiceNumber?: string | null; amount?: number | string | null; extra?: (string | null | undefined)[];
    pdf: () => Promise<Blob | null>;
  }): Promise<WaManualOutcome> {
    const num = (p.invoiceNumber ?? '').toString().replace(/[^A-Za-z0-9._-]+/g, '-');
    return this.send({
      phone: p.phone,
      patientName: p.patientName,
      labName: p.labName,
      message: waInvoiceMessage({ patient: p.patientName, lab: p.labName, invoiceNumber: p.invoiceNumber, amount: p.amount, extra: p.extra }),
      pdf: p.pdf,
      pdfName: `${num || 'invoice'}.pdf`,
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
      return 'opened';
    }

    const pop = this.w().open(url, WA_POPUP_NAME, waPopupFeatures(this.w().screen));
    if (!pop) {
      this.toasts.error('Your browser blocked the WhatsApp window. Allow pop-ups for this site, then try again.');
      return 'blocked';
    }
    // The opener is NOT cut here: disowning the window would also stop the
    // next click from finding it by name. WhatsApp's own page sets
    // Cross-Origin-Opener-Policy, which severs it from the app anyway.
    try { pop.focus(); } catch { /* */ }
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
        if (!localStorage.getItem(WA_PDF_HINT_KEY)) { localStorage.setItem(WA_PDF_HINT_KEY, '1'); this.toasts.info(WA_PDF_HINT); }
      } catch { /* storage blocked: no hint */ }
    } catch { /* the link in the message is enough */ }
  }

  /** Desktop: hand the report PDF to main — it copies it to OUR clipboard and keeps it for the drag chip (best-effort). */
  private async handPdf(dock: ElectronWhatsAppBridge, req: WaManualRequest): Promise<void> {
    try {
      const blob = await req.pdf!();
      if (!blob) return;
      const bytes = new Uint8Array(await blobBytes(blob));
      await dock.setPdf({ name: req.pdfName || 'report.pdf', bytes, copyToClipboard: true });
    } catch { /* the link in the message is enough */ }
  }

  /** The patient's WhatsApp opt-out, when the server knows it (0.8 s max — keeps the click's pop-up permission). */
  private async optedOut(reportId: string | null | undefined): Promise<boolean> {
    if (!reportId) return false;
    try {
      const st = await firstValueFrom(this.wa.reportStatus(reportId).pipe(timeout(800)));
      return st?.patientOptOut === true;
    } catch {
      return false;
    }
  }
}
