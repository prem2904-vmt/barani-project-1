import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom, forkJoin } from 'rxjs';
import { DialogService } from '../../../core/services/dialog.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { WorkEventsService } from '../../../core/services/work-events.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SkeletonRowsComponent } from '../../../shared/primitives/skeleton-kit.component';
import { TileGridDirective } from '../../../shared/directives/tile-grid.directive';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { ApiError } from '../../../shared/models/api-response.model';
import { labToday } from '../../../shared/utils/lab-clock';
import { OpdDeskApi } from '../frontdesk/desk-api.service';
import type { DeskQueueCfg, OpdVisitRow, QueueDoctor } from '../frontdesk/desk.models';
import { statusWord, waitedLabel } from '../frontdesk/visit-status';

/** Token order inside one doctor's queue: in consult first, then waiting by
 *  token, then the ones still at the desk / vitals. Pure — the spec pins it. */
export function queueOrder(rows: OpdVisitRow[]): OpdVisitRow[] {
  const rank = (s: string) => (s === 'in_consult' ? 0 : s === 'waiting' ? 1 : s === 'vitals' ? 2 : s === 'booked' ? 3 : 4);
  return [...rows].sort((a, b) => rank(a.status) - rank(b.status) || a.token - b.token);
}

/** ISO date (yyyy-mm-dd) `days` after `from`. */
export function addDays(from: string, days: number): string {
  const d = new Date(from + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * OPD → Token queue (`/opd/queue`) — AGENT B. DOCTORS / rooms on the left
 * (now serving, next, counts — the filter companion); the picked doctor's
 * queue as tiles in token order on the right. ONE primary in the band:
 * "Call next · A3". Per tile: change doctor, reschedule. "Doctor unavailable"
 * applies the admin's policy (move to a colleague / reschedule / list only).
 * Live: consult.* WorkEvents refetch the lists (WorkEventsService).
 */
@Component({
  selector: 'pf-opd-token-queue',
  standalone: true,
  imports: [RouterLink, HeroBandComponent, ScreenHeaderComponent, SkeletonRowsComponent, TileGridDirective, BusyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './token-queue.page.html',
  styleUrls: ['../frontdesk/opd-b.scss', './token-queue.page.scss'],
})
export class OpdTokenQueuePage {
  private readonly desk = inject(OpdDeskApi);
  private readonly dialog = inject(DialogService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly work = inject(WorkEventsService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly theme = inject(ThemeService);

  readonly board = signal<QueueDoctor[] | null>(null);
  readonly rows = signal<OpdVisitRow[]>([]);
  readonly queueCfg = signal<DeskQueueCfg | null>(null);
  readonly doctorId = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly calling = signal(false);
  readonly busyId = signal<string | null>(null);
  readonly statusWord = statusWord;
  readonly waited = waitedLabel;

  readonly doctor = computed(() => (this.board() ?? []).find(d => d.id === this.doctorId()) ?? null);
  readonly queue = computed(() => queueOrder(this.rows().filter(r => !this.doctorId() || r.doctorUserId === this.doctorId())));
  readonly waitingCount = computed(() => this.queue().filter(r => ['booked', 'vitals', 'waiting'].includes(r.status)).length);

  constructor() {
    this.load();
    this.desk.desk().subscribe({ next: d => this.queueCfg.set(d.config.queue), error: () => undefined });
    this.work.on('consults').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.load());
  }

  load(): void {
    forkJoin({ board: this.desk.board(), rows: this.desk.queue() }).subscribe({
      next: r => {
        this.board.set(r.board); this.rows.set(r.rows); this.error.set(null);
        if (!this.doctorId()) {
          const first = r.board.find(d => d.waiting + d.inConsult + d.vitals > 0) ?? r.board[0];
          if (first) this.doctorId.set(first.id);
        }
      },
      error: e => this.error.set(ApiError.from(e).message),
    });
  }

  pick(id: string): void { this.doctorId.set(id); }
  open(r: OpdVisitRow): void { void this.router.navigate(['/opd/visit', r.id]); }

  async callNext(): Promise<void> {
    const d = this.doctor(); if (!d) return;
    this.calling.set(true);
    try {
      const v = await firstValueFrom(this.desk.callNext(d.id));
      this.toasts.success(`Token ${v.tokenLabel} — ${v.patient.name} to ${d.name}`);
      this.load();
    } catch (e) { this.toasts.error(ApiError.from(e).message); }
    finally { this.calling.set(false); }
  }

  async reassign(r: OpdVisitRow): Promise<void> {
    const others = (this.board() ?? []).filter(d => d.id !== r.doctorUserId);
    if (!others.length) { this.toasts.info('There is no other doctor to move this patient to.'); return; }
    const to = await this.dialog.choose({
      title: `Move ${r.patientName} to another doctor`,
      message: 'The patient gets a new token in that doctor\'s queue.',
      choices: others.map(d => ({ value: d.id, label: d.name, hint: `${d.department ?? 'OPD'} · ${d.waiting} waiting` })),
      confirmLabel: 'Move patient',
    });
    if (!to) return;
    await this.act(r.id, () => firstValueFrom(this.desk.reassign(r.id, to)), v => `${r.patientName} moved — new token ${v.tokenLabel}`);
  }

  async reschedule(r: OpdVisitRow): Promise<void> {
    const today = labToday();
    const choice = await this.dialog.choose({
      title: `Reschedule ${r.patientName}`,
      message: 'The visit moves to that day with a new token. Tell the patient the new day and token.',
      choices: [1, 2, 3, 7].map(n => ({ value: addDays(today, n), label: this.dayLabel(addDays(today, n)), hint: n === 1 ? 'Tomorrow' : `In ${n} days` })),
      initialChoice: addDays(today, 1), confirmLabel: 'Reschedule',
    });
    if (!choice) return;
    await this.act(r.id, () => firstValueFrom(this.desk.reschedule(r.id, choice)),
      v => `${r.patientName}: ${this.dayLabel(v.visitDate)}, token ${v.tokenLabel}`);
  }

  async doctorUnavailable(): Promise<void> {
    const d = this.doctor(); if (!d) return;
    const def = this.queueCfg()?.doctorUnavailable ?? 'manual';
    const policy = await this.dialog.choose({
      title: `${d.name} is unavailable`,
      message: `${this.waitingCount()} patient(s) are in the queue. The OPD setting is “${this.policyWord(def)}”.`,
      choices: [
        { value: 'auto_move', label: 'Move them to a colleague', hint: 'The least-busy doctor of the same department; new tokens' },
        { value: 'reschedule', label: 'Reschedule to tomorrow', hint: 'Same doctor, tomorrow\'s tokens' },
        { value: 'manual', label: 'Keep them — I will move each one', hint: 'Use Change doctor on each tile' },
      ],
      initialChoice: def, confirmLabel: 'Apply',
    });
    if (!policy || policy === 'manual') return;
    this.calling.set(true);
    try {
      const r = await firstValueFrom(this.desk.doctorUnavailable(d.id, policy));
      const moved = r.moved.length, left = r.unmoved.length;
      this.toasts.success(`${moved} moved${left ? ` · ${left} could not be moved (no colleague in the department)` : ''}`);
      this.load();
    } catch (e) { this.toasts.error(ApiError.from(e).message); }
    finally { this.calling.set(false); }
  }

  private async act<T>(id: string, fn: () => Promise<T>, done: (v: T) => string): Promise<void> {
    this.busyId.set(id);
    try { const v = await fn(); this.toasts.success(done(v)); this.load(); }
    catch (e) { this.toasts.error(ApiError.from(e).message); }
    finally { this.busyId.set(null); }
  }

  policyWord(p: string): string { return p === 'auto_move' ? 'move to a colleague' : p === 'reschedule' ? 'reschedule' : 'move by hand'; }
  dayLabel(iso: string): string { return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); }
  canMove(r: OpdVisitRow): boolean { return ['booked', 'vitals', 'waiting'].includes(r.status); }
}
