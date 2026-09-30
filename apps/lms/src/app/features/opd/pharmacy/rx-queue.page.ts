import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { SkeletonRowsComponent } from '../../../shared/primitives/skeleton-kit.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { heldFlag } from '../../../shared/utils/min-duration';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { PharmacyApi, type DispenseSummary, type PayMode, type RxQueueRow } from './pharmacy.api';
import { PharmacySectionsComponent } from './pharmacy-sections.component';
import { errText, inr } from './pharmacy-math';

/** "12 min" / "2 h 5 min" / "3 d" since an ISO instant. */
export function waitingFor(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}`;
  return `${Math.floor(m / 1440)} d`;
}

/**
 * Pharmacy → Prescriptions (`/opd/pharmacy`): completed consults whose Rx is
 * still to be dispensed at THIS branch, oldest first (main card), and today's
 * sales (side card). Tapping a prescription opens the dispense screen.
 */
@Component({
  selector: 'pf-pharmacy-rx-queue',
  standalone: true,
  imports: [HeroBandComponent, PharmacySectionsComponent, SkeletonRowsComponent, BusyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./pharmacy.scss'],
  template: `
    <section class="pf-band-page ph">
      <pf-hero-band [back]="true" backTo="/opd" [customSearch]="true">
        <label band-search class="ph-search">
          <svg class="ph-search__glass" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input class="ph-search__input" type="search" placeholder="Find a prescription — patient, visit no., doctor"
                 aria-label="Find a prescription" [value]="q()" (input)="q.set($any($event.target).value)" />
        </label>
        <pf-pharmacy-sections band-tools active="dispense"></pf-pharmacy-sections>
        <ng-container band-actions>
          <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" (click)="go('/opd/pharmacy/counter')" aria-label="Walk-in counter">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            Walk-in sale
          </button>
        </ng-container>
      </pf-hero-band>

      <div class="ph-body">
        <section class="nd-card" aria-labelledby="ph-q-t">
          <header class="nd-card__head">
            <span class="nd-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7Z"/><path d="m8.5 8.5 7 7"/></svg></span>
            <span class="nd-card__label" id="ph-q-t">Waiting to dispense</span>
            <span class="nd-card__spacer"></span>
            <span class="ph-sub nd-num">{{ rows().length }} {{ rows().length === 1 ? 'prescription' : 'prescriptions' }}</span>
          </header>
          <div class="nd-card__body">
            @if (showSkeleton()) {
              <pf-skeleton-rows [rows]="5" label="Loading prescriptions…"></pf-skeleton-rows>
            } @else if (error()) {
              <div class="nd-empty"><p class="nd-empty__title">Couldn't load the queue</p><p class="nd-empty__body">{{ error() }}</p>
                <button type="button" class="nd-btn nd-btn--secondary nd-empty__action" (click)="load()">Try again</button></div>
            } @else if (!rows().length) {
              <div class="nd-empty">
                <span class="nd-empty__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
                <p class="nd-empty__title">{{ q() ? 'No prescription matches' : 'No prescriptions waiting' }}</p>
                <p class="nd-empty__body">When a doctor completes a consult with medicines, it appears here.</p>
              </div>
            } @else {
              <ul class="ph-list" aria-label="Prescriptions waiting">
                @for (r of rows(); track r.visitId) {
                  <li>
                    <button type="button" class="ph-row press" (click)="open(r)">
                      <span class="ph-row__main">
                        <span class="ph-row__name">{{ r.patientName }}</span>
                        <span class="ph-row__meta nd-num">{{ meta(r) }}</span>
                      </span>
                      <span class="ph-row__end">
                        <span class="ph-dot" [attr.data-tone]="r.status === 'partial' ? 'warn' : null">{{ r.status === 'partial' ? 'Part given' : 'New' }} · {{ r.pending }} of {{ r.lines }}</span>
                        <span class="ph-sub nd-num">{{ wait(r) }}</span>
                      </span>
                    </button>
                  </li>
                }
              </ul>
            }
          </div>
        </section>

        <aside class="nd-card" aria-labelledby="ph-today-t">
          <header class="nd-card__head">
            <span class="nd-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h4"/></svg></span>
            <span class="nd-card__label" id="ph-today-t">Today</span>
            <span class="nd-card__spacer"></span>
            <span class="ph-sub nd-num">{{ inr(todayTotal(), false) }}</span>
          </header>
          <div class="nd-card__body">
            @for (d of today(); track d.id) {
              <div class="ph-row" style="cursor:default">
                <span class="ph-row__main">
                  <span class="ph-row__name">{{ d.customerName || (d.kind === 'rx' ? 'Prescription' : 'Walk-in customer') }}</span>
                  <span class="ph-row__meta nd-num">{{ d.number || 'Draft' }} · {{ d.kind === 'rx' ? 'Prescription' : 'Counter' }} · {{ d.lines }} {{ d.lines === 1 ? 'item' : 'items' }}</span>
                </span>
                <span class="ph-row__end">
                  <span class="nd-num ph-strong">{{ inr(d.total) }}</span>
                  <span class="ph-dot" [attr.data-tone]="d.status === 'completed' ? 'done' : d.status === 'cancelled' ? 'bad' : 'warn'">{{ statusWord(d) }}</span>
                  @if (due(d) > 0) {
                    <button type="button" class="nd-btn nd-btn--tertiary" [disabled]="collecting() === d.id" [pfBusy]="collecting() === d.id" pfBusyLabel="Collecting…" (click)="collect(d)">Collect payment</button>
                  }
                </span>
              </div>
            } @empty {
              <p class="ph-sub ph-empty-pad">Nothing sold yet today.</p>
            }
          </div>
        </aside>
      </div>
    </section>
  `,
})
export class PharmacyRxQueuePage {
  private readonly api = inject(PharmacyApi);
  private readonly router = inject(Router);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);

  protected readonly q = signal('');
  private readonly all = signal<RxQueueRow[]>([]);
  protected readonly today = signal<DispenseSummary[]>([]);
  private readonly loading = signal(true);
  protected readonly showSkeleton = heldFlag(this.loading);
  protected readonly error = signal<string | null>(null);
  protected readonly inr = inr;
  /** The dispense id currently collecting a payment (disables its own button only). */
  protected readonly collecting = signal<string | null>(null);

  protected readonly rows = computed(() => {
    const t = this.q().trim().toLowerCase();
    return !t ? this.all() : this.all().filter(r =>
      (r.patientName + ' ' + (r.visitNumber ?? '') + ' ' + r.doctorName + ' ' + (r.patientMeta ?? '')).toLowerCase().includes(t));
  });
  protected readonly todayTotal = computed(() => this.today().filter(d => d.status === 'completed').reduce((a, d) => a + d.total, 0));

  constructor() { this.load(); }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.rxQueue().subscribe({
      next: r => { this.all.set(r); this.loading.set(false); },
      error: e => { this.error.set(errText(e)); this.loading.set(false); },
    });
    this.api.dispenses().subscribe({ next: d => this.today.set(d), error: () => this.today.set([]) });
  }

  protected meta(r: RxQueueRow): string {
    return [r.patientMeta, r.visitNumber, r.doctorName].filter(Boolean).join(' · ');
  }
  protected wait(r: RxQueueRow): string { return r.completedAt ? 'waiting ' + waitingFor(r.completedAt) : ''; }
  protected statusWord(d: DispenseSummary): string {
    return d.status === 'completed' ? (d.paid >= d.total ? 'Paid' : 'Due ' + inr(d.total - d.paid, false)) : d.status === 'draft' ? 'Open bill' : 'Cancelled';
  }
  protected open(r: RxQueueRow): void { void this.router.navigate(['/opd/pharmacy/dispense', r.visitId]); }
  protected go(path: string): void { void this.router.navigateByUrl(path); }

  /** Balance still owed on a completed sale (0 for a draft / cancelled one). */
  protected due(d: DispenseSummary): number { return d.status === 'completed' ? Math.max(0, d.total - d.paid) : 0; }

  /** Collect the full balance of a "bill later" sale (P0 money gap) — pick a
   *  mode (no native controls: DialogService), then the SAME pay endpoint the
   *  dispense / counter screens use. */
  protected async collect(d: DispenseSummary): Promise<void> {
    const amount = this.due(d);
    if (amount <= 0 || this.collecting()) return;
    const mode = await this.dialog.choose({
      title: `Collect ${inr(amount, false)}`,
      message: d.customerName ? `From ${d.customerName} · ${d.number ?? 'this sale'}` : d.number ?? 'This sale',
      choices: [{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }],
      confirmLabel: 'Collect',
    });
    if (!mode) return;
    this.collecting.set(d.id);
    this.api.payDispense(d.id, { mode: mode as PayMode, amount }).subscribe({
      next: () => { this.collecting.set(null); this.toast.success(`${inr(amount, false)} collected`); this.load(); },
      error: e => { this.collecting.set(null); this.toast.error(errText(e)); },
    });
  }
}
