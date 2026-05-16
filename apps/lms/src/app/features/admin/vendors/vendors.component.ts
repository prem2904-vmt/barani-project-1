import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { ChipComponent } from '../../../shared/primitives/chip.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { LoadingLogoComponent } from '../../../shared/components/loading-logo/loading-logo.component';

interface VendorRow {
  id: string;
  name: string;
  code?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  gstin?: string;
  address?: string;
  totalCredit: number;
  usedCredit: number;
  balance: number;
  isActive: boolean;
  createdAt: string;
}

interface VendorTxn {
  id: string;
  vendorId: string;
  type: 'topup' | 'charge' | 'refund' | 'adjustment' | string;
  amount: number;
  billId?: string | null;
  reason?: string | null;
  createdAt: string;
}

interface NewVendorDraft {
  name: string;
  code: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  gstin: string;
  address: string;
  openingCredit: string;
}

const EMPTY_DRAFT: NewVendorDraft = {
  name: '', code: '', contactName: '', contactPhone: '', contactEmail: '',
  gstin: '', address: '', openingCredit: ''
};

@Component({
  selector: 'pf-vendors',
  standalone: true,
  imports: [
    FormsModule, CurrencyInrPipe,
    ChipComponent, ScreenHeaderComponent, TileComponent, TouchButtonComponent,
    LoadingLogoComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10">
      <pf-screen-header
        eyebrow="Admin"
        title="Vendor wallets"
        subtitle="Pre-loaded credit accounts for partner hospitals & aggregators. Reception charges bills against these wallets from the billing screen.">
        <pf-touch-btn actions size="sm" variant="primary" (pressed)="toggleNewVendor()">
          <span icon-left aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </span>
          {{ newVendorOpen() ? 'Cancel' : 'Add vendor' }}
        </pf-touch-btn>
      </pf-screen-header>

      @if (newVendorOpen()) {
        <pf-tile tone="violet" padding="lg" class="block mb-4">
          <h3 class="pf-section-title mb-3">New vendor</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label class="pf-label">Name *</label>
              <input type="text" class="pf-input" [ngModel]="draft().name" (ngModelChange)="patchDraft({ name: $event })" placeholder="Apollo Hospital"/></div>
            <div><label class="pf-label">Code</label>
              <input type="text" class="pf-input uppercase" [ngModel]="draft().code" (ngModelChange)="patchDraft({ code: $event.toUpperCase() })" placeholder="APOLLO"/></div>
            <div><label class="pf-label">Contact name</label>
              <input type="text" class="pf-input" [ngModel]="draft().contactName" (ngModelChange)="patchDraft({ contactName: $event })"/></div>
            <div><label class="pf-label">Contact phone</label>
              <input type="tel" class="pf-input" [ngModel]="draft().contactPhone" (ngModelChange)="patchDraft({ contactPhone: $event })"/></div>
            <div><label class="pf-label">Contact email</label>
              <input type="email" class="pf-input" [ngModel]="draft().contactEmail" (ngModelChange)="patchDraft({ contactEmail: $event })"/></div>
            <div><label class="pf-label">GSTIN</label>
              <input type="text" class="pf-input" [ngModel]="draft().gstin" (ngModelChange)="patchDraft({ gstin: $event })"/></div>
            <div class="sm:col-span-2"><label class="pf-label">Address</label>
              <input type="text" class="pf-input" [ngModel]="draft().address" (ngModelChange)="patchDraft({ address: $event })"/></div>
            <div>
              <label class="pf-label">Opening credit (₹)</label>
              <input type="number" min="0" step="1" class="pf-input"
                     [ngModel]="draft().openingCredit"
                     (ngModelChange)="patchDraft({ openingCredit: $event })"
                     placeholder="0"/>
              <p class="text-[11px] text-[var(--text-tertiary)] mt-1">Optional — top up later if you skip this.</p>
            </div>
          </div>
          <div class="mt-4 flex gap-2 justify-end">
            <pf-touch-btn size="sm" variant="ghost" (pressed)="toggleNewVendor()">Cancel</pf-touch-btn>
            <pf-touch-btn size="sm" variant="primary" (pressed)="createVendor()" [disabled]="!draft().name.trim() || saving()">
              {{ saving() ? 'Creating…' : 'Create vendor' }}
            </pf-touch-btn>
          </div>
        </pf-tile>
      }

      @if (loading()) {
        <pf-tile tone="default" padding="lg" class="block">
          <div class="flex justify-center py-6">
            <pf-loading-logo size="lg" color="purple" [showDna]="true"
                             [showText]="true" text="Loading vendors…"></pf-loading-logo>
          </div>
        </pf-tile>
      } @else if (vendors().length === 0) {
        <pf-tile tone="default" padding="xl" class="block">
          <p class="text-center text-[13px]" style="color: var(--text-tertiary);">
            No vendors yet. Add your first partner hospital or aggregator to start tracking B2B credit.
          </p>
        </pf-tile>
      } @else {
        <div class="space-y-3">
          @for (v of vendors(); track v.id) {
            <pf-tile tone="default" padding="lg" class="block">
              <div class="flex items-start justify-between gap-4 flex-wrap">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 mb-1">
                    <h3 class="pf-vendor__name">{{ v.name }}</h3>
                    @if (v.code) { <span class="pf-vendor__code">{{ v.code }}</span> }
                    @if (!v.isActive) { <pf-chip tone="rose" size="sm">inactive</pf-chip> }
                  </div>
                  @if (v.contactName || v.contactPhone) {
                    <p class="pf-vendor__meta">
                      {{ v.contactName || '—' }} · {{ v.contactPhone || 'no phone' }}
                    </p>
                  }
                  @if (v.gstin) {
                    <p class="pf-vendor__meta pf-vendor__mono">GSTIN: {{ v.gstin }}</p>
                  }
                </div>

                <div class="pf-vendor__balance">
                  <p class="pf-eyebrow">Balance</p>
                  <p class="pf-vendor__bal-amt" [class.pf-vendor__bal-amt--low]="v.balance <= 0">
                    {{ v.balance | inr }}
                  </p>
                  <p class="pf-vendor__meta">
                    {{ v.usedCredit | inr }} used of {{ v.totalCredit | inr }}
                  </p>
                  <div class="pf-vendor__bar">
                    <span [style.width.%]="usagePct(v)"></span>
                  </div>
                </div>
              </div>

              <div class="pf-vendor__actions">
                <pf-touch-btn size="sm" variant="primary" (pressed)="openTopUp(v)">+ Top up</pf-touch-btn>
                <pf-touch-btn size="sm" variant="ghost" (pressed)="toggleTransactions(v.id)">
                  {{ openTxnsId() === v.id ? 'Hide history' : 'View history' }}
                </pf-touch-btn>
                <pf-touch-btn size="sm" variant="ghost" (pressed)="toggleActive(v)">
                  {{ v.isActive ? 'Deactivate' : 'Reactivate' }}
                </pf-touch-btn>
              </div>

              @if (topUpVendorId() === v.id) {
                <div class="pf-topup">
                  <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                    <div><label class="pf-label">Amount (₹)</label>
                      <input type="number" min="1" step="1" class="pf-input"
                             [ngModel]="topUpAmount()" (ngModelChange)="topUpAmount.set($event)"
                             placeholder="50000"/></div>
                    <div class="sm:col-span-2"><label class="pf-label">Reason / reference</label>
                      <input type="text" class="pf-input"
                             [ngModel]="topUpReason()" (ngModelChange)="topUpReason.set($event)"
                             placeholder="UPI from accounts dept · ref XYZ"/></div>
                  </div>
                  <div class="mt-3 flex gap-2 justify-end">
                    <pf-touch-btn size="sm" variant="ghost" (pressed)="closeTopUp()">Cancel</pf-touch-btn>
                    <pf-touch-btn size="sm" variant="primary" (pressed)="confirmTopUp(v)" [disabled]="!topUpAmountValid() || saving()">
                      Add ₹{{ topUpAmount() || '0' }}
                    </pf-touch-btn>
                  </div>
                </div>
              }

              @if (openTxnsId() === v.id) {
                <div class="pf-txns">
                  @if (loadingTxns()) {
                    <div class="flex justify-center py-3">
                      <pf-loading-logo size="sm" color="purple"
                                       [showText]="true" text="Loading…"></pf-loading-logo>
                    </div>
                  } @else if ((txns()[v.id] ?? []).length === 0) {
                    <p class="text-[12.5px] text-center py-3" style="color: var(--text-tertiary);">No transactions yet.</p>
                  } @else {
                    <ul class="pf-txns__list">
                      @for (t of txns()[v.id]; track t.id) {
                        <li class="pf-txn">
                          <span class="pf-txn__type" [attr.data-kind]="t.type">{{ t.type }}</span>
                          <span class="pf-txn__reason">{{ t.reason || '—' }}</span>
                          <span class="pf-txn__amt" [class.pf-txn__amt--neg]="t.amount < 0">
                            {{ t.amount < 0 ? '−' : '+' }}{{ absMoney(t.amount) | inr }}
                          </span>
                          <span class="pf-txn__when">{{ formatDate(t.createdAt) }}</span>
                        </li>
                      }
                    </ul>
                  }
                </div>
              }
            </pf-tile>
          }
        </div>
      }
    </section>
  `,
  styles: [`
    .pf-section-title {
      font-size: 11px; font-weight: 700; letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .pf-label {
      display: block;
      font-size: 11px; font-weight: 600; letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-tertiary);
      margin-bottom: 4px;
    }
    .pf-input {
      width: 100%;
      padding: 8px 12px;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      color: var(--input-text);
      border-radius: 10px;
      font-size: 13px;
      outline: none;
    }
    .pf-input:focus {
      border-color: var(--input-border-focus);
      box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.18);
    }

    /* Vendor row */
    .pf-vendor__name {
      margin: 0; font-size: 16px; font-weight: 700; color: var(--text-primary);
      letter-spacing: -0.01em;
    }
    .pf-vendor__code {
      padding: 2px 8px;
      background: rgba(168, 85, 247, 0.18);
      color: #c4b5fd;
      border-radius: 9999px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em;
    }
    .pf-vendor__meta {
      margin: 2px 0 0;
      font-size: 12px; color: var(--text-secondary);
    }
    .pf-vendor__mono {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 11px;
    }

    .pf-vendor__balance {
      flex: 0 0 auto; min-width: 200px;
      text-align: right;
    }
    .pf-vendor__bal-amt {
      margin: 4px 0;
      font-size: 22px; font-weight: 700;
      color: #6ee7b7;
      font-variant-numeric: tabular-nums;
    }
    .pf-vendor__bal-amt--low { color: #fca5a5; }
    .pf-vendor__bar {
      margin-top: 6px; height: 4px;
      background: var(--glass-border); border-radius: 9999px; overflow: hidden;
    }
    .pf-vendor__bar > span {
      display: block; height: 100%;
      background: linear-gradient(90deg, #10b981, #ec4899);
      transition: width 0.25s ease;
    }

    .pf-vendor__actions {
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid var(--glass-border);
      display: flex; gap: 8px; flex-wrap: wrap;
    }

    /* Inline top-up panel */
    .pf-topup {
      margin-top: 14px;
      padding: 14px;
      background: var(--glass-bg);
      border: 1px solid rgba(168, 85, 247, 0.32);
      border-radius: 12px;
    }

    /* Transactions list */
    .pf-txns {
      margin-top: 14px;
      padding: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 12px;
    }
    .pf-txns__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .pf-txn {
      display: grid;
      grid-template-columns: 90px minmax(0, 1fr) 110px 130px;
      gap: 10px; align-items: center;
      padding: 8px 10px;
      background: rgba(255,255,255,0.02);
      border-radius: 8px;
      font-size: 12px;
    }
    .pf-txn__type {
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em;
      text-transform: uppercase; text-align: center;
    }
    .pf-txn__type[data-kind="topup"]    { background: rgba(16, 185, 129, 0.18); color: #6ee7b7; }
    .pf-txn__type[data-kind="charge"]   { background: rgba(244, 63, 94, 0.18); color: #fda4af; }
    .pf-txn__type[data-kind="refund"]   { background: rgba(59, 130, 246, 0.18); color: #93c5fd; }
    .pf-txn__type[data-kind="adjustment"] { background: rgba(156, 163, 175, 0.18); color: #d1d5db; }
    .pf-txn__reason { color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pf-txn__amt {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-weight: 700; text-align: right; color: #6ee7b7;
    }
    .pf-txn__amt--neg { color: #fca5a5; }
    .pf-txn__when {
      font-size: 11px; color: var(--text-tertiary); text-align: right;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }
  `]
})
export class VendorsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);

  protected readonly vendors = signal<VendorRow[]>([]);
  protected readonly loading = signal<boolean>(true);
  protected readonly saving = signal<boolean>(false);
  protected readonly newVendorOpen = signal<boolean>(false);
  protected readonly draft = signal<NewVendorDraft>({ ...EMPTY_DRAFT });

  protected readonly topUpVendorId = signal<string | null>(null);
  protected readonly topUpAmount = signal<string>('');
  protected readonly topUpReason = signal<string>('');

  protected readonly openTxnsId = signal<string | null>(null);
  protected readonly txns = signal<Record<string, VendorTxn[]>>({});
  protected readonly loadingTxns = signal<boolean>(false);

  protected readonly topUpAmountValid = computed(() => {
    const n = parseInt(this.topUpAmount() || '0', 10);
    return Number.isFinite(n) && n > 0;
  });

  ngOnInit() { this.refresh(); }

  refresh() {
    this.loading.set(true);
    this.api.get<VendorRow[]>('/api/vendors?includeInactive=true').subscribe({
      next: list => { this.vendors.set(list ?? []); this.loading.set(false); },
      error: e => { this.loading.set(false); this.toasts.error(e?.message ?? 'Could not load vendors'); }
    });
  }

  toggleNewVendor() {
    this.newVendorOpen.update(v => !v);
    if (!this.newVendorOpen()) this.draft.set({ ...EMPTY_DRAFT });
  }
  patchDraft(patch: Partial<NewVendorDraft>) { this.draft.update(d => ({ ...d, ...patch })); }

  createVendor() {
    const d = this.draft();
    if (!d.name.trim()) return;
    this.saving.set(true);
    const opening = parseInt(d.openingCredit || '0', 10);
    this.api.post<VendorRow>('/api/vendors', {
      name: d.name.trim(),
      code: d.code.trim() || null,
      contactName: d.contactName.trim() || null,
      contactPhone: d.contactPhone.trim() || null,
      contactEmail: d.contactEmail.trim() || null,
      gstin: d.gstin.trim() || null,
      address: d.address.trim() || null,
      openingCredit: Number.isFinite(opening) && opening > 0 ? opening : null
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.toasts.success('Vendor created');
        this.newVendorOpen.set(false);
        this.draft.set({ ...EMPTY_DRAFT });
        this.refresh();
      },
      error: e => { this.saving.set(false); this.toasts.error(e?.message ?? 'Could not create vendor'); }
    });
  }

  openTopUp(v: VendorRow) {
    this.topUpVendorId.set(v.id);
    this.topUpAmount.set('');
    this.topUpReason.set('');
  }
  closeTopUp() { this.topUpVendorId.set(null); }
  confirmTopUp(v: VendorRow) {
    const amount = parseInt(this.topUpAmount() || '0', 10);
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.saving.set(true);
    this.api.post<VendorRow>(`/api/vendors/${v.id}/topup`, {
      amount, reason: this.topUpReason().trim() || null
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.toasts.success(`Topped up ₹${amount}`);
        this.closeTopUp();
        this.refresh();
        // If this vendor's history is open, refresh it too.
        if (this.openTxnsId() === v.id) this.loadTxns(v.id);
      },
      error: e => { this.saving.set(false); this.toasts.error(e?.message ?? 'Top-up failed'); }
    });
  }

  toggleActive(v: VendorRow) {
    this.api.put<VendorRow>(`/api/vendors/${v.id}`, {
      name: v.name, code: v.code ?? null,
      contactName: v.contactName ?? null, contactPhone: v.contactPhone ?? null,
      contactEmail: v.contactEmail ?? null, gstin: v.gstin ?? null,
      address: v.address ?? null,
      isActive: !v.isActive
    }).subscribe({
      next: () => { this.toasts.success(v.isActive ? 'Vendor deactivated' : 'Vendor reactivated'); this.refresh(); },
      error: e => this.toasts.error(e?.message ?? 'Could not update vendor')
    });
  }

  toggleTransactions(id: string) {
    if (this.openTxnsId() === id) { this.openTxnsId.set(null); return; }
    this.openTxnsId.set(id);
    if (!this.txns()[id]) this.loadTxns(id);
  }

  private loadTxns(id: string) {
    this.loadingTxns.set(true);
    this.api.get<VendorTxn[]>(`/api/vendors/${id}/transactions?limit=100`).subscribe({
      next: list => {
        this.txns.update(map => ({ ...map, [id]: list ?? [] }));
        this.loadingTxns.set(false);
      },
      error: () => { this.loadingTxns.set(false); }
    });
  }

  protected usagePct(v: VendorRow): number {
    if (v.totalCredit <= 0) return 0;
    return Math.min(100, Math.round((v.usedCredit / v.totalCredit) * 100));
  }

  protected absMoney(n: number): number { return Math.abs(n); }
  protected formatDate(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm} ${hh}:${min}`;
  }
}
