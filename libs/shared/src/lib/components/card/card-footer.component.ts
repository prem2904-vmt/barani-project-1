import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'pf-card-footer',
  standalone: true,
  host: { class: 'pf-card__foot' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content />`,
})
export class PfCardFooterComponent {}
