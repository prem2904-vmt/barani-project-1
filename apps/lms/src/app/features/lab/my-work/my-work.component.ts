import { DatePipe } from '@angular/common';
import { DestroyRef, ChangeDetectionStrategy, Component, ElementRef, Injector, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { buildReportBlobUrl } from '../../../shared/utils/report-blob';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { LiveQueueService } from '../../../core/services/live-queue.service';
import { ScanService } from '../../../core/services/scan.service';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { BarcodeScannerModalComponent } from '../../../shared/components/barcode-scanner/barcode-scanner-modal.component';
import { TatIndicatorComponent } from '../../../shared/components/tat-indicator/tat-indicator.component';
import { DelegateModalComponent } from './delegate-modal.component';
import { CulturePanelComponent } from '../culture-panel/culture-panel.component';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { ReceiveSamplesComponent } from '../receive-samples/receive-samples.component';
import { SampleCollectionComponent } from '../sample-collection/sample-collection.component';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SkeletonComponent } from '../../../shared/primitives/skeleton.component';
import { TileComponent, TileTone } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { Department } from '../../../shared/models/tenant.model';
import { OrderSample, OrderTest, logicalTestCount } from '../../../shared/models/order.model';
import { formatPatientInfo, formatPatientMeta } from '../../../shared/models/patient.model';
import { ApiError } from '../../../shared/models/api-response.model';
import { KpiStripComponent } from '../../../shared/components/kpi-strip/kpi-strip.component';
import { WorkAreaPanelsComponent } from '../../../shared/workflow/work-area-panels.component';

const LAST_DEPT_KEY = 'pf-lms.my-work.last-dept-code';

type Tab = 'intake' | 'my_work' | 'service_queue' | 'rejected' | 'completed';
type Level = 'urgent' | 'high' | 'normal';
type Bucket = { level: Level; items: Enriched[] };
type Enriched = OrderTest & { _level: Level; _remainingMin: number };

interface CounterSpec {
  id: 'pending' | 'critical' | 'in_progress' | 'done' | 'all';
  label: string;
  tone: 'amber' | 'rose' | 'violet' | 'emerald' | 'default';
}

const COUNTERS: CounterSpec[] = [
  { id: 'pending',     label: 'Pending',     tone: 'amber' },
  { id: 'critical',    label: 'Critical',    tone: 'rose' },
  { id: 'in_progress', label: 'In progress', tone: 'violet' },
  { id: 'done',        label: 'Done today',  tone: 'emerald' },
  { id: 'all',         label: 'All',         tone: 'default' }
];

