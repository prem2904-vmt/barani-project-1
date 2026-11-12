import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { PfIconComponent } from '../../kit';
import { PictureFieldComponent } from '../../canvas/picture-field.component';
import { KindFill, injectLegacy } from '../../fill/contract';

/**
 * drawing (legacy scribblePad, redone): a sketch on a blank sheet, a starter picture or an uploaded one, on the canvas engine: Pencil pressure, eraser, text, pins, areas when the picture has them, undo / redo, full screen without loss; a description box. The answer is the API's vector canvas value.
 */
@Component({
  selector: 'fe-drawing-fill',
  standalone: true,
  imports: [PictureFieldComponent, PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (collapsed()) {
      <!-- legacy grid cell: a small dashed "Draw" box; the sketch opens when it is tapped -->
      <div class="fe-drawcell">
        <span class="fe-drawcell__lbl">{{ field().label }}</span>
        <button type="button" class="fe-drawcell__btn" data-act="draw" [disabled]="disabled()" (click)="opened.set(true)">
          <pf-icon name="attach" [size]="18" />
          <span>Draw</span>
        </button>
      </div>
    } @else {
    <fe-picture-field
      [field]="field()"
      [value]="value()"
      [disabled]="disabled()"
      [labelId]="labelId()"
      [write$]="writer"
      [markFirst]="false"
      [photoMode]="false"
      [descriptionDefault]="true"
    />
    }
  `,
})
export class DrawingFill extends KindFill {
  private readonly legacy = injectLegacy();
  protected readonly opened = signal(false);
  /** Legacy: the sketch box was a small "Draw" cell until used; a sketch already drawn shows at once. */
  protected readonly collapsed = computed(() => this.legacy() && !this.opened() && this.value() == null);
  protected readonly writer = (v: unknown) => this.emit(v);
}
