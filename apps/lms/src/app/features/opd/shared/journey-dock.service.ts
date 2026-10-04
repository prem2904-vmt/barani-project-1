import { Injectable, computed, inject, signal } from '@angular/core';
import { catchError, forkJoin, of } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import type { Order } from '../../../shared/models/order.model';
import type { JourneyAxisEvent } from '../../../shared/components/journey-axis/journey-axis';
import { ConsultApi, type ConsultPastConsult } from '../consult/consult.api';

/** Which encounters the dock shows. */
export type DockFilter = 'all' | 'opd' | 'lab';

/** Local yyyy-mm-dd of a date or date-time (the journey's day key). Pure. */
export function journeyDayKey(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const shortDate = (key: string) => new Date(key + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** The dock's dates: one per day — OPD consults, lab orders, and today. A day
 *  with both is an OPD day (the consult is the bigger event). Pure. */
export function dockEvents(history: readonly Pick<ConsultPastConsult, 'visitId' | 'visitDate'>[], labDays: readonly string[],
  abnormal: ReadonlySet<string>, todayKey: string | null, filter: DockFilter = 'all'): JourneyAxisEvent[] {
  const byDay = new Map<string, JourneyAxisEvent>();
  for (const k of labDays) byDay.set(k, { key: k, date: k, type: 'lab' });
  for (const h of history) { const k = journeyDayKey(h.visitDate); byDay.set(k, { key: k, date: k, type: 'opd' }); }
  if (todayKey) byDay.set(todayKey, { key: todayKey, date: todayKey, type: 'today', label: 'Today' });
  return [...byDay.values()]
    .filter(e => filter === 'all' || e.type === 'today' || e.type === filter)
    .map(e => ({
      ...e,
      label: e.label ?? shortDate(e.key),
      alert: e.type !== 'today' && abnormal.has(e.key),
      title: `${e.type === 'today' ? 'Today' : new Date(e.key + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
        + (e.type === 'opd' ? ' · OPD visit' : e.type === 'lab' ? ' · Lab' : ''),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** The collapsed strip's one line: "4 earlier visits · last 27 Sep · 2 days with high results". Pure. */
export function dockSummary(events: readonly JourneyAxisEvent[]): { text: string; flagged: string | null } {
  const past = events.filter(e => e.type !== 'today');
  if (!past.length) return { text: 'First visit — nothing earlier on record', flagged: null };
  const last = past[past.length - 1];
  const n = past.filter(e => e.alert).length;
  return {
    text: `${past.length} earlier visit${past.length === 1 ? '' : 's'} · last ${shortDate(last.key)}`,
    flagged: n ? `${n} day${n === 1 ? '' : 's'} with results out of range` : null,
  };
}

/** localStorage key of the dock pin (per user). Pure. */
export const dockPinKey = (userId: string | null | undefined) => `pf.opd.dockPin.${userId || 'anon'}`;

/** Unpinned docks fold away while the doctor types; pinned ones stay. Pure. */
export function dockAfterTyping(state: { pinned: boolean; open: boolean }): boolean {
  return state.pinned ? state.open : false;
}

/**
 * The OPD journey dock's shared state (the doctor screens: My patients for
 * the tapped patient, the consult, patient history). Holds the patient, the
 * selected visit date (a date tap on the dock selects that visit — the
 * consult's left VISIT card follows it), the pin (per user, localStorage),
 * open / collapsed, the All / OPD / Lab filter, and the patient's dated
 * history (past OPD consults + lab order days + abnormal-result days).
 */
@Injectable({ providedIn: 'root' })
export class JourneyDockService {
  private readonly consultApi = inject(ConsultApi);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  readonly patient = signal<{ id: string; name: string } | null>(null);
  /** The consult's own visit day (shown as "Today"); null elsewhere. */
  readonly todayKey = signal<string | null>(null);
  readonly selectedKey = signal<string | null>(null);
  readonly filter = signal<DockFilter>('all');
  readonly open = signal(true);
  readonly pinned = signal(true);

  readonly history = signal<ConsultPastConsult[] | null>(null);
  readonly orders = signal<Order[]>([]);
  readonly abnormal = signal<ReadonlySet<string>>(new Set());
  readonly loading = signal(false);
  /** Raw lab trends (the consult's watch line + result trends reuse it). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly trends = signal<any>(null);

  readonly labDays = computed(() => [...new Set(this.orders().map(o => journeyDayKey(o.createdAt)))]);
  readonly allEvents = computed(() => dockEvents(this.history() ?? [], this.labDays(), this.abnormal(), this.todayKey(), 'all'));
  readonly events = computed(() => dockEvents(this.history() ?? [], this.labDays(), this.abnormal(), this.todayKey(), this.filter()));
  readonly summary = computed(() => dockSummary(this.allEvents()));

  private loadedFor: string | null = null;

  constructor() {
    this.pinned.set(this.readPin());
    if (typeof matchMedia === 'function' && matchMedia('(max-width: 600px)').matches) this.open.set(false);
  }

  /** Show the dock for a patient (loads the dated history once per patient). */
  show(p: { id: string; name: string }, todayIso: string | null = null) {
    this.patient.set(p);
    const today = todayIso ? journeyDayKey(todayIso) : null;
    this.todayKey.set(today);
    if (this.loadedFor !== p.id) {
      this.loadedFor = p.id;
      this.selectedKey.set(today);
      this.history.set(null); this.orders.set([]); this.abnormal.set(new Set()); this.trends.set(null);
      this.loading.set(true);
      forkJoin({
        history: this.consultApi.history(p.id).pipe(catchError(() => of([] as ConsultPastConsult[]))),
        patient: this.api.get<{ history?: Order[] }>(`/api/patients/${p.id}`).pipe(catchError(() => of(null))),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        trends: this.api.get<any>(`/api/patients/${p.id}/lab-trends`).pipe(catchError(() => of(null))),
      }).subscribe(r => {
        if (this.loadedFor !== p.id) return;
        this.loading.set(false);
        this.history.set(r.history ?? []);
        this.orders.set(r.patient?.history ?? []);
        this.trends.set(r.trends);
        this.abnormal.set(abnormalDaysOf(r.trends));
      });
    } else if (!this.selectedKey()) this.selectedKey.set(today);
  }
  /** Leave the doctor screen: the dock forgets the patient. */
  hide() { this.patient.set(null); }

  select(key: string) { this.selectedKey.set(key); }
  toggleOpen() { this.open.update(v => !v); }
  togglePin() {
    const v = !this.pinned();
    this.pinned.set(v);
    try { localStorage.setItem(dockPinKey(this.auth.user()?.id), v ? '1' : '0'); } catch { /* private mode */ }
  }
  /** The doctor typed in the consult: an unpinned dock folds away. */
  noteTyping() {
    const next = dockAfterTyping({ pinned: this.pinned(), open: this.open() });
    if (next !== this.open()) this.open.set(next);
  }

  private readPin(): boolean {
    try { const v = localStorage.getItem(dockPinKey(this.auth.user()?.id)); return v == null ? true : v === '1'; } catch { return true; }
  }
}

/** Day keys that had a flagged (not N) lab value — from /lab-trends. Pure. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function abnormalDaysOf(trends: any): Set<string> {
  const days = new Set<string>();
  for (const t of trends?.tests ?? []) for (const p of t.parameters ?? []) for (const pt of p.points ?? []) {
    const f = String(pt.flag ?? '').trim().toUpperCase();
    if (f && f !== 'N' && pt.date) days.add(journeyDayKey(pt.date));
  }
  return days;
}