@Component({
  selector: 'pf-my-work',
  standalone: true,
  imports: [
    DatePipe, FormsModule, BarcodeScannerModalComponent, DelegateModalComponent, TatIndicatorComponent,
    AvatarComponent, ReceiveSamplesComponent, SampleCollectionComponent, ScreenHeaderComponent, SkeletonComponent, TileComponent, TouchButtonComponent, KpiStripComponent, WorkAreaPanelsComponent, CulturePanelComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-5 md:px-8 lg:px-10 pt-4 pb-3">

      <!-- KPI strip: not on phone (status lives in the header Stats popover). -->
      @if (!isPhone()) {
        <pf-kpi-strip screen="lab_my_work"></pf-kpi-strip>
      }

      <!-- Actions dragged into the Lab work-area in /admin/process render here. -->
      <pf-work-area-panels menu="lab" />

      <pf-screen-header eyebrow="Lab workbench"
                        subtitle="Scan a barcode to jump straight to result entry, or pick from the queue below.">
        Lab <span class="text-gradient">my work</span>
        <!-- Phone-only (<=640px) Stats icon — sits next to Refresh, matched in
             size/shape (same pattern as the Report queue stats button). Each is
             a direct [actions] element so the header lays them out with the
             standard gap. Hidden above 640px, where the inline chips show. -->
        <div actions class="pf-kpi-statbtn-m">
          <button #kpiBtn type="button" class="pf-kpi-statbtn"
                  [class.is-open]="kpiOpen()"
                  aria-label="Stats"
                  [attr.aria-expanded]="kpiOpen()"
                  (click)="kpiOpen.set(!kpiOpen())">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
            </svg>
          </button>
          @if (kpiOpen()) {
            <!-- Teleported to <body> (see _kpiPortal effect) so no ancestor
                 overflow / backdrop-filter stacking context can trap it. -->
            <div #kpiPop class="pf-kpi-portal">
              <div class="pf-kpi-pop__backdrop" aria-hidden="true" (click)="kpiOpen.set(false)"></div>
              <div class="pf-kpi-pop" role="dialog" aria-label="Queue stats"
                   [style.top.px]="kpiPos().top" [style.right.px]="kpiPos().right">
                @for (c of counters; track c.id) {
                  <button type="button" class="pf-kpi-stat" [class.is-on]="counter() === c.id"
                          [attr.data-tone]="c.tone"
                          (click)="setCounter(c.id); kpiOpen.set(false)">
                    <span class="pf-kpi-stat__dot" aria-hidden="true"></span>
                    <span class="pf-kpi-stat__label">{{ c.label }}</span>
                    <span class="pf-kpi-stat__value">{{ counterValue(c.id) }}</span>
                  </button>
                }
              </div>
            </div>
          }
        </div>
        <pf-touch-btn actions variant="secondary" size="sm" (pressed)="refresh()" aria-label="Refresh">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" icon-left>
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
            <path d="M21 3v5h-5"/>
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
            <path d="M3 21v-5h5"/>
          </svg>
          <span class="pf-refresh-label">Refresh</span>
        </pf-touch-btn>
      </pf-screen-header>

      <!-- Counter filter pills — moved up here directly under the
           header so the counts read as page metadata, and the scan
           bar sits below as the primary CTA. On phones these collapse
           behind the Stats toggle above (pf-kpi-collapsed). -->
      <!-- Inline counter filter row: not on phone (status + filtering live in
           the header Stats popover there). -->
      @if (!isPhone()) {
        <div class="pf-counter-row" role="tablist" aria-label="Filter queue">
          @for (c of counters; track c.id) {
            <button type="button"
                    class="pf-counter"
                    [class.pf-counter--on]="counter() === c.id"
                    [attr.data-tone]="c.tone"
                    [attr.aria-pressed]="counter() === c.id"
                    (click)="setCounter(c.id)">
              <span class="pf-counter__dot" aria-hidden="true"></span>
              <span class="pf-counter__label">{{ c.label }}</span>
              <span class="pf-counter__value">{{ counterValue(c.id) }}</span>
            </button>
          }
        </div>
      }

      <!-- Scan bar — primary entry point. Clean compact pill, camera
           shortcut on the right, manual-entry inline link below. -->
      <div class="pf-scan-row">
        <div class="pf-scan">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="pf-scan__icon" aria-hidden="true">
            <path d="M3 5v14M6 5v14M9 5v14M12 5v14M15 5v14M18 5v14M21 5v14"/>
          </svg>
          <input type="text"
                 [value]="scan()"
                 (input)="setScan(asInput($event))"
                 (keydown.enter)="scanSubmit()"
                 [placeholder]="(scanSvc.manualEntry() ? 'Enter a sample ID (e.g. ' : 'Scan a barcode or type a sample ID (e.g. ') + sampleIdExample() + ')…'"
                 class="pf-scan__input"/>
          @if (!scanSvc.manualEntry()) {
          <button type="button"
                  class="pf-scan__camera press"
                  (click)="openBarSearchScanner()"
                  aria-label="Scan with camera">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="7" width="18" height="13" rx="2"/>
              <path d="M8 7 10 4h4l2 3"/>
              <circle cx="12" cy="13" r="3.5"/>
            </svg>
          </button>
          }
        </div>
        <pf-touch-btn class="pf-open-btn" variant="primary" size="lg" (pressed)="scanSubmit()" [disabled]="!scan()">
          Open
          <span icon-right>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 12h14m-5-6 6 6-6 6"/>
            </svg>
          </span>
        </pf-touch-btn>
      </div>

      <!-- The segmented "manual barcode entry" panel was removed: the scan box
           above already accepts a typed sample ID (and Enter submits it), so the
           panel duplicated the same job with a second, fiddlier control. -->

      <!-- 2-col layout: Lab Intake on the left, My Work / Queue tabs on
           the right. Same pattern as the Frontdesk landing splitter so
           the techs see the intake queue and their bench work side by
           side without tab-switching. Single drag handle in the middle. -->
      <!-- Phone-only (<=640px) single-pane tab control: Intake / Queue /
           My Work / Done. Hidden above 640px, where all panes lay out together.
           Selecting My Work / Queue drives the existing internal tab via
           setMobileTab → setTab so the right pane loads the right data. -->
      <div class="pf-mtabs" role="tablist" aria-label="Sections">
        @if (showCollect()) {
        <button type="button" role="tab" class="pf-mtab press"
                [class.pf-mtab--on]="mobileTab() === 'intake'"
                [attr.aria-selected]="mobileTab() === 'intake'"
                (click)="setMobileTab('intake')">Collect</button>
        } @else if (showIntake()) {
        <button type="button" role="tab" class="pf-mtab press"
                [class.pf-mtab--on]="mobileTab() === 'intake'"
                [attr.aria-selected]="mobileTab() === 'intake'"
                (click)="setMobileTab('intake')">Intake</button>
        }
        <button type="button" role="tab" class="pf-mtab press"
                [class.pf-mtab--on]="mobileTab() === 'queue'"
                [attr.aria-selected]="mobileTab() === 'queue'"
                (click)="setMobileTab('queue')">
          Queue
          <span class="pf-mtab__count">{{ countFor('service_queue') }}</span>
        </button>
        <button type="button" role="tab" class="pf-mtab press"
                [class.pf-mtab--on]="mobileTab() === 'mywork'"
                [attr.aria-selected]="mobileTab() === 'mywork'"
                (click)="setMobileTab('mywork')">
          My Work
          <span class="pf-mtab__count">{{ countFor('my_work') }}</span>
        </button>
        <button type="button" role="tab" class="pf-mtab press"
                [class.pf-mtab--on]="mobileTab() === 'completed'"
                [attr.aria-selected]="mobileTab() === 'completed'"
                (click)="setMobileTab('completed')">
          Done
          <span class="pf-mtab__count">{{ countFor('completed') }}</span>
        </button>
        @if (showCulture()) {
          <button type="button" role="tab" class="pf-mtab press"
                  [class.pf-mtab--on]="mobileTab() === 'culture'"
                  [attr.aria-selected]="mobileTab() === 'culture'"
                  (click)="setMobileTab('culture')">
            Culture Bench
            <span class="pf-mtab__count">{{ cultureCount() }}</span>
          </button>
        }
      </div>

      <div class="pf-mw-split" #mwSplit
           [class.pf-mw-split--dragging]="mwDragging()">

        <!-- LEFT: Collect (collect-in-lab) OR Lab Intake. Shown when either
             mode is active; on phones this pane shows under the first tab.
             Hidden entirely when neither lab_intake nor collect-in-lab apply. -->
        @if (showLeftPane()) {

        <!-- Collect-in-lab: the tube is drawn at the bench. Embed the sample
             collection screen (its own KPI/header suppressed) so the tech draws
             + prints labels here; the backend auto-receives into the queue. -->
        @if (showCollect()) {
        <section class="pf-mw-pane" [style.flex-basis.%]="mwSplitPct()"
                 [class.pf-mobile-hide]="mobileTab() !== 'intake'">
          <header class="pf-mw-pane__hdr pf-mw-pane__hdr--intake">
            <span class="pf-mw-pane__title">Collect</span>
          </header>
          <div class="pf-mw-pane__body">
            <pf-sample-collection [embedded]="true" (sampleCollected)="onSampleReceived()"></pf-sample-collection>
          </div>
        </section>
        } @else {

        <!-- Lab Intake — header hosts an inline scan bar: barcode icon,
             manual-typing input, camera shortcut, and a Receive button.
             Hits Enter or clicks Receive to intake. The camera button opens
             the same scanner the standalone /lab/receive page uses. -->
        <section class="pf-mw-pane" [style.flex-basis.%]="mwSplitPct()"
                 [class.pf-mobile-hide]="mobileTab() !== 'intake'">
          <header class="pf-mw-pane__hdr pf-mw-pane__hdr--intake">
            <span class="pf-mw-pane__title">Lab Intake</span>
            <div class="pf-mw-scan" [class.pf-intake-open]="intakeSearchOpen()">
              <!-- Phone-only (<=640px) magnifier: collapses the cramped inline
                   search to an icon by default; tapping expands the full-width
                   input across the intake header row. Hidden >=641px. -->
              <button type="button" class="pf-intake-search-toggle press"
                      [attr.aria-label]="intakeSearchOpen() ? 'Close search' : 'Search intake'"
                      [attr.aria-expanded]="intakeSearchOpen()"
                      (click)="toggleIntakeSearch()">
                @if (intakeSearchOpen()) {
                  <!-- Expanded → tap again to collapse. -->
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M18 6 6 18M6 6l12 12"/>
                  </svg>
                } @else {
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
                  </svg>
                }
              </button>
              <svg class="pf-mw-scan__icon" width="14" height="14" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                   aria-hidden="true">
                <path d="M3 7V5a2 2 0 0 1 2-2h2"/>
                <path d="M17 3h2a2 2 0 0 1 2 2v2"/>
                <path d="M21 17v2a2 2 0 0 1-2 2h-2"/>
                <path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
                <path d="M7 8v8M11 8v8M15 8v8M19 8v3"/>
              </svg>
              <input #intakeSearchField type="text" class="pf-mw-scan__input"
                     [placeholder]="(scanSvc.manualEntry() ? 'Enter ' : 'Scan or type ') + sampleIdExample()"
                     [value]="intakeScanInput()"
                     (input)="intakeScanInput.set($any($event.target).value)"
                     (keydown.enter)="intakeReceive()" />
              @if (!scanSvc.manualEntry()) {
              <button type="button" class="pf-mw-scan__cam press" (click)="openIntakeScanner()"
                      title="Scan with camera" aria-label="Scan with camera">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="7" width="18" height="13" rx="2"/>
                  <path d="M8 7 10 4h4l2 3"/>
                  <circle cx="12" cy="13" r="3.5"/>
                </svg>
              </button>
              }
              <button type="button" class="pf-mw-scan__btn press"
                      [disabled]="!intakeScanInput().trim()"
                      (click)="intakeReceive()">Receive</button>
            </div>
          </header>
          <div class="pf-mw-pane__body">
            <pf-receive-samples #intakeRef [embedded]="true" (sampleReceived)="onSampleReceived()"></pf-receive-samples>
          </div>
        </section>
        }

        <!-- Drag handle -->
        <div class="pf-mw-handle" role="separator" aria-orientation="vertical"
             aria-label="Resize Lab Intake / Workbench"
             [attr.aria-valuenow]="mwSplitPct()" aria-valuemin="20" aria-valuemax="80" tabindex="0"
             (pointerdown)="onMwSplitPointerDown($event)"
             (pointermove)="onMwSplitPointerMove($event)"
             (pointerup)="onMwSplitPointerUp($event)"
             (pointercancel)="onMwSplitPointerUp($event)"
             (lostpointercapture)="onMwSplitPointerUp($event)">
          <span class="pf-mw-handle__grip" aria-hidden="true"></span>
        </div>
        }

        <!-- RIGHT: tabbed My Work + Queue. On phones this pane shows under
             the My Work / Queue tabs (hidden under Intake). -->
        <section class="pf-mw-pane"
                 [class.pf-mw-pane--solo]="!showLeftPane() && !showCulture()"
                 [class.pf-mobile-hide]="mobileTab() === 'intake' || mobileTab() === 'culture'">
          <header class="pf-mw-pane__hdr pf-mw-pane__hdr--tabs">
            <div class="pf-mw-tabs" role="tablist" aria-label="Workbench tabs">
              <button type="button" role="tab" class="pf-mw-tab press"
                      [class.pf-mw-tab--on]="tab() === 'service_queue'"
                      [attr.aria-selected]="tab() === 'service_queue'"
                      (click)="setTab('service_queue')">
                Queue
                <span class="pf-mw-tab__count">{{ countFor('service_queue') }}</span>
              </button>
              <button type="button" role="tab" class="pf-mw-tab press"
                      [class.pf-mw-tab--on]="tab() === 'my_work'"
                      [attr.aria-selected]="tab() === 'my_work'"
                      (click)="setTab('my_work')">
                My Work
                <span class="pf-mw-tab__count">{{ countFor('my_work') }}</span>
              </button>
              <!-- Work this tech has finished: submitted or since validated. Its
                   Edit action pulls a whole tube back into their own My Work. -->
              <button type="button" role="tab" class="pf-mw-tab press"
                      [class.pf-mw-tab--on]="tab() === 'completed'"
                      [attr.aria-selected]="tab() === 'completed'"
                      (click)="setTab('completed')">
                Completed
                <span class="pf-mw-tab__count">{{ countFor('completed') }}</span>
              </button>
              <!-- Supervisor view: also show tubes other techs already claimed,
                   so stuck work (tech on leave) can be found and delegated. -->
              @if (tab() === 'service_queue') {
                <button type="button" class="pf-mw-claimed-toggle press"
                        [class.pf-mw-claimed-toggle--on]="showClaimed()"
                        (click)="toggleShowClaimed()">
                  {{ showClaimed() ? '✓ ' : '' }}Show claimed
                </button>
              }
            </div>
            <p class="pf-mw-pane__meta">
              <!-- Sample-focused branches count TUBES — the unit of work on this
                   screen in that mode — not the tests inside them. -->
              {{ labCfg.sampleFocused() ? sampleCountIn(rows()) + ' samples' : rows().length + ' items' }}
              @if (countFor('rejected') > 0) { · {{ countFor('rejected') }} rejected }
            </p>
          </header>
          <div class="pf-mw-pane__body">
      @if (tab() === 'completed') {
      <!-- ── Completed: this tech's finished tubes, newest first ──────
           Read-only history with ONE action: Edit re-opens the whole tube
           (the unit of entry) back into this same tech's My Work after a
           mandatory reason, which the backend records in the audit trail. -->
      @if (completedLoading() && completedTubes().length === 0) {
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
          @for (i of [0,1,2]; track i) {
            <pf-tile tone="default" padding="md">
              <pf-skeleton variant="line" width="55%"></pf-skeleton>
              <div class="mt-2"><pf-skeleton variant="line" width="80%" height="10px"></pf-skeleton></div>
            </pf-tile>
          }
        </div>
      } @else if (completedTubes().length === 0) {
        <pf-tile tone="default" padding="xl">
          <p class="text-center text-sm" style="color: var(--text-tertiary);">
            Nothing completed in the last {{ completedDays }} days.
          </p>
        </pf-tile>
      } @else {
        <ul class="grid grid-cols-1 lg:grid-cols-2 gap-3">
          @for (tube of completedTubes(); track tube.sampleId) {
            <li>
              <div class="pf-tq pf-tq--done">
                <span class="pf-tq__cap" aria-hidden="true"></span>
                <div class="pf-tq__main pf-tq__main--link" role="link" tabindex="0"
                     [attr.aria-label]="'View results for ' + (tube.barcode || tube.sampleId)"
                     title="View results (read-only)"
                     (click)="viewCompletedTube(tube)"
                     (keydown.enter)="viewCompletedTube(tube)">
                  <div class="pf-tq__line">
                    <span class="pf-tq__id">{{ tube.barcode || tube.sampleId }}</span>
                    <span class="pf-tq__tag" [class.pf-tq__tag--warn]="tube.status === 'entered'">
                      {{ tube.status === 'validated' ? 'Validated' : 'Submitted' }}
                    </span>
                  </div>
                  <p class="pf-tq__sub">
                    <span class="pf-tq__who">{{ tube.patientName }}</span>
                    @if (tube.patientMeta) {
                      <span class="pf-tq__sep">·</span>{{ tube.patientMeta }}
                    }
                    <span class="pf-tq__sep">·</span>{{ tube.deptName || 'Tube' }}
                  </p>
                  <p class="pf-tq__note pf-done__tests">{{ tube.testNames }}</p>
                </div>
                <div class="pf-tq__side">
                  <span class="pf-tq__stat">
                    {{ tube.completedAt | date:'d MMM, h:mm a' }}
                    <span class="pf-tq__stat-u">{{ testCount(tube.tests) }} {{ testCount(tube.tests) === 1 ? 'test' : 'tests' }}</span>
                  </span>
                  <div class="pf-tq__acts">
                  @if (tube.status === 'validated') {
                    <button type="button" class="pf-tq__act pf-tq__act--print"
                            [disabled]="printingTubeId() === tube.sampleId"
                            [attr.aria-label]="'Print report for ' + (tube.barcode || tube.sampleId)"
                            (click)="printCompletedTube(tube)">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M6 9V2h12v7"/>
                        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                        <rect x="6" y="14" width="12" height="8" rx="1"/>
                      </svg>
                      <span class="pf-tq__act-t">{{ printingTubeId() === tube.sampleId ? 'Opening…' : 'Print' }}</span>
                    </button>
                  }
                  @if (canEditResult()) {
                    <button type="button" class="pf-tq__act"
                            [disabled]="reopeningTubeId() === tube.sampleId"
                            [attr.aria-label]="'Edit ' + (tube.barcode || tube.sampleId)"
                            (click)="editCompletedTube(tube)">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M12 20h9"/>
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>
                      </svg>
                      <span class="pf-tq__act-t">{{ reopeningTubeId() === tube.sampleId ? 'Opening…' : 'Edit' }}</span>
                    </button>
                  }
                  </div>
                </div>
              </div>
            </li>
          }
        </ul>
      }
      } @else {
      @if (loading() && rows().length === 0) {
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
          @for (i of [0,1,2,3]; track i) {
            <pf-tile tone="default" padding="md">
              <div class="flex items-start gap-3">
                <pf-skeleton variant="circle" width="40px" height="40px"></pf-skeleton>
                <div class="flex-1 space-y-2">
                  <pf-skeleton variant="line" width="60%"></pf-skeleton>
                  <pf-skeleton variant="line" width="85%" height="10px"></pf-skeleton>
                </div>
              </div>
              <div class="mt-4 flex justify-end">
                <pf-skeleton variant="line" width="96px" height="28px"></pf-skeleton>
              </div>
            </pf-tile>
          }
        </div>
      }

      @for (bucket of buckets(); track bucket.level) {
        @if (bucket.items.length > 0) {
          <div class="mb-6">
            <div class="flex items-center gap-3 mb-3 px-1">
              <span class="pf-dot" [attr.data-level]="bucket.level"></span>
              <h3 class="text-[11px] font-mono uppercase tracking-[0.18em]"
                  style="color: var(--text-secondary);">
                {{ bucket.level }} · {{ labCfg.sampleFocused() ? sampleCountIn(bucket.items) : bucket.items.length }}
              </h3>
            </div>

            <!-- Group by patient/order so a single patient with 3 tests is one
                 expandable card, not 3 floating cards across columns. -->
            @if (!labCfg.sampleFocused()) {
            <ul class="grid grid-cols-1 lg:grid-cols-2 gap-3">
              @for (g of patientGroups(bucket.items); track g.orderId) {
                <li>
                  <pf-tile [tone]="toneFor(bucket.level)" padding="md" class="block">
                    <button type="button" class="w-full flex items-center gap-3 cursor-pointer text-left"
                            (click)="toggleExpand(g.orderId)">
                      <pf-avatar [name]="g.patientName" [size]="40"></pf-avatar>
                      <div class="flex-1 min-w-0">
                        <!-- Line 1: standard patient format — Name(≤15 chars)+.. | age/sex | P-ID -->
                        <p class="text-[15px] font-semibold truncate" style="color: var(--text-primary);">{{ g.patientInfo }}</p>
                        <!-- Line 2: TAT urgency + how many tests ride on this card.
                             Expand the card (or open the tube) for test names + barcodes. -->
                        <div class="flex items-center gap-2 flex-wrap mt-1">
                          <pf-tat-indicator [tatLevel]="g.level" [remainingMinutes]="g.remainingMin"/>
                          <span class="pf-grp-count">{{ g.items.length }} test<span [class.hidden]="g.items.length === 1">s</span></span>
                        </div>
                      </div>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
                           [style.transform]="expanded(g.orderId) ? 'rotate(90deg)' : 'none'"
                           style="transition: transform 0.15s ease; color: var(--text-muted);">
                        <path d="m9 18 6-6-6-6"/>
                      </svg>
                    </button>
                    @if (expanded(g.orderId)) {
                      <!-- Sub-group the patient's tests by their tube
                           (OrderSample). One row per tube; the row lists
                           the tests inside it. Action button per tube
                           opens the scanner expecting THAT tube's
                           barcode — one scan loads every test in the
                           tube for combined entry (Fix 6 contract). -->
                      <ul class="mt-3 space-y-2 pl-2 sm:pl-12">
                        @for (tube of tubesIn(g.items); track tube.sampleId) {
                          <li class="rounded-lg p-2.5 pf-tube-tile pf-tube-tile--tappable"
                              [class.pf-tube-tile--rejected]="tube.rejections.length > 0"
                              [class.pf-tube-tile--picking]="pickingTubeId() === tube.sampleId"
                              role="button" tabindex="0"
                              [attr.aria-label]="(tab() === 'service_queue' ? 'Pick tube ' : 'Open tube ') + (tube.barcode || tube.sampleId)"
                              (click)="onCardActivate(tube, g.patientName, $event)"
                              (keydown.enter)="onCardActivate(tube, g.patientName)"
                              (keydown.space)="onCardActivate(tube, g.patientName)"
                              style="background: rgba(255,255,255,0.02); border: 1px solid var(--glass-border);">
                            <div class="flex items-center gap-2 mb-1.5">
                              <span class="text-[12.5px] font-semibold flex-1 truncate" style="color: var(--text-primary);">
                                {{ tube.deptName || 'Tube' }} · {{ testCount(tube.tests) }} test{{ testCount(tube.tests) === 1 ? '' : 's' }}
                              </span>
                              @if (tube.hasDraft && !tube.allDone) {
                                <span class="px-1.5 py-0.5 text-[10px] font-semibold rounded"
                                      style="background: rgba(245, 158, 11, 0.16); color: var(--amber-text);">Draft</span>
                              }
                              @if (tab() === 'service_queue' && tube.assignedTo) {
                                <span class="px-1.5 py-0.5 text-[10px] font-medium rounded truncate" style="max-width: 110px;
                                      background: rgba(139, 92, 246, 0.16); color: var(--violet-text);">{{ assigneeName(tube.assignedTo) }}</span>
                              }
                              <!-- Sample ID (tube barcode) — always rendered so the tech can
                                   match the physical tube; 'no label' for unprinted samples. -->
                              <span class="text-[10.5px] font-mono" style="color: var(--text-muted);">{{ tube.barcode || 'no label' }}</span>
                            </div>

                            <!-- Rejection reason banner — only when one or
                                 more tests in this tube were sent back by
                                 the pathologist. Surfaces the WHY so the
                                 tech doesn't have to dig into each test
                                 individually. -->
                            @if (tube.rejections.length > 0) {
                              <div class="pf-tube-reject mb-2">
                                <div class="pf-tube-reject__head">
                                  <span class="pf-tube-reject__icon" aria-hidden="true">↻</span>
                                  <span class="pf-tube-reject__title">
                                    Sent back for re-entry
                                    @if (tube.rejections.length > 1) { · {{ tube.rejections.length }} tests }
                                  </span>
                                </div>
                                <ul class="pf-tube-reject__list">
                                  @for (r of tube.rejections; track r.testName) {
                                    <li class="pf-tube-reject__item">
                                      <span class="pf-tube-reject__test">{{ r.testName }}</span>
                                      <span class="pf-tube-reject__reason">{{ r.reason }}</span>
                                    </li>
                                  }
                                </ul>
                              </div>
                            }

                            <ul class="space-y-0.5 mb-2 pl-1">
                              @for (t of tube.tests; track t.id) {
                                <li class="flex items-center gap-2 text-[12.5px]">
                                  <span class="flex-1 truncate" style="color: var(--text-primary);">→ {{ t.test?.name ?? 'Test' }}</span>
                                  @if (t.status === 'validated') {
                                    <span class="px-1.5 py-0.5 text-[10px] font-medium rounded"
                                          style="background: rgba(16, 185, 129, 0.15); color: var(--green-text);">✓</span>
                                  } @else if (t.status === 'entered') {
                                    <span class="px-1.5 py-0.5 text-[10px] font-medium rounded"
                                          style="background: rgba(168, 85, 247, 0.15); color: var(--violet-text);">⏳</span>
                                  } @else if (t.status === 're_entry') {
                                    <span class="px-1.5 py-0.5 text-[10px] font-medium rounded"
                                          style="background: rgba(239, 68, 68, 0.15); color: var(--red-text);">↻</span>
                                  }
                                </li>
                              }
                            </ul>
                            <!-- The CARD itself is the primary action (opens the
                                 tube, or claims it from the queue), so only the
                                 secondary Delegate button remains here. -->
                            <div class="flex justify-end gap-2">
                              @switch (tab()) {
                                @case ('service_queue') {
                                  <!-- Routing pool/others' work is supervisor-grade
                                       (backend enforces reassign_result) — don't
                                       show a button that would 403. -->
                                  @if (canReassign()) {
                                    <button type="button" class="pf-delegate-btn press" (click)="openDelegate(tube.tests); $event.stopPropagation()">Delegate</button>
                                  }
                                }
                                @default {
                                  @if (!tube.allDone) {
                                    <button type="button" class="pf-delegate-btn press" (click)="openDelegate(tube.tests); $event.stopPropagation()">Delegate</button>
                                  }
                                  @if (tube.allDone) {
                                    <span class="px-2 py-0.5 text-[11px] font-medium rounded"
                                          style="background: rgba(16, 185, 129, 0.15); color: var(--green-text);">✓ All entered</span>
                                  }
                                }
                              }
                            </div>
                          </li>
                        }
                      </ul>
                    }
                  </pf-tile>
                </li>
              }
            </ul>
            } @else {
            <!-- Sample-focused: one row PER TUBE across ALL patients, keyed by
                 Sample ID. The tube (sample) is the bold headline; the patient
                 is demoted to a small secondary line. Same tests + same actions
                 and CSS as the patient-first tube tile. -->
            <ul class="grid grid-cols-1 lg:grid-cols-2 gap-3">
              @for (tube of sampleRows(bucket.items); track tube.sampleId) {
                <li>
                  <!-- Designed for touch FIRST, so the mouse gets the same
                       layout rather than a second one: nothing is hidden behind
                       hover. The row is the primary target (open / pick); the
                       one secondary action lives in its own trailing zone,
                       separated by a hairline, always visible, with a 44px hit
                       area. Hover and press only add FEEDBACK — never reveal
                       content — so the card is identical on a bench tablet and
                       a desktop. -->
                  <div class="pf-tq"
                       [class.pf-tq--urgent]="bucket.level === 'urgent'"
                       [class.pf-tq--high]="bucket.level === 'high'"
                       [class.pf-tq--rejected]="tube.rejections.length > 0"
                       [class.pf-tq--picking]="pickingTubeId() === tube.sampleId"
                       [class.pf-tq--holding]="holdingPeekId() === tube.sampleId"
                       [class.pf-tq--done]="tube.allDone">
                    <span class="pf-tq__cap" aria-hidden="true"></span>

                    <!-- Primary zone: the whole block opens / picks the tube. -->
                    <div class="pf-tq__main"
                         role="button" tabindex="0"
                         [attr.aria-label]="(tab() === 'service_queue' ? 'Pick tube ' : 'Open tube ') + (tube.barcode || tube.sampleId)"
                         (pointerdown)="onCardDown(tube, $event)" (pointerup)="onCardUp()"
                         (pointercancel)="onCardUp()" (pointerleave)="onCardUp()"
                         (pointermove)="onCardMove($event)"
                         (click)="onCardActivate(tube, tube.patientName, $event)"
                         (keydown.enter)="onCardActivate(tube, tube.patientName)"
                         (keydown.space)="onCardActivate(tube, tube.patientName)">
                      <div class="pf-tq__line">
                        <span class="pf-tq__id">{{ tube.barcode || tube.sampleId }}</span>
                        @if (tube.hasDraft && !tube.allDone) {
                          <span class="pf-tq__tag pf-tq__tag--draft">Draft</span>
                        }
                        @if (tube.rejections.length > 0) {
                          <span class="pf-tq__tag pf-tq__tag--warn">Re-entry</span>
                        }
                        @if (tab() === 'service_queue' && tube.assignedTo) {
                          <span class="pf-tq__tag">{{ assigneeName(tube.assignedTo) }}</span>
                        }
                      </div>
                      <p class="pf-tq__sub">
                        <span class="pf-tq__who">{{ tube.patientName }}</span>
                        @if (tube.patientMeta) {
                          <span class="pf-tq__sep">·</span>{{ tube.patientMeta }}
                        }
                        <span class="pf-tq__sep">·</span>{{ tube.deptName || 'Tube' }}
                      </p>
                      @if (tube.rejections.length > 0) {
                        <p class="pf-tq__note">
                          @for (r of tube.rejections; track r.testName) {
                            <span class="pf-tq__note-test">{{ r.testName }}</span>{{ r.reason }}
                          }
                        </p>
                      }
                    </div>

                    <!-- Trailing zone: count is a read-only stat; Delegate is a
                         real button with its own hit area, permanently visible. -->
                    <div class="pf-tq__side">
                      @if (tube.allDone) {
                        <span class="pf-tq__stat pf-tq__stat--done">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>
                          <span class="pf-tq__stat-u">done</span>
                        </span>
                      } @else {
                        <span class="pf-tq__stat">
                          {{ testCount(tube.tests) }}
                          <span class="pf-tq__stat-u">{{ testCount(tube.tests) === 1 ? 'test' : 'tests' }}</span>
                        </span>
                      }
                      @if (tab() === 'service_queue' ? canReassign() : !tube.allDone) {
                        <button type="button" class="pf-tq__act"
                                [attr.aria-label]="'Delegate ' + (tube.barcode || tube.sampleId)"
                                (click)="openDelegate(tube.tests); $event.stopPropagation()">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M18 8h4m-2-2v4"/>
                          </svg>
                          <span class="pf-tq__act-t">Delegate</span>
                        </button>
                      }
                    </div>
                  </div>
                </li>
              }
            </ul>
            }

            <!-- Hold-to-peek popover for queue cards — floats beside the held
                 card; hidden on release. Fixed-position so it escapes any
                 overflow:hidden ancestors. -->
            @if (cardPeekId()) {
              <div class="pf-cardpeek" (click)="$event.stopPropagation()"
                   [style.left.px]="cardPeekPos()?.x" [style.top.px]="cardPeekPos()?.y">
                <p class="pf-cardpeek__h">Tests ({{ cardPeekTests().length }})</p>
                <ul>
                  @for (n of cardPeekTests(); track n) { <li>{{ n }}</li> }
                </ul>
              </div>
            }
            <!-- Legacy flat per-test grid (kept hidden behind a flag for rollback). -->
            <ul class="hidden grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
              @for (t of bucket.items; track t.id) {
                <li>
                  <pf-tile [tone]="toneFor(bucket.level)" padding="md">
                    <div class="flex items-start gap-3">
                      <pf-avatar [name]="t.subOrder?.order?.patient?.displayName ?? 'Patient'" [size]="40"></pf-avatar>
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                          <p class="text-[15px] font-semibold truncate"
                             style="color: var(--text-primary);">{{ t.test?.name ?? 'Test' }}</p>
                          <pf-tat-indicator [tatLevel]="t._level" [remainingMinutes]="t._remainingMin"/>
                        </div>
                        <p class="text-[12px] font-mono mt-0.5"
                           style="color: var(--text-tertiary);">
                          {{ t.subOrder?.order?.patient?.displayName ?? '—' }}
                          · {{ t.test?.department?.name ?? '—' }}
                          · rec'd {{ t.subOrder?.receivedAtLab ? (t.subOrder?.receivedAtLab | date:'shortTime') : '—' }}
                        </p>
                      </div>
                    </div>
                    <div class="mt-4 flex justify-end">
                      @switch (tab()) {
                        @case ('service_queue') {
                          <!-- Pool rows: click opens the scanner. Modal won't
                               accept the scan unless the decoded code matches
                               this row's barcode. Backend also re-verifies the
                               user is the assignee — so wrong-row clicks
                               still get rejected. -->
                          <button type="button" class="pf-scan-hint pf-scan-hint--btn press"
                                  (click)="startPick(t)">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                              <rect x="3" y="5" width="18" height="14" rx="2"/>
                              <path d="M7 9v6M11 9v6M15 9v6"/>
                            </svg>
                            Scan vial to pick
                          </button>
                          @if (canReassign()) {
                            <button type="button" class="pf-delegate-btn press" (click)="openDelegate(t)">
                              Delegate…
                            </button>
                          }
                        }
                        @case ('rejected') {
                          <pf-touch-btn variant="primary" size="sm" (pressed)="startPick(t)">Re-enter</pf-touch-btn>
                        }
                        @default {
                          @if (t.status === 'pending' && !scanVerified(t)) {
                            <pf-touch-btn variant="secondary" size="sm" (pressed)="startPick(t)">Pick up · scan</pf-touch-btn>
                          } @else {
                            <pf-touch-btn variant="primary" size="sm" (pressed)="startPick(t)">Enter result</pf-touch-btn>
                          }
                        }
                      }
                    </div>
                  </pf-tile>
                </li>
              }
            </ul>
          </div>
        }
      }

      @if (!loading() && rows().length === 0) {
        <pf-tile tone="default" padding="xl">
          <p class="text-center text-sm" style="color: var(--text-tertiary);">Nothing in the queue.</p>
        </pf-tile>
      }
      }
          </div>
        </section>

        <!-- CULTURE BENCH: micro-tech third pane — the multi-stage culture
             bench, persistent beside the queue (not a tab). Additive; only
             rendered when the Lab microbiology feature is on AND the user holds
             culture_workbench. On phones it's the "Culture Bench" mobile tab. -->
        @if (showCulture()) {
        <!-- Its own resize handle (desktop only; hidden on phones). -->
        <div class="pf-mw-handle" role="separator" aria-orientation="vertical"
             aria-label="Resize Culture Bench"
             (pointerdown)="onCulturePointerDown($event)"
             (pointermove)="onCulturePointerMove($event)"
             (pointerup)="onCulturePointerUp($event)"
             (pointercancel)="onCulturePointerUp($event)"
             (lostpointercapture)="onCulturePointerUp($event)">
          <span class="pf-mw-handle__grip" aria-hidden="true"></span>
        </div>
        <section class="pf-mw-pane pf-mw-culture"
                 [style.--culture-w.px]="cultureWidth()"
                 [class.pf-mobile-hide]="mobileTab() !== 'culture'">
          <header class="pf-mw-pane__hdr pf-mw-pane__hdr--intake">
            <span class="pf-mw-pane__title">Culture Bench</span>
            <span class="pf-mw-culture__count">{{ cultureCount() }}</span>
          </header>
          <div class="pf-mw-pane__body">
            <pf-culture-panel (countChange)="cultureCount.set($event)"></pf-culture-panel>
          </div>
        </section>
        }
      </div>
    </section>

    @if (scanTarget(); as t) {
      <pf-barcode-scanner-modal
        [manualOnly]="scanSvc.manualEntry()"
        title="Scan vial to claim"
        [expectedBarcode]="scanExpected()"
        (matched)="onScanMatched($event)"
        (cancelled)="cancelScan()">
      </pf-barcode-scanner-modal>
    }

    @if (barScannerOpen()) {
      <!-- Search-bar camera mode: no expected code, any scan drops into
           the input and routes through the same claim-by-scan gate. -->
      <pf-barcode-scanner-modal
        [manualOnly]="scanSvc.manualEntry()"
        title="Scan any vial barcode"
        (matched)="onBarSearchMatched($event)"
        (cancelled)="closeBarSearchScanner()">
      </pf-barcode-scanner-modal>
    }

    @if (delegateTarget(); as t) {
      <pf-delegate-modal
        [testName]="delegateLabel()"
        (chose)="onDelegate($event)"
        (cancelled)="cancelDelegate()">
      </pf-delegate-modal>
    }

    <!-- (The intermediate "Scan tube to claim" card was removed — "Pick" claims
         directly, or opens the scanner below when a scan is required.) -->

    <!-- Scan gate for claiming: the modal only emits matched when the scanned
         code equals THIS tube's barcode, so a tech can't claim the wrong tube. -->
    @if (claimScanning() && claimTarget(); as c) {
      <pf-barcode-scanner-modal
        [manualOnly]="scanSvc.manualEntry()"
        title="Scan vial to claim"
        [expectedBarcode]="c.barcode"
        (matched)="onClaimScanned()"
        (cancelled)="cancelClaimScan()">
      </pf-barcode-scanner-modal>
    }

  `,
  styles: [`

    /* No page-level scroll — :host fills the routed area, the inner
     * <section> chains flex so the splitter takes the remaining height
     * and each pane scrolls its own body. Mirrors Frontdesk landing. */
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }
    :host > section {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
    :host > section > pf-kpi-strip,
    :host > section > pf-screen-header,
    :host > section > .pf-scan-row,
    :host > section > .pf-counter-row,
    :host > section > .grid {
      flex-shrink: 0;
    }

    /* ── 2-col split: Lab Intake | Workbench tabs ─────────────
     * Same pattern as the FD landing splitter — single drag handle,
     * card-style panes, pointer events for reliable resize. */
    .pf-mw-split {
      display: flex;
      flex-direction: column;
      gap: 12px;
      flex: 1;
      min-height: 0;
    }
    .pf-mw-pane {
      display: flex;
      flex-direction: column;
      min-width: 0;
      border: 1px solid var(--glass-border);
      border-radius: 14px;
      background: var(--glass-bg);
      overflow: hidden;
    }
    /* Lab Intake disabled → the work pane is the only pane; fill the whole row
       (overrides the desktop :first-of-type 33% width). */
    .pf-mw-pane--solo { flex: 1 1 100% !important; max-width: 100% !important; }
    .pf-mw-pane__hdr {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--glass-border);
      flex-shrink: 0;
    }
    .pf-mw-pane__hdr--tabs {
      padding: 6px 12px;
      gap: 12px;
      flex-wrap: wrap;
    }
    .pf-mw-pane__title {
      font-size: 11.5px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-secondary);
    }
    /* Culture pane header count chip. */
    .pf-mw-culture__count {
      margin-left: auto; font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 999px;
      color: var(--violet-text, #7c3aed); background: rgba(124, 58, 237, 0.14);
    }
    /* Lab Intake header — has the title on the left and an inline scan
     * bar on the right (icon + manual-typing input + camera shortcut +
     * Receive button). All three input methods feed the same intake
     * pipeline. The header gets a bit more padding because the bar is
     * 36px tall. */
    .pf-mw-pane__hdr--intake {
      gap: 12px;
      padding: 10px 12px;
      flex-wrap: wrap;
    }
    .pf-mw-scan {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex: 1 1 220px;
      min-width: 0;
      max-width: 460px;
      height: 36px;
      padding: 2px 4px 2px 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 9999px;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    .pf-mw-scan:focus-within {
      border-color: rgba(168, 85, 247, 0.56);
      background: var(--glass-bg-hover);
    }
    .pf-mw-scan__icon { color: var(--text-muted); flex-shrink: 0; }
    .pf-mw-scan__input {
      flex: 1;
      min-width: 0;
      border: 0;
      outline: 0;
      background: transparent;
      font-size: 12.5px;
      font-weight: 500;
      color: var(--text-primary);
      letter-spacing: 0.02em;
    }
    .pf-mw-scan__input::placeholder { color: var(--text-muted); }
    .pf-mw-scan__cam {
      width: 28px; height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: 0;
      border-radius: 9999px;
      color: var(--text-muted);
      cursor: pointer;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .pf-mw-scan__cam:hover {
      background: rgba(168, 85, 247, 0.16);
      color: var(--violet-text);
    }
    .pf-mw-scan__btn {
      padding: 6px 14px;
      border: 0;
      border-radius: 9999px;
      background: linear-gradient(135deg, #8b5cf6, #ec4899);
      color: #fff;
      font-size: 11.5px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      cursor: pointer;
      transition: filter 0.15s ease, transform 0.06s ease;
    }
    .pf-mw-scan__btn:hover { filter: brightness(1.12); }
    .pf-mw-scan__btn:active { transform: scale(0.98); }
    .pf-mw-scan__btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      filter: none;
    }
    .pf-mw-pane__meta {
      margin-left: auto;
      margin: 0 0 0 auto;
      font-size: 11px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .pf-mw-pane__body {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding: 14px 16px 16px;
    }

    /* Tab cluster (right pane header) */
    .pf-mw-tabs {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 3px;
      border-radius: 9999px;
      background: var(--seg-track);
      border: 1px solid var(--glass-border);
    }
    .pf-mw-tab {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border: 0;
      background: transparent;
      border-radius: 9999px;
      font-size: 11.5px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-secondary);
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
      white-space: nowrap;
    }
    .pf-mw-tab:hover { color: var(--text-primary); }
    .pf-mw-tab--on {
      background: linear-gradient(135deg, #8b5cf6, #ec4899);
      color: #fff;
      box-shadow: 0 4px 12px rgba(124, 58, 237, 0.32);
    }
    .pf-mw-tab__count {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10.5px;
      font-weight: 700;
      padding: 1px 7px;
      border-radius: 9999px;
      background: rgba(168, 85, 247, 0.18);
      border: 1px solid rgba(168, 85, 247, 0.32);
      color: var(--text-primary);
    }
    .pf-mw-tab--on .pf-mw-tab__count {
      background: rgba(255, 255, 255, 0.22);
      border-color: transparent;
      color: #fff;
    }

    /* Drag handle — hidden in the mobile/tablet stacked layout below
     * 1024px. At desktop the panes lay out side-by-side as a row. */
    .pf-mw-handle { display: none; }

    @media (min-width: 1024px) {
      .pf-mw-split {
        flex-direction: row;
        flex-wrap: nowrap;
        gap: 0;
        flex: 1;
        min-height: 0;
      }
      .pf-mw-pane:first-of-type {
        flex: 0 0 33%;
        min-width: 0;
      }
      .pf-mw-pane:not(:first-of-type) {
        flex: 1 1 0;
        min-width: 0;
      }
      /* Culture Bench is the third column — user-resizable via its own drag
         handle (width persisted in the --culture-w CSS var, desktop only). */
      .pf-mw-pane.pf-mw-culture {
        flex: 0 0 var(--culture-w, 340px);
      }
      .pf-mw-handle {
        flex: 0 0 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: col-resize;
        touch-action: none;
        z-index: 2;
      }
      .pf-mw-handle__grip {
        width: 5px;
        height: 44px;
        border-radius: 9999px;
        background: var(--glass-border);
        opacity: 0.55;
        transition: opacity 0.15s ease, background 0.15s ease, height 0.15s ease;
      }
      .pf-mw-handle:hover .pf-mw-handle__grip,
      .pf-mw-split--dragging .pf-mw-handle__grip {
        opacity: 1;
        height: 56px;
        background: linear-gradient(180deg, #a855f7, #ec4899);
        box-shadow: 0 0 0 4px rgba(168, 85, 247, 0.18);
      }
      .pf-mw-split--dragging {
        cursor: col-resize;
        user-select: none;
      }
    }

    /* Delegate link on pool rows — supervisor action. */
    .pf-delegate-btn {
      margin-left: 8px;
      padding: 5px 10px;
      border-radius: 9999px;
      background: transparent;
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      font-size: 11.5px;
      font-weight: 500;
      cursor: pointer;
    }
    .pf-delegate-btn:hover {
      background: var(--glass-bg-hover);
      color: var(--text-primary);
    }

    /* Scan-to-pick chip on pool rows. Opens the scanner modal; modal
     * still requires the decoded code to equal the row's barcode, so a
     * click here can't claim a wrong vial. */
    .pf-scan-hint {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      border-radius: 9999px;
      background: rgba(236, 72, 153, 0.08);
      border: 1px dashed rgba(236, 72, 153, 0.35);
      color: var(--pink-text);
      font-size: 11.5px;
      font-weight: 500;
    }
    .pf-scan-hint--btn {
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease, transform 0.08s ease;
    }
    .pf-scan-hint--btn:hover {
      background: rgba(236, 72, 153, 0.16);
      border-color: rgba(236, 72, 153, 0.55);
    }
    .pf-scan-hint--btn:active { transform: scale(0.98); }

    /* Manual-entry trigger now lives inline on the scan bar
     * (.pf-scan__manual); the old floating link + .manual-toggle wrapper
     * are no longer used. */

    .seg-row {
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
      padding: 14px 16px; background: var(--glass-bg); border: 1px solid var(--glass-border);
      border-radius: 18px; font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 18px; font-weight: 600; letter-spacing: 0.02em;
    }
    .seg { color: var(--text-primary); }
    .seg-sep { color: var(--text-muted); }
    .seg--locked { opacity: 0.7; }
    .seg--dept { min-width: 0; text-align: center; }
    .seg--input {
      /* min-width:0 + flex-1 lets the input shrink below 110px on iPhone
         SE (375px) and iPhone 14 (390px) so the barcode segments don't
         overflow the row. The 180px cap still applies on tablets+. */
      flex: 1 1 auto; min-width: 0; max-width: 180px;
      background: rgba(45, 212, 191, 0.10); border: 1px solid rgba(45, 212, 191, 0.45);
      border-radius: 10px; padding: 6px 10px; outline: none;
      font: inherit; color: var(--text-primary); text-align: center;
      letter-spacing: 0.18em;
    }
    @media (min-width: 480px) {
      .seg--dept { min-width: 48px; }
      .seg--input { flex: 1 0 110px; min-width: 110px; }
    }
    .seg--input:focus {
      border-color: rgba(45, 212, 191, 0.85);
      box-shadow: 0 0 0 4px rgba(45, 212, 191, 0.15);
    }
    .seg--input::placeholder { color: var(--text-muted); letter-spacing: 0.18em; }

    .manual-meta {
      display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 16px;
    }
    @media (max-width: 640px) { .manual-meta { grid-template-columns: 1fr; } }
    .preview-code {
      padding: 9px 12px; background: var(--glass-bg); border: 1px solid var(--glass-border);
      border-radius: 12px; font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 13.5px; color: var(--text-secondary); letter-spacing: 0.02em;
      overflow-x: auto; white-space: nowrap;
    }
    .numpad-wrap { margin-top: 16px; max-width: 320px; }
    .manual-actions {
      display: flex; justify-content: flex-end; align-items: center; gap: 12px; margin-top: 16px;
    }
    .seq-hint {
      font-size: 12px; color: var(--text-muted);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }

    /* Scan bar — slimmer, single-row pill. The barcode icon doubles as
     * the visual cue (no more "SCANNER · READY" badge). Manual-entry
     * is now an inline text button on the right of the input. */
    .pf-scan-row {
      display: flex;
      align-items: stretch;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    .pf-scan {
      position: relative;
      flex: 1;
      min-width: 260px;
      display: flex;
      align-items: center;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 14px;
      padding: 0 6px 0 14px;
      transition: background 0.15s, border-color 0.15s, box-shadow 0.2s;
    }
    .pf-scan:focus-within {
      background: var(--glass-bg-hover);
      border-color: rgba(168, 85, 247, 0.55);
      box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.18);
    }
    .pf-scan__icon {
      color: var(--violet-text);
      flex: 0 0 auto;
      margin-right: 10px;
    }
    .pf-scan__input {
      flex: 1;
      min-width: 0;
      height: 44px;
      background: transparent;
      border: none;
      color: var(--text-primary);
      font-size: 14px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      outline: none;
      padding: 0;
    }
    .pf-scan__input::placeholder { color: var(--text-muted); }

    /* Inline manual-entry text button — replaces the floating link below. */
    .pf-scan__manual {
      flex: 0 0 auto;
      height: 32px;
      padding: 0 12px;
      border: 1px solid transparent;
      border-radius: 9px;
      background: transparent;
      color: var(--text-tertiary);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
      white-space: nowrap;
    }
    .pf-scan__manual:hover {
      background: var(--glass-bg-hover);
      color: var(--violet-text);
      border-color: var(--glass-border);
    }
    .pf-scan__manual[aria-expanded='true'] {
      color: var(--violet-text);
      background: rgba(168, 85, 247, 0.12);
      border-color: rgba(168, 85, 247, 0.32);
    }

    .pf-scan__camera {
      flex: 0 0 auto;
      width: 32px; height: 32px;
      margin-left: 6px;
      border-radius: 9px;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-secondary);
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s, transform 80ms ease;
    }
    .pf-scan__camera:hover {
      background: var(--glass-bg-hover);
      color: var(--violet-text);
      border-color: var(--glass-border);
    }
    .pf-scan__camera:active { transform: scale(0.95); }

    @media (max-width: 640px) {
      .pf-scan__manual { display: none; }
    }

    /* Segmented filter bar — full width, one container with equal-width
     * clickable cells separated by hairline dividers. Active cell
     * inverts to white. Matches the report-queue / kpi-strip language. */
    .pf-counter-row {
      display: flex;
      align-items: stretch;
      width: 100%;
      margin-bottom: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 10px;
      overflow: hidden;
    }
    .pf-counter {
      display: inline-flex; align-items: center; justify-content: center;
      gap: 8px;
      padding: 8px 14px;
      background: transparent;
      border: none;
      border-right: 1px solid var(--glass-border);
      color: var(--text-primary);
      cursor: pointer;
      transition: background 0.15s ease;
      line-height: 1.2;
      flex: 1 1 0;
      min-width: 0;
    }
    .pf-counter:last-child { border-right: none; }
    .pf-counter:hover:not(.pf-counter--on) { background: var(--glass-bg-hover); }
    @media (max-width: 720px) {
      /* Phones / iPad portrait: drop the bar chrome, items wrap as pills. */
      .pf-counter-row {
        background: transparent; border: none; border-radius: 0;
        flex-wrap: wrap; gap: 4px 8px;
      }
      .pf-counter {
        border: 1px solid var(--glass-border);
        border-radius: 999px;
        padding: 5px 12px; flex: 0 1 auto;
        background: var(--glass-bg);
      }
    }
    .pf-counter:hover { background: var(--glass-bg-hover); }
    .pf-counter:active { transform: scale(0.97); }

    .pf-counter__dot {
      width: 6px; height: 6px; border-radius: 999px;
      background: var(--ct-dot);
      box-shadow: 0 0 6px var(--ct-glow);
      flex: 0 0 6px;
    }
    .pf-counter__label {
      font-size: 11px; font-weight: 500;
      color: var(--text-tertiary);
      letter-spacing: 0.01em;
    }
    .pf-counter__value {
      font-size: 12.5px; font-weight: 600;
      color: var(--text-primary);
      font-variant-numeric: tabular-nums;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: -0.01em;
    }

    /* Per-tone dot color (mirrors the old per-tile palette). */
    .pf-counter[data-tone='amber']   { --ct-dot: #fbbf24; --ct-glow: rgba(245, 158, 11, 0.45); }
    .pf-counter[data-tone='rose']    { --ct-dot: #fb7185; --ct-glow: rgba(244, 63, 94, 0.45); }
    .pf-counter[data-tone='violet']  { --ct-dot: #a78bfa; --ct-glow: rgba(168, 85, 247, 0.45); }
    .pf-counter[data-tone='emerald'] { --ct-dot: #34d399; --ct-glow: rgba(16, 185, 129, 0.45); }
    .pf-counter[data-tone='default'] { --ct-dot: #94a3b8; --ct-glow: rgba(148, 163, 184, 0.40); }

    /* Active filter — subtle tone-tinted wash with brighter text and a
     * thin inner border. Sits on the dark gradient without the harsh
     * white inversion. Tone color comes from the per-data-tone vars. */
    .pf-counter--on {
      background: color-mix(in srgb, var(--ct-dot) 14%, transparent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ct-dot) 55%, transparent);
    }
    .pf-counter--on .pf-counter__dot {
      box-shadow: 0 0 10px var(--ct-glow);
      transform: scale(1.15);
    }
    .pf-counter--on .pf-counter__label {
      color: var(--text-primary);
      font-weight: 600;
    }
    .pf-counter--on .pf-counter__value {
      color: var(--ct-dot);
    }

    /* Urgency dot (kept from prior) */
    .pf-grp-count {
      font-size: 10.5px; font-weight: 700;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.04em;
      padding: 3px 9px; border-radius: 999px;
      background: rgba(168, 85, 247, 0.14);
      color: var(--violet-text);
      border: 1px solid rgba(168, 85, 247, 0.28);
      flex-shrink: 0;
    }
    .hidden { display: none; }
    .pf-dot {
      width: 10px;
      height: 10px;
      border-radius: 9999px;
      flex-shrink: 0;
    }
    .pf-dot[data-level='urgent'] { background: #ef4444; box-shadow: 0 0 12px rgba(239, 68, 68, 0.7); }
    .pf-dot[data-level='high']   { background: #f59e0b; box-shadow: 0 0 10px rgba(245, 158, 11, 0.65); }
    .pf-dot[data-level='normal'] { background: #10b981; box-shadow: 0 0 8px rgba(16, 185, 129, 0.55); }

    /* Tube tile gets a soft red wash when any of its tests are in
       re_entry — pulls the eye to it without screaming. */
    .pf-tube-tile--rejected {
      border-color: rgba(239, 68, 68, 0.34) !important;
      background: linear-gradient(180deg, rgba(239, 68, 68, 0.06), rgba(255, 255, 255, 0.02)) !important;
    }

    /* Hover/active feedback on tube tiles — without it, clicking the
     * action button gives no in-tile signal that the tube was picked.
     * Adds a violet glow on hover and a quick "fill" animation on click
     * so the tech sees a clear pick before the route swap. */
    .pf-tube-tile {
      position: relative;
      transition: transform 0.14s ease, border-color 0.18s ease, box-shadow 0.22s ease;
      overflow: hidden;
    }
    .pf-tube-tile:hover {
      border-color: rgba(168, 85, 247, 0.45) !important;
      box-shadow: 0 6px 18px rgba(124, 58, 237, 0.18);
    }
    /* Hold-to-peek progress: a violet bar fills across the card's bottom over
       the 2s hold (same gesture as the collection vials); when it completes,
       the test list pops beside the card. No textual hint by design. */
    .pf-tube-tile { user-select: none; -webkit-touch-callout: none; }
    /* The whole card is the button now, so say so on hover/focus. */
    .pf-tube-tile--tappable { cursor: pointer; }
    .pf-tube-tile--tappable:focus-visible {
      outline: 2px solid rgba(139, 92, 246, 0.7);
      outline-offset: 2px;
    }
    .pf-tube-tile::after {
      content: ''; position: absolute; left: 0; bottom: 0; height: 3px; width: 0;
      background: var(--color-violet-500, #8b5cf6); border-radius: 3px;
      opacity: 0; pointer-events: none;
    }
    .pf-tube-tile--holding {
      border-color: rgba(139, 92, 246, 0.55) !important;
    }
    .pf-tube-tile--holding::after { opacity: 1; animation: pf-card-hold-fill 2s linear forwards; }
    @keyframes pf-card-hold-fill { from { width: 0; } to { width: 100%; } }

    /* ── Queue row (sample-focused My Work / Queue) ────────────────────
       ONE layout for touch and mouse. Nothing is hover-revealed: a hidden
       affordance is unreachable on a bench tablet, and a coarse-pointer
       fallback would mean maintaining two designs. Instead the row splits
       into a primary zone (tap = open/pick) and a trailing action zone with
       its own 44px target; hover and press add feedback only.

       Depth comes from a hairline + 1px inset highlight rather than a heavy
       panel, and priority is a 3px cap stripe down the left edge — a nod to
       the tube's own cap — so colour never floods the surface. */
    .pf-tq {
      --tq-accent: rgba(148, 163, 184, 0.5);
      position: relative;
      display: flex;
      align-items: stretch;
      width: 100%;
      border-radius: 14px;
      background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.022));
      border: 1px solid rgba(255,255,255,0.075);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
      overflow: hidden;
      transition: border-color .18s ease, box-shadow .22s ease;
    }
    .pf-tq:hover { border-color: rgba(255,255,255,0.14); box-shadow: inset 0 1px 0 rgba(255,255,255,0.09), 0 6px 20px rgba(0,0,0,0.26); }
    .pf-tq--done { opacity: 0.6; }
    .pf-tq--rejected { border-color: rgba(242, 85, 90, 0.34); }

    /* Cap stripe = priority. */
    .pf-tq__cap { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--tq-accent); }
    .pf-tq--urgent { --tq-accent: #f2555a; }
    .pf-tq--high   { --tq-accent: #f0a03c; }
    .pf-tq--done   { --tq-accent: #34d399; }

    /* Primary zone — the tap target for open / pick. */
    .pf-tq__main {
      flex: 1 1 auto; min-width: 0;
      padding: 13px 12px 13px 16px;
      cursor: pointer;
      user-select: none;
      -webkit-touch-callout: none;
      -webkit-tap-highlight-color: transparent;
      transition: background .16s ease;
    }
    .pf-tq__main:hover  { background: rgba(255,255,255,0.028); }
    .pf-tq__main:active { background: rgba(255,255,255,0.055); }
    .pf-tq__main:focus-visible { outline: 2px solid rgba(139,92,246,0.75); outline-offset: -2px; border-radius: 12px; }

    .pf-tq__line { display: flex; align-items: center; gap: 9px; min-width: 0; }
    .pf-tq__id {
      flex: 0 1 auto; min-width: 0;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 14px; font-weight: 600; letter-spacing: -0.01em;
      color: var(--text-primary);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    /* Status is micro-type, not chips — colour carries the meaning. */
    .pf-tq__tag {
      flex: 0 0 auto;
      font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
      color: var(--text-muted);
      max-width: 104px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .pf-tq__tag--draft { color: #f0a03c; }
    .pf-tq__tag--warn  { color: #f2555a; }

    .pf-tq__sub {
      margin: 5px 0 0;
      font-size: 12.5px; line-height: 1.4;
      color: var(--text-muted);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .pf-tq__who { color: var(--text-secondary); font-weight: 500; }
    .pf-tq__sep { margin: 0 6px; opacity: 0.45; }

    .pf-tq__note { margin: 7px 0 0; font-size: 11.5px; line-height: 1.45; color: var(--text-muted); }
    /* Completed rows list every test on the tube — cap it at two lines so a
       12-analyte panel can't stretch the card. */
    .pf-done__tests {
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .pf-tq__note-test { color: #f2555a; font-weight: 600; margin-right: 6px; }

    /* Trailing zone — separated by a hairline so it reads as its own control. */
    .pf-tq__side {
      flex: 0 0 auto;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px;
      padding: 10px 12px;
      border-left: 1px solid rgba(255,255,255,0.06);
      background: rgba(0,0,0,0.12);
    }
    .pf-tq__stat {
      display: inline-flex; align-items: baseline; gap: 4px;
      font-size: 15px; font-weight: 650; line-height: 1;
      color: var(--text-secondary);
      font-variant-numeric: tabular-nums;
    }
    .pf-tq__stat-u { font-size: 10px; font-weight: 500; color: var(--text-muted); letter-spacing: 0.02em; }
    .pf-tq__stat--done { color: #34d399; align-items: center; }
    .pf-tq__stat--done .pf-tq__stat-u { color: #34d399; opacity: 0.8; }

    /* Print + Edit sit side by side (one row), not stacked. */
    .pf-tq__acts { display: flex; align-items: center; gap: 8px; }

    .pf-tq__act {
      display: inline-flex; align-items: center; justify-content: center; gap: 5px;
      min-height: 30px; padding: 5px 10px;
      border-radius: 8px;
      font-size: 11.5px; font-weight: 500;
      color: var(--text-secondary);
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.09);
      cursor: pointer;
      white-space: nowrap;
      transition: color .15s ease, background .15s ease, border-color .15s ease;
    }
    .pf-tq__act:hover  { color: var(--text-primary); background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.16); }
    .pf-tq__act:active { background: rgba(255,255,255,0.18); }
    .pf-tq__act:focus-visible { outline: 2px solid rgba(139,92,246,0.75); outline-offset: 2px; }

    /* Hold-to-peek progress — same 2s gesture as the collection vials. */
    .pf-tq__main::after {
      content: ''; position: absolute; left: 0; bottom: 0; height: 2px; width: 0;
      background: var(--tq-accent); opacity: 0; pointer-events: none;
    }
    .pf-tq--holding .pf-tq__main::after { opacity: 1; animation: pf-card-hold-fill 2s linear forwards; }
    .pf-tq--holding { border-color: rgba(255,255,255,0.2); }
    .pf-tq--picking { animation: pf-tube-pick 0.5s cubic-bezier(0.4, 0, 0.2, 1) both; }

    :host-context([data-theme="light"]) .pf-tq {
      background: #ffffff;
      border-color: rgba(15, 23, 42, 0.09);
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    :host-context([data-theme="light"]) .pf-tq:hover { border-color: rgba(15,23,42,0.16); box-shadow: 0 6px 20px rgba(15,23,42,0.09); }
    :host-context([data-theme="light"]) .pf-tq__main:hover  { background: rgba(15,23,42,0.02); }
    :host-context([data-theme="light"]) .pf-tq__main:active { background: rgba(15,23,42,0.045); }
    :host-context([data-theme="light"]) .pf-tq__side { background: rgba(15,23,42,0.025); border-left-color: rgba(15,23,42,0.07); }
    :host-context([data-theme="light"]) .pf-tq__act { background: rgba(15,23,42,0.04); border-color: rgba(15,23,42,0.10); }

    /* Touch: same layout, bigger targets — never a different design. */
    @media (pointer: coarse) {
      .pf-tq__act { min-height: 40px; padding: 8px 12px; }
      .pf-tq__side { padding: 10px; gap: 9px; }
    }
    /* Narrow: drop the Delegate label to the icon so the row never wraps. */
    @media (max-width: 460px) {
      .pf-tq__act-t { display: none; }
      .pf-tq__act { padding: 8px; min-width: 40px; }
      .pf-tq__main { padding: 12px 10px 12px 14px; }
    }

    .pf-cardpeek {
      position: fixed; z-index: 100;
      width: 260px; max-height: 52dvh; overflow-y: auto;
      padding: 12px 14px; border-radius: 12px;
      background: var(--bg-elevated, #0f172a);
      border: 1px solid var(--glass-border, rgba(148,163,184,0.28));
      box-shadow: 0 18px 44px rgba(0,0,0,0.5);
    }
    .pf-cardpeek__h {
      margin: 0 0 8px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.16em;
      text-transform: uppercase; color: var(--text-tertiary);
    }
    .pf-cardpeek ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
    .pf-cardpeek li { font-size: 12.5px; color: var(--text-secondary); line-height: 1.3; }
    :host-context([data-theme="light"]) .pf-cardpeek {
      background: #ffffff;
      border-color: rgba(15, 23, 42, 0.14);
      box-shadow: 0 18px 44px rgba(15, 23, 42, 0.2);
    }
    .pf-tube-tile.pf-tube-tile--picking {
      animation: pf-tube-pick 0.5s cubic-bezier(0.4, 0, 0.2, 1) both;
      border-color: rgba(124, 58, 237, 0.65) !important;
    }
    .pf-tube-tile.pf-tube-tile--picking::before {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(180deg,
        transparent 0%,
        rgba(124, 58, 237, 0.08) 60%,
        rgba(168, 85, 247, 0.18) 100%);
      animation: pf-tube-fill 0.5s cubic-bezier(0.4, 0, 0.2, 1) both;
      pointer-events: none;
    }
    @keyframes pf-tube-pick {
      0%   { transform: scale(1); }
      40%  { transform: scale(0.985); }
      100% { transform: scale(1); }
    }
    @keyframes pf-tube-fill {
      0%   { opacity: 0; transform: translateY(100%); }
      100% { opacity: 1; transform: translateY(0); }
    }

    .pf-tube-reject {
      padding: 8px 10px;
      border-radius: 8px;
      background: rgba(239, 68, 68, 0.10);
      border: 1px solid rgba(239, 68, 68, 0.28);
    }
    .pf-tube-reject__head {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
    }
    .pf-tube-reject__icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 9999px;
      background: rgba(239, 68, 68, 0.22);
      color: var(--red-text);
      font-size: 11px;
      font-weight: 700;
      flex-shrink: 0;
    }
    .pf-tube-reject__title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--red-text);
    }
    .pf-tube-reject__list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .pf-tube-reject__item {
      display: flex;
      gap: 8px;
      align-items: baseline;
      font-size: 12px;
      line-height: 1.35;
    }
    .pf-tube-reject__test {
      font-weight: 600;
      color: var(--text-primary);
      flex-shrink: 0;
    }
    .pf-tube-reject__test::after { content: ':'; }
    .pf-tube-reject__reason {
      color: var(--text-secondary);
      flex: 1;
      min-width: 0;
    }

    /* Phones (<640px): tube tile actions stack so Pick + Delegate
       don't squeeze each other; rejection items wrap label-on-top. */
    @media (max-width: 639px) {
      /* Patient card: drop the pl-12 indent so tube rows can use
         full mobile width. */
      .pf-tube-reject {
        padding: 8px 10px;
      }
      .pf-tube-reject__item {
        flex-direction: column;
        gap: 0;
        align-items: flex-start;
      }
      .pf-tube-reject__test::after { content: ''; }
    }

    /* ════════════════════════════════════════════════════════════
       CROSS-PLATFORM OVERRIDES — additive only. Everything below is
       scoped to :host and gated to BELOW desktop (<1024px) or to
       touch/native so the >=1280px desktop-web layout is untouched.
       ════════════════════════════════════════════════════════════ */

    /* ── Stacked layout (phone + iPad portrait, <1024px) ──────────
       In the column-direction split the LEFT pane carries an inline
       flex-basis:33% (the desktop drag value) which would otherwise
       lock the Lab Intake pane to a third of the viewport HEIGHT and
       crush the workbench. Neutralise it and let each pane size to a
       sensible share with its own scroll. The host already owns the
       page height (height:100%, overflow:hidden) so the panes scroll
       internally within dvh, not the whole page. */
    @media (max-width: 1023px) {
      .pf-mw-split { gap: 14px; }
      /* Reset the inline flex-basis (desktop drag value) so the pane
         isn't pinned to 33% of the column height. */
      .pf-mw-pane:first-of-type {
        flex: 1 1 0 !important;
        flex-basis: 0 !important;
        min-height: 220px;
      }
      .pf-mw-pane:not(:first-of-type) {
        flex: 1 1 0;
        min-height: 280px;
      }
      /* Header scan bar no longer needs its desktop max-width cap when
         it wraps under the title. */
      .pf-mw-scan { max-width: none; }
    }

    /* ── iPad portrait / small tablet (641–1023px): panes are still
       stacked (side-by-side only kicks in at >=1024px), so give Lab
       Intake a touch more vertical room than on a phone. */
    @media (min-width: 641px) and (max-width: 1023px) {
      .pf-mw-pane:first-of-type { min-height: 260px; }
    }

    /* ── No iOS focus-zoom: the two scan inputs sit below 16px which
       triggers Safari auto-zoom on focus. Bump to 16px on phones/
       tablet only — desktop keeps its tighter type. */
    @media (max-width: 1023px) {
      .pf-scan__input,
      .pf-mw-scan__input { font-size: 16px; }
    }

    /* ── Touch tap targets (coarse pointer): grow this page's own
       icon/text controls toward the 44px minimum without disturbing
       pointer-fine desktop sizing. */
    @media (pointer: coarse) {
      .pf-scan__camera,
      .pf-scan__manual { min-height: 44px; }
      .pf-scan__camera { width: 44px; height: 44px; }
      /* The intake scan pill grows to a 48px row so the camera button
         inside it can clear 44px without overflowing the pill. */
      .pf-mw-scan { height: 48px; }
      .pf-mw-scan__cam { width: 44px; height: 44px; }
      .pf-mw-scan__btn { min-height: 44px; }
      .pf-mw-tab { min-height: 44px; }
      .pf-counter { min-height: 44px; }
      .pf-delegate-btn,
      .pf-scan-hint--btn { min-height: 44px; }
      .pf-tube-tile { padding: 12px; }
    }

    /* ── Hover only where a hover-capable pointer exists. Re-declares
       the page's hover effects under (hover:none) to neutralise them
       on touch so :hover doesn't latch after a tap. Desktop
       (hover:hover) is unaffected. */
    @media (hover: none) {
      .pf-mw-scan__cam:hover { background: transparent; color: var(--text-muted); }
      .pf-mw-scan__btn:hover { filter: none; }
      .pf-mw-tab:hover { color: var(--text-secondary); }
      .pf-mw-tab--on:hover { color: #fff; }
      .pf-delegate-btn:hover { background: transparent; color: var(--text-secondary); }
      .pf-scan-hint--btn:hover {
        background: rgba(236, 72, 153, 0.08);
        border-color: rgba(236, 72, 153, 0.35);
      }
      .pf-scan__manual:hover {
        background: transparent;
        color: var(--text-tertiary);
        border-color: transparent;
      }
      .pf-scan__camera:hover {
        background: transparent;
        color: var(--text-secondary);
        border-color: transparent;
      }
      .pf-tube-tile:hover {
        border-color: var(--glass-border) !important;
        box-shadow: none;
      }
      .pf-counter:hover:not(.pf-counter--on) { background: transparent; }
    }

    /* ── Capacitor native: this page renders inside the shell which
       already absorbs the global top/bottom safe-area on body. This
       page owns no fixed/full-bleed chrome of its own, so only a
       defensive bottom inset on the workbench scroll pane keeps the
       final tube action clear of the home indicator / bottom-nav pill
       when that pane is the bottom-most scroll surface. */
    :host-context(html.cap-native) .pf-mw-pane__body {
      scroll-padding-bottom: env(safe-area-inset-bottom);
    }
    :host-context(html.cap-native) .pf-mw-pane:not(:first-of-type) .pf-mw-pane__body {
      padding-bottom: calc(16px + env(safe-area-inset-bottom));
    }

    /* ── Phone (<=640px): the two work panes carry min-heights and
       flex:1 inside a non-scrolling host (overflow:hidden). On a short
       phone the chrome above the split (KPI strip, header, counter row,
       scan row) leaves too little room, so the panes' combined
       min-heights overflow the host and the lower Workbench pane gets
       clipped — its last tube action becomes unreachable because nothing
       scrolls at page level. On phones, release the host clamp and let
       the whole page flow into the shell's scroll container (which
       already reserves --tab-nav-total-height to clear the floating
       bottom-nav pill): collapse to one natural column, size each pane to
       its content, and drop the nested pane-body scroll so there's no
       scroll trap. The 641-1023px iPad band keeps its stacked
       internal-scroll layout, and >=1024px desktop stays byte-for-byte
       unchanged. */
    @media (max-width: 640px) {
      :host { height: auto; min-height: 100%; overflow: visible; }
      :host > section { flex: 0 0 auto; min-height: 0; }
      .pf-mw-split { flex: 0 0 auto; min-height: 0; }
      .pf-mw-pane,
      .pf-mw-pane:first-of-type,
      .pf-mw-pane:not(:first-of-type) {
        flex: 0 0 auto !important;
        flex-basis: auto !important;
        min-height: 0 !important;
      }
      .pf-mw-pane__body {
        flex: 0 0 auto;
        min-height: 0;
        overflow: visible;
      }
    }

    /* ════════════════════════════════════════════════════════════
       PHONE-ONLY SINGLE-PANE TABBED VIEW (<=640px) — additive.
       New controls below default to display:none so they NEVER appear
       above 640px; the visibility helpers (.pf-mobile-hide,
       .pf-kpi-collapsed) only apply their display:none INSIDE the
       max-width:640px block, so the >=641px layout is byte-for-byte
       unchanged and keeps showing every section at once.
       ════════════════════════════════════════════════════════════ */

    /* Hidden everywhere by default; revealed only on phones. */
    .pf-mtabs { display: none; }
    .pf-kpi-statbtn-m { display: none; }
    /* Phone-only intake search magnifier — never shown >=641px, where the
       Lab Intake inline search stays inline and unchanged. */
    .pf-intake-search-toggle { display: none; }

    @media (max-width: 640px) {
      /* Phone visibility helpers — only take effect here so desktop
         ignores them entirely. */
      .pf-mobile-hide { display: none !important; }
      /* Stats live behind the header icon's popover on phone, so both the
         inline filter chips AND the KPI strip are hidden here (status is
         already covered by the popover). */
      .pf-counter-row { display: none !important; }
      pf-kpi-strip { display: none !important; }

      /* Queue / My Work cards: just name + tests badge + time. Drop the
         "#orderId · test names" meta line. */
      .pf-grp-meta { display: none !important; }

      /* The split is just a stacked container on phones; show only the
         selected pane (the other carries .pf-mobile-hide). */
      .pf-mw-split { gap: 0; }

      /* Redundant on phones — the top segmented control (.pf-mtabs) already
         drives the My Work / Queue switch, so hide the WHOLE in-pane tabs
         header (the duplicate pill + the "N ITEMS" meta). */
      .pf-mw-pane__hdr--tabs { display: none !important; }

      /* Stats icon + popover — same size/shape as the Refresh button beside it
         and the same pattern as the Report queue stats button. */
      /* This one stacking context contains the whole popover subtree (button,
         backdrop, panel), so raising it lifts all of them above the page. It
         must beat the top-strip nav (z-40) and the content cards' own glass
         stacking contexts below — 30 wasn't enough and the popover painted
         under them, so it's lifted well clear here. */
      .pf-kpi-statbtn-m { display: inline-flex; position: relative; z-index: 1000; }
      .pf-kpi-statbtn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 40px; height: 40px;
        background: var(--glass-bg);
        border: 1px solid var(--glass-border);
        border-radius: 10px;
        color: var(--text-secondary);
        cursor: pointer;
      }
      .pf-kpi-statbtn.is-open {
        border-color: rgba(168, 85, 247, 0.55);
        color: var(--violet-text);
        background: rgba(124, 58, 247, 0.16);
      }
      /* Popover is teleported to <body>; positioned via inline top/right from
         the button's rect, so it can't be clipped or stacked under anything. */
      .pf-kpi-pop__backdrop { position: fixed; inset: 0; z-index: 2000; background: transparent; }
      .pf-kpi-pop {
        position: fixed;
        z-index: 2001;
        display: flex; flex-direction: column; gap: 2px;
        /* Definite width — as a fixed el with only a right offset, min-width let
           it stretch nearly full-viewport (the flex:1 labels filled the space). */
        width: min(240px, calc(100vw - 24px));
        padding: 8px;
        background: var(--bg-card-solid, rgba(20, 22, 30, 0.96));
        border: 1px solid var(--glass-border);
        border-radius: 12px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
      }
      .pf-kpi-stat {
        display: flex; align-items: center; gap: 8px;
        padding: 8px 8px;
        border: 0; border-radius: 8px;
        background: transparent;
        color: var(--text-secondary);
        cursor: pointer;
        text-align: left;
      }
      .pf-kpi-stat.is-on { background: rgba(124, 58, 247, 0.18); color: var(--text-primary); }
      .pf-kpi-stat__dot { width: 8px; height: 8px; border-radius: 9999px; flex-shrink: 0; background: var(--text-tertiary); }
      .pf-kpi-stat[data-tone="amber"]   .pf-kpi-stat__dot { background: #f59e0b; }
      .pf-kpi-stat[data-tone="rose"]    .pf-kpi-stat__dot { background: #f43f5e; }
      .pf-kpi-stat[data-tone="violet"]  .pf-kpi-stat__dot { background: #a855f7; }
      .pf-kpi-stat[data-tone="emerald"] .pf-kpi-stat__dot { background: #10b981; }
      .pf-kpi-stat__label { flex: 1 1 auto; font-size: 12px; }
      .pf-kpi-stat__value { font-size: 13px; font-weight: 700; color: var(--text-primary); font-family: 'JetBrains Mono', ui-monospace, monospace; }

      /* Top segmented control: Intake / My Work / Queue. Matches the
         existing .pf-mw-tabs pill language (pill track + gradient on the
         active cell). Full width, 3 equal cells, 44px tap targets. */
      .pf-mtabs {
        display: flex;
        gap: 2px;
        padding: 3px;
        margin-bottom: 12px;
        border-radius: 9999px;
        background: var(--seg-track);
        border: 1px solid var(--glass-border);
      }
      .pf-mtab {
        flex: 1 1 0;
        min-width: 0;
        min-height: 44px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 6px;
        border: 0;
        background: transparent;
        border-radius: 9999px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--text-secondary);
        cursor: pointer;
        white-space: nowrap;
        transition: background 0.15s ease, color 0.15s ease;
      }
      .pf-mtab--on {
        background: linear-gradient(135deg, #8b5cf6, #ec4899);
        color: #fff;
        box-shadow: 0 4px 12px rgba(124, 58, 237, 0.32);
      }
      .pf-mtab__count {
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        font-size: 10.5px;
        font-weight: 700;
        padding: 1px 7px;
        border-radius: 9999px;
        background: rgba(168, 85, 247, 0.18);
        border: 1px solid rgba(168, 85, 247, 0.32);
        color: var(--text-primary);
      }
      .pf-mtab--on .pf-mtab__count {
        background: rgba(255, 255, 255, 0.22);
        border-color: transparent;
        color: #fff;
      }

      /* (1) Header Refresh → icon-only on phone. Visually hide the text
         label (kept in the a11y tree so the button still has an accessible
         name; aria-label="Refresh" also set on the host). */
      .pf-refresh-label {
        position: absolute;
        width: 1px; height: 1px;
        padding: 0; margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }

      /* (3) Drop the big Open button on phone — Enter in the scan input
         already triggers scanSubmit(), the same action Open fired. */
      .pf-open-btn { display: none !important; }

      /* (4) Lab Intake inline search → collapses to a magnifier icon by
         default; expands to a full-width input on demand (intakeSearchOpen).
         The RECEIVE button (.pf-mw-scan__btn) stays visible in both states. */
      .pf-intake-search-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        width: 44px; height: 44px;
        border-radius: 9999px;
        background: transparent;
        border: 1px solid var(--glass-border);
        color: var(--text-secondary);
        cursor: pointer;
      }
      /* Collapsed: strip the pill chrome down to just magnifier + Receive. */
      .pf-mw-pane__hdr--intake .pf-mw-scan:not(.pf-intake-open) {
        flex: 0 0 auto;
        width: auto;
        max-width: none;
        height: auto;
        padding: 0;
        gap: 8px;
        background: transparent;
        border: none;
      }
      .pf-mw-scan:not(.pf-intake-open) .pf-mw-scan__icon,
      .pf-mw-scan:not(.pf-intake-open) .pf-mw-scan__input,
      .pf-mw-scan:not(.pf-intake-open) .pf-mw-scan__cam {
        display: none;
      }
      /* Expanded: full-width search occupying the intake header row. The
         toggle stays visible (now an ✕) so a second tap collapses it; the
         barcode glyph is dropped to keep the row clean. */
      .pf-mw-pane__hdr--intake .pf-mw-scan.pf-intake-open {
        flex: 1 1 100%;
        width: 100%;
        max-width: none;
      }
      .pf-mw-scan.pf-intake-open .pf-mw-scan__icon { display: none; }
    }

    /* Queue supervisor toggle — include tubes other techs already claimed. */
    .pf-mw-claimed-toggle {
      margin-left: 8px; padding: 4px 10px; border-radius: 999px; cursor: pointer;
      font-size: 11.5px; font-weight: 600; white-space: nowrap;
      background: transparent; color: var(--text-tertiary);
      border: 1px solid var(--glass-border);
    }
    .pf-mw-claimed-toggle--on {
      color: var(--violet-text); border-color: rgba(139, 92, 246, 0.45);
      background: rgba(139, 92, 246, 0.12);
    }

    /* ── Claim popup: pick a tube → see its tests → claim into My Work ── */
    .pf-claim { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .pf-claim__backdrop { position: absolute; inset: 0; background: rgba(8, 10, 16, 0.62); backdrop-filter: blur(4px); }
    .pf-claim__sheet {
      position: relative; z-index: 1; width: 100%; max-width: 440px;
      max-height: min(80vh, 640px); display: flex; flex-direction: column;
      background: var(--card-bg, rgba(22, 24, 32, 0.96)); border: 1px solid var(--glass-border, rgba(255,255,255,0.12));
      border-radius: 20px; box-shadow: 0 24px 60px rgba(0,0,0,0.5); padding: 18px 18px 16px;
    }
    .pf-claim__hdr { display: flex; align-items: flex-start; gap: 12px; }
    .pf-claim__hdr-main { min-width: 0; flex: 1; }
    .pf-claim__eyebrow { font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-tertiary); margin: 0 0 2px; }
    .pf-claim__title { font-size: 18px; font-weight: 700; margin: 0; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pf-claim__close { flex: 0 0 auto; width: 34px; height: 34px; border-radius: 10px; border: 1px solid var(--glass-border); background: var(--glass-bg); color: var(--text-secondary); cursor: pointer; }
    .pf-claim__lead { font-size: 12.5px; color: var(--text-secondary); margin: 14px 0 8px; }
    .pf-claim__tests { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1 1 auto; display: flex; flex-direction: column; gap: 6px; }
    .pf-claim__test { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border-radius: 12px; background: var(--glass-bg, rgba(255,255,255,0.04)); border: 1px solid var(--glass-border, rgba(255,255,255,0.08)); }
    .pf-claim__test-name { font-size: 13.5px; font-weight: 600; color: var(--text-primary); }
    .pf-claim__test-dept { font-size: 11px; color: var(--text-tertiary); white-space: nowrap; }
    .pf-claim__actions { display: flex; gap: 10px; margin-top: 16px; }
    .pf-claim__scan { flex: 0 0 auto; padding: 0 16px; min-height: 46px; border-radius: 13px; cursor: pointer; font-size: 13.5px; font-weight: 600; background: var(--glass-bg); color: var(--text-secondary); border: 1px solid var(--glass-border); }
    .pf-claim__scan:hover:not(:disabled) { color: var(--text-primary); border-color: rgba(168,85,247,0.4); }
    .pf-claim__go { flex: 1 1 auto; min-height: 46px; border-radius: 13px; border: 0; cursor: pointer; font-size: 14.5px; font-weight: 700; color: #fff; background: var(--gradient-primary, linear-gradient(135deg, #a855f7, #d946ef)); box-shadow: 0 8px 22px rgba(168,85,247,0.4); }
    .pf-claim__go:disabled, .pf-claim__scan:disabled { opacity: 0.55; cursor: not-allowed; }
    .pf-claim__foot { font-size: 11px; color: var(--text-tertiary); margin: 10px 0 0; text-align: center; }

    /* Phone: keep the dialog centered (a bottom-anchored sheet gets trapped by
       the shell's backdrop-filter ancestor, so its "bottom" isn't the viewport
       and the action row slid under the floating nav). The container reserves
       the nav zone as bottom padding, so the centered card can never overlap
       the pill regardless of how the fixed element's containing block resolves. */
    @media (max-width: 640px) {
      .pf-claim { padding: 14px 12px calc(var(--tab-nav-total-height) + 12px); }
      .pf-claim__sheet { max-width: none; max-height: 80dvh; }
    }
  `]
})
export class MyWorkComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly liveQ = inject(LiveQueueService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly process = inject(ProcessWorkflowService);
  protected readonly labCfg = inject(BranchLabConfigService);
  protected readonly scanSvc = inject(ScanService);
  private readonly entitlements = inject(TenantEntitlementsService);

  /** The Culture tab is micro-tech only: the Lab "microbiology" feature must be
   *  on AND the user must hold culture_workbench. A regular tech never sees it. */
  readonly showCulture = computed(() =>
    this.entitlements.featureOn('lab', 'microbiology') && this.auth.hasPermission('culture_workbench'));
  /** Live count for the Culture pill (fed by the culture panel on load). */
  readonly cultureCount = signal(0);

  /** Collect-in-lab: sample collection is placed in the lab work-area, so the
   *  tube is drawn at the bench. The left pane becomes a Collect step (draw +
   *  print label) instead of Lab Intake, and collection auto-receives into the
   *  work queue (backend SampleService). Takes priority over showIntake so a
   *  stale config (collect in lab but intake still on) still shows Collect. */
  readonly showCollect = computed(() => this.process.collectsInLab());

  /** Lab Intake is a placeable workflow action — hide the intake pane/tab when
   *  an admin switches `lab_intake` OFF in /admin/process, or when collection
   *  happens in the lab (Collect replaces intake). */
  readonly showIntake = computed(() => !this.showCollect() && this.process.isEnabled('lab_intake'));

  /** Either left pane (Collect or Lab Intake) occupies the split's left slot. */
  readonly showLeftPane = computed(() => this.showCollect() || this.showIntake());

  // Rejected tab dropped — re-entry rows now show inline in My Work
  // with their rejection reason in the tube tile, so the tech sees WHY
  // the pathologist sent it back without switching tabs.
  readonly tabOptions = [
    { value: 'my_work'       as Tab, label: 'My Work' },
    { value: 'service_queue' as Tab, label: 'Queue' }
  ];

  /** ViewChild ref to the embedded Lab Intake component so the pane
   *  header's inline scan bar can trigger the camera scanner OR pass a
   *  typed barcode straight to the receive flow. Auto-intake fires when
   *  the scanner reports a match. */
  private readonly intakeRef = viewChild<ReceiveSamplesComponent>('intakeRef');
  /** Buffer for the header's manual-typing input. Cleared after submit. */
  protected readonly intakeScanInput = signal('');

  /** Phone-only (<=640px) presentational toggle: collapses the cramped
   *  Lab Intake inline search to a magnifier icon by default and expands
   *  it to a full-width input on demand. Ignored >=641px (the inline
   *  search there is always shown, byte-for-byte unchanged). */
  protected readonly intakeSearchOpen = signal(false);
  private readonly intakeSearchField = viewChild<ElementRef<HTMLInputElement>>('intakeSearchField');
  /** Toggle the Lab Intake search: tap the magnifier to expand, tap again to
   *  collapse. Focuses the field when expanding. */
  toggleIntakeSearch() {
    const next = !this.intakeSearchOpen();
    this.intakeSearchOpen.set(next);
    if (next) setTimeout(() => this.intakeSearchField()?.nativeElement.focus(), 0);
  }

  openIntakeScanner() { this.intakeRef()?.openBarcodeScanner(); }
  intakeReceive() {
    const code = this.intakeScanInput().trim();
    if (!code) return;
    this.intakeRef()?.receiveByCode(code);
    this.intakeScanInput.set('');
  }

  // ── Lab Intake ↔ Workbench split (desktop only) ─────────────
  // Persisted percentage of the row width given to the LEFT pane
  // (Lab Intake). The right pane fills the remainder.
  private static readonly MW_SPLIT_KEY = 'pf.lms.lab.mwSplitPct';
  private readonly _mwSplitPct = signal<number>(this.loadMwSplit());
  readonly mwSplitPct = this._mwSplitPct.asReadonly();
  private readonly _mwDragging = signal(false);
  readonly mwDragging = this._mwDragging.asReadonly();
  private _mwActivePointerId: number | null = null;

  private loadMwSplit(): number {
    try {
      const raw = localStorage.getItem(MyWorkComponent.MW_SPLIT_KEY);
      const n = raw ? Number(raw) : 33;
      return Number.isFinite(n) && n >= 20 && n <= 80 ? n : 33;
    } catch { return 33; }
  }
  private persistMwSplit(n: number) {
    try { localStorage.setItem(MyWorkComponent.MW_SPLIT_KEY, String(n)); } catch { /* ignore */ }
  }

  onMwSplitPointerDown(ev: PointerEvent) {
    const target = ev.currentTarget as HTMLElement;
    target.setPointerCapture(ev.pointerId);
    this._mwActivePointerId = ev.pointerId;
    this._mwDragging.set(true);
    ev.preventDefault();
  }
  onMwSplitPointerMove(ev: PointerEvent) {
    if (this._mwActivePointerId !== ev.pointerId) return;
    const split = (ev.currentTarget as HTMLElement).parentElement;
    if (!split) return;
    const rect = split.getBoundingClientRect();
    if (rect.width <= 0) return;
    const raw = ((ev.clientX - rect.left) / rect.width) * 100;
    const clamped = Math.max(20, Math.min(80, raw));
    this._mwSplitPct.set(clamped);
    const firstPane = split.querySelector<HTMLElement>(':scope > .pf-mw-pane');
    if (firstPane) firstPane.style.flexBasis = clamped + '%';
  }
  onMwSplitPointerUp(ev: PointerEvent) {
    if (this._mwActivePointerId !== ev.pointerId && ev.type !== 'lostpointercapture') return;
    const target = ev.currentTarget as HTMLElement;
    if (target.hasPointerCapture(ev.pointerId)) target.releasePointerCapture(ev.pointerId);
    this._mwActivePointerId = null;
    this._mwDragging.set(false);
    this.persistMwSplit(this._mwSplitPct());
  }

  // Culture (3rd) pane width — its own drag handle, persisted in px. Consumed
  // via a CSS var so it only applies in the desktop 3-column layout.
  private static readonly CULTURE_W_KEY = 'pf.lms.lab.cultureWidth';
  private readonly _cultureWidth = signal<number>(this.loadCultureWidth());
  readonly cultureWidth = this._cultureWidth.asReadonly();
  private _cultureActivePointerId: number | null = null;

  private loadCultureWidth(): number {
    try {
      const raw = localStorage.getItem(MyWorkComponent.CULTURE_W_KEY);
      const n = raw ? Number(raw) : 340;
      return Number.isFinite(n) && n >= 260 && n <= 680 ? n : 340;
    } catch { return 340; }
  }
  onCulturePointerDown(ev: PointerEvent) {
    const t = ev.currentTarget as HTMLElement;
    t.setPointerCapture(ev.pointerId);
    this._cultureActivePointerId = ev.pointerId;
    this._mwDragging.set(true);
    ev.preventDefault();
  }
  onCulturePointerMove(ev: PointerEvent) {
    if (this._cultureActivePointerId !== ev.pointerId) return;
    const split = (ev.currentTarget as HTMLElement).parentElement;
    if (!split) return;
    const rect = split.getBoundingClientRect();
    // Handle sits to the LEFT of the culture pane → dragging left widens it.
    this._cultureWidth.set(Math.max(260, Math.min(680, rect.right - ev.clientX)));
  }
  onCulturePointerUp(ev: PointerEvent) {
    if (this._cultureActivePointerId !== ev.pointerId && ev.type !== 'lostpointercapture') return;
    const t = ev.currentTarget as HTMLElement;
    if (t.hasPointerCapture(ev.pointerId)) t.releasePointerCapture(ev.pointerId);
    this._cultureActivePointerId = null;
    this._mwDragging.set(false);
    try { localStorage.setItem(MyWorkComponent.CULTURE_W_KEY, String(this._cultureWidth())); } catch { /* ignore */ }
  }
  readonly counters = COUNTERS;

  private readonly _tab = signal<Tab>('my_work');
  readonly tab = this._tab.asReadonly();
  setTab(t: Tab) { this._tab.set(t); this.refresh(); }

  // ── Phone-only single-pane presentation state (<=640px) ──────────
  // Purely presentational. `mobileTab` picks which section the phone
  // tabbed view shows; `kpiOpen` toggles the collapsed KPI counter
  // chips. Both are ignored above 640px (their visibility classes only
  // apply inside @media (max-width:640px)), so desktop is untouched.
  // Switching to My Work / Queue reuses the existing setTab() so the
  // right pane loads the matching data — no new fetch logic.
  protected readonly mobileTab = signal<'intake' | 'mywork' | 'queue' | 'completed' | 'culture'>('intake');
  protected readonly kpiOpen = signal(false);

  // ── Stats popover teleport (phone) ──────────────────────────────
  // The popover is nested deep under the shell (which has a backdrop-filter
  // stacking context) + glass cards, so z-index alone can't lift it. Move its
  // DOM to <body> while open and position it as `fixed` under the button, so
  // nothing can clip it or paint over it. Mirrors the collect-drawer teleport.
  private readonly kpiBtn = viewChild<ElementRef<HTMLButtonElement>>('kpiBtn');
  private readonly kpiPopEl = viewChild<ElementRef<HTMLElement>>('kpiPop');
  protected readonly kpiPos = signal<{ top: number; right: number }>({ top: 0, right: 0 });
  private kpiTeleported: HTMLElement | null = null;
  private readonly _kpiPortal = effect(() => {
    const open = this.kpiOpen();
    const el = this.kpiPopEl()?.nativeElement;
    if (!open || !el) { this.detachKpi(); return; }
    // Anchor under the stats button (fixed → viewport coords).
    const btn = this.kpiBtn()?.nativeElement;
    if (btn) {
      const r = btn.getBoundingClientRect();
      this.kpiPos.set({ top: Math.round(r.bottom + 8), right: Math.round(Math.max(8, window.innerWidth - r.right)) });
    }
    // Teleport a frame later so the element is rendered first.
    queueMicrotask(() => {
      const node = this.kpiPopEl()?.nativeElement;
      if (node && node.parentNode !== document.body) {
        document.body.appendChild(node);
        this.kpiTeleported = node;
      }
    });
  });
  private detachKpi() {
    if (this.kpiTeleported && this.kpiTeleported.parentNode === document.body) {
      document.body.removeChild(this.kpiTeleported);
    }
    this.kpiTeleported = null;
  }
  /** When the left pane (Collect or Lab Intake) is switched off, don't strand
   *  the phone view on the now-hidden first tab. */
  private readonly _intakeTabGuard = effect(() => {
    if (!this.showLeftPane() && this.mobileTab() === 'intake') this.setMobileTab('mywork');
  });
  setMobileTab(t: 'intake' | 'mywork' | 'queue' | 'completed' | 'culture') {
    this.mobileTab.set(t);
    if (t === 'mywork') this.setTab('my_work');
    else if (t === 'queue') this.setTab('service_queue');
    else if (t === 'completed') this.setTab('completed');
    // 'culture' is a standalone pane, not a queue tab — no setTab.
  }

  private readonly _counter = signal<CounterSpec['id']>('all');
  readonly counter = this._counter.asReadonly();
  setCounter(c: CounterSpec['id']) { this._counter.set(c); }

  private readonly _scan = signal<string>('');
  readonly scan = this._scan.asReadonly();
  setScan(v: string) { this._scan.set(v); }
  asInput(ev: Event): string { return (ev.target as HTMLInputElement).value; }

  // ── Manual barcode entry ─────────────────────────────────────────────
  private readonly auth = inject(AuthService);
  private readonly tenantState = inject(TenantStateService);

  protected readonly departments = signal<Department[]>([]);
  protected readonly selectedDeptCode = signal<string>('');
  /** Phone viewport — drives DOM-level removal of chrome that belongs only on
   *  larger screens (the KPI strip + inline counter filter row, both replaced
   *  by the header Stats popover on phone). Kept in sync via matchMedia. */
  private readonly _phoneMq = typeof window !== 'undefined' ? window.matchMedia('(max-width: 640px)') : null;
  protected readonly isPhone = signal<boolean>(this._phoneMq?.matches ?? false);
  readonly currentYear = new Date().getFullYear();

  readonly vendorCode = computed(() => this.tenantState.tenant()?.vendorCode ?? '');

  /** Tenant-wide running-number width for the short sample barcode (1–9). */
  readonly numberWidth = computed(() => {
    const w = this.tenantState.tenant()?.sampleNumberWidth ?? 5;
    return w >= 1 && w <= 9 ? w : 5;
  });
  /** 2-digit year suffix (YY). */
  readonly yy = computed(() => (this.currentYear % 100).toString().padStart(2, '0'));

  /** The selected department's 2-digit sample code — the prefix of the new
   *  short barcode. Null when the admin hasn't assigned one yet. */
  readonly selectedDeptSampleCode = computed(() => {
    const d = this.departments().find(x => x.code === this.selectedDeptCode());
    return (d?.sampleCode != null && d.sampleCode >= 1 && d.sampleCode <= 99)
      ? d.sampleCode.toString().padStart(2, '0')
      : null;
  });

  /** Example sample id for the scan/search placeholders, e.g. 012600001. */
  readonly sampleIdExample = computed(() => {
    const dd = this.selectedDeptSampleCode() ?? '01';
    const seq = ''.padStart(this.numberWidth(), '0').replace(/0$/, '1');
    return `${dd}${this.yy()}${seq}`;
  });

  private loadDepartments() {
    const branchId = this.auth.user()?.branchId;
    if (!branchId) return;
    this.api.get<Department[]>(`/api/tenants/departments?branchId=${branchId}`).subscribe({
      next: list => {
        const arr = list ?? [];
        this.departments.set(arr);
        let last = '';
        try { last = localStorage.getItem(LAST_DEPT_KEY) ?? ''; } catch { /* ignore */ }
        const match = arr.find(d => d.code === last);
        if (match) this.selectedDeptCode.set(match.code);
        else if (arr.length > 0) this.selectedDeptCode.set(arr[0].code);
      }
    });
  }

  private readonly _rows = signal<OrderTest[]>([]);
  readonly rows = this._rows.asReadonly();

  private readonly _loading = signal(false);
  readonly loading = this._loading.asReadonly();

  private readonly _counts = signal<Record<Tab, number>>({ intake: 0, my_work: 0, service_queue: 0, rejected: 0, completed: 0 });
  countFor(t: Tab): number { return this._counts()[t]; }

  // ── Completed tab ────────────────────────────────────────────
  // This tech's finished work (status entered/validated, resulted within
  // the window), fetched lazily from its own endpoint and grouped into
  // tubes. Kept in its own signal so opening the tab never disturbs the
  // queue rows the other tabs share.
  readonly completedDays = 7;
  private readonly _completed = signal<OrderTest[]>([]);
  private readonly _completedLoading = signal(false);
  readonly completedLoading = this._completedLoading.asReadonly();
  private readonly _reopeningTubeId = signal<string | null>(null);
  readonly reopeningTubeId = this._reopeningTubeId.asReadonly();
  private readonly _printingTubeId = signal<string | null>(null);
  readonly printingTubeId = this._printingTubeId.asReadonly();

  /** Print a completed (validated) tube's report DIRECTLY — build the report PDF
   *  and open the browser print dialog on it, no navigation to the viewer. */
  printCompletedTube(tube: { sampleId: string; barcode: string; tests: OrderTest[] }) {
    const t0 = tube.tests?.[0];
    const orderId = t0?.subOrder?.orderId ?? t0?.subOrder?.order?.id;
    if (!orderId) { this.toasts.error('No order found for this sample.'); return; }
    this._printingTubeId.set(tube.sampleId);
    this.api.get<Record<string, unknown> | null>(`/api/reports/by-order/${orderId}`).subscribe({
      next: async rep => {
        try {
          if (!rep) { this.toasts.info('Report is not generated yet for this order.'); return; }
          const url = await buildReportBlobUrl(rep, this.api, this.injector);
          if (url) this.printBlobUrl(url);
          else this.toasts.error('Could not build the report to print.');
        } finally { this._printingTubeId.set(null); }
      },
      error: e => { this._printingTubeId.set(null); this.toasts.error(ApiError.from(e).message); },
    });
  }

  /** Load a PDF blob into a hidden iframe and fire the print dialog on it. Falls
   *  back to opening the PDF in a new tab if the frame can't be printed. */
  private printBlobUrl(url: string): void {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        window.open(url, '_blank');
      }
      // Give the print job time to read the blob before cleanup.
      setTimeout(() => { try { URL.revokeObjectURL(url); iframe.remove(); } catch { /* */ } }, 60_000);
    };
    iframe.src = url;
    document.body.appendChild(iframe);
  }

  /** edit_result — Lab Technician, Pathologist and Lab Admin hold it; the
   *  front desk never does, so the action simply doesn't render for them. */
  readonly canEditResult = computed(() => this.auth.hasPermission('edit_result'));

  /** One row per TUBE: the same grouping key the other tabs use
   *  (subOrder id), plus the patient line, the test names, when it was
   *  finished and whether it is merely submitted or already validated. */
  readonly completedTubes = computed(() => {
    const bySample = new Map<string, OrderTest[]>();
    for (const t of this._completed()) {
      const sid = t.subOrder?.id ?? t.id;
      if (!bySample.has(sid)) bySample.set(sid, []);
      bySample.get(sid)!.push(t);
    }
    return Array.from(bySample.entries()).map(([sampleId, tests]) => {
      const first = tests[0];
      const patient = first.subOrder?.order?.patient;
      const stamps = tests
        .map(t => t.validatedAt ?? t.resultedAt)
        .filter((d): d is string => !!d)
        .map(d => new Date(d).getTime());
      return {
        sampleId,
        tests,
        barcode: first.subOrder?.barcode ?? '',
        deptName: first.subOrder?.department?.name ?? first.test?.department?.name ?? '',
        patientName: patient?.displayName ?? 'Patient',
        patientMeta: patient ? formatPatientMeta(patient) : '',
        testNames: tests.map(t => t.test?.name ?? 'Test').join(' · '),
        // A tube reads as validated only once every test on it is signed.
        status: tests.every(t => t.status === 'validated') ? 'validated' : 'entered',
        completedAt: stamps.length ? new Date(Math.max(...stamps)).toISOString() : null
      };
    }).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  });

  private loadCompleted() {
    this._completedLoading.set(true);
    this.api.get<OrderTest[]>(`/api/results/completed?days=${this.completedDays}`).subscribe({
      next: l => {
        this._completed.set(l ?? []);
        this._completedLoading.set(false);
        this._counts.update(c => ({ ...c, completed: this.completedTubes().length }));
      },
      error: () => this._completedLoading.set(false)
    });
  }

  /** Edit a finished tube: mandatory reason (the app's themed prompt), then
   *  the backend re-opens every submitted/validated test on it back to THIS
   *  tech — audited — and we drop the user into My Work where it landed. */
  /** Open the sample's results READ-ONLY (owner 2026-09-20): inspect what
   *  was entered without reopening anything for edit. */
  viewCompletedTube(tube: { sampleId: string }) {
    void this.router.navigate(['/lab/sample', tube.sampleId], { queryParams: { view: 1 } });
  }

  async editCompletedTube(tube: { sampleId: string; barcode: string; tests: OrderTest[] }) {
    const reason = await this.dialog.prompt({
      title: 'Re-open for editing?',
      message: `${tube.barcode || tube.sampleId} · ${tube.tests.length} result(s) go back into your My Work. The reason is recorded in the audit trail.`,
      placeholder: 'e.g. wrong sample, typo in Hb…',
      multiline: true,
      required: true,
      confirmLabel: 'Re-open'
    });
    if (!reason || !reason.trim()) return;

    this._reopeningTubeId.set(tube.sampleId);
    this.api.post<{ reopened: number }>(`/api/results/tube/${tube.sampleId}/reopen-mine`, { reason: reason.trim() })
      .subscribe({
        next: res => {
          this._reopeningTubeId.set(null);
          const n = res?.reopened ?? tube.tests.length;
          this.toasts.success(`${n} result${n === 1 ? '' : 's'} re-opened — back in your My Work`);
          this.loadCompleted();
          this.refreshAllCounts();
          // The point of re-opening is to correct the values, so go straight
          // to the tube's RESULT page. My Work is set behind the navigation,
          // so backing out of the result screen lands on the work it joined.
          this.setTab('my_work');
          if (this.mobileTab() === 'completed') this.mobileTab.set('mywork');
          this.router.navigate(['/lab/sample', tube.sampleId]);
        },
        error: e => {
          this._reopeningTubeId.set(null);
          this.toasts.error(ApiError.from(e).message);
        }
      });
  }

  readonly buckets = computed<Bucket[]>(() => {
    const enriched: Enriched[] = this.enrich(this._rows());
    const filtered = this.filterByCounter(enriched);
    return [
      { level: 'urgent' as const, items: filtered.filter(e => e._level === 'urgent') },
      { level: 'high'   as const, items: filtered.filter(e => e._level === 'high') },
      { level: 'normal' as const, items: filtered.filter(e => e._level === 'normal') }
    ];
  });

  private enrich(rows: OrderTest[]): Enriched[] {
    return rows.map(t => {
      const ral = t.subOrder?.receivedAtLab;
      const budget = (t.test?.tatHours ?? 0) * 60;
      const elapsed = ral ? (Date.now() - new Date(ral).getTime()) / 60000 : 0;
      const remaining = budget - elapsed;
      const level: Level = remaining <= 0 ? 'urgent' : remaining <= 60 ? 'high' : 'normal';
      return { ...t, _level: level, _remainingMin: remaining };
    });
  }

  /** Counter-tile filter runs on top of the segmented tab filter. */
  private filterByCounter(list: Enriched[]): Enriched[] {
    switch (this._counter()) {
      case 'pending':     return list.filter(t => t.status === 'pending' || t.status === 're_entry');
      case 'critical':    return list.filter(t => this.isCritical(t));
      case 'in_progress': return list.filter(t => t.status === 'in_progress' || t.status === 'entered');
      case 'done':        return list.filter(t => t.status === 'validated');
      default:            return list;
    }
  }

  counterValue(id: CounterSpec['id']): number {
    const enriched = this.enrich(this._rows());
    switch (id) {
      case 'pending':     return enriched.filter(t => t.status === 'pending' || t.status === 're_entry').length;
      case 'critical':    return enriched.filter(t => this.isCritical(t)).length;
      case 'in_progress': return enriched.filter(t => t.status === 'in_progress' || t.status === 'entered').length;
      case 'done':        return enriched.filter(t => t.status === 'validated').length;
      default:            return enriched.length;
    }
  }

  private isCritical(t: OrderTest): boolean {
    if (!t.currentResult) return false;
    try {
      const snap = JSON.parse(t.currentResult) as { flags?: { critical?: boolean } };
      return snap.flags?.critical === true;
    } catch { return false; }
  }

  /**
   * Group bucket items by orderId so the queue shows one card per patient
   * with all their tests nested inside instead of one floating card per
   * test. The card's TAT level is the worst (most-urgent) of any test in
   * the order so a patient with one breached test isn't buried.
   */
  patientGroups(items: Enriched[]): Array<{
    orderId: string;
    patientName: string;
    patientInfo: string;
    items: Enriched[];
    level: Level;
    remainingMin: number;
  }> {
    const byOrder = new Map<string, Enriched[]>();
    for (const t of items) {
      const oid = t.subOrder?.order?.id ?? t.id;
      if (!byOrder.has(oid)) byOrder.set(oid, []);
      byOrder.get(oid)!.push(t);
    }
    const levelRank: Record<Level, number> = { 'urgent': 0, 'high': 1, 'normal': 2 };
    return Array.from(byOrder.entries()).map(([orderId, group]) => {
      const worst = [...group].sort((a, b) => levelRank[a._level] - levelRank[b._level])[0];
      const patient = worst.subOrder?.order?.patient;
      return {
        orderId,
        patientName: patient?.displayName ?? 'Patient',
        // Standard patient line: <Name(≤15)+..> | <age>/<sex> | <P-ID>
        patientInfo: patient ? formatPatientInfo(patient) : 'Patient',
        items: group,
        level: worst._level,
        remainingMin: Math.min(...group.map(t => t._remainingMin))
      };
    });
  }

  // Expand/collapse state per order id within My Work.
  private readonly _expanded = signal<Set<string>>(new Set());
  expanded(id: string): boolean { return this._expanded().has(id); }
  toggleExpand(id: string): void {
    const next = new Set(this._expanded());
    if (next.has(id)) next.delete(id); else next.add(id);
    this._expanded.set(next);
  }

  toneFor(level: Level): TileTone {
    return level === 'urgent' ? 'rose' : level === 'high' ? 'amber' : 'default';
  }

  ngOnInit() {
    // Re-fetch the active workflow so a `lab_intake` toggle in /admin/process
    // reflects here (hides/shows the Lab Intake pane) on each visit.
    this.process.refreshActive();
    // Per-branch queue focus (patient vs sample). Additive presentation only.
    this.labCfg.ensureLoaded();
    this.refresh();
    this.refreshAllCounts();
    // Live queue: refetch when the server says this area changed (no polling).
    this.liveQ.on('my_work', 'receive').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refresh());
    // Departments feed sampleIdExample(), the "e.g. 012600001" hint in the scan
    // box. The removed Manual-entry toggle used to be the only thing that
    // loaded them, which would have frozen the hint at its '01' fallback.
    this.tenantState.ensureLoaded();
    if (this.departments().length === 0) this.loadDepartments();
    this._phoneMq?.addEventListener('change', e => this.isPhone.set(e.matches));
  }

  onSampleReceived() {
    this.refresh();
    this.refreshAllCounts();
  }

  refresh() {
    // Intake tab embeds the ReceiveSamplesComponent which manages its own
    // data; nothing to fetch here.
    if (this._tab() === 'intake') { this._loading.set(false); return; }
    // Completed keeps its own list + endpoint; loading it here would
    // overwrite the queue rows the other tabs render from.
    if (this._tab() === 'completed') { this._loading.set(false); this.loadCompleted(); return; }
    const url = this.endpointFor(this._tab());
    this._loading.set(true);
    this.api.get<OrderTest[]>(url).subscribe({
      next: l => { this._rows.set((l ?? []).filter(t => this.matchesTab(t, this._tab()))); this._loading.set(false); },
      error: () => this._loading.set(false)
    });
  }

  private refreshAllCounts() {
    // Completed has a dedicated endpoint and counts TUBES (its rows), so it
    // can't ride the endpointFor loop below.
    if (this._tab() !== 'completed') {
      this.api.get<OrderTest[]>(`/api/results/completed?days=${this.completedDays}`).subscribe({
        next: l => {
          const tubes = new Set((l ?? []).map(t => t.subOrder?.id ?? t.id));
          this._counts.update(c => ({ ...c, completed: tubes.size }));
        }
      });
    }
    for (const t of ['my_work', 'service_queue', 'rejected'] as Tab[]) {
      this.api.get<OrderTest[]>(this.endpointFor(t)).subscribe({
        next: l => {
          const matched = (l ?? []).filter(x => this.matchesTab(x, t));
          // Badge must match what the list shows: SAMPLES in sample-focused mode
          // (the "N samples" label uses sampleCountIn), else individual tests.
          const count = this.labCfg.sampleFocused() ? this.sampleCountIn(matched) : matched.length;
          this._counts.update(c => ({ ...c, [t]: count }));
        }
      });
    }
  }

  private endpointFor(t: Tab): string {
    if (t === 'service_queue')
      return this.showClaimed() ? '/api/results/service-queue?includeAssigned=true' : '/api/results/service-queue';
    return '/api/results/my-work';
  }

  // ── Queue "Show claimed" — supervisor view ─────────────────────
  // The queue is normally the unclaimed pool. This toggle also lists tubes
  // other techs already claimed (badged with the owner) so stuck work — e.g.
  // a tech on leave — can be found and delegated.
  readonly showClaimed = signal(false);
  private readonly _userById = signal<Record<string, string>>({});
  readonly myUserId = computed(() => this.auth.user()?.id ?? '');
  readonly allowNoScanClaim = computed(() => this.tenantState.tenant()?.allowNoScanClaim === true);
  /** Routing the pool / other techs' work is supervisor-grade — mirrors the
   *  backend's reassign_result check on the delegate endpoint. */
  readonly canReassign = computed(() => this.auth.hasPermission('reassign_result'));

  toggleShowClaimed() {
    this.showClaimed.update(v => !v);
    if (this.showClaimed() && Object.keys(this._userById()).length === 0) {
      this.api.get<Array<{ id: string; displayName?: string; firstName?: string; email?: string }>>('/api/users/').subscribe({
        next: l => this._userById.set(Object.fromEntries(
          (l ?? []).map(u => [u.id, u.displayName || u.firstName || u.email || 'User'])))
      });
    }
    this.refresh();
  }
  assigneeName(id: string | null): string {
    if (!id) return '';
    if (id === this.myUserId()) return 'You';
    return this._userById()[id] ?? 'Claimed';
  }
  private matchesTab(t: OrderTest, tab: Tab): boolean {
    // Rejected tab: focused view, only re_entry rows.
    if (tab === 'rejected') return t.status === 're_entry';
    // My Work tab: every row assigned to the tech that still needs
    // their hands on it — pending (not yet started), in_progress
    // (mid-entry), AND re_entry (pathologist sent it back). Without the
    // re_entry inclusion the original submitter doesn't see their own
    // rejected work in the default landing tab.
    if (tab === 'my_work')  return t.status === 'pending' || t.status === 'in_progress' || t.status === 're_entry';
    return true;
  }

  /** A scanned order QR encodes a full URL (`http://host/o/<id>`), not a tube
   *  barcode. Detect an order/track URL (or a bare `/o/<id>` path) and route to
   *  the canonical opener instead of trying to match a result row. Returns true
   *  when it handled (and routed) the scan. */
  private routeIfOrderUrl(text: string): boolean {
    const order = text.match(/\/o\/([0-9a-fA-F-]{6,})/);
    if (order) { this._scan.set(''); this.router.navigate(['/o', order[1]]); return true; }
    const track = text.match(/\/track\/([^/?#\s]+)/);
    if (track) { this._scan.set(''); this.router.navigate(['/track', track[1]]); return true; }
    return false;
  }

  /** Try to resolve a scanned barcode/OrderTest id → jump to result entry. */
  scanSubmit() {
    const q = this._scan().trim();
    if (!q) return;
    // Scanned order QR (a /o/<id> URL) → open the order, don't tube-match.
    if (this.routeIfOrderUrl(q)) return;
    // Look for a row whose barcode/id matches the scan. We route through
    // /claim-by-scan so the backend enforces (a) this user is the
    // assignee and (b) the scanned code actually matches the sample —
    // the scan bar is just a faster path to the same gate the modal uses.
    const hit = this._rows().find(r =>
      r.subOrder?.barcode === q ||
      r.id === q ||
      r.subOrder?.id === q
    );
    if (!hit) {
      // Not in this tech's queue — resolve the typed/scanned barcode to its
      // sample and open result entry directly (so any valid code opens the
      // tests, not only rows already assigned here).
      this.api.get<{ sampleId: string; orderId: string }>(
        `/api/results/resolve-sample?barcode=${encodeURIComponent(q)}`).subscribe({
        next: r => {
          if (r?.sampleId) {
            this._scan.set('');
            // Not in this tech's queue — opening is allowed, but make the
            // ownership consequence explicit (entry auto-claims server-side).
            this.toasts.info('This tube isn’t in your queue — entering results will claim it to you.');
            this.router.navigate(['/lab/sample', r.sampleId]);
          }
          else this.toasts.warning('No match for that code');
        },
        error: () => this.toasts.warning('No match for that code'),
      });
      return;
    }
    const scannedBarcode = hit.subOrder?.barcode ?? q;
    this.api.post<OrderTest>(`/api/results/${hit.id}/claim-by-scan`, { barcode: scannedBarcode }).subscribe({
      next: () => { this._scan.set(''); this.enterJustScanned(hit); },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }

  // ── Scan-gated pickup ─────────────────────────────────
  // Clicking the queue action opens the scanner modal with the row's
  // expected barcode. The modal only emits (matched) when the scanned
  // code equals the expected one. Backend /claim-by-scan then verifies
  // the user is actually the assignee (auto-assigned or delegated) —
  // which prevents cross-tech scanning.
  private readonly _scanTarget = signal<OrderTest | null>(null);
  readonly scanTarget = this._scanTarget.asReadonly();
  readonly scanExpected = computed(() => this._scanTarget()?.subOrder?.barcode ?? '');

  /** One scan per tube per tech: true when THIS tech already scan-verified
   *  the tube (at queue claim or a previous My-Work pick) — re-opening it
   *  must not demand another scan. */
  private isScanVerifiedByMe(s?: OrderSample | null): boolean {
    return !!s?.scanVerifiedAt && !!s?.scanVerifiedBy
        && s.scanVerifiedBy === this.auth.user()?.id;
  }
  /** Template hook: this row's tube was already scan-verified by me, so the
   *  action reads "Enter result" instead of "Pick up · scan". */
  scanVerified(t: OrderTest): boolean { return this.isScanVerifiedByMe(t.subOrder); }

  startPick(t: OrderTest) {
    // Already scan-verified by this tech — straight to entry, no scan modal.
    if (this.isScanVerifiedByMe(t.subOrder)) {
      this.enterJustScanned(t);
      return;
    }
    if (!t.subOrder?.barcode) {
      this.toasts.warning('This sample has no barcode — ask supervisor to reprint.');
      return;
    }
    this._scanTarget.set(t);
  }

  cancelScan() { this._scanTarget.set(null); }

  // Top-bar camera mode: no expected code, relays decoded value into the
  // scan input and submits via scanSubmit → same claim-by-scan gate.
  private readonly _barScannerOpen = signal(false);
  readonly barScannerOpen = this._barScannerOpen.asReadonly();
  openBarSearchScanner() { this._barScannerOpen.set(true); }
  closeBarSearchScanner() { this._barScannerOpen.set(false); }
  onBarSearchMatched(code: string) {
    this._barScannerOpen.set(false);
    this._scan.set(code);
    this.scanSubmit();
  }

  onScanMatched(code: string) {
    const t = this._scanTarget();
    if (!t) return;
    this.api.post<OrderTest>(`/api/results/${t.id}/claim-by-scan`, { barcode: code }).subscribe({
      next: () => {
        this._scanTarget.set(null);
        this.enterJustScanned(t);
      },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }

  // Sample-level entry (Fix 6 — the tube IS the unit of work). One scan,
  // all tests in the tube on one screen. Falls back to per-test entry only
  // when the row has no sample link (legacy data).
  enter(t: OrderTest) {
    const sid = t.subOrder?.id;
    if (sid) this.router.navigate(['/lab/sample', sid]);
    else this.router.navigate(['/lab/result', t.id]);
  }

  /**
   * Sub-group a patient's OrderTests by their tube (OrderSample). Each
   * tube row carries the sample id, dept name, barcode (for the scan
   * gate), the tests inside, and a pre-computed allDone flag so the UI
   * can render a status pill instead of an Open button when the whole
   * tube is already entered/validated.
   */
  /** Distinct tubes among `items` — the count shown in sample-focused mode.
   *  Same grouping key as tubesIn (subOrder id, falling back to the test id
   *  for legacy rows) so the badge always matches the rows rendered. */
  sampleCountIn(items: ReadonlyArray<OrderTest>): number {
    const ids = new Set<string>();
    for (const t of items) ids.add(t.subOrder?.id ?? t.id);
    return ids.size;
  }

  tubesIn(items: Enriched[]): Array<{
    sampleId: string;
    deptName: string;
    barcode: string;
    tests: Enriched[];
    allDone: boolean;
    hasDraft: boolean;
    assignedTo: string | null;
    rejections: Array<{ testName: string; reason: string }>;
  }> {
    const bySample = new Map<string, Enriched[]>();
    for (const t of items) {
      const sid = t.subOrder?.id ?? t.id; // fall back so legacy tests still render
      if (!bySample.has(sid)) bySample.set(sid, []);
      bySample.get(sid)!.push(t);
    }
    return Array.from(bySample.entries()).map(([sampleId, tests]) => {
      const first = tests[0];
      const deptName = first.subOrder?.department?.name ?? first.test?.department?.name ?? '';
      const barcode = first.subOrder?.barcode ?? '';
      const allDone = tests.every(x => x.status === 'entered' || x.status === 'validated');
      // A half-finished tube: partial values saved (draft keeps CurrentResult
      // and status in_progress) but not yet submitted. Badged so the tech can
      // spot what they left off.
      const hasDraft = tests.some(x => x.status === 'in_progress' && !!x.currentResult);
      // Owner (when the queue is showing claimed work): tube-level = first
      // assigned test's owner.
      const assignedTo = tests.find(x => x.assignedTo)?.assignedTo ?? null;
      // Surface every rejected test's reason so the tile can show a
      // banner explaining WHY the pathologist sent it back. Without this
      // the tech sees only the ↻ icon and has to dig into the test to
      // find out what to fix.
      const rejections = tests
        .filter(x => x.status === 're_entry' && (x.rejectionReason ?? '').trim().length > 0)
        .map(x => ({ testName: x.test?.name ?? 'Test', reason: x.rejectionReason ?? '' }));
      return { sampleId, deptName, barcode, tests, allDone, hasDraft, assignedTo, rejections };
    // Sequence by sample number — the queue reads 26034, 26035, 26036, not the
    // insertion order the grouping map happened to preserve.
    }).sort((a, b) => (a.barcode ?? '').localeCompare(b.barcode ?? '', undefined, { numeric: true }));
  }

  /**
   * Sample-focused rows for the whole bucket. Reuses tubesIn's grouping (one
   * row per tube/sampleId across ALL patients in the bucket, since a sample
   * belongs to exactly one order/patient) and augments each tube with the
   * patient it belongs to — derived the same way patientGroups does, from the
   * tube's tests' order/patient. Consumed only when labCfg.sampleFocused().
   */
  sampleRows(items: Enriched[]): Array<{
    sampleId: string;
    deptName: string;
    barcode: string;
    tests: Enriched[];
    allDone: boolean;
    hasDraft: boolean;
    assignedTo: string | null;
    rejections: Array<{ testName: string; reason: string }>;
    patientName: string;
    patientInfo: string;
    patientMeta: string;
  }> {
    return this.tubesIn(items).map(tube => {
      const patient = tube.tests[0]?.subOrder?.order?.patient;
      return {
        ...tube,
        patientName: patient?.displayName ?? 'Patient',
        // Standard patient line: <Name(≤15)+..> | <age>/<sex> | <P-ID>
        patientInfo: patient ? formatPatientInfo(patient) : 'Patient',
        // Age/sex + MRN on their own, so the queue row can emphasise the NAME
        // and trail the identifiers in a muted run instead of one flat string.
        patientMeta: patient ? formatPatientMeta(patient) : ''
      };
    });
  }

  /**
   * Pick action on a tube row. Uses the existing scan-gated startPick on
   * the first test (so the modal demands the tube barcode) — once the
   * scanner emits matched, onScanMatched ends up calling enterJustScanned
   * which navigates to /lab/sample/:sampleId (Fix 6 sample-level entry).
   * One scan → all tests in the tube open together.
   */
  pickTube(tube: { sampleId: string; barcode: string; tests: Enriched[] }) {
    const probe = tube.tests[0];
    if (!probe) return;
    // Brief tube-fill animation on the tile so the tech sees a clear
    // "picked" cue before the route swaps. ~280ms is long enough to feel
    // intentional but short enough not to block the workflow.
    this._pickingTubeId.set(tube.sampleId);
    setTimeout(() => this._pickingTubeId.set(null), 600);

    if (!tube.barcode) {
      // Fall back to direct nav when there's no barcode to gate on
      // (e.g. samples created by the realignment seeder without a printed
      // label). The user will still see all tests in the tube together.
      this.router.navigate(['/lab/sample', tube.sampleId]);
      return;
    }
    this.startPick(probe);
  }
  private readonly _pickingTubeId = signal<string | null>(null);
  readonly pickingTubeId = this._pickingTubeId.asReadonly();

  // ── Hold-to-peek on queue cards ───────────────────────────
  // Press-and-hold a sample-focused queue card (~2s, progress bar fills along
  // the card's bottom edge) to peek its test list — the same gesture as the
  // collection screen's vials, deliberately without a textual hint. Moving
  // (scrolling) or releasing early cancels; holds that start on a button
  // (Pick / Delegate) are ignored so their taps behave normally.
  readonly cardPeekId = signal<string | null>(null);
  readonly cardPeekPos = signal<{ x: number; y: number } | null>(null);
  readonly cardPeekTests = signal<string[]>([]);
  readonly holdingPeekId = signal<string | null>(null);
  private static readonly CARD_HOLD_MS = 2000;
  private _cardPressTimer: ReturnType<typeof setTimeout> | null = null;
  private _cardDownX = 0;
  private _cardDownY = 0;

  onCardDown(tube: { sampleId: string; tests: Enriched[] }, ev: PointerEvent): void {
    if (ev.button != null && ev.button !== 0) return;
    if ((ev.target as HTMLElement).closest('button')) return; // buttons keep their taps
    this._cardDownX = ev.clientX; this._cardDownY = ev.clientY;
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const W = 260;
    let x = r.right + 10;
    if (x + W > window.innerWidth - 8) x = r.left - W - 10;
    x = Math.max(8, Math.min(x, window.innerWidth - W - 8));
    const y = Math.max(8, Math.min(r.top, window.innerHeight - 260));
    const names = (tube.tests ?? [])
      .map(t => t.test?.name ?? (t as { name?: string }).name)
      .filter((n): n is string => !!n);
    this.clearCardPress();
    this.holdingPeekId.set(tube.sampleId);
    this._cardPressTimer = setTimeout(() => {
      this.holdingPeekId.set(null);
      this.cardPeekPos.set({ x, y });
      this.cardPeekTests.set(names);
      this.cardPeekId.set(tube.sampleId); // shows while held
    }, MyWorkComponent.CARD_HOLD_MS);
  }
  onCardMove(ev: PointerEvent): void {
    if (this._cardPressTimer
        && (Math.abs(ev.clientX - this._cardDownX) > 10 || Math.abs(ev.clientY - this._cardDownY) > 10)) {
      this.clearCardPress();
    }
  }
  onCardUp(): void { this.clearCardPress(); }

  /**
   * The card IS the primary action — "Open tube" / "Pick · view tests" buttons
   * were removed, so tapping anywhere on the card does what they did: claim it
   * from the service queue, or open it for entry in My Work. Delegate stops
   * propagation, and a completed long-press (hold-to-peek) is swallowed so a
   * peek never doubles as a tap.
   */
  onCardActivate(tube: { sampleId: string; deptName: string; barcode: string; tests: Enriched[]; assignedTo?: string | null; allDone?: boolean },
                 patientName: string, ev?: Event): void {
    if (this.cardPeekId() || this.holdingPeekId()) { this.clearCardPress(); return; }
    if (ev && (ev.target as HTMLElement).closest('button')) return;
    if (this.tab() === 'service_queue') {
      // Someone else's claimed tube isn't ours to pick up.
      if (tube.assignedTo && tube.assignedTo !== this.myUserId()) return;
      this.openClaim(tube, patientName);
      return;
    }
    if (tube.allDone) return;   // nothing left to enter
    this.pickTube(tube);
  }
  private clearCardPress(): void {
    if (this._cardPressTimer) { clearTimeout(this._cardPressTimer); this._cardPressTimer = null; }
    this.holdingPeekId.set(null);
    this.cardPeekId.set(null); // release hides the peek
  }

  // ── Claim-into-my-queue popup ─────────────────────────────
  // Picking a tube from the service queue first shows the tech WHAT tests
  // are on the tube, then claims the whole tube into "My Work" (the tech can
  // then open it any time — via the list, a typed id, or a scan — to fill,
  // save a draft, and come back). Scanning the tube stays available as the
  // verified-claim alternative.
  private readonly _claimTarget = signal<{
    sampleId: string; deptName: string; barcode: string; patientName: string; tests: Enriched[];
  } | null>(null);
  readonly claimTarget = this._claimTarget.asReadonly();
  private readonly _claiming = signal(false);
  readonly claiming = this._claiming.asReadonly();

  // Scanning the physical tube is required before a claim commits, so a tech
  // can't pick up the wrong sample. The scanner modal gates on the tube's
  // barcode and only fires onClaimScanned() on an exact match.
  private readonly _claimScanning = signal(false);
  readonly claimScanning = this._claimScanning.asReadonly();

  /** Display count where a PROFILE counts as ONE test. */
  testCount(tests: Array<{ packageTestId?: string | null }>): number { return logicalTestCount(tests); }

  openClaim(tube: { sampleId: string; deptName: string; barcode: string; tests: Enriched[] }, patientName: string) {
    this._claimTarget.set({ ...tube, patientName });
    // Skip the intermediate "Scan tube to claim" card — go straight to the
    // action: a direct claim when no scan is required (or the tube has no
    // barcode), otherwise straight to the scanner (the scan itself is the
    // verification; the card just added a click).
    if (this.allowNoScanClaim() || !tube.barcode) this.confirmClaim();
    else this.startClaimScan();
  }
  cancelClaim() { if (!this._claiming()) this._claimTarget.set(null); }

  /** Open the scan gate for the pending claim. Tubes with no printed barcode
   *  (legacy/seeder samples) can't be scan-verified, so they fall back to a
   *  direct claim. */
  startClaimScan() {
    const c = this._claimTarget();
    if (!c || this._claiming()) return;
    if (!c.barcode) { this.confirmClaim(); return; }
    this._claimScanning.set(true);
  }
  cancelClaimScan() { this._claimScanning.set(false); this._claimTarget.set(null); }
  /** Correct tube scanned — commit the claim. */
  onClaimScanned() { this._claimScanning.set(false); this.confirmClaim(); }

  /** Commit the claim — assigns every writable test on the tube to this tech
   *  and moves it into My Work. Reached only after a matching scan (or the
   *  barcode-less fallback above). */
  confirmClaim() {
    const c = this._claimTarget();
    if (!c || this._claiming()) return;
    this._claiming.set(true);
    // The barcode travels to the server so the scan is verified there too —
    // the client-side scanner gate alone would be spoofable.
    this.api.post(`/api/samples/${c.sampleId}/claim`, { barcode: c.barcode || null }).subscribe({
      next: () => {
        this._claiming.set(false);
        this._claimTarget.set(null);
        this.refreshAllCounts();
        // The tech is literally holding the tube they just claimed — go
        // straight into result entry instead of parking it in My Work and
        // demanding a second scan to open it (the claim scan already
        // verified the tube; the server remembers via scanVerifiedAt/By).
        this.router.navigate(['/lab/sample', c.sampleId], { state: { justScanned: true } });
      },
      error: e => { this._claiming.set(false); this.toasts.error(ApiError.from(e).message); }
    });
  }

  private enterJustScanned(t: OrderTest) {
    const sid = t.subOrder?.id;
    if (sid) this.router.navigate(['/lab/sample', sid], { state: { justScanned: true } });
    else this.router.navigate(['/lab/result', t.id], { state: { justScanned: true } });
  }

  // ── Supervisor delegation ─────────────────────────────
  // Tube-level: delegating hands EVERY writable test on the tube to the new
  // owner (the tube is the unit of work), not just the row that was clicked.
  // The UI gate (who sees the button) is visual-only for now; the backend
  // endpoint is open. Add role-based gating once permission infra lands.
  private readonly _delegateTests = signal<OrderTest[] | null>(null);
  readonly delegateTarget = computed(() => this._delegateTests()?.[0] ?? null);
  readonly delegateLabel = computed(() => {
    const l = this._delegateTests() ?? [];
    return l.length <= 1 ? (l[0]?.test?.name ?? 'Test') : `${l.length} tests on this tube`;
  });

  openDelegate(t: OrderTest | OrderTest[]) {
    const list = (Array.isArray(t) ? t : [t]).filter(x => x.status !== 'entered' && x.status !== 'validated');
    if (!list.length) { this.toasts.warning('Nothing to delegate — every test is already submitted.'); return; }
    this._delegateTests.set(list);
  }
  cancelDelegate() { this._delegateTests.set(null); }

  onDelegate(toUserId: string) {
    const list = this._delegateTests();
    if (!list?.length) return;
    let done = 0, failed = 0, lastError = '';
    const finish = () => {
      if (done + failed < list.length) return;
      this._delegateTests.set(null);
      if (failed) this.toasts.error(
        failed === list.length ? lastError
                               : `Delegated ${done} of ${list.length} — ${failed} failed: ${lastError}`);
      else this.toasts.success('Delegated — the new assignee must scan to pick up.');
      this.refresh();
      this.refreshAllCounts();
    };
    for (const t of list) {
      this.api.post(`/api/results/${t.id}/delegate`, { toUserId }).subscribe({
        next: () => { done++; finish(); },
        error: e => { failed++; lastError = ApiError.from(e).message; finish(); }
      });
    }
  }
}
