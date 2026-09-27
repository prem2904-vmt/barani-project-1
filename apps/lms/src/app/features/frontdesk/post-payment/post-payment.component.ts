import { DatePipe, TitleCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { PrinterService } from '../../../core/printer/printer.service';
import { PrintConfigService } from '../../../core/printer/print-config.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { AuthService } from '../../../core/auth/auth.service';
import { Bill } from '../../../shared/models/bill.model';
import { Order, OrderSample } from '../../../shared/models/order.model';
import { Patient } from '../../../shared/models/patient.model';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { LabelCardComponent, labelTubeLine, tubeSpec } from './label-card.component';
import { LoadingLogoComponent } from '../../../shared/components/loading-logo/loading-logo.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { waLink } from '../../../shared/utils/whatsapp';
import { NavBackService } from '../../../core/services/nav-back.service';

@Component({
  selector: 'pf-post-payment',
  standalone: true,
  imports: [
    DatePipe,
    TitleCasePipe,
    CurrencyInrPipe,
    LabelCardComponent,
    LoadingLogoComponent,
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
  private readonly router = inject(Router);
  private readonly navBack = inject(NavBackService);
  private readonly labCfg  = inject(BranchLabConfigService);
  private readonly process = inject(ProcessWorkflowService);
  private readonly auth    = inject(AuthService);
  private readonly printer = inject(PrinterService);
  private readonly printConfig = inject(PrintConfigService);

  private readonly _order       = signal<Order | null>(null);
  private readonly _bill        = signal<Bill | null>(null);
  private readonly _selected    = signal<Set<string>>(new Set());
  private readonly _printed     = signal<Set<string>>(new Set());
  private readonly _printingIds = signal<Set<string>>(new Set());
  private readonly _referralLabs = signal<Record<string, string>>({});
  readonly waSent = signal(false);

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
    if (!id) { this.router.navigateByUrl('/frontdesk'); return; }

    this.api.get<Order>(`/api/orders/${id}`).subscribe({
      next: o => {
        this._order.set(o);
        this._selected.set(new Set(o.samples.map(s => s.id)));
      },
      error: () => this.toasts.error('Could not load order'),
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
    this._printed.update(p => new Set([...p, s.id]));
    this._printingIds.set(new Set([s.id]));
    this.runLabelPrint();
  }

  printSelected() {
    const ids = [...this._selected()];
    this._printed.update(p => new Set([...p, ...ids]));
    this._printingIds.set(new Set(ids));
    this.runLabelPrint();
  }

  /** Print the tube labels. When a directly-driven printer is present
   *  (Electron USB / iPad BLE) we render each label at the branch's configured
   *  size + single code type and stream it straight to the printer. Otherwise
   *  we fall back to the browser print dialog (`pf-printing-label` hides
   *  everything except the `.pf-print-label` grid). */
  private runLabelPrint() {
    if (this.printer.directPrintAvailable()) {
      void this.runDirectPrint();
      return;
    }
    document.body.classList.add('pf-printing-label');
    const done = () => {
      this._printingIds.set(new Set());
      document.body.classList.remove('pf-printing-label');
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 50);
    setTimeout(done, 2000);
  }

  private async runDirectPrint() {
    const opts = this.printConfig.labelOpts();
    const order = this._order();
    const patient = order?.patient ?? null;
    const ids = this._printingIds();
    const samples = (order?.samples ?? []).filter(s => ids.has(s.id));
    if (samples.length) this.toasts.info(`Printing ${samples.length} label${samples.length > 1 ? 's' : ''}…`);
    let ok = 0, fail = 0;
    for (const s of samples) {
      const code = s.barcode ?? s.id;
      const mrn = (patient as unknown as { mrn?: string })?.mrn;
      const res = await this.printer.printLabelData({
        code,
        qrValue: mrn ? `${mrn}|${code}` : code,
        patientName: patient?.displayName ?? 'Patient',
        ageSex: this.ageSex(patient),
        mrn: mrn ?? undefined,
        deptCode: (s.department?.code ?? '').toUpperCase(),
        tube: labelTubeLine(s),
        outsourced: !!s.outsourcedVendorId,
      }, opts).catch(e => ({ ok: false, direct: true, error: e?.message }));
      if (res.ok) ok++; else { fail++; if (res.error) this.toasts.error(res.error); }
    }
    this._printingIds.set(new Set());
    if (ok) this.toasts.success(`Printed ${ok} label${ok > 1 ? 's' : ''}`);
    if (fail && !ok) this.toasts.error('Label print failed');
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
    const age = p.age ?? (p.dateOfBirth ? this.calcAge(p.dateOfBirth) : null);
    const s = p.sex ? p.sex.charAt(0).toUpperCase() : '';
    return [age ? `${age}Y` : null, s].filter(Boolean).join(' · ');
  }

  mrn(p: Patient | null | undefined): string {
    return (p as any)?.mrn ?? (p?.id ? p.id.slice(0, 16) : '—');
  }

  tubeColor(s: OrderSample): string { return tubeSpec(s).color; }
  tubeVol(s: OrderSample): string   { return tubeSpec(s).volume; }

  private calcAge(dob: string): number {
    const d = new Date(dob);
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    return age;
  }
}
