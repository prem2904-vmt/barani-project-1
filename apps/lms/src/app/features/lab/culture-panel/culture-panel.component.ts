import { ChangeDetectionStrategy, Component, OnInit, output, signal, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ToastService } from '../../../core/services/toast.service';
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
          @let isOpen = expandedId() === c.orderTestId;
          <li class="pf-cc" [class.pf-cc--open]="isOpen">
            <span class="pf-cc__cap" aria-hidden="true"></span>
            <!-- Header: click to expand/collapse (stays on this screen). -->
            <button type="button" class="pf-cc__hdr press" (click)="toggle(c)" [attr.aria-expanded]="isOpen">
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
                @if (!isOpen) { <span class="pf-cc__now">Next: {{ currentStageLabel(c) }}</span> }
              </span>
              <span class="pf-cc__chev" [class.pf-cc__chev--open]="isOpen" aria-hidden="true">▸</span>
            </button>

            <!-- Expanded: the stages — pick one right here to open its entry. -->
            @if (isOpen) {
              <div class="pf-cc__stages">
                @for (s of c.stages; track s.key) {
                  <button type="button" class="pf-cc__stage"
                          [class.pf-cc__stage--done]="s.state === 'done'"
                          [class.pf-cc__stage--picked]="s.state === 'picked'"
                          [disabled]="busy() || lockedByOther(s)"
                          [title]="stageTitle(s)"
                          (click)="pickStage(c, s)">
                    <span class="pf-cc__stage-l">
                      @if (s.state === 'done') { <span class="pf-cc__tick">✓</span> }
                      {{ s.label }}
                    </span>
                    <span class="pf-cc__stage-r">
                      @if (s.state === 'done') { done@if (s.doneByName) { · {{ s.doneByName }} } }
                      @else if (s.state === 'picked') {
                        @if (isMine(s)) { Open → } @else { · {{ s.holderName || 'in progress' }} }
                      } @else { Pick → }
                    </span>
                  </button>
                }
              </div>
            }
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
    .pf-cc:hover, .pf-cc--open { border-color: rgba(124,58,237,0.45); }
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
    .pf-cc__chev { flex-shrink: 0; font-size: 13px; color: var(--text-tertiary); transition: transform .15s ease; }
    .pf-cc__chev--open { transform: rotate(90deg); }

    /* Expanded: each stage a full-width, pickable row. */
    .pf-cc__stages { display: flex; flex-direction: column; gap: 6px; padding: 0 14px 14px 18px; }
    .pf-cc__stage { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 8px;
      font-size: 12.5px; font-weight: 600; padding: 9px 12px; border-radius: 9px; cursor: pointer; text-align: left;
      color: var(--text-secondary); background: var(--glass-bg); border: 1px solid var(--glass-border); box-sizing: border-box;
      transition: border-color .15s ease, background .15s ease; }
    .pf-cc__stage:not(:disabled):hover { border-color: rgba(124,58,237,0.5); background: rgba(124,58,237,0.06); }
    .pf-cc__stage:disabled { cursor: default; opacity: .7; }
    .pf-cc__stage--picked { color: #b45309; background: rgba(245,158,11,0.10); border-color: rgba(245,158,11,0.35); }
    .pf-cc__stage--done { color: #15803d; background: rgba(34,197,94,0.10); border-color: rgba(34,197,94,0.30); }
    .pf-cc__stage-l { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
    .pf-cc__stage-r { flex-shrink: 0; font-size: 11.5px; font-weight: 600; opacity: .9; }
    .pf-cc__tick { font-weight: 800; }
  `],
})
export class CulturePanelComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

  readonly cases = signal<CultureCaseView[]>([]);
  readonly loading = signal(false);
  readonly busy = signal(false);
  /** The case whose stages are expanded (accordion — one open at a time). */
  readonly expandedId = signal<string | null>(null);
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

  /** Expand/collapse a case's stages in place — never leaves this pane. */
  toggle(c: CultureCaseView) {
    this.expandedId.update(id => id === c.orderTestId ? null : c.orderTestId);
  }

  isMine(s: CultureStageView): boolean {
    return !!s.holderUserId && s.holderUserId === this.auth.user()?.id;
  }
  lockedByOther(s: CultureStageView): boolean {
    return s.state === 'picked' && !this.isMine(s);
  }

  /** Pick a stage from THIS pane, then open its result-entry page (like picking
   *  a test in the lab queue opens result entry). Already-mine stages open
   *  directly; a stage held by someone else is inert. */
  pickStage(c: CultureCaseView, s: CultureStageView) {
    const otId = c.orderTestId;
    if (this.lockedByOther(s)) return;
    if (s.state === 'open') {
      this.busy.set(true);
      this.api.post(`/api/microbiology/culture/${otId}/stage/${s.key}/pick`, {}).subscribe({
        next: () => { this.busy.set(false); this.enter(otId, s.key); },
        error: (e: { error?: { message?: string } }) => {
          this.busy.set(false);
          this.toasts.error(e?.error?.message || 'That stage was just picked up by someone else');
          this.refresh();
        },
      });
    } else {
      // Picked-by-me or done → just open the entry page.
      this.enter(otId, s.key);
    }
  }

  private enter(orderTestId: string, stageKey: string) {
    this.router.navigate(['/lab/culture', orderTestId], { queryParams: { stage: stageKey } });
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

  stageTitle(s: CultureStageView): string {
    if (s.state === 'done') return `${s.label} — done${s.doneByName ? ' by ' + s.doneByName : ''}`;
    if (s.state === 'picked') return `${s.label} — in progress${s.holderName ? ' by ' + s.holderName : ''}`;
    return `${s.label} — open`;
  }
}
