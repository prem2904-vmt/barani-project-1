import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

/**
 * Settings → Communication (WhatsApp, Email, SMS) — the API contract shared with
 * prefrontal-mw (pf-work/comms/BRIEF.md, 2026-11-13).
 *
 *   GET  /api/settings/communication             → CommunicationSettings
 *   PUT  /api/settings/communication/email       EmailSettingsInput → EmailSettings
 *   POST /api/settings/communication/email/test  { to } → { ok, error? }
 *   PUT  /api/settings/communication/sms         { chat } → { chat }
 */
export type EmailMode = 'platform' | 'own';
export type SmtpSecurity = 'starttls' | 'ssl' | 'none';

export interface OwnMailbox {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  fromAddress: string;
  /** A password is stored on the server (it never comes back). */
  passwordSet: boolean;
}

export interface EmailSettings {
  enabled: boolean;
  mode: EmailMode;
  fromName: string;
  replyTo: string | null;
  /** The shared Prefrontal sender (display only), e.g. "reports@prefrontal.health". */
  platformAddress: string;
  own: OwnMailbox | null;
  /** The lab can send email right now. */
  ready: boolean;
  /** Why it cannot, in plain words (null when ready). */
  problem: string | null;
}

export interface EmailSettingsInput {
  enabled: boolean;
  mode: EmailMode;
  fromName: string;
  replyTo: string | null;
  /** Write-only `password`: omit it to keep the stored one. */
  own: (Omit<OwnMailbox, 'passwordSet'> & { password?: string }) | null;
}

export interface CommunicationSettings {
  /** Read-only mirror of the platform switches + whether the Cloud API sender is set up. */
  whatsapp: { auto: boolean; chat: boolean; cloudReady?: boolean };
  email: EmailSettings;
  sms: { chat: boolean };
}

export interface EmailTestResult { ok: boolean; error?: string | null }

@Injectable({ providedIn: 'root' })
export class CommunicationService {
  private readonly api = inject(ApiService);

  settings(): Observable<CommunicationSettings> {
    return this.api.get<CommunicationSettings>('/api/settings/communication');
  }

  saveEmail(body: EmailSettingsInput): Observable<EmailSettings> {
    return this.api.put<EmailSettings>('/api/settings/communication/email', body);
  }

  testEmail(to: string): Observable<EmailTestResult> {
    return this.api.post<EmailTestResult>('/api/settings/communication/email/test', { to });
  }

  saveSms(chat: boolean): Observable<{ chat: boolean }> {
    return this.api.put<{ chat: boolean }>('/api/settings/communication/sms', { chat });
  }
}
