import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges, computed, input, output, signal } from '@angular/core';
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
      <!-- NEW DESIGN (ND-PATTERN §14): the host shows ONE section at a time
           (its tabs ride in the band pill) and owns the actions (the ONE
           primary sits in the band) — so no headings and, with hideActions,
           no action row here. Validation still covers EVERY section; the
           (invalid) output tells the host which one to open. -->
      @if (validationError(); as err) {
        <p class="pf-wr-err" role="alert">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
          <span>{{ err }}</span>
        </p>
      }
      @for (s of ndSteps(); track s.id) {
        <div class="pf-wr-sec" [attr.data-step]="s.id">
          <ng-container *ngTemplateOutlet="stepFields; context: { $implicit: s }"></ng-container>
        </div>
      }
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
            <div [class]="widthClass(f.width)">
              <pf-dynamic-input
                [field]="fieldConfig(f)"
                [value]="valueFor(step, f.name)"
                [context]="context()"
                [nd]="nd()"
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
    /* New design: the validation line sits at the top of the section card. */
    .pf-wr-err {
      display: flex; align-items: flex-start; gap: 8px; margin: 0 0 14px; padding: 10px 12px;
      border-radius: var(--nd-radius-sm, 10px); border: 1px solid color-mix(in srgb, var(--red-border, #ef4444) 45%, transparent);
      background: color-mix(in srgb, var(--red-border, #ef4444) 7%, transparent);
      color: var(--red-text, #dc2626); font-size: 13px; font-weight: 500; line-height: 1.4;
    }
    .pf-wr-err > svg { flex: none; margin-top: 2px; }
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
  /** New design: render only this step (the host's open section tab);
   *  null = every step. Validation always covers every step. */
  readonly activeStepId = input<string | null>(null);
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

  /** New design: the steps on screen — just the open section when the host
   *  names one (and it is visible), else all of them. */
  readonly ndSteps = computed<WorkflowStep[]>(() => {
    const steps = this.visibleSteps();
    const id = this.activeStepId();
    const one = id ? steps.filter(s => s.id === id) : [];
    return one.length ? one : steps;
  });

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
  readonly gridClass = computed(() => this.singlePage()
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
