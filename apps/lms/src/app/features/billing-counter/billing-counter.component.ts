import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { Order } from '../../shared/models/order.model';
import { Patient, patientDisplayName } from '../../shared/models/patient.model';
import { AvatarComponent } from '../../shared/primitives/avatar.component';
import { ChipComponent } from '../../shared/primitives/chip.component';
import { ScreenHeaderComponent } from '../../shared/primitives/screen-header.component';
import { TileComponent } from '../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../shared/primitives/touch-button.component';

/**
 * Billing counter — for branches in `billing_mode = separate_counter`.
 * Workflow: search patient by name/phone/order id → see their unbilled orders →
 * tap one to open the standard /frontdesk/billing screen with that order id.
 *
 * The actual billing UI is reused from /frontdesk/billing rather than duplicated.
 */
@Component({
  selector: 'pf-billing-counter',
  standalone: true,
  imports: [
    FormsModule, DatePipe,
    AvatarComponent, ChipComponent,
    ScreenHeaderComponent, TileComponent, TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 lg:px-10 pt-6 pb-10">
      <pf-screen-header
        eyebrow="Billing · Counter"
        title="Billing counter"
        subtitle="Search by name, phone, or order ID. Pick an unbilled order to process payment.">
      </pf-screen-header>

      <pf-tile tone="default" padding="lg" class="block mb-5">
        <label class="pf-label">Search patient</label>
        <input class="pf-input" type="search" autofocus
               placeholder="Name · phone · order ID"
               [ngModel]="query()" (ngModelChange)="onSearch($event)" />
      </pf-tile>

      @if (results().length === 0) {
        @if (query().trim().length > 0 && !searching()) {
          <pf-tile tone="default" padding="xl">
            <p class="text-center text-[13px]" style="color: var(--text-tertiary);">
              No matching patient. Check the spelling, phone, or order ID.
            </p>
          </pf-tile>
        }
      } @else {
        <h3 class="pf-section">Patients</h3>
        <ul class="pf-list">
          @for (p of results(); track p.id) {
            <li>
              <button type="button" class="pf-row" (click)="selectPatient(p)">
                <pf-avatar [name]="display(p)" [size]="44"></pf-avatar>
                <div class="min-w-0 flex-1">
                  <p class="pf-row__name">{{ display(p) }}</p>
                  <p class="pf-row__meta">
                    {{ p.sex || '—' }}
                    @if (p.age != null) { · {{ p.age }}y }
                    @if (p.phone) { · {{ p.phone }} }
                  </p>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m9 18 6-6-6-6"/>
                </svg>
              </button>
            </li>
          }
        </ul>
      }

      @if (selectedPatient(); as p) {
        <h3 class="pf-section mt-6">{{ display(p) }} · unbilled orders</h3>
        @if (loadingOrders()) {
          <pf-tile tone="default" padding="lg" class="block">
            <p class="text-[12.5px]" style="color: var(--text-tertiary);">Loading orders…</p>
          </pf-tile>
        } @else if (unbilledOrders().length === 0) {
          <pf-tile tone="default" padding="lg" class="block">
            <p class="text-[13px]" style="color: var(--text-tertiary);">
              All orders for this patient are billed already.
            </p>
          </pf-tile>
        } @else {
          <ul class="pf-list">
            @for (o of unbilledOrders(); track o.id) {
              <li>
                <button type="button" class="pf-row" (click)="bill(o)">
                  <div class="pf-row__id">#{{ o.id.slice(0, 8) }}</div>
                  <div class="min-w-0 flex-1">
                    <p class="pf-row__name">
                      {{ totalTests(o) }} test<span [class.hidden]="totalTests(o) === 1">s</span>
                      <pf-chip [tone]="priorityTone(o)" size="sm" class="ml-2">{{ o.priority }}</pf-chip>
                    </p>
                    <p class="pf-row__meta">
                      Created {{ o.createdAt | date:'shortTime' }} · {{ o.collectionType }}
                    </p>
                  </div>
                  <pf-touch-btn size="sm" variant="primary">Process payment →</pf-touch-btn>
                </button>
              </li>
            }
          </ul>
        }
      }
    </section>
  `,
  styles: [`
    .pf-section {
      margin: 14px 0 8px;
      font-size: 11px; font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-muted);
    }
    .pf-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .pf-row {
      all: unset; cursor: pointer;
      /* Mobile: stack the order summary and the Process button so the
         button is full-width and tappable. Tablet+ goes back to the
         single inline row layout. */
      display: flex; flex-direction: column; align-items: stretch; gap: 10px;
      width: 100%; padding: 12px 16px;
      background: var(--glass-bg); border: 1px solid var(--glass-border);
      border-radius: 14px;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    @media (min-width: 640px) {
      .pf-row { flex-direction: row; align-items: center; gap: 14px; }
    }
    .pf-row:hover { border-color: rgba(168, 85, 247, 0.45); background: rgba(168, 85, 247, 0.04); }
    .pf-row__id {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 11.5px; font-weight: 700;
      color: #c4b5fd;
      padding: 6px 10px; border-radius: 999px;
      background: rgba(168, 85, 247, 0.12);
      border: 1px solid rgba(168, 85, 247, 0.28);
      flex-shrink: 0;
    }
    .pf-row__name { margin: 0; font-weight: 600; font-size: 14.5px; color: var(--text-primary); text-align: left; }
    .pf-row__meta {
      margin: 2px 0 0; font-size: 11px; color: var(--text-tertiary);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      text-align: left;
    }
    .hidden { display: none; }
  `]
})
export class BillingCounterComponent {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly query = signal('');
  private readonly _results = signal<Patient[]>([]);
  private readonly _searching = signal(false);
  private readonly _selectedPatient = signal<Patient | null>(null);
  private readonly _orders = signal<Order[]>([]);
  private readonly _loadingOrders = signal(false);

  readonly results = this._results.asReadonly();
  readonly searching = this._searching.asReadonly();
  readonly selectedPatient = this._selectedPatient.asReadonly();
  readonly loadingOrders = this._loadingOrders.asReadonly();
  readonly unbilledOrders = computed(() =>
    this._orders().filter(o => o.status === 'created' || o.status === 'pending'));

  display(p: Patient | null | undefined): string { return patientDisplayName(p); }

  onSearch(q: string) {
    this.query.set(q);
    if (q.trim().length === 0) { this._results.set([]); return; }
    this._searching.set(true);
    this.api.get<Patient[]>(`/api/patients?q=${encodeURIComponent(q.trim())}`).subscribe({
      next: list => { this._results.set(list ?? []); this._searching.set(false); },
      error: () => { this._results.set([]); this._searching.set(false); }
    });
  }

  selectPatient(p: Patient) {
    this._selectedPatient.set(p);
    this._orders.set([]);
    this._loadingOrders.set(true);
    // Reuse the patient profile endpoint which returns orders.
    this.api.get<{ patient: Patient; history: Order[] }>(`/api/patients/${p.id}`).subscribe({
      next: res => {
        this._orders.set(res.history ?? []);
        this._loadingOrders.set(false);
      },
      error: () => {
        this._loadingOrders.set(false);
        this.toasts.error('Could not load orders for this patient');
      }
    });
  }

  bill(o: Order) {
    // Hand off to the existing billing screen with the order id pre-loaded.
    this.router.navigate(['/frontdesk/billing'], { queryParams: { orderId: o.id } });
  }

  totalTests(o: Order): number {
    return (o.samples ?? []).reduce((sum, s) => sum + (s.tests?.length ?? 0), 0);
  }

  priorityTone(o: Order): 'default' | 'amber' | 'rose' {
    if (o.priority === 'STAT' || o.priority === 'Urgent') return 'rose';
    if (o.priority === 'High') return 'amber';
    return 'default';
  }
}
