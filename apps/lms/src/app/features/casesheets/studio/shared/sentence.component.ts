import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, input, output, signal, viewChild } from '@angular/core';
import { PfIconComponent } from '@prefrontal/forms-engine';

export interface SentenceToken {
  /** What is put in the text ("{value}", "{{pain}}"). */
  text: string;
  /** How it reads on screen ("the answer", "Pain"). */
  label: string;
}

/**
 * A sentence the doctor reads and edits in place: "The patient reports
 * ‹the answer›." Placeholders show as soft chips, never as {braces}. Tap
 * to edit: a text box with "Insert ‹the answer›" chips under it; Done / Cancel.
 */
@Component({
  selector: 'st-sentence',
  standalone: true,
  imports: [PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (editing()) {
      <div class="sn-edit">
        <textarea
          #boxEl
          class="pf-input sn-box"
          rows="2"
          [attr.aria-label]="label()"
          [placeholder]="placeholder()"
          [value]="draft()"
          (input)="draft.set($any($event.target).value)"
          (keydown.escape)="cancel.emit()"
          (keydown.enter)="onEnter($event)"
        ></textarea>
        @if (tokens().length) {
          <div class="sn-insert" role="group" aria-label="Put in">
            <span class="sn-insert__k">Put in</span>
            @for (t of tokens(); track t.text) {
              <button type="button" class="sn-tok-btn pf-touch" (click)="insert(t.text)">
                <pf-icon name="plus" [size]="14" /> {{ t.label }}
              </button>
            }
          </div>
        }
        <div class="sn-actions">
          <button type="button" class="pf-btn pf-btn--tertiary" (click)="cancel.emit()">Cancel</button>
          <button type="button" class="pf-btn pf-btn--secondary" (click)="save.emit(draft().trim())">
            <pf-icon name="check" [size]="18" /> Done
          </button>
        </div>
      </div>
    } @else {
      <button type="button" class="sn-read pf-touch" [attr.aria-label]="label() + ': ' + (plain() || empty())" (click)="open.emit()">
        @if (parts().length) {
          <span class="sn-text">
            @for (p of parts(); track $index) {
              @if (p.token) {
                <span class="sn-tok">{{ p.text }}</span>
              } @else {
                <span>{{ p.text }}</span>
              }
            }
          </span>
        } @else {
          <span class="sn-empty">{{ empty() }}</span>
        }
        <pf-icon class="sn-pen" name="pen" [size]="16" />
      </button>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .sn-read {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        min-height: var(--pf-touch);
        padding: 8px 12px;
        border: 1px dashed transparent;
        border-radius: 10px;
        background: transparent;
        color: var(--text-primary);
        font: inherit;
        font-size: 15px;
        line-height: 1.45;
        text-align: left;
        cursor: text;
      }
      .sn-read:hover,
      .sn-read:focus-visible {
        border-color: var(--pf-line);
        background: var(--pf-chip-bg);
      }
      .sn-text {
        flex: 1 1 auto;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .sn-tok {
        display: inline-block;
        margin: 0 2px;
        padding: 0 8px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--color-primary, #7c3aed) 12%, transparent);
        color: var(--violet-text, #6d28d9);
        font-size: 13.5px;
        font-weight: 600;
        line-height: 1.6;
      }
      .sn-empty {
        flex: 1 1 auto;
        color: var(--text-tertiary);
        font-style: italic;
      }
      .sn-pen {
        flex: none;
        color: var(--text-tertiary);
      }
      .sn-edit {
        display: grid;
        gap: 10px;
      }
      .sn-box {
        width: 100%;
        min-height: 72px;
        padding: 10px 12px;
        resize: vertical;
        line-height: 1.45;
      }
      .sn-insert {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }
      .sn-insert__k {
        font-size: 13px;
        color: var(--text-tertiary);
      }
      .sn-tok-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 0 14px;
        border-radius: 999px;
        border: 1px solid color-mix(in srgb, var(--color-primary, #7c3aed) 30%, transparent);
        background: color-mix(in srgb, var(--color-primary, #7c3aed) 8%, transparent);
        color: var(--violet-text, #6d28d9);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
      }
      .sn-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
    `,
  ],
})
export class SentenceComponent {
  readonly value = input<string | null | undefined>('');
  readonly label = input('Says');
  readonly placeholder = input('Type what it writes');
  readonly empty = input('Writes nothing yet. Tap to write it.');
  readonly editing = input(false);
  readonly tokens = input<SentenceToken[]>([{ text: '{value}', label: 'the answer' }]);
  /** Tap on the sentence. */
  readonly open = output<void>();
  readonly save = output<string>();
  readonly cancel = output<void>();

  protected readonly draft = signal('');
  private readonly boxEl = viewChild<ElementRef<HTMLTextAreaElement>>('boxEl');

  constructor() {
    effect(() => {
      if (this.editing()) {
        this.draft.set(this.value() ?? '');
        setTimeout(() => this.boxEl()?.nativeElement.focus());
      }
    });
  }

  protected readonly parts = computed(() => splitTokens(this.value() ?? '', this.tokens()));
  protected readonly plain = computed(() => this.parts().map((p) => p.text).join(''));

  protected insert(text: string): void {
    const el = this.boxEl()?.nativeElement;
    const cur = this.draft();
    const at = el ? el.selectionStart ?? cur.length : cur.length;
    const end = el ? el.selectionEnd ?? at : at;
    const pad = at > 0 && !/\s$/.test(cur.slice(0, at)) ? ' ' : '';
    const next = cur.slice(0, at) + pad + text + cur.slice(end);
    this.draft.set(next);
    setTimeout(() => {
      el?.focus();
      const pos = at + pad.length + text.length;
      el?.setSelectionRange(pos, pos);
    });
  }

  protected onEnter(e: Event): void {
    const k = e as KeyboardEvent;
    if (k.shiftKey) return;
    k.preventDefault();
    this.save.emit(this.draft().trim());
  }
}

/** "The patient reports {value}." → text and token parts (tokens read as their labels). */
export function splitTokens(text: string, tokens: SentenceToken[]): { text: string; token: boolean }[] {
  if (!text) return [];
  const out: { text: string; token: boolean }[] = [];
  const re = /(\{value\}|\{unit\}|\{\{\w+\}\})/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index), token: false });
    const t = tokens.find((x) => x.text === m[0]);
    out.push({ text: t?.label ?? (m[0] === '{value}' ? 'the answer' : m[0] === '{unit}' ? 'the unit' : m[0].slice(2, -2)), token: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), token: false });
  return out;
}
