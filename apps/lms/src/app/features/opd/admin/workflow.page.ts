import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SkeletonFormComponent } from '../../../shared/primitives/skeleton-kit.component';
import { createLoadHold } from '../../../shared/utils/min-duration';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { OpdAdminApi, OpdWorkflowPatch, OpdWorkflowSettings } from './opd-admin.api';

interface Opt<T extends string> { value: T; label: string; hint: string; }

export const DEFAULT_WORKFLOW_SETTINGS: OpdWorkflowSettings = {
  workflow: { vitals: 'desk', vitalsBy: 'nurse', labTestsAtDesk: true, billing: 'before_consult',
    prefill: { purposeToComplaint: true, vitalsToHeader: true }, pharmacy: { enabled: true }, privateNotesVisibility: 'doctor',
    procedurePricing: { doctorCanChange: false, maxChangePercent: null } },
  queue: { organise: 'per_doctor', tokenPrefix: null, doctorUnavailable: 'manual', showOnScreen: true },
  pharmacy: { batchPick: 'earliest_expiry' },
};

/**
 * OPD workflow & settings (/admin/opd/workflow, Agent A) — every step is the
 * lab's own opt-in / opt-out (owner: configurable like the Process Builder):
 * vitals at the desk / a station / off and who takes them, when the patient
 * pays, pharmacy on / off, lab tests at the desk, what pre-fills the consult,
 * who reads private notes (doctor only by default), token series (per doctor
 * / room / department), what happens when a doctor is unavailable, and how
 * the pharmacy picks batches. Stored in opd_settings WorkflowJson / QueueJson
 * / PharmacyJson (merge-patch: only the key changed is sent). Changes save
 * as they are made — the page is the authority for these switches.
 */
