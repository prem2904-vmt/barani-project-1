import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PfSelectOption, SelectComponent } from '../primitives/select.component';
import { ConditionOperator, ConditionRule, FormField, ShowWhen } from './form-field.model';

// Inline editor for a ShowWhen ruleset. Takes the list of peer fields the
// current row can reference, emits a new ShowWhen whenever the user changes
// anything. Drop in beside any field row to let an admin say "show this when
// parameter X is/contains/etc Y".

const OPERATOR_OPTIONS: { value: ConditionOperator; label: string; needsValue: boolean }[] = [
  { value: 'equals',             label: 'equals',             needsValue: true  },
  { value: 'notEquals',          label: 'not equals',         needsValue: true  },
  { value: 'contains',           label: 'contains',           needsValue: true  },
  { value: 'notContains',        label: 'not contains',       needsValue: true  },
  { value: 'greaterThan',        label: 'greater than',       needsValue: true  },
  { value: 'lessThan',           label: 'less than',          needsValue: true  },
  { value: 'greaterThanOrEqual', label: '>=',                 needsValue: true  },
  { value: 'lessThanOrEqual',    label: '<=',                 needsValue: true  },
  { value: 'isEmpty',            label: 'is empty',           needsValue: false },
  { value: 'isNotEmpty',         label: 'is not empty',       needsValue: false }
];

const LOGIC_OPTIONS: PfSelectOption<'AND' | 'OR'>[] = [
  { value: 'AND', label: 'All (AND)' },
  { value: 'OR',  label: 'Any (OR)' }
];

const VISIBILITY_OPTIONS: PfSelectOption<'show' | 'hide'>[] = [
  { value: 'show', label: 'Show when' },
  { value: 'hide', label: 'Hide when' }
];

