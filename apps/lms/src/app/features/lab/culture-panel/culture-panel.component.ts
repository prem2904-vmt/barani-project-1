import { AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, OnDestroy, OnInit, TemplateRef, computed, effect, input, output, signal, inject, viewChild } from '@angular/core';
import type { ColDef, GetRowIdParams, RowClassParams, RowClickedEvent } from 'ag-grid-community';
import { DataGridComponent } from '../../../shared/components/data-grid/data-grid.component';
import { DataGridTemplateCellComponent } from '../../../shared/components/data-grid/template-cell.component';
import { WorkSetFilterComponent } from '../../../shared/components/work-set-filter/work-set-filter.component';
import {
  GridFold, actionCol, dueCell, dueValue, durationCol, durationText, fitFold, minWidthOf, numberCol, textCol, valuesCol,
} from '../../../shared/utils/work-grid';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { StatusWordsComponent } from '../../../shared/components/status-words/status-words.component';
import {
  CultureFilter, cultureColumns, cultureStageRank, cultureDay, cultureDepts, cultureDueMin, cultureMeta, culturePrimary, cultureStatus, cultureTest, cultureWords, nextStep,
  cultureStatusOptions, culturePatientMeta, currentStage, filterCultures, readDue, stageSub,
} from './culture-grid';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { LiveQueueService } from '../../../core/services/live-queue.service';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { SkeletonComponent } from '../../../shared/primitives/skeleton.component';
import { TileGridDirective } from '../../../shared/directives/tile-grid.directive';
import { ZoomSourceDirective } from '../../../core/navigation/zoom.directive';
import { ThemeService } from '../../../core/services/theme.service';
import { DailyNoComponent } from '../../../shared/components/daily-no/daily-no.component';

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
  /** Report-row keys hidden on the patient PDF (bench data unaffected). */
  reportHidden?: string[] | null;
  label?: string | null;
  subCultures?: CultureCaseView[] | null;
  /** CASE-LEVEL incubation reference timer (never a lock). */
  incubateUntil?: string | null;
  /** The ordered test's specimen NAME (fixed / picked at billing, editable at
   *  the bench within the test's allowed list) and its master CODE. */
  specimen?: string | null;
  specimenCode?: string | null;
  /** The Test Master test — the bench reads its allowed specimens by it. */
  testId?: string | null;
  orderTestId: string;
  caseState: string;
  sampleId?: string | null;
  barcode?: string | null;
  patientName?: string | null;
  /** Daily patient number for this visit (per branch per IST day) and its
   *  day, yyyy-MM-dd — on-screen only (utils/daily-no.ts). */
  dailyNo?: number | null;
  dailyNoDay?: string | null;
  /** The patient line ("32/F · AA0023") — the same fields My Work's patient carries (DOB is the age's source).
   *  Absent on older servers: the row falls back to the specimen. */
  patient?: { dateOfBirth?: string | null; age?: number | null; ageYears?: number | null; ageDisplay?: string | null; sex?: string | null; mrn?: string | null } | null;
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
  imports: [DailyNoComponent, TileComponent, SkeletonComponent, TileGridDirective, ZoomSourceDirective, DataGridComponent, StatusWordsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!theme.isNewDesign()) {
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
      <ul class="flex flex-col gap-3 list-none p-0 m-0" [pfTileGrid]="theme.isNewDesign()">
        @for (c of cases(); track c.orderTestId) {
          @let inc = incubatingStage(c);
          <li class="pf-cc" [pfZoomSource]="[c.orderTestId, c.sampleId]" [class.pf-cc--incub]="!!inc" [class.pf-cc--nd]="theme.isNewDesign()">
            @if (!theme.isNewDesign()) { <span class="pf-cc__cap" aria-hidden="true"></span> }
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
                @if (theme.isNewDesign()) {
                  <!-- New design: sample ID is the primary line; patient, then
                       test, as quieter secondary lines (owner). -->
                  <span class="pf-cc__who"><pf-daily-no [of]="c" />{{ c.patientName || '—' }}</span>
                  <span class="pf-cc__sub">{{ c.testName || 'Culture' }}@if (c.departmentName) { · {{ c.departmentName }} }</span>
                } @else {
                <span class="pf-cc__sub">
                  <pf-daily-no [of]="c" />{{ c.patientName || '—' }} · {{ c.testName || 'Culture' }}@if (c.departmentName) { · {{ c.departmentName }} }
                </span>
                }
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
              @if (theme.isNewDesign()) {
                <svg class="pf-cc__chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
              } @else {
              <span class="pf-cc__chev" aria-hidden="true">→</span>
              }
            </button>

          </li>
        }
      </ul>
    }
    } @else if (phone()) {
      <!-- New design, phones: card rows (Results' phone pattern) — the card opens the bench. -->
      @if (loading() && cases().length === 0) {
        <ul class="wg-cards" aria-busy="true">
          @for (i of [0, 1, 2]; track i) {
            <li class="wg-card wg-card--skel">
              <span class="wg-card__l1"><pf-skeleton variant="line" width="45%"></pf-skeleton><pf-skeleton variant="line" width="72px"></pf-skeleton></span>
              <pf-skeleton variant="line" width="75%" height="10px"></pf-skeleton>
              <span class="wg-card__foot"><span class="wg-acts"><pf-skeleton variant="block" width="112px" height="44px"></pf-skeleton></span></span>
            </li>
          }
        </ul>
      } @else if (!shown().length) {
        <p class="cg-empty">{{ cases().length ? 'Nothing matches these filters.' : 'No culture cases in progress.' }}</p>
      } @else {
        <ul class="wg-cards" data-testid="cg-cards">
          @for (c of shown(); track c.orderTestId) {
            @let st = words(c);
            <li class="wg-card" role="button" tabindex="0" [pfZoomSource]="[c.orderTestId, c.sampleId]" [attr.aria-label]="primary(c).aria"
                (click)="onCard(c, $event)" (keydown.enter)="open(c)" (keydown.space)="$event.preventDefault(); open(c)">
              <span class="wg-card__l1">
                <span class="wg-id">{{ c.barcode || c.sampleId || '—' }}</span>
                <pf-status-words [words]="st" />
              </span>
              <span class="wg-who"><span class="wg-who__name"><pf-daily-no [of]="c" />{{ c.patientName || '—' }}</span>
                @if (pmeta(c); as pm) { <span class="wg-who__meta pf-num">{{ pm }}</span> }
                <span class="wg-who__meta">{{ meta(c) }}</span></span>
              <span class="wg-card__foot">
                <span class="wg-tat" [class.wg-tat--late]="dueOf(c).late">Day {{ day(c) }} · {{ dueOf(c).text }}</span>
                <span class="wg-acts"><button type="button" class="pf-rowact wg-act" data-action="bench" [attr.aria-label]="primary(c).aria" (click)="$event.stopPropagation(); open(c)">{{ primary(c).label }}</button></span>
              </span>
            </li>
          }
        </ul>
      }
    } @else {
      <!-- New design: the work GRID (owner 2026-11-20) — same head, columns, touch sizing as the other My Work lists. -->
      <pf-data-grid class="cg" data-testid="cg-grid" [rowData]="shown()" [columnDefs]="cols()" [defaultColDef]="defaultCol"
        [getRowId]="rowId" [getRowClass]="rowClass" [clickable]="true" [suppressColumnVirtualisation]="true" viewStateKey="lab.culture.grid"
        [loading]="loading() && cases().length === 0" loadingLabel="Loading culture cases…"
        [emptyTitle]="cases().length ? 'Nothing matches these filters.' : 'No culture cases in progress.'" (rowClicked)="onRow($event)" />
    }

    <!-- ── Grid cell templates (the page's own nodes) ── -->
    <ng-template #cSample let-c>
      <span class="wg-cell" [pfZoomSource]="[c.orderTestId, c.sampleId]">
        <span class="wg-id wg-link" role="link" tabindex="0" [attr.aria-label]="primary(c).aria" (keydown.enter)="key(c, $event)">{{ c.barcode || c.sampleId || '—' }}</span>
      </span>
    </ng-template>
    <ng-template #cPatient let-c>
      <span class="wg-who">
        @if (fold() === 'tight') { <span class="wg-id">{{ c.barcode || c.sampleId || '—' }}</span> }
        <span class="wg-who__name"><pf-daily-no [of]="c" />{{ c.patientName || '—' }}</span>
        @if (pmeta(c); as pm) { <span class="wg-who__meta pf-num">{{ pm }}</span> }
        @if (fold() !== 'full') { <span class="wg-who__meta">{{ test(c) }}</span> }
        @if (fold() === 'tight') {
          <span class="wg-who__fold">
            <pf-status-words [words]="words(c)" />
            <span class="wg-sub" [class.wg-note]="due(c)">Day {{ day(c) }}</span>
          </span>
        }
      </span>
    </ng-template>
    <ng-template #cTest let-c>
      <span class="wg-cell"><span class="wg-tests">{{ test(c) }}</span></span>
    </ng-template>
    <ng-template #cDay let-c>
      <span class="wg-cell"><span class="wg-tat" [class.wg-tat--late]="due(c)" [attr.title]="due(c) ? 'The plate is ready: the read is due' : null">Day {{ day(c) }}</span></span>
    </ng-template>
    <ng-template #cNext let-c>
      <span class="wg-cell"><pf-status-words class="cg-next" [words]="words(c)" /></span>
    </ng-template>
    <!-- Due: the next read (owner 2026-11-21 — no journey ring on the lab screens). -->
    <ng-template #cDue let-c>
      @let d = dueOf(c);
      <span class="wg-cell"><span class="wg-tat cg-due" [class.wg-tat--late]="d.late" [attr.title]="d.detail">{{ d.text }}</span></span>
    </ng-template>
    <ng-template #cActs let-c>
      <span class="wg-acts"><button type="button" class="pf-rowact wg-act" data-action="bench" [attr.aria-label]="primary(c).aria" (click)="$event.stopPropagation(); open(c)">{{ primary(c).label }}</button></span>
    </ng-template>
  `,
  styles: [`
    @use '../../../shared/styles/work-grid' as wg;
    @include wg.cells;
    :host-context(.design-new) { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; min-width: 0; }
    .cg { flex: 1 1 auto; min-height: 0; }
    .cg-empty { margin: 0; padding: 32px 16px; text-align: center; font-size: 13.5px; color: var(--text-tertiary); }
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

  
    /* ── New design (owner): same card as the other My Work tiles ──
       No stripe; sample ID is the primary line; patient + test secondary;
       the next step is a neutral chip whose small violet dot is the one
       accent; Day N a neutral chip top-right; a quiet chevron. */
    .pf-cc--nd { border-radius: var(--pf-radius-sm, 10px); background: var(--pf-card-bg); border: 1px solid var(--pf-line);
      height: 100%; }
    .pf-cc--nd:hover { border-color: var(--pf-sel-border); }
    .pf-cc--pf.pf-cc--incub { border-color: var(--pf-line); }
    .pf-cc--nd .pf-cc__hdr { padding: 12px 12px 12px 14px; align-items: flex-start; height: 100%; }
    .pf-cc--nd .pf-cc__main { gap: 3px; }
    .pf-cc--nd .pf-cc__id { font-family: inherit; font-size: 16.5px; font-weight: 600; letter-spacing: 0.01em; color: var(--text-primary); }
    .pf-cc--nd .pf-cc__who { font-size: 13px; font-weight: 500; color: var(--text-secondary); overflow-wrap: anywhere; }
    .pf-cc--nd .pf-cc__sub { font-size: 12px; color: var(--text-muted); overflow-wrap: anywhere; }
    .pf-cc--nd .pf-cc__day,
    .pf-cc--nd .pf-cc__tag,
    .pf-cc--nd .pf-cc__tag--warn {
      font-size: 11px; font-weight: 500; letter-spacing: 0; text-transform: none;
      padding: 2px 8px; border-radius: var(--pf-radius-chip, 8px);
      background: var(--pf-chip-bg); color: var(--text-secondary); font-variant-numeric: tabular-nums;
    }
    .pf-cc--nd .pf-cc__now,
    .pf-cc--nd .pf-cc__incub {
      align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; margin-top: 6px;
      padding: 3px 9px; border-radius: var(--pf-radius-chip, 8px);
      background: var(--pf-chip-bg); color: var(--text-secondary); font-size: 12px; font-weight: 500;
    }
    .pf-cc--nd .pf-cc__now::before {
      content: ''; width: 6px; height: 6px; border-radius: 999px; flex: none;
      background: var(--color-violet-600, #7c3aed);
    }
    .pf-cc--nd .pf-cc__incub svg { color: var(--text-tertiary); }
    .pf-cc--nd .pf-cc__chev { align-self: center; color: var(--text-muted); font-size: inherit; }
    .pf-cc--nd:hover .pf-cc__chev { color: var(--text-secondary); transform: translateX(2px); }
`],
})
export class CulturePanelComponent implements OnInit, OnDestroy, AfterViewInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly liveQ = inject(LiveQueueService);
  private readonly destroyRef = inject(DestroyRef);
  /** New design: cases lay out in the adaptive 3/2/1 tile grid. */
  protected readonly theme = inject(ThemeService);

  readonly cases = signal<CultureCaseView[]>([]);
  readonly loading = signal(false);
  /** Ticks every 30s so the incubation countdowns on the cards stay live. */
  private readonly now = signal(Date.now());
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Emits the live case count so the parent can label the Culture pill. */
  readonly countChange = output<number>();

  // ── New design: the work grid (owner 2026-11-20: "Culture is not following that grid in the lab") ──
  /** The card head's search / status / department (owned by My Work's head, like the other lists). */
  readonly filter = input<CultureFilter>({ q: '', status: 'all', dept: null });
  readonly phone = input(false);
  /** What the head shows: the status pill options, departments, and "n of m". */
  readonly headChange = output<{ options: Array<{ value: string; label: string; count: number }>; depts: Array<{ id: string; name: string }>; shown: number; total: number }>();
  readonly web = webPointerSignal();
  readonly shown = computed(() => filterCultures(this.cases(), this.filter(), this.now()));
  private readonly headFx = effect(() => this.headChange.emit({
    options: cultureStatusOptions(this.cases(), this.filter(), this.now()), depts: cultureDepts(this.cases()),
    shown: this.shown().length, total: this.cases().length,
  }));
  status(c: CultureCaseView) { return cultureStatus(c, this.now()); }
  meta(c: CultureCaseView) { return cultureMeta(c); }
  day(c: CultureCaseView) { return cultureDay(c, this.now()); }
  due(c: CultureCaseView) { return !!readDue(c, this.now()); }
  stage(c: CultureCaseView) { return currentStage(c)?.label ?? ''; }
  sub(c: CultureCaseView) { return stageSub(c, this.now(), this.auth.user()?.id); }
  primary(c: CultureCaseView) { return culturePrimary(c, this.now()); }
  /** "in 1h 30m" until the plate is ready; rose "40m late" once the read is due. */
  dueOf(c: CultureCaseView) { return dueCell(cultureDueMin(c, this.now())); }
  next(c: CultureCaseView) { return nextStep(c, this.now()); }
  /** The Next-step cell's two lines (culture-grid.ts). */
  words(c: CultureCaseView) { return cultureWords(c, this.now(), this.auth.user()?.id); }
  test(c: CultureCaseView) { return cultureTest(c); }
  pmeta(c: CultureCaseView) { return culturePatientMeta(c); }
  onRow(e: RowClickedEvent<CultureCaseView>): void {
    if ((e.event?.target as HTMLElement | null)?.closest?.('button, a, [role="menu"]')) return;
    if (e.data) this.open(e.data);
  }
  onCard(c: CultureCaseView, ev: Event): void { if (!(ev.target as HTMLElement | null)?.closest?.('button')) this.open(c); }
  key(c: CultureCaseView, ev: Event): void { ev.preventDefault(); ev.stopPropagation(); this.open(c); }

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);
  private readonly width = signal(1200);
  readonly fold = computed<GridFold>(() => this.foldFor(this.width()));
  private foldFor(w: number): GridFold {
    const mins = (f: GridFold) => Object.fromEntries(Object.entries(this.sizes(f)).map(([k, v]) => [k, v.width ?? v.minWidth ?? 0]));
    return fitFold(w, f => minWidthOf(cultureColumns(f), mins(f)));
  }
  private sizes(fold: GridFold): Record<string, ColDef<CultureCaseView>> {
    const touch = !this.web();
    return {
      sample: { width: 124, minWidth: 124 }, patient: { flex: 1.3, minWidth: fold === 'tight' ? 200 : 210 },
      test: { flex: 1, minWidth: 180 }, day: { width: 100, minWidth: 100 }, next: { width: 196, minWidth: 180 },
      due: { width: 108, minWidth: 108 }, acts: { width: touch ? 112 : 100, minWidth: touch ? 112 : 100 },
    };
  }
  private readonly sampleTpl = viewChild<TemplateRef<unknown>>('cSample');
  private readonly patientTpl = viewChild<TemplateRef<unknown>>('cPatient');
  private readonly dayTpl = viewChild<TemplateRef<unknown>>('cDay');
  private readonly testTpl = viewChild<TemplateRef<unknown>>('cTest');
  private readonly nextTpl = viewChild<TemplateRef<unknown>>('cNext');
  private readonly dueTpl = viewChild<TemplateRef<unknown>>('cDue');
  private readonly actsTpl = viewChild<TemplateRef<unknown>>('cActs');
  readonly defaultCol: ColDef<CultureCaseView> = { sortable: false, resizable: false, filter: false, suppressMovable: true, wrapText: true, autoHeight: true, minWidth: 60 };
  readonly rowId = (p: GetRowIdParams<CultureCaseView>) => p.data.orderTestId;
  readonly rowClass = (p: RowClassParams<CultureCaseView>) => (p.data && readDue(p.data, this.now()) ? ['cg-row', 'wg-row--urgent'] : ['cg-row']);
  readonly cols = computed<ColDef<CultureCaseView>[]>(() => {
    const tpl: Record<string, TemplateRef<unknown> | undefined> = {
      sample: this.sampleTpl(), patient: this.patientTpl(), test: this.testTpl(), day: this.dayTpl(), next: this.nextTpl(),
      due: this.dueTpl(), acts: this.actsTpl(),
    };
    const size = this.sizes(this.fold());
    const set = WorkSetFilterComponent;
    // Shared column helpers (shared/utils/work-grid.ts): text left (IDs, patient, the stage + its sub-line), short
    // values centred, actions right; a header filter AND a sort on the real value (day number, stage order, minutes to
    // the next read) on every data column.
    const wrap = (d: ColDef<CultureCaseView>) => ({ ...d, cellClass: 'wg-c-wrap' });
    const rule = (colId: string, def: ColDef<CultureCaseView>): ColDef<CultureCaseView> => {
      switch (colId) {
        case 'sample': return textCol<CultureCaseView>(def, c => [c.barcode, c.sampleId].filter(Boolean).join(' '));
        case 'patient': return textCol<CultureCaseView>(wrap(def), c => [c.patientName, c.patient?.mrn, c.testName, c.specimen].filter(Boolean).join(' '), 'left', c => c.patientName ?? '');
        case 'test': return valuesCol<CultureCaseView>(wrap(def), c => this.test(c), set);
        case 'day': return numberCol<CultureCaseView>(def, c => this.day(c));
        case 'next': return valuesCol<CultureCaseView>(wrap(def), c => this.next(c).label, set, 'left', c => cultureStageRank(c));
        case 'due': return durationCol<CultureCaseView>(def, c => dueValue(cultureDueMin(c, this.now())), { kind: 'due' });
        default: return actionCol<CultureCaseView>({ ...def, cellClass: 'wg-c-acts' });
      }
    };
    return cultureColumns(this.fold()).map(p => rule(p.colId, {
      colId: p.colId, headerName: p.header, hide: p.hide, ...size[p.colId],
      cellRenderer: DataGridTemplateCellComponent, cellRendererParams: { tpl: tpl[p.colId] },
    }));
  });
  ngAfterViewInit(): void {
    if (typeof ResizeObserver === 'undefined') return;
    const el = this.host.nativeElement;
    this.zone.runOutsideAngular(() => {
      const ro = new ResizeObserver(entries => {
        const w = Math.round(entries[0]?.contentRect.width ?? el.clientWidth);
        if (w <= 0) return;
        if (this.foldFor(w) !== this.foldFor(this.width())) this.zone.run(() => this.width.set(w)); else this.width.set(w);
      });
      ro.observe(el);
      this.destroyRef.onDestroy(() => ro.disconnect());
    });
  }

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
    return m < 60 ? `${m}m` : durationText(m);
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
