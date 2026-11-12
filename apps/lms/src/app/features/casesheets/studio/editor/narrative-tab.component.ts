import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import {
  FieldDef,
  NarrativeSectionDef,
  PfIconComponent,
  addSection,
  allFields,
  edit,
  removeSection,
  templateKeys,
} from '@prefrontal/forms-engine';
import { DialogService } from '../../../../core/services/dialog.service';
import { EditorStore } from './editor-store';
import { FieldActions } from './field-actions';
import { NarrativePanelComponent } from './narrative-panel.component';

type Mode = 'legacy' | 'new';

/** The two sentences the Legacy / New switch shows. ONE home for the words, so the spec and the screen agree. */
export const MODE_WORDS: Record<Mode, { name: string; body: string }> = {
  legacy: {
    name: 'Legacy',
    body: 'The old app’s wording and printout, exactly as doctors know them: same sentences, same punctuation, same PDF layout.',
  },
  new: {
    name: 'New',
    body: 'The improved wording: a full stop between sentences, empty sentences left out, tables printed under the words.',
  },
};

/**
 * The legacy "Narrative Sections" tab: the sections of the printed narrative as cards (number, title, name, Edit,
 * Delete, the template as written with its {{variables}}, badges, how many fields write into it), "+ Add Section", the
 * "Template Variables" strip, and the edit box with the template and the fields linked to it. On top: the case sheet's
 * Narrative mode, Legacy or New, in plain words. Beside the cards, what the narrative writes for typical answers.
 */
@Component({
  selector: 'st-narrative-tab',
  standalone: true,
  imports: [PfIconComponent, NarrativePanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './narrative-tab.component.html',
  styleUrls: ['../shared/lg-form.scss', './narrative-tab.component.scss'],
})
export class NarrativeTabComponent {
  protected readonly store = inject(EditorStore);
  protected readonly actions = inject(FieldActions);
  private readonly dialog = inject(DialogService);

  protected readonly def = this.store.def;
  protected readonly readOnly = this.store.session.readOnly;
  protected readonly sections = computed(() => this.def()?.narrative?.sections ?? []);
  protected readonly mode = computed<Mode>(() => (this.def()?.narrative?.mode === 'legacy' ? 'legacy' : 'new'));
  protected readonly words = MODE_WORDS;
  protected readonly modes: Mode[] = ['legacy', 'new'];
  protected readonly allVars = signal(false);

  /** Every field a template can name, with its key ("{{pain}}"). */
  protected readonly variables = computed<FieldDef[]>(() => {
    const d = this.def();
    return d ? allFields(d) : [];
  });
  protected readonly shownVars = computed(() => (this.allVars() ? this.variables() : this.variables().slice(0, 12)));

  protected setMode(m: Mode): void {
    if (this.readOnly() || m === this.mode()) return;
    this.store.edit((d) => edit(d, (x) => ((x.narrative ??= { sections: [] }).mode = m)));
  }

  /** The fields that write into a section: it names them in `says.sections`, or its template holds their `{{key}}`. */
  protected linked(s: NarrativeSectionDef): FieldDef[] {
    const inTemplate = new Set(templateKeys(s.template));
    return this.variables().filter((f) => f.says?.sections?.some((r) => r.section === s.key) || inTemplate.has(f.key));
  }

  protected badges(s: NarrativeSectionDef): string[] {
    const out: string[] = [];
    const layout = (s['layout'] as { displayType?: string } | undefined)?.displayType;
    if (layout && layout !== 'paragraph') out.push(layout);
    if (s['headerColor']) out.push('Colour');
    const sort = s['sorting'] as { enabled?: boolean; sortBy?: string } | undefined;
    if (sort?.enabled) out.push(`Sorted by ${sort.sortBy ?? 'duration'}`);
    return out;
  }

  // ---------------- add / delete / order ----------------

  protected async add(): Promise<void> {
    const title = await this.dialog.prompt({ title: 'Add Narrative Section', placeholder: 'e.g., HISTORY OF PRESENT ILLNESS', confirmLabel: 'Add Section', required: true });
    if (!title?.trim()) return;
    this.store.edit((d) => addSection(d, title.trim()));
  }

  protected async remove(s: NarrativeSectionDef): Promise<void> {
    const n = this.linked(s).length;
    const ok = await this.dialog.confirm({
      title: `Delete the section “${s.title}”?`,
      message: n ? `${n} field${n === 1 ? '' : 's'} write into it. They stay on their pages but are no longer in the narrative until you pick a section for them.` : 'No field writes into it.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (ok) this.store.edit((d) => removeSection(d, s.key));
  }

  protected grip(e: PointerEvent, i: number): void {
    this.actions.drag.start(e, 'sections', i);
  }

  // ---------------- the edit box ----------------

  protected readonly editing = signal<string | null>(null);
  protected readonly draftTitle = signal('');
  protected readonly draftTemplate = signal('');
  protected readonly box = viewChild<ElementRef<HTMLTextAreaElement>>('tplBox');
  protected readonly editSection = computed(() => this.sections().find((s) => s.key === this.editing()) ?? null);
  protected readonly editLinked = computed(() => {
    const s = this.editSection();
    return s ? this.linked({ ...s, template: this.draftTemplate() }) : [];
  });

  protected openEdit(s: NarrativeSectionDef): void {
    this.draftTitle.set(s.title);
    this.draftTemplate.set(s.template ?? '');
    this.editing.set(s.key);
  }

  protected insertVar(key: string): void {
    const el = this.box()?.nativeElement;
    const text = `{{${key}}}`;
    const cur = this.draftTemplate();
    if (!el) {
      this.draftTemplate.set(`${cur}${cur && !cur.endsWith(' ') ? ' ' : ''}${text}`);
      return;
    }
    const a = el.selectionStart ?? cur.length;
    const b = el.selectionEnd ?? cur.length;
    const next = cur.slice(0, a) + text + cur.slice(b);
    this.draftTemplate.set(next);
    queueMicrotask(() => {
      el.focus();
      el.setSelectionRange(a + text.length, a + text.length);
    });
  }

  protected async copyVar(key: string): Promise<void> {
    try {
      await navigator.clipboard?.writeText(`{{${key}}}`);
    } catch {
      /* the chip still reads as the text to copy */
    }
  }

  protected saveEdit(): void {
    const key = this.editing();
    const title = this.draftTitle().trim();
    if (!key || !title) return;
    const template = this.draftTemplate();
    this.store.edit((d) =>
      edit(d, (x) => {
        const s = x.narrative?.sections.find((y) => y.key === key);
        if (!s) return;
        s.title = title;
        s.template = template;
      }),
    );
    this.editing.set(null);
  }

  protected toggleSort(s: NarrativeSectionDef): void {
    const on = !(s['sorting'] as { enabled?: boolean } | undefined)?.enabled;
    this.store.edit((d) =>
      edit(d, (x) => {
        const y = x.narrative?.sections.find((z) => z.key === s.key);
        if (y) y['sorting'] = on ? { enabled: true, sortBy: 'duration', sortOrder: 'desc' } : { enabled: false };
      }),
    );
  }

  protected sortingOn(s: NarrativeSectionDef): boolean {
    return !!(s['sorting'] as { enabled?: boolean } | undefined)?.enabled;
  }
}
