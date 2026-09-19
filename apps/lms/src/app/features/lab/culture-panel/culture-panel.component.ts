import { ChangeDetectionStrategy, Component, DestroyRef, OnDestroy, OnInit, output, signal, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { LiveQueueService } from '../../../core/services/live-queue.service';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { SkeletonComponent } from '../../../shared/primitives/skeleton.component';

/** One stage inside a culture case (mirrors the backend CultureStage JSON). */
export interface CultureStageView {
  key: string;
  label: string;
  state: 'open' | 'picked' | 'done';
  holderUserId?: string | null;
  holderName?: string | null;
  pickedAt?: string | null;
  doneAt?: string | null;
  doneByUserId?: string | null;
  doneByName?: string | null;
  valuesJson?: string | null;
  /** When set + in the future, the plate is incubating (stage not yet readable). */
  incubateUntil?: string | null;
}

/** A culture case row (mirrors the backend CultureCaseDto). */
export interface CultureCaseView {
  /** Branching (git-style): id + parent link + branch name; the root GET
   *  carries every subculture flat in subCultures. */
  id?: string | null;
  parentCaseId?: string | null;
  label?: string | null;
  subCultures?: CultureCaseView[] | null;
  /** CASE-LEVEL incubation reference timer (never a lock). */
  incubateUntil?: string | null;
  /** The ordered test's specimen (picked at billing, editable at the bench). */
  specimen?: string | null;
  orderTestId: string;
  caseState: string;
  sampleId?: string | null;
  barcode?: string | null;
  patientName?: string | null;
  testName?: string | null;
  departmentName?: string | null;
  createdAt: string;
  prelimReportedAt?: string | null;
  finalReportedAt?: string | null;
  stages: CultureStageView[];
}

/**
 * The CULTURE panel — the 4th tab in Lab My Work, shown only to micro-tech
 * users. Culture cases are shared, multi-day, multi-person: each card is one
 * sample ID showing where it is across its stages (Gram → Growth → ID → AST),
 * who currently holds a stage, and how many days it's been running. ONE tap on
 * a card opens the bench workspace for that case (no per-stage picking here —
 * the first touch inside the bench locks a stage). A resting plate shows its
 * live incubation countdown right on the card.
 *
 * Lives beside the existing queue (additive) — the case data comes from
 * GET /api/microbiology/culture-queue; the normal my-work/service queues no
 * longer list culture lines (they're excluded server-side).
 */
@Component({
  selector: 'pf-culture-panel',
  standalone: true,
  imports: [TileComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading() && cases().length === 0) {
      <div class="flex flex-col gap-3">
        @for (i of [0,1,2]; track i) {
          <pf-tile tone="default" padding="md">
            <pf-skeleton variant="line" width="45%"></pf-skeleton>
            <div class="mt-2"><pf-skeleton variant="line" width="75%" height="10px"></pf-skeleton></div>
          </pf-tile>
        }
      </div>
    } @else if (cases().length === 0) {
      <pf-tile tone="default" padding="xl">
        <p class="text-center text-sm" style="color: var(--text-tertiary);">
          No culture cases in progress.
        </p>
      </pf-tile>
    } @else {
      <ul class="flex flex-col gap-3 list-none p-0 m-0">
        @for (c of cases(); track c.orderTestId) {
          @let inc = incubatingStage(c);
          <li class="pf-cc" [class.pf-cc--incub]="!!inc">
            <span class="pf-cc__cap" aria-hidden="true"></span>
            <!-- The whole card is the one control: tap → bench workspace. -->
            <button type="button" class="pf-cc__hdr press" (click)="open(c)" [title]="'Open ' + (c.barcode || c.sampleId || 'case')">
              <span class="pf-cc__main">
                <span class="pf-cc__line">
                  <span class="pf-cc__id">{{ c.barcode || c.sampleId || '—' }}</span>
                  @if (c.caseState === 'awaiting_signout') {
                    <span class="pf-cc__tag pf-cc__tag--warn">Awaiting sign-out</span>
                  }
                  <span class="pf-cc__day">Day {{ dayNo(c.createdAt) }}</span>
                </span>
                <span class="pf-cc__sub">
                  {{ c.patientName || '—' }} · {{ c.testName || 'Culture' }}@if (c.departmentName) { · {{ c.departmentName }} }
                </span>
                @if (inc) {
                  <span class="pf-cc__incub">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>
                    </svg>
                    Incubating · {{ inc.label }} · ready in {{ readyIn(inc) }}
                  </span>
                } @else if (heldBy(c); as holder) {
                  <span class="pf-cc__now">{{ currentStageLabel(c) }} · {{ holder }}</span>
                } @else {
                  <span class="pf-cc__now">Next: {{ currentStageLabel(c) }}</span>
                }
              </span>
              <span class="pf-cc__chev" aria-hidden="true">→</span>
            </button>

          </li>
        }
      </ul>
    }
  `,
  styles: [`
    /* The card is a container; its header toggles expand/collapse. */
    .pf-cc { position: relative; display: block; width: 100%; border-radius: 14px; overflow: hidden;
      background: var(--bg-card, var(--glass-bg)); border: 1px solid var(--glass-border);
      transition: border-color .15s ease; }
    .pf-cc:hover { border-color: rgba(124,58,237,0.45); }
    .pf-cc--incub { border-color: rgba(6,182,212,0.35); }
    .pf-cc--incub .pf-cc__cap { background: linear-gradient(180deg, #22d3ee, #0e7490); }
    .pf-cc__incub { font-size: 11.5px; font-weight: 700; color: #22d3ee; margin-top: 2px; font-variant-numeric: tabular-nums; }
    .pf-cc__cap { position: absolute; left: 0; top: 8px; bottom: 8px; width: 4px; border-radius: 4px; z-index: 1;
      background: linear-gradient(180deg, #a855f7, #7c3aed); }
    .pf-cc__hdr { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; cursor: pointer;
      padding: 12px 14px 12px 18px; background: transparent; border: none; }
    .pf-cc__main { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
    .pf-cc__line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .pf-cc__id { font-size: 15px; font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; }
    .pf-cc__tag { font-size: 10.5px; font-weight: 700; padding: 1px 7px; border-radius: 999px; text-transform: uppercase; letter-spacing: .02em; }
    .pf-cc__tag--warn { color: #b45309; background: rgba(245,158,11,0.16); }
    .pf-cc__day { margin-left: auto; font-size: 11.5px; font-weight: 600; color: var(--text-tertiary); }
    .pf-cc__sub { font-size: 12.5px; color: var(--text-secondary); }
    .pf-cc__now { font-size: 11.5px; font-weight: 600; color: var(--violet-text, #7c3aed); margin-top: 2px; }
    .pf-cc__chev { flex-shrink: 0; font-size: 15px; color: var(--text-tertiary); transition: transform .15s ease, color .15s ease; }
    .pf-cc:hover .pf-cc__chev { color: var(--violet-text, #7c3aed); transform: translateX(2px); }

  `],
})
export class CulturePanelComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly liveQ = inject(LiveQueueService);
  private readonly destroyRef = inject(DestroyRef);

  readonly cases = signal<CultureCaseView[]>([]);
  readonly loading = signal(false);
  /** Ticks every 30s so the incubation countdowns on the cards stay live. */
  private readonly now = signal(Date.now());
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Emits the live case count so the parent can label the Culture pill. */
  readonly countChange = output<number>();

  ngOnInit() {
    this.refresh();
    this.timer = setInterval(() => this.now.set(Date.now()), 30_000);
    // Live queue: an intake ('receive') or a bench/stage mutation ('my_work')
    // must surface here without a manual page refresh — the case row is
    // auto-created by the queue endpoint on first fetch.
    this.liveQ.on('my_work', 'receive').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refresh());
  }
  ngOnDestroy() { if (this.timer) clearInterval(this.timer); }

  refresh() {
    this.loading.set(true);
    this.api.get<CultureCaseView[]>('/api/microbiology/culture-queue').subscribe({
      next: rows => {
        const list = rows ?? [];
        this.cases.set(list);
        this.countChange.emit(list.length);
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); },
    });
  }

  /** One tap opens the bench workspace for the case (the bench itself locks a
   *  stage on first touch — no picking step here). */
  open(c: CultureCaseView) {
    this.router.navigate(['/lab/culture', c.orderTestId]);
  }

  isMine(s: CultureStageView): boolean {
    return !!s.holderUserId && s.holderUserId === this.auth.user()?.id;
  }
  lockedByOther(s: CultureStageView): boolean {
    return s.state === 'picked' && !this.isMine(s);
  }

  /** Who holds the case's current stage, for the collapsed line ("You" / name). */
  heldBy(c: CultureCaseView): string | null {
    const s = c.stages?.find(x => x.state === 'picked');
    if (!s) return null;
    return this.isMine(s) ? 'You' : (s.holderName || 'in progress');
  }

  /** The stage whose incubation clock is still running (one at a time). */
  incubatingStage(c: CultureCaseView): CultureStageView | null {
    const now = this.now();
    return c.stages?.find(s => {
      if (!s.incubateUntil) return false;
      const t = new Date(s.incubateUntil).getTime();
      return !Number.isNaN(t) && t > now;
    }) ?? null;
  }
  /** Live "ready in …" countdown for a resting plate. */
  readyIn(s: CultureStageView): string {
    if (!s.incubateUntil) return '';
    const ms = new Date(s.incubateUntil).getTime() - this.now();
    if (ms <= 0) return 'now';
    const m = Math.floor(ms / 60_000);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  /** Label of the first not-done stage (shown collapsed as "Next: …"). */
  currentStageLabel(c: CultureCaseView): string {
    const s = c.stages?.find(x => x.state !== 'done');
    return s ? s.label : 'Ready for sign-out';
  }

  /** 1-based day counter from the case's creation date. */
  dayNo(createdAt: string): number {
    const start = new Date(createdAt).getTime();
    if (Number.isNaN(start)) return 1;
    return Math.max(1, Math.floor((Date.now() - start) / 86_400_000) + 1);
  }

}
