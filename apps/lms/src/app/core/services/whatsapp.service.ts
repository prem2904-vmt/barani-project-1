import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

/** Lifecycle of one automatic / resent WhatsApp report message (Meta Cloud API). */
export type WaStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped';

export interface WaMessage {
  id: string;
  reportId: string;
  trigger: 'auto' | 'resend';
  kind: 'report_ready' | 'report_updated';
  status: WaStatus;
  errorCode?: number | null;
  errorReason?: string | null;
  attempts: number;
  /** Masked recipient (last 4 digits only). */
  to?: string | null;
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
  latest: WaMessage | null;
  history: WaMessage[];
}

/** Who the patient's WhatsApp comes from. The lab's token is never sent to the client. */
export interface WaSender {
  source: 'tenant' | 'platform';
  displayName?: string | null;
  status: 'not_connected' | 'pending' | 'connected' | 'error';
  wabaId?: string | null;
  phoneNumberId?: string | null;
  tokenStored: boolean;
  connectedAt?: string | null;
  error?: string | null;
  templateStatus?: string | null;
  templateStatusReason?: string | null;
  /** WhatsApp:EmbeddedSignupEnabled on the server (off until Meta App Review). */
  canConnect: boolean;
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
    case 'queued':
    case 'sending': return 'wait';
    case 'failed': return 'bad';
    default: return 'muted';
  }
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

  /** Embedded Signup: a signed, short-lived link the browser follows to Meta. */
  startOnboarding(): Observable<{ connectUrl: string; hostedUrl: string; redirectUri: string }> {
    return this.api.post('/api/whatsapp/onboarding/start', {});
  }

  setOptOut(patientId: string, optOut: boolean): Observable<{ patientId: string; optOut: boolean }> {
    return this.api.put(`/api/whatsapp/patients/${patientId}/opt-out`, { optOut });
  }
}
