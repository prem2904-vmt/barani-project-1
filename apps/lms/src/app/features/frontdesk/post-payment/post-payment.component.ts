import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { BarcodeDisplayComponent } from '../../../shared/components/barcode-display/barcode-display.component';
import { Order } from '../../../shared/models/order.model';
import { SkeletonComponent } from '../../../shared/primitives/skeleton.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

@Component({
  selector: 'pf-post-payment',
  standalone: true,
  imports: [
    BarcodeDisplayComponent,
    SkeletonComponent,
    TileComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10">

      <!-- Success hero -->
      <pf-tile tone="emerald" padding="xl" class="block mb-6">
        <div class="flex flex-col items-center text-center py-2">
          <span class="success-pulse" aria-hidden="true">
            <span class="success-ring"></span>
            <span class="success-check">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="m5 12 4 4L19 6"/>
              </svg>
            </span>
          </span>

          <h1 class="text-[26px] md:text-[30px] font-semibold leading-tight mt-5"
              style="color: var(--text-primary);">
            Payment collected
          </h1>
          @if (order(); as o) {
            <p class="text-[14px] mt-2"
               style="color: var(--text-secondary);">
              {{ o.patient?.displayName }} · {{ o.samples.length }} {{ o.samples.length === 1 ? 'sample' : 'samples' }} to collect
            </p>
          }
        </div>
      </pf-tile>

      @if (order(); as o) {
        <div class="flex items-center gap-2 mb-3 px-1">
          <span class="text-[11px] font-mono uppercase tracking-[0.16em]"
                style="color: var(--text-muted);">Sample labels</span>
          <span class="text-[11px] font-mono"
                style="color: var(--text-muted);">· {{ o.samples.length }}</span>
        </div>

        <div class="space-y-2.5">
          @for (s of o.samples; track s.id) {
            <pf-tile tone="default" padding="md">
              <div class="flex items-start gap-4 flex-wrap md:flex-nowrap">
                <div class="flex-1 min-w-0">
                  <p class="text-[11px] font-mono uppercase tracking-[0.16em]"
                     style="color: var(--text-muted);">
                    {{ s.department?.name ?? 'Sample' }}
                  </p>
                  <ul class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[13px]"
                      style="color: var(--text-secondary);">
                    @for (t of s.tests; track t.id) {
                      <li>· {{ t.test?.name ?? 'Test' }}</li>
                    }
                  </ul>
                </div>
                <div class="shrink-0">
                  <pf-barcode-display [code]="s.barcode ?? ''"></pf-barcode-display>
                </div>
              </div>
              <div class="mt-3 flex justify-end no-print">
                <pf-touch-btn size="sm" variant="ghost" (pressed)="printOne(s.id)">
                  Print label
                </pf-touch-btn>
              </div>
            </pf-tile>
          }
        </div>

        <div class="mt-6 flex flex-wrap items-center justify-between gap-3 no-print">
          <div class="flex flex-wrap gap-2">
            <pf-touch-btn size="md" variant="secondary" (pressed)="printAll()">
              <span icon-left aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M6 9V2h12v7"/>
                  <rect x="6" y="13" width="12" height="9"/>
                  <path d="M6 18H3a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-3"/>
                </svg>
              </span>
              Print all labels
            </pf-touch-btn>
            <pf-touch-btn size="md" variant="secondary"
                          [disabled]="waSent()"
                          (pressed)="sendWhatsApp()">
              <span icon-left aria-hidden="true">
                @if (waSent()) {
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="m5 12 4 4L19 6"/>
                  </svg>
                } @else {
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                }
              </span>
              {{ waSent() ? 'WhatsApp sent' : 'Send WhatsApp confirmation' }}
            </pf-touch-btn>
          </div>
          <pf-touch-btn size="md" variant="primary" (pressed)="back()">
            Back to reception
            <span icon-right aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m9 18 6-6-6-6"/>
              </svg>
            </span>
          </pf-touch-btn>
        </div>
      } @else {
        <pf-tile tone="default" padding="md">
          <div class="flex items-center gap-3">
            <pf-skeleton variant="circle" width="44px" height="44px"></pf-skeleton>
            <div class="flex-1 space-y-2">
              <pf-skeleton variant="line" width="45%"></pf-skeleton>
              <pf-skeleton variant="line" width="70%" height="10px"></pf-skeleton>
            </div>
          </div>
        </pf-tile>
      }
    </section>
  `,
  styles: [`
    .success-pulse {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 72px;
      height: 72px;
    }
    .success-check {
      position: relative;
      width: 60px;
      height: 60px;
      border-radius: 9999px;
      background: linear-gradient(135deg, #10b981, #34d399);
      color: #ffffff;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 10px 30px rgba(16, 185, 129, 0.5);
      z-index: 2;
    }
    .success-ring {
      position: absolute;
      inset: 0;
      border-radius: 9999px;
      border: 2px solid rgba(16, 185, 129, 0.55);
      animation: pf-pp-pulse 1.8s ease-out infinite;
      z-index: 1;
    }
    @keyframes pf-pp-pulse {
      0%   { transform: scale(0.95); opacity: 0.9; }
      100% { transform: scale(1.45); opacity: 0; }
    }

    @media print {
      .no-print { display: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .success-ring { animation: none; }
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
    if (!id) { this.router.navigateByUrl('/frontdesk'); return; }
    this.api.get<Order>(`/api/orders/${id}`).subscribe({
      next: o => this._order.set(o),
      error: () => this.toasts.error('Could not load order')
    });
  }

  printOne(_sampleId: string) { window.print(); }
  printAll() { window.print(); }
  sendWhatsApp() {
    this.waSent.set(true);
    this.toasts.success('Confirmation queued (demo)');
  }
  back() { this.router.navigateByUrl('/frontdesk'); }
}
