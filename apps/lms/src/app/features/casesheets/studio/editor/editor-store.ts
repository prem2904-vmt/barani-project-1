import { Injectable, computed, inject, signal } from '@angular/core';
import {
  FieldDef,
  FieldSlot,
  FormDefinition,
  PageDef,
  addField,
  allFields,
  locate,
  placeProblem,
  sampleAnswers,
} from '@prefrontal/forms-engine';
import { StudioApi } from '../data/studio-api';
import { ComponentKind, Problem } from '../data/studio-models';
import { StudioSession } from '../data/studio-session';
import { clearCheck, countChecks, dropEditedChecks, markedSignatures } from '../cortex-import/cortex-import';

export type CardArea = 'says' | 'ifNone' | 'showWhen' | 'options' | 'settings' | 'label';

/**
 * The editor screen's state around one StudioSession: which page and which
 * question are selected, which part of a card is open for editing, where the
 * palette is open, the problems per question, the catalogue's defaults.
 * Every card and panel reads and edits through this one store, so the field
 * card, its settings and the narrative never disagree.
 */
@Injectable()
export class EditorStore {
  readonly session = inject(StudioSession);
  private readonly api = inject(StudioApi);

  readonly def = this.session.definition;
  readonly pageKey = signal<string | null>(null);
  readonly selectedKey = signal<string | null>(null);
  /** The part of a card that is open for editing (one at a time, so the screen stays calm). */
  readonly editing = signal<{ key: string; area: CardArea } | null>(null);
  /** Where "+ Add a question" is open. */
  readonly paletteAt = signal<FieldSlot | null>(null);
  /** A field that should flash (after a jump from a problem or the narrative). */
  readonly flash = signal<string | null>(null);
  readonly catalogue = signal<ComponentKind[]>([]);
  /** Narrow screens: the selected question's settings open as a sheet. */
  readonly settingsOpen = signal(false);
  /** Bumped when something asks for the question's settings (the desktop side card shows its Question tab). */
  readonly settingsAsked = signal(0);
  /**
   * Multi-select (desktop: ⌘ / Ctrl-click, Shift-click, the checkbox, ⇧↑↓, ⌘A):
   * the page's questions picked for move / copy / remove together. Empty =
   * the one selected question is the selection.
   */
  readonly picked = signal<ReadonlySet<string>>(new Set());

  readonly page = computed<PageDef | null>(() => {
    const d = this.def();
    if (!d) return null;
    return d.pages.find((p) => p.key === this.pageKey()) ?? d.pages[0] ?? null;
  });

  /** The page's own questions, in order (the ones multi-select works on). */
  readonly pageKeys = computed(() => (this.page()?.fields ?? []).map((f) => f.key));

  /**
   * What the bulk actions and the shortcuts act on: the picked questions in
   * page order, else the selected question. ONE list, so the checkboxes, the
   * tint and the "3 selected" count never disagree.
   */
  readonly selection = computed<string[]>(() => {
    const picked = this.picked();
    if (picked.size) return this.pageKeys().filter((k) => picked.has(k));
    const k = this.selectedKey();
    return k && this.def() && locate(this.def()!, k) ? [k] : [];
  });

  isPicked(key: string): boolean {
    return this.picked().has(key);
  }

  /** ⌘ / Ctrl-click or the checkbox: add or take one question out of the selection. */
  togglePick(key: string): void {
    const next = new Set(this.picked().size ? this.picked() : this.selection().filter((k) => this.pageKeys().includes(k)));
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.picked.set(next);
    if (next.has(key)) this.selectedKey.set(key);
    else if (this.selectedKey() === key) this.selectedKey.set([...next].pop() ?? null);
    this.editing.set(null);
  }

  /** Shift-click / ⇧↑↓: everything between the selected question and this one. */
  pickRange(key: string): void {
    const keys = this.pageKeys();
    const anchor = this.selectedKey();
    const a = anchor ? keys.indexOf(anchor) : -1;
    const b = keys.indexOf(key);
    if (b < 0) return;
    if (a < 0) {
      this.select(key);
      return;
    }
    const [lo, hi] = a < b ? [a, b] : [b, a];
    this.picked.set(new Set([...this.picked(), ...keys.slice(lo, hi + 1)]));
    this.editing.set(null);
  }

  pickAll(): void {
    const keys = this.pageKeys();
    if (!keys.length) return;
    this.picked.set(new Set(keys));
    if (!this.selectedKey() || !keys.includes(this.selectedKey()!)) this.selectedKey.set(keys[0]);
    this.editing.set(null);
  }

  clearPicks(): void {
    if (this.picked().size) this.picked.set(new Set());
  }

  /** Ask for the selected question's settings (sheet on narrow screens, the Question tab on desktop). */
  revealSettings(): void {
    this.settingsOpen.set(true);
    this.settingsAsked.update((n) => n + 1);
  }

  readonly selected = computed(() => {
    const d = this.def();
    const k = this.selectedKey();
    return d && k ? locate(d, k) : null;
  });

  /** The answers the live narrative and the doctor's view use: the API's sample, else ours. */
  readonly answers = computed(() => {
    const p = this.session.preview();
    const d = this.def();
    return p?.answers ?? (d ? sampleAnswers(d) : {});
  });

