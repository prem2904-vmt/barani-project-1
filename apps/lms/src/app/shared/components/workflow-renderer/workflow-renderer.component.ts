import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges, computed, input, output, signal } from '@angular/core';
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
  imports: [DynamicInputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let cfg = config();
    @if (!cfg || visibleSteps().length === 0) {
      <div class="pf-card text-sm text-slate-500">Nothing to render.</div>
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

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        @for (f of visibleFields(step); track f.id) {
          @if (f.type === 'test_parameters') {
            @if (testParamFields().length === 0) {
              <div class="md:col-span-2 rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                No parameters configured on this test.
              </div>
            } @else {
              <div class="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                @for (p of testParamFields(); track p.name) {
                  <div [class]="widthClass('full')">
                    <pf-dynamic-input
                      [field]="testParamConfig(p)"
                      [value]="valueFor(step, p.name)"
                      [context]="context()"
                      (valueChange)="setValue(step, p.name, $event)"></pf-dynamic-input>
                  </div>
                }
              </div>
            }
          } @else if (f.type === 'tube_collection') {
            <div class="md:col-span-2 space-y-2">
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
          } @else {
            <div [class]="widthClass(f.width)">
              <pf-dynamic-input
                [field]="fieldConfig(f)"
                [value]="valueFor(step, f.name)"
                [context]="context()"
                (valueChange)="setValue(step, f.name, $event)"></pf-dynamic-input>
            </div>
          }
        } @empty {
          <div class="md:col-span-2 text-sm text-slate-500 py-6 text-center">
            This step has no fields. Hit Next to continue.
          </div>
        }
      </div>

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
  `
})
export class WorkflowRendererComponent implements OnChanges {
  readonly config = input<WorkflowConfig | null>(null);
  readonly context = input<WorkflowContext>({});
  readonly resources = input<WorkflowRendererResources>({});
  readonly finishLabel = input<string>('Finish');
  readonly submitting = input<boolean>(false);
  readonly extraActions = input<Array<{ id: string; label: string; variant?: 'primary' | 'ghost' }>>([]);

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
    return step.fields.filter(f => this.evaluateRules(f.showWhen ?? [], 'AND'));
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

  widthClass(width: string | undefined): string {
    switch (width) {
      case 'half':    return 'md:col-span-1';
      case 'third':   return 'md:col-span-1'; // simplified — real 3-col layout is a follow-up
      case 'quarter': return 'md:col-span-1';
      case 'full':
      default:        return 'md:col-span-2';
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
    const steps = this.visibleSteps();
    const step = steps[this._currentIndex()];
    if (step && !this.validateStep(step)) return;
    if (step) this.stepComplete.emit({ step, values: this._formValues() });
    this.workflowComplete.emit(this._formValues());
  }

  triggerExtraAction(actionId: string): void {
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
    const missing: string[] = [];
    for (const f of this.visibleFields(step)) {
      if (!f.isRequired) continue;
      if (f.type === 'test_parameters') continue; // parameters optionality is test-side
      const v = this.valueFor(step, f.name);
      if (this.isEmpty(v)) missing.push(f.title);
    }
    if (missing.length > 0) {
      this._validationError.set(`Please fill: ${missing.join(', ')}`);
      return false;
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
