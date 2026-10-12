import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, computed, input, output, signal, viewChild,
} from '@angular/core';
import {
  InlineMark, NoteEdit, REPORT_NOTE_MAX, cleanNote, continueList, toggleInline, toggleList,
} from '../../utils/report-note-markup';
import { ReportNoteViewComponent } from './report-note-view.component';

/**
 * The technician's report-note editor: a plain textarea + a formatting
 * toolbar (Bold, Italic, Underline, bulleted and numbered list — the Cortex
 * set) that writes the note's minimal markup, with a live preview of how it
 * prints. No contenteditable, no HTML: what is stored is text.
 *
 * Keys: Ctrl/Cmd+B / I / U format the selection; Enter in a list item
 * continues the list (on an empty item it ends it); Ctrl/Cmd+Enter saves;
 * Esc cancels. Touch: 44px targets, 16px text on phones (no iOS zoom).
 */
@Component({
  selector: 'pf-report-note-editor',
  standalone: true,
  imports: [ReportNoteViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-rne" [class.pf-rne--over]="over()">
      <div class="pf-rne__bar" role="toolbar" [attr.aria-label]="'Formatting — ' + label()">
        <button type="button" class="pf-rne__tool" (mousedown)="$event.preventDefault()" (click)="mark('bold')"
                aria-label="Bold" [title]="'Bold (' + mod + '+B)'" data-rne="bold">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 5h6a3.5 3.5 0 0 1 0 7H7z"/><path d="M7 12h7.5a3.5 3.5 0 0 1 0 7H7z"/></svg>
        </button>
        <button type="button" class="pf-rne__tool" (mousedown)="$event.preventDefault()" (click)="mark('italic')"
                aria-label="Italic" [title]="'Italic (' + mod + '+I)'" data-rne="italic">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 5h8M6 19h8M14 5l-4 14"/></svg>
        </button>
        <button type="button" class="pf-rne__tool" (mousedown)="$event.preventDefault()" (click)="mark('underline')"
                aria-label="Underline" [title]="'Underline (' + mod + '+U)'" data-rne="underline">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4v7a5 5 0 0 0 10 0V4"/><path d="M5 20h14"/></svg>
        </button>
        <span class="pf-rne__sep" aria-hidden="true"></span>
        <button type="button" class="pf-rne__tool" (mousedown)="$event.preventDefault()" (click)="list('ul')"
                aria-label="Bulleted list" title="Bulleted list" data-rne="ul">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/></svg>
        </button>
        <button type="button" class="pf-rne__tool" (mousedown)="$event.preventDefault()" (click)="list('ol')"
                aria-label="Numbered list" title="Numbered list" data-rne="ol">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 5h1.5v4"/><path d="M3.8 13.2c.4-.6 1.2-.8 1.8-.4.6.4.6 1.2 0 1.8L4 16.5h2.2"/></svg>
        </button>
        <span class="pf-rne__grow"></span>
        <span class="pf-rne__count pf-num" [class.pf-rne__count--over]="over()" aria-live="polite">{{ length() }} / {{ max() }}</span>
      </div>
      <textarea #ta class="pf-rne__ta" rows="3"
                [attr.aria-label]="label()"
                [attr.aria-invalid]="over() ? 'true' : null"
                [value]="draft()"
                placeholder="Write the note that prints on the final report"
                (input)="onInput($event)"
                (keydown)="onKey($event)"></textarea>
      @if (over()) {
        <p class="pf-rne__err" role="alert">Too long — keep it to {{ max() }} characters.</p>
      }
      @if (cleaned()) {
        <div class="pf-rne__preview" aria-label="Preview — how it prints">
          <span class="pf-rne__preview-t">Prints as</span>
          <pf-report-note-view [text]="cleaned()"></pf-report-note-view>
        </div>
      }
      <div class="pf-rne__actions">
        <button type="button" class="pf-btn pf-btn--tertiary pf-rne__btn" (click)="cancelled.emit()">Cancel</button>
        @if (initial()) {
          <button type="button" class="pf-btn pf-btn--tertiary pf-rne__btn pf-rne__remove" [disabled]="busy()"
                  (click)="saved.emit('')">Remove note</button>
        }
        <button type="button" class="pf-btn pf-btn--secondary pf-rne__btn pf-rne__save"
                [disabled]="busy() || over() || cleaned() === cleanedInitial()"
                (click)="save()">{{ busy() ? 'Saving…' : 'Save note' }}</button>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .pf-rne { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--pf-line, var(--border-muted)); border-radius: 12px; background: var(--pf-card-bg, var(--surface-elevated)); }
    .pf-rne__bar { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; }
    .pf-rne__tool { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border: 1px solid transparent; border-radius: 8px;
      background: transparent; color: var(--text-secondary); cursor: pointer; }
    .pf-rne__tool:hover { background: var(--pf-chip-bg, rgba(0,0,0,.05)); color: var(--text-primary); }
    .pf-rne__tool:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 1px; }
    .pf-rne__sep { width: 1px; height: 18px; margin: 0 4px; background: var(--pf-line, var(--border-muted)); }
    .pf-rne__grow { flex: 1 1 auto; }
    .pf-rne__count { font-size: 12px; color: var(--text-tertiary); }
    .pf-rne__count--over { color: var(--red-text, #dc2626); font-weight: 600; }
    .pf-rne__ta { width: 100%; min-height: 76px; resize: vertical; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--border-input, var(--pf-line));
      background: var(--surface-elevated, transparent); color: var(--text-primary); font: inherit; font-size: 14px; line-height: 1.45; box-sizing: border-box; }
    .pf-rne__ta:focus { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 0; border-color: transparent; }
    .pf-rne--over .pf-rne__ta { border-color: var(--red-text, #dc2626); }
    .pf-rne__err { margin: 0; font-size: 12px; color: var(--red-text, #dc2626); }
    .pf-rne__preview { padding: 8px 10px; border-radius: 10px; background: var(--pf-chip-bg, rgba(0,0,0,.04)); }
    .pf-rne__preview-t { display: block; margin-bottom: 2px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-rne__actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; flex-wrap: wrap; }
    .pf-rne__btn { min-height: 36px; }
    .pf-rne__remove { margin-right: auto; color: var(--red-text, #dc2626); }
    @media (pointer: coarse) {
      .pf-rne__tool { width: 44px; height: 44px; }
      .pf-rne__btn { min-height: 44px; }
    }
    @media (max-width: 640px) {
      .pf-rne__ta { font-size: 16px; min-height: 96px; }
    }
  `],
})
export class ReportNoteEditorComponent implements AfterViewInit {
  /** The saved note (markup). */
  readonly initial = input<string>('');
  /** Accessible name — says WHICH note ("Report note — Glucose"). */
  readonly label = input<string>('Report note');
  readonly max = input<number>(REPORT_NOTE_MAX);
  readonly busy = input<boolean>(false);
  /** Focus the textarea when shown (inline "open" affordances). */
  readonly autofocus = input<boolean>(true);

  readonly saved = output<string>();
  readonly cancelled = output<void>();

  private readonly ta = viewChild.required<ElementRef<HTMLTextAreaElement>>('ta');
  private readonly _draft = signal<string | null>(null);
  readonly draft = computed(() => this._draft() ?? this.initial() ?? '');
  readonly cleaned = computed(() => cleanNote(this.draft()));
  readonly cleanedInitial = computed(() => cleanNote(this.initial()));
  readonly length = computed(() => this.cleaned().length);
  readonly over = computed(() => this.length() > this.max());
  protected readonly mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '') ? 'Cmd' : 'Ctrl';

  ngAfterViewInit(): void {
    if (!this.autofocus()) return;
    const el = this.ta().nativeElement;
    queueMicrotask(() => { try { el.focus({ preventScroll: false }); el.setSelectionRange(el.value.length, el.value.length); } catch { /* jsdom */ } });
  }

  onInput(ev: Event): void {
    this._draft.set((ev.target as HTMLTextAreaElement).value);
  }

  mark(m: InlineMark): void {
    const el = this.ta().nativeElement;
    this.apply(toggleInline(el.value, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, m));
  }

  list(kind: 'ul' | 'ol'): void {
    const el = this.ta().nativeElement;
    this.apply(toggleList(el.value, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, kind));
  }

  onKey(ev: KeyboardEvent): void {
    const mod = ev.ctrlKey || ev.metaKey;
    if (ev.key === 'Escape') { ev.preventDefault(); this.cancelled.emit(); return; }
    if (mod && !ev.altKey && ev.key === 'Enter') { ev.preventDefault(); this.save(); return; }
    if (mod && !ev.altKey && !ev.shiftKey) {
      const k = ev.key.toLowerCase();
      const m: InlineMark | null = k === 'b' ? 'bold' : k === 'i' ? 'italic' : k === 'u' ? 'underline' : null;
      if (m) { ev.preventDefault(); this.mark(m); return; }
    }
    if (ev.key === 'Enter' && !mod && !ev.shiftKey && !ev.altKey) {
      const el = this.ta().nativeElement;
      if (el.selectionStart !== el.selectionEnd) return;
      const next = continueList(el.value, el.selectionStart ?? el.value.length);
      if (next) { ev.preventDefault(); this.apply(next); }
    }
  }

  save(): void {
    if (this.busy() || this.over() || this.cleaned() === this.cleanedInitial()) return;
    this.saved.emit(this.cleaned());
  }

  private apply(e: NoteEdit): void {
    const el = this.ta().nativeElement;
    el.value = e.text;
    this._draft.set(e.text);
    try { el.focus(); el.setSelectionRange(e.start, e.end); } catch { /* jsdom */ }
  }
}
