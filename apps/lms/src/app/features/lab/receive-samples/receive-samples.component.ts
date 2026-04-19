import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { OrderSample } from '../../../shared/models/order.model';

@Component({
  selector: 'pf-receive-samples',
  standalone: true,
  imports: [FormsModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-8 max-w-5xl">
      <header class="flex items-center justify-between mb-4">
        <div>
          <h1 class="text-2xl font-semibold">Receive samples</h1>
          <p class="text-sm text-slate-600">Scan incoming barcodes or batch-receive the in-transit list.</p>
        </div>
        <button class="pf-btn pf-btn-ghost" (click)="refresh()">↻ Refresh</button>
      </header>

      <div class="pf-card mb-5">
        <label class="pf-label">Scan barcode</label>
        <div class="flex gap-2">
          <input type="text" class="pf-input font-mono flex-1"
                 placeholder="PF-AP-…"
                 [ngModel]="scanValue()" (ngModelChange)="scanValue.set($event)"
                 (keydown.enter)="receiveByBarcode()" autofocus />
          <button class="pf-btn pf-btn-primary" [disabled]="!scanValue()" (click)="receiveByBarcode()">Receive</button>
        </div>
      </div>

      <div class="flex items-center justify-between mb-2">
        <h3 class="text-xs uppercase tracking-wider text-slate-500">
          In transit · {{ inTransit().length }}
        </h3>
        <div class="flex gap-2">
          <button class="pf-btn pf-btn-ghost text-xs" (click)="toggleAll()">
            {{ allSelected() ? 'Deselect all' : 'Select all' }}
          </button>
          <button class="pf-btn pf-btn-primary text-xs"
                  [disabled]="selectedIds().size === 0 || busy()"
                  (click)="receiveSelected()">
            Confirm receipt of {{ selectedIds().size || 0 }}
          </button>
        </div>
      </div>

      @if (inTransit().length === 0) {
        <div class="pf-card text-sm text-slate-500">Nothing in transit.</div>
      } @else {
        <ul class="space-y-2">
          @for (s of inTransit(); track s.id) {
            <li class="pf-card flex items-center gap-3">
              <input type="checkbox" [checked]="isSelected(s.id)" (change)="toggle(s.id)" />
              <div class="flex-1 min-w-0">
                <p class="font-medium text-sm">{{ s.order?.patient?.name ?? 'Patient' }}</p>
                <p class="text-xs text-slate-500">
                  {{ s.department?.name }} · {{ s.barcode }}
                  · Picked {{ s.pickedUpAt ? (s.pickedUpAt | date:'shortTime') : '—' }}
                </p>
              </div>
              <button class="pf-btn pf-btn-ghost text-xs" (click)="receiveOne(s.id)">Receive</button>
            </li>
          }
        </ul>
      }
    </section>
  `
})
export class ReceiveSamplesComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);

  private readonly _inTransit = signal<OrderSample[]>([]);
  private readonly _selectedIds = signal<Set<string>>(new Set());
  protected readonly scanValue = signal('');
  protected readonly busy = signal(false);

  readonly inTransit = this._inTransit.asReadonly();
  readonly selectedIds = this._selectedIds.asReadonly();
  readonly allSelected = computed(() =>
    this._inTransit().length > 0 && this._selectedIds().size === this._inTransit().length
  );

  ngOnInit() { this.refresh(); }

  refresh() {
    this.api.get<OrderSample[]>('/api/samples/in-transit').subscribe({
      next: l => {
        this._inTransit.set(l ?? []);
        this._selectedIds.set(new Set());
      }
    });
  }

  isSelected(id: string): boolean { return this._selectedIds().has(id); }
  toggle(id: string) {
    const next = new Set(this._selectedIds());
    next.has(id) ? next.delete(id) : next.add(id);
    this._selectedIds.set(next);
  }
  toggleAll() {
    if (this.allSelected()) this._selectedIds.set(new Set());
    else this._selectedIds.set(new Set(this._inTransit().map(s => s.id)));
  }

  receiveByBarcode() {
    const code = this.scanValue().trim();
    if (!code) return;
    this.busy.set(true);
    this.api.get<OrderSample>(`/api/samples/by-barcode/${encodeURIComponent(code)}`).subscribe({
      next: s => this.api.patch<OrderSample>(`/api/samples/${s.id}/receive`).subscribe({
        next: () => { this.busy.set(false); this.scanValue.set(''); this.toasts.success(`Received ${s.barcode}`); this.refresh(); },
        error: e => { this.busy.set(false); this.toasts.error(e.message ?? 'Receive failed'); }
      }),
      error: () => { this.busy.set(false); this.toasts.error('Barcode not found'); }
    });
  }

  receiveOne(id: string) {
    this.api.patch<OrderSample>(`/api/samples/${id}/receive`).subscribe({
      next: () => { this.toasts.success('Received'); this.refresh(); }
    });
  }

  receiveSelected() {
    const ids = Array.from(this._selectedIds());
    if (ids.length === 0) return;
    this.busy.set(true);
    this.api.post<OrderSample[]>('/api/samples/receive-batch', { sampleIds: ids }).subscribe({
      next: () => { this.busy.set(false); this.toasts.success(`Received ${ids.length}`); this.refresh(); },
      error: e => { this.busy.set(false); this.toasts.error(e.message ?? 'Batch receive failed'); }
    });
  }
}
