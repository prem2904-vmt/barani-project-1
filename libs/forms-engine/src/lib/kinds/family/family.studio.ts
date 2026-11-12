import { ChangeDetectionStrategy, Component, Directive, computed, input } from '@angular/core';
import { PfIconComponent } from '../../kit';
import { ApplyFieldChange } from '../../build/contract';
import { FieldDef } from '../../core/types';
import { DEFAULT_FAMILY_CONDITIONS } from '../familyTree/familyTree.fill';
import { DEFAULT_CONDITIONS, ToothCondition } from '../toothChart/teeth';
import { domains, milestoneItems, vaccineItems } from '../ageChecklist/checklist-data';

/** "Heart disease" → heartDisease; unique among `taken`. */
export function slugKey(label: string, taken: Iterable<string>): string {
  const words = label.replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  let key = words.map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1))).join('');
  if (!/^[A-Za-z]/.test(key)) key = 'x' + key;
  key = key.slice(0, 36);
  const used = new Set(taken);
  let k = key;
  for (let i = 2; used.has(k); i++) k = `${key}${i}`;
  return k;
}

@Directive()
abstract class FamilyEditing {
  readonly field = input.required<FieldDef>();
  readonly apply = input.required<ApplyFieldChange>();
  protected set(name: string, value: unknown): void {
    this.apply()((f) => {
      f.config = { ...(f.config ?? {}) };
      if (value === undefined) delete f.config[name];
      else f.config[name] = value;
    });
  }
}

interface Cond extends ToothCondition {
  /** familyTree and toothChart both list conditions; only the tooth chart has these two. */
  color?: string;
}

/**
 * Studio panel for `familyTree` and `toothChart`: the conditions the doctor can mark (a family tree: "Diabetes", "Heart disease"; a tooth chart:
 * "Caries", "Missing" with the words each writes, whether it can sit on single surfaces and whether the tooth is crossed out).
 */
