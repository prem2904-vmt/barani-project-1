import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ReportNoteScope, ReportNotesStore } from './report-notes.store';
import { ReportNoteEditorComponent } from './report-note-editor.component';
import { ReportNoteViewComponent } from './report-note-view.component';

/**
 * ONE report-note slot (a line, a profile block, a department section or the
 * whole order) bound to the screen's {@link ReportNotesStore}: the editor
 * while open, else the saved note read-only (+ Edit while it may change),
 * else — with `showAdd` — a small "Add report note" button. Renders nothing
 * when there is nothing to show (switch off and no note, or a frozen empty
 * slot).
 */
@Component({
  selector: 'pf-report-note-slot',
  standalone: true,
  imports: [ReportNoteEditorComponent, ReportNoteViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <pf-report-note-editor [initial]="text()" [label]="'Report note — ' + label()" [max]="store.maxLength()"
                             [busy]="busy()"
                             (saved)="store.save(scope(), key(), $event)"
                             (cancelled)="store.setOpen(scope(), key(), false)"></pf-report-note-editor>
    } @else if (text()) {
      <div class="pf-rns__saved">
        <span class="pf-rns__tag">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>
          Report note
        </span>
        <pf-report-note-view class="pf-rns__text" [text]="text()"></pf-report-note-view>
        @if (canEdit()) {
          <button type="button" class="nd-btn nd-btn--tertiary pf-rns__edit" (click)="store.setOpen(scope(), key(), true)"
                  [attr.aria-label]="'Edit report note — ' + label()">Edit</button>
        }
      </div>
    } @else if (showAdd() && canEdit()) {
      <button type="button" class="nd-btn nd-btn--quiet pf-rns__add" (click)="store.setOpen(scope(), key(), true)"
              [attr.aria-label]="'Add report note — ' + label()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
        Add report note
      </button>
    }
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    :host:empty { display: none; }
    .pf-rns__saved { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; align-items: start; padding: 8px 10px;
      border-radius: 10px; border: 1px dashed var(--nd-line, var(--border-muted)); background: var(--nd-card-bg, transparent); }
    .pf-rns__tag { grid-column: 1 / -1; display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600;
      letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-rns__text { grid-column: 1; }
    .pf-rns__edit { grid-column: 2; grid-row: 2; align-self: start; min-height: 32px; }
    .pf-rns__add { min-height: 36px; font-size: 13px; }
    @media (pointer: coarse) { .pf-rns__edit, .pf-rns__add { min-height: 44px; } }
  `],
})
export class ReportNoteSlotComponent {
  protected readonly store = inject(ReportNotesStore);
  readonly scope = input.required<ReportNoteScope>();
  /** Line / profile / department id (none for the order). */
  readonly key = input<string | null>(null);
  /** What the note belongs to, for accessible names ("Glucose"). */
  readonly label = input<string>('');
  readonly showAdd = input<boolean>(false);

  readonly open = computed(() => this.store.isOpen(this.scope(), this.key()));
  readonly text = computed(() => this.store.text(this.scope(), this.key()));
  readonly canEdit = computed(() => this.store.canEdit(this.scope(), this.key()));
  readonly busy = computed(() => this.store.saving() === ReportNotesStore.key(this.scope(), this.key()));
}

/**
 * The small icon button that opens a slot's editor from a row's actions or a
 * card header ("report note" document icon; violet dot when a note exists).
 * Hidden when the slot can't be written now.
 */
@Component({
  selector: 'pf-report-note-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (canEdit()) {
      <button type="button" class="pf-rnb" [class.pf-rnb--has]="has()" [class.pf-rnb--text]="withText()"
              [attr.aria-pressed]="open()" [attr.aria-label]="(has() ? 'Edit' : 'Add') + ' report note — ' + label()"
              [title]="(has() ? 'Edit the report note' : 'Add a note that prints on the final report') + ' — ' + label()"
              [attr.data-rnb]="scope() + ':' + (key() ?? '')"
              (mousedown)="$event.preventDefault()" (click)="store.toggle(scope(), key())">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>
        @if (withText()) { <span>{{ has() ? 'Report note' : '+ Report note' }}</span> }
        @if (has()) { <span class="pf-rnb__dot" aria-hidden="true"></span> }
      </button>
    }
  `,
  styles: [`
    :host { display: inline-flex; }
    .pf-rnb { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 30px; height: 30px; padding: 0 7px;
      border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--text-tertiary); font: inherit; font-size: 13px; cursor: pointer; }
    .pf-rnb:hover { background: var(--nd-chip-bg, rgba(0,0,0,.05)); color: var(--text-primary); }
    .pf-rnb:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 1px; }
    .pf-rnb[aria-pressed='true'] { border-color: var(--nd-sel-border, var(--nd-line)); background: var(--nd-chip-bg, rgba(0,0,0,.05)); color: var(--text-primary); }
    .pf-rnb--text { border-color: var(--nd-line, var(--border-muted)); color: var(--text-secondary); height: 32px; padding: 0 10px; }
    .pf-rnb--has { color: var(--text-primary); }
    .pf-rnb__dot { position: absolute; top: 3px; right: 3px; width: 6px; height: 6px; border-radius: 50%; background: var(--color-violet-600, #7c3aed); }
    @media (pointer: coarse) { .pf-rnb { min-width: 44px; height: 44px; } }
  `],
})
export class ReportNoteButtonComponent {
  protected readonly store = inject(ReportNotesStore);
  readonly scope = input.required<ReportNoteScope>();
  readonly key = input<string | null>(null);
  readonly label = input<string>('');
  /** Show the words next to the icon (card headers). */
  readonly withText = input<boolean>(false);

  readonly canEdit = computed(() => this.store.canEdit(this.scope(), this.key()));
  readonly has = computed(() => !!this.store.text(this.scope(), this.key()).trim());
  readonly open = computed(() => this.store.isOpen(this.scope(), this.key()));
}
