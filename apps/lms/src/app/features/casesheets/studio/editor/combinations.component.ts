import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import {
  ApplyFieldChange,
  CombinationDef,
  FieldDef,
  PfIconComponent,
  PictureChoiceMiniComponent,
  combinationProblems,
  combinationsOf,
  newCombinationId,
  previewPicks,
} from '@prefrontal/forms-engine';
import { PfSelectOption, SelectComponent } from '@prefrontal/shared';
import { DragReorder } from '../shared/drag-reorder';

/**
 * "Sentences for combinations" (owner 2026-11-12): under EVERY multi-select question. A sentence for a particular
 * set of picks: "Exactly these" (the picks equal the set) or "These plus anything else" (the set is in the picks,
 * `{others}` = the other picks' own words). The first sentence that fits wins, so they drag into order. A live
 * line shows what the case sheet writes for sample picks. Collapsed by default, with a count. The rules are the
 * question's `says.combinations`; the engine (`narrative/combinations.ts`) decides which one fires.
 */
@Component({
  selector: 'st-combinations',
  standalone: true,
  imports: [PfIconComponent, SelectComponent, PictureChoiceMiniComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './combinations.component.html',
  styleUrl: './combinations.component.scss',
})
export class CombinationsComponent {
  readonly field = input.required<FieldDef>();
  readonly apply = input.required<ApplyFieldChange>();

  protected readonly open = signal(false);
  protected readonly sample = signal<string[]>([]);

  protected readonly rules = computed(() => this.field().says?.combinations ?? []);
  protected readonly count = computed(() => combinationsOf(this.field()).length);
  protected readonly isPicture = computed(() => this.field().kind === 'pictureChoice');
  protected readonly choices = computed<PfSelectOption<string>[]>(() => (this.field().options ?? []).map((o) => ({ value: o.key, label: o.label })));
  protected readonly problems = computed(() => {
    const out = new Map<number, string[]>();
    for (const p of combinationProblems(this.field())) out.set(p.index, [...(out.get(p.index) ?? []), p.text]);
    return out;
  });
  protected readonly preview = computed(() => previewPicks(this.field(), this.sample()));
  protected readonly previewRule = computed(() => {
    const picked = this.sample();
    if (!picked.length) return null;
    const i = this.rules().findIndex((r) => this.fires(r, picked));
    return i >= 0 ? i + 1 : null;
  });
  protected readonly listId = computed(() => `combos:${this.field().key}`);

  protected readonly drag = new DragReorder((_list, from, to) => this.move(from, to));

  private fires(r: CombinationDef, picked: string[]): boolean {
    const has = (k: string) => picked.some((p) => p.toLowerCase() === k.toLowerCase());
    if (!r.options.length || !r.options.every(has)) return false;
    return r.match === 'includes' || picked.length === new Set(r.options.map((o) => o.toLowerCase())).size;
  }

  protected add(): void {
    this.open.set(true);
    this.apply()((f) => {
      f.says ??= { include: true };
      const first = (f.options ?? [])[0]?.key;
      (f.says.combinations ??= []).push({ id: newCombinationId(f), options: first ? [first] : [], match: 'exact', text: '' });
    });
  }

  protected edit(i: number, change: (r: CombinationDef) => void): void {
    this.apply()((f) => {
      const r = f.says?.combinations?.[i];
      if (r) change(r);
    });
  }

  protected setOptions(i: number, keys: string[]): void {
    // keep the question's own order of choices
    const order = (this.field().options ?? []).map((o) => o.key);
    this.edit(i, (r) => (r.options = order.filter((k) => keys.includes(k))));
  }

  protected tapPart(i: number, key: string): void {
    const cur = this.rules()[i]?.options ?? [];
    this.setOptions(i, cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]);
  }

  protected setMatch(i: number, match: CombinationDef['match']): void {
    this.edit(i, (r) => (r.match = match));
  }

  protected setText(i: number, text: string): void {
    this.edit(i, (r) => (r.text = text));
  }

  protected remove(i: number): void {
    this.apply()((f) => {
      f.says?.combinations?.splice(i, 1);
      if (f.says && !f.says.combinations?.length) delete f.says.combinations;
    });
  }

  protected move(from: number, to: number): void {
    this.apply()((f) => {
      const list = f.says?.combinations;
      if (!list || from === to || from < 0 || from >= list.length) return;
      const [r] = list.splice(from, 1);
      list.splice(Math.max(0, Math.min(to, list.length)), 0, r);
    });
  }

  protected tapSample(key: string): void {
    const cur = this.sample();
    this.sample.set(cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]);
  }

  protected setSample(keys: string[]): void {
    this.sample.set(keys ?? []);
  }
}
