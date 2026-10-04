import { ChangeDetectionStrategy, Component, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { CriticalResultsService } from '../../../core/services/critical-results.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../models/api-response.model';
import {
  CRITICAL_METHOD_OPTIONS, CRITICAL_ROLE_OPTIONS, CriticalCommunicationMethod, CriticalResultEvent,
} from '../../models/critical-result.model';
import { PfSelectOption, SelectComponent } from '../../primitives/select.component';
import { ModalPortalDirective } from '../../directives/modal-portal.directive';
import { BusyDirective } from '../../directives/busy.directive';

/**
 * "Record communication" — the NABL hand-over of a critical value: HOW it was
 * communicated (pf-select: phone / in person / WhatsApp / other), to WHOM
 * (name + role), and notes (read-back, callback number…). The time is the
 * moment of saving. The host renders it only while open and listens for
 * `saved` / `closed`. No native controls (ENGINEERING-RULES §6).
 */
@Component({
  selector: 'pf-critical-communication-dialog',
  standalone: true,
  imports: [SelectComponent, ModalPortalDirective, BusyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-ccd" role="dialog" aria-modal="true" aria-labelledby="pf-ccd-title" pfModalPortal>
      <div class="pf-ccd__backdrop" (click)="close()"></div>
      <form class="pf-ccd__card" (submit)="$event.preventDefault(); save()">
        <header class="pf-ccd__head">
          <span class="nd-card__icon" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8 9.7a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.8.3 1.7.5 2.6.7a2 2 0 0 1 1.7 2z"/></svg>
          </span>
          <div class="pf-ccd__head-text">
            <h2 id="pf-ccd-title" class="nd-card__label">Record communication</h2>
            <p class="pf-ccd__sub">
              <strong>{{ event().testName }}</strong> · {{ event().summary }}<br>
              {{ event().patientName }}{{ event().patientMrn ? ' · ' + event().patientMrn : '' }}{{ event().orderNumber ? ' · ' + event().orderNumber : '' }}
            </p>
          </div>
          <button type="button" class="nd-btn nd-btn--icon pf-ccd__close" (click)="close()" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </header>

        <div class="pf-ccd__body">
          <div class="nd-field">
            <label class="nd-field__lbl" for="pf-ccd-method">How was it communicated?</label>
            <pf-select id="pf-ccd-method" [options]="methodOptions" [value]="method()" placeholder="Choose the method"
                       (valueChange)="method.set($event)"></pf-select>
          </div>
          <div class="pf-ccd__row">
            <div class="nd-field">
              <label class="nd-field__lbl" for="pf-ccd-to">Communicated to</label>
              <input id="pf-ccd-to" class="nd-input" type="text" autocomplete="off" maxlength="200"
                     placeholder="Name — e.g. Dr Anand Krishnan" [value]="toName()" (input)="toName.set($any($event.target).value)" />
            </div>
            <div class="nd-field">
              <label class="nd-field__lbl" for="pf-ccd-role">Their role</label>
              <pf-select id="pf-ccd-role" [options]="roleOptions" [value]="toRole()" placeholder="Role"
                         (valueChange)="toRole.set($event)"></pf-select>
            </div>
          </div>
          <div class="nd-field">
            <label class="nd-field__lbl" for="pf-ccd-notes">Notes <span class="pf-ccd__opt">optional</span></label>
            <textarea id="pf-ccd-notes" class="nd-input" rows="3" maxlength="2000"
                      placeholder="Read back confirmed, callback number, advice given…"
                      [value]="notes()" (input)="notes.set($any($event.target).value)"></textarea>
            <p class="nd-field__hint">Saved with the time of this entry and your name — the NABL register keeps it with the result.</p>
          </div>
          @if (error()) { <p class="pf-ccd__err" role="alert">{{ error() }}</p> }
        </div>

        <footer class="pf-ccd__foot">
          <button type="button" class="nd-btn nd-btn--secondary" [disabled]="saving()" (click)="close()">Cancel</button>
          <button type="submit" class="nd-btn nd-btn--primary" [disabled]="!canSave() || saving()" [pfBusy]="saving()" pfBusyLabel="Saving…">
            {{ saving() ? 'Saving…' : 'Save communication' }}
          </button>
        </footer>
      </form>
    </div>
  `,
  styles: [`
    :host { display: contents; }
    .pf-ccd { position: fixed; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center; padding: 16px; }
    .pf-ccd__backdrop { position: absolute; inset: 0; background: rgba(5, 5, 15, 0.55); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
    .pf-ccd__card {
      position: relative; width: 100%; max-width: 34rem; max-height: calc(100dvh - 32px);
      display: flex; flex-direction: column; margin: 0; padding: 0;
      border-radius: var(--nd-radius-card, 18px); background: var(--nd-card-bg, var(--bg-card-solid));
      border: 1px solid var(--nd-line, var(--glass-border)); box-shadow: 0 30px 70px rgba(0, 0, 0, 0.45); overflow: hidden;
    }
    .pf-ccd__head { display: flex; align-items: flex-start; gap: 12px; padding: 16px 16px 12px; border-bottom: 1px solid var(--nd-line); }
    .pf-ccd__head-text { flex: 1 1 auto; min-width: 0; }
    .pf-ccd__head .nd-card__label { margin: 0; line-height: 24px; }
    .pf-ccd__sub { margin: 4px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); text-wrap: pretty; }
    .pf-ccd__sub strong { font-weight: 600; color: var(--text-primary); }
    .pf-ccd__close { flex: none; }
    .pf-ccd__body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 14px; }
    .pf-ccd__row { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 12px; }
    .pf-ccd__opt { font-weight: 400; color: var(--text-tertiary); }
    .pf-ccd__err { margin: 0; font-size: 12.5px; color: var(--red-text, #dc2626); }
    .pf-ccd__foot { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 12px 16px 16px; border-top: 1px solid var(--nd-line); }
    @media (max-width: 640px) {
      .pf-ccd { align-items: flex-end; padding: 0; }
      .pf-ccd__card { max-width: none; border-radius: 18px 18px 0 0; max-height: calc(100dvh - 24px); padding-bottom: env(safe-area-inset-bottom, 0px); }
      .pf-ccd__row { grid-template-columns: minmax(0, 1fr); }
      .pf-ccd__body .nd-input { font-size: 16px; min-height: 44px; }
      .pf-ccd__foot .nd-btn { min-height: 44px; }
    }
  `],
})
export class CriticalCommunicationDialogComponent {
  private readonly svc = inject(CriticalResultsService);
  private readonly toasts = inject(ToastService);

  readonly event = input.required<CriticalResultEvent>();
  readonly closed = output<void>();
  readonly saved = output<CriticalResultEvent>();

  readonly methodOptions: PfSelectOption<CriticalCommunicationMethod>[] = CRITICAL_METHOD_OPTIONS.map(o => ({ ...o }));
  readonly roleOptions: PfSelectOption<string>[] = CRITICAL_ROLE_OPTIONS.map(o => ({ ...o }));

  readonly method = signal<CriticalCommunicationMethod | ''>('phone');
  readonly toName = signal('');
  readonly toRole = signal<string>('referring_doctor');
  readonly notes = signal('');
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly canSave = computed(() => !!this.method() && this.toName().trim().length > 0);

  @HostListener('document:keydown.escape')
  onEscape() { if (!this.saving()) this.close(); }

  close() { this.closed.emit(); }

  save() {
    if (!this.canSave() || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    this.svc.recordCommunication(this.event().id, {
      method: this.method() as CriticalCommunicationMethod,
      toName: this.toName().trim(),
      toRole: this.toRole() || null,
      notes: this.notes().trim() || null,
    }).subscribe({
      next: e => {
        this.saving.set(false);
        this.toasts.success('Communication recorded');
        this.saved.emit(e);
      },
      error: err => {
        this.saving.set(false);
        this.error.set(ApiError.from(err).message);
      },
    });
  }
}
