import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'pf-card-header',
  standalone: true,
  host: { class: 'pf-card__head' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content />`,
})
export class PfCardHeaderComponent {}
