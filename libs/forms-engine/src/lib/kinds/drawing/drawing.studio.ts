import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ApplyFieldChange } from '../../build/contract';
import { PicturePanelComponent } from '../../canvas/picture-panel.component';
import { FieldDef } from '../../core/types';

/** Studio panel for `drawing`: any picture, a blank sheet allowed, areas on it. */
@Component({
  selector: 'fe-drawing-panel',
  standalone: true,
  imports: [PicturePanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<fe-picture-panel [field]="field()" [apply]="apply()" />`,
})
export class DrawingPanelComponent {
  readonly field = input.required<FieldDef>();
  readonly apply = input.required<ApplyFieldChange>();
}
