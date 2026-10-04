import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AuthService } from '../../../core/auth/auth.service';
import { CriticalResultsService } from '../../../core/services/critical-results.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../models/api-response.model';
import {
  CriticalAckVia, CriticalResultEvent, criticalMethodLabel, criticalRoleLabel, criticalStatusWord, needsAckBy,
} from '../../models/critical-result.model';
import { CriticalCommunicationDialogComponent } from '../critical-communication-dialog/critical-communication-dialog.component';
import { webPointerSignal } from '../../utils/pointer-mode';
import { BusyDirective } from '../../directives/busy.directive';

/**
 * The open critical records of the results on screen (result entry, the
 * tube review, the validate page): one line per record with the test, the
 * critical values, ONE status word, and the two explicit actions —
 * Acknowledge (records who saw it; viewing never counts) and Record
 * communication (who was told, how). Hosts the dialog. Emits `changed` with
 * the updated record so the host refreshes its badges.
 */
@Component({
  selector: 'pf-critical-ack-strip',
  standalone: true,
  imports: [DatePipe, CriticalCommunicationDialogComponent, BusyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (events().length) {
      <section class="pf-cas" role="region" aria-label="Critical results">
        <header class="pf-cas__head">
          <span class="pf-cas__dot" aria-hidden="true"></span>
          <span class="pf-cas__title">Critical result{{ events().length === 1 ? '' : 's' }} · {{ headline() }}</span>
        </header>
        <ul class="pf-cas__list">
          @for (e of events(); track e.id) {
            @let st = statusOf(e);
            <li class="pf-cas__row" [attr.data-status]="e.status">
              <div class="pf-cas__text">
                <p class="pf-cas__test"><strong>{{ e.testName }}</strong> · <span class="nd-num">{{ e.summary }}</span></p>
                <p class="pf-cas__meta">
                  <span class="pf-cas__status" [attr.data-tone]="st.tone"><span class="pf-cas__status-dot" aria-hidden="true"></span>{{ st.label }}</span>
                  @if (e.acknowledgedAt) { · Acknowledged by {{ e.acknowledgedByName }} <span class="nd-num">{{ e.acknowledgedAt | date:'d MMM, h:mm a' }}</span> }
                  @if (e.status === 'communicated') { · {{ methodLabel(e.communicationMethod) }} to {{ e.communicatedToName }}{{ e.communicatedToRole ? ' (' + roleLabel(e.communicatedToRole) + ')' : '' }} }
                </p>
              </div>
              <div class="pf-cas__acts">
                @if (canAck() && needsMyAck(e)) {
                  <button type="button" class="nd-rowact pf-cas__ack" [class.nd-rowact--icon]="!web()"
                          [disabled]="busy() === e.id" [pfBusy]="busy() === e.id" pfBusyLabel="Acknowledging…" (click)="acknowledge(e)"
                          [attr.aria-label]="'Acknowledge critical result for ' + e.testName" title="Acknowledge">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                    <span class="nd-rowact__t">{{ busy() === e.id ? 'Acknowledging…' : 'Acknowledge' }}</span>
                  </button>
                }
                @if (canAck() && e.status !== 'communicated') {
                  <button type="button" class="nd-rowact pf-cas__comm" [class.nd-rowact--icon]="!web()"
                          (click)="dialogFor.set(e)"
                          [attr.aria-label]="'Record communication for ' + e.testName" title="Record communication">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8 9.7a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.8.3 1.7.5 2.6.7a2 2 0 0 1 1.7 2z"/></svg>
                    <span class="nd-rowact__t">Record communication</span>
                  </button>
                }
              </div>
            </li>
          }
        </ul>
      </section>
    }
    @if (dialogFor(); as e) {
      <pf-critical-communication-dialog [event]="e" (closed)="dialogFor.set(null)" (saved)="onSaved($event)"></pf-critical-communication-dialog>
    }
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .pf-cas {
      display: flex; flex-direction: column; gap: 8px; padding: 10px 12px;
      border-radius: var(--nd-radius-sm, 12px); border: 1px solid color-mix(in srgb, var(--red-text, #dc2626) 35%, transparent);
      border-left: 3px solid var(--red-text, #dc2626); background: color-mix(in srgb, var(--red-text, #dc2626) 6%, var(--nd-card-bg, transparent));
    }
    .pf-cas__head { display: flex; align-items: center; gap: 8px; }
    .pf-cas__dot { width: 7px; height: 7px; border-radius: 999px; background: var(--red-text, #dc2626); flex: none; }
    .pf-cas__title { font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: color-mix(in srgb, var(--red-text, #dc2626) 70%, var(--text-primary)); }
    .pf-cas__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .pf-cas__row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .pf-cas__text { flex: 1 1 260px; min-width: 0; }
    .pf-cas__test { margin: 0; font-size: 13px; color: var(--text-primary); text-wrap: pretty; }
    .pf-cas__test strong { font-weight: 600; }
    .pf-cas__meta { margin: 2px 0 0; font-size: 12px; color: var(--text-secondary); text-wrap: pretty; }
    .pf-cas__status { display: inline-flex; align-items: center; gap: 5px; font-weight: 500; --pf-cas-tone: var(--text-secondary); color: color-mix(in srgb, var(--pf-cas-tone) 70%, var(--text-primary)); }
    .pf-cas__status[data-tone='red'] { --pf-cas-tone: var(--red-text, #b91c1c); }
    .pf-cas__status[data-tone='amber'] { --pf-cas-tone: var(--amber-text, #b45309); }
    .pf-cas__status[data-tone='green'] { --pf-cas-tone: var(--green-text, #15803d); }
    .pf-cas__status-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--pf-cas-tone); }
    .pf-cas__acts { display: flex; align-items: center; gap: 6px; flex: none; }
    @media (max-width: 640px) { .pf-cas__acts { width: 100%; justify-content: flex-end; } }
  `],
})
export class CriticalAckStripComponent {
  private readonly svc = inject(CriticalResultsService);
  private readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthService);

  /** The records to show (open / acknowledged — the host's lookup). */
  readonly events = input<CriticalResultEvent[]>([]);
  /** Which screen the acknowledgement comes from (stored on the record). */
  readonly via = input<CriticalAckVia>('result_entry');
  readonly changed = output<CriticalResultEvent>();

  readonly web = webPointerSignal();
  readonly busy = signal<string | null>(null);
  readonly dialogFor = signal<CriticalResultEvent | null>(null);
  readonly canAck = computed(() => this.auth.hasAnyPermission(['enter_result', 'validate_result']));
  readonly headline = computed(() => {
    const open = this.events().filter(e => e.status === 'open').length;
    if (open > 0) return `${open} not acknowledged`;
    const ack = this.events().filter(e => e.status === 'acknowledged').length;
    return ack > 0 ? `${ack} awaiting communication` : 'communicated';
  });

  statusOf(e: CriticalResultEvent) { return criticalStatusWord(e.status); }
  methodLabel(v?: string | null) { return criticalMethodLabel(v); }
  roleLabel(v?: string | null) { return criticalRoleLabel(v); }
  needsMyAck(e: CriticalResultEvent): boolean { return needsAckBy(e, this.auth.user()?.id); }

  acknowledge(e: CriticalResultEvent) {
    if (this.busy()) return;
    this.busy.set(e.id);
    this.svc.acknowledge(e.id, this.via()).subscribe({
      next: updated => {
        this.busy.set(null);
        this.toasts.success('Critical result acknowledged');
        this.changed.emit(updated);
      },
      error: err => { this.busy.set(null); this.toasts.error(ApiError.from(err).message); },
    });
  }

  onSaved(updated: CriticalResultEvent) {
    this.dialogFor.set(null);
    this.changed.emit(updated);
  }
}
