import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { BarcodeDisplayComponent } from '../../../shared/components/barcode-display/barcode-display.component';
import { Order } from '../../../shared/models/order.model';

@Component({
  selector: 'pf-post-payment',
  standalone: true,
  imports: [BarcodeDisplayComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-8 max-w-5xl">
      <header class="mb-6 text-center">
        <div class="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 text-3xl mb-3">
          ✓
        </div>
        <h1 class="text-2xl font-semibold">Payment collected</h1>
        @if (order(); as o) {
          <p class="text-sm text-slate-600 mt-1">
            {{ o.patient?.name }} · {{ o.samples.length }} {{ o.samples.length === 1 ? 'sample' : 'samples' }} to collect
          </p>
        }
      </header>

      @if (order(); as o) {
        <div class="space-y-3">
          @for (s of o.samples; track s.id) {
            <div class="pf-card">
              <div class="flex items-start justify-between gap-4">
                <div class="flex-1 min-w-0">
                  <p class="text-xs uppercase tracking-wider text-slate-500">{{ s.department?.name ?? 'Sample' }}</p>
                  <ul class="mt-1 text-sm flex flex-wrap gap-x-4 gap-y-1">
                    @for (t of s.tests; track t.id) {
                      <li>• {{ t.test?.name ?? 'Test' }}</li>
                    }
                  </ul>
                </div>
                <pf-barcode-display [code]="s.barcode ?? ''"></pf-barcode-display>
              </div>
              <div class="mt-3 flex justify-end gap-2">
                <button class="pf-btn pf-btn-ghost text-xs" (click)="printOne(s.id)">Print label</button>
              </div>
            </div>
          }
        </div>

        <div class="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div class="flex gap-2">
            <button class="pf-btn pf-btn-ghost" (click)="printAll()">Print all labels</button>
            <button class="pf-btn pf-btn-ghost" (click)="sendWhatsApp()" [disabled]="waSent()">
              {{ waSent() ? '✓ WhatsApp sent' : 'Send WhatsApp confirmation' }}
            </button>
          </div>
          <button class="pf-btn pf-btn-primary" (click)="back()">Back to reception</button>
        </div>
      } @else {
        <div class="pf-card text-sm text-slate-500">Loading…</div>
      }
    </section>
  `,
  styles: [`
    @media print {
      .pf-btn, header { display: none; }
    }
  `]
})
export class PostPaymentComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly _order = signal<Order | null>(null);
  readonly order = this._order.asReadonly();
  readonly waSent = signal(false);

  ngOnInit() {
    const id = this.route.snapshot.queryParamMap.get('orderId');
    if (!id) { this.router.navigateByUrl('/reception'); return; }
    this.api.get<Order>(`/api/orders/${id}`).subscribe({
      next: o => this._order.set(o),
      error: () => this.toasts.error('Could not load order')
    });
  }

  printOne(_sampleId: string) {
    window.print();
  }
  printAll() {
    window.print();
  }
  sendWhatsApp() {
    // No WhatsApp integration yet — acknowledge locally.
    this.waSent.set(true);
    this.toasts.success('Confirmation queued (demo)');
  }
  back() { this.router.navigateByUrl('/reception'); }
}
