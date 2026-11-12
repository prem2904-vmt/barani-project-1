import { Injectable, inject, signal } from '@angular/core';
import {
  FieldDef,
  duplicateField,
  findField,
  locate,
  moveField,
  moveFieldToPage,
  moveOption,
  movePage,
  moveSection,
  removeField,
} from '@prefrontal/forms-engine';
import { DialogService } from '../../../../core/services/dialog.service';
import { StudioApi } from '../data/studio-api';
import { plainError } from '../data/studio-models';
import { DragReorder, LongPress } from '../shared/drag-reorder';
import { EditorStore } from './editor-store';

/** How long "Removed … Undo" stays on screen. */
export const UNDO_OFFER_MS = 8000;

/**
 * The actions a question card offers — by its ⋯ button, by a long press on
 * touch, and by dragging its grip: move up / down / to another page,
 * duplicate, save as a saved question, remove (asked first). One place, so
 * the menu, the long press and the keyboard all do the same thing.
 */
@Injectable()
export class FieldActions {
  private readonly store = inject(EditorStore);
  private readonly dialog = inject(DialogService);
  private readonly api = inject(StudioApi);

  readonly notice = signal<string | null>(null);
  /** "Removed “Pain”." with an Undo button (a remove by key or the hover × asks nothing; undo is the safety). */
  readonly undoable = signal<string | null>(null);
  private undoTimer: ReturnType<typeof setTimeout> | null = null;
  readonly longPress = new LongPress();

  /** Show "… Undo" for a while. */
  private offerUndo(words: string): void {
    this.undoable.set(words);
    if (this.undoTimer) clearTimeout(this.undoTimer);
    this.undoTimer = setTimeout(() => this.undoable.set(null), UNDO_OFFER_MS);
  }

  undoLast(): void {
    this.store.session.undo();
    this.undoable.set(null);
  }

  // ---------------- many at once (desktop multi-select; one undo step each) ----------------

  /** Remove the questions at once, no question asked: the Undo bar is the way back. */
  removeMany(keys: string[]): void {
    const d = this.store.def();
    if (!d || !keys.length) return;
    const labels = keys.map((k) => findField(d, k)?.label || 'Untitled question');
    // the selection moves to the question after the last removed one (or before the first)
    const pageKeys = this.store.pageKeys();
    const after = pageKeys.slice(pageKeys.indexOf(keys[keys.length - 1]) + 1).find((k) => !keys.includes(k));
    const before = [...pageKeys.slice(0, Math.max(0, pageKeys.indexOf(keys[0])))].reverse().find((k) => !keys.includes(k));
    this.store.edit((x) => keys.reduce((acc, k) => (findField(acc, k) ? removeField(acc, k) : acc), x));
    this.store.select(after ?? before ?? null);
    this.offerUndo(keys.length === 1 ? `Removed “${labels[0]}”.` : `Removed ${keys.length} questions.`);
  }

  /** Copies go right under each original; the copies become the selection. */
  duplicateMany(keys: string[]): string[] {
    if (!keys.length) return [];
    const copies: string[] = [];
    this.store.edit((x) =>
      keys.reduce((acc, k) => {
        if (!findField(acc, k)) return acc;
        const r = duplicateField(acc, k);
        copies.push(r.key);
        return r.def;
      }, x),
    );
    if (copies.length === 1) this.store.jumpTo(copies[0]);
    else if (copies.length) {
      this.store.select(copies[0]);
      this.store.picked.set(new Set(copies));
    }
    return copies;
  }

  /** Move the block one place up / down (a block already at the edge stays). */
  moveMany(keys: string[], dir: -1 | 1): void {
    const d = this.store.def();
    if (!d || !keys.length) return;
    const locs = keys.map((k) => locate(d, k)).filter((l): l is NonNullable<typeof l> => !!l);
    if (!locs.length) return;
    const idx = locs.map((l) => l.index).sort((a, b) => a - b);
    if (dir < 0 && idx[0] === 0) return;
    if (dir > 0 && idx[idx.length - 1] >= locs[0].list.length - 1) return;
    const order = [...keys].sort((a, b) => (locate(d, a)!.index - locate(d, b)!.index) * -dir);
    this.store.edit((x) => order.reduce((acc, k) => moveField(acc, k, locate(acc, k)!.index + dir), x));
    this.store.focusCard(keys[0]);
  }

  async moveManyToPage(keys: string[]): Promise<void> {
    const d = this.store.def();
    const page = this.store.page();
    if (!d || !page || !keys.length) return;
    const to = await this.dialog.choose({
      title: keys.length === 1 ? `Move “${findField(d, keys[0])?.label || 'this question'}” to` : `Move ${keys.length} questions to`,
      choices: d.pages.filter((p) => p.key !== page.key).map((p) => ({ value: p.key, label: p.title })),
      confirmLabel: 'Move',
      cancelLabel: 'Keep them here',
    });
    if (to) this.moveToPageNow(keys, to);
  }