  /** The API's problems, with the words made plainer where Studio knows better ("Add at least one choice."). */
  readonly problems = computed<Problem[]>(() => {
    const d = this.def();
    return this.session.problems().map((p) => (d ? { ...p, message: placeProblem(d, p).text } : p));
  });
  readonly problemsByField = computed(() => {
    const m = new Map<string, Problem[]>();
    for (const p of this.problems()) if (p.fieldKey) m.set(p.fieldKey, [...(m.get(p.fieldKey) ?? []), p]);
    return m;
  });
  readonly errorCount = computed(() => this.problems().filter((p) => p.severity === 'error').length);
  readonly problemsByPage = computed(() => {
    const m = new Map<string, number>();
    for (const p of this.problems()) if (p.pageKey && p.severity === 'error') m.set(p.pageKey, (m.get(p.pageKey) ?? 0) + 1);
    return m;
  });

  readonly fieldCount = computed(() => {
    const d = this.def();
    return d ? allFields(d).length : 0;
  });

  async loadCatalogue(): Promise<void> {
    try {
      this.catalogue.set(await this.api.components());
    } catch {
      /* the palette still works from the kind descriptors */
    }
  }

  defaultsFor(kind: string): Record<string, unknown> {
    return structuredClone(this.catalogue().find((k) => k.name === kind)?.defaults ?? {});
  }

  /** Questions Cortex marked "Check this" (`config.checkNote`), sub-fields included. */
  readonly checkCount = computed(() => countChecks(this.def()));

  /** One edit to the form. A question that Cortex marked loses its marker when the edit changes it. */
  edit(change: (d: FormDefinition) => FormDefinition): void {
    const d = this.def();
    if (!d) return;
    const next = change(d);
    this.session.apply(next === d ? next : dropEditedChecks(markedSignatures(d), next));
  }

  /** "Looks right": take the marker off this question (through the normal save). */
  looksRight(key: string): void {
    this.edit((d) => clearCheck(d, key));
  }

  /** Open a page. Nothing is selected, so the right panel shows the Components palette (legacy). */
  selectPage(key: string): void {
    this.pageKey.set(key);
    this.paletteAt.set(null);
    this.editing.set(null);
    this.clearPicks();
    this.selectedKey.set(null);
  }

  /** A question was just added (palette tile, saved template): select it, so its settings open, and show it. */
  afterAdd(key: string): void {
    this.paletteAt.set(null);
    this.picked.set(new Set());
    this.selectedKey.set(key);
    this.settingsOpen.set(true);
    this.pulse(key);
  }

  select(key: string | null, openSheet = false): void {
    if (this.selectedKey() !== key) this.editing.set(null);
    this.clearPicks();
    this.selectedKey.set(key);
    if (key && openSheet) this.settingsOpen.set(true);
  }

  open(key: string, area: CardArea): void {
    this.select(key);
    this.editing.set({ key, area });
  }

  isEditing(key: string, area: CardArea): boolean {
    const e = this.editing();
    return !!e && e.key === key && e.area === area;
  }

  addQuestion(slot: FieldSlot, kind: string): string {
    let key = '';
    this.edit((d) => {
      const r = addField(d, slot, kind, this.defaultsFor(kind));
      key = r.key;
      return r.def;
    });
    this.paletteAt.set(null);
    this.selectedKey.set(key);
    this.editing.set({ key, area: 'label' });
    this.pulse(key);
    return key;
  }

  /** Go to a question (from a problem, the narrative or history): its page, select it, flash it. */
  jumpTo(fieldKey: string | null, pageKey?: string | null, area?: CardArea): void {
    const d = this.def();
    if (!d) return;
    const loc = fieldKey ? locate(d, fieldKey) : null;
    const pk = loc?.page.key ?? pageKey ?? null;
    if (pk && pk !== this.pageKey()) this.clearPicks();
    if (pk) this.pageKey.set(pk);
    if (loc) {
      // a follow-up shows under its question once that question is selected
      this.selectedKey.set(fieldKey);
      if (area && area !== 'settings') this.editing.set({ key: fieldKey!, area });
      this.pulse(fieldKey!);
    }
  }

  /** Keyboard / move: bring the card into view and give it focus, without the flash. */
  focusCard(key: string): void {
    setTimeout(() => {
      if (typeof document === 'undefined') return;
      const el = document.querySelector<HTMLElement>(`[data-card="${key}"]`);
      el?.scrollIntoView?.({ block: 'nearest' });
      el?.focus?.({ preventScroll: true });
    }, 0);
  }

  private pulse(key: string): void {
    this.flash.set(key);
    setTimeout(() => {
      if (typeof document !== 'undefined')
        document.querySelector(`[data-card="${key}"]`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }, 30);
    setTimeout(() => this.flash.update((k) => (k === key ? null : k)), 1600);
  }

  /** The question that owns follow-ups shown under it (the selected one, or the one a selected follow-up belongs to). */
  readonly expandedOwner = computed(() => {
    const sel = this.selected();
    if (!sel) return null;
    return sel.ownerField?.key ?? sel.field.key;
  });

  fieldsOf(page: PageDef | null): FieldDef[] {
    return page?.fields ?? [];
  }
}
