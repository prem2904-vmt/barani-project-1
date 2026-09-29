import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import {
  WaReportStatus,
  WhatsAppService,
  waAttachmentLine,
  waStatusLabel,
  waStatusTone,
} from '../../../core/services/whatsapp.service';
import { WhatsAppSendService } from '../../../core/services/whatsapp-send.service';
import { BusyDirective } from '../../../shared/directives/busy.directive';

/**
 * The REPORT card's "WhatsApp" section: the Meta Cloud API status of THIS
 * report version (Queued / Sent / Delivered / Read / Failed + the reason, the
 * masked number), a Send now / Send again action for the delivery desk
 * (deliver_report, through WhatsAppSendService like the band's primary) and
 * the patient's "Don't send WhatsApp" switch. Renders nothing when the lab
 * has no WhatsApp sending and nothing was ever sent for this report.
 */
@Component({
  selector: 'pf-report-whatsapp-status',
  standalone: true,
  imports: [DatePipe, BusyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible(); as st) {
      <section class="pf-rwa" aria-labelledby="pf-rwa-t">
        <h3 class="pf-rwa__sec" id="pf-rwa-t">{{ st.autoSendEnabled ? 'WhatsApp · automatic' : 'WhatsApp' }}</h3>

        @if (st.latest; as m) {
          <div class="pf-rwa__row">
            <span class="pf-rwa__status" [attr.data-tone]="tone()" role="status">
              <span class="pf-rwa__dot" aria-hidden="true"></span>
              {{ label() }}
              @if (m.kind === 'report_updated') { <span class="pf-rwa__muted">· updated report</span> }
            </span>
            <span class="pf-rwa__when nd-num">{{ (m.readAt || m.deliveredAt || m.sentAt || m.failedAt || m.createdAt) | date: 'd MMM, h:mm a' }}</span>
          </div>
          @if (m.errorReason && (m.status === 'failed' || m.status === 'skipped' || m.status === 'queued' || m.status === 'held')) {
            <p class="pf-rwa__reason" [class.pf-rwa__reason--bad]="m.status === 'failed'">
              {{ m.errorReason }}@if (m.status === 'queued' && m.nextAttemptAt) { Next try {{ m.nextAttemptAt | date: 'h:mm a' }}. }
            </p>
          }
          @if (attachmentLine(); as att) { <p class="pf-rwa__muted" data-testid="rwa-attachment">{{ att }}</p> }
          @if (m.toDisplay || m.to) { <p class="pf-rwa__muted pf-rwa__to nd-num">To {{ m.toDisplay || m.to }}</p> }
        } @else {
          <p class="pf-rwa__muted">
            @if (st.patientOptOut) {
              This patient opted out of WhatsApp.
            } @else if (!st.configured) {
              WhatsApp sending isn't set up on the server yet — messages will wait in the queue.
            } @else if (st.autoSendEnabled) {
              Sends automatically, with the report PDF, once this final report is ready and the bill is fully paid.
            } @else {
              Not sent yet. Send WhatsApp sends the report link to the patient's number.
            }
          </p>
        }

        @if (canDeliver()) {
          <div class="pf-rwa__acts">
            <button type="button" class="nd-btn nd-btn--secondary pf-rwa__btn" (click)="resend()"
                    [disabled]="busy() || sending() || st.patientOptOut || (!st.configured && !st.canSend)" [pfBusy]="sending()" pfBusyLabel="Sending…">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
              {{ sending() ? 'Sending…' : st.latest ? 'Send again' : 'Send now' }}
            </button>
            <button type="button" class="nd-toggle pf-rwa__opt" role="switch" [attr.aria-checked]="st.patientOptOut"
                    [disabled]="busy()" (click)="toggleOptOut()">
              <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>
              Don't send WhatsApp to this patient
            </button>
          </div>
        }
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .pf-rwa { display: flex; flex-direction: column; gap: 6px; padding-top: 12px; border-top: 1px solid var(--nd-line); }
    .pf-rwa__sec { margin: 0 0 2px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-rwa__row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .pf-rwa__status { --pf-tone: var(--text-secondary); display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--pf-tone); }
    .pf-rwa__status[data-tone='good'] { --pf-tone: var(--green-text); }
    .pf-rwa__status[data-tone='info'] { --pf-tone: var(--text-primary); }
    .pf-rwa__status[data-tone='wait'] { --pf-tone: var(--amber-text); }
    .pf-rwa__status[data-tone='bad'] { --pf-tone: var(--red-text); }
    .pf-rwa__dot { width: 7px; height: 7px; border-radius: 999px; background: var(--pf-tone); flex: none; }
    .pf-rwa__when { font-size: 12px; color: var(--text-tertiary); }
    .pf-rwa__reason { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }
    .pf-rwa__reason--bad { color: var(--red-text); }
    .pf-rwa__muted { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--text-tertiary); font-weight: 500; }
    .pf-rwa__to { font-size: 12px; }
    .pf-rwa__acts { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; margin-top: 4px; }
    .pf-rwa__btn { min-height: 36px; display: inline-flex; align-items: center; gap: 6px; }
    .pf-rwa__opt { white-space: normal; text-align: left; min-height: 36px; }
    @media (pointer: coarse) { .pf-rwa__btn, .pf-rwa__opt { min-height: 44px; } }
  `],
})
export class ReportWhatsAppStatusComponent {
  private readonly wa = inject(WhatsAppService);
  private readonly toasts = inject(ToastService);

  /** The report version on screen. */
  readonly reportId = input.required<string>();
  /** deliver_report — Resend and the opt-out switch. */
  readonly canDeliver = input<boolean>(false);

  readonly status = signal<WaReportStatus | null>(null);
  readonly busy = signal(false);

  private readonly waSend = inject(WhatsAppSendService);
  /** A staff send of THIS report is in flight (band button or here). */
  readonly sending = computed(() => this.waSend.busy(this.reportId()));

  /** Hidden while the lab has no WhatsApp sending (auto-send off, no server
   *  sender) and nothing was ever sent for this report. */
  readonly visible = computed(() => {
    const st = this.status();
    if (!st) return null;
    return st.autoSendEnabled || st.canSend || st.latest || st.patientOptOut ? st : null;
  });
  readonly label = computed(() => waStatusLabel(this.status()?.latest?.status));
  readonly tone = computed(() => waStatusTone(this.status()?.latest?.status));
  readonly attachmentLine = computed(() => waAttachmentLine(this.status()?.latest));

  constructor() {
    effect(() => {
      const id = this.reportId();
      if (id) untracked(() => this.load(id));
    });
    // A staff send (band "Send WhatsApp" or the ⋮ row) moved this report's
    // message on — Sent → Delivered / Read — reload the section.
    effect(() => {
      const live = this.waSend.state(this.reportId());
      if (live && live.phase !== 'sending') untracked(() => this.load());
    });
  }

  load(id = this.reportId()): void {
    this.wa.reportStatus(id).subscribe({
      next: (s) => { if (s.reportId === this.reportId()) this.status.set(s); },
      error: () => this.status.set(null),   // no view_report, or an older server: stay hidden
    });
  }

  /** Send now / Send again — the same server send as the band's primary
   *  (toasts, Sent → Delivered / Read watch, delivery record). */
  resend(): void {
    if (this.busy() || this.sending() || !this.canDeliver()) return;
    void this.waSend.send(this.reportId()).then(() => this.load());
  }

  toggleOptOut(): void {
    const st = this.status();
    if (!st || this.busy() || !this.canDeliver()) return;
    const next = !st.patientOptOut;
    this.busy.set(true);
    this.wa.setOptOut(st.patientId, next).subscribe({
      next: () => {
        this.busy.set(false);
        this.status.set({ ...st, patientOptOut: next });
        this.toasts.success(next ? 'WhatsApp turned off for this patient' : 'WhatsApp turned on for this patient');
      },
      error: (e) => {
        this.busy.set(false);
        this.toasts.error(ApiError.from(e).message);
      },
    });
  }
}
