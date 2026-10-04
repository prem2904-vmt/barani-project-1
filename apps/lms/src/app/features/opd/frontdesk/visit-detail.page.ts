import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { ThemeService } from '../../../core/services/theme.service';
import { WorkEventsService } from '../../../core/services/work-events.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SkeletonDetailComponent } from '../../../shared/primitives/skeleton-kit.component';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { ApiError } from '../../../shared/models/api-response.model';
import { ApiService } from '../../../core/services/api.service';
import { InlinePaymentPanelComponent, type InlinePaymentResult } from '../../frontdesk/order-create/inline-payment-panel.component';
import { collectDiscountProblem, collectPreview, paymentParts } from './desk-rules';
import { OpdDeskApi } from './desk-api.service';
import type { DeskDoctor, OpdBillView, OpdVisitDetail } from './desk.models';
import { printTokenSlip } from './token-slip';
import { statusWord } from './visit-status';

type RefundChoice = 'cash' | 'upi' | 'card' | 'keep';
/** Cancel with a paid bill: how the money goes back (or stays). */
export const REFUND_CHOICES: { value: RefundChoice; label: string; hint?: string }[] = [
  { value: 'cash', label: 'Refund in cash' },
  { value: 'upi', label: 'Refund by UPI' },
  { value: 'card', label: 'Refund to card' },
  { value: 'keep', label: 'No refund', hint: 'The payment stays on the bill' },
];

/**
 * OPD → Visit (`/opd/visit/:id`) — AGENT B. One visit: the token (big, with
 * "Print token slip"), the status timeline, who / what / why, the latest
 * vitals, the OPD bill with its payments and — separately — the lab order's
 * own lab bill. Reassign / cancel from here; live via the WorkHub.
 */
