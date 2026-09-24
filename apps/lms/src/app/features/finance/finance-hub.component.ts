import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { DatePipe } from '@angular/common';
import { CurrencyInrPipe } from '../../shared/pipes/currency-inr.pipe';
import { WalletOutstandingPipe } from '../../shared/pipes/wallet-outstanding.pipe';
import { ScreenHeaderComponent } from '../../shared/primitives/screen-header.component';
import { TileComponent } from '../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../shared/primitives/touch-button.component';
import { downloadCsv } from '../../shared/utils/export-csv';
import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { SegmentedComponent, SegmentedOption } from '../../shared/primitives/segmented.component';
import { ThemeService } from '../../core/services/theme.service';
import { bandFilter } from '../../shared/utils/band-search';

type Module = 'overall' | 'lab' | 'credit' | 'ipd' | 'opd' | 'pharmacy';

interface Vendor {
  id: string; name: string; code?: string;
  outstanding: number; usedCredit: number; totalCredit: number;
  notifyThreshold?: number | null; isActive: boolean;
}
interface VendorTxn {
  id: string; vendorId: string; type: string; amount: number;
  billId?: string | null; reason?: string | null; createdAt: string;
}

interface ModeTotal { mode: string; count: number; total: number; }
interface FinanceSummary {
  from: string;
  to: string;
  moneyIn: {
    totalCollected: number; totalRefunded: number; netCollected: number;
    byMode: ModeTotal[]; refundsByMode: ModeTotal[];
  };
  billed: { grossBilled: number; totalDiscount: number; totalTax: number; count: number };
  moneyOut: { inventorySpend: number; batchCount: number };
  outstanding: number;
  netPosition: number;
}

/**
 * Finance hub — the "financial manager" module. Top-level tabs for each product
 * line (Overall / Lab / IPD / OPD / Pharmacy). Only Lab is live today: an
 * end-to-end view of money IN (collections, by mode) vs money OUT (inventory
 * spend) over a date range, with net position, receivables, and CSV export.
 * The other modules are stubbed until their billing lands.
 */
