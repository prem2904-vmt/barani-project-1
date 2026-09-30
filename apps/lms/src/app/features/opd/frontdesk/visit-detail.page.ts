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
import { OpdDeskApi } from './desk-api.service';
import type { DeskDoctor, OpdVisitDetail } from './desk.models';
import { printTokenSlip } from './token-slip';
import { statusWord } from './visit-status';

/**
 * OPD → Visit (`/opd/visit/:id`) — AGENT B. One visit: the token (big, with
 * "Print token slip"), the status timeline, who / what / why, the latest
 * vitals, the OPD bill with its payments and — separately — the lab order's
 * own lab bill. Reassign / cancel from here; live via the WorkHub.
 */
@Component({
  selector: 'pf-opd-visit-detail',
  standalone: true,
  imports: [RouterLink, HeroBandComponent, ScreenHeaderComponent, SkeletonDetailComponent, CurrencyInrPipe, BusyDirective],
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
  protected readonly theme = inject(ThemeService);

  readonly visit = signal<OpdVisitDetail | null>(null);
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
  }

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
    const reason = await this.dialog.prompt({
      title: `Cancel ${v.patient.name}'s visit?`,
      message: v.bill && v.bill.totalPaid > 0 ? 'The paid bill stays as it is — OPD refunds are not built yet.' : undefined,
      placeholder: 'Reason', required: true, tone: 'danger', confirmLabel: 'Cancel visit', cancelLabel: 'Keep',
    });
    if (!reason) return;
    await this.run(() => firstValueFrom(this.desk.move(v.id, 'cancelled', reason)), 'Visit cancelled');
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