@Component({
  selector: 'pf-condition-editor',
  standalone: true,
  imports: [FormsModule, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (showWhen()) {
      <div class="pf-condition-editor">
        <div class="flex items-center gap-2 mb-2">
          <pf-select size="sm" [options]="visibilityOptions"
                     [value]="showWhen()!.visibility ?? 'show'"
                     (valueChange)="onVisibilityChange($event)"></pf-select>
          <pf-select size="sm" [options]="logicOptions"
                     [value]="showWhen()!.logic"
                     (valueChange)="onLogicChange($event)"></pf-select>
          <span class="text-[11px] font-mono flex-1" style="color: var(--text-muted);">
            of these rules match
          </span>
          <button type="button" class="pf-cond-btn-ghost" (click)="remove.emit()" aria-label="Remove all conditions">
            Remove
          </button>
        </div>

        @for (rule of showWhen()!.conditions; track $index; let i = $index) {
          <div class="pf-condition-row">
            <pf-select size="sm" [options]="fieldOptions()"
                       [value]="rule.fieldId"
                       placeholder="— Field —"
                       (valueChange)="updateRule(i, { fieldId: $event })"></pf-select>
            <pf-select size="sm" [options]="operatorOptions"
                       [value]="rule.operator"
                       (valueChange)="updateRule(i, { operator: $event })"></pf-select>
            @if (operatorNeedsValue(rule.operator)) {
              <input type="text" class="pf-input text-sm"
                     [ngModel]="rule.value ?? ''"
                     (ngModelChange)="updateRule(i, { value: $event })"
                     placeholder="value" />
            } @else {
              <div class="pf-cond-empty-slot"></div>
            }
            <button type="button" class="pf-cond-btn-ghost" (click)="removeRule(i)" aria-label="Remove rule">
              ×
            </button>
          </div>
        }

        <button type="button" class="pf-cond-add" (click)="addRule()">
          + Add rule
        </button>
      </div>
    } @else {
      <button type="button" class="pf-cond-add-link"
              [disabled]="peerFields().length === 0"
              [title]="peerFields().length === 0 ? 'Add another parameter first to drive conditions.' : 'Show this field only when another parameter matches a condition.'"
              (click)="addFirstRule()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2v4"/><path d="M12 18v4"/><path d="M4.93 4.93l2.83 2.83"/><path d="M16.24 16.24l2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="M4.93 19.07l2.83-2.83"/><path d="M16.24 7.76l2.83-2.83"/>
        </svg>
        Conditional visibility
        @if (peerFields().length === 0) {
          <span class="pf-cond-muted">— add another parameter first</span>
        }
      </button>
    }
  `,
  styles: [`
    :host { display: block; }

    .pf-condition-editor {
      padding: 10px;
      border-radius: 10px;
      background: var(--bg-card-solid);
      border: 1px dashed rgba(236, 72, 153, 0.35);
    }
    .pf-condition-row {
      display: grid;
      grid-template-columns: 1.4fr 1.1fr 1fr 28px;
      gap: 6px;
      margin-bottom: 6px;
    }
    .pf-cond-empty-slot { visibility: hidden; }

    .pf-cond-btn-ghost {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-size: 15px;
      cursor: pointer;
    }
    .pf-cond-btn-ghost:hover { background: var(--bg-hover); color: var(--text-primary); }

    .pf-cond-add {
      font-size: 12px;
      color: #ec4899;
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px 0;
      font-weight: 500;
    }
    .pf-cond-add:hover { text-decoration: underline; }

    .pf-cond-add-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: #ec4899;
      background: rgba(236, 72, 153, 0.08);
      border: 1px dashed rgba(236, 72, 153, 0.35);
      border-radius: 9999px;
      cursor: pointer;
      padding: 5px 12px;
      font-weight: 500;
      transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
    }
    .pf-cond-add-link:hover:not(:disabled) {
      background: rgba(236, 72, 153, 0.14);
      border-color: rgba(236, 72, 153, 0.55);
    }
    .pf-cond-add-link:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      background: transparent;
    }
    .pf-cond-muted {
      color: var(--text-muted);
      font-weight: 400;
      margin-left: 4px;
    }
  `]
})
export class ConditionEditorComponent {
  @Input({ required: true }) set peers(v: FormField[]) { this._peers.set(v ?? []); }
  @Input({ required: true }) set value(v: ShowWhen | null | undefined) { this._showWhen.set(v ?? null); }

  @Output() valueChange = new EventEmitter<ShowWhen | null>();
  @Output() remove = new EventEmitter<void>();

  protected readonly logicOptions = LOGIC_OPTIONS;
  protected readonly visibilityOptions = VISIBILITY_OPTIONS;
  protected readonly operatorOptions: PfSelectOption<ConditionOperator>[] = OPERATOR_OPTIONS.map(o => ({ value: o.value, label: o.label }));

  private readonly _peers = signal<FormField[]>([]);
  private readonly _showWhen = signal<ShowWhen | null>(null);
  readonly peerFields = this._peers.asReadonly();
  readonly showWhen = this._showWhen.asReadonly();

  readonly fieldOptions = computed<PfSelectOption<string>[]>(() =>
    this._peers().map(f => ({ value: f.id, label: f.label || f.name || '(unnamed)' }))
  );

  protected operatorNeedsValue(op: ConditionOperator): boolean {
    return OPERATOR_OPTIONS.find(o => o.value === op)?.needsValue ?? true;
  }

  protected addFirstRule() {
    const firstPeer = this._peers()[0];
    this.emit({
      logic: 'AND',
      visibility: 'show',
      conditions: [{ fieldId: firstPeer?.id ?? '', operator: 'equals', value: '' }]
    });
  }

  protected addRule() {
    const current = this._showWhen();
    if (!current) return;
    const firstPeer = this._peers()[0];
    this.emit({
      ...current,
      conditions: [...current.conditions, { fieldId: firstPeer?.id ?? '', operator: 'equals', value: '' }]
    });
  }

  protected updateRule(i: number, updates: Partial<ConditionRule>) {
    const current = this._showWhen();
    if (!current) return;
    this.emit({
      ...current,
      conditions: current.conditions.map((r, idx) => idx === i ? { ...r, ...updates } : r)
    });
  }

  protected removeRule(i: number) {
    const current = this._showWhen();
    if (!current) return;
    const conditions = current.conditions.filter((_, idx) => idx !== i);
    if (conditions.length === 0) { this.remove.emit(); this.emit(null); return; }
    this.emit({ ...current, conditions });
  }

  protected onLogicChange(logic: 'AND' | 'OR') {
    const current = this._showWhen();
    if (!current) return;
    this.emit({ ...current, logic });
  }

  protected onVisibilityChange(visibility: 'show' | 'hide') {
    const current = this._showWhen();
    if (!current) return;
    this.emit({ ...current, visibility });
  }

  private emit(next: ShowWhen | null) {
    this._showWhen.set(next);
    this.valueChange.emit(next);
  }
}
