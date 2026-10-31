import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { FRONTDESK_PERMS } from '../../core/auth/route-access';
import { SkeletonDetailComponent } from '../../shared/primitives/skeleton-kit.component';

/** The patient-profile path THIS user can open: the front-desk one for the
 *  front desk, the read-only `/patients/:id` for everyone else (lab techs and
 *  pathologists hold view_patient, never the front-desk set). */
export function patientProfilePath(id: string, hasAny: (perms: string[]) => boolean): string {
  return hasAny(FRONTDESK_PERMS) ? `/frontdesk/patients/${id}` : `/patients/${id}`;
}

/**
 * Landing for a scanned patient ID-card QR (`/p/:id`) and a shared patient
 * card. Mirrors OrderOpenComponent (`/o/:id`): the ID card's QR encodes this
 * route, so scanning it — with the in-app scanner OR a phone camera — lands
 * here and forwards to the patient's profile the user can open (query params
 * such as ?order=<id> ride along).
 */
@Component({
  selector: 'pf-patient-open',
  standalone: true,
  imports: [SkeletonDetailComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col items-center justify-center" style="min-height: 60vh;">
      <pf-skeleton-detail [fields]="6" [sections]="2" label="Opening patient…"></pf-skeleton-detail>
    </div>
  `
})
export class PatientOpenComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.router.navigateByUrl('/', { replaceUrl: true }); return; }
    const qp = this.route.snapshot.queryParams ?? {};
    const path = patientProfilePath(id, p => this.auth.hasAnyPermission(p));
    this.router.navigateByUrl(this.router.createUrlTree([path], { queryParams: qp }), { replaceUrl: true });
  }
}
