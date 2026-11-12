import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { PfIconComponent } from '../../kit';
import { ApplyFieldChange } from '../../build/contract';
import { FieldDef } from '../../core/types';
import { ReadingColumn, columnsOf } from './readings.fill';

const MAX_COLUMNS = 8;

/** A column key from its words ("Urine output" → urineOutput), different from every key in use. */
export function columnKey(label: string, used: string[]): string {
  const words = label.replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  let key = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('');
  if (!/^[A-Za-z]/.test(key)) key = 'reading' + key;
  let k = key.slice(0, 36);
  for (let n = 2; used.includes(k); n++) k = `${key.slice(0, 34)}${n}`;
  return k;
}

type Role = 'reading' | 'intake' | 'output';
const ROLES: { value: Role; label: string }[] = [
  { value: 'reading', label: 'Reading' },
  { value: 'intake', label: 'Intake' },
  { value: 'output', label: 'Output' },
];

const num = (v: string): number | undefined => {
  const n = Number(String(v).replace(',', '.'));
  return v.trim() === '' || !Number.isFinite(n) ? undefined : n;
};

/**
 * Studio panel for `readings`: the columns the doctor fills at each reading. A name, a unit, the lowest and highest sensible value and the
 * size of a step; "Intake" and "Output" columns get a total and a balance in the written note instead of a latest / highest / lowest.
 * Keys stay as first made, so renaming a column never loses the answers already given.
 */
@Component({
  selector: 'fe-readings-panel',
  standalone: true,
  imports: [PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="fe-cs" data-panel="readings">
      <h3 class="fe-cs__h">Columns <span class="fe-cs__note">what is read each time</span></h3>
      <ul class="fe-cs__list" role="list">
        @for (c of columns(); track c.key; let i = $index) {
          <li class="fe-cs__col" [attr.data-col]="c.key">
            <div class="fe-cs__row">
              <input class="pf-input" type="text" data-f="label" [attr.aria-label]="'Column ' + (i + 1) + ' name'" [value]="c.label" maxlength="60" (change)="set(c.key, 'label', $any($event.target).value)" />
              <button type="button" class="fe-cs__icon" [attr.aria-label]="'Remove ' + c.label" [disabled]="columns().length <= 1" (click)="remove(c.key)">
                <pf-icon name="trash" [size]="18" />
              </button>
            </div>
            <div class="fe-cs__row fe-cs__row--small">
              <label class="fe-cs__f"><span>Unit</span><input class="pf-input" type="text" data-f="unit" [value]="c.unit" maxlength="20" (change)="set(c.key, 'unit', $any($event.target).value)" /></label>
              <label class="fe-cs__f"><span>Lowest</span><input class="pf-input" type="text" inputmode="decimal" data-f="min" [value]="c.min ?? ''" (change)="set(c.key, 'min', $any($event.target).value)" /></label>
              <label class="fe-cs__f"><span>Highest</span><input class="pf-input" type="text" inputmode="decimal" data-f="max" [value]="c.max ?? ''" (change)="set(c.key, 'max', $any($event.target).value)" /></label>
              <label class="fe-cs__f"><span>Step</span><input class="pf-input" type="text" inputmode="decimal" data-f="step" [value]="c.step" (change)="set(c.key, 'step', $any($event.target).value)" /></label>
            </div>
            <div class="fe-cs__chips" role="radiogroup" [attr.aria-label]="c.label + ' is a'">
              @for (r of roles; track r.value) {
                <button type="button" class="fe-cs__chip" role="radio" [attr.data-role]="r.value" [attr.aria-checked]="roleOf(c) === r.value" (click)="setRole(c.key, r.value)">{{ r.label }}</button>
              }
            </div>
          </li>
        }
      </ul>
      <button type="button" class="pf-btn pf-btn--secondary fe-cs__add" data-act="add-column" [disabled]="columns().length >= max" (click)="add()">
        <pf-icon name="plus" [size]="16" />
        Add a column
      </button>
      <p class="fe-cs__note">Intake and output columns write their totals and the balance. Other columns write the latest, highest and lowest with their times.</p>
    </section>
  `,
})
export class ReadingsPanelComponent {
  readonly field = input.required<FieldDef>();
  readonly apply = input.required<ApplyFieldChange>();
  protected readonly max = MAX_COLUMNS;
  protected readonly roles = ROLES;
  protected readonly columns = computed(() => columnsOf(this.field().config));

  protected roleOf(c: ReadingColumn): Role {
    return c.role ?? 'reading';
  }

  private edit(change: (cols: Record<string, unknown>[]) => Record<string, unknown>[]): void {
    this.apply()((f) => {
      f.config ??= {};
      const cols = Array.isArray(f.config['columns']) ? (f.config['columns'] as Record<string, unknown>[]).map((c) => ({ ...c })) : [];
      f.config['columns'] = change(cols);
    });
  }

  protected add(): void {
    this.edit((cols) => {
      if (cols.length >= MAX_COLUMNS) return cols;
      const label = `Reading ${cols.length + 1}`;
      return [...cols, { key: columnKey(label, cols.map((c) => String(c['key']))), label }];
    });
  }

  protected remove(key: string): void {
    this.edit((cols) => (cols.length <= 1 ? cols : cols.filter((c) => c['key'] !== key)));
  }

  protected set(key: string, prop: 'label' | 'unit' | 'min' | 'max' | 'step', raw: string): void {
    this.edit((cols) =>
      cols.map((c) => {
        if (c['key'] !== key) return c;
        const next = { ...c };
        if (prop === 'label') {
          if (raw.trim()) next['label'] = raw.trim().slice(0, 60);
        } else if (prop === 'unit') {
          if (raw.trim()) next['unit'] = raw.trim().slice(0, 20);
          else delete next['unit'];
        } else {
          const n = num(raw);
          if (n === undefined || (prop === 'step' && n <= 0)) delete next[prop];
          else next[prop] = n;
        }
        return next;
      }),
    );
  }

  protected setRole(key: string, role: Role): void {
    this.edit((cols) =>
      cols.map((c) => {
        if (c['key'] !== key) return c;
        const next = { ...c };
        if (role === 'reading') delete next['role'];
        else next['role'] = role;
        return next;
      }),
    );
  }
}
