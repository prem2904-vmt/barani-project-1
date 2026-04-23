import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

// Frontdesk is one continuous flow: pick a patient on the landing, open
// their history, then tap "New order". No need for a tab bar — the flow
// moves naturally by action, not by navigation.
//
// The shell is kept as a thin wrapper so /frontdesk/* stays a single
// route block in app.routes.ts (with order/billing/appointments/patients
// as children).

@Component({
  selector: 'pf-frontdesk-shell',
  standalone: true,
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<router-outlet></router-outlet>`,
  styles: [`:host { display: block; height: 100%; }`]
})
export class FrontdeskShellComponent {}