  /** Drop on a page in the PAGES list, or the "Move to" menu: the questions go to the end of that page. */
  moveToPageNow(keys: string[], pageKey: string): void {
    const d = this.store.def();
    if (!d) return;
    const movable = keys.filter((k) => {
      const l = locate(d, k);
      return l && !l.ownerOption && !l.parentGroup && l.page.key !== pageKey;
    });
    if (!movable.length) return;
    this.store.edit((x) => movable.reduce((acc, k) => moveFieldToPage(acc, k, pageKey), x));
    this.store.selectPage(pageKey);
    this.store.select(movable[0]);
    if (movable.length > 1) this.store.picked.set(new Set(movable));
    const title = d.pages.find((p) => p.key === pageKey)?.title ?? 'the page';
    this.offerUndo(movable.length === 1 ? `Moved to “${title}”.` : `Moved ${movable.length} questions to “${title}”.`);
  }

  /** Lists: "page" (the page's questions), "pages", "opt:<field>:<option>" (follow-ups), "options:<field>" (choices). */
  readonly drag = new DragReorder(
    (list, from, to) => this.reorder(list, from, to),
    (list, from, pageKey) => {
      const f = list === 'page' ? this.store.page()?.fields[from] : undefined;
      if (f) this.moveToPageNow(this.store.isPicked(f.key) ? this.store.selection() : [f.key], pageKey);
    },
  );

  reorder(list: string, from: number, to: number): void {
    const d = this.store.def();
    if (!d) return;
    if (list === 'pages') {
      this.store.edit((x) => movePage(x, from, to));
      return;
    }
    if (list === 'sections') {
      this.store.edit((x) => moveSection(x, from, to));
      return;
    }
    if (list.startsWith('options:')) {
      const fieldKey = list.slice('options:'.length);
      this.store.edit((x) => moveOption(x, fieldKey, from, to));
      return;
    }
    let field: FieldDef | undefined;
    if (list === 'page') field = this.store.page()?.fields[from];
    else if (list.startsWith('opt:')) {
      const [, fk, ok] = list.split(':');
      field = findField(d, fk)?.options?.find((o) => o.key === ok)?.subFields?.[from];
    }
    if (field) this.store.edit((x) => moveField(x, field!.key, to));
  }

  async menu(key: string): Promise<void> {
    const d = this.store.def();
    const loc = d ? locate(d, key) : null;
    if (!d || !loc) return;
    this.store.select(key);
    const choices = [
      ...(loc.index > 0 ? [{ value: 'up', label: 'Move up' }] : []),
      ...(loc.index < loc.list.length - 1 ? [{ value: 'down', label: 'Move down' }] : []),
      ...(!loc.ownerOption && !loc.parentGroup && d.pages.length > 1 ? [{ value: 'page', label: 'Move to another page' }] : []),
      { value: 'dup', label: 'Make a copy', hint: 'Right under this one' },
      { value: 'save', label: 'Save as a saved question', hint: 'Use it again in any case sheet' },
      { value: 'remove', label: 'Remove this question' },
    ];
    const pick = await this.dialog.choose({
      title: loc.field.label || 'This question',
      choices,
      confirmLabel: 'Do it',
      cancelLabel: 'Close',
    });
    if (!pick) return;
    if (pick === 'up') this.store.edit((x) => moveField(x, key, loc.index - 1));
    else if (pick === 'down') this.store.edit((x) => moveField(x, key, loc.index + 1));
    else if (pick === 'page') await this.moveToPage(key);
    else if (pick === 'dup') this.duplicate(key);
    else if (pick === 'save') await this.saveAsTemplate(key);
    else if (pick === 'remove') await this.remove(key);
  }

  async moveToPage(key: string): Promise<void> {
    const d = this.store.def();
    const loc = d ? locate(d, key) : null;
    if (!d || !loc) return;
    const to = await this.dialog.choose({
      title: `Move “${loc.field.label}” to`,
      choices: d.pages.filter((p) => p.key !== loc.page.key).map((p) => ({ value: p.key, label: p.title })),
      confirmLabel: 'Move',
      cancelLabel: 'Keep it here',
    });
    if (!to) return;
    this.store.edit((x) => moveFieldToPage(x, key, to));
    this.store.jumpTo(key);
  }

  duplicate(key: string): void {
    let copy = '';
    this.store.edit((x) => {
      const r = duplicateField(x, key);
      copy = r.key;
      return r.def;
    });
    if (copy) this.store.jumpTo(copy, null, 'label');
  }

  async remove(key: string): Promise<void> {
    const f = this.store.def() ? findField(this.store.def()!, key) : null;
    if (!f) return;
    const ok = await this.dialog.confirm({
      title: `Remove “${f.label || 'this question'}”?`,
      message: 'Its sentence and any “show when” that used it go too. You can undo this.',
      confirmLabel: 'Remove',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (!ok) return;
    this.store.edit((x) => removeField(x, key));
    if (this.store.selectedKey() === key) this.store.select(null);
  }

  async saveAsTemplate(key: string): Promise<void> {
    const f = this.store.def() ? findField(this.store.def()!, key) : null;
    if (!f) return;
    const title = await this.dialog.prompt({
      title: 'Save as a saved question',
      message: 'Owners and admins can then add it to any case sheet from “Add a question”.',
      initialValue: f.label,
      placeholder: 'Name',
      confirmLabel: 'Save',
      required: true,
    });
    if (!title) return;
    try {
      await this.api.saveTemplate('field', title, f);
      this.notice.set(`Saved “${title}”. It is under “Saved questions” when you add a question.`);
    } catch (e) {
      this.notice.set(plainError(e, "Couldn't save it just now."));
    }
  }
}
