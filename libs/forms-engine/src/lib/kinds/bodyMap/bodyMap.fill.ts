import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PictureFieldComponent } from '../../canvas/picture-field.component';
import { KindFill } from '../../fill/contract';

/**
 * bodyMap (legacy imageInfo, redone): a body (face, eye, teeth…) picture whose areas the doctor taps to mark, each with a short note; the form's fixed markers (each one of the field's options, so their follow-up questions open under the field); numbered pins; a little ink and text when the form allows it.
 */
@Component({
  selector: 'fe-bodymap-fill',
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
      [markFirst]="true"
      [photoMode]="false"
      [descriptionDefault]="false"
    />
  `,
})
export class BodyMapFill extends KindFill {
  protected readonly writer = (v: unknown) => this.emit(v);
}
