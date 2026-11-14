import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { ApiError } from '../../shared/models/api-response.model';
import { EmailRecipient, EmailSendResult, emailOutcomeToasts, emailRefusalText } from '../../shared/utils/email-share';
import { SmsPlatform, readSmsEnv, smsPlatform, smsUri } from '../../shared/utils/sms-link';
import { ApiService } from './api.service';
import { CommunicationService, CommunicationSettings } from './communication.service';
import { DeviceClassService } from './device-class.service';
import { TenantEntitlementsService } from './tenant-entitlements.service';
import { ToastService } from './toast.service';

/** POST /api/billing/{id}/email — its guard. */
export const INVOICE_EMAIL_PERMS = ['view_bill', 'create_bill', 'collect_payment'];

/** A plausible email address (the server is the judge; this only hides an impossible row). */
export function looksLikeEmail(v: string | null | undefined): boolean {
  return !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

/**
 * Email + SMS sharing — the two channels next to WhatsApp (owner 2026-11-13).
 *
 * - **Email** (`emailOn()`): the platform switch `email_share` (default on) AND the lab's email
 *   not switched off in Settings → Communication. The SERVER sends (Prefrontal address or the lab's
 *   own mailbox) and answers who got it; the toast repeats that answer, nothing else.
 * - **SMS Chat** (`smsOn()`): the platform switch `sms_chat` (default on) AND the lab's SMS Chat
 *   setting AND a phone / tablet (the native app, or a touch-first browser). It only opens the
 *   device's Messages app with an `sms:` link — the person presses Send. Never on a computer.
 *
 * Only the delivery desk (deliver_report) shares. Screens never decide these rules themselves.
 */
@Injectable({ providedIn: 'root' })
export class CommsShareService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toasts = inject(ToastService);
  private readonly entitlements = inject(TenantEntitlementsService);
  private readonly comms = inject(CommunicationService);
  private readonly device = inject(DeviceClassService);
  private readonly doc = inject(DOCUMENT);

  /** Lab settings (GET /api/settings/communication); null until read or when the reader may not see them. */
  private readonly _settings = signal<CommunicationSettings | null>(null);
  private state: 'idle' | 'loading' | 'done' = 'idle';
  /** The order / bill id whose email is in flight (one at a time per screen row). */
  readonly emailing = signal<string | null>(null);

  /** Specs swap the platform in; the app reads the real window. */
  smsPlatformOverride: SmsPlatform | null = null;
  /** Specs capture the opened link instead of navigating. */
  opener: ((uri: string) => void) | null = null;

  /** Warm the lab's switches (idempotent; screens call it on init, never in a computed). */
  ensure(): void {
    void this.entitlements.ensureLoaded?.();
    if (this.state !== 'idle' || !this.can()) return;
    this.state = 'loading';
    this.comms.settings()?.subscribe({
      next: (s) => { this.state = 'done'; if (s && typeof s === 'object') this._settings.set(s); },
      // No permission / older server: the platform switches alone decide (both default on).
      error: () => { this.state = 'done'; },
    });
  }

  /** The Communication page pushes its saved values so open screens follow at once. */
  apply(s: Partial<CommunicationSettings>): void {
    const cur = this._settings();
    this._settings.set({ ...(cur ?? {} as CommunicationSettings), ...s } as CommunicationSettings);
  }

  private can(): boolean { return this.auth.hasPermission?.('deliver_report') === true; }
  private switchOn(key: 'emailShare' | 'smsChat'): boolean { return this.entitlements.moduleEnabled?.(key) !== false; }

  /** A phone or tablet (native shell, or a touch-first browser) — the only place SMS Chat exists. */
  handheld(): boolean {
    const w = this.doc.defaultView as (Window & { Capacitor?: { isNativePlatform?: () => boolean } }) | null;
    if (w?.Capacitor?.isNativePlatform?.()) return true;
    return this.device.isTouch?.() === true;
  }

  emailOn(): boolean {
    return this.can() && this.switchOn('emailShare') && this._settings()?.email?.enabled !== false;
  }

  smsOn(): boolean {
    return this.can() && this.switchOn('smsChat') && this._settings()?.sms?.chat !== false && this.handheld();
  }

  // ── Email ─────────────────────────────────────────────────────────────

  /** Server-side report email: POST /api/reports/by-order/{orderId}/email { to }. */
  async emailReport(orderId: string, to: EmailRecipient): Promise<EmailSendResult | null> {
    return this.send(orderId, `/api/reports/by-order/${orderId}/email`, { to }, to, 'report');
  }

  /** Invoice email may be sent by whoever may see / make the bill (the server's guard). */
  private canInvoice(): boolean { return INVOICE_EMAIL_PERMS.some(p => this.auth.hasPermission?.(p) === true); }

  /** Invoice email: platform switch + lab setting + a billing permission (not the delivery desk's). */
  invoiceEmailOn(): boolean {
    return this.canInvoice() && this.switchOn('emailShare') && this._settings()?.email?.enabled !== false;
  }

  /** Server-side invoice email (patient only): POST /api/billing/{billId}/email as multipart — field `pdf`
   *  = the invoice PDF the screen already rendered (INV-<number>.pdf). */
  async emailInvoice(billId: string, pdf?: Blob | null, invoiceNumber?: string | null): Promise<EmailSendResult | null> {
    let body: object | FormData = {};
    if (pdf) {
      const fd = new FormData();
      const num = (invoiceNumber || billId.slice(0, 8)).trim();
      fd.append('pdf', pdf, `${num.startsWith('INV-') ? num : `INV-${num}`}.pdf`);
      body = fd;
    }
    return this.send(billId, `/api/billing/${billId}/email`, body, 'patient', 'invoice', true);
  }

  private async send(key: string, url: string, body: object, asked: EmailRecipient, what: 'report' | 'invoice', invoice = false): Promise<EmailSendResult | null> {
    if (!key || this.emailing() || !(invoice ? this.canInvoice() : this.can())) return null;
    this.emailing.set(key);
    try {
      const res = await firstValueFrom(this.api.post<EmailSendResult>(url, body));
      for (const t of emailOutcomeToasts(res, asked, what)) {
        if (t.tone === 'success') this.toasts.success(t.text, 5000);
        else if (t.tone === 'warning') this.toasts.warning(t.text, 7000);
        else this.toasts.error(t.text, 7000);
      }
      return res ?? null;
    } catch (e) {
      const err = ApiError.from(e);
      this.toasts.error(emailRefusalText(err.code, what) ?? (err.message || `Could not email the ${what}`), 7000);
      return null;
    } finally {
      this.emailing.set(null);
    }
  }

  // ── SMS Chat ──────────────────────────────────────────────────────────

  platform(): SmsPlatform {
    return this.smsPlatformOverride ?? smsPlatform(readSmsEnv(this.doc.defaultView));
  }

  /** The `sms:` link for this device, or null for an invalid number. */
  smsLink(phone: string | null | undefined, body: string): string | null {
    return smsUri(phone, body, this.platform());
  }

  /** Open the Messages app with the text ready. False (with a plain message) when there is no valid number. */
  openSms(phone: string | null | undefined, body: string, who: 'patient' | 'doctor' = 'patient'): boolean {
    const uri = this.smsLink(phone, body);
    if (!uri) {
      this.toasts.warning(who === 'doctor'
        ? 'The referral doctor has no valid mobile number on file.'
        : "This patient has no valid mobile number on file. Add one on the patient's page, then try again.");
      return false;
    }
    if (this.opener) { this.opener(uri); return true; }
    // A real link click: the native shells hand non-http schemes to the OS (Messages app).
    const a = this.doc.createElement('a');
    a.href = uri;
    a.rel = 'noopener';
    a.style.display = 'none';
    this.doc.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  }
}
