import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ApplyFieldChange } from '../../build/contract';
import { PicturePanelComponent } from '../../canvas/picture-panel.component';
import { FieldDef } from '../../core/types';

/** Studio panel for `bodyMap`: a picture (no blank sheet), its areas and its fixed tap markers. */
@Component({
  selector: 'fe-bodymap-panel',
  standalone: true,
  imports: [PicturePanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<fe-picture-panel [field]="field()" [apply]="apply()" [allowBlank]="false" [allowMarkers]="true" />`,
})
export class BodyMapPanelComponent {
  readonly field = input.required<FieldDef>();
  readonly apply = input.required<ApplyFieldChange>();
}
