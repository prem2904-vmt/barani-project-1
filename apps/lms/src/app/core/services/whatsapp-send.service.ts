import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { ApiError } from '../../shared/models/api-response.model';
import { ApiService } from './api.service';
import { ToastService } from './toast.service';
import { WhatsAppService, type WaMessage } from './whatsapp.service';

/** Where one staff "Send WhatsApp" is: the call is in flight, Meta accepted
 *  it (sent), the patient's phone got it / opened it (webhook), it waits for
 *  an automatic retry (queued), or it failed (Meta's reason). */
export type WaSendPhase = 'sending' | 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

export interface WaSendState {
  phase: WaSendPhase;
  /** "+91 ••••• 79229" (country code + last 5), else the last-4 mask. */
  to?: string | null;
  /** Meta's / the server's reason when it failed or waits. */
  reason?: string | null;
  messageId?: string | null;
}

/** Band / row words for a phase. */
export function waSendLabel(phase: WaSendPhase | null | undefined): string {
  switch (phase) {
    case 'sending': return 'Sending…';
    case 'queued': return 'Queued';
    case 'sent': return 'Sent';
    case 'delivered': return 'Delivered';
    case 'read': return 'Read';
    case 'failed': return 'Not sent';
    default: return '';
  }
}

/** How long (and how often) to watch for the webhook's delivered / read. */
export const WA_WATCH_MS = 30_000;
export const WA_POLL_MS = 3_000;

/**
 * Staff "Send WhatsApp" through the lab's WhatsApp Cloud API sender (the
 * server sends the approved `lab_report_ready` template with the report link
 * to THAT patient's number) — `POST /api/whatsapp/reports/{id}/resend`.
 *
 * - `cloud()` — the lab can send from the app (`GET /api/whatsapp/settings`
 *   → `canSend`: WhatsApp on for the server AND a sender: the lab's own
 *   number, else the shared Prefrontal number). Fetched once per session for
 *   delivery-desk users; false → screens keep today's wa.me flow.
 * - `send(id)` — Sending… → Sent (masked number) → Delivered / Read as the
 *   webhook updates the message (polled for ~30 s) → or the failure reason.
 *   Opted-out / no-phone / unpaid / no-sender refusals come back as a clear
 *   toast; nothing is recorded.
 * - `state(id)` — the live phase per report, read by the band button, the
 *   REPORT card's WhatsApp section and the Results row meta.
 */
@Injectable({ providedIn: 'root' })
export class WhatsAppSendService {
  private readonly wa = inject(WhatsAppService);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toasts = inject(ToastService);

  private readonly _cloud = signal<boolean | null>(null);
  /** The lab sends WhatsApp from the server (else: the wa.me fallback). */
  readonly cloud = () => this._cloud() === true;
  private loading = false;

  private readonly _states = signal<Record<string, WaSendState>>({});
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Warm `cloud()` (idempotent). Only the delivery desk can send. */
  ensure(): void {
    if (this._cloud() !== null || this.loading || !this.auth.hasPermission('deliver_report')) return;
    this.loading = true;
    this.wa.settings().subscribe({
      next: (s) => { this.loading = false; this._cloud.set(!!s?.canSend); },
      // Older server / no access: stay on the wa.me flow (retried next ensure()).
      error: () => { this.loading = false; this._cloud.set(false); },
    });
  }

  /** A final report can go through the server; a preliminary one cannot. */
  canSend(r: { type?: string | null } | null | undefined): boolean {
    return !!r && this.cloud() && this.auth.hasPermission('deliver_report') && (r.type ?? 'final') === 'final';
  }

  state(reportId: string | null | undefined): WaSendState | null {
    return reportId ? this._states()[reportId] ?? null : null;
  }

  busy(reportId: string | null | undefined): boolean {
    return this.state(reportId)?.phase === 'sending';
  }

  private set(reportId: string, st: WaSendState | null): void {
    this._states.update((m) => {
      const next = { ...m };
      if (st) next[reportId] = st; else delete next[reportId];
      return next;
    });
  }

  /** Send the report's link from the lab's WhatsApp number. Resolves with the
   *  message row (null when refused / errored — the toast already said why). */
  async send(reportId: string): Promise<WaMessage | null> {
    if (!reportId || this.busy(reportId) || !this.auth.hasPermission('deliver_report')) return null;
    this.stopWatch(reportId);
    this.set(reportId, { phase: 'sending' });
    let m: WaMessage;
    try {
      m = await firstValueFrom(this.wa.resend(reportId));
    } catch (e) {
      const err = ApiError.from(e);
      this.set(reportId, null);
      if (err.code === 'not_configured' || err.code === 'whatsapp_disabled') this._cloud.set(false);
      this.toasts.error(err.message || 'Could not send on WhatsApp', 6000);
      return null;
    }
    const to = m.toDisplay || m.to || null;
    const phase = this.phaseOf(m);
    this.set(reportId, { phase, to, reason: m.errorReason ?? null, messageId: m.id });
    if (phase === 'failed') {
      this.toasts.error(m.errorReason || 'WhatsApp could not send the report link', 8000);
      return m;
    }
    if (phase === 'queued') {
      this.toasts.info(m.errorReason ? `${m.errorReason}` : 'Queued for WhatsApp — it will be retried automatically', 6000);
    } else {
      this.toasts.success(to ? `Sent on WhatsApp to ${to}` : 'Report link sent on WhatsApp', 5000);
      // Handing the link to the patient is the delivery — same record the
      // wa.me flow writes (the webhook's "delivered" never overwrites it).
      this.watch(reportId, m.id, Date.now() + WA_WATCH_MS);
      try {
        await firstValueFrom(this.api.post(`/api/reports/${reportId}/deliver`, { via: 'whatsapp', note: 'WhatsApp Cloud API' }));
      } catch { /* best-effort: the message itself went out */ }
      return m;
    }
    this.watch(reportId, m.id, Date.now() + WA_WATCH_MS);
    return m;
  }

  private phaseOf(m: WaMessage): WaSendPhase {
    switch (m.status) {
      case 'sent': return 'sent';
      case 'delivered': return 'delivered';
      case 'read': return 'read';
      case 'queued':
      case 'sending': return 'queued';
      default: return 'failed';   // failed | skipped
    }
  }

  /** Poll the message until Meta's webhook says read / failed, or ~30 s pass. */
  private watch(reportId: string, messageId: string, until: number): void {
    this.stopWatch(reportId);
    if (Date.now() >= until) return;
    this.timers.set(reportId, setTimeout(() => {
      this.timers.delete(reportId);
      this.wa.reportStatus(reportId).subscribe({
        next: (st) => {
          const m = st?.history?.find((h) => h.id === messageId) ?? (st?.latest?.id === messageId ? st.latest : null);
          if (!m) return this.watch(reportId, messageId, until);
          const phase = this.phaseOf(m);
          const cur = this.state(reportId);
          this.set(reportId, { phase, to: m.toDisplay || m.to || cur?.to || null, reason: m.errorReason ?? null, messageId });
          if (phase === 'failed' && cur?.phase !== 'failed') {
            this.toasts.error(m.errorReason || 'WhatsApp could not deliver the report link', 8000);
            return;
          }
          if (phase !== 'read') this.watch(reportId, messageId, until);
        },
        error: () => this.watch(reportId, messageId, until),
      });
    }, WA_POLL_MS));
  }

  private stopWatch(reportId: string): void {
    const t = this.timers.get(reportId);
    if (t) { clearTimeout(t); this.timers.delete(reportId); }
  }
}
