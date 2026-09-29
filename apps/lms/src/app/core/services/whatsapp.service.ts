import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

/** Lifecycle of one automatic / resent WhatsApp report message (Meta Cloud API).
 *  `held` = the report is complete but the order isn't paid yet — it sends by
 *  itself once the bill is settled. */
export type WaStatus = 'held' | 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped';

export interface WaMessage {
  id: string;
  reportId: string;
  trigger: 'auto' | 'resend';
  kind: 'report_ready' | 'report_updated';
  status: WaStatus;
  errorCode?: number | null;
  errorReason?: string | null;
  attempts: number;
  /** What went out: 'pdf' (the report PDF attached + the link) or 'link' (link only). */
  attachment?: 'pdf' | 'link' | null;
  /** Why it went link-only (PDF not ready / too large / template not approved). */
  attachmentNote?: string | null;
  /** Masked recipient (last 4 digits only). */
  to?: string | null;
  /** Masked for the desk: country code + last 5 ("+91 ••••• 79229"). */
  toDisplay?: string | null;
  templateName?: string | null;
  createdAt: string;
  sentAt?: string | null;
  deliveredAt?: string | null;
  readAt?: string | null;
  failedAt?: string | null;
  nextAttemptAt?: string | null;
}

export interface WaReportStatus {
  reportId: string;
  patientId: string;
  patientOptOut: boolean;
  autoSendEnabled: boolean;
  configured: boolean;
  /** Staff can send this lab's reports on WhatsApp from the app right now
   *  (server on + a sender: the lab's own number, else the shared one). */
  canSend?: boolean;
  latest: WaMessage | null;
  history: WaMessage[];
}

/** One of our templates on the lab's own WABA (Meta review status). */
export interface WaTenantTemplate {
  kind: 'link' | 'pdf';
  name: string;
  /** PENDING | APPROVED | REJECTED | PAUSED | DISABLED | ERROR | NOT_FOUND, or null (not submitted). */
  status?: string | null;
  reason?: string | null;
}

/** The "Your WhatsApp number" card state, decided by the server. */
export type WaConnectState = 'not_connected' | 'connecting' | 'connected' | 'action_needed';

/** Who the patient's WhatsApp comes from. The lab's token is never sent to the client. */
export interface WaSender {
  source: 'tenant' | 'platform';
  /** Card state (older servers omit it → derived from status). */
  state?: WaConnectState;
  displayName?: string | null;
  verifiedName?: string | null;
  displayPhoneNumber?: string | null;
  status: 'not_connected' | 'pending' | 'connected' | 'error';
  wabaId?: string | null;
  phoneNumberId?: string | null;
  tokenStored: boolean;
  connectedAt?: string | null;
  healthCheckedAt?: string | null;
  /** GREEN | YELLOW | RED | UNKNOWN */
  qualityRating?: string | null;
  /** e.g. TIER_2K, TIER_10K, TIER_UNLIMITED */
  messagingLimitTier?: string | null;
  error?: string | null;
  templateStatus?: string | null;
  templateStatusReason?: string | null;
  templates?: WaTenantTemplate[];
  /** WhatsApp:EmbeddedSignupEnabled on the server (off until Meta App Review). */
  canConnect: boolean;
}

/** What FB.init / FB.login need (read-only; no attempt is opened). */
export interface WaSignupConfig {
  appId: string;
  configId: string;
  graphVersion: string;
  /** Embedded Signup extras (version, featureType, sessionInfoVersion, setup = the lab's pre-fill). */
  extras: Record<string, unknown>;
}

/** What the browser got back from Meta (never a token). */
export interface WaSignupResult {
  state: string;
  code?: string | null;
  wabaId?: string | null;
  phoneNumberId?: string | null;
  event?: string | null;
  errorMessage?: string | null;
}

/** "Prefrontal (shared)" or "<lab display name> (connected)". */
export function waSenderLine(sender: WaSender | null | undefined): string {
  if (sender?.source === 'tenant') return `${sender.displayName || 'Your lab number'} (connected)`;
  return 'Prefrontal (shared)';
}

