import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { DialogService } from './dialog.service';
import { ToastService } from './toast.service';
import { WhatsAppService } from './whatsapp.service';
import {
  WA_POPUP_NAME, isClickToChatUrl, waClickToChatUrl, waDisplayPhone, waE164, waMeUrl, waPopupFeatures, waReportMessage,
} from '../../shared/utils/whatsapp-manual';

/** window.electronAPI.whatsapp — electron/preload.js (the docked panel). */
export interface ElectronWhatsAppBridge {
  open(url: string): Promise<{ ok: boolean; error?: string }>;
  close(): Promise<unknown>;
  signOut(): Promise<unknown>;
  state(): Promise<WaDockState>;
  onState(cb: (s: WaDockState) => void): () => void;
  openElsewhere(kind: 'browser' | 'app'): Promise<unknown>;
  /** `autoAttach`: main puts the PDF on the clipboard and pastes it into the chat just opened
   *  (the person still presses Send). Only sent for one-click sends from our button. */
  setPdf(p: { name: string; bytes: Uint8Array; autoAttach?: boolean }): Promise<{ ok: boolean }>;
  /** "Copy again": the PDF back on the clipboard. */
  copyPdf?(): Promise<{ ok: boolean }>;
  startDrag(): void;
}

/** Where the automatic PDF attach is (main, electron/whatsapp-attach.js). */
export type WaAttachState = 'idle' | 'preparing' | 'working' | 'attached' | 'manual';

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
  /** The automatic attach (paste into the chat): working → attached | manual (press Ctrl/Cmd+V). */
  attach?: WaAttachState;
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
  /** Report id: reads the patient's WhatsApp opt-out (best-effort). */
  reportId?: string | null;
  /** Desktop only: the report PDF for the "drag it into the chat" helper. */
  pdf?: () => Promise<Blob | null>;
  pdfName?: string;
  /** Called when the person actually handed the report over from the PDF card
   *  (shared / chat opened from it) — the delivery record for the phone path. */
  onHandedOver?: () => void;
}

/** 'card' = nothing opened yet: the PDF card (Share PDF) is the next step. */
export type WaManualOutcome = 'opened' | 'card' | 'cancelled' | 'no-phone' | 'blocked';

/** The small "Report PDF" card beside the chat (web / phone). Desktop shows it in the dock strip. */
export interface WaPdfCard {
  name: string;
  blob: Blob;
  /** The message text (with the secure report link) for the share sheet. */
  text: string;
  /** This device can share the file itself (navigator.canShare({files})). */
  canShare: boolean;
  /** Phones: the wa.me chat with the link (secondary). */
  chatUrl: string | null;
  /** Why the card is here: 'popup' (desktop web, chat is open beside) or 'phone'. */
  mode: 'popup' | 'phone';
  onHandedOver?: () => void;
}

/** The consent reminder (no consent field on the patient yet — owner decision); shown once per device. */
export const WA_CONSENT_REMINDER = 'Only send if the patient agreed to get reports on WhatsApp.';
export const WA_REMINDER_KEY = 'pf.wa.manual.reminded';

/**
 * "WhatsApp Chat" — opens WhatsApp's click-to-chat with the patient's
 * chat and the message ready; the PERSON presses Send. See
 * shared/utils/whatsapp-manual.ts for the hard lines.
 *
 * - Desktop app → the docked panel on the right (IPC, main validates the URL);
 *   the report PDF is put on the clipboard and pasted into the chat by main
 *   (electron/whatsapp-attach.js) — still the person presses Send.
 * - Phone (app / phone browser) → "Share PDF" (the file straight to WhatsApp via
 *   the share sheet) when the device can share files, else wa.me with the link.
 * - Desktop browser → ONE named phone-shaped window at the right edge + the
 *   "Report PDF" card (Share PDF where the browser can, else Download PDF and
 *   attach it with WhatsApp's paperclip). A cross-origin page can't be attached to.
 */
@Injectable({ providedIn: 'root' })
export class WhatsAppManualService {
  private readonly dialog = inject(DialogService);
  private readonly toasts = inject(ToastService);
  private readonly wa = inject(WhatsAppService);

