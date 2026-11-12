import { Injectable, computed, signal } from '@angular/core';
import {
  Answers,
  FormDefinition,
  WizardNav,
  WizardPage,
  isAnswered,
  isLegacySheet,
  pageLookup,
  pageProgress,
  visibleFields,
  wizardPages,
} from '@prefrontal/forms-engine';

/**
 * The page wizard's state for one open case sheet: which page is showing,
 * the pages in order, progress, and the jump API the repeating-page chips
 * use (FE_WIZARD). Pure state + signals; the page component wires it to
 * the screen.
 */
@Injectable()
export class WizardController implements WizardNav {
  readonly definition = signal<FormDefinition | null>(null);
  readonly answers = signal<Answers>({});
  private readonly currentId = signal<string | null>(null);
  /** +1 forward, -1 back: drives the slide direction. */
  readonly direction = signal<1 | -1>(1);

  readonly pages = computed<WizardPage[]>(() => {
    const def = this.definition();
    return def ? wizardPages(def, this.answers()) : [];
  });

  /** The current page; when it disappears (its condition stopped matching) the nearest earlier page. */
  readonly index = computed(() => {
    const pages = this.pages();
    const id = this.currentId();
    const i = pages.findIndex((p) => p.id === id);
    return i >= 0 ? i : Math.min(this.lastIndex, Math.max(0, pages.length - 1));
  });
  private lastIndex = 0;

  readonly page = computed<WizardPage | null>(() => this.pages()[this.index()] ?? null);
  readonly isFirst = computed(() => this.index() === 0);
  readonly isLast = computed(() => this.index() >= this.pages().length - 1);
  readonly next = computed<WizardPage | null>(() => this.pages()[this.index() + 1] ?? null);

  /** Pages with every visible field answered (for the page list), and overall progress. */
  readonly progress = computed(() => {
    const a = this.answers();
    const per = this.pages().map((p) => ({ page: p, ...pageProgress(p, a) }));
    const total = per.reduce((s, p) => s + p.total, 0);
    const answered = per.reduce((s, p) => s + p.answered, 0);
    return { per, total, answered, ratio: total ? answered / total : 0 };
  });

  start(def: FormDefinition, answers: Answers, at?: string | null): void {
    this.definition.set(def);
    this.answers.set(answers);
    const pages = this.pages();
    const target = at ? pages.find((p) => p.id === at || p.page.key === at) : null;
    this.currentId.set((target ?? pages[0])?.id ?? null);
  }

  goTo(id: string): void {
    const pages = this.pages();
    const to = pages.findIndex((p) => p.id === id);
    if (to < 0) return;
    this.direction.set(to >= this.index() ? 1 : -1);
    this.lastIndex = to;
    this.currentId.set(id);
  }

  forward(): boolean {
    const n = this.next();
    if (!n) return false;
    this.goTo(n.id);
    return true;
  }

  back(): boolean {
    const p = this.pages()[this.index() - 1];
    if (!p) return false;
    this.goTo(p.id);
    return true;
  }

  isLegacy(): boolean {
    return isLegacySheet(this.definition());
  }

  pageTitle(pageKey: string): string {
    return this.definition()?.pages.find((p) => p.key === pageKey)?.title ?? pageKey;
  }

  /**
   * Auto-advance (plan §6): the doctor just answered `key` with one tap, it
   * is the LAST visible field of the page, and every visible field of the
   * page now has an answer.
   */
  completesPage(key: string): boolean {
    const wp = this.page();
    // an imported old case sheet never moves on by itself (resident-fe switched auto-advance off)
    if (!wp || this.isLast() || isLegacySheet(this.definition())) return false;
    const get = pageLookup(wp, this.answers());
    const fields = visibleFields(wp.page, get);
    if (!fields.length || fields[fields.length - 1].key !== key) return false;
    return fields.every((f) => isAnswered(get(f.key)));
  }
}
