import { AfterViewInit, DestroyRef, ChangeDetectionStrategy, Component, ElementRef, NgZone, OnInit, TemplateRef, computed, inject, signal, viewChild } from '@angular/core';
import { ViewStateService } from '../../../shared/services/view-state.service';
import { NgTemplateOutlet } from '@angular/common';
import type { ColDef, GetRowIdParams, RowClassParams, RowClickedEvent } from 'ag-grid-community';
import { DataGridComponent } from '../../../shared/components/data-grid/data-grid.component';
import { DataGridTemplateCellComponent } from '../../../shared/components/data-grid/template-cell.component';
import { GridFold, actionCol, dueCell, dueValue, durationCol, fitFold, minWidthOf, minutesSince, textCol, valuesCol } from '../../../shared/utils/work-grid';
import { WorkSetFilterComponent } from '../../../shared/components/work-set-filter/work-set-filter.component';
import { mediaSignal } from '../../admin/tests/tests/tm-two-panel';
import { pvColumns, pvMeta, pvRows, pvWaiting, pvWords } from './pending-validation.grid';
import { StatusWordsComponent } from '../../../shared/components/status-words/status-words.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { isCultureOrderTest } from '../../../core/navigation/culture-redirect.guard';
import { ThemeService } from '../../../core/services/theme.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { LiveQueueService } from '../../../core/services/live-queue.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { TatIndicatorComponent } from '../../../shared/components/tat-indicator/tat-indicator.component';
import { OrderTest } from '../../../shared/models/order.model';
import { ApiError } from '../../../shared/models/api-response.model';
import { formatPatientInfo } from '../../../shared/models/patient.model';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ChipComponent } from '../../../shared/primitives/chip.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { SkeletonComponent } from '../../../shared/primitives/skeleton.component';
import { TileComponent, TileTone } from '../../../shared/primitives/tile.component';
import { ZoomSourceDirective } from '../../../core/navigation/zoom.directive';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { KpiStripComponent } from '../../../shared/components/kpi-strip/kpi-strip.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { TileGridDirective } from '../../../shared/directives/tile-grid.directive';
import { RegnoPromptComponent } from '../../../shared/components/regno-prompt/regno-prompt.component';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { CriticalResultsService } from '../../../core/services/critical-results.service';
import { CriticalResultEvent, needsAckBy } from '../../../shared/models/critical-result.model';
import { plural } from '../../../shared/utils/plural';
import { pickReassignee } from '../reassign-picker';
import { OrderPriority } from '../../../shared/utils/lab-priority';
import {
  Enriched, QueueTile, ValidationScope,
  departmentsIn, enrich, groupBySample, isCritical, matchesQuery, nextTile, tileStatus,
} from './pending-validation.logic';
import { DailyNoComponent } from '../../../shared/components/daily-no/daily-no.component';

type Tab = 'mine' | 'all';

/**
 * /pathologist — the consultant's validation queue.
 *
 * New design (docs/PF-PATTERN.md → "Pathologist queue"): band (search + All ·
 * Assigned to me) → QUEUE card (one tile per tube, sample ID first, one
 * status word, Urgent / Normal (order priority) groups, department filter) + SCOPE
 * side card (the consultant's departments, today's numbers, the ONE primary
 * "Review next"). Tapping a tube zooms into the review screen (the same
 * sample screen the tech entered on, ?validate=1; culture → culture case).
 *
 * The queue is DEPARTMENT-SCOPED on the server: a consultant assigned to
 * departments (Users & roles / Lab settings validator pools) only receives
 * those departments' results; unassigned consultants and admins see all.
 * Classic design keeps its original look.
 */
