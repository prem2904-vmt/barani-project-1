import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { FeDialog, PfIconComponent } from '../kit';
import { feId } from '../fill/contract';
import { CanvasPin, MAX_NOTE, MAX_PIN_LABEL } from './canvas-model';

/**
 * One pin's card (legacy imageInfo's marker sheet, now inline under the
 * picture, never a modal): what it is (the form's quick picks as chips, or
 * typed), a short note ("4 cm"), and Remove. The narrative names a pin by the
 * area it sits on ("Tender at abdomen (2 cm)").
 */
@Component({
  selector: 'fe-pin-panel',
  standalone: true,
  imports: [PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="fe-pin-panel" [attr.data-pin-panel]="pin().n" [attr.aria-labelledby]="titleId">
      <header class="fe-pin-panel__head">
        <span class="fe-pin-panel__n" aria-hidden="true">{{ pin().n }}</span>
        <span class="fe-pin-panel__title" [id]="titleId">
          Pin {{ pin().n }}
          @if (where()) {
            <span class="fe-pin-panel__where">on {{ where() }}</span>
          }
        </span>
        @if (!disabled()) {
          <button type="button" class="fe-iconbtn" [attr.aria-label]="'Remove pin ' + pin().n" (click)="askRemove()">
            <pf-icon name="trash" [size]="20" />
          </button>
        }
        <button type="button" class="fe-iconbtn" aria-label="Close the pin" (click)="closed.emit()">
          <pf-icon name="x" [size]="20" />
        </button>
      </header>
      @if (picks().length && !disabled()) {
        <div class="fe-chips" role="radiogroup" aria-label="What is here">
          @for (c of picks(); track c) {
            <button
              type="button"
              class="fe-chip"
              role="radio"
              [attr.aria-checked]="pin().label === c"
              (click)="setLabel(pin().label === c ? '' : c)"
            >
              <span class="fe-chip__check"><pf-icon name="check" [size]="16" [stroke]="2.4" /></span>
              {{ c }}
            </button>
          }
        </div>
      }
      <div class="fe-pin-panel__row">
        <label class="fe-sub">
          <span class="fe-sub__lbl">What is here</span>
          <input
            class="fe-text__input"
            type="text"
            data-pin-label
            [value]="pin().label ?? ''"
            [attr.maxlength]="maxLabel"
            placeholder="e.g. Scar, swelling"
            [disabled]="disabled()"
            (change)="setLabel($any($event.target).value)"
          />
        </label>
        <label class="fe-sub">
          <span class="fe-sub__lbl">Note</span>
          <input
            class="fe-text__input"
            type="text"
            data-pin-note
            [value]="pin().note ?? ''"
            [attr.maxlength]="maxNote"
            placeholder="e.g. 4 cm, tender"
            [disabled]="disabled()"
            (change)="setNote($any($event.target).value)"
          />
        </label>
      </div>
    </section>
  `,
})
export class PinPanelComponent {
  private readonly dialog = inject(FeDialog);

  readonly pin = input.required<CanvasPin>();
  /** The form's quick picks for a pin (`config.pinLabels`). */
  readonly picks = input<readonly string[]>([]);
  /** The area it sits on, in words. */
  readonly where = input<string | null>(null);
  readonly disabled = input(false);

  readonly changed = output<Partial<CanvasPin>>();
  readonly removed = output<void>();
  readonly closed = output<void>();

  protected readonly titleId = feId('fe-pin');
  protected readonly maxLabel = MAX_PIN_LABEL;
  protected readonly maxNote = MAX_NOTE;

  protected setLabel(text: string): void {
    const label = text.trim().slice(0, MAX_PIN_LABEL);
    this.changed.emit({ label: label || undefined });
  }

  protected setNote(text: string): void {
    const note = text.trim().slice(0, MAX_NOTE);
    this.changed.emit({ note: note || undefined });
  }

  protected async askRemove(): Promise<void> {
    const p = this.pin();
    if (p.label || p.note) {
      const ok = await this.dialog.confirm({
        title: `Remove pin ${p.n}?`,
        message: 'What you wrote on it goes too.',
        confirmLabel: 'Remove',
        cancelLabel: 'Keep',
        tone: 'danger',
      });
      if (!ok) return;
    }
    this.removed.emit();
  }
}
