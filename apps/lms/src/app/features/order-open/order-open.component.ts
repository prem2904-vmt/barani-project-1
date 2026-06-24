import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { ProcessWorkflowService } from '../../core/services/process-workflow.service';
import { Order } from '../../shared/models/order.model';
import { LoadingLogoComponent } from '../../shared/components/loading-logo/loading-logo.component';

/**
 * Landing for a scanned order QR (`/o/:id`). The single owner of "open an order":
 * if sample collection is enabled and the user can collect, jump straight to the
 * collection drawer for that order; otherwise fall back to the patient profile
 * (or home if the order can't be loaded).
 */
@Component({
  selector: 'pf-order-open',
  standalone: true,
  imports: [LoadingLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col items-center justify-center" style="min-height: 60vh;">
      <pf-loading-logo size="xl" color="purple" [showDna]="true" [showText]="true" text="Opening order…"></pf-loading-logo>
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
    await this.process.ensureLoaded();
    // Collectible → collection drawer for this order.
    if (this.process.isEnabled('sample_collection') && this.auth.hasPermission('collect_sample')) {
      this.router.navigate(['/lab/collect'], { queryParams: { orderId: id, from: '/' } });
      return;
    }
    // Otherwise open the patient's profile (which lists this order), if we can
    // load the order; else go home.
    this.api.get<Order>(`/api/orders/${id}`).subscribe({
      next: o => {
        if (o?.patientId) this.router.navigate(['/frontdesk/patients', o.patientId]);
        else this.router.navigateByUrl('/');
      },
      error: () => this.router.navigateByUrl('/')
    });
  }
}
