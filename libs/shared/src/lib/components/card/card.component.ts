import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Shared card surface. Compose with PfCardHeader/Body/Footer for the ND layout. */
@Component({
  selector: 'pf-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section class="pf-card"><ng-content /></section>`,
  styles: [':host { display: contents; }'],
})
export class PfCardComponent {}
