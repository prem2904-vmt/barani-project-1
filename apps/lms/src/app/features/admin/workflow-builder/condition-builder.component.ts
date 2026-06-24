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
      <p class="text-xs text-slate-500 mb-2">{{ emptyLabel() }}</p>
    }

    @for (rule of rules(); let i = $index; track i) {
      <div class="flex flex-wrap items-end gap-2 mb-2 cb-row">
        @if (i > 0) {
          <div class="w-full flex gap-1 text-[11px]">
            <button type="button"
                    class="px-2 py-0.5 rounded border cb-logic"
                    [class.bg-[var(--color-primary)]]="logic() === 'AND'"
                    [class.text-white]="logic() === 'AND'"
                    [class.border-slate-300]="logic() !== 'AND'"
                    (click)="setLogic('AND')">AND</button>
            <button type="button"
                    class="px-2 py-0.5 rounded border cb-logic"
                    [class.bg-[var(--color-primary)]]="logic() === 'OR'"
                    [class.text-white]="logic() === 'OR'"
                    [class.border-slate-300]="logic() !== 'OR'"
                    (click)="setLogic('OR')">OR</button>
          </div>
        }

        <div class="flex-1 min-w-[140px]">
          <label class="text-[11px] text-slate-500">Field</label>
          <pf-select
            [options]="fieldOptions()"
            [value]="rule.field"
            placeholder="— pick —"
            size="sm"
            (valueChange)="patch(i, { field: $any($event) })"></pf-select>
        </div>

        <div class="w-40 cb-operator">
          <label class="text-[11px] text-slate-500">Operator</label>
          <pf-select
            [options]="operatorOptions"
            [value]="rule.operator"
            size="sm"
            (valueChange)="patch(i, { operator: $any($event) })"></pf-select>
        </div>

        @if (needsValue(rule.operator)) {
          <div class="w-40 cb-value">
            <label class="text-[11px] text-slate-500">Value</label>
            <input type="text" class="pf-input"
                  [ngModel]="rule.value"
                  (ngModelChange)="patch(i, { value: coerceValue($event) })" />
          </div>
        }

        <button type="button"
                class="text-slate-400 hover:text-red-500 pb-1.5 cb-remove"
                (click)="removeRow(i)" aria-label="Remove rule">✕</button>
      </div>
    }

    <button type="button"
            class="text-xs text-[var(--color-primary)] hover:underline cb-add"
            (click)="addRow()">+ Add condition</button>
  `,
  styles: [`
    /* ===========================================================
       CROSS-PLATFORM — additive only. Desktop layout untouched.
       =========================================================== */
    /* Touch sizing: give the small glyph buttons a real tap target
       on coarse pointers without changing their visual box on
       mouse-driven desktop. */
    @media (pointer: coarse) {
      .cb-remove {
        min-width: 44px;
        min-height: 44px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .cb-add {
        display: inline-flex;
        align-items: center;
        min-height: 44px;
      }
      /* AND / OR logic toggles are tiny px-2/py-0.5 pills on desktop;
         give them a real tap target on touch without resizing the
         glyph on mouse-driven screens. */
      .cb-logic {
        min-height: 44px;
        padding-left: 0.875rem;
        padding-right: 0.875rem;
      }
    }

    /* Phone (<=640): the operator and value fields are fixed at
       w-40 (10rem). On narrow screens that overflows the row even
       with flex-wrap, so let them shrink/grow fluidly. The field
       picker (flex-1) keeps its priority. */
    @media (max-width: 640px) {
      .cb-row .cb-operator,
      .cb-row .cb-value {
        flex: 1 1 9rem;
        width: auto;
        min-width: 0;
      }
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