  /** The "Report PDF" card (web / phone); null = hidden. */
  readonly pdfCard = signal<WaPdfCard | null>(null);

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
    const text = waReportMessage({ patient: req.patientName, lab: req.labName, link: req.link, extra: req.extra });
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
    if (out === 'opened') this.remindOnce();
    return out;
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
    this.pdfCard.set(null);

    const dock = this.bridge();
    if (dock) {
      const res = await dock.open(url).catch(() => ({ ok: false }));
      if (!res?.ok) { this.toasts.error('Could not open WhatsApp. Try again.'); return 'blocked'; }
      // One-click send from our button: main attaches the PDF (paste) — the person presses Send.
      if (req.pdf) void this.handPdf(dock, req);
      return 'opened';
    }

    if (this.isPhone()) {
      const me = waMeUrl(req.phone, text)!;
      // Phones that can share files: "Share PDF" is the PRIMARY action (the file goes straight to
      // WhatsApp through the share sheet, with the message); the link chat is secondary.
      if (req.pdf && this.canShareFiles()) {
        const blob = await req.pdf().catch(() => null);
        if (blob) {
          this.pdfCard.set({ name: req.pdfName || 'report.pdf', blob, text, canShare: true, chatUrl: me, mode: 'phone', onHandedOver: req.onHandedOver });
          return 'card';
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
    // The chat is a cross-origin page we can't attach to: the PDF card offers Share / Download.
    if (req.pdf) void this.showPdfCard(req, text);
    return 'opened';
  }

  /** Can this device hand a PDF file to another app (Web Share with files)? */
  canShareFiles(): boolean {
    const nav = this.w().navigator as Navigator | undefined;
    if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
    try { return nav.canShare({ files: [new File([''], 'report.pdf', { type: 'application/pdf' })] }); } catch { return false; }
  }

  private async showPdfCard(req: WaManualRequest, text: string): Promise<void> {
    try {
      const blob = await req.pdf!();
      if (!blob) return;
      this.pdfCard.set({ name: req.pdfName || 'report.pdf', blob, text, canShare: this.canShareFiles(), chatUrl: null, mode: 'popup', onHandedOver: req.onHandedOver });
    } catch { /* the link in the message is enough */ }
  }

  dismissPdfCard(): void { this.pdfCard.set(null); }

  /** Card: "Download PDF" — then attach it with WhatsApp's paperclip. */
  downloadPdf(): void {
    const c = this.pdfCard();
    if (!c) return;
    const url = URL.createObjectURL(c.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = c.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  /** Card: "Share PDF" — the file (+ the message with the link) through the share sheet. */
  async sharePdf(): Promise<boolean> {
    const c = this.pdfCard();
    if (!c) return false;
    const file = new File([c.blob], c.name, { type: 'application/pdf' });
    try {
      await (this.w().navigator as Navigator).share({ files: [file], text: c.text });
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return false;   // the person closed the sheet
      this.toasts.error('Could not share the PDF. Use Download PDF instead.');
      return false;
    }
    c.onHandedOver?.();
    this.pdfCard.set(null);
    return true;
  }

  /** Phone card: the same chat with the report link (secondary). */
  openChatFromCard(): void {
    const c = this.pdfCard();
    if (!c?.chatUrl) return;
    this.w().open(c.chatUrl, '_blank', 'noopener');
    c.onHandedOver?.();
    this.pdfCard.set(null);
  }

  /** Desktop: hand the report PDF to main — it puts it on the clipboard and pastes it into the chat
   *  (the person presses Send), and keeps it for drag / "Copy again" (best-effort). */
  private async handPdf(dock: ElectronWhatsAppBridge, req: WaManualRequest): Promise<void> {
    try {
      const blob = await req.pdf!();
      if (!blob) return;
      const bytes = new Uint8Array(await blobBytes(blob));
      await dock.setPdf({ name: req.pdfName || 'report.pdf', bytes, autoAttach: true });
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
