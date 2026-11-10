import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PictureFieldComponent } from '../../canvas/picture-field.component';
import { KindFill } from '../../fill/contract';

/**
 * drawing (legacy scribblePad, redone): a sketch on a blank sheet, a starter picture or an uploaded one, on the canvas engine: Pencil pressure, eraser, text, pins, areas when the picture has them, undo / redo, full screen without loss; a description box. The answer is the API's vector canvas value.
 */
@Component({
  selector: 'fe-drawing-fill',
  standalone: true,
  imports: [PictureFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
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
  `,
})
export class DrawingFill extends KindFill {
  protected readonly writer = (v: unknown) => this.emit(v);
}
