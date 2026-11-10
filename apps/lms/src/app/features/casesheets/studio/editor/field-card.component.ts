import { ChangeDetectionStrategy, Component, computed, forwardRef, inject, input } from '@angular/core';
import {
  FieldDef,
  FieldHostComponent,
  ShowWhenDef,
  describeShowWhen,
  ifNoneOf,
  isKnownKind,
  kindBuild,
  lookupIn,
  sectionKeyOf,
  updateField,
  updateOption,
  writeInto,
  setLabel,
} from '@prefrontal/forms-engine';
import { IconName, PfIconComponent } from '@prefrontal/forms-engine';
import { PfSelectOption, SelectComponent } from '@prefrontal/shared';
import { ConditionsComponent } from '../shared/conditions.component';
import { SentenceComponent } from '../shared/sentence.component';
import { AutofocusDirective } from '../shared/autofocus.directive';
import { deskSignal, isMac } from '../shared/desk';
import { tip } from '../shared/shortcuts';
import { EditorStore } from './editor-store';
import { FieldActions } from './field-actions';
import { PaletteComponent } from './palette.component';

/**
 * One question as a card, written where the doctor sees it: the question as
 * it looks on the tablet, then what it SAYS, what it says if NONE / NO,
 * WHEN it shows and which paragraph it WRITES INTO. Every line is edited in
 * place (tap it). Follow-up questions of the chosen options show under it.
 */
