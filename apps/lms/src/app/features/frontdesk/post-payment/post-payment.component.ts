import { printTubeLabels } from '../../../shared/utils/print-label';
import { DatePipe, TitleCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { LabelPrintService } from '../../../core/printer/label-print.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { AuthService } from '../../../core/auth/auth.service';
import { Bill } from '../../../shared/models/bill.model';
import { billRoundOff } from '../../../shared/utils/bill-math';
import { Order, OrderSample } from '../../../shared/models/order.model';
import { Patient } from '../../../shared/models/patient.model';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { LabelCardComponent, tubeSpec } from './label-card.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { waLink } from '../../../shared/utils/whatsapp';
import { tubeDepartmentLabel } from '../../../shared/utils/shared-tube';
import { NavBackService } from '../../../core/services/nav-back.service';
import { BusyComponent, SkeletonDetailComponent, SkeletonTilesComponent } from '../../../shared/primitives/skeleton-kit.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { createLoadHold } from '../../../shared/utils/min-duration';
import { formatAge } from '../../../shared/utils/patient-age';
import { DailyNoComponent } from '../../../shared/components/daily-no/daily-no.component';

@Component({
  selector: 'pf-post-payment',
  standalone: true,
  imports: [DailyNoComponent, BusyComponent, BusyDirective, SkeletonDetailComponent, SkeletonTilesComponent,
    DatePipe,
    TitleCasePipe,
    CurrencyInrPipe,
    LabelCardComponent,
    ScreenHeaderComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './post-payment.component.html',
  styleUrl: './post-payment.component.scss',
})
export class PostPaymentComponent implements OnInit {
  private readonly api    = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly route  = inject(ActivatedRoute);
  /** Round-off (±0.xx to the whole-rupee total) — 0 hides the row. */
  roundOffOf(b: Bill): number { return billRoundOff(b); }
  private readonly router = inject(Router);
  private readonly navBack = inject(NavBackService);
  private readonly labCfg  = inject(BranchLabConfigService);
  private readonly process = inject(ProcessWorkflowService);
  private readonly auth    = inject(AuthService);
  private readonly labelPrint = inject(LabelPrintService);

  private readonly _order       = signal<Order | null>(null);
  private readonly _bill        = signal<Bill | null>(null);
  private readonly _selected    = signal<Set<string>>(new Set());
  private readonly _printed     = signal<Set<string>>(new Set());
  private readonly _printingIds = signal<Set<string>>(new Set());
  private readonly _referralLabs = signal<Record<string, string>>({});
  readonly waSent = signal(false);
  /** First load: the label grid + sidebar draw their shape (never blank). */
  private readonly orderHold = createLoadHold(true);
  readonly orderLoading = this.orderHold.active;
  /** "Print N labels" is sending to the station printer. */
  readonly labelsPrinting = signal(false);

  /** Referral-lab name for an outsourced vial (for its label badge). */
  vendorNameFor(s: OrderSample): string | null {
    return s.outsourcedVendorId ? (this._referralLabs()[s.outsourcedVendorId] ?? null) : null;
  }

  readonly order = this._order.asReadonly();
  readonly bill  = this._bill.asReadonly();

  readonly totalCount    = computed(() => this._order()?.samples.length ?? 0);
  readonly printedCount  = computed(() => this._printed().size);
  readonly selectedCount = computed(() => this._selected().size);

  readonly paymentSummary = computed(() => {
    const b = this._bill();
    if (!b) return null;
    const p = b.payments?.[0];
    return {
      amount: b.totalPaid,
      mode:   p?.mode ?? 'Payment',
      ref:    p?.referenceNo ?? null,
      paidAt: p?.paidAt ?? b.createdAt,
    };
  });

  /** Show "Collect sample" when collection happens at the front desk in this
   *  workflow and the user can collect, with samples still pending. */
  readonly canCollectHere = computed(() =>
    this.labCfg.collectsAtFrontdesk() &&
    this.process.isEnabled('sample_collection') &&
    this.auth.hasPermission('collect_sample') &&
    (this._order()?.samples ?? []).some(s => s.status === 'pending'));
  collectSample() {
    const o = this._order();
    if (!o) return;
    this.router.navigate(['/lab/collect'], { queryParams: { orderId: o.id, from: '/frontdesk/post-payment' } });
  }

  /** SVG ring stroke-dashoffset: 0 = full arc, 125.66 = empty. */
  ringOffset(): number {
    const total = this.totalCount();
    if (!total) return 125.66;
    return 125.66 * (1 - this.printedCount() / total);
  }

  ngOnInit() {
    this.labCfg.ensureLoaded();
    this.process.ensureLoaded();
    this.api.get<{ id: string; name: string }[]>('/api/referral-labs?includeInactive=true').subscribe({
      next: labs => this._referralLabs.set(Object.fromEntries((labs ?? []).map(l => [l.id, l.name]))),
      error: () => { /* badges fall back to "OUTSOURCED" */ }
    });
    const id = this.route.snapshot.queryParamMap.get('orderId');
    if (!id) { this.orderHold.cancel(); this.router.navigateByUrl('/frontdesk'); return; }

    this.api.get<Order>(`/api/orders/${id}`).subscribe({
      next: o => {
        this._order.set(o);
        this._selected.set(new Set(o.samples.map(s => s.id)));
        this.orderHold.done();
      },
      error: () => { this.orderHold.done(); this.toasts.error('Could not load order'); },
    });

    this.api.get<Bill[]>('/api/billing/').subscribe({
      next: bills => {
        const bill = (bills ?? []).find(b => b.orderId === id);
        if (bill) this._bill.set(bill);
      },
      error: () => {},
    });
  }

  // ── Selection ──────────────────────────────────────────────
  isSelected(id: string): boolean { return this._selected().has(id); }

  toggleSelect(id: string) {
    this._selected.update(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  clearSelection() { this._selected.set(new Set()); }

  isPrinting(id: string): boolean { return this._printingIds().has(id); }

  // ── Print ──────────────────────────────────────────────────
  printOne(s: OrderSample) {
    this.runLabelPrint([s.id]);
  }

  printSelected() {
    if (this.labelsPrinting()) return;
    this.labelsPrinting.set(true);
    void this.runLabelPrint([...this._selected()]).finally(() => this.labelsPrinting.set(false));
  }

  /** Print the tube labels — ONLY to this station's label printer, via the
   *  shared LabelPrintService (no printer → a dialog, never a fallback print).
   *  A card is marked "printed" only when something actually printed. The
   *  label-sized system dialog (`printTubeLabels`) runs only when a web user
   *  explicitly picks it: the selected cards pick up `printing` first. */
  private async runLabelPrint(ids: string[]) {
    const order = this._order();
    const idSet = new Set(ids);
    const samples = (order?.samples ?? []).filter(s => idSet.has(s.id));
    const outcome = await this.labelPrint.printTubeLabels({
      samples,
      patient: order?.patient ?? null,
      systemPrint: () => {
        this._printingIds.set(idSet);
        setTimeout(() => printTubeLabels(() => this._printingIds.set(new Set())), 50);
      },
    });
    if (outcome === 'printed' || outcome === 'partial' || outcome === 'system') {
      this._printed.update(p => new Set([...p, ...ids]));
    }
  }

  printReceipt() { this.toasts.success('Receipt print · coming soon'); }

  downloadPdf() { this.toasts.success('PDF download · coming soon'); }

  /** Open WhatsApp (wa.me) pre-filled with a payment confirmation for the
   *  patient. The Meta API isn't wired up yet, so this is the click-to-chat
   *  fallback — wa.me can't auto-attach the invoice, so we keep it to a
   *  confirmation message. */
  sendWhatsApp() {
    const o = this._order();
    const b = this._bill();
    const p = o?.patient;
    const lab = this.auth.user()?.tenantName || 'our lab';
    const lines = [
      p?.displayName ? `Hi ${p.displayName},` : 'Hi,',
      `Thank you for your payment at ${lab}.`,
    ];
    if (b) lines.push(`Order #${b.orderId.slice(0, 8)} — Paid ₹${b.totalPayable}.`);
    lines.push('Your report will be shared here once it is ready.');
    window.open(waLink(p?.phone, lines.join('\n\n')), '_blank', 'noopener');
    this.waSent.set(true);
  }

  copyBarcode(barcode: string) {
    navigator.clipboard?.writeText(barcode ?? '').catch(() => {});
    this.toasts.success('Copied');
  }

  back() { this.navBack.backTo('/frontdesk'); }

  // ── Sidebar helpers ────────────────────────────────────────
  initials(name: string | null | undefined): string {
    if (!name) return '?';
    return name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  }

  ageSex(p: Patient | null | undefined): string {
    if (!p) return '';
    const s = p.sex ? p.sex.charAt(0).toUpperCase() : '';
    return [formatAge(p, 'Y') || null, s].filter(Boolean).join(' · ');
  }

  mrn(p: Patient | null | undefined): string {
    return (p as any)?.mrn ?? (p?.id ? p.id.slice(0, 16) : '—');
  }

  tubeColor(s: OrderSample): string { return tubeSpec(s).color; }
  /** Every department on the tube (a shared tube spans several). */
  tubeDeptLabel(s: OrderSample): string { return tubeDepartmentLabel(s); }
  tubeVol(s: OrderSample): string   { return tubeSpec(s).volume; }

}
