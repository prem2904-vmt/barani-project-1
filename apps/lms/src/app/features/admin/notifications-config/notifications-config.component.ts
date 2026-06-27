import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { NumberInputComponent } from '../../../shared/primitives/number-input.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { ToggleComponent } from '../../../shared/primitives/toggle.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

type Tab = 'alerts' | 'escalations' | 'patient';

interface AlertCfg {
  eventType: string;
  inAppEnabled: boolean;
  whatsappEnabled: boolean;
  emailEnabled: boolean;
}
interface EscalationCfg {
  eventType: string;
  reminderIntervalMins: number;
  maxReminders: number;
  escalateAfterHrs: number;
  criticalAfterHrs: number;
}
interface PatientTemplate {
  key: string;
  label: string;
  body: string;
  variables: string[];
}

@Component({
  selector: 'pf-notifications-config',
  standalone: true,
  imports: [
    FormsModule,
    NumberInputComponent,
    ScreenHeaderComponent,
    SegmentedComponent,
    TileComponent,
    ToggleComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10">
      <pf-screen-header
        eyebrow="Admin"
        title="Notifications"
        subtitle="How the lab communicates internally and with patients.">
      </pf-screen-header>

      <div class="mb-5">
        <pf-segmented
          [options]="tabOptions"
          [value]="tab()"
          size="md"
          (valueChange)="setTab($event)">
        </pf-segmented>
      </div>

      @if (tab() === 'alerts') {
        <div class="space-y-2.5">
          @for (a of alerts(); let i = $index; track a.eventType) {
            <pf-tile tone="default" padding="md">
              <div class="flex items-start gap-3 flex-wrap md:flex-nowrap">
                <div class="pf-alert-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
                    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
                  </svg>
                </div>
                <div class="flex-1 min-w-0">
                  <p class="font-semibold text-[15px]" style="color: var(--text-primary);">{{ alertLabel(a.eventType) }}</p>
                  <p class="text-[11px] font-mono mt-0.5" style="color: var(--text-muted);">{{ a.eventType }}</p>

                  <div class="pf-channel-grid mt-3 grid grid-cols-3 gap-2">
                    <div class="pf-channel-cell">
                      <span class="text-[12px]" style="color: var(--text-secondary);">In-app</span>
                      <pf-toggle size="sm"
                                 [checked]="a.inAppEnabled"
                                 (checkedChange)="patchAlert(i, { inAppEnabled: $event })">
                      </pf-toggle>
                    </div>
                    <div class="pf-channel-cell">
                      <span class="text-[12px]" style="color: var(--text-secondary);">WhatsApp</span>
                      <pf-toggle size="sm"
                                 [checked]="a.whatsappEnabled"
                                 (checkedChange)="patchAlert(i, { whatsappEnabled: $event })">
                      </pf-toggle>
                    </div>
                    <div class="pf-channel-cell">
                      <span class="text-[12px]" style="color: var(--text-secondary);">Email</span>
                      <pf-toggle size="sm"
                                 [checked]="a.emailEnabled"
                                 (checkedChange)="patchAlert(i, { emailEnabled: $event })">
                      </pf-toggle>
                    </div>
                  </div>
                </div>
                <pf-touch-btn size="sm" variant="primary" (pressed)="saveAlert(a)">Save</pf-touch-btn>
              </div>
            </pf-tile>
          }
        </div>
      }

      @if (tab() === 'escalations') {
        <div class="space-y-2.5">
          @for (e of escalations(); let i = $index; track e.eventType) {
            <pf-tile tone="default" padding="md">
              <div class="flex items-center justify-between gap-2 mb-3 flex-wrap">
                <p class="font-semibold text-[15px]" style="color: var(--text-primary);">{{ alertLabel(e.eventType) }}</p>
                <pf-touch-btn size="sm" variant="primary" (pressed)="saveEscalation(e)">Save</pf-touch-btn>
              </div>
              <div class="pf-escalation-grid grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label class="pf-label">Reminder</label>
                  <pf-number-input
                    [value]="e.reminderIntervalMins"
                    [min]="0" [step]="5" suffix="min"
                    (valueChange)="patchEscalation(i, { reminderIntervalMins: $event ?? 0 })">
                  </pf-number-input>
                </div>
                <div>
                  <label class="pf-label">Max reminders</label>
                  <pf-number-input
                    [value]="e.maxReminders"
                    [min]="0" [max]="10" [step]="1"
                    (valueChange)="patchEscalation(i, { maxReminders: $event ?? 0 })">
                  </pf-number-input>
                </div>
                <div>
                  <label class="pf-label">Escalate after</label>
                  <pf-number-input
                    [value]="e.escalateAfterHrs"
                    [min]="0" [step]="1" suffix="hrs"
                    (valueChange)="patchEscalation(i, { escalateAfterHrs: $event ?? 0 })">
                  </pf-number-input>
                </div>
                <div>
                  <label class="pf-label">Critical after</label>
                  <pf-number-input
                    [value]="e.criticalAfterHrs"
                    [min]="0" [step]="1" suffix="hrs"
                    (valueChange)="patchEscalation(i, { criticalAfterHrs: $event ?? 0 })">
                  </pf-number-input>
                </div>
              </div>
            </pf-tile>
          }
        </div>
      }

      @if (tab() === 'patient') {
        <div class="space-y-3">
          @for (tpl of patientTemplates(); let i = $index; track tpl.key) {
            <pf-tile tone="default" padding="md">
              <div class="flex items-start justify-between gap-2 mb-2 flex-wrap">
                <div class="min-w-0">
                  <p class="font-semibold text-[15px]" style="color: var(--text-primary);">{{ tpl.label }}</p>
                  <p class="text-[11px] font-mono mt-0.5" style="color: var(--text-muted);">
                    variables: {{ tpl.variables.join(', ') }}
                  </p>
                </div>
              </div>
              <textarea class="pf-input font-mono text-[12px] min-h-[88px]"
                        [ngModel]="tpl.body" (ngModelChange)="patchPatientTpl(i, $event)"></textarea>
            </pf-tile>
          }
          <p class="text-[12px] px-1" style="color: var(--text-muted);">
            Templates are stored locally in this demo — WhatsApp provider hook lands in the integration stage.
          </p>
        </div>
      }
    </section>
  `,
  styles: [`
    .pf-alert-icon {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, rgba(236, 72, 153, 0.22), rgba(236, 72, 153, 0.08));
      border: 1px solid rgba(236, 72, 153, 0.3);
      color: #f9a8d4;
      flex-shrink: 0;
    }
    .pf-channel-cell {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-radius: 10px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
    }

    /* ===== Phone overrides (<=640px) — additive only, never touch desktop ===== */
    @media (max-width: 640px) {
      /* iOS zooms any input/textarea whose font-size < 16px on focus.
         Scope strictly to this page's textarea so the shared .pf-input
         primitive is not restyled globally. */
      :host textarea {
        font-size: 16px;
      }
      /* The Escalations tab uses the shared pf-number-input, whose internal
         <input> renders at 14px — below iOS's 16px no-zoom floor, so focusing
         a stepper triggers a jarring auto-zoom. Bump just this page's nested
         inputs to 16px (page-scoped via :host, so the shared primitive is
         untouched elsewhere). Root-cause fix is reported as a shared rec. */
      :host ::ng-deep pf-number-input input {
        font-size: 16px;
      }
      /* Channels (In-app / WhatsApp / Email): the 3-up grid squeezed each cell
         into a narrow third where the switches looked cramped. On phone drop to
         a single column, but keep it COMPACT — a tight divided list (label left,
         switch right) instead of three chunky bordered cards. Presentation only;
         same pf-toggle + handlers. */
      :host .pf-channel-grid {
        grid-template-columns: 1fr;
        gap: 0;
      }
      :host .pf-channel-cell {
        min-height: 0;
        justify-content: space-between;
        padding: 7px 2px;
        background: transparent;
        border: 0;
        border-bottom: 1px solid var(--glass-border);
        border-radius: 0;
      }
      :host .pf-channel-cell:last-child {
        border-bottom: 0;
      }
    }

    /* ===== Web-below-desktop band (641–1279px): iPad + narrow browsers =====
       The escalations grid uses md:grid-cols-4, which packs four
       number-inputs (label + field + steppers + suffix) across a tile.
       Below desktop that crams each cell to ~140–180px and the "Escalate
       after"/"Critical after" controls look squeezed. Hold the grid to two
       columns in this band; desktop (>=1280px) keeps the 4-up layout. */
    @media (min-width: 641px) and (max-width: 1279px) {
      :host .pf-escalation-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    /* ===== Coarse-pointer (touch) sizing — phone + tablet ===== */
    @media (pointer: coarse) {
      :host .pf-channel-cell {
        min-height: 44px;
      }
      /* Block horizontal drag-resize so the template textarea can never push
         the page sideways on touch; vertical grow still works. */
      :host textarea {
        resize: vertical;
        max-width: 100%;
      }
    }
  `]
})
export class NotificationsConfigComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);

  readonly tabOptions: SegmentedOption<Tab>[] = [
    { value: 'alerts',      label: 'Alerts' },
    { value: 'escalations', label: 'Escalations' },
    { value: 'patient',     label: 'Patient Messages' }
  ];
  private readonly _tab = signal<Tab>('alerts');
  readonly tab = this._tab.asReadonly();
  setTab(t: Tab) { this._tab.set(t); }

  alertLabel(k: string): string {
    return {
      critical_value:           'Critical value alert',
      sample_rejection:         'Sample rejection',
      report_ready:             'Report ready',
      tat_breach:               'TAT breach',
      result_rejected:          'Result rejected by pathologist',
      sample_ready_collection:  'Sample ready for collection'
    }[k] ?? k;
  }

  private readonly _alerts = signal<AlertCfg[]>([
    { eventType: 'critical_value',          inAppEnabled: true,  whatsappEnabled: false, emailEnabled: false },
    { eventType: 'sample_rejection',        inAppEnabled: true,  whatsappEnabled: false, emailEnabled: false },
    { eventType: 'report_ready',            inAppEnabled: true,  whatsappEnabled: true,  emailEnabled: false },
    { eventType: 'tat_breach',              inAppEnabled: true,  whatsappEnabled: false, emailEnabled: false },
    { eventType: 'result_rejected',         inAppEnabled: true,  whatsappEnabled: false, emailEnabled: false },
    // Fires when a new billed order hits the collection queue in
    // dedicated_counter mode. Notifies every Sample Collector in the branch.
    { eventType: 'sample_ready_collection', inAppEnabled: true,  whatsappEnabled: false, emailEnabled: false }
  ]);
  readonly alerts = this._alerts.asReadonly();
  patchAlert(i: number, p: Partial<AlertCfg>) {
    this._alerts.update(list => list.map((a, idx) => idx === i ? { ...a, ...p } : a));
  }
  saveAlert(a: AlertCfg) {
    this.api.post('/api/config/notifications', a).subscribe({ next: () => this.toasts.success(`Saved ${a.eventType}`) });
  }

  private readonly _escalations = signal<EscalationCfg[]>([
    { eventType: 'critical_value', reminderIntervalMins: 15, maxReminders: 3, escalateAfterHrs: 1, criticalAfterHrs: 2 },
    { eventType: 'tat_breach',     reminderIntervalMins: 30, maxReminders: 2, escalateAfterHrs: 2, criticalAfterHrs: 4 },
    { eventType: 'sample_rejection', reminderIntervalMins: 60, maxReminders: 2, escalateAfterHrs: 4, criticalAfterHrs: 8 }
  ]);
  readonly escalations = this._escalations.asReadonly();
  patchEscalation(i: number, p: Partial<EscalationCfg>) {
    this._escalations.update(list => list.map((e, idx) => idx === i ? { ...e, ...p } : e));
  }
  saveEscalation(e: EscalationCfg) {
    this.api.post('/api/config/escalations', e).subscribe({ next: () => this.toasts.success(`Saved escalation for ${e.eventType}`) });
  }

  private readonly _patientTemplates = signal<PatientTemplate[]>([
    {
      key: 'order_confirmation', label: 'Order confirmation',
      body: 'Hi {{patient_name}}, your tests are booked. Barcode: {{barcode}}. Expected by {{expected_time}}.',
      variables: ['patient_name', 'barcode', 'expected_time']
    },
    {
      key: 'appointment_reminder', label: 'Appointment reminder',
      body: 'Hi {{patient_name}}, your appointment is at {{slot_time}} on {{date}} at {{branch_name}}.',
      variables: ['patient_name', 'slot_time', 'date', 'branch_name']
    },
    {
      key: 'report_ready', label: 'Report ready',
      body: 'Hi {{patient_name}}, your report is ready. View online: {{report_link}}',
      variables: ['patient_name', 'report_link']
    },
    {
      key: 'payment_receipt', label: 'Payment receipt',
      body: 'Payment of ₹{{amount}} received for order {{order_id}}. Invoice: {{invoice_link}}',
      variables: ['amount', 'order_id', 'invoice_link']
    }
  ]);
  readonly patientTemplates = this._patientTemplates.asReadonly();
  patchPatientTpl(i: number, body: string) {
    this._patientTemplates.update(list => list.map((t, idx) => idx === i ? { ...t, body } : t));
  }

  ngOnInit() {
    this.api.get<AlertCfg[]>('/api/config/notifications').subscribe({
      next: list => {
        if (list && list.length > 0) {
          this._alerts.update(existing => existing.map(e => list.find(x => x.eventType === e.eventType) ?? e));
        }
      }
    });
    this.api.get<EscalationCfg[]>('/api/config/escalations').subscribe({
      next: list => {
        if (list && list.length > 0) {
          this._escalations.update(existing => existing.map(e => list.find(x => x.eventType === e.eventType) ?? e));
        }
      }
    });
  }
}