@Component({
  selector: 'pf-opd-visit-detail',
  standalone: true,
  imports: [RouterLink, HeroBandComponent, ScreenHeaderComponent, SkeletonDetailComponent, CurrencyInrPipe, BusyDirective, InlinePaymentPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './visit-detail.page.html',
  styleUrls: ['./opd-b.scss', './visit-detail.page.scss'],
})
export class OpdVisitDetailPage {
  private readonly desk = inject(OpdDeskApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);
  private readonly toasts = inject(ToastService);
  private readonly work = inject(WorkEventsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(ApiService);
  protected readonly theme = inject(ThemeService);

  readonly visit = signal<OpdVisitDetail | null>(null);
  /** Every OPD bill of the visit (older servers: just the consult bill). */
  readonly bills = computed<OpdBillView[]>(() => { const v = this.visit(); return v?.bills?.length ? v.bills : v?.bill ? [v.bill] : []; });
  /** The first bill with something to collect (consult first). */
  readonly dueBill = computed(() => this.bills().find(b => (b.status === 'pending' || b.status === 'partial') && b.balance > 0) ?? null);
  readonly due = computed(() => this.visit()?.due ?? this.bills().filter(b => b.status === 'pending' || b.status === 'partial').reduce((a, b) => a + b.balance, 0));
  /** Collecting: the desk's ₹ discount (blank = none / keep), reason, amount now. */
  readonly collecting = signal(false);
  readonly discountRaw = signal('');
  readonly discountReason = signal('');
  readonly amountRaw = signal('');
  private readonly maxDiscountPct = signal(100);
  private readonly overrideDiscountPct = signal(100);
  /** The role's discount cap — same rule as the lab bill (override → Level 2, give → Level 1, else 0). */
  readonly discountCapPct = computed(() => this.auth.hasPermission('override_discount') ? this.overrideDiscountPct()
    : this.auth.hasPermission('give_discount') ? this.maxDiscountPct() : 0);
  readonly discountNum = computed(() => { const t = this.discountRaw().trim(); if (!t) return null; const n = Number(t.replace(/[₹,\s]/g, '')); return Number.isFinite(n) ? n : NaN; });
  readonly preview = computed(() => { const b = this.dueBill(); return b ? collectPreview(b, this.discountNum() == null || Number.isNaN(this.discountNum()!) ? null : this.discountNum()) : null; });
  readonly discountErr = computed(() => {
    const b = this.dueBill(); const d = this.discountNum();
    if (!b || d == null) return null;
    if (Number.isNaN(d)) return 'Type the discount in rupees.';
    return d === (b.discount || 0) ? null : collectDiscountProblem(b, d, this.discountCapPct());
  });
  /** What is taken now (partial allowed): blank = the whole balance. */
  readonly amountNow = computed(() => {
    const bal = this.preview()?.balance ?? 0;
    const t = this.amountRaw().trim();
    if (!t) return bal;
    const n = Math.round(Number(t.replace(/[₹,\s]/g, '')) * 100) / 100;
    return Number.isFinite(n) ? n : NaN;
  });
  readonly amountErr = computed(() => {
    const a = this.amountNow(), bal = this.preview()?.balance ?? 0;
    if (Number.isNaN(a) || a <= 0) return 'Type the amount taken now.';
    return a > bal + 0.005 ? `Only ₹${bal} is due on this bill.` : null;
  });
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly printing = signal(false);
  readonly issued = signal(false);
  readonly statusWord = statusWord;

  readonly open = computed(() => ['booked', 'vitals', 'waiting'].includes(this.visit()?.status ?? ''));
  readonly vitals = computed(() => this.visit()?.latestVitals ?? null);

  private id = '';

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(pm => {
      this.id = pm.get('id') ?? '';
      this.issued.set(this.route.snapshot.queryParamMap.get('issued') === '1');
      this.visit.set(null);
      this.load();
    });
    this.work.on('consults').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.load());
    this.api.get<{ maxDiscountPct?: number; overrideDiscountPct?: number }>('/api/config/billing/visibility').subscribe({
      next: c => {
        if (typeof c?.maxDiscountPct === 'number') this.maxDiscountPct.set(c.maxDiscountPct);
        if (typeof c?.overrideDiscountPct === 'number') this.overrideDiscountPct.set(c.overrideDiscountPct);
      },
      error: () => { /* caps stay at the role default */ },
    });
  }

  startCollect(): void { this.discountRaw.set(''); this.discountReason.set(''); this.amountRaw.set(''); this.collecting.set(true); }

  /** The inline payment panel confirmed: post the tender (and any discount) against the due bill. */
  async collect(r: InlinePaymentResult): Promise<void> {
    const v = this.visit(), b = this.dueBill();
    if (!v || !b || this.discountErr() || this.amountErr()) return;
    const parts = paymentParts(r, this.amountNow());
    if (parts === null) { this.toasts.error('Take cash, UPI or card at the OPD desk.'); return; }
    const d = this.discountNum();
    this.busy.set(true);
    try {
      const after = await firstValueFrom(this.desk.pay(v.id, b.id, {
        discount: d == null || Number.isNaN(d) ? null : d, discountReason: this.discountReason().trim() || null, payments: parts,
      }));
      this.visit.set(after);
      this.collecting.set(false);
      const left = after.due ?? 0;
      this.toasts.success(left > 0 ? `₹${parts.reduce((a, p) => a + p.amount, 0)} collected · ₹${left} still due` : 'Paid in full');
    } catch (e) { this.toasts.error(ApiError.from(e).message); }
    finally { this.busy.set(false); }
  }

  kindWord(k: string): string { return k === 'procedure' ? 'Procedures' : k === 'consult' ? 'Consultation' : k; }

  load(): void {
    if (!this.id) return;
    this.desk.visit(this.id).subscribe({
      next: v => { this.visit.set(v); this.error.set(null); },
      error: e => this.error.set(ApiError.from(e).message || 'This visit could not be opened.'),
    });
  }

  fmtTime(iso?: string | null): string {
    return iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '';
  }
  fmtDate(iso: string): string {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  modeWord(m: string): string { return m === 'upi' ? 'UPI' : m.charAt(0).toUpperCase() + m.slice(1); }

  async print(): Promise<void> {
    const v = this.visit(); if (!v) return;
    this.printing.set(true);
    try { await printTokenSlip(v, this.auth.user()?.tenantName ?? ''); }
    catch { this.toasts.error('The token slip could not be printed.'); }
    finally { this.printing.set(false); }
  }

  async reassign(): Promise<void> {
    const v = this.visit(); if (!v) return;
    let doctors: DeskDoctor[] = [];
    try { doctors = (await firstValueFrom(this.desk.desk())).doctors.filter(d => d.id !== v.doctor.id); } catch { /* handled below */ }
    if (!doctors.length) { this.toasts.info('There is no other doctor to move this patient to.'); return; }
    const to = await this.dialog.choose({
      title: `Move ${v.patient.name} to another doctor`,
      message: 'The patient gets a new token in that doctor\'s queue. The bill stays as paid.',
      choices: doctors.map(d => ({ value: d.id, label: d.name, hint: `${d.department ?? 'OPD'} · ${d.waiting} waiting` })),
      confirmLabel: 'Move patient',
    });
    if (!to) return;
    await this.run(() => firstValueFrom(this.desk.reassign(v.id, to)), 'Moved — new token issued');
  }

  async cancel(): Promise<void> {
    const v = this.visit(); if (!v) return;
    const refundable = v.bill ? Math.max(0, v.bill.totalPaid - (v.bill.refunded ?? 0)) : 0;
    const reason = await this.dialog.prompt({
      title: `Cancel ${v.patient.name}'s visit?`,
      placeholder: 'Reason', required: true, tone: 'danger', confirmLabel: 'Cancel visit', cancelLabel: 'Keep',
    });
    if (!reason) return;
    // Paid? Give the money back as a credit note (the bill itself never changes), or keep it.
    let refund: RefundChoice | null = null;
    if (refundable > 0) {
      const pick = await this.dialog.choose({
        title: `Refund ₹${refundable}?`,
        message: 'A refund is recorded as a credit note against the bill.',
        choices: REFUND_CHOICES,
        confirmLabel: 'Cancel visit',
      });
      if (!pick) return;
      refund = pick as RefundChoice;
    }
    await this.run(() => firstValueFrom(this.desk.move(v.id, 'cancelled', reason,
      refund && refund !== 'keep' ? { refund: true, refundMode: refund } : undefined)),
      refund && refund !== 'keep' ? `Visit cancelled · ₹${refundable} refunded` : 'Visit cancelled');
  }

  async noShow(): Promise<void> {
    const v = this.visit(); if (!v) return;
    const ok = await this.dialog.confirm({ title: `Mark ${v.patient.name} as not come?`, confirmLabel: 'Did not come', tone: 'danger' });
    if (!ok) return;
    await this.run(() => firstValueFrom(this.desk.move(v.id, 'no_show', 'Did not come')), 'Marked as not come');
  }

  private async run(fn: () => Promise<OpdVisitDetail>, done: string): Promise<void> {
    this.busy.set(true);
    try { this.visit.set(await fn()); this.toasts.success(done); }
    catch (e) { this.toasts.error(ApiError.from(e).message); }
    finally { this.busy.set(false); }
  }

  nextPatient(): void { void this.router.navigate(['/opd/visit/new']); }
}