export interface WaSettings {
  autoSendEnabled: boolean;
  autoSendEnabledAt?: string | null;
  sendUpdatedReports: boolean;
  templateName?: string | null;
  templateLanguage?: string | null;
  /** Staff can send reports on WhatsApp from the app (see WaReportStatus.canSend). */
  canSend?: boolean;
  sender?: WaSender | null;
  platform: {
    enabled: boolean;
    configured: boolean;
    webhookConfigured: boolean;
    defaultTemplateName: string;
    defaultTemplateLanguage: string;
  };
}

export interface WaSettingsInput {
  autoSendEnabled: boolean;
  sendUpdatedReports: boolean;
  templateName?: string | null;
  templateLanguage?: string | null;
}

/** User-facing word for a message status. */
export function waStatusLabel(s: WaStatus | null | undefined): string {
  switch (s) {
    case 'held': return 'On hold';
    case 'queued':
    case 'sending': return 'Queued';
    case 'sent': return 'Sent';
    case 'delivered': return 'Delivered';
    case 'read': return 'Read';
    case 'failed': return 'Failed';
    case 'skipped': return 'Not sent';
    default: return '';
  }
}

/** Status tone for chips/dots: good (delivered/read), info (sent), wait (queued), bad (failed), muted. */
export function waStatusTone(s: WaStatus | null | undefined): 'good' | 'info' | 'wait' | 'bad' | 'muted' {
  switch (s) {
    case 'delivered':
    case 'read': return 'good';
    case 'sent': return 'info';
    case 'held':
    case 'queued':
    case 'sending': return 'wait';
    case 'failed': return 'bad';
    default: return 'muted';
  }
}

/** "PDF attached" / "Link only · PDF not ready" for a message that went out; '' otherwise. */
export function waAttachmentLine(m: Pick<WaMessage, 'status' | 'attachment' | 'attachmentNote'> | null | undefined): string {
  if (!m || !['sent', 'delivered', 'read'].includes(m.status)) return '';
  if (m.attachment === 'pdf') return 'Report PDF attached';
  if (m.attachment === 'link' && m.attachmentNote) return `Link only · ${m.attachmentNote}`;
  return '';
}

/** The WhatsApp Cloud API report auto-send endpoints. */
@Injectable({ providedIn: 'root' })
export class WhatsAppService {
  private readonly api = inject(ApiService);

  settings(): Observable<WaSettings> {
    return this.api.get<WaSettings>('/api/whatsapp/settings');
  }

  saveSettings(input: WaSettingsInput): Observable<WaSettings> {
    return this.api.put<WaSettings>('/api/whatsapp/settings', input);
  }

  reportStatus(reportId: string): Observable<WaReportStatus> {
    return this.api.get<WaReportStatus>(`/api/whatsapp/reports/${reportId}`);
  }

  /** Latest message per report id (reports with no message are absent). */
  statusBatch(reportIds: string[]): Observable<Record<string, WaMessage>> {
    return this.api.post<Record<string, WaMessage>>('/api/whatsapp/status', { reportIds });
  }

  resend(reportId: string): Observable<WaMessage> {
    return this.api.post<WaMessage>(`/api/whatsapp/reports/${reportId}/resend`, {});
  }

  /** Embedded Signup — FB.init / FB.login config for this lab (no side effect). */
  signupConfig(): Observable<WaSignupConfig> {
    return this.api.get<WaSignupConfig>('/api/whatsapp/onboarding/config');
  }

  /** Embedded Signup — open an attempt: a signed state bound to this lab + user. */
  startOnboarding(): Observable<{ state: string; expiresAt: string }> {
    return this.api.post('/api/whatsapp/onboarding/start', {});
  }

  /** Embedded Signup — hand Meta's code + ids to the server (also CANCEL / ERROR). */
  completeOnboarding(r: WaSignupResult): Observable<WaSettings> {
    return this.api.post<WaSettings>('/api/whatsapp/onboarding/complete', r);
  }

  /** Re-read the lab's number (quality, limit) and template statuses from Meta. */
  refreshOnboarding(): Observable<WaSettings> {
    return this.api.post<WaSettings>('/api/whatsapp/onboarding/refresh', {});
  }

  /** Back to the shared Prefrontal number. */
  disconnect(): Observable<WaSettings> {
    return this.api.post<WaSettings>('/api/whatsapp/onboarding/disconnect', {});
  }

  setOptOut(patientId: string, optOut: boolean): Observable<{ patientId: string; optOut: boolean }> {
    return this.api.put(`/api/whatsapp/patients/${patientId}/opt-out`, { optOut });
  }
}