@Component({
  selector: 'pf-finance-hub',
  standalone: true,
  imports: [FormsModule, DatePipe, CurrencyInrPipe, WalletOutstandingPipe, ScreenHeaderComponent, TileComponent, TouchButtonComponent, HeroBandComponent, SegmentedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-fin pf-band-page">
      @if (theme.isNewDesign()) {
        <!-- Band pill (owner): the product-line switch + the date range ride
             in the pill; the Credit Wallet line adds a partner search. -->
        <pf-hero-band [back]="true" [tabsOnly]="module() !== 'credit'"
                      placeholder="Search partners — name or code…"
                      [value]="partnerQ()" (valueChange)="partnerQ.set($event)">
          <ng-container band-tools>
            <pf-segmented class="pf-fin__bandseg" size="sm" [options]="moduleOptions"
                          [value]="module()" (valueChange)="selectModule($event)"></pf-segmented>
            @if (module() === 'lab' || module() === 'overall') {
              <div class="pf-fin__bandrange" role="group" aria-label="Date range">
                <input type="date" class="pf-fin__bdate" aria-label="From date" [(ngModel)]="fromDate" (change)="customRange()">
                <span class="pf-fin__bdash" aria-hidden="true">–</span>
                <input type="date" class="pf-fin__bdate" aria-label="To date" [(ngModel)]="toDate" (change)="customRange()">
                <pf-segmented size="sm" [options]="quickOptions" [value]="quickDays()"
                              (valueChange)="quick($event)"></pf-segmented>
              </div>
            }
          </ng-container>
          <ng-container band-actions>
            @if ((module() === 'lab' || module() === 'overall') && summary()) {
              <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" (click)="exportCsv()"
                      aria-label="Download CSV" title="Download CSV">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>
                Download CSV
              </button>
            } @else if (module() === 'credit' && vendors().length > 0) {
              <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" (click)="exportWallets()"
                      aria-label="Download CSV" title="Download CSV">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>
                Download CSV
              </button>
            }
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only" eyebrow="Finance" title="Finance"
        subtitle="End-to-end money in vs money out, by product line.">
        @if (module() === 'lab' && summary()) {
          <pf-touch-btn actions size="sm" variant="secondary" (pressed)="exportCsv()">
            <span icon-left aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>
              </svg>
            </span>
            Download CSV
          </pf-touch-btn>
        }
      </pf-screen-header>

      <div class="pf-band-body">
      <!-- Module tabs (classic; the new design has them in the band pill) -->
      <div class="pf-fin__tabs pf-classic-only" role="tablist">
        @for (m of modules; track m.key) {
          <button type="button" class="pf-fin__tab"
                  [class.pf-fin__tab--on]="module() === m.key"
                  (click)="selectModule(m.key)">
            {{ m.label }}
            @if (m.key === 'ipd' || m.key === 'opd' || m.key === 'pharmacy') { <span class="pf-fin__soon">soon</span> }
          </button>
        }
      </div>

      @if (module() === 'lab' || module() === 'overall') {
        @if (module() === 'overall') {
          <p class="pf-fin__note">Showing the <strong>Lab</strong> line. IPD, OPD and Pharmacy roll into this view as their billing goes live.</p>
        }

        <!-- Date range (classic; the new design has it in the band pill) -->
        <div class="pf-fin__range pf-classic-only">
          <label>From <input type="date" [(ngModel)]="fromDate" (change)="load()"></label>
          <label>To <input type="date" [(ngModel)]="toDate" (change)="load()"></label>
          <div class="pf-fin__quick">
            <button type="button" (click)="quick(7)">7d</button>
            <button type="button" (click)="quick(30)">30d</button>
            <button type="button" (click)="quick(90)">90d</button>
          </div>
        </div>

        @if (loading()) {
          <p class="pf-fin__loading">Loading…</p>
        } @else if (summary(); as s) {
          <!-- Headline: net position -->
          <div class="pf-fin__grid">
            <pf-tile tone="default" padding="md">
              <p class="pf-eyebrow">Net position</p>
              <p class="pf-fin__big" [class.pf-fin__big--neg]="s.netPosition < 0">{{ s.netPosition | inr }}</p>
              <p class="pf-fin__sub">Collections − inventory spend</p>
            </pf-tile>
            <pf-tile tone="default" padding="md">
              <p class="pf-eyebrow">Money in (net)</p>
              <p class="pf-fin__big pf-fin__big--pos">{{ s.moneyIn.netCollected | inr }}</p>
              <p class="pf-fin__sub">{{ s.moneyIn.totalCollected | inr }} collected · {{ s.moneyIn.totalRefunded | inr }} refunded</p>
            </pf-tile>
            <pf-tile tone="default" padding="md">
              <p class="pf-eyebrow">Money out</p>
              <p class="pf-fin__big pf-fin__big--neg">{{ s.moneyOut.inventorySpend | inr }}</p>
              <p class="pf-fin__sub">{{ s.moneyOut.batchCount }} inventory receipt(s)</p>
            </pf-tile>
            <pf-tile tone="default" padding="md">
              <p class="pf-eyebrow">Outstanding</p>
              <p class="pf-fin__big">{{ s.outstanding | inr }}</p>
              <p class="pf-fin__sub">Unpaid bill balances (receivable)</p>
            </pf-tile>
          </div>

          <!-- Collections by mode -->
          <pf-tile tone="default" padding="md" class="block mt-4">
            <p class="pf-eyebrow mb-2">Collections by mode</p>
            @if (s.moneyIn.byMode.length === 0) {
              <p class="pf-fin__empty">No collections in this range.</p>
            } @else {
              <ul class="pf-fin__rows">
                @for (r of s.moneyIn.byMode; track r.mode) {
                  <li>
                    <span class="pf-fin__mode">{{ r.mode }}</span>
                    <span class="pf-fin__count">{{ r.count }}×</span>
                    <span class="pf-fin__amt">{{ r.total | inr }}</span>
                  </li>
                }
              </ul>
            }
          </pf-tile>

          <!-- Billed breakdown -->
          <pf-tile tone="default" padding="md" class="block mt-4">
            <p class="pf-eyebrow mb-2">Billed in range</p>
            <ul class="pf-fin__rows">
              <li><span class="pf-fin__mode">Gross billed</span><span class="pf-fin__count">{{ s.billed.count }} bills</span><span class="pf-fin__amt">{{ s.billed.grossBilled | inr }}</span></li>
              <li><span class="pf-fin__mode">Discounts given</span><span class="pf-fin__count"></span><span class="pf-fin__amt">{{ s.billed.totalDiscount | inr }}</span></li>
              <li><span class="pf-fin__mode">Tax (GST)</span><span class="pf-fin__count"></span><span class="pf-fin__amt">{{ s.billed.totalTax | inr }}</span></li>
            </ul>
          </pf-tile>
        }
      } @else if (module() === 'credit') {
        <!-- Credit Wallet ledger: every B2B partner's running tab, with a
             per-vendor transaction trace (charges = money owed to us, top-ups /
             payments = settled). This is the "for this partner, this was
             charged/minused" audit the finance team asked for. -->
        <div class="pf-fin__credit-hdr pf-classic-only">
          <div>
            <p class="pf-fin__credit-title">Credit Wallet ledger</p>
            <p class="pf-fin__sub">Partner running tabs — expand a partner to see every charge and settlement.</p>
          </div>
          @if (vendors().length > 0) {
            <pf-touch-btn size="sm" variant="secondary" (pressed)="exportWallets()">Download CSV</pf-touch-btn>
          }
        </div>

        @if (vendorsLoading()) {
          <p class="pf-fin__loading">Loading partners…</p>
        } @else if (vendors().length === 0) {
          <p class="pf-fin__empty">No credit-wallet partners yet.</p>
        } @else {
          <div class="pf-fin__totals">
            <span>{{ vendors().length }} partner(s)</span>
            <span>Total owed to us: <strong>{{ totalOwed() | inr }}</strong></span>
          </div>
          <ul class="pf-fin__vlist">
            @for (v of visibleVendors(); track v.id) {
              <li class="pf-fin__vitem">
                <button type="button" class="pf-fin__vrow" (click)="toggleVendor(v.id)">
                  <span class="pf-fin__vname">
                    {{ v.name }}@if (v.code) { <span class="pf-fin__vcode">{{ v.code }}</span> }
                  </span>
                  <span class="pf-fin__vbal"
                        [class.pf-fin__vbal--due]="v.outstanding > 0"
                        [class.pf-fin__vbal--credit]="v.outstanding < 0">
                    {{ v.outstanding | walletOutstanding }}
                  </span>
                  <svg class="pf-fin__vchev" [class.pf-fin__vchev--open]="expandedVendor() === v.id" width="16" height="16"
                       viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                       stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
                </button>
                @if (expandedVendor() === v.id) {
                  <div class="pf-fin__vledger">
                    @if (txnsLoading()) {
                      <p class="pf-fin__loading">Loading…</p>
                    } @else if ((vendorTxns()[v.id] ?? []).length === 0) {
                      <p class="pf-fin__empty">No transactions.</p>
                    } @else {
                      <table class="pf-fin__ledger">
                        <tbody>
                          @for (t of vendorTxns()[v.id]; track t.id) {
                            <tr>
                              <td class="pf-fin__lt-date">{{ t.createdAt | date:'dd MMM yy, HH:mm' }}</td>
                              <td class="pf-fin__lt-type" [attr.data-kind]="t.type">{{ t.type }}</td>
                              <td class="pf-fin__lt-reason">{{ t.reason || '—' }}</td>
                              <td class="pf-fin__lt-amt" [class.pf-fin__lt-amt--minus]="t.amount < 0">{{ t.amount | inr }}</td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    }
                  </div>
                }
              </li>
            }
          </ul>
          @if (!visibleVendors().length) {
            <p class="pf-band-empty">No partners match "{{ partnerQ() }}".</p>
          }
        }
      } @else {
        <div class="pf-fin__stub">
          <p class="pf-fin__stub-title">{{ moduleLabel() }} finance — coming soon</p>
          <p class="pf-fin__stub-sub">This module's billing isn't live yet. Its financials will appear here once it's in use.</p>
        </div>
      }
      </div>
    </section>
  `,
  styles: [`
    .pf-fin { padding: 24px 16px 40px; }
    .pf-fin__tabs { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0 18px; }
    .pf-fin__tab {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 16px; border-radius: 12px; font-size: 13px; font-weight: 600;
      color: var(--text-secondary); background: var(--glass-bg); border: 1px solid var(--glass-border);
    }
    .pf-fin__tab--on { color: #fff; background: linear-gradient(135deg, #7c3aed, #a855f7); border-color: transparent; }
    .pf-fin__soon { font-size: 9px; text-transform: uppercase; opacity: 0.6; letter-spacing: 0.04em; }
    .pf-fin__note { font-size: 13px; color: var(--text-secondary); margin-bottom: 14px; }
    .pf-fin__range { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; margin-bottom: 18px; }
    .pf-fin__range label { font-size: 12px; color: var(--text-tertiary); display: inline-flex; gap: 6px; align-items: center; }
    .pf-fin__range input { background: var(--input-bg, rgba(255,255,255,0.03)); border: 1px solid var(--glass-border); border-radius: 8px; padding: 6px 10px; color: var(--text-primary); font-size: 13px; }
    .pf-fin__quick { display: flex; gap: 6px; }
    .pf-fin__quick button { padding: 5px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; color: var(--text-secondary); background: var(--glass-bg); border: 1px solid var(--glass-border); }
    .pf-fin__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
    .pf-fin__big { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text-primary); margin-top: 4px; }
    .pf-fin__big--pos { color: var(--green-text); }
    .pf-fin__big--neg { color: var(--red-text); }
    .pf-fin__sub { font-size: 11.5px; color: var(--text-tertiary); margin-top: 3px; }
    /* Credit Wallet ledger */
    .pf-fin__credit-hdr { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
    .pf-fin__credit-title { font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pf-fin__totals { display: flex; gap: 18px; flex-wrap: wrap; font-size: 12.5px; color: var(--text-secondary); margin-bottom: 12px; }
    .pf-fin__totals strong { color: var(--text-primary); }
    .pf-fin__vlist { list-style: none; display: flex; flex-direction: column; gap: 8px; }
    .pf-fin__vitem { border: 1px solid var(--glass-border); border-radius: 12px; overflow: hidden; background: var(--glass-bg); }
    .pf-fin__vrow { width: 100%; display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 12px; padding: 12px 14px; background: none; border: 0; text-align: left; cursor: pointer; }
    .pf-fin__vname { color: var(--text-primary); font-weight: 600; font-size: 14px; }
    .pf-fin__vcode { margin-left: 8px; font-family: ui-monospace, monospace; font-size: 11px; color: var(--text-tertiary); }
    .pf-fin__vbal { font-variant-numeric: tabular-nums; font-weight: 600; font-size: 13px; color: var(--text-secondary); }
    .pf-fin__vbal--due { color: var(--amber-text); }
    .pf-fin__vbal--credit { color: var(--green-text); }
    .pf-fin__vchev { color: var(--text-muted); transition: transform 0.15s; }
    .pf-fin__vchev--open { transform: rotate(90deg); }
    .pf-fin__vledger { padding: 4px 14px 12px; border-top: 1px solid var(--glass-border); }
    .pf-fin__ledger { width: 100%; border-collapse: collapse; font-size: 12px; }
    .pf-fin__ledger td { padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,0.05); vertical-align: top; }
    .pf-fin__lt-date { color: var(--text-tertiary); white-space: nowrap; }
    .pf-fin__lt-type { text-transform: capitalize; color: var(--text-secondary); }
    .pf-fin__lt-reason { color: var(--text-secondary); }
    .pf-fin__lt-amt { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; color: var(--green-text); white-space: nowrap; }
    .pf-fin__lt-amt--minus { color: var(--red-text); }
    .pf-fin__rows { list-style: none; display: flex; flex-direction: column; gap: 8px; }
    .pf-fin__rows li { display: grid; grid-template-columns: 1fr auto auto; gap: 12px; align-items: center; font-size: 13px; }
    .pf-fin__mode { color: var(--text-primary); text-transform: capitalize; }
    .pf-fin__count { color: var(--text-tertiary); font-size: 12px; }
    .pf-fin__amt { color: var(--text-primary); font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; }
    .pf-fin__empty, .pf-fin__loading { color: var(--text-tertiary); font-size: 13px; }
    .pf-fin__stub { text-align: center; padding: 64px 24px; background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: 16px; }
    .pf-fin__stub-title { font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pf-fin__stub-sub { font-size: 13px; color: var(--text-tertiary); margin-top: 6px; }
    /* Band pill: date range beside the product-line switch. */
    .pf-fin__bandrange { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; margin-left: auto; }
    .pf-fin__bdate {
      height: 32px; padding: 0 8px; border-radius: 9px; font-size: 12.5px; font-family: inherit;
      color: var(--text-primary); background: var(--glass-bg); border: 1px solid var(--glass-border);
      color-scheme: light dark;
    }
    .pf-fin__bdash { color: var(--text-muted); font-size: 12px; }
    .pf-fin__bandseg { flex-shrink: 0; }
    @media (max-width: 640px) {
      .pf-fin__bandrange { margin-left: 0; }
      .pf-fin__bdate { height: 40px; font-size: 16px; }
    }
  
    /* ── Phone + touch (additive; desktop untouched) ───────────── */
    @media (max-width: 640px) {
      .pf-fin__range input { font-size: 16px; min-height: 44px; }
    }
    @media (pointer: coarse) {
      .pf-fin__tab, .pf-fin__quick button { min-height: 44px; }
    }
    /* Long partner names truncate instead of pushing the balance out of the
       card; the ledger scrolls sideways instead of clipping its amount col. */
    .pf-fin__vname { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pf-fin__vledger { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    .pf-fin__ledger { min-width: 340px; }
`]
})
export class FinanceHubComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  protected readonly theme = inject(ThemeService);

  readonly modules: { key: Module; label: string }[] = [
    { key: 'overall', label: 'Overall' },
    { key: 'lab', label: 'Lab' },
    { key: 'credit', label: 'Credit Wallet' },
    { key: 'ipd', label: 'IPD' },
    { key: 'opd', label: 'OPD' },
    { key: 'pharmacy', label: 'Pharmacy' },
  ];
  /** Band pill: product-line switch (lines without billing are marked "soon"). */
  readonly moduleOptions: SegmentedOption<Module>[] = [
    { value: 'overall', label: 'Overall' },
    { value: 'lab', label: 'Lab' },
    { value: 'credit', label: 'Credit Wallet' },
    { value: 'ipd', label: 'IPD', hint: 'IPD finance — coming soon' },
    { value: 'opd', label: 'OPD', hint: 'OPD finance — coming soon' },
    { value: 'pharmacy', label: 'Pharmacy', hint: 'Pharmacy finance — coming soon' },
  ];
  /** Band pill: quick ranges. 0 = a custom from/to. */
  readonly quickOptions: SegmentedOption<number>[] = [
    { value: 7, label: '7d' }, { value: 30, label: '30d' }, { value: 90, label: '90d' },
  ];
  readonly quickDays = signal<number>(30);
  /** Band pill search over the Credit Wallet partners (name / code). */
  readonly partnerQ = signal('');
  readonly module = signal<Module>('lab');
  readonly moduleLabel = computed(() => this.modules.find(m => m.key === this.module())?.label ?? '');

  selectModule(key: Module) {
    this.module.set(key);
    if (key === 'credit') this.loadVendors();
  }

  // ── Credit Wallet ledger state ──────────────────────────
  readonly vendors = signal<Vendor[]>([]);
  readonly vendorsLoading = signal(false);
  private vendorsLoaded = false;
  readonly expandedVendor = signal<string | null>(null);
  readonly vendorTxns = signal<Record<string, VendorTxn[] | undefined>>({});
  readonly txnsLoading = signal(false);
  readonly visibleVendors = computed(() =>
    bandFilter(this.vendors(), this.partnerQ(), (v) => [v.name, v.code]));
  readonly totalOwed = computed(() =>
    this.vendors().reduce((s, v) => s + Math.max(0, v.outstanding), 0));

  fromDate = this.isoDaysAgo(29);
  toDate = this.isoDaysAgo(0);

  readonly loading = signal(false);
  readonly summary = signal<FinanceSummary | null>(null);

  ngOnInit() { this.load(); }

  private isoDaysAgo(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }

  /** A date typed by hand leaves the quick-range chips. */
  customRange() {
    this.quickDays.set(0);
    this.load();
  }

  quick(days: number) {
    this.quickDays.set(days);
    this.fromDate = this.isoDaysAgo(days - 1);
    this.toDate = this.isoDaysAgo(0);
    this.load();
  }

  load() {
    this.loading.set(true);
    this.api.get<FinanceSummary>(`/api/finance/summary?from=${this.fromDate}&to=${this.toDate}`).subscribe({
      next: s => { this.summary.set(s); this.loading.set(false); },
      error: () => { this.loading.set(false); this.toasts.error('Could not load finance summary'); },
    });
  }

  exportCsv() {
    const s = this.summary();
    if (!s) return;
    const rows: Array<Array<unknown>> = [
      ['Prefrontal Lab — Finance summary'],
      ['From', this.fromDate, 'To', this.toDate],
      [],
      ['Money in'],
      ['Total collected', s.moneyIn.totalCollected],
      ['Total refunded', s.moneyIn.totalRefunded],
      ['Net collected', s.moneyIn.netCollected],
      [],
      ['Collections by mode', 'Count', 'Amount'],
      ...s.moneyIn.byMode.map(r => [r.mode, r.count, r.total]),
      [],
      ['Billed', 'Count', 'Amount'],
      ['Gross billed', s.billed.count, s.billed.grossBilled],
      ['Discounts given', '', s.billed.totalDiscount],
      ['Tax (GST)', '', s.billed.totalTax],
      [],
      ['Money out'],
      ['Inventory spend', s.moneyOut.batchCount, s.moneyOut.inventorySpend],
      [],
      ['Outstanding (receivable)', '', s.outstanding],
      ['Net position', '', s.netPosition],
    ];
    downloadCsv(`finance-lab-${this.fromDate}_to_${this.toDate}.csv`, rows);
  }

  // ── Credit Wallet ledger ────────────────────────────────
  loadVendors() {
    // Always refetch when the Credit Wallet tab is opened — charges are accrued
    // in billing, so a once-only cache would show stale balances here.
    this.vendorsLoaded = true;
    if (!this.vendors().length) this.vendorsLoading.set(true);
    this.api.get<Vendor[]>('/api/vendors?includeInactive=true').subscribe({
      next: l => { this.vendors.set(l ?? []); this.vendorsLoading.set(false); },
      error: () => { this.vendorsLoading.set(false); this.toasts.error('Could not load partners'); },
    });
  }

  toggleVendor(id: string) {
    if (this.expandedVendor() === id) { this.expandedVendor.set(null); return; }
    this.expandedVendor.set(id);
    if (this.vendorTxns()[id]) return;   // cached
    this.txnsLoading.set(true);
    this.api.get<VendorTxn[]>(`/api/vendors/${id}/transactions?limit=200`).subscribe({
      next: l => {
        this.vendorTxns.update(m => ({ ...m, [id]: l ?? [] }));
        this.txnsLoading.set(false);
      },
      error: () => { this.txnsLoading.set(false); this.toasts.error('Could not load transactions'); },
    });
  }

  exportWallets() {
    const rows: Array<Array<unknown>> = [
      ['Prefrontal — Credit Wallet ledger'],
      [],
      ['Partner', 'Code', 'Charged', 'Settled', 'Outstanding', 'Status'],
      ...this.vendors().map(v => [
        v.name, v.code ?? '', v.usedCredit, v.totalCredit, v.outstanding,
        v.outstanding > 0 ? 'due' : v.outstanding < 0 ? 'in credit' : 'settled',
      ]),
    ];
    downloadCsv('credit-wallet-ledger.csv', rows);
  }
}
