import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FE_VOICE, HoldDirective, NarrativeTableComponent, VoiceSession, narrativeEntries } from '@prefrontal/forms-engine';
import { PfIconComponent } from '@prefrontal/forms-engine';
import { SkeletonRowsComponent } from '@prefrontal/shared';
import { CaseNarrative, NarrativeSection } from '../data/cases/case-models';

export interface SectionEditEvent {
  sectionId: string;
  text: string;
}

/**
 * The live narrative (plan §6): what the case sheet will say, section by
 * section, written by the API from the saved answers. "Edit" lets the
 * doctor change a section's words; the edit is kept apart from the
 * generated text, so when later answers change that section the card asks
 * "keep your text or take the new one?".
 */
@Component({
  selector: 'app-narrative-card',
  standalone: true,
  imports: [PfIconComponent, SkeletonRowsComponent, HoldDirective, NarrativeTableComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state() === 'offline' && !narrative()) {
      <div class="nv-note" role="status">
        <pf-icon name="cloud-off" [size]="18" />
        <p>
          The narrative is written by Prefrontal's server. It will show here when this tablet is back online — your answers
          are kept on this tablet meanwhile.
        </p>
      </div>
    } @else if (!narrative()) {
      <pf-skeleton-rows [rows]="5" label="Writing the narrative" />
    } @else {
      @if (!entries().length) {
        <div class="nv-note">
          <pf-icon name="text" [size]="18" />
          <p>As you answer, the case sheet's words appear here, section by section.</p>
        </div>
      }
      @if (state() === 'offline') {
        <p class="nv-stale" role="status">Offline — this is the narrative from your last saved answers.</p>
      }
      @for (e of entries(); track e.kind === 'section' ? e.section.id : 'table:' + e.table.fieldKey) {
        @if (e.kind === 'table') {
          <section class="nv-sec" [attr.data-section-table]="e.table.fieldKey">
            <fe-narrative-table [table]="e.table" />
          </section>
        } @else {
        @let s = e.section;
        <section
          class="nv-sec"
          [class.nv-sec--own]="s.own"
          [attr.data-section]="s.key"
          [attr.aria-labelledby]="'nv-' + s.id"
        >
          <header class="nv-sec__head">
            <div class="nv-sec__main">
            <h3 class="nv-sec__title" [id]="'nv-' + s.id">{{ s.title || 'Untitled section' }}</h3>
            @if (s.own) {
              <span class="pf-chip pf-chip--static nv-tag">Your section</span>
            } @else if (s.edited !== null && !isEditing(s.id)) {
              <span class="pf-chip pf-chip--static nv-tag">Your words</span>
            }
            </div>
            @if (!readOnly() && !isEditing(s.id)) {
              <div class="nv-sec__actions">
              <button
                type="button"
                class="pf-btn pf-btn--tertiary nv-edit nv-edit--lbl-wide"
                [attr.aria-label]="'Rename ' + (s.title || 'this section')"
                [attr.data-rename]="s.id"
                (click)="rename.emit(s)"
              >
                <pf-icon name="text" [size]="16" /><span class="nv-edit__txt">Rename</span>
              </button>
              <button
                type="button"
                class="pf-btn pf-btn--tertiary nv-edit"
                [attr.aria-label]="'Edit ' + (s.title || 'this section')"
                (click)="startEdit(s)"
              >
                <pf-icon name="pen" [size]="16" /> Edit
              </button>
              @if (s.own) {
                <button
                  type="button"
                  class="pf-btn pf-btn--tertiary nv-edit"
                  [attr.aria-label]="'Remove ' + (s.title || 'this section')"
                  (click)="remove.emit(s)"
                >
                  <pf-icon name="trash" [size]="16" />
                </button>
              }
              </div>
            }
          </header>
          @if (s.formTitle && !readOnly()) {
            <p class="nv-was">Form's title: {{ s.formTitle }}</p>
          }
          @if (s.stale && !readOnly()) {
            <div class="nv-stalebox" role="alert">
              <p>You edited this section, and the answers have changed since. Keep your words, or take the new text?</p>
              <div class="nv-actions">
                <button
                  type="button"
                  class="pf-btn pf-btn--secondary"
                  (click)="keep.emit({ sectionId: s.id, text: s.edited ?? s.content })"
                >
                  Keep mine
                </button>
                <button type="button" class="pf-btn pf-btn--tertiary" (click)="clear.emit(s.id)">
                  Take the new text
                </button>
              </div>
              <p class="nv-newtext"><span class="nv-k">New text:</span> {{ s.generated }}</p>
            </div>
          }
          @if (isEditing(s.id)) {
            <div class="nv-editrow">
              <textarea
                class="fe-text__input nv-area"
                rows="5"
                [attr.data-edit]="s.id"
                [attr.aria-label]="'Your words for ' + (s.title || 'this section')"
                [placeholder]="s.own ? 'Type or dictate this section' : ''"
                [value]="draftOf(s.id)"
                (input)="setDraft(s.id, $any($event.target).value)"
              ></textarea>
              @if (voiceOn()) {
                <button
                  type="button"
                  class="fe-iconbtn fe-mic"
                  [attr.aria-pressed]="listening() === s.id"
                  [attr.aria-label]="listening() === s.id ? 'Stop dictation' : 'Dictate into ' + (s.title || 'this section')"
                  [disabled]="busy() || (!!listening() && listening() !== s.id)"
                  (click)="toggleMic(s.id)"
                >
                  <pf-icon [name]="listening() === s.id ? 'stop' : 'mic'" [size]="22" />
                </button>
              }
            </div>
            @if (micStatus() && micFor() === s.id) {
              <p class="nv-stale" aria-live="polite">{{ micStatus() }}</p>
            }
            <div class="nv-actions">
              <button
                type="button"
                class="pf-btn pf-btn--secondary"
                [disabled]="!draftOf(s.id).trim()"
                (click)="saveEdit(s)"
              >
                Keep these words
              </button>
              <button type="button" class="pf-btn pf-btn--tertiary" (click)="cancelEdit(s.id)">Cancel</button>
              @if (s.edited !== null && !s.own) {
                <button type="button" class="pf-btn pf-btn--tertiary" (click)="cancelEdit(s.id); clear.emit(s.id)">
                  Use the generated text
                </button>
              }
            </div>
          } @else {
            @for (p of paragraphs(s.content); track $index) {
              <p class="nv-p">{{ p }}</p>
            }
          }
          <!-- a section's tables stay under its words, also while the doctor edits them -->
          @for (t of s.tables ?? []; track t.fieldKey) {
            <fe-narrative-table [table]="t" [sectionTitle]="s.title" />
          }
        </section>
        }
      }
      @if (!readOnly()) {
        <button
          type="button"
          class="pf-btn pf-btn--secondary nv-add fe-holdable"
          aria-description="Hold to start a note straight away"
          feHold
          [holdDelay]="300"
          [holdMs]="900"
          (feHold)="addNote.emit()"
          (click)="addOwn.emit()"
        >
          <pf-icon name="plus" [size]="18" /> Add a section of your own
        </button>
        <p class="nv-hint">Tip: hold this button to start a note straight away and dictate it.</p>
      }
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
      .nv-sec {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding-bottom: 16px;
        border-bottom: 1px solid var(--pf-line);
      }
      .nv-sec:last-child {
        border-bottom: 0;
      }
      .nv-sec__head {
        display: flex;
        align-items: flex-start;
        gap: 8px;
      }
      /* title (+ its tag) wraps in the space left; the controls never leave the first row, top right */
      .nv-sec__main {
        flex: 1 1 0;
        min-width: 0;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 8px;
        min-height: var(--pf-touch);
      }
      .nv-sec__actions {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      @media (max-width: 480px) {
        .nv-edit--lbl-wide .nv-edit__txt {
          display: none;
        }
      }
      .nv-sec__title {
        margin: 0;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.07em;
        text-transform: uppercase;
        color: var(--text-secondary);
      }
      .nv-spacer {
        flex: 1 1 auto;
      }
      .nv-edit {
        height: var(--pf-touch);
        padding: 0 12px;
        font-size: 14px;
      }
      .nv-tag {
        height: 24px;
        font-size: 11.5px;
      }
      .nv-p {
        margin: 0;
        font-size: 15.5px;
        line-height: 1.6;
        color: var(--text-primary);
        text-wrap: pretty;
        white-space: pre-line;
      }
      .nv-note {
        display: flex;
        gap: 10px;
        align-items: flex-start;
        color: var(--text-tertiary);
      }
      .nv-note p {
        margin: 0;
        font-size: 14px;
        line-height: 1.5;
      }
      .nv-stale {
        margin: 0;
        font-size: 13px;
        color: var(--text-tertiary);
      }
      .nv-stalebox {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 12px 14px;
        border-radius: 12px;
        border: 1px solid color-mix(in srgb, var(--color-primary, #7c3aed) 28%, var(--pf-line));
        background: var(--pf-done-tint);
      }
      .nv-stalebox p {
        margin: 0;
        font-size: 14px;
        line-height: 1.5;
        color: var(--text-primary);
      }
      .nv-newtext {
        color: var(--text-secondary) !important;
      }
      .nv-k {
        font-weight: 600;
      }
      .nv-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .nv-area {
        width: 100%;
      }
      .nv-editrow {
        display: flex;
        gap: 8px;
        align-items: flex-start;
      }
      .nv-was {
        margin: 0;
        font-size: 12.5px;
        color: var(--text-tertiary);
      }
      .nv-add {
        align-self: flex-start;
        height: var(--pf-touch);
      }
      .nv-hint {
        margin: -8px 0 0;
        font-size: 12.5px;
        color: var(--text-tertiary);
      }
    `,
  ],
})
export class NarrativeCardComponent {
  readonly narrative = input<CaseNarrative | null>(null);
  readonly state = input<string>('idle');
  readonly readOnly = input<boolean>(false);
  readonly edit = output<SectionEditEvent>();
  /** Keep the doctor's words after the answers changed (re-bases the edit). */
  readonly keep = output<SectionEditEvent>();
  /** Drop the edit: the section is written from the answers again. */
  readonly clear = output<string>();
  /** Rename a section (the page asks for the title). */
  readonly rename = output<NarrativeSection>();
  /** Add a section of the doctor's own (legacy "additional sections"). */
  readonly addOwn = output<void>();
  /** Hold "Add a section": a section titled "Note", opened for typing / dictation at once (legacy: hold the logo for a voice note). */
  readonly addNote = output<void>();
  /** Remove one of the doctor's own sections (the page asks first). */
  readonly remove = output<NarrativeSection>();
  /** A section to open for editing as soon as it appears (a section just added). */
  readonly openSection = input<string | null>(null);

  private readonly voice = inject(FE_VOICE);
  protected readonly voiceOn = computed(() => !!this.voice?.available());
  protected readonly listening = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly micStatus = signal('');
  protected readonly micFor = signal<string | null>(null);
  private session: VoiceSession | null = null;
  private opened = new Set<string>();

  /** Sections and the tables whose section wrote no words, in reading order. */
  protected readonly entries = computed(() => narrativeEntries(this.sections(), this.narrative()?.tables ?? []));
  protected readonly sections = computed<NarrativeSection[]>(() =>
    (this.narrative()?.sections ?? []).filter((s) => s.own || (s.content ?? '').trim() || s.edited !== null),
  );
  protected readonly editing = signal<Record<string, string>>({});

  constructor() {
    inject(DestroyRef).onDestroy(() => this.session?.cancel());
    effect(() => {
      const id = this.openSection();
      const s = this.sections().find((x) => x.id === id);
      if (!id || !s || this.opened.has(id)) return;
      this.opened.add(id);
      untracked(() => {
        this.startEdit(s);
        setTimeout(() => {
          const el = document.querySelector<HTMLTextAreaElement>(`[data-edit="${id.replace(/["\\]/g, '')}"]`);
          el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
          el?.focus({ preventScroll: true });
        }, 60);
      });
    });
  }

  protected isEditing(id: string): boolean {
    return id in this.editing();
  }

  protected draftOf(id: string): string {
    return this.editing()[id] ?? '';
  }

  protected async toggleMic(id: string): Promise<void> {
    if (!this.voice) return;
    if (this.listening() === id) {
      const sess = this.session;
      this.session = null;
      this.listening.set(null);
      if (!sess) return;
      this.busy.set(true);
      this.micStatus.set('Typing what you said…');
      try {
        const words = (await sess.stop()).trim();
        if (words) {
          const cur = this.draftOf(id);
          this.setDraft(id, cur && !/\s$/.test(cur) ? `${cur} ${words}` : cur + words);
        }
        this.micStatus.set(words ? '' : 'Nothing was heard. Try again a little closer to the tablet.');
      } catch {
        this.micStatus.set("Couldn't hear that. Please try again.");
      } finally {
        this.busy.set(false);
      }
      return;
    }
    this.micFor.set(id);
    try {
      this.session = await this.voice.start({ label: 'Narrative' });
      this.listening.set(id);
      this.micStatus.set('Listening… tap the mic again when you have finished.');
    } catch {
      this.micStatus.set("The microphone isn't available. Check the tablet's microphone permission.");
    }
  }

  protected paragraphs(text: string): string[] {
    return (text ?? '')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
  }

  protected startEdit(s: NarrativeSection): void {
    this.editing.update((e) => ({ ...e, [s.id]: s.content }));
  }

  protected setDraft(id: string, text: string): void {
    this.editing.update((e) => ({ ...e, [id]: text }));
  }

  protected cancelEdit(id: string): void {
    this.editing.update((e) => {
      const { [id]: _drop, ...rest } = e;
      return rest;
    });
  }

  protected saveEdit(s: NarrativeSection): void {
    const text = (this.editing()[s.id] ?? '').trim();
    if (!text) return;
    if (this.listening() === s.id) {
      this.session?.cancel();
      this.session = null;
      this.listening.set(null);
    }
    this.cancelEdit(s.id);
    if (text === s.content.trim() && s.edited === null) return;
    this.edit.emit({ sectionId: s.id, text });
  }
}
