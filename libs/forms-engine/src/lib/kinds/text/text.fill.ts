import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FeDialog, PfIconComponent } from '../../kit';
import { FE_SUGGESTIONS, FE_VOICE, FieldSuggestion, KindFill, VoiceSession, feId, injectLegacy } from '../../fill/contract';
import { HoldDirective } from '../../fill/hold.directive';

/** How many chips sit above the box (legacy: top 5). */
export const SUGGESTION_CHIPS = 5;
/** Typing pause before the matching suggestions are looked up. */
export const SUGGESTION_DEBOUNCE_MS = 180;
/** Hold a suggestion this long to see all of it / remove it (legacy chip: 300 ms, row: 500 ms). */
export const SUGGESTION_HOLD_MS = 450;

/**
 * text: one line or a note that grows with its text (never a second
 * scroller). Phone / e-mail formats bring the right keyboard. A note (multi-line)
 * has a small mic inside its box (legacy voice-text): tap to start, tap to stop;
 * the words are APPENDED, never replacing what is there. One-line boxes have no
 * mic (legacy). No mic when dictation is not set up.
 *
 * Suggestions (legacy `enableSuggestions`, resident-fe `text-input.ts`): the
 * doctor's own most-used wording for this field as chips above the box — a
 * tap uses one (a note appends it, a line replaces it), a HOLD shows all of
 * it with "Use this" / "Remove from my suggestions". While typing on one
 * line, matching suggestions show under the box (↑ ↓ Enter Esc). They are
 * learned by the API when a sheet is finished; nothing is sent while typing
 * except the search.
 */
