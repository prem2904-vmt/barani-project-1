import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SkeletonDetailComponent } from '../../shared/primitives/skeleton-kit.component';

/**
 * Landing for a scanned patient ID-card QR (`/p/:id`). Mirrors OrderOpenComponent
 * (`/o/:id`): the ID card's QR encodes this route, so scanning it — with the
 * in-app scanner OR a phone camera — lands here and forwards to the patient's
 * profile. Kept as its own route so the QR value is a clean, stable URL.
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

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    this.router.navigateByUrl(id ? `/frontdesk/patients/${id}` : '/', { replaceUrl: true });
  }
}
