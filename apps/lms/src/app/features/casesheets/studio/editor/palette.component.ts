import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, inject, input, signal, viewChild } from '@angular/core';
import { FieldDef, FieldSlot, KIND_BUILDS, KindBuild, findField, insertFieldTemplate, allFields } from '@prefrontal/forms-engine';
import { IconName, PfIconComponent } from '@prefrontal/forms-engine';
import { StudioApi } from '../data/studio-api';
import { TemplateRow, plainError } from '../data/studio-models';
import { deskSignal } from '../shared/desk';
import { EditorStore } from './editor-store';

/** One row of the desktop menu: a kind, or a saved question. */
interface PalRow {
  id: string;
  name: string;
  hint: string;
  icon: IconName;
  kind?: string;
  template?: TemplateRow;
  heading?: string;
}

const GROUPS: { id: KindBuild['group']; title: string }[] = [
  { id: 'Ask', title: 'Questions' },
  { id: 'Measure', title: 'Numbers, sizes and time' },
  { id: 'Repeat', title: 'Things that repeat' },
  { id: 'Picture', title: 'Pictures and drawings' },
  { id: 'Table', title: 'Tables and charts' },
];

/**
 * "Add a question", opened right where the question will go: the kinds the
 * API's catalogue offers (GET /api/components), with plain names, an icon
 * and one line each, plus the saved questions (server-side templates).
 */
