import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { PfIconComponent } from '../../kit';
import { KindFill } from '../../fill/contract';
import { FieldHostComponent } from '../../fill/field-host.component';
import { FieldDef } from '../../core/types';
import { PairSide, innerOf, onlySide, sideLabels, sideOrder, sideValue, withSide } from './side-pair-model';

/**
 * sidePair ("Left and right"): ONE question asked for both sides, side by side. Each side is the inner question's own
 * control in a quiet card named by the side (Right / Left, RE / LE, R ear / L ear). The answer is { right, left }, each
 * holding whatever the inner kind stores. Wide: two columns; narrow (a phone): the sides stack. When one side is
 * answered, "Same on both sides" copies it across.
 */
@Component({
  selector: 'fe-side-pair-fill',
  standalone: true,
  imports: [FieldHostComponent, PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
        container-type: inline-size;
      }
      .fe-pair {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .fe-pair__cols {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 12px;
      }
      @container (min-width: 480px) {
        .fe-pair__cols {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      .fe-pair__side {
        min-width: 0;
      }
      .fe-pair__same {
        align-self: flex-start;
      }
      .fe-pair__empty {
        margin: 0;
        font-size: 13px;
        color: var(--text-tertiary);
      }
    `,
  ],
  template: `
    <div class="fe-pair" role="group" [attr.aria-labelledby]="labelId()">
      @if (inner()) {
        <div class="fe-pair__cols">
          @for (s of sides(); track s.key) {
            <div class="fe-row fe-pair__side" role="group" [attr.aria-label]="s.label" [attr.data-side]="s.key">
              <fe-field
                [field]="sideFields()[s.key]"
                [scope]="scopes()[s.key]"
                [lookup]="lookup()"
                [setValue]="setters[s.key]"
                [lockedKeys]="disabled() ? lockAll() : noKeys"
              />
            </div>
          }
        </div>
        @if (copyFrom(); as from) {
          <button type="button" class="pf-btn pf-btn--secondary fe-pair__same" data-same [disabled]="disabled()" (click)="copy(from)">
            <pf-icon name="copy" [size]="18" />
            Same on both sides
          </button>
        }
      } @else {
        <p class="fe-pair__empty">This question has nothing to ask for each side yet.</p>
      }
    </div>
  `,
})
export class SidePairFill extends KindFill {
  protected readonly noKeys: ReadonlySet<string> = new Set();
  protected readonly inner = computed(() => innerOf(this.field()));
  protected readonly sides = computed(() => {
    const w = sideLabels(this.config());
    return sideOrder(this.config()).map((key) => ({ key, label: w[key] }));
  });
  protected readonly lockAll = computed(() => new Set(this.inner() ? [this.inner()!.key] : []));

  /** The inner question, named by its side (the label IS the side), with no hint / required mark of its own. */
  protected readonly sideFields = computed<Record<PairSide, FieldDef>>(() => {
    const child = this.inner();
    const w = sideLabels(this.config());
    const make = (label: string): FieldDef => ({ ...(child as FieldDef), label, helper: undefined, required: false, showWhen: null, width: undefined });
    return { right: make(w.right), left: make(w.left) };
  });

  /** The answers each side's question reads (stable between changes, so the inner field is not rebuilt on every check). */
  protected readonly scopes = computed<Record<PairSide, Record<string, unknown>>>(() => {
    const child = this.inner();
    const make = (side: PairSide) => (child ? { [child.key]: sideValue(this.value(), side) } : {});
    return { right: make('right'), left: make('left') };
  });

  protected readonly setters: Record<PairSide, (key: string, v: unknown) => void> = {
    right: (_k, v) => this.emit(withSide(this.value(), 'right', v)),
    left: (_k, v) => this.emit(withSide(this.value(), 'left', v)),
  };

  protected readonly copyFrom = computed(() => onlySide(this.value()));

  protected copy(from: PairSide): void {
    const to: PairSide = from === 'right' ? 'left' : 'right';
    this.emit(withSide(this.value(), to, structuredClone(sideValue(this.value(), from))));
  }
}