@Component({
  selector: 'fe-conditions-panel',
  standalone: true,
  imports: [PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="fe-kpanel" [attr.data-kind-panel]="field().kind">
      <h3 class="fe-kpanel__title">{{ tooth() ? 'Conditions a tooth can have' : 'Conditions you can mark on a relative' }}</h3>
      <ol class="fe-famp__list" aria-label="Conditions">
        @for (c of conditions(); track c.key; let i = $index) {
          <li class="fe-famp__item" [attr.data-condition]="c.key">
            <input class="pf-input" type="text" [attr.aria-label]="'Condition ' + (i + 1)" [value]="c.label" maxlength="60" (change)="rename(i, $any($event.target).value)" />
            <button type="button" class="pf-btn pf-btn--tertiary" [attr.aria-label]="'Move ' + c.label + ' up'" [disabled]="i === 0" (click)="move(i, -1)"><pf-icon name="chevron-up" [size]="16" /></button>
            <button type="button" class="pf-btn pf-btn--tertiary" [attr.aria-label]="'Move ' + c.label + ' down'" [disabled]="i === conditions().length - 1" (click)="move(i, 1)"><pf-icon name="chevron-down" [size]="16" /></button>
            <button type="button" class="pf-btn pf-btn--tertiary" [attr.aria-label]="'Remove ' + c.label" [disabled]="conditions().length <= (tooth() ? 1 : 0)" (click)="remove(i)"><pf-icon name="trash" [size]="16" /></button>
            @if (tooth()) {
              <label class="fe-famp__tick"><input type="checkbox" [checked]="c.surfaces === true" (change)="flag(i, 'surfaces', $any($event.target).checked)" /> Can be on single surfaces</label>
              <label class="fe-famp__tick"><input type="checkbox" [checked]="c.cross === true" (change)="flag(i, 'cross', $any($event.target).checked)" /> Cross the tooth out</label>
              <input class="pf-input" type="text" [attr.aria-label]="c.label + ': what it writes'" [value]="c.phrase ?? ''" [placeholder]="c.label + ' in {teeth}'" maxlength="120" (change)="phrase(i, $any($event.target).value)" />
            }
          </li>
        }
      </ol>
      <div class="fe-fam__row">
        <button type="button" class="pf-btn pf-btn--secondary" data-act="add-condition" (click)="add()"><pf-icon name="plus" [size]="16" /> Add a condition</button>
        <button type="button" class="pf-btn pf-btn--tertiary" data-act="reset-conditions" (click)="reset()">Back to the usual list</button>
      </div>
      @if (tooth()) {
        <p class="fe-gedit__hint">In a sentence, {{ '{teeth}' }} becomes the tooth numbers: “Root canal treatment in {{ '{teeth}' }}”.</p>
      }
    </section>
  `,
})
export class ConditionsPanelComponent extends FamilyEditing {
  protected readonly tooth = computed(() => this.field().kind === 'toothChart');
  protected readonly conditions = computed<Cond[]>(() => {
    const c = this.field().config?.['conditions'];
    return Array.isArray(c) ? (c as Cond[]) : this.tooth() ? DEFAULT_CONDITIONS : DEFAULT_FAMILY_CONDITIONS;
  });

  private save(next: Cond[]): void {
    this.set('conditions', next);
  }
  protected rename(i: number, label: string): void {
    const t = label.trim();
    if (!t) return;
    this.save(this.conditions().map((c, j) => (j === i ? { ...c, label: t } : c)));
  }
  protected phrase(i: number, text: string): void {
    const t = text.trim();
    this.save(
      this.conditions().map((c, j) => {
        if (j !== i) return c;
        const { phrase: _p, ...rest } = c;
        return t.includes('{teeth}') ? { ...rest, phrase: t } : rest;
      }),
    );
  }
  protected flag(i: number, name: 'surfaces' | 'cross', on: boolean): void {
    this.save(
      this.conditions().map((c, j) => {
        if (j !== i) return c;
        const { [name]: _x, ...rest } = c;
        return on ? { ...rest, [name]: true } : rest;
      }),
    );
  }
  protected move(i: number, by: number): void {
    const l = [...this.conditions()];
    const [x] = l.splice(i, 1);
    l.splice(i + by, 0, x);
    this.save(l);
  }
  protected remove(i: number): void {
    this.save(this.conditions().filter((_, j) => j !== i));
  }
  protected add(): void {
    const list = this.conditions();
    if (list.length >= 12) return;
    this.save([...list, { key: slugKey('New condition', list.map((c) => c.key)), label: 'New condition' }]);
  }
  protected reset(): void {
    this.save((this.tooth() ? DEFAULT_CONDITIONS : DEFAULT_FAMILY_CONDITIONS).map((c) => ({ ...c })));
  }
}

interface CustomItem {
  key: string;
  label: string;
  delay?: string;
  byMonths?: number;
}

/**
 * Studio panel for `ageChecklist`: which lines it asks about. Milestones: the groups to include and any single line to leave out; vaccines:
 * any single vaccine to leave out (for example Japanese encephalitis outside the endemic districts); own list: the lines, the words that
 * report a late one and the age (in months) it is expected by.
 */
@Component({
  selector: 'fe-agechecklist-panel',
  standalone: true,
  imports: [PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="fe-kpanel" data-kind-panel="ageChecklist">
      @if (preset() === 'custom') {
        <h3 class="fe-kpanel__title">Your lines</h3>
        <ol class="fe-famp__list" aria-label="Lines">
          @for (c of custom(); track c.key; let i = $index) {
            <li class="fe-famp__item" [attr.data-line]="c.key">
              <input class="pf-input" type="text" [attr.aria-label]="'Line ' + (i + 1)" [value]="c.label" maxlength="80" (change)="renameLine(i, $any($event.target).value)" />
              <input class="pf-input" type="text" [attr.aria-label]="c.label + ': words when it is late'" [value]="c.delay ?? ''" [placeholder]="c.label + ' not done'" maxlength="80" (change)="lineDelay(i, $any($event.target).value)" />
              <input class="pf-input" type="text" inputmode="decimal" [attr.aria-label]="c.label + ': expected by (months)'" placeholder="Expected by (months)" [value]="c.byMonths ?? ''" (change)="lineBy(i, $any($event.target).value)" />
              <button type="button" class="pf-btn pf-btn--tertiary" [attr.aria-label]="'Remove ' + c.label" (click)="removeLine(i)"><pf-icon name="trash" [size]="16" /></button>
            </li>
          }
        </ol>
        <div class="fe-fam__row">
          <button type="button" class="pf-btn pf-btn--secondary" data-act="add-line" [disabled]="custom().length >= 60" (click)="addLine()"><pf-icon name="plus" [size]="16" /> Add a line</button>
        </div>
      } @else {
        @if (preset() === 'milestones') {
          <h3 class="fe-kpanel__title">Groups</h3>
          <div class="fe-chips" role="group" aria-label="Groups">
            @for (d of groups; track d.key) {
              <button type="button" class="fe-chip" [attr.data-domain]="d.key" [attr.aria-pressed]="domainOn(d.key)" (click)="toggleDomain(d.key)">{{ d.label }}</button>
            }
          </div>
        }
        <h3 class="fe-kpanel__title">Lines it asks about ({{ shown() }} of {{ all().length }})</h3>
        <div class="fe-chips" role="group" aria-label="Lines">
          @for (l of all(); track l.key) {
            <button type="button" class="fe-chip" [attr.data-line]="l.key" [attr.aria-pressed]="!excluded().has(l.key)" (click)="toggleLine(l.key)">{{ l.label }}</button>
          }
        </div>
        <p class="fe-gedit__hint">{{ source() }}</p>
      }
    </section>
  `,
})
export class AgeChecklistPanelComponent extends FamilyEditing {
  protected readonly groups = domains();
  protected readonly preset = computed(() => String(this.field().config?.['preset'] ?? 'milestones'));
  protected readonly custom = computed<CustomItem[]>(() => {
    const i = this.field().config?.['items'];
    return Array.isArray(i) ? (i as CustomItem[]) : [];
  });
  protected readonly excluded = computed(() => {
    const e = this.field().config?.['exclude'];
    return new Set<string>(Array.isArray(e) ? (e as string[]) : []);
  });
  protected readonly all = computed(() => (this.preset() === 'vaccines' ? vaccineItems() : milestoneItems().filter((i) => this.domainOn(i.group))));
  protected readonly shown = computed(() => this.all().filter((l) => !this.excluded().has(l.key)).length);
  protected readonly source = computed(() =>
    this.preset() === 'vaccines'
      ? 'The national immunisation schedule of India (Ministry of Health and Family Welfare). A dose not given after its window is written as overdue.'
      : 'Ages from the CDC milestone checklists (2022) and the WHO motor development windows. These are prompts, not a diagnosis.',
  );
  private readonly wantedDomains = computed(() => {
    const d = this.field().config?.['domains'];
    return Array.isArray(d) ? (d as string[]) : [];
  });
  protected readonly domainOn = (key: string): boolean => this.wantedDomains().length === 0 || this.wantedDomains().includes(key);

  protected toggleDomain(key: string): void {
    const now = new Set(this.wantedDomains().length ? this.wantedDomains() : this.groups.map((d) => d.key));
    if (!now.delete(key)) now.add(key);
    if (now.size === 0) return; // at least one group
    this.set('domains', now.size === this.groups.length ? undefined : this.groups.map((d) => d.key).filter((k) => now.has(k)));
  }

  protected toggleLine(key: string): void {
    const e = new Set(this.excluded());
    if (!e.delete(key)) e.add(key);
    this.set('exclude', e.size ? [...e] : undefined);
  }

  private saveItems(next: CustomItem[]): void {
    this.set('items', next);
  }
  protected addLine(): void {
    const list = this.custom();
    this.saveItems([...list, { key: slugKey('New line', list.map((c) => c.key)), label: 'New line' }]);
  }
  protected removeLine(i: number): void {
    this.saveItems(this.custom().filter((_, j) => j !== i));
  }
  protected renameLine(i: number, label: string): void {
    const t = label.trim();
    if (t) this.saveItems(this.custom().map((c, j) => (j === i ? { ...c, label: t } : c)));
  }
  protected lineDelay(i: number, text: string): void {
    const t = text.trim();
    this.saveItems(
      this.custom().map((c, j) => {
        if (j !== i) return c;
        const { delay: _d, ...rest } = c;
        return t ? { ...rest, delay: t } : rest;
      }),
    );
  }
  protected lineBy(i: number, text: string): void {
    const n = Number(text);
    this.saveItems(
      this.custom().map((c, j) => {
        if (j !== i) return c;
        const { byMonths: _b, ...rest } = c;
        return text.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 1200 ? { ...rest, byMonths: n } : rest;
      }),
    );
  }
}

