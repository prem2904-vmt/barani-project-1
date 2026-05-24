import { DatePipe, TitleCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { Bill } from '../../../shared/models/bill.model';
import { Order, OrderSample } from '../../../shared/models/order.model';
import { Patient } from '../../../shared/models/patient.model';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { LabelCardComponent, tubeSpec } from './label-card.component';
import { LoadingLogoComponent } from '../../../shared/components/loading-logo/loading-logo.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

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

  private readonly _order       = signal<Order | null>(null);
  private readonly _bill        = signal<Bill | null>(null);
  private readonly _selected    = signal<Set<string>>(new Set());
  private readonly _printed     = signal<Set<string>>(new Set());
  private readonly _printingIds = signal<Set<string>>(new Set());
  readonly waSent = signal(false);

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

  /** SVG ring stroke-dashoffset: 0 = full arc, 125.66 = empty. */
  ringOffset(): number {
    const total = this.totalCount();
    if (!total) return 125.66;
    return 125.66 * (1 - this.printedCount() / total);
  }

  ngOnInit() {
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
    window.addEventListener('afterprint', () => this._printingIds.set(new Set()), { once: true });
    setTimeout(() => window.print(), 50);
  }

  printSelected() {
    const ids = [...this._selected()];
    this._printed.update(p => new Set([...p, ...ids]));
    this._printingIds.set(new Set(ids));
    window.addEventListener('afterprint', () => this._printingIds.set(new Set()), { once: true });
    setTimeout(() => window.print(), 50);
  }

  printReceipt() { this.toasts.success('Receipt print · coming soon'); }

  downloadPdf() { this.toasts.success('PDF download · coming soon'); }

  sendWhatsApp() {
    this.waSent.set(true);
    this.toasts.success('WhatsApp confirmation queued');
  }

  copyBarcode(barcode: string) {
    navigator.clipboard?.writeText(barcode ?? '').catch(() => {});
    this.toasts.success('Copied');
  }

  back() { this.router.navigateByUrl('/frontdesk'); }

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