@Component({
  selector: 'st-palette',
  standalone: true,
  imports: [PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pal" [class.pal--desk]="desk()" aria-label="Add a question" (keydown)="onKey($event)">
      <header class="pal-head">
        <h3 class="pal-title">{{ slot().option ? 'Add a follow-up question' : 'Add a question' }}</h3>
        @if (desk()) {
          <span class="pal-keys" aria-hidden="true">↑ ↓ to choose · Enter to add · Esc to close</span>
        }
        <button type="button" class="pf-btn pf-btn--icon" aria-label="Close" data-tip="Close (Esc)" data-tip-end (click)="store.paletteAt.set(null)">
          <pf-icon name="x" [size]="desk() ? 18 : 20" />
        </button>
      </header>
      @if (desk()) {
        <!-- desktop: a searchable menu, one kind per row, the keyboard drives it -->
        <div class="pal-search">
          <pf-icon name="search" [size]="16" />
          <input
            #searchEl
            class="pf-input pal-q"
            type="text"
            role="combobox"
            aria-label="Search the kinds of question"
            aria-controls="pal-list"
            [attr.aria-activedescendant]="activeId()"
            aria-expanded="true"
            placeholder="Search: yes / no, date, size…"
            autocomplete="off"
            spellcheck="false"
            [value]="query()"
            (input)="query.set($any($event.target).value); hi.set(0)"
          />
        </div>
        <ul class="pal-list" id="pal-list" role="listbox" aria-label="Kinds of question">
          @for (row of rows(); track row.id; let i = $index) {
            @if (row.heading) {
              <li class="pal-group pal-group--row" role="presentation">{{ row.heading }}</li>
            }
            <li
              class="pal-opt"
              role="option"
              [id]="'pal-o-' + i"
              [attr.aria-selected]="i === hi()"
              [attr.data-kind]="row.kind ?? null"
              [attr.data-template]="row.template?.id ?? null"
              (mousemove)="hi.set(i)"
              (click)="choose(row)"
            >
              <span class="pal-ic pal-ic--sm"><pf-icon [name]="row.icon" [size]="16" /></span>
              <span class="pal-name">{{ row.name }}</span>
              <span class="pal-hint pal-hint--row">{{ row.hint }}</span>
            </li>
          } @empty {
            <li class="pal-none" role="presentation">No kind of question matches “{{ query() }}”.</li>
          }
        </ul>
      } @else {
        @for (g of groups(); track g.id) {
          <h4 class="pal-group">{{ g.title }}</h4>
          <ul class="pal-grid" role="list">
            @for (k of g.kinds; track k.kind) {
              <li>
                <button type="button" class="pal-tile pf-touch" [attr.data-kind]="k.kind" (click)="add(k.kind)">
                  <span class="pal-ic"><pf-icon [name]="icon(k)" [size]="20" /></span>
                  <span class="pal-t">
                    <span class="pal-name">{{ k.name }}</span>
                    <span class="pal-hint">{{ k.hint }}</span>
                  </span>
                </button>
              </li>
            }
          </ul>
        }
        @if (saved().length) {
          <h4 class="pal-group">Saved questions</h4>
          <ul class="pal-grid" role="list">
            @for (t of saved(); track t.id) {
              <li>
                <button type="button" class="pal-tile pf-touch" [attr.data-template]="t.id" [disabled]="busy()" (click)="addSaved(t)">
                  <span class="pal-ic"><pf-icon name="copy" [size]="20" /></span>
                  <span class="pal-t">
                    <span class="pal-name">{{ t.title }}</span>
                    <span class="pal-hint">{{ t.category || 'Saved by your team' }}</span>
                  </span>
                </button>
              </li>
            }
          </ul>
        }
      }
      @if (error()) {
        <p class="pal-err" role="alert">{{ error() }}</p>
      }
    </section>
  `,
  styles: [
    `
      .pal {
        display: grid;
        gap: 10px;
        padding: 14px;
        border: 1px solid color-mix(in srgb, var(--color-primary, #7c3aed) 35%, var(--pf-line));
        border-radius: 16px;
        background: var(--pf-card-bg);
        animation: pal-in var(--pf-dur) var(--pf-spring) both;
      }
      .pal-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .pal-title {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
      }
      .pal-group {
        margin: 6px 0 0;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--text-tertiary);
      }
      .pal-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr));
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .pal-tile {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        width: 100%;
        height: 100%;
        padding: 12px;
        border: 1px solid var(--pf-line);
        border-radius: 14px;
        background: var(--pf-card-bg);
        color: var(--text-primary);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .pal-tile:hover:not(:disabled) {
        border-color: var(--glass-border-hover, rgba(124, 58, 237, 0.3));
      }
      .pal-tile:active:not(:disabled) {
        transform: scale(0.985);
      }
      .pal-ic {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: none;
        width: 38px;
        height: 38px;
        border-radius: 10px;
        background: color-mix(in srgb, var(--color-primary, #7c3aed) 10%, transparent);
        color: var(--violet-text, #7c3aed);
      }
      .pal-t {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      .pal-name {
        font-size: 15px;
        font-weight: 600;
      }
      .pal-hint {
        font-size: 13px;
        line-height: 1.35;
        color: var(--text-tertiary);
      }
      .pal-err {
        margin: 0;
        color: var(--red-text);
      }
      /* desktop: a compact searchable menu */
      .pal--desk {
        gap: 8px;
        padding: 10px 12px 12px;
        border-radius: 14px;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
      }
      .pal--desk .pal-head {
        gap: 12px;
      }
      .pal--desk .pal-title {
        font-size: 14px;
      }
      .pal-keys {
        margin-left: auto;
        font-size: 12px;
        color: var(--text-tertiary);
      }
      .pal-search {
        position: relative;
        display: flex;
        align-items: center;
      }
      .pal-search > pf-icon {
        position: absolute;
        left: 12px;
        color: var(--text-tertiary);
        pointer-events: none;
      }
      .pal-q {
        width: 100%;
        padding-left: 36px;
      }
      .pal-list {
        display: grid;
        gap: 1px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .pal-group--row {
        padding: 8px 8px 2px;
        margin: 0;
      }
      .pal-opt {
        display: grid;
        grid-template-columns: 28px minmax(120px, 180px) minmax(0, 1fr);
        align-items: center;
        gap: 10px;
        min-height: 36px;
        padding: 4px 8px;
        border-radius: 9px;
        color: var(--text-primary);
        cursor: pointer;
      }
      .pal-opt[aria-selected='true'] {
        background: var(--pf-done-tint, rgba(124, 58, 237, 0.08));
      }
      .pal-opt .pal-name {
        font-size: 13.5px;
      }
      .pal-ic--sm {
        width: 28px;
        height: 28px;
        border-radius: 8px;
      }
      .pal-hint--row {
        font-size: 12.5px;
        line-height: 1.35;
      }
      .pal-none {
        padding: 10px 8px;
        color: var(--text-tertiary);
        font-size: 13.5px;
      }
      @keyframes pal-in {
        from {
          opacity: 0;
          transform: translateY(6px);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .pal {
          animation: none;
        }
      }
    `,
  ],
})
export class PaletteComponent {
  readonly slot = input.required<FieldSlot>();
  protected readonly store = inject(EditorStore);
  private readonly api = inject(StudioApi);
  protected readonly saved = signal<TemplateRow[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  /** Desktop: the menu with its search; touch: the tiles. */
  protected readonly desk = deskSignal();
  protected readonly query = signal('');
  /** The highlighted row of the desktop menu. */
  protected readonly hi = signal(0);
  private readonly searchEl = viewChild<ElementRef<HTMLInputElement>>('searchEl');

  constructor() {
    // the search box takes the keyboard at once (N, / or "Add a question")
    afterNextRender(() => this.searchEl()?.nativeElement.focus({ preventScroll: true }));
    void this.api
      .templates('field')
      .then((t) => this.saved.set(t))
      .catch(() => undefined);
  }

  /** The palette = the API's catalogue (GET /api/components), named by each kind's descriptor. */
  readonly kinds = computed<KindBuild[]>(() => {
    const names = this.store.catalogue().map((k) => k.name);
    const all = Object.values(KIND_BUILDS);
    const offered = names.length ? all.filter((b) => names.includes(b.kind)) : all;
    // a follow-up can't be a repeating group or repeating pages (the API refuses them inside an option)
    return this.slot().option ? offered.filter((b) => b.group !== 'Repeat' && b.group !== 'Picture' && b.group !== 'Table') : offered;
  });

  protected readonly groups = computed(() =>
    GROUPS.map((g) => ({ ...g, kinds: this.kinds().filter((k) => k.group === g.id) })).filter((g) => g.kinds.length),
  );

  /** The desktop menu: kinds, then saved questions, filtered by name / hint (case-insensitive, substring). */
  protected readonly rows = computed<PalRow[]>(() => {
    const q = this.query().trim().toLowerCase();
    const hit = (...t: (string | undefined | null)[]) => !q || t.some((x) => (x ?? '').toLowerCase().includes(q));
    const out: PalRow[] = [];
    for (const g of this.groups()) {
      let first = true;
      for (const k of g.kinds) {
        if (!hit(k.name, k.hint, k.kind)) continue;
        out.push({ id: 'k:' + k.kind, name: k.name, hint: k.hint, icon: k.icon as IconName, kind: k.kind, heading: first ? g.title : undefined });
        first = false;
      }
    }
    let first = true;
    for (const t of this.saved()) {
      if (!hit(t.title, t.category)) continue;
      out.push({ id: 't:' + t.id, name: t.title, hint: t.category || 'Saved by your team', icon: 'copy', template: t, heading: first ? 'Saved questions' : undefined });
      first = false;
    }
    return out;
  });

  protected readonly activeId = computed(() => (this.rows().length ? 'pal-o-' + Math.min(this.hi(), this.rows().length - 1) : null));

  protected onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      // let go of the keyboard now: the menu leaves on the next render, and a quick next key must reach Studio
      (e.target as HTMLElement | null)?.blur?.();
      this.store.paletteAt.set(null);
      return;
    }
    if (!this.desk()) return;
    const n = this.rows().length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (!n) return;
      this.hi.set((this.hi() + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
      setTimeout(() => document.getElementById(this.activeId() ?? '')?.scrollIntoView?.({ block: 'nearest' }), 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const row = this.rows()[Math.min(this.hi(), n - 1)];
      if (row) void this.choose(row);
    }
  }

  protected async choose(row: PalRow): Promise<void> {
    if (row.kind) this.add(row.kind);
    else if (row.template) await this.addSaved(row.template);
  }

  protected icon(k: KindBuild): IconName {
    return k.icon as IconName;
  }

  protected add(kind: string): void {
    this.store.addQuestion(this.slot(), kind);
  }

  protected async addSaved(t: TemplateRow): Promise<void> {
    const d = this.store.def();
    if (!d) return;
    this.busy.set(true);
    try {
      const used = allFields(d).map((f) => f.key);
      const ex = await this.api.expandTemplate(t.id, used, d.pages.map((p) => p.key));
      const field = ex.body as FieldDef;
      let keys: string[] = [];
      this.store.edit((x) => {
        const r = insertFieldTemplate(x, this.slot(), [field]);
        keys = r.keys;
        return r.def;
      });
      this.store.paletteAt.set(null);
      if (keys[0] && findField(this.store.def()!, keys[0])) this.store.jumpTo(keys[0]);
    } catch (e) {
      this.error.set(plainError(e, "Couldn't add that saved question."));
    } finally {
      this.busy.set(false);
    }
  }
}
