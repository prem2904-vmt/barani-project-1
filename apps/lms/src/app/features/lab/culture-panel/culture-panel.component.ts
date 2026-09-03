import { ChangeDetectionStrategy, Component, OnInit, output, signal, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
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
}

/** A culture case row (mirrors the backend CultureCaseDto). */
export interface CultureCaseView {
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
 * who currently holds a stage, and how many days it's been running. Opening a
 * card lands in the staged bench workspace.
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
          <li>
            <button type="button" class="pf-cc press" (click)="open(c)">
              <span class="pf-cc__cap" aria-hidden="true"></span>
              <span class="pf-cc__main">
                <span class="pf-cc__line">
                  <span class="pf-cc__id">{{ c.barcode || c.sampleId || '—' }}</span>
                  @if (c.caseState === 'awaiting_signout') {
                    <span class="pf-cc__tag pf-cc__tag--warn">Awaiting sign-out</span>
                  }
                  <span class="pf-cc__day">Day {{ dayNo(c.createdAt) }}</span>
                </span>
                <span class="pf-cc__sub">
                  {{ c.patientName || '—' }} · {{ c.testName || 'Culture' }}
                  @if (c.departmentName) { · {{ c.departmentName }} }
                </span>
                <span class="pf-cc__stages">
                  @for (s of c.stages; track s.key) {
                    <span class="pf-cc__stage"
                          [class.pf-cc__stage--done]="s.state === 'done'"
                          [class.pf-cc__stage--picked]="s.state === 'picked'"
                          [title]="stageTitle(s)">
                      @if (s.state === 'done') { <span class="pf-cc__tick">✓</span> }
                      {{ s.label }}
                      @if (s.state === 'picked' && s.holderName) { <span class="pf-cc__holder">· {{ s.holderName }}</span> }
                    </span>
                  }
                </span>
              </span>
            </button>
          </li>
        }
      </ul>
    }
  `,
  styles: [`
    .pf-cc { position: relative; display: flex; align-items: center; width: 100%; text-align: left;
      padding: 12px 14px 12px 18px; border-radius: 14px; cursor: pointer;
      background: var(--bg-card, var(--glass-bg)); border: 1px solid var(--glass-border);
      transition: border-color .15s ease, background .15s ease; }
    .pf-cc:hover { border-color: rgba(124,58,237,0.45); }
    .pf-cc__cap { position: absolute; left: 0; top: 8px; bottom: 8px; width: 4px; border-radius: 4px;
      background: linear-gradient(180deg, #a855f7, #7c3aed); }
    .pf-cc__main { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
    .pf-cc__line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .pf-cc__id { font-size: 15px; font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; }
    .pf-cc__tag { font-size: 10.5px; font-weight: 700; padding: 1px 7px; border-radius: 999px; text-transform: uppercase; letter-spacing: .02em; }
    .pf-cc__tag--warn { color: #b45309; background: rgba(245,158,11,0.16); }
    .pf-cc__day { margin-left: auto; font-size: 11.5px; font-weight: 600; color: var(--text-tertiary); }
    .pf-cc__sub { font-size: 12.5px; color: var(--text-secondary); }
    .pf-cc__stages { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
    /* Each stage is a FULL-WIDTH chip on its own row (never a half-cut pill). */
    .pf-cc__stage { display: flex; width: 100%; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 600;
      padding: 4px 10px; border-radius: 8px; color: var(--text-tertiary); white-space: nowrap;
      background: var(--glass-bg); border: 1px solid var(--glass-border); box-sizing: border-box; }
    .pf-cc__stage--picked { color: #b45309; background: rgba(245,158,11,0.12); border-color: rgba(245,158,11,0.35); }
    .pf-cc__stage--done { color: #15803d; background: rgba(34,197,94,0.12); border-color: rgba(34,197,94,0.35); }
    .pf-cc__tick { font-weight: 800; }
    .pf-cc__holder { font-weight: 500; opacity: .85; }
  `],
})
export class CulturePanelComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  readonly cases = signal<CultureCaseView[]>([]);
  readonly loading = signal(false);
  /** Emits the live case count so the parent can label the Culture pill. */
  readonly countChange = output<number>();

  ngOnInit() { this.refresh(); }

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

  open(c: CultureCaseView) { this.router.navigate(['/lab/culture', c.orderTestId]); }

  /** 1-based day counter from the case's creation date. */
  dayNo(createdAt: string): number {
    const start = new Date(createdAt).getTime();
    if (Number.isNaN(start)) return 1;
    return Math.max(1, Math.floor((Date.now() - start) / 86_400_000) + 1);
  }

  stageTitle(s: CultureStageView): string {
    if (s.state === 'done') return `${s.label} — done${s.doneByName ? ' by ' + s.doneByName : ''}`;
    if (s.state === 'picked') return `${s.label} — in progress${s.holderName ? ' by ' + s.holderName : ''}`;
    return `${s.label} — open`;
  }
}
