import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FieldDef, PfIconComponent, TriggerAction, TriggerCondition, TriggerDef, allFields, edit, findField, locate } from '@prefrontal/forms-engine';
import { PfSelectOption, SelectComponent } from '@prefrontal/shared';
import { DialogService } from '../../../../core/services/dialog.service';
import { EditorStore } from './editor-store';

/** The legacy wording of a condition's operator (the legacy list minus its two aliases, "is selected" / "has value"). */
export const LINK_OPERATORS: { value: string; label: string; noValue?: boolean }[] = [
  { value: 'equals', label: 'equals' },
  { value: 'notEquals', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'notContains', label: 'does not contain' },
  { value: 'isEmpty', label: 'is empty', noValue: true },
  { value: 'isNotEmpty', label: 'is not empty', noValue: true },
  { value: 'greaterThan', label: 'greater than' },
  { value: 'lessThan', label: 'less than' },
];

export const LINK_ACTIONS: PfSelectOption<string>[] = [
  { value: 'setValue', label: 'Set to value' },
  { value: 'copyValue', label: 'Copy from source' },
];

/** The legacy names an imported trigger may still carry: read as the old app read them, never offered for a new one. */
const ALIAS_WORDS: Record<string, string> = { eq: 'equals', neq: 'not equals', includes: 'contains', isSelected: 'is selected', hasValue: 'has value' };

/** "contains" for a stored operator; the legacy aliases read as the old app read them. */
export const operatorWords = (op: string): string => LINK_OPERATORS.find((o) => o.value === op)?.label ?? ALIAS_WORDS[op] ?? op;

interface Draft {
  name: string;
  logic: 'and' | 'or';
  enabled: boolean;
  conditions: TriggerCondition[];
  actions: TriggerAction[];
}

const blank = (): Draft => ({ name: '', logic: 'and', enabled: true, conditions: [], actions: [] });

/**
 * The legacy "Conditional Links" tab: triggers that set a field's value when conditions are met. A header and "Add
 * Trigger"; a card per trigger (switch, name, "N condition(s) → N action(s)", edit, delete, then When (AND / OR) … → Then …);
 * the Add / Edit box with Trigger Name, Conditions, Actions and "Trigger enabled". Operators read as in the old app.
 */
