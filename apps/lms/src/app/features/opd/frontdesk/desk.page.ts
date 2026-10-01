import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { ThemeService } from '../../../core/services/theme.service';
import { WorkEventsService } from '../../../core/services/work-events.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SkeletonRowsComponent } from '../../../shared/primitives/skeleton-kit.component';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { ApiError } from '../../../shared/models/api-response.model';
import { OpdDeskApi } from './desk-api.service';
import type { OpdVisitRow, PaymentDue, QueueDoctor } from './desk.models';
import { statusWord } from './visit-status';

export type DeskFilter = 'all' | 'waiting' | 'in_consult' | 'done' | 'due';

/** Payments due matching the desk's doctor filter + search (pure; the spec pins it). */
export function dueFilter(rows: PaymentDue[], doctorId: string | null, q: string): PaymentDue[] {
  const s = q.trim().toLowerCase();
  return rows.filter(r => (!doctorId || r.doctorUserId === doctorId) &&
    (!s || r.patientName.toLowerCase().includes(s) || (r.patientMeta ?? '').toLowerCase().includes(s)
      || r.tokenLabel.toLowerCase() === s || (r.visitNumber ?? '').toLowerCase().includes(s) || (r.invoiceNumber ?? '').toLowerCase().includes(s)));
}

/** "Consultation + 2 procedures" — what a due bill is for. */
export function dueWhat(r: Pick<PaymentDue, 'lines'>): string {
  const procs = r.lines.filter(l => l.sourceType === 'procedure').length;
  const consult = r.lines.some(l => l.sourceType === 'service');
  const p = procs ? `${procs} procedure${procs === 1 ? '' : 's'}` : '';
  return consult && p ? `Consultation + ${p}` : consult ? 'Consultation' : p || 'OPD bill';
}

/** Which rows a desk filter keeps (pure; the spec pins it). */
export function deskFilter(rows: OpdVisitRow[], f: DeskFilter, doctorId: string | null, q: string): OpdVisitRow[] {
  const s = q.trim().toLowerCase();
  return rows.filter(r =>
    (!doctorId || r.doctorUserId === doctorId) &&
    (f === 'all' ||
      (f === 'waiting' && ['booked', 'vitals', 'waiting'].includes(r.status)) ||
      (f === 'in_consult' && r.status === 'in_consult') ||
      (f === 'done' && ['completed', 'cancelled', 'no_show'].includes(r.status))) &&
    (!s || r.patientName.toLowerCase().includes(s) || (r.patientMeta ?? '').toLowerCase().includes(s)
        || r.tokenLabel.toLowerCase() === s || (r.visitNumber ?? '').toLowerCase().includes(s)));
}

/**
 * OPD → Desk (`/opd/desk`) — AGENT B. Today's OPD visits at this branch: the
 * DOCTORS companion on the left (now serving / waiting — tap to filter) and
 * the VISITS list (one row per visit: token, full name, meta, status dot +
 * word, fee). The band's ONE primary is "New visit". Live via the WorkHub.
 */
@Component({
  selector: 'pf-opd-desk',
  standalone: true,
  imports: [RouterLink, HeroBandComponent, ScreenHeaderComponent, SkeletonRowsComponent, CurrencyInrPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './desk.page.html',
  styleUrls: ['./opd-b.scss'],
})
export class OpdDeskPage {
  private readonly desk = inject(OpdDeskApi);
  private readonly router = inject(Router);
  private readonly work = inject(WorkEventsService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly theme = inject(ThemeService);

  readonly rows = signal<OpdVisitRow[] | null>(null);
  /** Open visit bills (pay after consult, procedures) — any day, newest first. */
  readonly dues = signal<PaymentDue[]>([]);
  readonly dueWhat = dueWhat;
  readonly shownDues = computed(() => dueFilter(this.dues(), this.doctorId(), this.query()));
  readonly dueTotal = computed(() => this.shownDues().reduce((a, r) => a + r.balance, 0));
  readonly board = signal<QueueDoctor[]>([]);
  readonly error = signal<string | null>(null);
  readonly filter = signal<DeskFilter>('all');
  readonly doctorId = signal<string | null>(null);
  readonly query = signal('');
  readonly statusWord = statusWord;

  readonly shown = computed(() => deskFilter(this.rows() ?? [], this.filter(), this.doctorId(), this.query()));
  readonly counts = computed(() => {
    const all = (this.rows() ?? []).filter(r => !this.doctorId() || r.doctorUserId === this.doctorId());
    return {
      all: all.length,
      waiting: deskFilter(all, 'waiting', null, '').length,
      in_consult: deskFilter(all, 'in_consult', null, '').length,
      done: deskFilter(all, 'done', null, '').length,
      due: dueFilter(this.dues(), this.doctorId(), '').length,
    };
  });
  readonly filters: { id: DeskFilter; label: string }[] = [
    { id: 'all', label: 'All' }, { id: 'waiting', label: 'Waiting' }, { id: 'in_consult', label: 'In consult' }, { id: 'done', label: 'Done' },
    { id: 'due', label: 'Payments due' },
  ];

  constructor() {
    this.load();
    this.work.on('consults').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.load());
  }

  load(): void {
    forkJoin({ rows: this.desk.visits(), board: this.desk.board(), dues: this.desk.paymentsDue().pipe(catchError(() => of([] as PaymentDue[]))) }).subscribe({
      next: r => { this.rows.set(r.rows); this.board.set(r.board); this.dues.set(r.dues ?? []); this.error.set(null); },
      error: e => this.error.set(ApiError.from(e).message),
    });
  }

  pickDoctor(id: string): void { this.doctorId.set(this.doctorId() === id ? null : id); }
  open(r: OpdVisitRow): void { void this.router.navigate(['/opd/visit', r.id]); }
  openDue(r: PaymentDue): void { void this.router.navigate(['/opd/visit', r.visitId]); }
  day(iso: string): string { return new Date(iso.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }
  time(iso: string): string { return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); }
}
