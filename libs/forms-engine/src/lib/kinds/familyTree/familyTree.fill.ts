import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FeDialog, PfIconComponent, PfSelectOption, SelectComponent } from '../../kit';
import { KindFill, feId } from '../../fill/contract';
import {
  ADD_ORDER,
  FamCondition,
  FamLayout,
  FamNode,
  FamilyAnswer,
  FamilyPerson,
  RELATIONS,
  SIZE,
  SINGLE,
  WORDS,
  buildLayout,
  colorOf,
} from './family-layout';

export const DEFAULT_FAMILY_CONDITIONS: FamCondition[] = [
  { key: 'diabetes', label: 'Diabetes' },
  { key: 'hypertension', label: 'Hypertension' },
  { key: 'heartDisease', label: 'Heart disease' },
  { key: 'cancer', label: 'Cancer' },
  { key: 'stroke', label: 'Stroke' },
  { key: 'thyroid', label: 'Thyroid disorder' },
];

/** "Paternal grandfather". */
export const relationLabel = (rel: string): string => {
  const w = (WORDS as Record<string, string>)[rel] ?? rel;
  return w.charAt(0).toUpperCase() + w.slice(1);
};

interface PersonRow {
  node: FamNode;
  /** Index in `answer.people` (-1 for the patient). */
  index: number;
  title: string;
  sub: string;
}

const SEX: { value: string; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'unknown', label: 'Not stated' },
];

/**
 * familyTree: the pedigree is drawn from the answer (square male, circle female, diamond not stated; filled by condition; a slash when
 * deceased; a double line for blood relatives). Editing is in the list under it: big rows, one per person, numbered like the picture.
 * "Add a relative" offers only the relations still free (one father, one mother...).
 */
