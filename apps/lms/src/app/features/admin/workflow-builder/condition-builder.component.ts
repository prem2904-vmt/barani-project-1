import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ConditionLogic,
  ConditionOperator,
  ConditionRule,
  WorkflowField
} from '../../../shared/models/workflow.model';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';

interface OperatorOption { value: ConditionOperator; label: string; needsValue: boolean; }

const OPERATORS: OperatorOption[] = [
  { value: 'equals',             label: 'equals',             needsValue: true },
  { value: 'notEquals',          label: 'not equals',         needsValue: true },
  { value: 'greaterThan',        label: 'greater than',       needsValue: true },
  { value: 'lessThan',           label: 'less than',          needsValue: true },
  { value: 'greaterThanOrEqual', label: '>=',                 needsValue: true },
  { value: 'lessThanOrEqual',    label: '<=',                 needsValue: true },
  { value: 'contains',           label: 'contains',           needsValue: true },
  { value: 'isEmpty',            label: 'is empty',           needsValue: false },
  { value: 'isNotEmpty',         label: 'is not empty',       needsValue: false }
];

@Component({
  selector: 'pf-condition-builder',
  standalone: true,
  imports: [FormsModule, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rules().length === 0) {
      <p class="cb-empty">{{ emptyLabel() }}</p>
    }

    @for (rule of rules(); let i = $index; track i) {
      <div class="cb-row">
        @if (i > 0) {
          <span class="pf-seg cb-logicseg" role="radiogroup" aria-label="Combine rules with">
            <button type="button" class="pf-seg__item cb-logic" role="radio" [attr.aria-checked]="logic() === 'AND'" (click)="setLogic('AND')">AND</button>
            <button type="button" class="pf-seg__item cb-logic" role="radio" [attr.aria-checked]="logic() === 'OR'" (click)="setLogic('OR')">OR</button>
          </span>
        }

        <div class="cb-fields">
          <div class="pf-field cb-field">
            <span class="pf-field__lbl">Field</span>
            <pf-select [options]="fieldOptions()" [value]="rule.field" placeholder="— pick —"
                       (valueChange)="patch(i, { field: $any($event) })"></pf-select>
          </div>
          <div class="pf-field cb-operator">
            <span class="pf-field__lbl">Operator</span>
            <pf-select [options]="operatorOptions" [value]="rule.operator"
                       (valueChange)="patch(i, { operator: $any($event) })"></pf-select>
          </div>
          @if (needsValue(rule.operator)) {
            <label class="pf-field cb-value">
              <span class="pf-field__lbl">Value</span>
              <input type="text" class="pf-input" [ngModel]="rule.value"
                     (ngModelChange)="patch(i, { value: coerceValue($event) })" />
            </label>
          }
          <button type="button" class="cb-remove" (click)="removeRow(i)" aria-label="Remove rule" title="Remove rule">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
      </div>
    }

    <button type="button" class="pf-btn pf-btn--tertiary cb-add" (click)="addRow()">+ Add condition</button>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 8px; }
    .cb-empty { margin: 0; font-size: 12.5px; color: var(--text-tertiary); }
    .cb-row { display: flex; flex-direction: column; gap: 8px; }
    .cb-logicseg { align-self: flex-start; }
    .cb-logic { height: 28px; font-size: 11.5px; font-weight: 600; letter-spacing: 0.02em; }
    .cb-fields { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; }
    .cb-field { flex: 1 1 160px; }
    .cb-operator, .cb-value { flex: 0 1 170px; }
    .cb-remove { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 36px; height: 36px;
      border-radius: 8px; border: 1px solid transparent; background: transparent; color: var(--text-tertiary); cursor: pointer; }
    .cb-remove:hover { color: var(--red-text, #b91c1c); border-color: var(--pf-line); }
    .cb-add { align-self: flex-start; height: 32px; min-height: 32px; font-size: 12.5px; }
    @media (pointer: coarse) {
      .cb-remove { width: 44px; height: 44px; }
      .cb-add { min-height: 44px; }
      .cb-logic { height: 40px; padding: 0 14px; }
    }
    @media (max-width: 640px) {
      .cb-operator, .cb-value { flex: 1 1 140px; }
    }
  `]
})
export class ConditionBuilderComponent {
  readonly rules = input<ConditionRule[]>([]);
  readonly fields = input<WorkflowField[]>([]);
  readonly logic = input<ConditionLogic>('AND');
  readonly emptyLabel = input<string>('No conditions — rule always applies.');
  readonly allowMetaFields = input<boolean>(true);

  readonly rulesChange = output<ConditionRule[]>();
  readonly logicChange = output<ConditionLogic>();

  readonly operators = OPERATORS;
  readonly metaFields = [
    { value: 'age',              label: 'age (patient age)' },
    { value: 'user.permissions', label: 'user permissions' }
  ];

  readonly operatorOptions: PfSelectOption<ConditionOperator>[] =
    OPERATORS.map(o => ({ value: o.value, label: o.label }));

  readonly fieldOptions = computed<PfSelectOption<string>[]>(() => [
    ...this.fields().map(f => ({ value: f.name, label: f.title, hint: f.name })),
    ...this.metaFields.map(m => ({ value: m.value, label: m.label }))
  ]);

  readonly hasRules = computed(() => this.rules().length > 0);

  needsValue(op: ConditionOperator): boolean {
    return OPERATORS.find(o => o.value === op)?.needsValue ?? true;
  }

  coerceValue(v: unknown): unknown {
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (trimmed === '') return '';
      const asNumber = Number(trimmed);
      if (!Number.isNaN(asNumber) && /^-?\d+(\.\d+)?$/.test(trimmed)) return asNumber;
      if (trimmed === 'true') return true;
      if (trimmed === 'false') return false;
    }
    return v;
  }

  patch(i: number, updates: Partial<ConditionRule>): void {
    const next = this.rules().map((r, idx) => idx === i ? { ...r, ...updates } : r);
    this.rulesChange.emit(next);
  }

  addRow(): void {
    const next: ConditionRule[] = [
      ...this.rules(),
      { field: '', operator: 'equals', value: '' }
    ];
    this.rulesChange.emit(next);
  }

  removeRow(i: number): void {
    const next = this.rules().filter((_, idx) => idx !== i);
    this.rulesChange.emit(next);
  }

  setLogic(logic: ConditionLogic): void {
    this.logicChange.emit(logic);
  }
}
