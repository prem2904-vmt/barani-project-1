import { Injectable, inject } from '@angular/core';
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
  setPdf(p: { name: string; bytes: Uint8Array }): Promise<{ ok: boolean }>;
  startDrag(): void;
}

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
}

export type WaManualOutcome = 'opened' | 'cancelled' | 'no-phone' | 'blocked';

/** The consent reminder (no consent field on the patient yet — owner decision). */
export const WA_CONSENT_REMINDER = 'Only send if the patient agreed to get reports on WhatsApp.';

/**
 * "Send on WhatsApp" — opens WhatsApp's click-to-chat with the patient's
 * chat and the message ready; the PERSON presses Send. See
 * shared/utils/whatsapp-manual.ts for the hard lines.
 *
 * - Desktop app → the docked panel on the right (IPC, main validates the URL).
 * - Phone (app / phone browser) → wa.me, which hands over to WhatsApp.
 * - Desktop browser → ONE named phone-shaped window at the right edge.
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
    const text = waReportMessage({ patient: req.patientName, lab: req.labName, link: req.link, extra: req.extra });
    const optedOut = await this.optedOut(req.reportId);
    const who = (req.patientName ?? '').trim();
    const ok = await this.dialog.confirm({
      title: optedOut ? 'This patient opted out of WhatsApp' : 'Send on WhatsApp',
      message: optedOut
        ? `${who || 'This patient'} asked not to get WhatsApp messages. Send anyway? WhatsApp opens with this message to ${waDisplayPhone(e164)}; you press Send there.`
        : `WhatsApp opens with this message to ${who ? who + ', ' : ''}${waDisplayPhone(e164)}. Check it, then press Send in WhatsApp.`,
      items: [text],
      question: WA_CONSENT_REMINDER,
      confirmLabel: optedOut ? 'Send anyway' : 'Open WhatsApp',
      cancelLabel: 'Cancel',
      tone: optedOut ? 'danger' : 'primary',
    });
    if (!ok) return 'cancelled';
    return this.open(req, text);
  }

  /** Open the chat (no questions asked — `send` asked them). */
  private async open(req: WaManualRequest, text: string): Promise<WaManualOutcome> {
    const url = waClickToChatUrl(req.phone, text);
    if (!url || !isClickToChatUrl(url)) return 'no-phone';

    const dock = this.bridge();
    if (dock) {
      const res = await dock.open(url).catch(() => ({ ok: false }));
      if (!res?.ok) { this.toasts.error('Could not open WhatsApp. Try again.'); return 'blocked'; }
      if (req.pdf) void this.handPdf(dock, req);
      return 'opened';
    }

    if (this.isPhone()) {
      const me = waMeUrl(req.phone, text);
      this.w().open(me!, '_blank', 'noopener');
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
    return 'opened';
  }

  /** Desktop: hand the report PDF to main for the drag helper (best-effort;
   *  it is NEVER attached for the person — they drag it in themselves). */
  private async handPdf(dock: ElectronWhatsAppBridge, req: WaManualRequest): Promise<void> {
    try {
      const blob = await req.pdf!();
      if (!blob) return;
      const bytes = new Uint8Array(await blobBytes(blob));
      await dock.setPdf({ name: req.pdfName || 'report.pdf', bytes });
    } catch { /* the link in the message is enough */ }
  }

  /** The patient's WhatsApp opt-out, when the server knows it (2 s max). */
  private async optedOut(reportId: string | null | undefined): Promise<boolean> {
    if (!reportId) return false;
    try {
      const st = await firstValueFrom(this.wa.reportStatus(reportId).pipe(timeout(2000)));
      return st?.patientOptOut === true;
    } catch {
      return false;
    }
  }
}
