import { DatePipe } from '@angular/common';
import { ThemeService } from '../../../core/services/theme.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { DestroyRef, ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { LiveQueueService } from '../../../core/services/live-queue.service';
import { AuthService } from '../../../core/auth/auth.service';
import { LoadingLogoComponent } from '../../../shared/components/loading-logo/loading-logo.component';

export interface Consultation {
  id: string;
  patientId: string;
  patientName?: string | null;
  patientInfo?: string | null;
  doctorUserId: string;
  doctorName?: string | null;
  status: 'waiting' | 'in_consult' | 'done' | 'cancelled';
  token: number;
  fee: number;
  vitalsJson?: string | null;
  complaintText?: string | null;
  diagnosisText?: string | null;
  adviceText?: string | null;
  prescriptionJson?: string | null;
  followUpDays?: number | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

type QueueFilter = 'all' | 'waiting' | 'in_consult' | 'done';

/**
 * The doctor's day — today's token queue. Waiting patients lead; tapping a
 * card opens the Consult Room. Staff (front desk/admin) see every doctor's
 * queue; a doctor sees their own.
 */
@Component({
  selector: 'pf-doctor-queue',
  standalone: true,
  imports: [DatePipe, LoadingLogoComponent, HeroBandComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-page dq-page">
      @if (theme.isNewDesign()) {
      <!-- Common hero search (designer band): filters the consult queue
           by patient; Refresh rides as the screen's primary action. -->
      <pf-hero-band
        placeholder="Search patient…"
        [value]="query()"
        (valueChange)="query.set($event)">
        <ng-container band-tools>
          <!-- Queue filters live INSIDE the search bar (owner). -->
          <div class="dq-pills dq-pills--band" role="group" aria-label="Filter queue">
            @for (f of filters; track f.key) {
              <button type="button" class="dq-pill press" [class.dq-pill--on]="filter() === f.key"
                      (click)="filter.set(f.key)">
                {{ f.label }}
                @if (f.key !== 'all') { <span class="dq-pill__n">{{ countOf(f.key) }}</span> }
              </button>
            }
          </div>
        </ng-container>
        <ng-container band-actions>
          <button type="button" class="pf-hb-btn pf-hb-btn--primary press" (click)="load()">Refresh</button>
        </ng-container>
      </pf-hero-band>
      }
      <header class="pf-page__header px-4 md:px-8 lg:px-10 pt-4">
        <div class="dq-head" [class.pf-classic-only]="true">
          <div class="min-w-0">
            <h1 class="dq-title">Consult room</h1>
            <p class="dq-sub">{{ today | date:'EEEE, MMM d' }} · {{ counts().waiting }} waiting · {{ counts().done }} seen</p>
          </div>
          <button type="button" class="dq-refresh press" (click)="load()" aria-label="Refresh queue">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>
            Refresh
          </button>
        </div>
        <div class="dq-pills pf-classic-only" role="group" aria-label="Filter queue">
          @for (f of filters; track f.key) {
            <button type="button" class="dq-pill press" [class.dq-pill--on]="filter() === f.key" (click)="filter.set(f.key)">
              {{ f.label }}
              @if (f.key !== 'all') { <span class="dq-pill__n">{{ countOf(f.key) }}</span> }
            </button>
          }
        </div>
      </header>

      <div class="pf-page__body px-4 md:px-8 lg:px-10 pt-2 pb-16">
        @if (loading()) {
          <div class="dq-empty"><pf-loading-logo size="lg" color="purple" [showText]="true" text="Loading queue…"></pf-loading-logo></div>
        } @else if (visible().length === 0) {
          <div class="dq-empty">
            <p class="dq-empty__big">No patients {{ filter() === 'all' ? 'in the queue yet' : 'here' }}.</p>
            <p class="dq-empty__sub">Consultations created at the front desk appear as tokens.</p>
          </div>
        } @else {
          <ul class="dq-grid">
            @for (c of visible(); track c.id) {
              <li>
                <button type="button" class="dq-card press" [attr.data-status]="c.status" (click)="open(c)">
                  <span class="dq-card__token">{{ c.token }}</span>
                  <span class="dq-card__id">
                    <span class="dq-card__name">{{ c.patientName || 'Patient' }}</span>
                    <span class="dq-card__meta">{{ c.patientInfo || '—' }}</span>
                    <span class="dq-card__meta">{{ c.createdAt | date:'h:mm a' }}@if (c.doctorName && !auth.isDoctor()) { · {{ c.doctorName }} }</span>
                  </span>
                  <span class="dq-card__status" [attr.data-status]="c.status">
                    @switch (c.status) {
                      @case ('waiting') { Waiting }
                      @case ('in_consult') { In consult }
                      @case ('done') { Seen }
                      @case ('cancelled') { Cancelled }
                    }
                  </span>
                </button>
              </li>
            }
          </ul>
        }
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; height: 100%; overflow: hidden; }
    .pf-page { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
    .pf-page__header { flex: 0 0 auto; }
    .pf-page__body { flex: 1 1 auto; min-height: 0; overflow-y: auto; }

    .dq-head { display: flex; align-items: center; gap: 12px; padding: 6px 0 4px; }
    .dq-title { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.02em; color: var(--text-primary); }
    .dq-sub { margin: 2px 0 0; font-size: 12.5px; color: var(--text-secondary); }
    .dq-pills--band { margin: 0; flex-wrap: nowrap; }
    .dq-pills--band .dq-pill { height: 28px; padding: 0 10px; font-size: 12px; }
    .dq-refresh { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 14px;
      border-radius: 9999px; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-secondary);
      font-size: 12.5px; font-weight: 600; cursor: pointer; }
    @media (hover: hover) { .dq-refresh:hover { background: var(--glass-bg-hover); color: var(--text-primary); } }

    .dq-pills { display: flex; gap: 6px; padding: 8px 0 10px; flex-wrap: wrap; }
    .dq-pill { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 13px; border-radius: 9999px;
      background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-secondary); font-size: 12.5px;
      font-weight: 600; cursor: pointer; transition: background .15s, color .15s, border-color .15s; }
    .dq-pill--on { background: var(--gradient-primary); color: #fff; border-color: transparent; }
    .dq-pill__n { font-size: 11px; opacity: .8; font-variant-numeric: tabular-nums; }
    @media (hover: hover) { .dq-pill:not(.dq-pill--on):hover { color: var(--text-primary); background: var(--glass-bg-hover); } }

    .dq-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; }
    .dq-card { width: 100%; display: grid; grid-template-columns: 56px minmax(0, 1fr) auto; align-items: center; gap: 12px;
      padding: 14px 16px; border-radius: 16px; background: var(--glass-bg); border: 1px solid var(--glass-border);
      color: var(--text-primary); text-align: left; cursor: pointer; transition: background .15s, border-color .15s, transform 80ms; }
    .dq-card:active { transform: scale(0.995); }
    @media (hover: hover) { .dq-card:hover { background: var(--glass-bg-hover); border-color: var(--glass-border-hover); } }
    .dq-card[data-status='done'] { opacity: .62; }
    .dq-card__token { display: inline-flex; align-items: center; justify-content: center; width: 52px; height: 52px;
      border-radius: 14px; background: rgba(168, 85, 247, 0.12); border: 1px solid rgba(168, 85, 247, 0.3);
      font-size: 21px; font-weight: 800; font-variant-numeric: tabular-nums; color: var(--violet-text, #c4b5fd); }
    .dq-card__id { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .dq-card__name { font-size: 14.5px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dq-card__meta { font-size: 11px; font-family: 'JetBrains Mono', ui-monospace, monospace; color: var(--text-tertiary); }
    .dq-card__status { padding: 3px 10px; border-radius: 9999px; font-size: 10.5px; font-weight: 700; letter-spacing: .06em;
      text-transform: uppercase; border: 1px solid var(--glass-border); color: var(--text-tertiary); white-space: nowrap; }
    .dq-card__status[data-status='waiting']    { color: #d97706; border-color: rgba(245, 158, 11, 0.35); }
    .dq-card__status[data-status='in_consult'] { color: var(--violet-text, #c4b5fd); border-color: rgba(168, 85, 247, 0.4); }
    :root.dark .dq-card__status[data-status='waiting'] { color: #fbbf24; }

    .dq-empty { padding: 60px 0; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 6px; }
    .dq-empty__big { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-secondary); }
    .dq-empty__sub { margin: 0; font-size: 12.5px; color: var(--text-tertiary); }
  `]
})
export class DoctorQueueComponent implements OnInit {
  /** Design gate: the band + title rules are new-design only. */
  readonly theme = inject(ThemeService);
  private readonly api = inject(ApiService);
  private readonly liveQ = inject(LiveQueueService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);

  readonly today = new Date();
  readonly filters: Array<{ key: QueueFilter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'waiting', label: 'Waiting' },
    { key: 'in_consult', label: 'In consult' },
    { key: 'done', label: 'Seen' },
  ];
  readonly filter = signal<QueueFilter>('all');
  readonly loading = signal(true);
  private readonly _rows = signal<Consultation[]>([]);

  /** Band search — patient name, same contract as the other queues. */
  readonly query = signal('');

  readonly visible = computed(() => {
    const f = this.filter();
    const q = this.query().trim().toLowerCase();
    const rows = this._rows();
    const byStatus = f === 'all' ? rows.filter(r => r.status !== 'cancelled') : rows.filter(r => r.status === f);
    return q ? byStatus.filter(r => (r.patientName ?? '').toLowerCase().includes(q)) : byStatus;
  });
  readonly counts = computed(() => ({
    waiting: this._rows().filter(r => r.status === 'waiting').length,
    done: this._rows().filter(r => r.status === 'done').length,
  }));
  countOf(f: QueueFilter): number { return this._rows().filter(r => r.status === f).length; }

  ngOnInit() { this.load();
    // Live queue: refetch when the server says this area changed (no polling).
    this.liveQ.on('consults').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.load()); }
  load() {
    this.loading.set(true);
    this.api.get<Consultation[]>('/api/opd/consultations').subscribe({
      next: rows => { this._rows.set(rows ?? []); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
  open(c: Consultation) { void this.router.navigate(['/doctor/consult', c.id]); }
}
