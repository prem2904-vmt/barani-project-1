import { ChangeDetectionStrategy, Component, ElementRef, Input, OnChanges, SimpleChanges, TemplateRef, computed, inject, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import {
  ConditionLogic,
  ConditionOperator,
  ConditionRule,
  ConditionalRoute,
  WorkflowConfig,
  WorkflowContext,
  WorkflowField,
  WorkflowFormValues,
  WorkflowStep,
  WorkflowTransition
} from '../../models/workflow.model';
import { TestParameter } from '../../models/test.model';
import { DynamicInputComponent } from '../dynamic-input/dynamic-input.component';
import { validateFieldValue } from '../../forms/validate';
import { PfSelectOption, SelectComponent } from '../../primitives/select.component';

export interface WorkflowRendererResources {
  /** When a field has type 'test_parameters', these drive the per-parameter inputs. */
  testParameters?: TestParameter[];
  /** Option providers keyed by field.dataSource (patients, doctors, tests, available_slots). */
  dataSources?: Record<string, Array<{ value: string; label: string }>>;
}

export interface WorkflowStepCompleteEvent {
  step: WorkflowStep;
  values: WorkflowFormValues;
}

@Component({
  selector: 'pf-workflow-renderer',
  standalone: true,
  imports: [DynamicInputComponent, NgTemplateOutlet, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let cfg = config();
    @if (!cfg || visibleSteps().length === 0) {
      <div class="pf-card text-sm text-slate-500">Nothing to render.</div>
    } @else if (singlePage() && nd()) {
      <!-- NEW DESIGN (ND-PATTERN §15): ONE form, every step visible at once
           as its own section card (violet icon chip + label + "N required").
           The host lays the cards out (3 / 2 / 1 columns) and owns the
           actions (the ONE primary sits in the band). Keyboard-first: Enter
           moves to the next field in reading order; on the last field it
           asks the host to submit (enterSubmit). Errors are field-level. -->
      <div class="pf-wr-cards" (keydown)="onNdKey($event)">
        @for (s of visibleSteps(); track s.id) {
          @let req = requiredCount(s);
          <section class="nd-card pf-wr-card" [attr.data-step]="s.id" [attr.aria-labelledby]="'pf-wr-h-' + s.id">
            <div class="nd-card__head pf-wr-card__head">
              <span class="nd-card__icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  @switch (stepKind(s)) {
                    @case ('identity') { <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/> }
                    @case ('contact') { <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/> }
                    @case ('more') { <path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/> }
                    @default { <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/> }
                  }
                </svg>
              </span>
              <h2 class="nd-card__label pf-wr-card__label" [id]="'pf-wr-h-' + s.id">{{ s.title }}</h2>
              <span class="pf-wr-card__note">
                @if (req > 0) { <span class="nd-dot-unpriced" aria-hidden="true"></span>{{ req }} required } @else { Optional }
              </span>
              <span class="nd-card__spacer"></span>
              @if (stepHeaderTpl() && stepHeaderFor() === s.id) {
                <span class="pf-wr-card__extra"><ng-container *ngTemplateOutlet="stepHeaderTpl()!"></ng-container></span>
              }
            </div>
            <div class="nd-card__body pf-wr-card__body">
              <ng-container *ngTemplateOutlet="stepFields; context: { $implicit: s }"></ng-container>
            </div>
          </section>
        }
      </div>
      @if (!hideActions()) {
        <div class="mt-5 flex flex-wrap gap-3 justify-end items-center">
          @for (action of extraActions(); track action.id) {
            <button type="button" class="nd-btn nd-btn--secondary" [disabled]="submitting()"
                    (click)="triggerExtraAction(action.id)">{{ action.label }}</button>
          }
          <button type="button" class="nd-btn nd-btn--primary" [disabled]="submitting()"
                  (click)="finish()">{{ submitting() ? 'Submitting…' : finishLabel() }}</button>
        </div>
      }
    } @else if (singlePage()) {
      <!-- SINGLE-PAGE: every step is a visible, titled section (no hidden
           "Add more" reveal — configured extra fields must be discoverable).
           One shared header vocabulary; a single Submit finishes (no Next). -->
      @for (s of visibleSteps(); track s.id; let first = $first) {
        <div [class.mt-8]="!first">
          <div class="flex items-center gap-3 mb-4">
            <h3 class="text-[11px] font-bold uppercase tracking-[0.14em] shrink-0"
                style="color: var(--text-tertiary, #64748b);">{{ s.title }}</h3>
            <span class="flex-1 h-px" style="background: var(--glass-border, rgba(148,163,184,0.25));"></span>
          </div>
          <ng-container *ngTemplateOutlet="stepFields; context: { $implicit: s }"></ng-container>
        </div>
      }

      @if (validationError(); as err) {
        <p class="mt-3 text-xs text-red-600">{{ err }}</p>
      }

      <div class="mt-5 flex flex-wrap gap-3 justify-end items-center">
        @for (action of extraActions(); track action.id) {
          <button type="button" class="pf-btn"
                  [class.pf-btn-primary]="action.variant === 'primary'"
                  [class.pf-btn-ghost]="action.variant !== 'primary'"
                  [disabled]="submitting()"
                  (click)="triggerExtraAction(action.id)">{{ action.label }}</button>
        }
        <button type="button" class="pf-btn pf-btn-primary"
                [disabled]="submitting()"
                (click)="finish()">{{ submitting() ? 'Submitting…' : finishLabel() }}</button>
      </div>
    } @else {
      @let step = visibleSteps()[currentIndex()];

      <div class="mb-4">
        <div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
          @for (s of visibleSteps(); let i = $index; track s.id) {
            <span class="inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold"
                  [class.bg-[var(--color-primary)]]="i <= currentIndex()"
                  [class.text-white]="i <= currentIndex()"
                  [class.bg-slate-200]="i > currentIndex()"
                  [class.text-slate-500]="i > currentIndex()">{{ i + 1 }}</span>
            @if (i < visibleSteps().length - 1) {
              <span class="flex-1 h-px bg-slate-300"></span>
            }
          }
        </div>
        <h2 class="text-base font-semibold text-slate-900">{{ step.title }}</h2>
      </div>

      <ng-container *ngTemplateOutlet="stepFields; context: { $implicit: step }"></ng-container>

      @if (validationError(); as err) {
        <p class="mt-3 text-xs text-red-600">{{ err }}</p>
      }

      <div class="mt-5 flex flex-wrap gap-3 justify-between items-center">
        <button type="button" class="pf-btn pf-btn-ghost"
                [disabled]="currentIndex() === 0"
                (click)="back()">← Back</button>
        @if (isLastStep()) {
          <div class="flex items-center gap-2">
            @for (action of extraActions(); track action.id) {
              <button type="button" class="pf-btn"
                      [class.pf-btn-primary]="action.variant === 'primary'"
                      [class.pf-btn-ghost]="action.variant !== 'primary'"
                      [disabled]="submitting()"
                      (click)="triggerExtraAction(action.id)">{{ action.label }}</button>
            }
            <button type="button" class="pf-btn pf-btn-primary"
                    [disabled]="submitting()"
                    (click)="finish()">{{ submitting() ? 'Submitting…' : finishLabel() }}</button>
          </div>
        } @else {
          <button type="button" class="pf-btn pf-btn-primary"
                  (click)="next()">Next →</button>
        }
      </div>
    }

    <!-- One field grid, reused by both single-page and stepped modes. The
         single-page form runs full-bleed, so it steps up to three columns on
         wide viewports — two viewport-wide inputs read as stretched, three
         stay proportioned. Stepped mode (drawers, narrower hosts) keeps two. -->
    <ng-template #stepFields let-step>
      <div [class]="gridClass()">
        @for (f of visibleFields(step); track f.id) {
          @if (f.type === 'test_parameters') {
            @if (testParamFields().length === 0) {
              <div [class]="widthClass('full') + ' rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500'">
                No parameters configured on this test.
              </div>
            } @else {
              <div [class]="widthClass('full') + ' grid grid-cols-1 md:grid-cols-2 gap-4'">
                @for (p of testParamFields(); track p.name) {
                  <div class="md:col-span-2">
                    <pf-dynamic-input
                      [field]="testParamConfig(p)"
                      [value]="valueFor(step, p.name)"
                      [context]="context()"
                      [nd]="nd()"
                      (valueChange)="setValue(step, p.name, $event)"></pf-dynamic-input>
                  </div>
                }
              </div>
            }
          } @else if (f.type === 'tube_collection') {
            <div [class]="widthClass('full') + ' space-y-2'">
              @if (tubes().length === 0) {
                <div class="rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs text-slate-500 text-center">
                  No tubes in context. Scan a barcode in the previous step to populate.
                </div>
              } @else {
                @for (tube of tubes(); track tube.id) {
                  <label class="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 cursor-pointer">
                    <input type="checkbox"
                          [checked]="isTubeCollected(step, f.name, tube.id)"
                          (change)="toggleTube(step, f.name, tube.id)" />
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-medium">{{ tube.label ?? tube.id }}</p>
                      @if (tube.subtitle) { <p class="text-xs text-slate-500">{{ tube.subtitle }}</p> }
                    </div>
                    @if (tube.barcode) {
                      <span class="font-mono text-[11px] text-slate-500">{{ tube.barcode }}</span>
                    }
                  </label>
                }
              }
            </div>
          } @else if (isGroupedIdentityField(step, f)) {
            <!-- the honorific renders as a prefix inside the first-name cell — skip. -->
          } @else if (isNameRow(step, f)) {
            <!-- First name with the Title honorific as a compact prefix in the
                 SAME box row: [Mr. ▾ | First name]. Everything else (Last name,
                 Sex, …) stays a normal equal-width grid cell, so every box edge
                 on the form lines up. -->
            <div [class]="widthClass(f.width)">
              <div class="flex flex-col gap-1.5">
                <label class="pf-label">
                  {{ f.title }}
                  @if (f.isRequired) { <span class="text-red-500">*</span> }
                </label>
                <div class="flex items-center gap-2">
                  @if (groupTitleField(step); as tf) {
                    <pf-select class="w-[104px] flex-shrink-0"
                      [options]="fieldSelectOptions(tf)"
                      [value]="valueFor(step, tf.name)"
                      [placeholder]="tf.title"
                      (valueChange)="setValue(step, tf.name, $event)"></pf-select>
                  }
                  <input type="text" class="pf-input flex-1 min-w-0" [placeholder]="f.placeholder ?? ''"
                         [value]="textValue(step, f.name)"
                         (input)="setValue(step, f.name, $any($event.target).value)" />
                </div>
              </div>
            </div>
          } @else {
            <div [class]="nd() ? ndSpan(f) : widthClass(f.width)">
              <pf-dynamic-input
                [field]="fieldConfig(f)"
                [value]="valueFor(step, f.name)"
                [context]="context()"
                [nd]="nd()"
                [error]="nd() ? fieldError(step, f.name) : null"
                [defaultCountryCode]="nd() ? $any(context()['defaultPhoneCode'] ?? null) : null"
                (valueChange)="setValue(step, f.name, $event)"></pf-dynamic-input>
            </div>
          }
        } @empty {
          <div [class]="widthClass('full') + ' text-sm text-slate-500 py-6 text-center'">
            This step has no fields.
          </div>
        }
      </div>
    </ng-template>
  `,
  styles: [`
    /* New design (§15): section cards — 1 column on phones, 2 on tablets,
       3 side by side from 1200px, where the row fills the host's height and
       only a card BODY scrolls (never the page). */
    .pf-wr-cards { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; align-items: start; }
    @media (min-width: 768px) { .pf-wr-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (min-width: 1200px) {
      .pf-wr-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); grid-auto-rows: minmax(0, 1fr);
        align-items: stretch; height: 100%; min-height: 0; }
      .pf-wr-card { min-height: 0; }
    }
    .pf-wr-card__head { row-gap: 8px; }
    .pf-wr-card__note { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-tertiary); white-space: nowrap; }
    .pf-wr-card__extra { display: inline-flex; flex-wrap: wrap; gap: 6px; }
    .pf-wr-card__body { padding: 16px; container-type: inline-size; }
    /* Fields inside a card: two columns; full-width fields span both. */
    .pf-wr-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 12px; }
    .pf-wr-span { grid-column: 1 / -1; }
    @container (max-width: 340px) { .pf-wr-grid { grid-template-columns: minmax(0, 1fr); } }
    @media (max-width: 640px) {
      .pf-wr-grid { grid-template-columns: minmax(0, 1fr); }
      .pf-wr-card__body { padding: 14px; }
      /* Beat the global phone h2 cap (!important): the card label is 12px. */
      h2.nd-card__label.pf-wr-card__label { font-size: 12px !important; line-height: 1.3 !important; }
    }
    /* Same 44px control height / 12px radius the dynamic inputs use — the
       renderer's own raw inputs and the title-prefix select must not sit a
       few pixels off from their neighbours. */
    :host input.pf-input { height: 44px; }
    :host ::ng-deep .pf-dd__trigger {
      height: 44px;
      border-radius: 12px;
    }
  `]
})
export class WorkflowRendererComponent implements OnChanges {
  readonly config = input<WorkflowConfig | null>(null);
  readonly context = input<WorkflowContext>({});
  readonly resources = input<WorkflowRendererResources>({});
  readonly finishLabel = input<string>('Finish');
  readonly submitting = input<boolean>(false);
  readonly extraActions = input<Array<{ id: string; label: string; variant?: 'primary' | 'ghost' }>>([]);
  /** Single-page mode: no step wizard. The first step's fields show always; any
   *  later steps are revealed inline by "Add more"; one Submit finishes. Used by
   *  the patient-registration form. */
  readonly singlePage = input<boolean>(false);
  /** New-design markup (ND-PATTERN §14): kit fields, no in-form headings.
   *  Only meaningful with singlePage. Off by default (workflow preview …). */
  readonly nd = input<boolean>(false);
  /** New design: extra header content (e.g. ABHA buttons) for ONE card. */
  readonly stepHeaderTpl = input<TemplateRef<unknown> | null>(null);
  /** …the id of the step whose card carries it. */
  readonly stepHeaderFor = input<string | null>(null);
  /** New design: Enter on the LAST field — the host submits. */
  readonly enterSubmit = output<void>();
  /** The host renders the actions itself (the band's ONE primary). */
  readonly hideActions = input<boolean>(false);
  /** Single-page validation failed: which step holds the first problem. */
  readonly invalid = output<{ stepId: string; fieldName: string; message: string }>();

  @Input() initialValues: WorkflowFormValues = {};

  readonly stepComplete = output<WorkflowStepCompleteEvent>();
  readonly workflowComplete = output<WorkflowFormValues>();
  readonly valuesChange = output<WorkflowFormValues>();
  readonly extraActionClicked = output<{ actionId: string; values: WorkflowFormValues }>();

  private readonly _formValues = signal<WorkflowFormValues>({});
  private readonly _currentIndex = signal<number>(0);
  private readonly _validationError = signal<string | null>(null);

  readonly currentIndex = this._currentIndex.asReadonly();
  readonly formValues = this._formValues.asReadonly();
  readonly validationError = this._validationError.asReadonly();

  /** Steps pre-filtered by showWhen — never show a step whose showWhen is false. */
  readonly visibleSteps = computed<WorkflowStep[]>(() => {
    const cfg = this.config();
    if (!cfg) return [];
    return cfg.steps.filter(s => this.evaluateRules(s.showWhen ?? [], 'AND'));
  });

  readonly isLastStep = computed(() => this.currentIndex() >= this.visibleSteps().length - 1);

  /** Validate required fields across ALL steps (single-page has no per-step gate). */
  private validateAll(): boolean {
    if (this.nd()) return this.validateAllNd();
    const steps = this.visibleSteps();
    for (let i = 0; i < steps.length; i++) {
      for (const f of this.visibleFields(steps[i])) {
        if (f.type === 'test_parameters') continue;
        const v = this.valueFor(steps[i], f.name);
        const err = validateFieldValue(f, v);
        if (err) {
          const message = `${f.title}: ${err}`;
          this._validationError.set(message);
          this.invalid.emit({ stepId: steps[i].id, fieldName: f.name, message });
          return false;
        }
      }
    }
    this._validationError.set(null);
    return true;
  }

  // ── New design (§15): field-level errors + keyboard-first ──────────
  private readonly host = inject(ElementRef<HTMLElement>);
  /** `step.name::field` → message, for every invalid field at once. */
  private readonly _fieldErrors = signal<Record<string, string>>({});
  readonly fieldErrors = this._fieldErrors.asReadonly();
  fieldError(step: WorkflowStep, name: string): string | null {
    return this._fieldErrors()[`${step.name}::${name}`] ?? null;
  }

  /** Validate every field of every visible step; outline each invalid one
   *  and move focus to the FIRST (in reading order), scrolled into view. */
  private validateAllNd(): boolean {
    const errs: Record<string, string> = {};
    let first: { step: WorkflowStep; f: WorkflowField; message: string } | null = null;
    for (const step of this.visibleSteps()) {
      for (const f of this.visibleFields(step)) {
        if (f.type === 'test_parameters') continue;
        const err = validateFieldValue(f, this.valueFor(step, f.name));
        if (!err) continue;
        errs[`${step.name}::${f.name}`] = err;
        if (!first) first = { step, f, message: `${f.title}: ${err}` };
      }
    }
    this._fieldErrors.set(errs);
    if (!first) { this._validationError.set(null); return true; }
    this._validationError.set(first.message);
    this.invalid.emit({ stepId: first.step.id, fieldName: first.f.name, message: first.message });
    const name = first.f.name;
    const stepId = first.step.id;
    setTimeout(() => {
      const root = this.host.nativeElement as HTMLElement;
      const wrap = root.querySelector<HTMLElement>(`[data-step="${stepId}"] [data-field="${name}"]`)
        ?? root.querySelector<HTMLElement>(`[data-field="${name}"]`);
      if (!wrap) return;
      wrap.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      WorkflowRendererComponent.stopOf(wrap)?.focus();
    });
    return false;
  }

  /** Required fields a card shows in its header ("2 required"). */
  requiredCount(step: WorkflowStep): number {
    return this.visibleFields(step).filter(f => f.isRequired).length;
  }

  /** The card glyph: the registration form's split steps by id, else generic. */
  stepKind(step: WorkflowStep): 'identity' | 'contact' | 'more' | 'other' {
    if (step.id.endsWith('__identity')) return 'identity';
    if (step.id.endsWith('__contact')) return 'contact';
    if (step.name === 'additional_info') return 'more';
    return 'other';
  }

  /** In a card, fields sit two-up; wide controls take the whole row. */
  ndSpan(f: WorkflowField): string {
    const wide = f.width === 'full'
      || ['phone', 'textarea', 'multiselect', 'multi_button_select', 'test_parameters', 'tube_collection'].includes(f.type)
      || (f.type === 'date' && /(^|_)dob$|date_of_birth|birth_?date/i.test(f.name))
      || (['button_select', 'image_select', 'radio'].includes(f.type) && (f.options?.length ?? 0) > 4);
    return wide ? 'pf-wr-span' : '';
  }

  /** The control Enter / validation lands on inside a field. */
  private static stopOf(wrap: HTMLElement): HTMLElement | null {
    return wrap.querySelector<HTMLElement>('[data-pf-stop]:not([disabled])')
      ?? wrap.querySelector<HTMLElement>('input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), button:not([disabled])');
  }

  /** Enter = next field in reading order (card by card, top to bottom);
   *  on the last field it submits. Textareas keep Enter for new lines and
   *  an open pf-select keeps it for picking. */
  onNdKey(e: KeyboardEvent): void {
    if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
    const t = e.target as HTMLElement | null;
    if (!t || t.tagName === 'TEXTAREA' || t.closest('pf-select')) return;
    const wrap = t.closest<HTMLElement>('[data-field]');
    if (!wrap) return;
    e.preventDefault();
    const root = this.host.nativeElement as HTMLElement;
    const fields = Array.from(root.querySelectorAll<HTMLElement>('[data-field]'));
    for (let j = fields.indexOf(wrap) + 1; j < fields.length; j++) {
      const stop = WorkflowRendererComponent.stopOf(fields[j]);
      if (stop) {
        stop.focus();
        if (stop instanceof HTMLInputElement && stop.type !== 'date') { try { stop.select(); } catch { /* not selectable */ } }
        return;
      }
    }
    this.enterSubmit.emit();
  }

  /** True when every visible field of the step passes validation — the
   *  host's section-tab dot (filled = complete, ring = something to finish).
   *  Pure: never touches the on-screen validation message. */
  isStepValid(step: WorkflowStep): boolean {
    for (const f of this.visibleFields(step)) {
      if (f.type === 'test_parameters') continue;
      if (validateFieldValue(f, this.valueFor(step, f.name))) return false;
    }
    return true;
  }

  readonly testParamFields = computed<TestParameter[]>(() =>
    this.resources().testParameters ?? []);

  readonly tubes = computed<Array<{ id: string; label?: string; subtitle?: string; barcode?: string }>>(() =>
    (this.context()['tubes'] as Array<{ id: string; label?: string; subtitle?: string; barcode?: string }> | undefined) ?? []);

  isTubeCollected(step: WorkflowStep, fieldName: string, tubeId: string): boolean {
    const arr = this.valueFor(step, fieldName);
    return Array.isArray(arr) && arr.includes(tubeId);
  }

  toggleTube(step: WorkflowStep, fieldName: string, tubeId: string): void {
    const current = this.valueFor(step, fieldName);
    const list = Array.isArray(current) ? [...current] : [];
    const i = list.indexOf(tubeId);
    if (i >= 0) list.splice(i, 1); else list.push(tubeId);
    this.setValue(step, fieldName, list);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if ('initialValues' in changes) {
      this._formValues.set({ ...(this.initialValues ?? {}) });
    }
  }

  // ── rendering helpers ──────────────────────────────────────────

  visibleFields(step: WorkflowStep): WorkflowField[] {
    return step.fields.filter(f => this.evaluateRules(f.showWhen ?? [], f.showWhenLogic ?? 'AND'));
  }

  // ── honorific prefix inside the first-name cell ────────────────
  /** The step's honorific field, if it can ride inside the first-name box. */
  groupTitleField(step: WorkflowStep): WorkflowField | null {
    // New design: Title is its own neutral segmented field, not a prefix.
    if (this.nd()) return null;
    if (!step.fields.some(f => f.name === 'first_name')) return null;
    return this.visibleFields(step).find(f => f.name === 'title' && (f.options?.length ?? 0) > 0) ?? null;
  }

  /** first_name hosts the honorific prefix when a title field shares its step. */
  isNameRow(step: WorkflowStep, f: WorkflowField): boolean {
    return f.name === 'first_name' && !!this.groupTitleField(step);
  }

  /** The title is skipped in the grid — it renders inside the first-name cell. */
  isGroupedIdentityField(step: WorkflowStep, f: WorkflowField): boolean {
    return f === this.groupTitleField(step);
  }

  fieldSelectOptions(f: WorkflowField): PfSelectOption<unknown>[] {
    return (f.options ?? []).map(o => ({ value: o.value, label: o.label, hint: o.sublabel }));
  }

  textValue(step: WorkflowStep, fieldName: string): string {
    const v = this.valueFor(step, fieldName);
    return v === null || v === undefined ? '' : String(v);
  }

  fieldConfig(f: WorkflowField) {
    const ds = f.dataSource;
    const opts = ds
      ? (this.resources().dataSources?.[ds] ?? f.options ?? [])
      : (f.options ?? []);
    return {
      ...DynamicInputComponent.fromWorkflowField(f),
      options: opts
    };
  }

  testParamConfig(p: TestParameter) {
    return DynamicInputComponent.fromParameter(p);
  }

  /** Field grid: single-page (full-bleed pages) steps up to 3 columns at xl;
   *  stepped mode (drawers and narrower hosts) stays at 2. */
  readonly gridClass = computed(() => this.nd() ? 'pf-wr-grid' : this.singlePage()
    ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4'
    : 'grid grid-cols-1 md:grid-cols-2 gap-4');

  widthClass(width: string | undefined): string {
    switch (width) {
      case 'half':    return 'md:col-span-1';
      case 'third':   return 'md:col-span-1';
      case 'quarter': return 'md:col-span-1';
      case 'full':
      default:        return this.singlePage() ? 'md:col-span-2 xl:col-span-3' : 'md:col-span-2';
    }
  }

  valueFor(step: WorkflowStep, fieldName: string): unknown {
    return this._formValues()[`${step.name}::${fieldName}`];
  }

  setValue(step: WorkflowStep, fieldName: string, v: unknown): void {
    const key = `${step.name}::${fieldName}`;
    const next = { ...this._formValues(), [key]: v };
    this._formValues.set(next);
    this.valuesChange.emit(next);
    if (this._validationError()) this._validationError.set(null);
    if (this._fieldErrors()[key]) {
      const rest = { ...this._fieldErrors() };
      delete rest[key];
      this._fieldErrors.set(rest);
    }
  }

  // ── navigation ─────────────────────────────────────────────────

  back(): void {
    const i = this._currentIndex();
    if (i === 0) return;
    this._currentIndex.set(i - 1);
    this._validationError.set(null);
  }

  next(): void {
    const steps = this.visibleSteps();
    const step = steps[this._currentIndex()];
    if (!step) return;

    if (!this.validateStep(step)) return;

    this.stepComplete.emit({ step, values: this._formValues() });

    const destinationIndex = this.resolveNextIndex(step);
    if (destinationIndex >= steps.length) {
      this.workflowComplete.emit(this._formValues());
    } else {
      this._currentIndex.set(destinationIndex);
    }
  }

  finish(): void {
    if (this.singlePage()) {
      if (!this.validateAll()) return;
      this.workflowComplete.emit(this._formValues());
      return;
    }
    const steps = this.visibleSteps();
    const step = steps[this._currentIndex()];
    if (step && !this.validateStep(step)) return;
    if (step) this.stepComplete.emit({ step, values: this._formValues() });
    this.workflowComplete.emit(this._formValues());
  }

  triggerExtraAction(actionId: string): void {
    if (this.singlePage()) {
      if (!this.validateAll()) return;
      this.extraActionClicked.emit({ actionId, values: this._formValues() });
      return;
    }
    const steps = this.visibleSteps();
    const step = steps[this._currentIndex()];
    if (step && !this.validateStep(step)) return;
    if (step) this.stepComplete.emit({ step, values: this._formValues() });
    this.extraActionClicked.emit({ actionId, values: this._formValues() });
  }

  private resolveNextIndex(step: WorkflowStep): number {
    const steps = this.visibleSteps();
    const currentIdx = this._currentIndex();

    // 1. Conditional routes take priority.
    for (const route of step.afterStep?.conditionalRoutes ?? []) {
      if (this.evaluateRules(route.conditions, route.conditionLogic)) {
        const target = steps.findIndex(s => s.name === route.goToStep);
        if (target >= 0) return target;
      }
    }

    // 2. Default next step name.
    const defaultNext = step.afterStep?.defaultNextStep;
    if (defaultNext) {
      const target = steps.findIndex(s => s.name === defaultNext);
      if (target >= 0) return this.skipAsNeeded(target);
    }

    // 3. Fall through — walk forward past any skipped steps.
    return this.skipAsNeeded(currentIdx + 1);
  }

  private skipAsNeeded(index: number): number {
    const steps = this.visibleSteps();
    let i = index;
    while (i < steps.length && this.shouldSkipStep(steps[i])) i++;
    return i;
  }

  /** A step is auto-skipped only when it HAS skipWhen rules and they all pass.
   *  A step with no skipWhen must never be skipped — otherwise every
   *  unconditional step (e.g. "Additional Info") would be skipped, since
   *  evaluateRules([]) is true by design (used for showWhen "always show"). */
  private shouldSkipStep(step: WorkflowStep): boolean {
    const rules = step.skipWhen ?? [];
    return rules.length > 0 && this.evaluateRules(rules, 'AND');
  }

  // ── validation ─────────────────────────────────────────────────

  private validateStep(step: WorkflowStep): boolean {
    for (const f of this.visibleFields(step)) {
      if (f.type === 'test_parameters') continue;
      const v = this.valueFor(step, f.name);
      const err = validateFieldValue(f, v);
      if (err) {
        this._validationError.set(`${f.title}: ${err}`);
        return false;
      }
    }
    this._validationError.set(null);
    return true;
  }

  private isEmpty(v: unknown): boolean {
    if (v === null || v === undefined || v === '') return true;
    if (Array.isArray(v) && v.length === 0) return true;
    return false;
  }

  // ── condition engine ───────────────────────────────────────────

  private evaluateRules(rules: ConditionRule[], logic: ConditionLogic): boolean {
    if (!rules || rules.length === 0) return true;
    const results = rules.map(r => this.evaluateRule(r));
    return logic === 'OR' ? results.some(Boolean) : results.every(Boolean);
  }

  private evaluateRule(rule: ConditionRule): boolean {
    const lhs = this.resolveLeft(rule.field);
    return this.applyOperator(rule.operator, lhs, rule.value);
  }

  /** Resolve `rule.field` against context, known meta-keys, then form values. */
  private resolveLeft(fieldName: string): unknown {
    if (!fieldName) return undefined;
    const ctx = this.context();

    // Direct context keys
    if (fieldName === 'age') return ctx.patientAge;
    if (fieldName === 'sex') return ctx.patientSex;
    if (fieldName === 'user.permissions') return (ctx['user.permissions'] as unknown) ?? ctx['userPermissions'];

    // Find any formValue key ending in ::fieldName (namespaced by step)
    const suffix = `::${fieldName}`;
    for (const [k, v] of Object.entries(this._formValues())) {
      if (k === fieldName || k.endsWith(suffix)) return v;
    }
    return undefined;
  }

  private applyOperator(op: ConditionOperator, lhs: unknown, rhs: unknown): boolean {
    if (op === 'isEmpty')    return this.isEmpty(lhs);
    if (op === 'isNotEmpty') return !this.isEmpty(lhs);

    // contains handles arrays and strings
    if (op === 'contains') {
      if (Array.isArray(lhs)) return lhs.includes(rhs as never);
      if (typeof lhs === 'string') return lhs.includes(String(rhs));
      return false;
    }

    const rhsValue = rhs;
    // numeric comparisons — if LHS is array, compare on length (so "test_ids lessThanOrEqual 1" works)
    const lhsNumeric: number = Array.isArray(lhs) ? lhs.length : this.toNumber(lhs);
    const rhsNumeric: number = this.toNumber(rhsValue);
    const bothNumeric = !Number.isNaN(lhsNumeric) && !Number.isNaN(rhsNumeric);

    switch (op) {
      case 'equals':
        if (bothNumeric) return lhsNumeric === rhsNumeric;
        return String(lhs ?? '').toLowerCase() === String(rhsValue ?? '').toLowerCase();
      case 'notEquals':
        if (bothNumeric) return lhsNumeric !== rhsNumeric;
        return String(lhs ?? '').toLowerCase() !== String(rhsValue ?? '').toLowerCase();
      case 'greaterThan':        return bothNumeric ? lhsNumeric > rhsNumeric  : false;
      case 'lessThan':           return bothNumeric ? lhsNumeric < rhsNumeric  : false;
      case 'greaterThanOrEqual': return bothNumeric ? lhsNumeric >= rhsNumeric : false;
      case 'lessThanOrEqual':    return bothNumeric ? lhsNumeric <= rhsNumeric : false;
      default:                   return false;
    }
  }

  private toNumber(v: unknown): number {
    if (v === null || v === undefined || v === '') return Number.NaN;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    const n = Number(v);
    return Number.isNaN(n) ? Number.NaN : n;
  }
}

/** Helper for callers: split flat formValues into per-step value bags using their names. */
export function splitByStep(values: WorkflowFormValues): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [k, v] of Object.entries(values)) {
    const [step, name] = k.split('::');
    if (!name) continue;
    if (!out[step]) out[step] = {};
    out[step][name] = v;
  }
  return out;
}

/** Helper for callers: given a workflow config + flat values, produce { standard, metadata }
 *  where metadata bundles every custom field (storageKey starting with `metadata.`). */
export function splitByStorage(
  cfg: WorkflowConfig,
  values: WorkflowFormValues
): { standard: Record<string, unknown>; metadata: Record<string, unknown> } {
  const standard: Record<string, unknown> = {};
  const metadata: Record<string, unknown> = {};

  const fieldIndex = new Map<string, { stepName: string; field: { name: string; storageKey: string; isStandard: boolean } }>();
  for (const step of cfg.steps) {
    for (const f of step.fields) {
      fieldIndex.set(`${step.name}::${f.name}`, {
        stepName: step.name,
        field: { name: f.name, storageKey: f.storageKey, isStandard: f.isStandard }
      });
    }
  }

  for (const [key, value] of Object.entries(values)) {
    const entry = fieldIndex.get(key);
    if (!entry) continue;
    const sk = entry.field.storageKey;
    if (sk.startsWith('metadata.')) {
      metadata[sk.slice('metadata.'.length)] = value;
    } else {
      standard[sk] = value;
    }
  }

  return { standard, metadata };
}
