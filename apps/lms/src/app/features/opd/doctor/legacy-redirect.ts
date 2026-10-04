import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';

/**
 * RETIRED legacy OPD screens (Agent C, OPD dark build). The pre-dark Doctor
 * queue (`/doctor`) and Consult Room (`/doctor/consult/:id`, keyed by the old
 * `opd_consults` row) are superseded by `/opd/consult` (my patients) and
 * `/opd/consult/:visitId` (the full-screen consult on opd_visits +
 * opd_consult_records). Their routes stay (gated by opdGuard) so old links
 * land somewhere sensible: both redirect to `/opd/consult`. The legacy row
 * has no visit id, so a deep link cannot map to a new consult.
 * INTEGRATOR: drop the two routes + this folder once nothing links to them.
 */
@Component({
  selector: 'pf-opd-legacy-redirect',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class OpdLegacyRedirectComponent implements OnInit {
  private readonly router = inject(Router);
  ngOnInit() { this.router.navigateByUrl('/opd/consult', { replaceUrl: true }); }
}