@Component({
  selector: 'st-field-card',
  standalone: true,
  imports: [
    PfIconComponent,
    SelectComponent,
    FieldHostComponent,
    SentenceComponent,
    ConditionsComponent,
    PaletteComponent,
    AutofocusDirective,
    forwardRef(() => FieldCardComponent),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './field-card.component.html',
  styleUrl: './field-card.component.scss',
})
export class FieldCardComponent {
  readonly field = input.required<FieldDef>();
  readonly index = input(0);
  readonly count = input(1);
  /** The drag list this card belongs to ("page", "opt:<field>:<option>"). */
  readonly list = input('page');
  readonly nested = input(false);
  readonly dragOffset = input(0);
  readonly dragging = input(false);
  readonly gripDown = input<(e: PointerEvent) => void>(() => undefined);
  readonly gripKey = input<(e: KeyboardEvent) => void>(() => undefined);

  protected readonly store = inject(EditorStore);
  protected readonly actions = inject(FieldActions);

  protected readonly build = computed(() => kindBuild(this.field().kind));
  protected readonly icon = computed(() => this.build().icon as IconName);
  protected readonly known = computed(() => isKnownKind(this.field().kind));
  protected readonly selected = computed(() => this.store.selectedKey() === this.field().key);
  protected readonly picked = computed(() => this.store.picked().has(this.field().key));
  protected readonly picking = computed(() => this.store.picked().size > 0);
  protected readonly desk = deskSignal();
  private static readonly mac = isMac();
  protected readonly tips = {
    up: tip('moveUp', 'Move up', FieldCardComponent.mac),
    down: tip('moveDown', 'Move down', FieldCardComponent.mac),
    dup: tip('duplicate', 'Make a copy', FieldCardComponent.mac),
    rm: tip('remove', 'Remove (undo is right there)', FieldCardComponent.mac),
  };
  protected readonly flashing = computed(() => this.store.flash() === this.field().key);
  protected readonly problems = computed(() => this.store.problemsByField().get(this.field().key) ?? []);
  protected readonly hasError = computed(() => this.problems().some((p) => p.severity === 'error'));
  protected readonly ifNone = computed(() => ifNoneOf(this.field()));
  protected readonly options = computed(() => this.field().options ?? []);

  /** The doctor's view uses the sample answers; it is a picture, not a control (inert). */
  protected readonly scope = computed(() => this.store.answers());
  protected readonly lookup = computed(() => lookupIn(this.store.answers()));
  protected readonly noop = () => undefined;

  protected readonly showWhenWords = computed(() => {
    const d = this.store.def();
    return d ? describeShowWhen(d, this.field().showWhen) : '';
  });

  protected readonly writesInto = computed(() => {
    const d = this.store.def();
    return d ? (sectionKeyOf(d, this.field()) ?? '') : '';
  });
  protected readonly sectionOptions = computed<PfSelectOption<string>[]>(() => [
    ...(this.store.def()?.narrative?.sections ?? []).map((s) => ({ value: s.key, label: s.title || 'Untitled paragraph' })),
    { value: '', label: 'Not in the narrative' },
  ]);

  /** Says: the field's sentence; a yes / no question says its "Yes" words; a tick box its "ticked" words. */
  protected readonly saysMode = computed<'sentence' | 'firstOption' | 'whenTrue' | 'none'>(() => {
    const ifNone = this.ifNone();
    if (ifNone === 'whenFalse') return 'whenTrue';
    if (ifNone === 'noOption') return 'firstOption';
    if (!this.known()) return 'none';
    return 'sentence';
  });
  protected readonly saysLabel = computed(() => {
    switch (this.saysMode()) {
      case 'firstOption':
        return `If ${this.options()[0]?.label ?? 'Yes'}, says`;
      case 'whenTrue':
        return 'If ticked, says';
      default:
        return 'Says';
    }
  });
  protected readonly saysTokens = computed(() =>
    this.saysMode() === 'sentence' ? (this.build().sentenceTokens ?? [{ text: '{value}', label: 'the answer' }]) : [],
  );
  protected readonly saysValue = computed(() => {
    const f = this.field();
    switch (this.saysMode()) {
      case 'firstOption':
        return f.options?.[0]?.says ?? '';
      case 'whenTrue':
        return f.says?.whenTrue ?? '';
      default:
        return f.says?.sentence ?? '';
    }
  });
  protected readonly ifNoneLabel = computed(() => {
    switch (this.ifNone()) {
      case 'negativeHistory':
        return 'If none ticked';
      case 'noOption':
        return `If ${this.options()[1]?.label ?? 'No'}, says`;
      case 'whenFalse':
        return 'If not ticked, says';
      default:
        return '';
    }
  });
  protected readonly ifNoneValue = computed(() => {
    const f = this.field();
    if (this.ifNone() === 'noOption') return f.options?.[1]?.says ?? '';
    if (this.ifNone() === 'whenFalse') return f.says?.whenFalse ?? '';
    return '';
  });
  protected readonly negative = computed(() => this.field().says?.negativeHistory ?? { enabled: false, prefix: 'Denies' });

  /** Choice-style questions list what each choice says (when the sentence is the wrapper). */
  protected readonly optionWords = computed(() =>
    this.saysMode() === 'sentence' ? this.options().map((o) => ({ key: o.key, label: o.label, says: o.says ?? '' })) : [],
  );

  /** Follow-ups show under the selected question (and while one of them is selected). */
  protected readonly expanded = computed(() => {
    const owner = this.store.expandedOwner();
    if (owner === this.field().key) return true;
    const d = this.store.def();
    const sel = this.store.selectedKey();
    if (!d || !sel) return false;
    return JSON.stringify(this.field().options ?? []).includes(`"key":"${sel}"`);
  });
  protected readonly followUps = computed(() => this.options().filter((o) => (o.subFields ?? []).length));

  // ---------------- edits ----------------

  protected pick(e: Event): void {
    const t = e.target as HTMLElement;
    if (t.closest('button, input, textarea, pf-select, st-conditions, st-palette, a, [role="radio"]')) return;
    // a click inside a follow-up card is that card's own
    if (t.closest('st-field-card') !== (e.currentTarget as HTMLElement).closest('st-field-card')) return;
    const m = e as MouseEvent;
    if (this.desk() && !this.nested()) {
      if (m.metaKey || m.ctrlKey) {
        this.store.togglePick(this.field().key);
        return;
      }
      if (m.shiftKey) {
        this.store.pickRange(this.field().key);
        return;
      }
    }
    this.store.select(this.field().key, true);
  }

  /** Shift / ⌘-click picks questions; it must not select the page's text too. */
  protected noTextSelect(e: MouseEvent): void {
    if (this.desk() && (e.shiftKey || e.metaKey || e.ctrlKey) && !(e.target as HTMLElement).closest('input, textarea')) e.preventDefault();
  }

  /** Double-click the card (desktop): rename it in place. */
  protected rename2(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    if (!this.desk() || t.closest('button, input, textarea, pf-select, st-conditions, st-palette, a')) return;
    if (t.closest('st-field-card') !== (e.currentTarget as HTMLElement).closest('st-field-card')) return;
    this.store.open(this.field().key, 'label');
  }

  /** The questions a quick action works on: the whole selection when this card is in it, else this one. */
  private targets(): string[] {
    return this.picked() ? this.store.selection() : [this.field().key];
  }

  protected move(dir: -1 | 1): void {
    this.actions.moveMany(this.targets(), dir);
  }

  protected duplicate(): void {
    this.actions.duplicateMany(this.targets());
  }

  protected remove(): void {
    this.actions.removeMany(this.targets());
  }

  protected rename(label: string): void {
    const v = label.trim();
    const wasEditing = this.store.isEditing(this.field().key, 'label');
    if (v) this.store.edit((d) => setLabel(d, this.field().key, v));
    this.store.editing.set(null);
    // the keyboard carries on from the card (↑ ↓, Enter again)
    if (wasEditing && this.desk()) this.store.focusCard(this.field().key);
  }

  protected saveSays(text: string): void {
    const key = this.field().key;
    const mode = this.saysMode();
    this.store.edit((d) => {
      if (mode === 'firstOption') {
        const o = this.options()[0];
        return o ? updateOption(d, key, o.key, (x) => (x.says = text || undefined)) : d;
      }
      return updateField(d, key, (f) => {
        f.says ??= { include: true };
        if (mode === 'whenTrue') f.says.whenTrue = text || undefined;
        else f.says.sentence = text || undefined;
      });
    });
    this.store.editing.set(null);
  }

  protected saveIfNone(text: string): void {
    const key = this.field().key;
    this.store.edit((d) => {
      if (this.ifNone() === 'noOption') {
        const o = this.options()[1];
        return o ? updateOption(d, key, o.key, (x) => (x.says = text || undefined)) : d;
      }
      return updateField(d, key, (f) => {
        f.says ??= { include: true };
        f.says.whenFalse = text || undefined;
      });
    });
    this.store.editing.set(null);
  }

  protected setNegative(enabled: boolean, prefix?: string): void {
    this.store.edit((d) =>
      updateField(d, this.field().key, (f) => {
        f.says ??= { include: true };
        f.says.negativeHistory = { enabled, prefix: (prefix ?? f.says.negativeHistory?.prefix ?? 'Denies').trim() || 'Denies' };
      }),
    );
  }

  protected setShowWhen(sw: ShowWhenDef | null): void {
    this.store.edit((d) => updateField(d, this.field().key, (f) => (f.showWhen = sw)));
  }

  protected setSection(key: string): void {
    this.store.edit((d) => writeInto(d, this.field().key, key || null));
  }

  protected addFollowUp(optionKey: string): void {
    this.store.paletteAt.set({ option: { fieldKey: this.field().key, optionKey } });
  }

  protected isPaletteFor(optionKey: string): boolean {
    const p = this.store.paletteAt();
    return !!p?.option && p.option.fieldKey === this.field().key && p.option.optionKey === optionKey;
  }

  /** A long press on touch opens the card's menu (the same menu as ⋯). */
  protected readonly menuLater = () => void this.actions.menu(this.field().key);

  // drag rows among the follow-ups of one option
  protected subGripFor(optionKey: string, i: number): (e: PointerEvent) => void {
    return (e) => this.actions.drag.start(e, `opt:${this.field().key}:${optionKey}`, i);
  }
  protected subKeyFor(optionKey: string, i: number, n: number): (e: KeyboardEvent) => void {
    return (e) => this.actions.drag.keyMove(e, `opt:${this.field().key}:${optionKey}`, i, n);
  }
}