@Component({
  selector: 'pf-opd-workflow',
  standalone: true,
  imports: [HeroBandComponent, ScreenHeaderComponent, SkeletonFormComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./opd-admin.shared.scss'],
  styles: [`
    .wf { display: flex; flex-direction: column; gap: 16px; }
    .wf-lane { display: flex; align-items: stretch; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
    .wf-step { flex: 1 0 200px; display: flex; flex-direction: column; gap: 10px; padding: 12px; border-radius: 12px; border: 1px solid var(--nd-line); background: var(--nd-card-bg); }
    .wf-step--off { opacity: .6; }
    .wf-step__top { display: flex; align-items: center; gap: 8px; }
    .wf-step__n { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 999px; font-size: 11.5px; font-weight: 700;
      color: var(--violet-text, #6d28d9); background: color-mix(in srgb, var(--color-primary, #7c3aed) 12%, transparent); }
    .wf-step__t { font-size: 13.5px; font-weight: 600; color: var(--text-primary); flex: 1 1 auto; }
    .wf-step__k { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--text-tertiary); }
    .wf-step__h { font-size: 12px; color: var(--text-secondary); line-height: 1.5; }
    .wf-always { font-size: 11px; color: var(--text-tertiary); border: 1px solid var(--nd-line); border-radius: 999px; padding: 1px 8px; }
    .wf-arrow { align-self: center; color: var(--text-tertiary); flex: none; }
    .wf-branch { font-size: 12.5px; color: var(--text-secondary); padding: 10px 12px; border-radius: 10px; background: var(--nd-chip-bg); border: 1px solid var(--nd-line); }
    .wf-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
    .wf-cards .nd-card__body { overflow: visible; }
    .wf-radio { display: flex; flex-direction: column; gap: 8px; }
    .wf-opt { display: flex; gap: 12px; align-items: flex-start; text-align: left; padding: 12px 14px; min-height: 52px; border-radius: 12px;
      border: 1px solid var(--nd-line); background: transparent; color: var(--text-primary); font: inherit; cursor: pointer; }
    .wf-opt[aria-checked='true'] { border-color: var(--nd-sel-border); background: var(--nd-sel-bg); }
    .wf-opt:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 1px; }
    .wf-dot { flex: none; width: 18px; height: 18px; margin-top: 1px; border-radius: 50%; border: 2px solid var(--nd-sel-border); position: relative; }
    .wf-opt[aria-checked='true'] .wf-dot { border-color: var(--color-violet-600, #7c3aed); }
    .wf-opt[aria-checked='true'] .wf-dot::after { content: ''; position: absolute; inset: 3px; border-radius: 50%; background: var(--color-violet-600, #7c3aed); }
    .wf-opt__t { display: flex; flex-direction: column; gap: 2px; font-size: 13.5px; font-weight: 600; }
    .wf-opt__t small { font-size: 12px; font-weight: 400; color: var(--text-tertiary); line-height: 1.45; }
    .wf-row { display: flex; flex-direction: column; gap: 10px; }
    .wf-prefix { max-width: 120px; text-transform: uppercase; }
    .wf-seg { flex-wrap: wrap; }
    @media (max-width: 640px) { .wf-lane { flex-direction: column; } .wf-step { flex: none; } .wf-arrow { transform: rotate(90deg); } }
  `],
  template: `
    <section class="pf-band-page px-4 md:px-8 lg:px-10 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" backTo="/admin/opd" [customSearch]="true" [contextBar]="true">
          <ng-container band-actions>
            <span class="nd-savestate" role="status" aria-live="polite">
              @if (saving()) { <span class="nd-savestate__dot" aria-hidden="true"></span><span>Saving…</span> }
              @else { <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><span>Changes save automatically</span> }
            </span>
          </ng-container>
          <div band-search class="nd-ctx"><span class="nd-ctx__primary">OPD workflow</span><span class="nd-ctx__chip"><span class="nd-ctx__k">Lab</span>unchanged</span></div>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only" eyebrow="OPD" title="OPD workflow" parentRoute="/admin/opd"
        subtitle="Turn steps on or off, choose where each runs and who does it, when the patient pays and who can read notes."></pf-screen-header>

      <div class="pf-band-body">
        @if (skeleton()) {
          <section class="nd-card"><div class="nd-card__body"><pf-skeleton-form [fields]="6" [cols]="2" label="Loading the OPD workflow…"></pf-skeleton-form></div></section>
        } @else {
        <div class="wf">
          <section class="nd-card">
            <header class="nd-card__head">
              <span class="nd-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM19 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM5 7v4a4 4 0 0 0 4 4h6a4 4 0 0 1 4 4"/></svg></span>
              <span class="nd-card__label">OPD visit flow</span>
              <span class="nd-card__note oa-hint">Turn a step off to skip it. Each step says where it runs and who does it.</span>
            </header>
            <div class="nd-card__body" style="overflow:visible">
              <div class="wf-lane">
                <div class="wf-step">
                  <div class="wf-step__top"><span class="wf-step__n">1</span><span class="wf-step__t">Front desk</span><span class="wf-always">Always on</span></div>
                  <span class="wf-step__h">Register, pick the doctor or department, bill.</span>
                  <button type="button" class="nd-toggle" role="switch" [attr.aria-checked]="s().workflow.labTestsAtDesk" (click)="put({ workflow: { labTestsAtDesk: !s().workflow.labTestsAtDesk } })">
                    <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>Lab tests can be added at the desk</button>
                </div>
                <svg class="wf-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                <div class="wf-step" [class.wf-step--off]="s().workflow.vitals === 'off'">
                  <div class="wf-step__top"><span class="wf-step__n">2</span><span class="wf-step__t">Vitals</span>
                    <button type="button" class="nd-toggle" role="switch" [attr.aria-checked]="s().workflow.vitals !== 'off'" aria-label="Vitals step on"
                            (click)="put({ workflow: { vitals: s().workflow.vitals === 'off' ? 'desk' : 'off' } })">
                      <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span></button></div>
                  @if (s().workflow.vitals !== 'off') {
                    <span class="wf-step__k">Where</span>
                    <span class="nd-seg wf-seg" role="radiogroup" aria-label="Where vitals are taken">
                      <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="s().workflow.vitals === 'desk'" (click)="put({ workflow: { vitals: 'desk', vitalsBy: 'front_desk' } })">Front desk screen</button>
                      <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="s().workflow.vitals === 'station'" (click)="put({ workflow: { vitals: 'station' } })">Separate station</button>
                    </span>
                    @if (s().workflow.vitals === 'station') {
                    <span class="wf-step__k">Who</span>
                    <span class="nd-seg wf-seg" role="radiogroup" aria-label="Who takes vitals">
                      <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="s().workflow.vitalsBy === 'nurse'" (click)="put({ workflow: { vitalsBy: 'nurse' } })">Nurse</button>
                      <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="s().workflow.vitalsBy === 'front_desk'" (click)="put({ workflow: { vitalsBy: 'front_desk' } })">Front desk</button>
                    </span>
                    } @else { <span class="wf-step__h">Taken by the front desk while booking.</span> }
                  } @else { <span class="wf-step__h">Skipped — the patient goes straight to the doctor's queue.</span> }
                </div>
                <svg class="wf-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                <div class="wf-step">
                  <div class="wf-step__top"><span class="wf-step__n">3</span><span class="wf-step__t">Doctor</span><span class="wf-always">Always on</span></div>
                  <span class="wf-step__h">Findings, diagnosis, prescription, notes, lab orders.</span>
                  <span class="wf-step__k">Pre-fill the consult</span>
                  <button type="button" class="nd-toggle" role="switch" [attr.aria-checked]="s().workflow.prefill.purposeToComplaint" (click)="togglePrefill('purposeToComplaint')">
                    <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>Visit purpose → chief complaint</button>
                  <button type="button" class="nd-toggle" role="switch" [attr.aria-checked]="s().workflow.prefill.vitalsToHeader" (click)="togglePrefill('vitalsToHeader')">
                    <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>Vitals in the consult header</button>
                </div>
                <svg class="wf-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                <div class="wf-step" [class.wf-step--off]="!s().workflow.pharmacy.enabled">
                  <div class="wf-step__top"><span class="wf-step__n">4</span><span class="wf-step__t">Pharmacy</span>
                    <button type="button" class="nd-toggle" role="switch" [attr.aria-checked]="s().workflow.pharmacy.enabled" aria-label="Pharmacy step on"
                            (click)="togglePharmacy()"><span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span></button></div>
                  <span class="wf-step__h">{{ s().workflow.pharmacy.enabled ? 'Prescriptions reach the pharmacy counter.' : 'Off — patients buy medicines outside; the prescription still prints.' }}</span>
                </div>
                <svg class="wf-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                <div class="wf-step">
                  <div class="wf-step__top"><span class="wf-step__n">5</span><span class="wf-step__t">Exit</span><span class="wf-always">Always on</span></div>
                  <span class="wf-step__h">Follow-up booked, instructions given, visit closed.</span>
                </div>
              </div>
              <p class="wf-branch">Lab tests ordered at the desk or by the doctor join the existing lab flow: Collect → Lab → Validate → Results. Nothing in the lab changes.</p>
            </div>
          </section>

          <div class="wf-cards">
            <section class="nd-card">
              <header class="nd-card__head"><span class="nd-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg></span>
                <span class="nd-card__label">When the patient pays</span></header>
              <div class="nd-card__body wf-radio" role="radiogroup" aria-label="When the patient pays">
                @for (o of billingOpts; track o.value) {
                  <button type="button" class="wf-opt" role="radio" [attr.aria-checked]="s().workflow.billing === o.value" (click)="put({ workflow: { billing: o.value } })">
                    <span class="wf-dot" aria-hidden="true"></span><span class="wf-opt__t">{{ o.label }}<small>{{ o.hint }}</small></span></button>
                }
              </div>
            </section>

            <section class="nd-card" data-card="procedure-prices">
              <header class="nd-card__head"><span class="nd-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg></span>
                <span class="nd-card__label">Procedure prices</span></header>
              <div class="nd-card__body wf-row">
                <button type="button" class="nd-toggle" role="switch" [attr.aria-checked]="s().workflow.procedurePricing.doctorCanChange" (click)="toggleProcedurePricing()">
                  <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>Doctors can change procedure prices</button>
                <span class="wf-step__h">{{ s().workflow.procedurePricing.doctorCanChange
                  ? 'In the consult, the doctor can type the exact amount for a procedure. The front desk sees "set by Dr … (rule ₹…)" on the bill, and every change is in the audit log.'
                  : 'Off — doctors see the OPD Master price and cannot change it. The front desk can still give a discount within their limit.' }}</span>
                @if (s().workflow.procedurePricing.doctorCanChange) {
                  <label class="oa-field"><span class="oa-field__lbl">Most a doctor can change it (%)</span>
                    <input class="nd-input nd-num wf-prefix" type="text" inputmode="numeric" maxlength="3" [value]="s().workflow.procedurePricing.maxChangePercent ?? ''"
                           placeholder="No limit" aria-label="Most a doctor can change a procedure price, in percent" (change)="setProcedureCap($any($event.target).value)">
                    <span class="oa-field__hint">Up or down from the OPD Master price, e.g. 20 lets ₹1,500 go from ₹1,200 to ₹1,800. Blank = any amount.</span></label>
                }
              </div>
            </section>

            <section class="nd-card">
              <header class="nd-card__head"><span class="nd-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
                <span class="nd-card__label">Who reads private notes</span></header>
              <div class="nd-card__body wf-radio" role="radiogroup" aria-label="Who reads private notes">
                @for (o of notesOpts; track o.value) {
                  <button type="button" class="wf-opt" role="radio" [attr.aria-checked]="s().workflow.privateNotesVisibility === o.value" (click)="put({ workflow: { privateNotesVisibility: o.value } })">
                    <span class="wf-dot" aria-hidden="true"></span><span class="wf-opt__t">{{ o.label }}<small>{{ o.hint }}</small></span></button>
                }
              </div>
            </section>

            <section class="nd-card">
              <header class="nd-card__head"><span class="nd-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h10M4 18h6"/></svg></span>
                <span class="nd-card__label">Queue &amp; tokens</span></header>
              <div class="nd-card__body wf-row">
                <span class="oa-field__lbl">Token series</span>
                <span class="nd-seg wf-seg" role="radiogroup" aria-label="Token series">
                  @for (o of organiseOpts; track o.value) {
                    <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="s().queue.organise === o.value" [title]="o.hint" (click)="put({ queue: { organise: o.value } })">{{ o.label }}</button>
                  }
                </span>
                <label class="oa-field"><span class="oa-field__lbl">Clinic token prefix</span>
                  <input class="nd-input nd-num wf-prefix" maxlength="4" [value]="s().queue.tokenPrefix ?? ''" placeholder="—" (change)="setPrefix($any($event.target).value)">
                  <span class="oa-field__hint">Up to 4 letters or digits. A doctor's own prefix (Doctors screen) wins.</span></label>
                <button type="button" class="nd-toggle" role="switch" [attr.aria-checked]="s().queue.showOnScreen" (click)="put({ queue: { showOnScreen: !s().queue.showOnScreen } })">
                  <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>Show tokens on the waiting-room screen</button>
              </div>
            </section>

            <section class="nd-card">
              <header class="nd-card__head"><span class="nd-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM17 11l4 4M21 11l-4 4"/></svg></span>
                <span class="nd-card__label">Doctor unavailable</span></header>
              <div class="nd-card__body wf-radio" role="radiogroup" aria-label="When a doctor is unavailable">
                @for (o of unavailableOpts; track o.value) {
                  <button type="button" class="wf-opt" role="radio" [attr.aria-checked]="s().queue.doctorUnavailable === o.value" (click)="put({ queue: { doctorUnavailable: o.value } })">
                    <span class="wf-dot" aria-hidden="true"></span><span class="wf-opt__t">{{ o.label }}<small>{{ o.hint }}</small></span></button>
                }
              </div>
            </section>

            <section class="nd-card">
              <header class="nd-card__head"><span class="nd-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8l9 5 9-5ZM3 8v8l9 5 9-5V8"/></svg></span>
                <span class="nd-card__label">Pharmacy batches</span></header>
              <div class="nd-card__body wf-radio" role="radiogroup" aria-label="Batch picking">
                @for (o of batchOpts; track o.value) {
                  <button type="button" class="wf-opt" role="radio" [attr.aria-checked]="s().pharmacy.batchPick === o.value" (click)="put({ pharmacy: { batchPick: o.value } })">
                    <span class="wf-dot" aria-hidden="true"></span><span class="wf-opt__t">{{ o.label }}<small>{{ o.hint }}</small></span></button>
                }
              </div>
            </section>
          </div>
        </div>
        }
      </div>
    </section>
  `,
})
export class OpdWorkflowPage {
  private readonly api = inject(OpdAdminApi);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);
  protected readonly theme = inject(ThemeService);

  readonly s = signal<OpdWorkflowSettings>(structuredClone(DEFAULT_WORKFLOW_SETTINGS));
  readonly saving = signal(false);
  private readonly hold = createLoadHold(true);
  readonly skeleton = this.hold.active;

  readonly billingOpts: Opt<OpdWorkflowSettings['workflow']['billing']>[] = [
    { value: 'before_consult', label: 'Pay at booking', hint: 'The front desk collects the consultation fee before the token is issued.' },
    { value: 'after_consult', label: 'Pay after consult', hint: 'One bill at exit: consultation, procedures, lab tests and medicines.' },
  ];
  readonly notesOpts: Opt<OpdWorkflowSettings['workflow']['privateNotesVisibility']>[] = [
    { value: 'doctor', label: 'Doctor only', hint: 'Private notes stay with the doctor who wrote them.' },
    { value: 'department', label: '+ Doctors of the department', hint: 'Doctors in the same OPD department can read them.' },
    { value: 'all_doctors', label: '+ All doctors', hint: 'Every doctor in the clinic can read them.' },
  ];
  readonly organiseOpts: Opt<OpdWorkflowSettings['queue']['organise']>[] = [
    { value: 'per_doctor', label: 'Per doctor', hint: 'Each doctor has their own token series (A1, B1…).' },
    { value: 'per_room', label: 'Per room', hint: 'One series per consulting room.' },
    { value: 'per_department', label: 'Per department', hint: 'One series per department — any free doctor takes the next token.' },
  ];
  readonly unavailableOpts: Opt<OpdWorkflowSettings['queue']['doctorUnavailable']>[] = [
    { value: 'manual', label: 'Front desk reassigns', hint: 'Waiting patients stay put until the desk moves them to another doctor.' },
    { value: 'auto_move', label: 'Move to another doctor', hint: 'Waiting patients move to a doctor of the same department automatically.' },
    { value: 'reschedule', label: 'Reschedule with notice', hint: 'Waiting patients are told and offered another slot.' },
  ];
  readonly batchOpts: Opt<OpdWorkflowSettings['pharmacy']['batchPick']>[] = [
    { value: 'earliest_expiry', label: 'Earliest expiry, automatically', hint: 'The cart takes the batch that expires first.' },
    { value: 'pharmacist', label: 'Pharmacist picks', hint: 'The pharmacist chooses the batch for each line.' },
  ];

  constructor() {
    this.api.workflow().subscribe({
      next: (w) => { this.hold.done(); this.s.set(mergeSettings(w)); },
      error: () => { this.hold.done(); this.toasts.error('Could not load the OPD workflow'); },
    });
  }

  /** Apply a change now and save it (merge-patch); roll back on failure. */
  put(patch: OpdWorkflowPatch): void {
    const before = this.s();
    this.s.set(applyPatch(before, patch));
    this.saving.set(true);
    this.api.saveWorkflow(patch).subscribe({
      next: (w) => { this.saving.set(false); this.s.set(mergeSettings(w)); },
      error: (e: Error) => { this.saving.set(false); this.s.set(before); this.toasts.error(e.message || 'Could not save that change'); },
    });
  }

  async togglePharmacy(): Promise<void> {
    const on = this.s().workflow.pharmacy.enabled;
    if (on) {
      const ok = await this.dialog.confirm({ title: 'Turn the pharmacy step off?', message: 'Prescriptions will no longer reach the pharmacy counter. They still print for the patient.', confirmLabel: 'Turn off', tone: 'danger' });
      if (!ok) return;
    }
    this.put({ workflow: { pharmacy: { enabled: !on } } });
  }

  togglePrefill(k: 'purposeToComplaint' | 'vitalsToHeader'): void {
    const p = this.s().workflow.prefill;
    this.put({ workflow: { prefill: { ...p, [k]: !p[k] } } });
  }

  toggleProcedurePricing(): void {
    const p = this.s().workflow.procedurePricing;
    this.put({ workflow: { procedurePricing: { ...p, doctorCanChange: !p.doctorCanChange } } });
  }

  /** The cap: a whole percent 1–100, blank = no cap. */
  setProcedureCap(v: string): void {
    const t = String(v ?? '').trim().replace(/%$/, '');
    const cap = t === '' ? null : Number(t);
    if (cap !== null && (!Number.isInteger(cap) || cap < 1 || cap > 100)) { this.toasts.error('The limit is a whole percent from 1 to 100 (blank = no limit)'); return; }
    const p = this.s().workflow.procedurePricing;
    if (cap !== p.maxChangePercent) this.put({ workflow: { procedurePricing: { ...p, maxChangePercent: cap } } });
  }

  setPrefix(v: string): void {
    const p = String(v ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{0,4}$/.test(p)) { this.toasts.error('A token prefix is up to 4 letters or digits'); return; }
    if (p !== (this.s().queue.tokenPrefix ?? '')) this.put({ queue: { tokenPrefix: p || null } });
  }
}