@Component({
  selector: 'st-links-tab',
  standalone: true,
  imports: [PfIconComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './links-tab.component.html',
  styleUrls: ['../shared/lg-form.scss', '../shared/lg-modal.scss', './links-tab.component.scss'],
})
export class LinksTabComponent {
  protected readonly store = inject(EditorStore);
  private readonly dialog = inject(DialogService);

  protected readonly readOnly = this.store.session.readOnly;
  protected readonly triggers = computed<TriggerDef[]>(() => this.store.def()?.triggers ?? []);
  protected readonly operators = LINK_OPERATORS;
  protected readonly operatorOptions: PfSelectOption<string>[] = LINK_OPERATORS.map((o) => ({ value: o.value, label: o.label }));
  protected readonly actionOptions = LINK_ACTIONS;
  protected readonly words = operatorWords;

  /** "Page → Question", every question including follow-ups. */
  protected readonly fieldOptions = computed<PfSelectOption<string>[]>(() => {
    const d = this.store.def();
    if (!d) return [];
    return allFields(d).map((f) => ({ value: f.key, label: `${locate(d, f.key)?.page.title ?? ''} → ${f.label || 'Untitled question'}` }));
  });

  protected labelOf(ref: string | null | undefined): string {
    const d = this.store.def();
    const key = (ref ?? '').split('::')[0];
    const f = d && key ? findField(d, key) : null;
    return f ? f.label || key : ref ? `${ref} (removed)` : '…';
  }

  protected valueWords(c: TriggerCondition): string {
    return this.valueLabel(c.source, c.value);
  }

  /** A chosen option reads as its label, anything else as typed. */
  private valueLabel(ref: string, v: unknown): string {
    const d = this.store.def();
    const f = d ? findField(d, ref.split('::')[0]) : null;
    const o = f?.options?.find((x) => x.key === v);
    return o ? o.label : v === undefined || v === null ? '' : String(v);
  }

  protected needsValue(op: string): boolean {
    return !LINK_OPERATORS.find((o) => o.value === op)?.noValue && op !== 'hasValue';
  }

  /** The operator list for a row: the legacy set, plus the alias an imported trigger already has. */
  protected opsFor(op: string): PfSelectOption<string>[] {
    return this.operatorOptions.some((o) => o.value === op) ? this.operatorOptions : [...this.operatorOptions, { value: op, label: operatorWords(op) }];
  }

  /** The source field's choices, when it has some (a typed value would not match a key). */
  protected choicesOf(ref: string): PfSelectOption<string>[] | null {
    const d = this.store.def();
    const f: FieldDef | null = d && ref ? findField(d, ref.split('::')[0]) : null;
    const o = f?.options ?? [];
    return o.length ? o.map((x) => ({ value: x.key, label: x.label })) : null;
  }

  // ---------------- list ----------------

  protected toggle(i: number): void {
    this.store.edit((d) =>
      edit(d, (x) => {
        const t = x.triggers?.[i];
        if (t) t.enabled = t.enabled === false;
      }),
    );
  }

  protected async remove(i: number): Promise<void> {
    const t = this.triggers()[i];
    const ok = await this.dialog.confirm({
      title: `Delete the trigger “${t?.name || 'Untitled'}”?`,
      message: 'You can undo this.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (ok) this.store.edit((d) => edit(d, (x) => (x.triggers = (x.triggers ?? []).filter((_, j) => j !== i))));
  }

  // ---------------- the Add / Edit box ----------------

  /** null = closed; -1 = a new trigger; otherwise the index being edited. */
  protected readonly editing = signal<number | null>(null);
  protected readonly draft = signal<Draft>(blank());
  protected readonly valid = computed(() => {
    const d = this.draft();
    return !!d.name.trim() && d.conditions.length > 0 && d.actions.length > 0 && d.conditions.every((c) => !!c.source) && d.actions.every((a) => !!a.target && (a.action === 'setValue' ? a.value !== undefined && a.value !== '' : !!a.source));
  });

  protected openAdd(): void {
    this.draft.set(blank());
    this.editing.set(-1);
  }

  protected openEdit(i: number): void {
    const t = this.triggers()[i];
    if (!t) return;
    this.draft.set({
      name: t.name ?? '',
      logic: t.logic === 'or' ? 'or' : 'and',
      enabled: t.enabled !== false,
      conditions: structuredClone(t.conditions ?? []),
      actions: structuredClone(t.actions ?? []),
    });
    this.editing.set(i);
  }

  protected patch(change: (d: Draft) => void): void {
    const d = structuredClone(this.draft());
    change(d);
    this.draft.set(d);
  }

  protected setCondSource(i: number, ref: string | null): void {
    this.patch((d) => {
      d.conditions[i].source = ref ?? '';
      d.conditions[i].value = '';
    });
  }

  protected setActionTarget(i: number, ref: string | null): void {
    this.patch((d) => {
      d.actions[i].target = ref ?? '';
      d.actions[i].value = '';
    });
  }

  protected addCondition(): void {
    this.patch((d) => d.conditions.push({ source: '', op: 'equals', value: '' }));
  }
  protected addAction(): void {
    this.patch((d) => d.actions.push({ target: '', action: 'setValue', value: '' }));
  }

  protected save(): void {
    if (!this.valid()) return;
    const i = this.editing();
    const d = this.draft();
    const t: TriggerDef = {
      name: d.name.trim(),
      enabled: d.enabled,
      logic: d.logic,
      conditions: d.conditions.map((c) => ({ source: c.source, op: c.op, ...(this.needsValue(c.op) ? { value: c.value } : {}) })),
      actions: d.actions.map((a) => (a.action === 'copyValue' ? { target: a.target, action: 'copyValue', source: a.source } : { target: a.target, action: 'setValue', value: a.value })),
    };
    this.store.edit((def) =>
      edit(def, (x) => {
        const list = (x.triggers ??= []);
        if (i === null || i < 0) list.push(t);
        else list[i] = t;
      }),
    );
    this.editing.set(null);
  }
}
