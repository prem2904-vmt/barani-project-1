import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ConditionLogic,
  ConditionOperator,
  ConditionRule,
  WorkflowField
} from '../../../shared/models/workflow.model';

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
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rules().length === 0) {
      <p class="text-xs text-slate-500 mb-2">{{ emptyLabel() }}</p>
    }

    @for (rule of rules(); let i = $index; track i) {
      <div class="flex flex-wrap items-end gap-2 mb-2">
        @if (i > 0) {
          <div class="w-full flex gap-1 text-[11px]">
            <button type="button"
                    class="px-2 py-0.5 rounded border"
                    [class.bg-[var(--color-primary)]]="logic() === 'AND'"
                    [class.text-white]="logic() === 'AND'"
                    [class.border-slate-300]="logic() !== 'AND'"
                    (click)="setLogic('AND')">AND</button>
            <button type="button"
                    class="px-2 py-0.5 rounded border"
                    [class.bg-[var(--color-primary)]]="logic() === 'OR'"
                    [class.text-white]="logic() === 'OR'"
                    [class.border-slate-300]="logic() !== 'OR'"
                    (click)="setLogic('OR')">OR</button>
          </div>
        }

        <div class="flex-1 min-w-[140px]">
          <label class="text-[11px] text-slate-500">Field</label>
          <select class="pf-input" [ngModel]="rule.field" (ngModelChange)="patch(i, { field: $event })">
            <option [ngValue]="''">— pick —</option>
            @for (f of fields(); track f.id) {
              <option [ngValue]="f.name">{{ f.title }} <span class="text-slate-400">({{ f.name }})</span></option>
            }
            @for (meta of metaFields; track meta.value) {
              <option [ngValue]="meta.value">{{ meta.label }}</option>
            }
          </select>
        </div>

        <div class="w-40">
          <label class="text-[11px] text-slate-500">Operator</label>
          <select class="pf-input" [ngModel]="rule.operator" (ngModelChange)="patch(i, { operator: $event })">
            @for (op of operators; track op.value) {
              <option [ngValue]="op.value">{{ op.label }}</option>
            }
          </select>
        </div>

        @if (needsValue(rule.operator)) {
          <div class="w-40">
            <label class="text-[11px] text-slate-500">Value</label>
            <input type="text" class="pf-input"
                  [ngModel]="rule.value"
                  (ngModelChange)="patch(i, { value: coerceValue($event) })" />
          </div>
        }

        <button type="button"
                class="text-slate-400 hover:text-red-500 pb-1.5"
                (click)="removeRow(i)" aria-label="Remove rule">✕</button>
      </div>
    }

    <button type="button"
            class="text-xs text-[var(--color-primary)] hover:underline"
            (click)="addRow()">+ Add condition</button>
  `
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