@Component({
  selector: 'fe-familytree-fill',
  standalone: true,
  imports: [PfIconComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fe-fam fe-tree" role="group" [attr.aria-labelledby]="labelId()">
      <div class="fe-fam__chart" data-chart>
        <svg class="fe-fam__svg" [attr.viewBox]="'0 0 ' + layout().width + ' ' + layout().height" role="img" [attr.aria-label]="chartLabel()">
          @for (l of layout().lines; track $index) {
            @if (l.double) {
              <line class="fe-ped__line" [attr.x1]="l.x1" [attr.y1]="l.y1 - 3" [attr.x2]="l.x2" [attr.y2]="l.y2 - 3" />
              <line class="fe-ped__line" [attr.x1]="l.x1" [attr.y1]="l.y1 + 3" [attr.x2]="l.x2" [attr.y2]="l.y2 + 3" />
            } @else {
              <line class="fe-ped__line" [attr.x1]="l.x1" [attr.y1]="l.y1" [attr.x2]="l.x2" [attr.y2]="l.y2" />
            }
          }
          @for (n of layout().nodes; track n.id) {
            <g [attr.data-node]="n.id">
              @switch (n.shape) {
                @case ('square') {
                  <rect class="fe-ped__shape" [attr.x]="n.x - half" [attr.y]="n.y - half" [attr.width]="size" [attr.height]="size" />
                }
                @case ('circle') {
                  <circle class="fe-ped__shape" [attr.cx]="n.x" [attr.cy]="n.y" [attr.r]="half" />
                }
                @default {
                  <polygon class="fe-ped__shape" [attr.points]="diamond(n)" />
                }
              }
              @if (n.conditions.length) {
                <clipPath [attr.id]="clipId + n.number">
                  @switch (n.shape) {
                    @case ('square') {
                      <rect [attr.x]="n.x - half" [attr.y]="n.y - half" [attr.width]="size" [attr.height]="size" />
                    }
                    @case ('circle') {
                      <circle [attr.cx]="n.x" [attr.cy]="n.y" [attr.r]="half" />
                    }
                    @default {
                      <polygon [attr.points]="diamond(n)" />
                    }
                  }
                </clipPath>
                <g [attr.clip-path]="'url(#' + clipId + n.number + ')'">
                  @for (c of n.conditions; track c; let i = $index) {
                    <rect
                      [attr.x]="n.x - half - 2 + (i * (size + 4)) / n.conditions.length"
                      [attr.y]="n.y - half - 2"
                      [attr.width]="(size + 4) / n.conditions.length + 0.5"
                      [attr.height]="size + 4"
                      [attr.fill]="colour(c)"
                    />
                  }
                </g>
                @switch (n.shape) {
                  @case ('square') {
                    <rect class="fe-ped__outline" [attr.x]="n.x - half" [attr.y]="n.y - half" [attr.width]="size" [attr.height]="size" />
                  }
                  @case ('circle') {
                    <circle class="fe-ped__outline" [attr.cx]="n.x" [attr.cy]="n.y" [attr.r]="half" />
                  }
                  @default {
                    <polygon class="fe-ped__outline" [attr.points]="diamond(n)" />
                  }
                }
              }
              @if (n.deceased) {
                <line class="fe-ped__slash" [attr.x1]="n.x - 30" [attr.y1]="n.y + 30" [attr.x2]="n.x + 30" [attr.y2]="n.y - 30" />
              }
              @if (n.proband) {
                <path class="fe-ped__arrow" [attr.d]="arrow(n)" />
              }
              <circle class="fe-ped__badge" [attr.cx]="n.x + half" [attr.cy]="n.y - half" r="11" />
              <text class="fe-ped__num" [attr.x]="n.x + half" [attr.y]="n.y - half">{{ n.number }}</text>
            </g>
          }
        </svg>
        @if (usedConditions().length) {
          <div class="fe-ped__swatches" aria-hidden="true">
            @for (c of usedConditions(); track c.key) {
              <span><span class="fe-fam__dot" [style.background]="colour(c.key)"></span>{{ c.label }}</span>
            }
          </div>
        }
      </div>

      <div class="fe-fam" role="list" aria-label="People on the tree">
        @for (r of rows(); track r.node.id) {
          <div role="listitem" class="fe-fam__card" [class.fe-fam__card--edit]="editing() === r.index" [attr.data-person]="r.node.id">
            <button
              type="button"
              class="fe-fam__open"
              [attr.aria-expanded]="editing() === r.index"
              [attr.aria-label]="r.node.number + ', ' + r.title + (r.sub ? ', ' + r.sub : '') + '. Tap to change.'"
              (click)="toggle(r.index)"
            >
              <span class="fe-fam__n" aria-hidden="true">{{ r.node.number }}</span>
              <span class="fe-fam__who">
                <span class="fe-fam__name">{{ r.title }}</span>
                @if (r.sub) {
                  <span class="fe-fam__sub">{{ r.sub }}</span>
                }
              </span>
              <pf-icon [name]="editing() === r.index ? 'chevron-up' : 'chevron-down'" [size]="18" />
            </button>
            @if (editing() === r.index) {
              @if (r.index < 0) {
                <div class="fe-fam__field">
                  <span class="fe-fam__k">Patient is</span>
                  <div class="fe-chips" role="radiogroup" aria-label="Patient's sex">
                    @for (s of sexes; track s.value) {
                      <button type="button" class="fe-chip" role="radio" [attr.data-sex]="s.value" [attr.aria-checked]="selfSex() === s.value" [disabled]="disabled()" (click)="setSelfSex(s.value)">
                        {{ s.label }}
                      </button>
                    }
                  </div>
                </div>
                <div class="fe-fam__field">
                  <span class="fe-fam__k">Patient has</span>
                  <div class="fe-chips" role="group" aria-label="Patient's conditions">
                    @for (c of conditions(); track c.key) {
                      <button type="button" class="fe-chip" [attr.data-cond]="c.key" [attr.aria-pressed]="selfConditions().includes(c.key)" [disabled]="disabled()" (click)="toggleSelfCondition(c.key)">
                        <span class="fe-fam__dot" [style.background]="colour(c.key)"></span>{{ c.label }}
                      </button>
                    }
                  </div>
                </div>
              } @else {
                <div class="fe-fam__fields">
                  <div class="fe-fam__field">
                    <label class="fe-fam__k" [attr.for]="fid('name', r.index)">Name (optional)</label>
                    <input class="fe-text__input" type="text" [id]="fid('name', r.index)" data-f="name" [value]="person(r.index).name ?? ''" maxlength="60" [disabled]="disabled()" (change)="setText(r.index, 'name', $any($event.target).value)" />
                  </div>
                  <div class="fe-fam__field">
                    <label class="fe-fam__k" [attr.for]="fid('age', r.index)">Age (optional)</label>
                    <input class="fe-text__input" type="text" inputmode="numeric" [id]="fid('age', r.index)" data-f="age" [value]="person(r.index).age ?? ''" [disabled]="disabled()" (change)="setNumber(r.index, 'age', $any($event.target).value)" />
                  </div>
                </div>
                @if (r.node.relation === 'spouse') {
                  <div class="fe-fam__field">
                    <span class="fe-fam__k">Spouse is</span>
                    <div class="fe-chips" role="radiogroup" aria-label="Spouse's sex">
                      @for (s of sexes; track s.value) {
                        <button type="button" class="fe-chip" role="radio" [attr.data-sex]="s.value" [attr.aria-checked]="r.node.sex === s.value" [disabled]="disabled()" (click)="setPersonSex(r.index, s.value)">
                          {{ s.label }}
                        </button>
                      }
                    </div>
                  </div>
                }
                <div class="fe-fam__field">
                  <span class="fe-fam__k">Has</span>
                  <div class="fe-chips" role="group" aria-label="Conditions">
                    @for (c of conditions(); track c.key) {
                      <button type="button" class="fe-chip" [attr.data-cond]="c.key" [attr.aria-pressed]="r.node.conditions.includes(c.key)" [disabled]="disabled()" (click)="toggleCondition(r.index, c.key)">
                        <span class="fe-fam__dot" [style.background]="colour(c.key)"></span>{{ c.label }}
                      </button>
                    }
                  </div>
                </div>
                <button type="button" class="fe-chip fe-switchrow" role="switch" data-act="deceased" [attr.aria-checked]="r.node.deceased" [disabled]="disabled()" (click)="toggleDeceased(r.index)">
                  <span class="fe-switchrow__txt">Has died</span>
                  <span class="pf-toggle__track fe-switch" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                </button>
                @if (r.node.deceased) {
                  <div class="fe-fam__field">
                    <label class="fe-fam__k" [attr.for]="fid('died', r.index)">Age at death (optional)</label>
                    <input class="fe-text__input" type="text" inputmode="numeric" [id]="fid('died', r.index)" data-f="ageAtDeath" [value]="person(r.index).ageAtDeath ?? ''" [disabled]="disabled()" (change)="setNumber(r.index, 'ageAtDeath', $any($event.target).value)" />
                  </div>
                }
                <div class="fe-fam__field">
                  <label class="fe-fam__k" [attr.for]="fid('note', r.index)">Note (optional)</label>
                  <input class="fe-text__input" type="text" [id]="fid('note', r.index)" data-f="note" [value]="person(r.index).note ?? ''" maxlength="200" [disabled]="disabled()" (change)="setText(r.index, 'note', $any($event.target).value)" />
                </div>
              }
              <div class="fe-fam__row">
                <button type="button" class="pf-btn pf-btn--primary" data-act="done" (click)="editing.set(null)"><pf-icon name="check" [size]="18" /> Done</button>
                @if (r.index >= 0 && !disabled()) {
                  <button type="button" class="pf-btn pf-btn--secondary" data-act="remove" (click)="remove(r.index)"><pf-icon name="trash" [size]="18" /> Remove</button>
                }
              </div>
            }
          </div>
        }
      </div>

      @if (!disabled()) {
        @if (adding()) {
          <div class="fe-fam__card fe-fam__card--edit" data-adding>
            <span class="fe-fam__k">Who is this?</span>
            <pf-select [options]="freeRelations()" [value]="''" [searchable]="true" placeholder="Choose a relative" (valueChange)="addRelative($event)" />
            <div class="fe-fam__row">
              <button type="button" class="pf-btn pf-btn--secondary" data-act="cancel-add" (click)="adding.set(false)">Cancel</button>
            </div>
          </div>
        } @else if (freeRelations().length > 0 && people().length < 40) {
          <div class="fe-fam__row">
            <button type="button" class="pf-btn pf-btn--secondary" data-act="add" (click)="adding.set(true)"><pf-icon name="plus" [size]="18" /> Add a relative</button>
          </div>
        }
      }

      <div class="fe-fam" role="group" aria-label="Family facts">
        @if (hasParents()) {
          <button type="button" class="fe-chip fe-switchrow" role="switch" data-act="cons-parents" [attr.aria-checked]="consParents()" [disabled]="disabled()" (click)="setCons('parents', !consParents())">
            <span class="fe-switchrow__txt">Parents are blood relatives</span>
            <span class="pf-toggle__track fe-switch" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          </button>
        }
        @if (hasSpouse()) {
          <button type="button" class="fe-chip fe-switchrow" role="switch" data-act="cons-spouse" [attr.aria-checked]="consSpouse()" [disabled]="disabled()" (click)="setCons('spouse', !consSpouse())">
            <span class="fe-switchrow__txt">Patient and spouse are blood relatives</span>
            <span class="pf-toggle__track fe-switch" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          </button>
        }
        <button type="button" class="fe-chip fe-switchrow" role="switch" data-act="no-history" [attr.aria-checked]="answer().noHistory === true" [disabled]="disabled()" (click)="toggleNoHistory()">
          <span class="fe-switchrow__txt">No significant family history</span>
          <span class="pf-toggle__track fe-switch" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
        </button>
      </div>
    </div>
  `,
})
export class FamilyTreeFill extends KindFill {
  private readonly dialog = inject(FeDialog);
  protected readonly size = SIZE;
  protected readonly half = SIZE / 2;
  protected readonly sexes = SEX;
  protected readonly clipId = feId('fe-ped') + '-c';
  private readonly idBase = feId('fe-tree');

  /** -1 = the patient, n = person n, null = nothing open. */
  protected readonly editing = signal<number | null>(null);
  protected readonly adding = signal(false);

  protected readonly answer = computed<FamilyAnswer>(() => (this.value() as FamilyAnswer | null) ?? {});
  protected readonly people = computed<FamilyPerson[]>(() => this.answer().people ?? []);
  protected readonly layout = computed<FamLayout>(() => buildLayout(this.answer()));

  protected readonly conditions = computed<FamCondition[]>(() => {
    const c = this.config()['conditions'];
    return Array.isArray(c) && c.length ? (c as FamCondition[]) : DEFAULT_FAMILY_CONDITIONS;
  });
  protected readonly usedConditions = computed(() => {
    const used = new Set(this.layout().nodes.flatMap((n) => n.conditions));
    return this.conditions().filter((c) => used.has(c.key));
  });
  protected readonly selfSex = computed(() => this.answer().self?.sex ?? 'unknown');
  protected readonly selfConditions = computed(() => this.answer().self?.conditions ?? []);
  protected readonly consParents = computed(() => this.answer().consanguinity?.parents === true);
  protected readonly consSpouse = computed(() => this.answer().consanguinity?.spouse === true);
  protected readonly hasParents = computed(() => this.people().some((p) => p.relation === 'father' || p.relation === 'mother'));
  protected readonly hasSpouse = computed(() => this.people().some((p) => p.relation === 'spouse'));

  protected readonly rows = computed<PersonRow[]>(() =>
    this.layout().nodes.map((node) => {
      const index = node.proband ? -1 : Number(node.id.slice(1));
      const bits: string[] = [];
      if (node.name) bits.push(node.name);
      if (node.age !== undefined) bits.push(String(node.age));
      if (node.deceased) bits.push(node.ageAtDeath !== undefined ? `died at ${node.ageAtDeath}` : 'deceased');
      if (node.conditions.length) bits.push(node.conditions.map((k) => this.conditions().find((c) => c.key === k)?.label ?? k).join(', '));
      return { node, index, title: node.proband ? 'Patient' : relationLabel(node.relation), sub: bits.join(' · ') };
    }),
  );

  protected readonly freeRelations = computed<PfSelectOption<string>[]>(() => {
    const taken = new Set(this.layout().nodes.map((n) => n.relation));
    return ADD_ORDER.filter((r) => !(SINGLE.has(r) && taken.has(r))).map((r) => ({ value: r, label: relationLabel(r) }));
  });

  protected readonly chartLabel = computed(() => {
    const n = this.layout().nodes.length;
    return `Family tree with ${n} ${n === 1 ? 'person' : 'people'}, the patient marked with an arrow. The people are listed below.`;
  });

  protected colour = (key: string): string => colorOf(this.conditions(), key);
  protected fid = (what: string, i: number): string => `${this.idBase}-${what}-${i}`;
  protected person = (i: number): FamilyPerson => this.people()[i] ?? ({ relation: '' } as FamilyPerson);

  protected diamond(n: FamNode): string {
    const h = SIZE / 2 + 2;
    return `${n.x},${n.y - h} ${n.x + h},${n.y} ${n.x},${n.y + h} ${n.x - h},${n.y}`;
  }

  protected arrow(n: FamNode): string {
    const { x, y } = n;
    return `M${x - 46},${y + 46} L${x - 27},${y + 27} M${x - 27},${y + 27} L${x - 39},${y + 29} M${x - 27},${y + 27} L${x - 29},${y + 39}`;
  }

  protected toggle(i: number): void {
    this.adding.set(false);
    this.editing.set(this.editing() === i ? null : i);
  }

  protected addRelative(relation: string): void {
    if (!relation || !(RELATIONS as readonly string[]).includes(relation)) return;
    const people = [...this.people(), { relation } as FamilyPerson];
    this.adding.set(false);
    this.commit({ ...this.answer(), people });
    this.editing.set(people.length - 1);
  }

  protected async remove(i: number): Promise<void> {
    const p = this.person(i);
    const ok = await this.dialog.confirm({
      title: `Remove ${relationLabel(p.relation).toLowerCase()}?`,
      message: 'They come off the family tree. The patient and everyone else stay.',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    this.editing.set(null);
    this.commit({ ...this.answer(), people: this.people().filter((_, j) => j !== i) });
  }

  private patch(i: number, change: (p: FamilyPerson) => FamilyPerson): void {
    this.commit({ ...this.answer(), people: this.people().map((p, j) => (j === i ? change({ ...p }) : p)) });
  }

  protected setText(i: number, key: 'name' | 'note', v: string): void {
    const t = v.trim();
    this.patch(i, (p) => {
      if (t) p[key] = t;
      else delete p[key];
      return p;
    });
  }

  protected setNumber(i: number, key: 'age' | 'ageAtDeath', v: string): void {
    const n = Math.round(Number(v));
    this.patch(i, (p) => {
      if (v.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 120) p[key] = n;
      else delete p[key];
      return p;
    });
  }

  protected setPersonSex(i: number, sex: string): void {
    this.patch(i, (p) => ({ ...p, sex }));
  }

  protected toggleCondition(i: number, key: string): void {
    this.patch(i, (p) => {
      const c = new Set(p.conditions ?? []);
      if (!c.delete(key)) c.add(key);
      if (c.size) p.conditions = [...c];
      else delete p.conditions;
      return p;
    });
  }

  protected toggleDeceased(i: number): void {
    this.patch(i, (p) => {
      if (p.deceased) {
        delete p.deceased;
        delete p.ageAtDeath;
      } else p.deceased = true;
      return p;
    });
  }

  protected setSelfSex(sex: string): void {
    this.commit({ ...this.answer(), self: { ...this.answer().self, sex } });
  }

  protected toggleSelfCondition(key: string): void {
    const c = new Set(this.selfConditions());
    if (!c.delete(key)) c.add(key);
    this.commit({ ...this.answer(), self: { ...this.answer().self, conditions: [...c] } });
  }

  protected setCons(which: 'parents' | 'spouse', on: boolean): void {
    this.commit({ ...this.answer(), consanguinity: { ...this.answer().consanguinity, [which]: on } });
  }

  protected toggleNoHistory(): void {
    this.commit({ ...this.answer(), noHistory: this.answer().noHistory === true ? undefined : true });
  }

  /** Writes the answer without empty parts; nothing left = no answer. */
  private commit(a: FamilyAnswer): void {
    const out: FamilyAnswer = {};
    const self = a.self ?? {};
    const selfOut: NonNullable<FamilyAnswer['self']> = {};
    if (self.sex && self.sex !== 'unknown') selfOut.sex = self.sex;
    if (self.conditions?.length) selfOut.conditions = self.conditions;
    if (Object.keys(selfOut).length) out.self = selfOut;
    if (a.people?.length) out.people = a.people;
    const cons: NonNullable<FamilyAnswer['consanguinity']> = {};
    if (a.consanguinity?.parents) cons.parents = true;
    if (a.consanguinity?.spouse) cons.spouse = true;
    if (Object.keys(cons).length) out.consanguinity = cons;
    if (a.noHistory) out.noHistory = true;
    this.emit(Object.keys(out).length ? out : undefined);
  }
}
