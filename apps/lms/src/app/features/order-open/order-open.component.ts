import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { ProcessWorkflowService } from '../../core/services/process-workflow.service';
import { Order } from '../../shared/models/order.model';
import { SkeletonDetailComponent } from '../../shared/primitives/skeleton-kit.component';
import { patientProfilePath } from '../patient-open/patient-open.component';

/**
 * Landing for a scanned order QR (`/o/:id`). The single owner of "open an order":
 * if sample collection is enabled and the user can collect, jump straight to the
 * collection drawer for that order; otherwise — and always with `?view=detail`
 * (a shared order card) — the order's own detail in its patient's profile
 * (`?order=<id>`), or home if the order can't be loaded.
 */
@Component({
  selector: 'pf-order-open',
  standalone: true,
  imports: [SkeletonDetailComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col items-center justify-center" style="min-height: 60vh;">
      <pf-skeleton-detail [fields]="4" [sections]="2" label="Opening order…"></pf-skeleton-detail>
    </div>
  `
})
export class OrderOpenComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly process = inject(ProcessWorkflowService);

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.router.navigateByUrl('/'); return; }
    void this.open(id);
  }

  private async open(id: string) {
    // ?view=detail (a shared order card, Messages' order chip): the ORDER itself.
    const detail = this.route.snapshot.queryParamMap?.get('view') === 'detail';
    await this.process.ensureLoaded();
    // The printed order QR (bare /o/:id): collectible → the collection drawer.
    if (!detail && this.process.isEnabled('sample_collection') && this.auth.hasPermission('collect_sample')) {
      this.router.navigate(['/lab/collect'], { queryParams: { orderId: id, from: '/' } });
      return;
    }
    // Otherwise the order's detail inside its patient's profile (the profile
    // the user can open); home when the order can't be loaded.
    this.api.get<Order>(`/api/orders/${id}`).subscribe({
      next: o => {
        if (!o?.patientId) { this.router.navigateByUrl('/'); return; }
        const path = patientProfilePath(o.patientId, p => this.auth.hasAnyPermission(p));
        this.router.navigateByUrl(this.router.createUrlTree([path], { queryParams: { order: id } }), { replaceUrl: true });
      },
      error: () => this.router.navigateByUrl('/')
    });
  }
}
