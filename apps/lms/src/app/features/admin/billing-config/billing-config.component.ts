import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { Branch } from '../../../shared/models/tenant.model';
import { NumberInputComponent } from '../../../shared/primitives/number-input.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { ToggleComponent } from '../../../shared/primitives/toggle.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

type Tab = 'gst' | 'discounts' | 'invoice';
type GstScope = 'branch' | 'region' | 'tenant';

interface TenantBillingConfig {
  id?: string;
  tenantId: string;
  gstScope: GstScope;
  filingFrequency: 'monthly' | 'quarterly';
  allowDiscounts: boolean;
  maxDiscountPct: number;
  overrideDiscountPct: number;
  approvalThresholdPct: number;
  invoicePrefix: string;
  invoiceStartNumber: number;
}

interface GstRow {
  branchId: string;
  gstin: string;
  stateCode: string;
}

@Component({
  selector: 'pf-billing-config',
  standalone: true,
  imports: [
    FormsModule,
    NumberInputComponent,
    ScreenHeaderComponent,
    SegmentedComponent,
    SelectComponent,
    TileComponent,
    ToggleComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10 max-w-5xl mx-auto">
      <pf-screen-header
        eyebrow="Admin"
        title="Billing Config"
        subtitle="GST, discounts, and invoice numbering.">
        <pf-touch-btn actions size="sm" variant="primary" (pressed)="saveConfig()">
          <span icon-left aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <path d="M17 21v-8H7v8"/>
              <path d="M7 3v5h8"/>
            </svg>
          </span>
          Save
        </pf-touch-btn>
      </pf-screen-header>

      <div class="mb-5">
        <pf-segmented
          [options]="tabOptions"
          [value]="tab()"
          size="md"
          (valueChange)="setTab($event)">
        </pf-segmented>
      </div>

      @if (tab() === 'gst') {
        <pf-tile tone="default" padding="lg" class="block">
          <div class="space-y-5">
            <div>
              <label class="pf-label">GST scope</label>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
                @for (s of scopes; track s.value) {
                  <button type="button"
                          class="pf-scope-card"
                          [class.pf-scope-active]="config().gstScope === s.value"
                          (click)="patch({ gstScope: s.value })">
                    <span class="font-semibold text-[14px]">{{ s.label }}</span>
                    <span class="text-[11px] mt-0.5" style="color: var(--text-tertiary);">{{ s.hint }}</span>
                  </button>
                }
              </div>
            </div>

            <div class="max-w-xs">
              <label class="pf-label">Filing frequency</label>
              <pf-select
                [options]="filingFrequencyOptions"
                [value]="config().filingFrequency"
                (valueChange)="patch({ filingFrequency: $event })">
              </pf-select>
            </div>
          </div>

          <div class="mt-6 pt-5" style="border-top: 1px solid var(--border-muted);">
            <h3 class="text-[11px] font-mono uppercase tracking-[0.16em] mb-3"
                style="color: var(--text-muted);">GSTIN per branch</h3>

            @if (branches().length === 0) {
              <p class="text-[13px]" style="color: var(--text-tertiary);">No branches configured yet.</p>
            } @else {
              <div class="space-y-2">
                @for (b of branches(); track b.id) {
                  <div class="grid grid-cols-12 gap-2 items-center pf-gst-row">
                    <div class="col-span-4 min-w-0">
                      <p class="text-[14px] font-medium truncate" style="color: var(--text-primary);">{{ b.name }}</p>
                      <p class="text-[11px] font-mono" style="color: var(--text-muted);">{{ b.code }}</p>
                    </div>
                    <div class="col-span-4">
                      <input type="text" class="pf-input" placeholder="GSTIN"
                             [ngModel]="gstinFor(b.id)" (ngModelChange)="setGstin(b.id, $event)" />
                    </div>
                    <div class="col-span-3">
                      <input type="text" class="pf-input" placeholder="State code"
                             [ngModel]="stateCodeFor(b.id)" (ngModelChange)="setStateCode(b.id, $event)" />
                    </div>
                    <div class="col-span-1 text-right">
                      <pf-touch-btn size="sm" variant="ghost"
                                     [disabled]="!hasGstinFor(b.id)"
                                     (pressed)="saveGstin(b.id)">Save</pf-touch-btn>
                    </div>
                  </div>
                }
              </div>
            }
          </div>
        </pf-tile>
      }

      @if (tab() === 'discounts') {
        <pf-tile tone="default" padding="lg" class="block">
          <div class="flex items-center justify-between pb-4 mb-4"
               style="border-bottom: 1px solid var(--border-muted);">
            <div>
              <p class="font-semibold text-[15px]" style="color: var(--text-primary);">Allow discounts</p>
              <p class="text-[12px] mt-0.5" style="color: var(--text-tertiary);">
                Turn off to block all discounts across the system.
              </p>
            </div>
            <pf-toggle
              [checked]="config().allowDiscounts"
              size="md"
              (checkedChange)="patch({ allowDiscounts: $event })">
            </pf-toggle>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label class="pf-label">Level 1 · give_discount max %</label>
              <pf-number-input
                [value]="config().maxDiscountPct"
                [min]="0" [max]="100" [step]="1" suffix="%"
                [disabled]="!config().allowDiscounts"
                (valueChange)="patch({ maxDiscountPct: $event ?? 0 })">
              </pf-number-input>
            </div>
            <div>
              <label class="pf-label">Level 2 · override max %</label>
              <pf-number-input
                [value]="config().overrideDiscountPct"
                [min]="0" [max]="100" [step]="1" suffix="%"
                [disabled]="!config().allowDiscounts"
                (valueChange)="patch({ overrideDiscountPct: $event ?? 0 })">
              </pf-number-input>
            </div>
            <div>
              <label class="pf-label">Approval threshold %</label>
              <pf-number-input
                [value]="config().approvalThresholdPct"
                [min]="0" [max]="100" [step]="1" suffix="%"
                [disabled]="!config().allowDiscounts"
                (valueChange)="patch({ approvalThresholdPct: $event ?? 0 })">
              </pf-number-input>
            </div>
          </div>

          <p class="text-[12px] mt-4" style="color: var(--text-tertiary);">
            Discounts above the approval threshold require a second approver.
          </p>
        </pf-tile>
      }

      @if (tab() === 'invoice') {
        <pf-tile tone="default" padding="lg" class="block max-w-2xl">
          <div class="grid grid-cols-2 gap-3 mb-5">
            <div>
              <label class="pf-label">Invoice prefix</label>
              <input type="text" class="pf-input"
                     [ngModel]="config().invoicePrefix"
                     (ngModelChange)="patch({ invoicePrefix: $event })" />
            </div>
            <div>
              <label class="pf-label">Starting number</label>
              <pf-number-input
                [value]="config().invoiceStartNumber"
                [min]="1" [step]="1"
                (valueChange)="patch({ invoiceStartNumber: $event ?? 1 })">
              </pf-number-input>
            </div>
          </div>

          <div class="pf-invoice-preview">
            <p class="text-[11px] font-mono uppercase tracking-[0.16em] mb-1"
               style="color: var(--text-muted);">Next invoice</p>
            <p class="font-mono text-[16px] font-semibold" style="color: var(--text-primary);">
              {{ invoicePreview() }}
            </p>
          </div>
        </pf-tile>
      }
    </section>
  `,
  styles: [`
    .pf-scope-card {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      padding: 12px 14px;
      border-radius: 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      cursor: pointer;
      text-align: left;
      transition: border-color 0.2s ease, background 0.2s ease, transform 0.08s ease;
    }
    .pf-scope-card:active { transform: scale(0.98); }
    .pf-scope-card:hover { border-color: var(--card-hover-border); }
    .pf-scope-active {
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.18), rgba(236, 72, 153, 0.08));
      border-color: rgba(168, 85, 247, 0.4);
      color: var(--text-primary);
      box-shadow: 0 4px 14px rgba(124, 58, 237, 0.25);
    }

    .pf-gst-row {
      padding: 10px 12px;
      border-radius: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
    }

    .pf-invoice-preview {
      padding: 14px 18px;
      border-radius: 14px;
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.1), rgba(236, 72, 153, 0.05));
      border: 1px solid rgba(168, 85, 247, 0.25);
    }
  `]
})
export class BillingConfigComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);

  readonly tabOptions: SegmentedOption<Tab>[] = [
    { value: 'gst',       label: 'GST Setup' },
    { value: 'discounts', label: 'Discounts' },
    { value: 'invoice',   label: 'Invoice' }
  ];
  private readonly _tab = signal<Tab>('gst');
  readonly tab = this._tab.asReadonly();
  setTab(t: Tab) { this._tab.set(t); }

  readonly scopes: Array<{ label: string; value: GstScope; hint: string }> = [
    { label: 'Per branch', value: 'branch', hint: 'Each branch files separately' },
    { label: 'Per region', value: 'region', hint: 'Branches grouped by region' },
    { label: 'Per tenant', value: 'tenant', hint: 'One consolidated filing' }
  ];

  readonly filingFrequencyOptions: PfSelectOption<'monthly' | 'quarterly'>[] = [
    { value: 'monthly',   label: 'Monthly',   hint: 'Returns every calendar month' },
    { value: 'quarterly', label: 'Quarterly', hint: 'Returns every three months' }
  ];

  private readonly _config = signal<TenantBillingConfig>({
    tenantId: '',
    gstScope: 'branch',
    filingFrequency: 'monthly',
    allowDiscounts: true,
    maxDiscountPct: 10,
    overrideDiscountPct: 25,
    approvalThresholdPct: 50,
    invoicePrefix: 'INV',
    invoiceStartNumber: 1000
  });
  readonly config = this._config.asReadonly();
  patch(p: Partial<TenantBillingConfig>) { this._config.update(c => ({ ...c, ...p })); }

  private readonly _branches = signal<Branch[]>([]);
  readonly branches = this._branches.asReadonly();

  private readonly _gstinByBranch = signal<Map<string, GstRow>>(new Map());

  readonly invoicePreview = computed(() => {
    const c = this._config();
    const year = new Date().getFullYear();
    return `${c.invoicePrefix}/${year}/${c.invoiceStartNumber}`;
  });

  ngOnInit() {
    this.api.get<TenantBillingConfig>('/api/config/billing').subscribe({
      next: c => { if (c) this._config.set({ ...this._config(), ...c }); }
    });
    this.api.get<Branch[]>('/api/tenants/branches').subscribe({
      next: l => this._branches.set(l ?? [])
    });
  }

  gstinFor(bid: string): string { return this._gstinByBranch().get(bid)?.gstin ?? ''; }
  stateCodeFor(bid: string): string { return this._gstinByBranch().get(bid)?.stateCode ?? ''; }
  hasGstinFor(bid: string): boolean {
    const r = this._gstinByBranch().get(bid);
    return !!(r?.gstin && r?.stateCode);
  }
  setGstin(bid: string, v: string) {
    const map = new Map(this._gstinByBranch());
    const cur = map.get(bid) ?? { branchId: bid, gstin: '', stateCode: '' };
    map.set(bid, { ...cur, gstin: v });
    this._gstinByBranch.set(map);
  }
  setStateCode(bid: string, v: string) {
    const map = new Map(this._gstinByBranch());
    const cur = map.get(bid) ?? { branchId: bid, gstin: '', stateCode: '' };
    map.set(bid, { ...cur, stateCode: v });
    this._gstinByBranch.set(map);
  }
  saveGstin(bid: string) {
    const row = this._gstinByBranch().get(bid);
    if (!row) return;
    this.api.post('/api/config/gst', { branchId: bid, gstin: row.gstin, stateCode: row.stateCode }).subscribe({
      next: () => this.toasts.success('GSTIN saved')
    });
  }

  saveConfig() {
    const c = this._config();
    this.api.post('/api/config/billing', {
      gstScope: c.gstScope, filingFrequency: c.filingFrequency,
      allowDiscounts: c.allowDiscounts, maxDiscountPct: c.maxDiscountPct,
      overrideDiscountPct: c.overrideDiscountPct, approvalThresholdPct: c.approvalThresholdPct,
      invoicePrefix: c.invoicePrefix, invoiceStartNumber: c.invoiceStartNumber
    }).subscribe({
      next: () => this.toasts.success('Billing config saved')
    });
  }
}
