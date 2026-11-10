import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { NarrativeSectionDef, NarrativeTable, NarrativeTableComponent, edit, findField, locate } from '@prefrontal/forms-engine';
import { PfIconComponent } from '@prefrontal/forms-engine';
import { SentenceComponent, SentenceToken } from '../shared/sentence.component';
import { EditorStore } from './editor-store';

/**
 * The live narrative, right under the form (plan §5): the API writes it from
 * the unsaved form and typical answers ~300 ms after each change. Paragraphs
 * the selected question writes into are marked; tapping a paragraph jumps to
 * its first question. "Change the wording" edits the paragraph's own text
 * (the answers are chips, never {{keys}}).
 */
@Component({
  selector: 'st-narrative',
  standalone: true,
  imports: [PfIconComponent, SentenceComponent, NarrativeTableComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="nv" [class.nv--docked]="docked()" [attr.aria-labelledby]="docked() ? null : 'nv-h'" [attr.aria-label]="docked() ? 'What it writes' : null" data-narrative>
      <header class="nv-head">
        @if (!docked()) {
          <h2 class="nv-h" id="nv-h"><pf-icon name="text" [size]="16" /> What it writes</h2>
        }
        <span class="nv-note">
          @switch (store.session.previewState()) {
            @case ('loading') { Writing… }
            @case ('offline') { Can't reach the server to write it }
            @default { From typical answers, as a doctor would fill it }
          }
        </span>
      </header>
      @if (!sections().length) {
        <p class="nv-empty">Nothing written yet. Add a question and its sentence shows here.</p>
      }
      @for (s of sections(); track s.key) {
        <article class="nv-sec" [class.nv-sec--mine]="s.mine" [attr.data-section]="s.key">
          <header class="nv-sec__h">
            <h3 class="nv-sec__t">{{ s.title }}</h3>
            @if (s.def) {
              <button type="button" class="pf-btn pf-btn--tertiary nv-edit" (click)="editing.set(editing() === s.key ? null : s.key)">
                <pf-icon name="pen" [size]="16" /> {{ editing() === s.key ? 'Close' : 'Change the wording' }}
              </button>
            }
          </header>
          @if (editing() === s.key && s.def) {
            <label class="nv-lbl">Heading <input class="pf-input" type="text" [value]="s.def.title" (change)="rename(s.key, $any($event.target).value)" /></label>
            <st-sentence
              label="Paragraph"
              [value]="s.def.template ?? ''"
              [editing]="true"
              [tokens]="tokens(s.def)"
              placeholder="Type the paragraph; put the answers in with the chips"
              (save)="saveTemplate(s.key, $event)"
              (cancel)="editing.set(null)"
            />
          } @else if (s.content || !s.tables.length) {
            <button type="button" class="nv-text pf-touch" [attr.aria-label]="'Go to the questions of ' + s.title" (click)="go(s.fieldKeys)">
              {{ s.content || '(nothing with these answers)' }}
            </button>
          }
          @for (t of s.tables; track t.fieldKey) {
            <fe-narrative-table [table]="t" [sectionTitle]="s.title" />
          }
        </article>
      }
      @for (t of looseTables(); track t.fieldKey) {
        <article class="nv-sec" [attr.data-section-table]="t.fieldKey"><fe-narrative-table [table]="t" /></article>
      }
    </section>
  `,
  styles: [
    `
      .nv {
        display: grid;
        gap: 12px;
        margin-top: 8px;
        padding-top: 18px;
        border-top: 1px solid var(--pf-line);
      }
      .nv--docked {
        margin-top: 0;
        padding-top: 0;
        border-top: 0;
        gap: 10px;
      }
      .nv--docked .nv-sec {
        padding: 10px 12px;
      }
      .nv--docked .nv-text {
        font-size: 14.5px;
        line-height: 1.55;
      }
      .nv-head {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 6px 12px;
      }
      .nv-h {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin: 0;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--text-secondary);
      }
      .nv-note {
        font-size: 13px;
        color: var(--text-tertiary);
      }
      .nv-empty {
        margin: 0;
        color: var(--text-tertiary);
      }
      .nv-sec {
        display: grid;
        gap: 6px;
        padding: 12px 14px;
        border-radius: 14px;
        background: var(--pf-chip-bg);
        border: 1px solid transparent;
      }
      .nv-sec--mine {
        border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 40%, transparent);
        background: color-mix(in srgb, var(--color-primary, #7c3aed) 6%, var(--pf-card-bg));
      }
      .nv-sec__h {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .nv-sec__t {
        margin: 0;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--text-secondary);
      }
      .nv-text {
        display: block;
        width: 100%;
        padding: 4px 0;
        border: 0;
        background: transparent;
        color: var(--text-primary);
        font: inherit;
        font-size: 15.5px;
        line-height: 1.6;
        text-align: left;
        white-space: pre-line;
        cursor: pointer;
      }
      .nv-lbl {
        display: grid;
        gap: 6px;
        font-size: 14px;
        font-weight: 600;
      }
    `,
  ],
})
export class NarrativePanelComponent {
  /** In its own card (desktop column / tab): the card's head names it, so no heading of its own. */
  readonly docked = input(false);
  protected readonly store = inject(EditorStore);
  protected readonly editing = signal<string | null>(null);

  /** Every paragraph of the form (written ones from the API; empty ones kept so their wording can be edited). */
  protected readonly sections = computed(() => {
    const d = this.store.def();
    const written = this.store.session.preview()?.sections ?? [];
    const top = this.store.session.preview()?.tables ?? [];
    const placed = new Set<NarrativeTable>();
    const sel = this.store.selectedKey();
    const defs = d?.narrative?.sections ?? [];
    const keys = new Set([...defs.map((s) => s.key), ...written.map((s) => s.key)]);
    return [...keys]
      .map((key) => {
        const def = defs.find((s) => s.key === key) ?? null;
        const w = written.find((s) => s.key === key);
        const fieldKeys = w?.fieldKeys ?? [...(def?.template ?? '').matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
        return {
          key,
          title: w?.title ?? def?.title ?? '',
          order: w?.order ?? def?.order ?? 0,
          content: w?.content ?? '',
          fieldKeys,
          mine: !!sel && fieldKeys.includes(sel),
          def,
          tables: [] as NarrativeTable[],
          w: w ?? null,
        };
      })
      .filter((s) => s.content || s.def)
      .sort((a, b) => a.order - b.order)
      .map((s) => {
        // a section's own tables, then a table whose section wrote no words (top-level, by the section's order)
        const mine = top.filter((t) => !placed.has(t) && t.order === s.order);
        mine.forEach((t) => placed.add(t));
        return { ...s, tables: [...(s.w?.tables ?? []), ...mine] };
      });
  });
  /** Tables the API could not place under a paragraph (no order). */
  protected readonly looseTables = computed(() => {
    const top = this.store.session.preview()?.tables ?? [];
    const orders = new Set(this.sections().map((s) => s.order));
    return top.filter((t) => t.order === null || !orders.has(t.order));
  });

  protected tokens(s: NarrativeSectionDef): SentenceToken[] {
    const d = this.store.def();
    if (!d) return [];
    const inSection = [...(s.template ?? '').matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
    const page = this.store.page();
    const keys = new Set([...inSection, ...(page?.fields ?? []).map((f) => f.key)]);
    return [...keys]
      .map((k) => findField(d, k))
      .filter((f): f is NonNullable<typeof f> => !!f)
      .map((f) => ({ text: `{{${f.key}}}`, label: f.label || 'a question' }));
  }

  protected rename(key: string, title: string): void {
    if (!title.trim()) return;
    this.store.edit((d) =>
      edit(d, (x) => {
        const s = x.narrative?.sections.find((y) => y.key === key);
        if (s) s.title = title.trim();
      }),
    );
  }

  protected saveTemplate(key: string, text: string): void {
    this.store.edit((d) =>
      edit(d, (x) => {
        const s = x.narrative?.sections.find((y) => y.key === key);
        if (s) s.template = text;
      }),
    );
    this.editing.set(null);
  }

  protected go(fieldKeys: string[]): void {
    const d = this.store.def();
    const first = fieldKeys.find((k) => d && locate(d, k));
    if (first) this.store.jumpTo(first);
  }
}
