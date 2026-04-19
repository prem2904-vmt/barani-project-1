import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { BarcodeDisplayComponent } from '../../../shared/components/barcode-display/barcode-display.component';
import { OrderSample } from '../../../shared/models/order.model';

@Component({
  selector: 'pf-sample-collection',
  standalone: true,
  imports: [FormsModule, DatePipe, BarcodeDisplayComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-8 max-w-5xl">
      <header class="flex items-center justify-between mb-4">
        <div>
          <h1 class="text-2xl font-semibold">Sample collection</h1>
          <p class="text-sm text-slate-600">Scan the barcode or pick from pending list, then mark collected.</p>
        </div>
        <button class="pf-btn pf-btn-ghost" (click)="refresh()">↻ Refresh</button>
      </header>

      <div class="pf-card mb-5">
        <label class="pf-label">Scan barcode</label>
        <div class="flex gap-2">
          <input #scan type="text" class="pf-input font-mono flex-1" placeholder="PF-AP-2026-…"
                 [ngModel]="scanValue()" (ngModelChange)="scanValue.set($event)"
                 (keydown.enter)="findByBarcode()" autofocus />
          <button class="pf-btn pf-btn-primary" [disabled]="!scanValue() || searching()" (click)="findByBarcode()">Find</button>
        </div>
        @if (scanResult(); as s) {
          <div class="mt-4 rounded-lg border border-[var(--color-accent)] bg-blue-50 p-4">
            <div class="flex items-start gap-4">
              <div class="flex-1">
                <p class="font-semibold">{{ s.order?.patient?.name ?? 'Patient' }}</p>
                <p class="text-xs text-slate-600">
                  {{ s.department?.name }} · Barcode {{ s.barcode }} · Status {{ s.status }}
                </p>
                <ul class="mt-2 text-sm space-y-0.5">
                  @for (t of s.tests; track t.id) { <li>• {{ t.test?.name ?? 'Test' }}</li> }
                </ul>
              </div>
              <button class="pf-btn pf-btn-primary" [disabled]="s.status !== 'pending'" (click)="collect(s.id)">
                Mark collected
              </button>
            </div>
          </div>
        }
      </div>

      <h3 class="text-xs uppercase tracking-wider text-slate-500 mb-2">
        Pending collection · {{ pending().length }}
      </h3>
      @if (pending().length === 0) {
        <div class="pf-card text-sm text-slate-500">No samples waiting for collection.</div>
      } @else {
        <ul class="space-y-2">
          @for (s of pending(); track s.id) {
            <li class="pf-card flex items-center gap-4">
              <div class="flex-1 min-w-0">
                <p class="font-medium">{{ s.order?.patient?.name ?? 'Patient' }}</p>
                <p class="text-xs text-slate-500">
                  {{ s.department?.name }} · {{ s.tests.length }} tests
                  · Created {{ s.createdAt | date:'shortTime' }}
                </p>
              </div>
              <pf-barcode-display [code]="s.barcode ?? ''"></pf-barcode-display>
              <div class="flex gap-2">
                <button class="pf-btn pf-btn-ghost text-xs" (click)="reject(s)">Reject</button>
                <button class="pf-btn pf-btn-primary" (click)="collect(s.id)">Collect</button>
              </div>
            </li>
          }
        </ul>
      }
    </section>
  `
})
export class SampleCollectionComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);

  private readonly _pending = signal<OrderSample[]>([]);
  private readonly _scanResult = signal<OrderSample | null>(null);
  protected readonly scanValue = signal('');
  protected readonly searching = signal(false);
  readonly pending = this._pending.asReadonly();
  readonly scanResult = this._scanResult.asReadonly();

  ngOnInit() { this.refresh(); }

  refresh() {
    this.api.get<OrderSample[]>('/api/samples/pending-collection').subscribe({
      next: l => this._pending.set(l ?? [])
    });
  }

  findByBarcode() {
    const code = this.scanValue().trim();
    if (!code) return;
    this.searching.set(true);
    this.api.get<OrderSample>(`/api/samples/by-barcode/${encodeURIComponent(code)}`).subscribe({
      next: s => { this._scanResult.set(s); this.searching.set(false); },
      error: () => { this._scanResult.set(null); this.searching.set(false); this.toasts.error('No sample with that barcode'); }
    });
  }

  collect(id: string) {
    this.api.patch<OrderSample>(`/api/samples/${id}/collect`).subscribe({
      next: () => {
        this.toasts.success('Collected');
        this._scanResult.set(null);
        this.scanValue.set('');
        this.refresh();
      }
    });
  }

  async reject(s: OrderSample) {
    const reason = await this.dialog.prompt({
      title: 'Reject this sample?',
      message: `Barcode ${s.barcode}. The sample will be flagged for re-collection.`,
      placeholder: 'Reason for rejection…',
      multiline: true,
      required: true,
      tone: 'danger',
      confirmLabel: 'Reject sample'
    });
    if (!reason) return;
    this.api.patch(`/api/samples/${s.id}/reject`, { reason }).subscribe({
      next: () => { this.toasts.success('Sample rejected'); this.refresh(); }
    });
  }
}
