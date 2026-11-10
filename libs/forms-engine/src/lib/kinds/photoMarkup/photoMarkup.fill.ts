import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PictureFieldComponent } from '../../canvas/picture-field.component';
import { KindFill } from '../../fill/contract';

/**
 * photoMarkup: one photo taken on the spot (camera or library, as the form allows), shrunk on the device and uploaded to this case sheet, then marked up with the pen, pins and text on the canvas engine; a description box.
 */
@Component({
  selector: 'fe-photomarkup-fill',
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
      [photoMode]="true"
      [descriptionDefault]="true"
    />
  `,
})
export class PhotoMarkupFill extends KindFill {
  protected readonly writer = (v: unknown) => this.emit(v);
}
