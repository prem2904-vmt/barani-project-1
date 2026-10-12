import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'pf-card-body',
  standalone: true,
  host: { class: 'pf-card__body' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content />`,
})
export class PfCardBodyComponent {}