@Component({
  selector: 'pf-pending-validation',
  standalone: true,
  imports: [DailyNoComponent, BusyDirective, StatusWordsComponent, 
    ZoomSourceDirective,
    FormsModule,
    TatIndicatorComponent,
    AvatarComponent,
    ChipComponent,
    ScreenHeaderComponent,
    SegmentedComponent,
    SkeletonComponent,
    TileComponent,
    TouchButtonComponent,
    KpiStripComponent,
    HeroBandComponent,
    TileGridDirective,
    RegnoPromptComponent,
    DataGridComponent,
    NgTemplateOutlet,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (theme.isNewDesign()) {
    <!-- ═══ New design (docs/PF-PATTERN.md → "Pathologist queue") ═══
         Band: search + ONE neutral filter (All · Assigned to me) in the pill,
         Refresh as a quiet band action. Body: the QUEUE card (tiles per tube,
         URGENT / HIGH / ON TIME groups) + the SCOPE side card (the consultant's
         departments, today's numbers, the ONE primary: Review next). Phones:
         the side card is a sheet; its summary + primary ride the bottom bar. -->
    <section class="pf-page pv-page">
      <header class="pf-page__header px-4 md:px-8 lg:px-10">
        <pf-hero-band
          placeholder="Search patient · MRN · sample ID · test…"
          [value]="query()"
          (valueChange)="query.set($event)">
          <ng-container band-tools>
            <pf-segmented class="pv-seg" [options]="ndTabs()" [value]="tab()" (valueChange)="setTab($any($event))" />
          </ng-container>
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--ghost press pv-refresh" (click)="refresh()"
                    [disabled]="loading()" [pfBusy]="loading()" pfBusyLabel="Refreshing…"
                    aria-label="Refresh" title="Refresh">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/>
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>
              </svg>
              <span class="pv-refresh__t">Refresh</span>
            </button>
            <!-- The screen's ONE violet primary, in the band (owner 2026-11-21: moved from the side card's foot). -->
            <button type="button" class="pf-hb-btn pf-hb-btn--primary press pv-next" data-cta data-testid="pv-review-next"
                    [disabled]="!next()" (click)="reviewNext()"
                    [attr.aria-label]="next() ? 'Review next: ' + next()!.sampleLabel : (statsSkel() ? 'Loading the queue' : 'Nothing to review')"
                    [attr.title]="next() ? 'Review next · ' + next()!.sampleLabel : (statsSkel() ? 'Loading the queue…' : 'Nothing to review')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>
              <span>{{ statsSkel() && !next() ? 'Loading…' : 'Review next' }}</span>
            </button>
          </ng-container>
        </pf-hero-band>
      </header>

      <div class="pf-page__body pf-body pf-body--split pv-body px-4 md:px-8 lg:px-10 pt-2 pb-6">
        <!-- ── Main card: the queue ── -->
        <section #queueCard class="pf-card pv-queue" aria-label="Pending validation">
          <header class="pf-card__head pv-queue__head">
            <span class="pf-card__icon" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
            </span>
            <h2 class="pf-card__label">Pending validation</h2>
            <span class="pv-count pf-num">{{ countLabel() }}</span>
            <span class="pf-card__spacer"></span>
            <!-- Phones only (no column headers there); the grid's Department column filters the same thing. -->
            @if (phone() && deptFilters().length > 1) {
              <pf-segmented class="pv-depts" [options]="deptSegmentOptions()" [value]="dept()" (valueChange)="dept.set($any($event))" />
            }
          </header>

          <div class="pf-card__body pv-scroll" [class.pv-scroll--grid]="!phone()">
            @if (!loading() && visibleTiles().length === 0) {
              <div class="pf-empty pv-empty">
                <span class="pf-empty__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
                </span>
                <p class="pf-empty__title">{{ emptyTitle() }}</p>
                <p class="pf-empty__body">{{ emptyBody() }}</p>
              </div>
            } @else if (phone()) {
              <!-- Phones: card rows (Results' phone pattern); the card is the row tap, its actions sit on their own line. -->
              @if (loading() && rows().length === 0) {
                <ul class="wg-cards" aria-hidden="true" data-testid="pv-cards-skel">
                  @for (i of [0,1,2]; track i) {
                    <li class="wg-card wg-card--skel">
                      <span class="wg-card__l1"><pf-skeleton variant="line" width="40%" height="16px"></pf-skeleton><pf-skeleton variant="line" width="72px"></pf-skeleton></span>
                      <pf-skeleton variant="line" width="70%"></pf-skeleton>
                      <span class="wg-card__foot"><span class="wg-acts"><pf-skeleton variant="block" width="96px" height="44px"></pf-skeleton></span></span>
                    </li>
                  }
                </ul>
              } @else {
                <ul class="wg-cards" data-testid="pv-cards">
                  @for (g of gridRows(); track g.key) {
                    @let st = status(g);
                    @let w = waiting(g);
                    <li class="wg-card pv-tile" role="button" tabindex="0" [attr.data-urgent]="g.priority === 'urgent'"
                        [attr.data-priority]="g.priority" [attr.data-status]="st.key" [pfZoomSource]="[g.key, g.sampleId, g.items[0]?.id]"
                        [attr.aria-label]="'Review sample ' + g.sampleLabel + ', ' + g.patientName + ', ' + g.dept + ', ' + st.label"
                        (click)="onCard(g, $event)" (keydown.enter)="openOrder(g)" (keydown.space)="$event.preventDefault(); openOrder(g)">
                      <span class="wg-card__l1">
                        <span class="wg-id pv-tile__id pf-num">{{ g.sampleLabel }}</span>
                        <ng-container [ngTemplateOutlet]="statusTpl" [ngTemplateOutletContext]="{ $implicit: g }" />
                      </span>
                      <ng-container [ngTemplateOutlet]="whoTpl" [ngTemplateOutletContext]="{ $implicit: g }" />
                      <span class="wg-card__foot">
                        <span class="wg-tat" [class.wg-tat--late]="w.late">{{ w.text === '—' ? '—' : 'Waiting ' + w.text }}@if (w.sub) {<span class="wg-sub"> · {{ w.sub }}</span>}</span>
                        <ng-container [ngTemplateOutlet]="actsTpl" [ngTemplateOutletContext]="{ $implicit: g }" />
                      </span>
                    </li>
                  }
                </ul>
              }
            } @else {
              <pf-data-grid class="pv-gridc" data-testid="pv-grid" [rowData]="gridRows()" [columnDefs]="cols()" [defaultColDef]="defaultCol"
                [getRowId]="rowId" [getRowClass]="rowClass" [clickable]="true" [suppressColumnVirtualisation]="true" viewStateKey="pathologist.grid"
                [loading]="loading() && rows().length === 0" loadingLabel="Loading the queue…"
                (rowClicked)="onRow($event)" />
            }
          </div>
        </section>

        <!-- ── Grid cell templates (the page's own nodes) ── -->
        <ng-template #cSample let-g>
          <span class="wg-cell" [pfZoomSource]="[g.key, g.sampleId, g.items[0]?.id]">
            <span class="wg-id wg-link pv-tile__id pf-num" role="link" tabindex="0"
                  [attr.aria-label]="'Review sample ' + g.sampleLabel + ', ' + g.patientName + ', ' + g.dept + ', ' + status(g).label"
                  (keydown.enter)="key(g, $event)" (keydown.space)="key(g, $event)">{{ g.sampleLabel }}</span>
          </span>
        </ng-template>
        <ng-template #cPatient let-g>
          <ng-container [ngTemplateOutlet]="whoTpl" [ngTemplateOutletContext]="{ $implicit: g, status: fold() !== 'full' }" />
        </ng-template>
        <ng-template #cDept let-g>
          <span class="wg-cell"><span class="wg-tests">{{ g.dept || '—' }}</span></span>
        </ng-template>
        <ng-template #cStatus let-g>
          <span class="wg-cell"><ng-container [ngTemplateOutlet]="statusTpl" [ngTemplateOutletContext]="{ $implicit: g }" /></span>
        </ng-template>
        <!-- Due: time left to TAT (owner 2026-11-21 — every row here waits on validation, so no journey ring). -->
        <ng-template #cDue let-g>
          @let d = due(g);
          <span class="wg-cell"><span class="wg-tat pv-due" [class.wg-tat--late]="d.late" [attr.title]="d.detail">{{ d.text }}</span></span>
        </ng-template>
        <ng-template #cWait let-g>
          @let w = waiting(g);
          <span class="wg-cell"><span class="wg-tat" [class.wg-tat--late]="w.late" [attr.title]="w.late ? 'Past its turnaround time' : null">{{ w.text }}</span>
            @if (w.sub) { <span class="wg-sub pv-wait-sub">{{ w.sub }}</span> }</span>
        </ng-template>
        <ng-template #cActs let-g><ng-container [ngTemplateOutlet]="actsTpl" [ngTemplateOutletContext]="{ $implicit: g }" /></ng-template>

        <!-- Status = two lines of words (owner design D, 2026-11-21): no pill, no dot. -->
        <ng-template #statusTpl let-g>
          <span class="pv-statuscell">
            <pf-status-words class="pv-status" [words]="words(g)" />
            @if (g.priority === 'urgent') { <span class="wg-prio" data-p="urgent">Urgent</span> }
          </span>
        </ng-template>
        <ng-template #whoTpl let-g let-status="status">
          <span class="wg-who">
            @if (fold() === 'tight' && !phone()) { <span class="wg-id pf-num">{{ g.sampleLabel }}</span> }
            <span class="wg-who__name pv-who__name pv-tile__who"><pf-daily-no [of]="g.items[0]?.subOrder" />{{ g.patientName }}</span>
            <span class="wg-who__meta pv-tile__meta pf-num" [attr.title]="g.testNames.join(' · ')">{{ rowMeta(g) }}</span>
            @if (g.mine) { <span class="pv-mine"><span class="pv-mine__dot" aria-hidden="true"></span>Assigned to you</span> }
            @if (status) { <span class="wg-who__fold"><ng-container [ngTemplateOutlet]="statusTpl" [ngTemplateOutletContext]="{ $implicit: g }" /></span> }
          </span>
        </ng-template>
        <ng-template #actsTpl let-g>
          <span class="wg-acts pv-acts" [class.pv-acts--stack]="!phone() && fold() !== 'full'">
            @if (unacknowledged(g)) {
              <!-- NABL: the explicit acknowledgement of the row's critical value(s) — always visible, never in a menu. -->
              <button type="button" class="pf-rowact wg-act wg-act--quiet pv-ack" [disabled]="acking() === g.key"
                      [attr.aria-label]="'Acknowledge critical result, sample ' + g.sampleLabel" title="Acknowledge critical result"
                      (click)="$event.stopPropagation(); acknowledge(g)">{{ acking() === g.key ? 'Acknowledging…' : 'Acknowledge' }}</button>
            }
            <button type="button" class="pf-rowact wg-act pv-review" data-action="review"
                    [attr.aria-label]="'Review ' + g.sampleLabel" title="Review"
                    (click)="$event.stopPropagation(); openOrder(g)">Review</button>
          </span>
        </ng-template>

        <!-- ── Side card: the consultant's scope + today + the ONE primary ── -->
        @if (sheetOpen()) { <div class="pf-sheet-backdrop" (click)="sheetOpen.set(false)"></div> }
        <aside class="pf-card pv-side" [class.pf-sheet]="sheetOpen()" [class.pv-side--open]="sheetOpen()"
               aria-label="Your scope" [attr.role]="sheetOpen() ? 'dialog' : null" [attr.aria-modal]="sheetOpen() ? true : null">
          <span class="pf-sheet__handle" aria-hidden="true"></span>
          <header class="pf-card__head">
            <span class="pf-card__icon" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v17.5a2.5 2.5 0 0 1-5 0V2"/><path d="M20 2v17.5a2.5 2.5 0 0 1-5 0V2"/><path d="M3 2h7M14 2h7"/></svg>
            </span>
            <h2 class="pf-card__label">Your scope</h2>
            <span class="pf-card__spacer"></span>
            @if (sheetOpen()) {
              <button type="button" class="pf-btn pf-btn--icon pv-side__x" aria-label="Close" (click)="sheetOpen.set(false)">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            }
          </header>
          <div class="pf-card__body pv-side__body">
            <!-- Missing registration number: it prints under this
                 consultant's signature — they can add it themselves. -->
            <pf-regno-prompt />
            <p class="pv-side__h">Departments</p>
            <div class="pv-side__depts">
              @if (scope()?.scoped) {
                @for (d of scope()!.departments; track d.id) {
                  <span class="pf-chip pf-chip--static pv-dept">{{ d.name }}</span>
                }
              } @else {
                <span class="pf-chip pf-chip--static pv-dept">All departments</span>
              }
            </div>
            <p class="pv-side__note">
              @if (scope()?.scoped) {
                You see and sign only these departments' results.
              } @else if (isAdmin()) {
                As an admin you see every department.
              } @else {
                No departments are assigned to you yet, so you see every department. An admin can assign yours in Users &amp; roles.
              }
            </p>

            <p class="pv-side__h">Today</p>
            <dl class="pv-stats">
              <div class="pv-stat"><dt>Pending</dt><dd class="pf-num">@if (statsSkel()) {<pf-skeleton variant="line" width="28px" height="16px"></pf-skeleton>} @else {{{ stats().pending }}}</dd></div>
              <div class="pv-stat" [attr.data-warn]="stats().overdue > 0 || null"><dt>Overdue</dt><dd class="pf-num">@if (statsSkel()) {<pf-skeleton variant="line" width="28px" height="16px"></pf-skeleton>} @else {{{ stats().overdue }}}</dd></div>
              <div class="pv-stat" [attr.data-warn]="stats().critical > 0 || null"><dt>Critical</dt><dd class="pf-num">@if (statsSkel()) {<pf-skeleton variant="line" width="28px" height="16px"></pf-skeleton>} @else {{{ stats().critical }}}</dd></div>
              <div class="pv-stat"><dt>Assigned to you</dt><dd class="pf-num">@if (statsSkel()) {<pf-skeleton variant="line" width="28px" height="16px"></pf-skeleton>} @else {{{ stats().mine }}}</dd></div>
              @if (scope(); as s) {
                <div class="pv-stat"><dt>Validated today</dt><dd class="pf-num">{{ s.validatedToday }}</dd></div>
                <div class="pv-stat"><dt>By you</dt><dd class="pf-num">{{ s.validatedTodayByMe }}</dd></div>
              }
            </dl>
            <p class="pv-side__note">Open a sample to review every test on the tube, then validate, reject, reassign or send it back for correction.</p>
          </div>
        </aside>
      </div>

      <!-- Phones: the side card's summary + its primary, above the navbar. -->
      <div class="pf-bottombar pv-bottombar">
        <button type="button" class="pf-bottombar__info pv-bottombar__info" (click)="sheetOpen.set(true)"
                aria-label="Show your scope and today's numbers">
          <span class="pf-num">{{ stats().pending }}</span> pending
          @if (stats().overdue) { · <span class="pv-bottombar__warn pf-num">{{ stats().overdue }} overdue</span> }
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>
        </button>
      </div>
    </section>
    } @else {
    <section class="pv-page px-4 md:px-8 pt-6">
      <div class="pv-head">
        <pf-kpi-strip screen="pathologist"></pf-kpi-strip>
        <pf-screen-header
          eyebrow="Validation queue"
          title="Pending validation"
          subtitle="Review entered results. Validate, reject, or reassign to another pathologist.">
          <pf-touch-btn actions size="sm" variant="secondary" class="pf-classic-only" (pressed)="refresh()" aria-label="Refresh"
                        [busy]="loading()" busyLabel="Refreshing…">
            <span icon-left aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/>
                <path d="M21 3v5h-5"/>
                <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/>
                <path d="M3 21v-5h5"/>
              </svg>
            </span>
            <span class="pv-refresh-label">Refresh</span>
          </pf-touch-btn>
        </pf-screen-header>

        <div class="mb-5 pf-classic-only">
          <pf-segmented
            [options]="tabOptions"
            [value]="tab()"
            size="md"
            (valueChange)="setTab($event)">
          </pf-segmented>
        </div>
        <div class="mb-4"><pf-regno-prompt /></div>
      </div>

      <div class="pv-scroll pb-10">
      @if (loading() && rows().length === 0) {
        <div class="space-y-2.5">
          @for (i of [0,1,2,3]; track i) {
            <pf-tile tone="default" padding="md">
              <div class="flex items-center gap-3">
                <pf-skeleton variant="circle" width="44px" height="44px"></pf-skeleton>
                <div class="flex-1 space-y-2">
                  <pf-skeleton variant="line" width="50%"></pf-skeleton>
                  <pf-skeleton variant="line" width="75%" height="10px"></pf-skeleton>
                </div>
                <pf-skeleton variant="line" width="104px" height="28px"></pf-skeleton>
              </div>
            </pf-tile>
          }
        </div>
      }

      @for (bucket of buckets(); track bucket.priority) {
        @if (bucket.items.length > 0) {
          <div class="mb-7">
            <div class="flex items-center gap-2 mb-3 px-1">
              <span class="pf-urg-dot" [class]="'pf-urg-' + bucket.priority"></span>
              <span class="text-[11px] font-mono uppercase tracking-[0.16em]"
                    style="color: var(--text-secondary);">
                {{ bucket.label }}
              </span>
              <span class="text-[11px] font-mono"
                    style="color: var(--text-muted);">
                · {{ bucket.items.length }}
              </span>
            </div>

            <div class="space-y-2.5">
              @for (g of sampleGroups(bucket.items); track g.key) {
                <pf-tile [tone]="rowTone(bucket.priority)" padding="md" class="block"
                         [pfZoomSource]="[g.key, g.items[0]?.subOrder?.id, g.items[0]?.id]">
                  <button type="button" class="w-full flex items-center gap-3 cursor-pointer text-left"
                          (click)="openOrder(g)"
                          [attr.aria-label]="'Validate ' + g.patientName + ' — ' + g.dept + ' sample'">
                    <pf-avatar [name]="g.displayName" [size]="44"></pf-avatar>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 flex-wrap">
                        <p class="font-semibold text-[15px] truncate" style="color: var(--text-primary);"><pf-daily-no [of]="g.items[0]?.subOrder" />{{ g.patientName }}</p>
                        <span class="pv-grp-count">{{ g.items.length }} test<span [class.hidden]="g.items.length === 1">s</span></span>
                        @if (g.mine) { <pf-chip tone="violet" size="sm">Assigned to you</pf-chip> }
                        @if (g.anyCritical) { <pf-chip tone="rose" size="sm">CRITICAL</pf-chip> }
                      </div>
                      <p class="pv-grp-meta text-[11.5px] font-mono mt-0.5 truncate" style="color: var(--text-tertiary);">
                        {{ g.dept }} · {{ g.sampleLabel }}
                        @for (lbl of g.testNames; track lbl) { <span class="ml-1">· {{ lbl }}</span> }
                      </p>
                    </div>
                    <pf-tat-indicator [remainingMinutes]="g.remainingMin"></pf-tat-indicator>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
                         style="color: var(--text-muted);">
                      <path d="m9 18 6-6-6-6"/>
                    </svg>
                  </button>
                </pf-tile>
              }
            </div>
          </div>
        }
      }

      @if (!loading() && rows().length === 0) {
        <pf-tile tone="default" padding="xl">
          <div class="text-center py-6">
            <p class="text-[14px]" style="color: var(--text-secondary);">
              Nothing pending. Everything is validated.
            </p>
          </div>
        </pf-tile>
      }
      </div>
    </section>
    }
  `,
  styles: [`
    @use '../../../shared/styles/device-tier' as dt;
    @use '../../../shared/styles/work-grid' as wg;
    @include wg.cells;
    /* ===== WORK page: non-scroll app layout on all sizes =====
       :host fills the shell's main area; the page is a flex column whose
       header (KPI + title + tabs) is fixed and the queue scrolls internally,
       so there is no outer page scroll / double scrollbar. */
    :host {
      display: block;
      height: 100%;
    }
    .pv-page {
      height: 100%;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .pv-head {
      flex: 0 0 auto;
    }
    .pv-scroll {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
    }

    .pv-grp-count {
      font-size: 10.5px; font-weight: 700;
      font-family: inherit; font-variant-numeric: tabular-nums;
      letter-spacing: 0.04em;
      padding: 3px 9px; border-radius: 999px;
      background: rgba(168, 85, 247, 0.14);
      color: var(--violet-text);
      border: 1px solid rgba(168, 85, 247, 0.28);
      flex-shrink: 0;
    }
    .hidden { display: none; }
    .pf-urg-dot {
      width: 8px;
      height: 8px;
      border-radius: 9999px;
      display: inline-block;
    }
    .pf-urg-urgent {
      background: #ef4444;
      box-shadow: 0 0 12px rgba(239, 68, 68, 0.6);
    }
    .pf-urg-normal {
      background: #94a3b8;
    }

    /* ===== Phone (<=640): stack expanded result rows so 3 actions don't overflow ===== */
    @media (max-width: 640px) {
      /* Phone: Refresh is icon-only (label kept in the a11y tree). */
      :host .pv-refresh-label {
        position: absolute; width: 1px; height: 1px;
        padding: 0; margin: -1px; overflow: hidden;
        clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
      }
      /* Phone cards: just name + time — drop the test-count badge and the
         "#orderId · tests" meta line. */
      :host .pv-grp-count { display: none !important; }
      :host .pv-grp-meta { display: none !important; }

      :host .pv-result-list {
        /* tighten the avatar-aligned indent so result rows aren't squeezed */
        padding-left: 0.5rem;
      }
      :host .pv-result-row {
        flex-wrap: wrap;
        align-items: flex-start;
      }
      /* test name takes the first line full width */
      :host .pv-result-row > span:first-child {
        flex: 1 1 100%;
        min-width: 0;
      }
      /* the "entered …" timestamp gets its own full-width line so the row
         reads cleanly as name / timestamp / actions instead of relying on
         wrap order; left-aligned and tightened above the action row */
      :host .pv-result-row > span:nth-child(2) {
        flex: 1 1 100%;
        min-width: 0;
        margin-top: 0.125rem;
      }
      /* action group drops to its own line and spreads the 3 buttons evenly */
      :host .pv-result-actions {
        display: flex;
        width: 100%;
        gap: 0.5rem;
      }
      :host .pv-result-actions > * {
        flex: 1 1 0;
        min-width: 0;
      }
    }

    /* ===== iPad (641-1279): keep one indented column, ensure no horizontal overflow ===== */
    @include dt.tablet-band {
      :host .pv-result-row {
        flex-wrap: wrap;
      }
      :host .pv-result-actions {
        flex-shrink: 0;
      }
    }

    /* ===== Narrow phone (<=400): 3 sm buttons crush at equal width — let them
       wrap onto a second line instead of squeezing below a tappable width ===== */
    @media (max-width: 400px) {
      :host .pv-result-actions {
        flex-wrap: wrap;
      }
      :host .pv-result-actions > * {
        flex: 1 1 calc(50% - 0.25rem);
      }
    }

    /* ===== Touch input: guarantee a 44px tap target on the patient-group toggle
       (a real <button> owned by this page) without altering pointer/desktop. The
       inline Reject/Reassign/Validate are <pf-touch-btn> shared primitives — they
       own their own coarse-pointer sizing, so we only ensure they don't collapse. */
    @media (pointer: coarse) {
      /* The only raw <button> this page renders is the patient-group toggle;
         give it a 44px tap target. The inline Reject/Reassign/Validate are
         <pf-touch-btn size="sm"> which the shared primitive already fixes at
         44px, so they need no help here. */
      :host button[type="button"] {
        min-height: 44px;
      }
    }
  
    /* ═══ New design ════════════════════════════════════════════════════
       Band + QUEUE card + SCOPE side card. No page scroll: only the card
       bodies scroll. Kit classes carry the look; the rules below place
       them and draw the tube tile (lab work lists: sample ID primary). */
    .pv-page {
      height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden;
    }
    .pv-body { gap: 16px; }
    /* Tablet: the side card stays, narrower. */
    @media (min-width: 641px) and (max-width: 1023px) {
      .pv-body { display: grid; grid-template-columns: 260px minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
      /* The DOM keeps main first (phones stack it first); the side card sits LEFT, the queue takes the rest. */
      .pv-body > .pv-side { grid-column: 1; grid-row: 1; }
      .pv-body > .pv-queue { grid-column: 2; grid-row: 1; }
    }

    /* Band filter: neutral segmented, plain tabular counts. */
    .pv-seg { flex-shrink: 0; }
    .pv-seg__item { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
    .pv-seg__item:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 1px; }
    .pv-seg__count { font-size: 11.5px; font-weight: 500; color: var(--text-tertiary); }
    .pv-seg__item[aria-checked='true'] .pv-seg__count { color: var(--color-violet-600, #7c3aed); }

    /* Queue card header: count is plain muted text, never a pill. */
    .pv-count { font-size: 12.5px; font-weight: 500; color: var(--text-tertiary); white-space: nowrap; }
    .pv-depts { max-width: 100%; overflow-x: auto; scrollbar-width: none; }
    .pv-depts::-webkit-scrollbar { display: none; }
    .pv-scroll { gap: 18px; padding: 14px 16px 18px; }

    /* Grid body: flush — the grid scrolls inside the card (no page scroll). */
    .pv-scroll--grid { padding: 0; gap: 0; overflow: hidden; display: flex; flex-direction: column; }
    .pv-gridc { flex: 1 1 auto; min-height: 0; }
    .pv-statuscell { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 2px; }
    .pv-wait-sub { white-space: normal; overflow-wrap: normal; }   /* "entered 10:50 AM" wraps by words, never clipped */
    .pv-acts--stack { flex-direction: column; align-items: flex-end; gap: 8px; padding: 6px 0; }
    .wg-who__fold .pv-statuscell { justify-content: flex-start; }
    .pv-tile__id { font-size: 14.5px; }

    /* "Assigned to you": quiet text with the one violet mark. */
    .pv-mine { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; color: var(--text-secondary); }
    .pv-mine__dot { width: 6px; height: 6px; border-radius: 999px; background: var(--color-violet-600, #7c3aed); }

    .pv-empty { flex: 1 1 auto; justify-content: center; }

    /* Side card: calm type — 11px uppercase muted titles, 12.5–13 body. */
    .pv-side__body { gap: 10px; padding: 14px 16px; }
    .pv-side__h { margin: 6px 0 0; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-tertiary); }
    .pv-side__h:first-child { margin-top: 0; }
    .pv-side__depts { display: flex; flex-wrap: wrap; gap: 6px; }
    .pv-dept { height: 28px; }
    .pv-side__note { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--text-tertiary); text-wrap: pretty; }
    .pv-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 0; }
    .pv-stat {
      display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: var(--pf-radius-sm);
      border: 1px solid var(--pf-line); background: var(--pf-card-bg);
    }
    .pv-stat dt { font-size: 12px; color: var(--text-tertiary); }
    .pv-stat dd { margin: 0; font-size: 18px; font-weight: 500; color: var(--text-primary); }
    .pv-stat[data-warn] dd { color: var(--red-text, #b91c1c); }
    .pv-next { white-space: normal; text-align: center; line-height: 1.25; }
    .pv-side__x { width: 44px; min-width: 44px; }

    /* Phones: one column; the side card becomes a sheet (above the navbar),
       its summary + primary ride the bottom bar. */
    @media (max-width: 640px) {
      .pv-body { padding-bottom: calc(76px + env(safe-area-inset-bottom, 0px)); }
      .pv-side:not(.pv-side--open) { display: none; }
      .pv-side.pf-sheet { border-radius: 20px 20px 0 0; }
      .pv-refresh__t { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
      .pv-queue__head { row-gap: 8px; }
      .pv-depts { flex: 1 1 100%; }
      .pv-seg__item { min-height: 44px; height: 44px; }
      .pv-depts .pv-seg__item { min-height: 40px; height: 40px; }
      .pv-scroll { padding: 0; }
      .pv-bottombar__info {
        display: inline-flex; align-items: center; gap: 4px; min-height: 44px;
        border: 0; background: transparent; padding: 0; text-align: left; color: var(--text-primary); font: inherit; font-size: 13px; font-weight: 600;
      }
      .pv-bottombar__warn { color: var(--red-text, #b91c1c); }
      .pv-next--bar { flex: none; }
    }
  `]
})
export class PendingValidationComponent implements OnInit, AfterViewInit {
  private readonly api = inject(ApiService);
  /** Design version gate — 'new' renders the ND screen, 'classic' the pre-port look. */
  readonly theme = inject(ThemeService);
  private readonly auth = inject(AuthService);
  private readonly liveQ = inject(LiveQueueService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly router = inject(Router);
  /** Row actions: text on web, 44px icons on touch (ND §1). */
  readonly web = webPointerSignal();

  readonly tabOptions: SegmentedOption<Tab>[] = [
    // Icons so the strip stays readable on a phone, where the words are
    // swapped out; the label still drives the tooltip + accessible name.
    { value: 'mine', label: 'My queue',
      iconPath: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z'] },
    { value: 'all',  label: 'All pathologists',
      iconPath: ['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2',
                 'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
                 'M23 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'] }
  ];
  private readonly _tab = signal<Tab>('all');
  readonly tab = this._tab.asReadonly();
  setTab(t: Tab) {
    this._tab.set(t);
    // New design filters locally (both tabs show a count); classic asks the server.
    if (!this.theme.isNewDesign()) this.refresh();
  }

  rowTone(priority: OrderPriority): TileTone {
    return priority === 'urgent' ? 'rose' : 'default';
  }

  /** Classic: group the queue by SAMPLE (one tube / department) so a sample
   *  with N tests is one row — opening it reviews the whole tube at once. */
  sampleGroups(items: Enriched[]) {
    return groupBySample(items, this.auth.user()?.id).map(g => ({
      ...g,
      // Classic keeps its compact "Name | 44/F | MRN" line.
      patientName: formatPatientInfo(g.items[0]?.subOrder?.order?.patient),
      displayName: g.items[0]?.subOrder?.order?.patient?.displayName || 'Patient',
      testNames: g.testNames.slice(0, 4),
    }));
  }

  private readonly _rows = signal<OrderTest[]>([]);
  readonly rows = this._rows.asReadonly();

  private readonly _loading = signal(false);
  readonly loading = this._loading.asReadonly();
  /** First load: the side card's numbers are placeholders, not zeros. */
  readonly statsSkel = computed(() => this._loading() && this._rows().length === 0);

  /** Hero-band query — filters the queue by patient, MRN, sample ID, or test. */
  readonly query = signal('');

  readonly buckets = computed(() => {
    const q = this.query().trim().toLowerCase();
    const enriched = enrich(this._rows().filter(t => matchesQuery(t, q)));
    // Groups are the ORDER priority (Urgent / Normal); TAT is the row chip.
    return [
      { priority: 'urgent' as const, label: 'Urgent', items: enriched.filter(e => e._priority === 'urgent') },
      { priority: 'normal' as const, label: 'Normal', items: enriched.filter(e => e._priority === 'normal') }
    ];
  });

  isCritical(t: OrderTest): boolean { return isCritical(t); }

  // ── New design ───────────────────────────────────────────────────────
  /** The consultant's scope (their departments) + today's sign-outs. */
  readonly scope = signal<ValidationScope | null>(null);
  /** Card-header department filter (null = all of the caller's departments). */
  readonly dept = signal<string | null>(null);
  /** Phones: the side card as a sheet. */
  readonly sheetOpen = signal(false);
  readonly isAdmin = computed(() => this.auth.hasPermission('manage_tenant'));

  /** Every tube in the queue after the search (before tab / department). */
  private readonly allTiles = computed(() => {
    const q = this.query().trim().toLowerCase();
    return groupBySample(enrich(this._rows().filter(t => matchesQuery(t, q))), this.auth.user()?.id);
  });
  /** Tab (All · Assigned to me) applied — what the department filter counts. */
  private readonly tabTiles = computed(() =>
    this._tab() === 'mine' ? this.allTiles().filter(t => t.mine) : this.allTiles());
  readonly deptFilters = computed(() => departmentsIn(this.tabTiles()));
  readonly deptSegmentOptions = computed<SegmentedOption<string | null>[]>(() => [
    { value: null, label: 'All' },
    ...this.deptFilters().map(d => ({ value: d.id, label: d.name, count: d.count })),
  ]);
  readonly visibleTiles = computed(() => {
    // The department pills are phones-only now: elsewhere the grid's Department column filters (never a hidden filter).
    const d = this.phone() ? this.dept() : null;
    const tiles = this.tabTiles();
    // A department that left the queue drops the filter instead of hiding everything.
    if (!d || !tiles.some(t => (t.deptId ?? t.dept) === d)) return tiles;
    return tiles.filter(t => (t.deptId ?? t.dept) === d);
  });
  readonly ndGroups = computed(() => {
    const tiles = this.visibleTiles();
    return [
      { priority: 'urgent' as const, label: 'Urgent', tiles: tiles.filter(t => t.priority === 'urgent') },
      { priority: 'normal' as const, label: 'Normal', tiles: tiles.filter(t => t.priority === 'normal') },
    ].filter(g => g.tiles.length > 0);
  });
  readonly ndTabs = computed(() => [
    { value: 'all' as Tab, label: 'All', count: this.allTiles().length },
    { value: 'mine' as Tab, label: 'Assigned to me', count: this.allTiles().filter(t => t.mine).length },
  ]);
  readonly countLabel = computed(() => plural(this.visibleTiles().length, 'sample'));
  readonly stats = computed(() => {
    const tiles = this.allTiles();
    return {
      pending: tiles.length,
      overdue: tiles.filter(t => t.tat === 'overdue').length,
      critical: tiles.filter(t => t.anyCritical).length,
      mine: tiles.filter(t => t.mine).length,
    };
  });
  readonly next = computed(() => nextTile(this.visibleTiles()));

  // ── The queue as a GRID (owner 2026-11-20: "the grid format we had against Frontdesk and Results") ──
  // Same tiles, same order (Urgent first, then mine → priority → least time left), one row each. The rules live in
  // pending-validation.grid.ts; the row tap / Review / Acknowledge are this screen's existing handlers.
  /** Phones (≤640px): card rows. */
  readonly phone = mediaSignal('(max-width: 640px)', inject(DestroyRef));
  readonly gridRows = computed(() => pvRows(this.ndGroups()));
  private readonly queueCard = viewChild<ElementRef<HTMLElement>>('queueCard');
  private readonly zone = inject(NgZone);
  private readonly cardW = signal(1000);
  /** The widest column tier whose minimum widths fit the main card (columns fold before any button shrinks). */
  readonly fold = computed<GridFold>(() => this.foldFor(this.cardW()));
  private foldFor(w: number): GridFold {
    // Fixed columns lay out at their `width`, flex columns at least at `minWidth` — per tier (the actions stack when
    // columns fold, so the patient keeps its room).
    const mins = (f: GridFold) => Object.fromEntries(Object.entries(this.sizes(f)).map(([k, v]) => [k, v.width ?? v.minWidth ?? 0]));
    return fitFold(w, f => minWidthOf(pvColumns(f), mins(f)));
  }
  private sizes(fold: GridFold): Record<string, ColDef<QueueTile>> {
    const touch = !this.web();
    // Acknowledge + Review: side by side when there is room; STACKED (Acknowledge above Review, 8 apart, each ≥44 on
    // touch) once columns fold — the patient name keeps whole words on its line (owner review 2026-11-20).
    const ack = this.gridRows().some(g => this.unacknowledged(g));
    const stacked = fold !== 'full';
    const acts = !ack ? (touch ? 120 : 112) : stacked ? 140 : (touch ? 236 : 220);
    return {
      // Wide enough for "Sample ID" + its sort arrow + filter icon (headers never truncate).
      sample: { width: 128, minWidth: 128 },
      patient: { flex: 1, minWidth: fold === 'tight' ? 190 : 250 },
      dept: { width: 150, minWidth: 140 },
      status: { width: 184, minWidth: 176 },
      due: { width: 100, minWidth: 100 },
      wait: { width: 118, minWidth: 118 },
      acts: { width: acts, minWidth: acts },
    };
  }
  /** Every column through the shared work-grid helpers (shared/utils/work-grid.ts): alignment + header filter + a
   *  sort on the REAL value (minutes left / minutes waiting, the whole name), built together. */
  private colRule(colId: string, def: ColDef<QueueTile>): ColDef<QueueTile> {
    const set = WorkSetFilterComponent;
    const wrap = (d: ColDef<QueueTile>) => ({ ...d, cellClass: 'wg-c-wrap' });
    switch (colId) {
      case 'sample': return textCol<QueueTile>(def, g => g.sampleLabel);
      case 'patient': return textCol<QueueTile>(wrap(def), g => {
        const p = g.items[0]?.subOrder?.order?.patient as { mrn?: string; phone?: string } | undefined;
        return [g.patientName, p?.mrn, p?.phone].filter(Boolean).join(' ');
      }, 'left', g => g.patientName);
      // Department (the old head pills) + Status words read LEFT (two lines, design D).
      case 'dept': return valuesCol<QueueTile>(wrap(def), g => g.dept ?? '', set, 'left');
      case 'status': return valuesCol<QueueTile>(wrap(def), g => this.status(g).label, set, 'left');
      case 'due': return durationCol<QueueTile>(def, g => dueValue(g.remainingMin), { kind: 'due' });
      case 'wait': return durationCol<QueueTile>(def, g => minutesSince(g.items.map(i => i.resultedAt).filter(Boolean).sort().pop() ?? null), { kind: 'wait' });
      default: return actionCol<QueueTile>({ ...def, cellClass: 'wg-c-acts' });
    }
  }
  private readonly sampleTpl = viewChild<TemplateRef<unknown>>('cSample');
  private readonly patientTpl = viewChild<TemplateRef<unknown>>('cPatient');
  private readonly statusColTpl = viewChild<TemplateRef<unknown>>('cStatus');
  private readonly deptColTpl = viewChild<TemplateRef<unknown>>('cDept');
  private readonly dueTpl = viewChild<TemplateRef<unknown>>('cDue');
  private readonly waitTpl = viewChild<TemplateRef<unknown>>('cWait');
  private readonly actsColTpl = viewChild<TemplateRef<unknown>>('cActs');
  readonly defaultCol: ColDef<QueueTile> = { sortable: false, resizable: false, filter: false, suppressMovable: true, wrapText: true, autoHeight: true, minWidth: 60 };
  readonly rowId = (p: GetRowIdParams<QueueTile>) => p.data.key;
  readonly rowClass = (p: RowClassParams<QueueTile>) => (p.data?.priority === 'urgent' ? ['pv-row', 'wg-row--urgent'] : ['pv-row']);
  readonly cols = computed<ColDef<QueueTile>[]>(() => {
    const tpl: Record<string, TemplateRef<unknown> | undefined> = {
      sample: this.sampleTpl(), patient: this.patientTpl(), status: this.statusColTpl(),
      due: this.dueTpl(), wait: this.waitTpl(), acts: this.actsColTpl(), dept: this.deptColTpl(),
    };
    const size = this.sizes(this.fold());
    return pvColumns(this.fold()).map(c => this.colRule(c.colId, {
      colId: c.colId, headerName: c.header, hide: c.hide, ...size[c.colId],
      cellRenderer: DataGridTemplateCellComponent, cellRendererParams: { tpl: tpl[c.colId] },
    }));
  });
  waiting(g: QueueTile) { return pvWaiting(g); }
  /** "44/F · AA0007 · Haematology · 2 tests" — no Tests column (owner 2026-11-20); names in the tooltip. */
  rowMeta(g: QueueTile): string { return pvMeta(g, this.phone() || this.fold() === 'tight'); }
  /** The Status cell's two lines (pending-validation.grid.ts). */
  words(g: QueueTile) { return pvWords(tileStatus(g), this.unacknowledged(g)); }
  /** "in 25m" / rose "12m late" — the tube's time left to TAT. */
  due(g: QueueTile) { return dueCell(g.remainingMin); }
  /** A tap on the row = the old tile tap (open the review); a button in the row does its own thing. */
  onRow(e: RowClickedEvent<QueueTile>): void {
    const t = e.event?.target as HTMLElement | null;
    if (t?.closest?.('button, a, [role="menu"]')) return;
    if (e.data) this.openOrder(e.data);
  }
  onCard(g: QueueTile, ev: Event): void {
    if ((ev.target as HTMLElement | null)?.closest?.('button')) return;
    this.openOrder(g);
  }
  key(g: QueueTile, ev: Event): void { ev.preventDefault(); ev.stopPropagation(); this.openOrder(g); }

  ngAfterViewInit(): void {
    const el = this.queueCard()?.nativeElement;
    if (!el || typeof ResizeObserver === 'undefined') return;
    this.zone.runOutsideAngular(() => {
      const ro = new ResizeObserver(entries => {
        const w = Math.round(entries[0]?.contentRect.width ?? el.clientWidth);
        if (w <= 0) return;
        if (this.foldFor(w) !== this.foldFor(this.cardW())) this.zone.run(() => this.cardW.set(w));
        else this.cardW.set(w);
      });
      ro.observe(el);
      this.destroyRef.onDestroy(() => ro.disconnect());
    });
  }
  readonly emptyTitle = computed(() =>
    this.query().trim() ? 'No matching samples'
      : this._tab() === 'mine' && this._rows().length ? 'Nothing assigned to you' : 'Nothing to validate');
  readonly emptyBody = computed(() =>
    this.query().trim() ? 'Try a patient name, MRN, sample ID or test.'
      : this._tab() === 'mine' && this._rows().length ? 'Switch to All to see the rest of the queue.'
      : this.scope()?.scoped ? 'Results from your departments appear here as soon as the lab submits them.'
      : 'Results appear here as soon as the lab submits them.');

  /** ONE status word: an open NABL record turns "Critical" into "Critical · not acknowledged". */
  status(g: QueueTile) {
    const st = tileStatus(g);
    return st.key === 'critical' && this.unacknowledged(g) ? { ...st, label: 'Critical · not acknowledged' } : st;
  }

  // ── NABL critical-result records of the queued lines ───────────────────
  private readonly criticalSvc = inject(CriticalResultsService);
  private readonly _critical = signal<CriticalResultEvent[]>([]);
  readonly acking = signal<string | null>(null);
  /** This user still has to acknowledge a record on one of the tile's lines. */
  unacknowledged(g: QueueTile): boolean {
    const me = this.auth.user()?.id;
    const ids = new Set(g.items.map(i => i.id));
    return this._critical().some(e => ids.has(e.orderTestId) && needsAckBy(e, me));
  }
  loadCritical(ids: string[]) {
    if (!ids.length) { this._critical.set([]); return; }
    this.criticalSvc.lookupOpen(ids).subscribe({ next: l => this._critical.set(l ?? []), error: () => { /* advisory */ } });
  }
  acknowledge(g: QueueTile) {
    if (this.acking()) return;
    const me = this.auth.user()?.id;
    const ids = new Set(g.items.map(i => i.id));
    const pending = this._critical().filter(e => ids.has(e.orderTestId) && needsAckBy(e, me));
    if (!pending.length) return;
    this.acking.set(g.key);
    let left = pending.length;
    for (const e of pending) {
      this.criticalSvc.acknowledge(e.id, 'pathologist_queue').subscribe({
        next: u => { this._critical.update(l => l.map(x => (x.id === u.id ? u : x))); if (--left === 0) { this.acking.set(null); this.toasts.success('Critical result acknowledged'); } },
        error: err => { this.acking.set(null); this.toasts.error(ApiError.from(err).message); },
      });
    }
  }
  /** "44/F · AA0007 · Haematology · entered 9:48 PM" — Noto, tabular, `·`. */
  tileMeta(g: QueueTile): string {
    const at = g.items.map(t => t.resultedAt).filter(Boolean).sort().pop();
    const time = at ? new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    return [g.patientMeta, g.dept, time && `entered ${time}`].filter(Boolean).join(' · ');
  }
  reviewNext() {
    const n = this.next();
    this.sheetOpen.set(false);
    if (n) this.openOrder(n);
  }

  ngOnInit() {
    this.refresh();
    // Live queue: refetch when the server says this area changed (no polling).
    this.liveQ.on('validation').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refresh());
  }

  refresh() {
    // New design: always the whole (department-scoped) queue — the tabs
    // filter locally. Classic keeps the server-side ?mine switch.
    const mine = !this.theme.isNewDesign() && this._tab() === 'mine';
    this._loading.set(true);
    this.api.get<OrderTest[]>(`/api/validation/queue?mine=${mine}`).subscribe({
      next: l => {
        // Defence against the backend leaking past-state rows: only 'entered'
        // tests are awaiting validation. Filtering here keeps Reject / Validate
        // / Reassign from firing on already-validated or re-entry rows.
        this._rows.set((l ?? []).filter(t => t.status === 'entered'));
        this._loading.set(false);
        this.loadCritical(this._rows().map(t => t.id));
      },
      error: () => this._loading.set(false)
    });
    if (this.theme.isNewDesign()) {
      this.api.get<ValidationScope>('/api/validation/scope').subscribe({
        next: s => this.scope.set(s ?? null),
        error: () => { /* older server: the side card says "All departments" */ },
      });
    }
  }

  openValidate(t: OrderTest) {
    this.goToReview(t, [t]);
  }

  /** Validation review = the SAME screen the tech entered on (?validate=1).
   *  A CULTURE test signs out on the Culture case page (owner). */
  private goToReview(t: OrderTest, siblings: OrderTest[]) {
    if (isCultureOrderTest(t)) { this.router.navigate(['/lab/culture', t.id]); return; }
    const culture = siblings.find(x => isCultureOrderTest(x));
    if (culture && siblings.every(x => isCultureOrderTest(x))) { this.router.navigate(['/lab/culture', culture.id]); return; }
    const isCulture = !!culture;
    const sampleId = t.subOrder?.id;
    if (!isCulture && sampleId) {
      this.router.navigate(['/lab/sample', sampleId], { queryParams: { validate: 1 } });
    } else {
      this.router.navigate(['/pathologist/validate', t.id]);
    }
  }

  /** One-click: tapping a pending tube goes straight to the review screen
   *  for its first pending test (no expand-then-Validate step). Reject /
   *  reassign live on that screen. */
  openOrder(g: { items: OrderTest[] }) {
    const first = g.items[0];
    if (first) this.goToReview(first, g.items);
  }

  async openReject(t: OrderTest) {
    const reason = await this.dialog.prompt({
      title: 'Reject result?',
      message: `Reject result for ${t.test?.name}. The lab tech will be notified.`,
      placeholder: 'Reason for rejection…',
      multiline: true,
      required: true,
      tone: 'danger',
      confirmLabel: 'Reject result'
    });
    if (!reason) return;
    this.api.post<OrderTest>(`/api/validation/${t.id}/reject`, { reason }).subscribe({
      next: () => {
        this.toasts.success('Rejected — lab tech notified');
        this._rows.update(l => l.filter(x => x.id !== t.id));
      },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }

  /** Reassign to another validator who covers this result's department —
   *  a picker (DialogService choose), never a pasted id. */
  async reassign(t: OrderTest) {
    const id = await pickReassignee(this.api, this.dialog, this.toasts, t);
    if (!id) return;
    this.api.post<OrderTest>(`/api/validation/${t.id}/reassign`, { assigneeId: id }).subscribe({
      next: () => { this.toasts.success('Reassigned'); this._rows.update(l => l.filter(x => x.id !== t.id)); },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }

  // Screen view state (owner 2026-11-21): tab, search and department come back as left after in-app navigation.
  private readonly _viewState = inject(ViewStateService).bind('pathologist', { tab: this._tab, query: this.query, dept: this.dept });
}