@Component({
  selector: 'fe-text-fill',
  standalone: true,
  imports: [PfIconComponent, HoldDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (chipsShown()) {
      <div class="fe-sugg" role="group" [attr.aria-label]="'Your usual words for ' + field().label">
        @for (s of chips(); track s.id) {
          <button
            type="button"
            class="fe-chip fe-sugg__chip"
            feHold
            [holdDelay]="holdMs"
            [attr.data-suggestion]="s.text"
            [attr.aria-label]="'Use: ' + s.text + '. Hold for more.'"
            [disabled]="disabled()"
            (feHold)="holdSuggestion(s)"
            (click)="use(s)"
          >
            {{ s.text }}
          </button>
        }
      </div>
    }
    <div class="fe-text" [class.fe-text--mic]="showMic()">
      @if (multiline()) {
        <textarea
          #box
          class="fe-text__input"
          [id]="inputId"
          rows="3"
          [attr.aria-labelledby]="labelId()"
          [attr.aria-describedby]="statusId"
          [attr.aria-invalid]="problem() ? 'true' : null"
          [placeholder]="field().placeholder ?? ''"
          [value]="text()"
          [disabled]="disabled()"
          [attr.maxlength]="maxLength()"
          (input)="typed($any($event.target).value)"
          (blur)="touched.set(true)"
        ></textarea>
      } @else {
        <input
          #box
          class="fe-text__input"
          [id]="inputId"
          [type]="inputType()"
          [attr.inputmode]="inputMode()"
          autocomplete="off"
          [attr.role]="canSuggest() ? 'combobox' : null"
          [attr.aria-autocomplete]="canSuggest() ? 'list' : null"
          [attr.aria-expanded]="canSuggest() ? matchesShown() : null"
          [attr.aria-controls]="canSuggest() ? listId : null"
          [attr.aria-activedescendant]="matchesShown() && active() >= 0 ? listId + '-' + active() : null"
          [attr.aria-labelledby]="labelId()"
          [attr.aria-describedby]="statusId"
          [attr.aria-invalid]="problem() ? 'true' : null"
          [placeholder]="field().placeholder ?? ''"
          [value]="text()"
          [disabled]="disabled()"
          [attr.maxlength]="maxLength()"
          (input)="typed($any($event.target).value)"
          (focus)="focused.set(true)"
          (blur)="blurred()"
          (keydown)="onKey($event)"
        />
      }
      @if (showMic()) {
        <button
          type="button"
          class="fe-iconbtn fe-mic fe-mic--inline"
          [attr.aria-pressed]="listening()"
          [attr.aria-label]="listening() ? 'Stop dictation' : 'Dictate ' + field().label"
          [disabled]="disabled() || busy()"
          (click)="toggleMic()"
        >
          <pf-icon [name]="listening() ? 'stop' : 'mic'" [size]="22" />
          @if (legacy()) {
            <span class="fe-mic__word">{{ listening() ? 'Stop' : 'Listen' }}</span>
          }
        </button>
      }
    </div>
    @if (matchesShown()) {
      <div class="fe-sugg-list" role="listbox" [id]="listId" [attr.aria-label]="'Your earlier words for ' + field().label">
        @for (m of matches(); track m.id; let i = $index) {
          <button
            type="button"
            role="option"
            class="fe-sugg__row pf-touch"
            tabindex="-1"
            feHold
            [holdDelay]="holdMs"
            [id]="listId + '-' + i"
            [attr.aria-selected]="i === active()"
            (pointerdown)="keepOpen = true"
            (feHold)="holdSuggestion(m)"
            (click)="use(m)"
          >
            <pf-icon name="history" [size]="16" />
            <span>{{ m.text }}</span>
          </button>
        }
      </div>
    }
    @if (status() || problem()) {
      <p class="fe-field__hint" [class.fe-field__err]="!status() && !!problem()" [id]="statusId" aria-live="polite">
        {{ status() || problem() }}
      </p>
    }
  `,
})
export class TextFill extends KindFill {
  private readonly voice = inject(FE_VOICE);
  /** The old app's voice note showed a labelled Listen button. */
  protected readonly legacy = injectLegacy();
  private readonly source = inject(FE_SUGGESTIONS);
  private readonly dialog = inject(FeDialog);
  private readonly box = viewChild<ElementRef<HTMLInputElement | HTMLTextAreaElement>>('box');
  protected readonly inputId = feId('fe-text');
  protected readonly statusId = feId('fe-text-status');
  protected readonly listId = feId('fe-text-sugg');
  protected readonly holdMs = SUGGESTION_HOLD_MS;

  protected readonly multiline = computed(() => this.config()['multiline'] === true);
  protected readonly format = computed(() => (this.config()['format'] as string) ?? 'plain');
  protected readonly inputType = computed(() =>
    this.format() === 'phone' ? 'tel' : this.format() === 'email' ? 'email' : 'text',
  );
  protected readonly inputMode = computed(() =>
    this.format() === 'phone' ? 'tel' : this.format() === 'email' ? 'email' : null,
  );
  protected readonly maxLength = computed(() => (this.config()['maxLength'] as number) ?? null);
  protected readonly text = computed(() => (typeof this.value() === 'string' ? (this.value() as string) : ''));

  /** Legacy text boxes had no mic (voice was the PF logo's voice note); only a note (legacy voice-text) keeps a
   *  small mic INSIDE its box, never a separate button beside every field. */
  protected readonly showMic = computed(
    () =>
      !!this.voice &&
      this.voice.available() &&
      this.config()['voice'] !== false &&
      this.format() === 'plain' &&
      this.multiline(),
  );
  protected readonly listening = signal(false);
  protected readonly busy = signal(false);
  protected readonly status = signal('');
  protected readonly touched = signal(false);
  private session: VoiceSession | null = null;

  // ---- suggestions ----
  /** Suggestions are on for plain text unless the form turned them off (never phone / e-mail). */
  protected readonly canSuggest = computed(
    () => !!this.source && this.config()['suggestions'] !== false && this.format() === 'plain',
  );
  private readonly top = signal<FieldSuggestion[]>([]);
  protected readonly matches = signal<FieldSuggestion[]>([]);
  protected readonly focused = signal(false);
  protected readonly active = signal(-1);
  protected keepOpen = false;
  private lookupTimer: ReturnType<typeof setTimeout> | null = null;
  private lookupSeq = 0;

  /** Chips: the top wording, minus what is already in the box; a single line shows them while it is empty. */
  protected readonly chips = computed(() => {
    const cur = this.text().trim().toLowerCase();
    return this.top()
      .filter((s) => s.text.trim().toLowerCase() !== cur)
      .slice(0, SUGGESTION_CHIPS);
  });
  protected readonly chipsShown = computed(
    () => this.canSuggest() && this.chips().length > 0 && (this.multiline() || !this.text().trim()),
  );
  protected readonly matchesShown = computed(
    () => this.canSuggest() && !this.multiline() && this.focused() && this.matches().length > 0,
  );

  // ---- limits (legacy validation.minLength / pattern / errorMessage), shown after the box is left, never blocking ----
  protected readonly problem = computed(() => {
    const t = this.text().trim();
    if (!t || !this.touched()) return '';
    const own = (this.config()['errorMessage'] as string) || '';
    const min = this.config()['minLength'] as number | undefined;
    if (min && t.length < min) return own || `At least ${min} characters.`;
    const pattern = this.config()['pattern'] as string | undefined;
    if (pattern) {
      try {
        if (!new RegExp(`^(?:${pattern})$`).test(t)) return own || "This doesn't look right. Please check it.";
      } catch {
        /* a broken pattern from an old form never blocks the doctor */
      }
    }
    return '';
  });

  constructor() {
    super();
    inject(DestroyRef).onDestroy(() => {
      this.session?.cancel();
      if (this.lookupTimer) clearTimeout(this.lookupTimer);
    });
    // the top suggestions for this field, once per field
    effect(() => {
      const key = this.field().key;
      if (!this.canSuggest()) return;
      untracked(() => void this.loadTop(key));
    });
  }

  private async loadTop(key: string): Promise<void> {
    try {
      this.top.set(await this.source!.list(key));
    } catch {
      this.top.set([]); // offline / not reachable: no chips, never an error on a case sheet
    }
  }

  protected typed(v: string): void {
    this.emit(v === '' ? undefined : v);
    this.active.set(-1);
    if (!this.canSuggest() || this.multiline()) return;
    if (this.lookupTimer) clearTimeout(this.lookupTimer);
    const q = v.trim();
    if (!q) {
      this.matches.set([]);
      return;
    }
    const seq = ++this.lookupSeq;
    this.lookupTimer = setTimeout(async () => {
      try {
        const found = await this.source!.list(this.field().key, q);
        if (seq !== this.lookupSeq) return;
        this.matches.set(
          found.filter((s) => s.text.trim().toLowerCase() !== q.toLowerCase()).slice(0, SUGGESTION_CHIPS),
        );
      } catch {
        this.matches.set([]);
      }
    }, SUGGESTION_DEBOUNCE_MS);
  }

  protected blurred(): void {
    this.touched.set(true);
    // a tap on a suggestion row blurs the box first; let the tap land
    setTimeout(() => {
      if (this.keepOpen) {
        this.keepOpen = false;
        return;
      }
      this.focused.set(false);
      this.active.set(-1);
    }, 150);
  }

  protected onKey(e: KeyboardEvent): void {
    if (!this.matchesShown()) return;
    const n = this.matches().length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.active.set((this.active() + 1) % n);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.active.set(this.active() <= 0 ? n - 1 : this.active() - 1);
    } else if (e.key === 'Enter' && this.active() >= 0) {
      e.preventDefault();
      this.use(this.matches()[this.active()]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.matches.set([]);
      this.active.set(-1);
    }
  }

  /** A note gets the words added (legacy voice-text chips appended); a single line takes them. */
  protected use(s: FieldSuggestion): void {
    if (this.disabled()) return;
    this.keepOpen = false;
    this.matches.set([]);
    this.active.set(-1);
    if (this.multiline()) this.append(s.text);
    else this.emit(s.text);
  }

  /** Hold: see all of it; use it, or forget it. */
  protected async holdSuggestion(s: FieldSuggestion): Promise<void> {
    this.keepOpen = false;
    const r = await this.dialog.actions({
      title: 'Your earlier words',
      message: s.text,
      cancelLabel: 'Close',
      actions: [
        { value: 'remove', label: 'Remove from my suggestions', variant: 'secondary' },
        { value: 'use', label: 'Use this', variant: 'primary' },
      ],
    });
    if (r.action === 'use') this.use(s);
    if (r.action === 'remove') {
      this.top.update((list) => list.filter((x) => x.id !== s.id));
      this.matches.update((list) => list.filter((x) => x.id !== s.id));
      try {
        await this.source!.remove(this.field().key, s.id);
      } catch {
        /* reloaded below either way */
      }
      void this.loadTop(this.field().key);
    }
  }

  // ---- dictation ----
  protected async toggleMic(): Promise<void> {
    if (!this.voice) return;
    if (this.listening()) return this.stop();
    try {
      this.session = await this.voice.start({ label: this.field().label });
      this.listening.set(true);
      this.status.set('Listening… tap the mic again when you have finished.');
    } catch {
      this.status.set("The microphone isn't available. Check the tablet's microphone permission.");
    }
  }

  private async stop(): Promise<void> {
    const s = this.session;
    this.session = null;
    this.listening.set(false);
    if (!s) return;
    this.busy.set(true);
    this.status.set('Typing what you said…');
    try {
      const words = (await s.stop()).trim();
      if (words) this.append(words);
      this.status.set(words ? '' : 'Nothing was heard. Try again a little closer to the tablet.');
    } catch {
      this.status.set("Couldn't hear that. Please try again.");
    } finally {
      this.busy.set(false);
    }
  }

  /** Insert at the cursor (or at the end), with a space where needed. */
  private append(words: string): void {
    const el = this.box()?.nativeElement;
    const cur = this.text();
    const focused = !!el && typeof document !== 'undefined' && document.activeElement === el;
    const at = focused && el!.selectionStart !== null ? el!.selectionStart : cur.length;
    const before = cur.slice(0, at);
    const after = cur.slice(at);
    const pad = before && !/\s$/.test(before) ? ' ' : '';
    const padAfter = after && !/^\s/.test(after) ? ' ' : '';
    this.emit(before + pad + words + padAfter + after);
  }
}
