import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ToastService } from '../../../core/services/toast.service';
import { BarcodeScannerModalComponent } from '../../../shared/components/barcode-scanner/barcode-scanner-modal.component';
import { TatIndicatorComponent } from '../../../shared/components/tat-indicator/tat-indicator.component';
import { DelegateModalComponent } from './delegate-modal.component';
import { ReceiveSamplesComponent } from '../receive-samples/receive-samples.component';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { NumPadComponent } from '../../../shared/primitives/num-pad.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SkeletonComponent } from '../../../shared/primitives/skeleton.component';
import { TileComponent, TileTone } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { Department } from '../../../shared/models/tenant.model';
import { OrderTest } from '../../../shared/models/order.model';
import { KpiStripComponent } from '../../../shared/components/kpi-strip/kpi-strip.component';
import { WorkAreaPanelsComponent } from '../../../shared/workflow/work-area-panels.component';

const LAST_DEPT_KEY = 'pf-lms.my-work.last-dept-code';

type Tab = 'intake' | 'my_work' | 'service_queue' | 'rejected';
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
    AvatarComponent, NumPadComponent, ReceiveSamplesComponent, ScreenHeaderComponent, SelectComponent, SkeletonComponent, TileComponent, TouchButtonComponent, KpiStripComponent, WorkAreaPanelsComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-5 md:px-8 lg:px-10 pt-4 pb-3">

      <pf-kpi-strip screen="lab_my_work"></pf-kpi-strip>

      <!-- Actions dragged into the Lab work-area in /admin/process render here. -->
      <pf-work-area-panels menu="lab" />

      <pf-screen-header eyebrow="Lab workbench"
                        subtitle="Scan a barcode to jump straight to result entry, or pick from the queue below.">
        Lab <span class="text-gradient">my work</span>
        <div actions>
          <pf-touch-btn variant="secondary" size="md" (pressed)="refresh()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" icon-left>
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
              <path d="M21 3v5h-5"/>
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
              <path d="M3 21v-5h5"/>
            </svg>
            Refresh
          </pf-touch-btn>
        </div>
      </pf-screen-header>

      <!-- Counter filter pills — moved up here directly under the
           header so the counts read as page metadata, and the scan
           bar sits below as the primary CTA. -->
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
                 placeholder="Scan a barcode or type PF-XXXX-XXXXX…"
                 class="pf-scan__input"/>
          <button type="button"
                  class="pf-scan__manual press"
                  (click)="toggleManual()"
                  [attr.aria-expanded]="manualMode()"
                  aria-label="Toggle manual entry">
            @if (manualMode()) { Close manual } @else { Manual entry }
          </button>
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
        </div>
        <pf-touch-btn variant="primary" size="lg" (pressed)="scanSubmit()" [disabled]="!scan()">
          Open
          <span icon-right>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 12h14m-5-6 6 6-6 6"/>
            </svg>
          </span>
        </pf-touch-btn>
      </div>

      @if (manualMode()) {
        <pf-tile tone="default" padding="lg" class="block mb-5">
          <label class="text-[11px] font-mono uppercase tracking-[0.16em] mb-3 block"
                 style="color: var(--text-muted);">Manual barcode entry</label>

          <div class="seg-row">
            <span class="seg seg--locked">PF</span>
            <span class="seg-sep">·</span>
            <span class="seg seg--locked">{{ vendorCode() || '??' }}</span>
            <span class="seg-sep">·</span>
            <span class="seg seg--locked">{{ currentYear }}</span>
            <span class="seg-sep">·</span>
            <input class="seg seg--input"
                   inputmode="numeric"
                   pattern="[0-9]*"
                   maxlength="5"
                   placeholder="00000"
                   [ngModel]="seqValue()"
                   (ngModelChange)="onSeqChange($event)" />
            <span class="seg-sep">·</span>
            <span class="seg seg--locked seg--dept">{{ selectedDeptCode() || '—' }}</span>
          </div>

          <div class="manual-meta">
            <div class="dept-picker">
              <label class="text-[11px] font-mono uppercase tracking-[0.16em] mb-1.5 block"
                     style="color: var(--text-muted);">Department</label>
              <pf-select
                [options]="deptOptions()"
                [value]="selectedDeptCode()"
                placeholder="Select department"
                (valueChange)="onDeptChange($event)"></pf-select>
            </div>
            <div class="preview">
              <label class="text-[11px] font-mono uppercase tracking-[0.16em] mb-1.5 block"
                     style="color: var(--text-muted);">Preview</label>
              <div class="preview-code">{{ fullManualBarcode() }}</div>
            </div>
          </div>

          @if (isTouch()) {
            <div class="numpad-wrap">
              <pf-num-pad
                [value]="seqValue()"
                [allowDecimal]="false"
                [allowNegative]="false"
                [maxLength]="5"
                (valueChange)="onSeqChange($event)"></pf-num-pad>
            </div>
          }

          <div class="manual-actions">
            @if (seqValue().length > 0 && seqValue().length < 5) {
              <span class="seq-hint">{{ 5 - seqValue().length }} more digit{{ seqValue().length === 4 ? '' : 's' }}</span>
            }
            <pf-touch-btn size="md" variant="primary"
                          [disabled]="!canManualConfirm()"
                          (pressed)="submitManual()">
              Open
              <span icon-right aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
                </svg>
              </span>
            </pf-touch-btn>
          </div>
        </pf-tile>
      }

      <!-- 2-col layout: Lab Intake on the left, My Work / Queue tabs on
           the right. Same pattern as the Frontdesk landing splitter so
           the techs see the intake queue and their bench work side by
           side without tab-switching. Single drag handle in the middle. -->
      <div class="pf-mw-split" #mwSplit
           [class.pf-mw-split--dragging]="mwDragging()">

        <!-- LEFT: Lab Intake (always visible) — header hosts an inline
             scan bar: barcode icon, manual-typing input, camera shortcut,
             and a Receive button. Hits Enter or clicks Receive to intake.
             The camera button opens the same scanner the standalone
             /lab/receive page uses; on match it auto-intakes. -->
        <section class="pf-mw-pane" [style.flex-basis.%]="mwSplitPct()">
          <header class="pf-mw-pane__hdr pf-mw-pane__hdr--intake">
            <span class="pf-mw-pane__title">Lab Intake</span>
            <div class="pf-mw-scan">
              <svg class="pf-mw-scan__icon" width="14" height="14" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                   aria-hidden="true">
                <path d="M3 7V5a2 2 0 0 1 2-2h2"/>
                <path d="M17 3h2a2 2 0 0 1 2 2v2"/>
                <path d="M21 17v2a2 2 0 0 1-2 2h-2"/>
                <path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
                <path d="M7 8v8M11 8v8M15 8v8M19 8v3"/>
              </svg>
              <input type="text" class="pf-mw-scan__input"
                     placeholder="Scan or type PF-XXXX-XXXXX"
                     [value]="intakeScanInput()"
                     (input)="intakeScanInput.set($any($event.target).value)"
                     (keydown.enter)="intakeReceive()" />
              <button type="button" class="pf-mw-scan__cam press" (click)="openIntakeScanner()"
                      title="Scan with camera" aria-label="Scan with camera">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="7" width="18" height="13" rx="2"/>
                  <path d="M8 7 10 4h4l2 3"/>
                  <circle cx="12" cy="13" r="3.5"/>
                </svg>
              </button>
              <button type="button" class="pf-mw-scan__btn press"
                      [disabled]="!intakeScanInput().trim()"
                      (click)="intakeReceive()">Receive</button>
            </div>
          </header>
          <div class="pf-mw-pane__body">
            <pf-receive-samples #intakeRef [embedded]="true"></pf-receive-samples>
          </div>
        </section>

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

        <!-- RIGHT: tabbed My Work + Queue -->
        <section class="pf-mw-pane">
          <header class="pf-mw-pane__hdr pf-mw-pane__hdr--tabs">
            <div class="pf-mw-tabs" role="tablist" aria-label="Workbench tabs">
              <button type="button" role="tab" class="pf-mw-tab press"
                      [class.pf-mw-tab--on]="tab() === 'my_work'"
                      [attr.aria-selected]="tab() === 'my_work'"
                      (click)="setTab('my_work')">
                My Work
                <span class="pf-mw-tab__count">{{ countFor('my_work') }}</span>
              </button>
              <button type="button" role="tab" class="pf-mw-tab press"
                      [class.pf-mw-tab--on]="tab() === 'service_queue'"
                      [attr.aria-selected]="tab() === 'service_queue'"
                      (click)="setTab('service_queue')">
                Queue
                <span class="pf-mw-tab__count">{{ countFor('service_queue') }}</span>
              </button>
            </div>
            <p class="pf-mw-pane__meta">
              {{ rows().length }} items
              @if (countFor('rejected') > 0) { · {{ countFor('rejected') }} rejected }
            </p>
          </header>
          <div class="pf-mw-pane__body">
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
                {{ bucket.level }} · {{ bucket.items.length }}
              </h3>
            </div>

            <!-- Group by patient/order so a single patient with 3 tests is one
                 expandable card, not 3 floating cards across columns. -->
            <ul class="grid grid-cols-1 lg:grid-cols-2 gap-3">
              @for (g of patientGroups(bucket.items); track g.orderId) {
                <li>
                  <pf-tile [tone]="toneFor(bucket.level)" padding="md" class="block">
                    <button type="button" class="w-full flex items-center gap-3 cursor-pointer text-left"
                            (click)="toggleExpand(g.orderId)">
                      <pf-avatar [name]="g.patientName" [size]="40"></pf-avatar>
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                          <p class="text-[15px] font-semibold truncate" style="color: var(--text-primary);">{{ g.patientName }}</p>
                          <pf-tat-indicator [tatLevel]="g.level" [remainingMinutes]="g.remainingMin"/>
                          <span class="pf-grp-count">{{ g.items.length }} test<span [class.hidden]="g.items.length === 1">s</span></span>
                        </div>
                        <p class="text-[11.5px] font-mono mt-0.5" style="color: var(--text-tertiary);">
                          #{{ g.orderId.slice(0,8) }}
                          @for (lbl of g.testNames; track lbl) { <span class="ml-1">· {{ lbl }}</span> }
                        </p>
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
                          <li class="rounded-lg p-2.5 pf-tube-tile"
                              [class.pf-tube-tile--rejected]="tube.rejections.length > 0"
                              [class.pf-tube-tile--picking]="pickingTubeId() === tube.sampleId"
                              style="background: rgba(255,255,255,0.02); border: 1px solid var(--glass-border);">
                            <div class="flex items-center gap-2 mb-1.5">
                              <span class="text-[12.5px] font-semibold flex-1 truncate" style="color: var(--text-primary);">
                                {{ tube.deptName || 'Tube' }} · {{ tube.tests.length }} test{{ tube.tests.length === 1 ? '' : 's' }}
                              </span>
                              @if (tube.barcode) {
                                <span class="text-[10.5px] font-mono" style="color: var(--text-muted);">{{ tube.barcode }}</span>
                              }
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
                                          style="background: rgba(16, 185, 129, 0.15); color: #34d399;">✓</span>
                                  } @else if (t.status === 'entered') {
                                    <span class="px-1.5 py-0.5 text-[10px] font-medium rounded"
                                          style="background: rgba(168, 85, 247, 0.15); color: #c4b5fd;">⏳</span>
                                  } @else if (t.status === 're_entry') {
                                    <span class="px-1.5 py-0.5 text-[10px] font-medium rounded"
                                          style="background: rgba(239, 68, 68, 0.15); color: #fca5a5;">↻</span>
                                  }
                                </li>
                              }
                            </ul>
                            <div class="flex justify-end gap-2">
                              @switch (tab()) {
                                @case ('service_queue') {
                                  <button type="button" class="pf-scan-hint pf-scan-hint--btn press" (click)="pickTube(tube)">Pick · scan tube</button>
                                  <button type="button" class="pf-delegate-btn press" (click)="openDelegate(tube.tests[0])">Delegate</button>
                                }
                                @default {
                                  @if (tube.rejections.length > 0) {
                                    <pf-touch-btn variant="primary" size="sm" (pressed)="pickTube(tube)">Re-enter tube</pf-touch-btn>
                                  } @else if (tube.allDone) {
                                    <span class="px-2 py-0.5 text-[11px] font-medium rounded"
                                          style="background: rgba(16, 185, 129, 0.15); color: #34d399;">✓ All entered</span>
                                  } @else {
                                    <pf-touch-btn variant="primary" size="sm" (pressed)="pickTube(tube)">Open tube</pf-touch-btn>
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
                          <button type="button" class="pf-delegate-btn press" (click)="openDelegate(t)">
                            Delegate…
                          </button>
                        }
                        @case ('rejected') {
                          <pf-touch-btn variant="primary" size="sm" (pressed)="startPick(t)">Re-enter</pf-touch-btn>
                        }
                        @default {
                          @if (t.status === 'pending') {
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
          </div>
        </section>
      </div>
    </section>

    @if (scanTarget(); as t) {
      <pf-barcode-scanner-modal
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
        title="Scan any vial barcode"
        (matched)="onBarSearchMatched($event)"
        (cancelled)="closeBarSearchScanner()">
      </pf-barcode-scanner-modal>
    }

    @if (delegateTarget(); as t) {
      <pf-delegate-modal
        [testName]="t.test?.name ?? 'Test'"
        (chose)="onDelegate($event)"
        (cancelled)="cancelDelegate()">
      </pf-delegate-modal>
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
      color: #c4b5fd;
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
      background: rgba(0, 0, 0, 0.18);
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
      color: #f472b6;
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
      color: #a78bfa;
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
      color: #c4b5fd;
      border-color: var(--glass-border);
    }
    .pf-scan__manual[aria-expanded='true'] {
      color: #c4b5fd;
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
      color: #c4b5fd;
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
      color: #c4b5fd;
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
      color: #fca5a5;
      font-size: 11px;
      font-weight: 700;
      flex-shrink: 0;
    }
    .pf-tube-reject__title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #fca5a5;
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
  `]
})
export class MyWorkComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

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
  readonly counters = COUNTERS;

  private readonly _tab = signal<Tab>('my_work');
  readonly tab = this._tab.asReadonly();
  setTab(t: Tab) { this._tab.set(t); this.refresh(); }

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

  protected readonly manualMode = signal(false);
  protected readonly seqValue = signal('');
  protected readonly departments = signal<Department[]>([]);
  protected readonly selectedDeptCode = signal<string>('');
  protected readonly isTouch = signal<boolean>(
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  );
  readonly currentYear = new Date().getFullYear();

  readonly vendorCode = computed(() => this.tenantState.tenant()?.vendorCode ?? '');

  readonly deptOptions = computed<PfSelectOption<string>[]>(() =>
    this.departments().map(d => ({ value: d.code, label: `${d.code} · ${d.name}` }))
  );

  readonly fullManualBarcode = computed(() => {
    const v = this.vendorCode() || '??';
    const seq = (this.seqValue() || '').padStart(5, '0');
    const d = this.selectedDeptCode() || '——';
    return `PF-${v}-${this.currentYear}-${seq}-${d}`;
  });

  readonly canManualConfirm = computed(() =>
    this.seqValue().length === 5 &&
    !!this.selectedDeptCode() &&
    !!this.vendorCode()
  );

  toggleManual() {
    const next = !this.manualMode();
    this.manualMode.set(next);
    if (next) {
      this.tenantState.ensureLoaded();
      if (this.departments().length === 0) this.loadDepartments();
    }
  }

  onSeqChange(v: string) {
    this.seqValue.set((v ?? '').replace(/\D/g, '').slice(0, 5));
  }

  onDeptChange(code: string) {
    this.selectedDeptCode.set(code);
    try { localStorage.setItem(LAST_DEPT_KEY, code); } catch { /* ignore */ }
  }

  submitManual() {
    if (!this.canManualConfirm()) return;
    const code = this.fullManualBarcode();
    this.setScan(code);
    this.scanSubmit();
    this.seqValue.set('');
  }

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

  private readonly _counts = signal<Record<Tab, number>>({ intake: 0, my_work: 0, service_queue: 0, rejected: 0 });
  countFor(t: Tab): number { return this._counts()[t]; }

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
    items: Enriched[];
    testNames: string[];
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
      return {
        orderId,
        patientName: worst.subOrder?.order?.patient?.displayName ?? 'Patient',
        items: group,
        testNames: group.map(t => t.test?.name ?? 'Test').slice(0, 4),
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

  ngOnInit() { this.refresh(); this.refreshAllCounts(); }

  refresh() {
    // Intake tab embeds the ReceiveSamplesComponent which manages its own
    // data; nothing to fetch here.
    if (this._tab() === 'intake') { this._loading.set(false); return; }
    const url = this.endpointFor(this._tab());
    this._loading.set(true);
    this.api.get<OrderTest[]>(url).subscribe({
      next: l => { this._rows.set((l ?? []).filter(t => this.matchesTab(t, this._tab()))); this._loading.set(false); },
      error: () => this._loading.set(false)
    });
  }

  private refreshAllCounts() {
    for (const t of ['my_work', 'service_queue', 'rejected'] as Tab[]) {
      this.api.get<OrderTest[]>(this.endpointFor(t)).subscribe({
        next: l => {
          const count = (l ?? []).filter(x => this.matchesTab(x, t)).length;
          this._counts.update(c => ({ ...c, [t]: count }));
        }
      });
    }
  }

  private endpointFor(t: Tab): string {
    if (t === 'service_queue') return '/api/results/service-queue';
    return '/api/results/my-work';
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

  /** Try to resolve a scanned barcode/OrderTest id → jump to result entry. */
  scanSubmit() {
    const q = this._scan().trim();
    if (!q) return;
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
      this.toasts.warning('No match for scan');
      return;
    }
    const scannedBarcode = hit.subOrder?.barcode ?? q;
    this.api.post<OrderTest>(`/api/results/${hit.id}/claim-by-scan`, { barcode: scannedBarcode }).subscribe({
      next: () => { this._scan.set(''); this.enterJustScanned(hit); },
      error: e => this.toasts.error(e.message ?? 'Scan rejected')
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

  startPick(t: OrderTest) {
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
      error: e => this.toasts.error(e.message ?? 'Scan rejected')
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
  tubesIn(items: Enriched[]): Array<{
    sampleId: string;
    deptName: string;
    barcode: string;
    tests: Enriched[];
    allDone: boolean;
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
      // Surface every rejected test's reason so the tile can show a
      // banner explaining WHY the pathologist sent it back. Without this
      // the tech sees only the ↻ icon and has to dig into the test to
      // find out what to fix.
      const rejections = tests
        .filter(x => x.status === 're_entry' && (x.rejectionReason ?? '').trim().length > 0)
        .map(x => ({ testName: x.test?.name ?? 'Test', reason: x.rejectionReason ?? '' }));
      return { sampleId, deptName, barcode, tests, allDone, rejections };
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

  private enterJustScanned(t: OrderTest) {
    const sid = t.subOrder?.id;
    if (sid) this.router.navigate(['/lab/sample', sid], { state: { justScanned: true } });
    else this.router.navigate(['/lab/result', t.id], { state: { justScanned: true } });
  }

  // ── Supervisor delegation ─────────────────────────────
  // Thin wrapper over POST /api/results/:id/delegate. The UI gate (who
  // sees the button) is visual-only for now; the backend endpoint is
  // open. Add role-based gating once permission infra lands.
  private readonly _delegateTarget = signal<OrderTest | null>(null);
  readonly delegateTarget = this._delegateTarget.asReadonly();

  openDelegate(t: OrderTest) { this._delegateTarget.set(t); }
  cancelDelegate() { this._delegateTarget.set(null); }

  onDelegate(toUserId: string) {
    const t = this._delegateTarget();
    if (!t) return;
    this.api.post(`/api/results/${t.id}/delegate`, { toUserId }).subscribe({
      next: () => {
        this._delegateTarget.set(null);
        this.toasts.success('Delegated — the new assignee must scan to pick up.');
        this.refresh();
      },
      error: e => this.toasts.error(e.message ?? 'Delegate failed')
    });
  }
}