/** Server settings over the defaults (a missing key keeps its default). */
export function mergeSettings(w: Partial<OpdWorkflowSettings> | null | undefined): OpdWorkflowSettings {
  const d = DEFAULT_WORKFLOW_SETTINGS;
  return {
    workflow: { ...d.workflow, ...(w?.workflow ?? {}), prefill: { ...d.workflow.prefill, ...(w?.workflow?.prefill ?? {}) },
      pharmacy: { ...d.workflow.pharmacy, ...(w?.workflow?.pharmacy ?? {}) },
      procedurePricing: { ...d.workflow.procedurePricing, ...(w?.workflow?.procedurePricing ?? {}) } },
    queue: { ...d.queue, ...(w?.queue ?? {}) },
    pharmacy: { ...d.pharmacy, ...(w?.pharmacy ?? {}) },
  };
}

/** The optimistic local copy of a merge-patch. */
export function applyPatch(s: OpdWorkflowSettings, p: OpdWorkflowPatch): OpdWorkflowSettings {
  return mergeSettings({
    workflow: { ...s.workflow, ...(p.workflow ?? {}) } as OpdWorkflowSettings['workflow'],
    queue: { ...s.queue, ...(p.queue ?? {}) },
    pharmacy: { ...s.pharmacy, ...(p.pharmacy ?? {}) },
  });
}
