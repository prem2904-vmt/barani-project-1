import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { TrendTest } from '../../../shared/utils/trend-chart';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { DialogService } from '../../../core/services/dialog.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { ToastService } from '../../../core/services/toast.service';
import { OrderTest } from '../../../shared/models/order.model';
import { ApiError } from '../../../shared/models/api-response.model';
import { OrderTestComment } from '../../../shared/models/comment.model';
import { CommentThreadComponent } from '../../../shared/components/comment-thread/comment-thread.component';
import { LoadingLogoComponent } from '../../../shared/components/loading-logo/loading-logo.component';
import { EditResultDialogComponent } from '../../../shared/components/edit-result-dialog/edit-result-dialog.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { AuthService } from '../../../core/auth/auth.service';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ChipComponent } from '../../../shared/primitives/chip.component';
import { firstValueFrom } from 'rxjs';
import { formatPatientInfo } from '../../../shared/models/patient.model';
import { formatRange, normalizeSex, selectReferenceRange, type RangeLike } from '../../../shared/utils/reference-range';
import { flagTone, rangeWithUnit, savedFlagOf, type SavedFlag } from '../../../shared/utils/result-flag';
import { parseParametersBlob, readParameters } from '../../../shared/utils/test-parameters';
import { ZoomTargetDirective } from '../../../core/navigation/zoom.directive';
import { ZoomTransitionService } from '../../../core/navigation/zoom-transition';

interface ResultSnapshot {
  values?: Record<string, unknown>;
  /** mw's saved per-value verdicts ({ value, flag, range, unit, … }). */
  flagged?: Record<string, SavedFlag>;
  note?: string;
  flags?: { critical: boolean; notifications: string[] };
}

type Flag = 'normal' | 'abnormal' | 'critical';

interface ParamDef {
  name: string;
  title: string;
  type?: string;
  unit?: string;
  options?: string[];
  criticalLow?: number;
  criticalHigh?: number;
  referenceRanges?: Array<RangeLike & { criticalLow?: number | null; criticalHigh?: number | null }>;
}

interface ValueRow {
  name: string;
  title: string;
  value: unknown;
  numeric?: number;
  unit?: string;
  range?: string;
  min?: number;
  max?: number;
  critLow?: number;
  critHigh?: number;
  isNumeric: boolean;
  flag: Flag;
  /** True when the parameter has a reference (range or critical bounds) —
   *  only then does a "Normal" verdict mean anything. Referenceless
   *  categorical values are shown as recorded, not judged. */
  hasRef: boolean;
}

@Component({
  selector: 'pf-validate-result',
  standalone: true,
  imports: [FormsModule, DatePipe, AvatarComponent, ChipComponent, CommentThreadComponent, LoadingLogoComponent, EditResultDialogComponent, SelectComponent, ZoomTargetDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-page">
      <!-- Slim header — identity only; context lives in the rail. -->
      <header class="pf-page__header px-4 md:px-8 lg:px-10 pt-4">
        <div class="pf-head">
          @if (navBack.showBack()) {
            <button type="button" class="pf-hdr-back shrink-0 inline-flex items-center justify-center" (click)="navBack.back()" aria-label="Go back">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
            </button>
          }
          <div class="pf-head__id">
            <h1 class="pf-head__title">{{ headTitle() }}</h1>
            <p class="pf-head__sub">{{ subtitleText() }}</p>
          </div>
        </div>
      </header>

      @if (editDialogOpen() && editOrderId(); as oid) {
        <pf-edit-result-dialog
          [orderId]="oid"
          title="Send results back for correction"
          (edited)="onEdited()"
          (closed)="editDialogOpen.set(false)">
        </pf-edit-result-dialog>
      }

      <div class="pf-page__body px-4 md:px-8 lg:px-10 pt-2 pb-32">
        @if ((loading() && !selected()) || zoom.holding()) {
          <div class="pf-empty-block flex justify-center py-12" [pfZoomTarget]="zoomKeys()">
            <pf-loading-logo size="xl" color="purple" [showDna]="true"
                             [showText]="true" text="Loading validation…"></pf-loading-logo>
          </div>
        }

        @if (!loading() && !selected() && !zoom.holding()) {
          <div class="pf-empty-block" [pfZoomTarget]="zoomKeys()">Order test not found in the validation queue.</div>
        }

        @if (zoom.holding() ? null : selected(); as t) {
          <div class="pf-cockpit">

            <!-- ══ Results column — every test on this tube, full quality ══ -->
            <main class="pf-cockpit__main">
              @for (st of sampleTests(); track st.id; let sti = $index) {
                @let c = countsFor(st);
                <section class="pf-vt" [pfZoomTarget]="sti === 0 ? zoomKeys() : null" [id]="'vt-' + st.id" [attr.data-outcome]="outcomeOf(st)">
                  <header class="pf-vt__hdr">
                    <div class="pf-vt__id">
                      <h2 class="pf-vt__name">{{ st.test?.name ?? 'Test' }}</h2>
                      <p class="pf-vt__meta">
                        @if (isCultureFor(st)) {
                          Culture &amp; sensitivity
                        } @else {
                          {{ c.total }} parameters
                          @if (c.critical) { <span class="pf-flagtag" data-flag="critical">{{ c.critical }} critical</span> }
                          @if (c.abnormal) { <span class="pf-flagtag" data-flag="abnormal">{{ c.abnormal }} abnormal</span> }
                          @if (!c.abnormal && !c.critical && c.total && hasRefRows(st)) { <span class="pf-flagtag" data-flag="normal">all within range</span> }
                        }
                      </p>
                    </div>
                    <span class="grow"></span>
                    @switch (outcomeOf(st)) {
                      @case ('validated') {
                        <span class="pf-vt__badge" data-outcome="validated">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                          Validated
                        </span>
                      }
                      @case ('rejected') {
                        <span class="pf-vt__badge" data-outcome="rejected">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                          Rejected
                        </span>
                      }
                      @case ('validating') { <span class="pf-vt__badge" data-outcome="validating">Working…</span> }
                      @default {
                        @if (sampleTests().length > 1) {
                          <button type="button" class="pf-vt__act pf-vt__act--reject press" [disabled]="saving()" (click)="rejectTest(st)">Reject</button>
                          <button type="button" class="pf-vt__act pf-vt__act--approve press" [disabled]="saving()" (click)="approveTest(st)">Approve</button>
                        }
                      }
                    }
                  </header>

                  @if (st.rejectionReason) {
                    <!-- Previously sent back — repeat WHY so the validator can
                         confirm the correction actually addressed it. -->
                    <div class="pf-reject-banner pf-vt__banner">
                      <span class="pf-reject-banner__icon" aria-hidden="true">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>
                      </span>
                      <p class="pf-reject-banner__text"><strong>Sent back:</strong> {{ st.rejectionReason }}</p>
                    </div>
                  }

                  @if (isCultureFor(st)) {
                    <!-- Culture signs out on the Culture case page (owner). -->
                    <button type="button" class="nd-row pf-vt__culturelink press" (click)="openCultureBench(st)"
                            [attr.aria-label]="'Review ' + (st.test?.name ?? 'culture') + ' on the culture bench'">
                      <span class="nd-row__name">Culture: review and sign out on the bench</span>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
                    </button>
                  } @else if (valueRowsFor(st).length === 0) {
                    <div class="pf-empty-block">No values recorded.</div>
                  } @else {
                    <div class="pf-plist">
                      <div class="pf-plist__head" aria-hidden="true">
                        <span>Parameter</span><span>Result</span><span>Within range</span><span>Reference</span><span>Flag</span><span></span>
                      </div>
                      @for (r of visibleRowsFor(st); track r.name) {
                        <div class="pf-prow" [attr.data-flag]="r.flag">
                          <div class="pf-prow__row" role="button" tabindex="0"
                               [class.pf-prow__row--static]="isEditingTest(st)"
                               (click)="!isEditingTest(st) && openDetail(r)"
                               (keydown.enter)="!isEditingTest(st) && openDetail(r)">
                            <span class="pf-prow__name">{{ r.title }}</span>
                            <span class="pf-prow__val">
                              @if (isEditingTest(st)) {
                                <input class="pf-prow__editin" [value]="editVal(r.name)"
                                       (input)="setEditVal(r.name, $any($event.target).value)"
                                       (click)="$event.stopPropagation()"
                                       [attr.aria-label]="'New value for ' + r.title" />
                                @if (r.unit) { <em>{{ r.unit }}</em> }
                              } @else {
                                {{ r.value ?? '—' }} @if (r.unit) { <em>{{ r.unit }}</em> }
                              }
                            </span>
                            <span class="pf-prow__bar">
                              @if (r.isNumeric && (r.min !== undefined || r.critLow !== undefined)) {
                                <div class="pf-rangebar pf-rangebar--mini">
                                  <div class="pf-rangebar__track">
                                    @for (z of zonesFor(r); track z.label) {
                                      <span class="pf-rangebar__zone" [attr.data-tone]="z.tone" [style.flex]="z.weight"></span>
                                    }
                                  </div>
                                  <span class="pf-rangebar__pin" [style.left.%]="pinFor(r)" [attr.data-flag]="r.flag"></span>
                                </div>
                              } @else { <span class="pf-prow__dash">—</span> }
                            </span>
                            <span class="pf-prow__ref">{{ r.range ?? '—' }}</span>
                            <span class="pf-prow__flag">
                              @if (r.flag !== 'normal' || r.hasRef) {
                                <span class="pf-vcard__chip" [attr.data-flag]="r.flag" [attr.title]="flagExplanation(r) || null">
                                  <span class="pf-vcard__chip-dot"></span>
                                  {{ flagLabel(r.flag) }}
                                </span>
                              } @else { <span class="pf-prow__dash">—</span> }
                            </span>
                            <button type="button" class="pf-prow__cbtn press"
                                    [class.pf-prow__cbtn--live]="selected()?.id === st.id && hasOpenComment(r.name)"
                                    (click)="rowComment(st, r.name); $event.stopPropagation()"
                                    [attr.aria-label]="'Discuss ' + r.title + ' with the bench'">
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                            </button>
                          </div>
                          @if (openParamComment() === r.name && selected()?.id === st.id) {
                            <div class="pf-prow__thread" (click)="$event.stopPropagation()">
                              <pf-comment-thread
                                [comments]="commentsFor(r.name)"
                                currentRole="validator"
                                [composeLabel]="'Comment on ' + r.title"
                                (add)="addParameterComment(r.name, $event.body, $event.type)"
                                (reply)="replyToParameter(r.name, $event.parentId, $event.body)">
                              </pf-comment-thread>
                            </div>
                          }
                        </div>
                      }
                      @if (hiddenNormals(st) > 0) {
                        <button type="button" class="pf-plist__more press" (click)="toggleNormals(st)">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                          Show {{ hiddenNormals(st) }} normal {{ hiddenNormals(st) === 1 ? 'parameter' : 'parameters' }}
                        </button>
                      } @else if (canCollapseNormals(st)) {
                        <button type="button" class="pf-plist__more press" (click)="toggleNormals(st)">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>
                          Hide normal parameters
                        </button>
                      }
                    </div>
                  }
                </section>
              }
            </main>

            <!-- ══ Context rail — always in view while reviewing ══ -->
            <aside class="pf-cockpit__rail">
              <div class="pf-rail-card">
                <div class="pf-railpat">
                  <pf-avatar [name]="t.subOrder?.order?.patient?.displayName ?? '—'" [size]="44"></pf-avatar>
                  <div class="pf-railpat__id">
                    <p class="pf-railpat__name">{{ formatPatient(t.subOrder?.order?.patient) }}</p>
                    <p class="pf-railpat__meta">{{ t.test?.department?.name ?? '—' }} · {{ sampleLabel() }}</p>
                  </div>
                  @if (hasSampleCritical()) { <pf-chip tone="rose" size="sm">CRITICAL</pf-chip> }
                </div>
                <p class="pf-railpat__entered">Entered {{ t.resultedAt ? (t.resultedAt | date:'MMM d, h:mm a') : '—' }}</p>
              </div>

              @if (sampleTests().length > 1) {
                <div class="pf-rail-card">
                  <p class="pf-rail-lbl">This tube · {{ sampleProgress().done }}/{{ sampleProgress().total }} validated</p>
                  <ul class="pf-checklist">
                    @for (st of sampleTests(); track st.id) {
                      <li>
                        <button type="button" class="pf-checklist__item press" [attr.data-outcome]="outcomeOf(st)"
                                [class.pf-checklist__item--focus]="selected()?.id === st.id"
                                (click)="scrollToTest(st)">
                          <span class="pf-checklist__ic" aria-hidden="true">
                            @switch (outcomeOf(st)) {
                              @case ('validated') { <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> }
                              @case ('rejected') { <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg> }
                              @default { <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg> }
                            }
                          </span>
                          <span class="pf-checklist__name">{{ st.test?.name ?? 'Test' }}</span>
                          <span class="pf-checklist__hint">
                            @if (isCultureFor(st)) { C&amp;S }
                            @else {
                              @let cc = countsFor(st);
                              @if (cc.critical) { {{ cc.critical }} crit }
                              @else if (cc.abnormal) { {{ cc.abnormal }} abn }
                              @else { — }
                            }
                          </span>
                        </button>
                      </li>
                    }
                  </ul>
                </div>
              }

              <div class="pf-rail-card">
                <p class="pf-rail-lbl">Bench conversation@if (sampleTests().length > 1) { · {{ t.test?.name }} }</p>
                <pf-comment-thread
                  [comments]="commentsFor(null)"
                  currentRole="validator"
                  (add)="addOverallComment($event.body, $event.type)"
                  (reply)="replyToOverall($event.parentId, $event.body)">
                </pf-comment-thread>
              </div>

              <div class="pf-rail-card">
                <label class="pf-rail-lbl" for="pf-clinical-note">Clinical comment · printed on the report</label>
                <textarea id="pf-clinical-note" class="pf-comment__input"
                          [value]="comment()"
                          (input)="onComment($event)"
                          placeholder="Notes for the report or the follow-up team…"></textarea>
              </div>

              @if (trendEligible().length > 0) {
                <div class="pf-rail-card">
                  <label class="pf-trendrow">
                    <input type="checkbox" [checked]="trendogramOn()" (change)="toggleTrendogram()" />
                    <span>Trendogram in the report</span>
                  </label>
                  @if (trendogramOn()) {
                    <pf-select class="pf-trendsel" [options]="trendDurations"
                               [value]="trendogramDuration()" (valueChange)="setTrendDuration($event)"></pf-select>
                  }
                </div>
              }
            </aside>
          </div>
        }
      </div>

      <!-- Sticky verdict bar — one primary action, secondary in More. -->
      @if (selected()) {
        <footer class="pf-stickybar">
          <div class="pf-stickybar__inner">
            @if (editing()) {
              <span class="pf-stickybar__meta">
                <span class="pf-stickybar__dot" data-state="edit"></span>
                Editing · unsaved changes
              </span>
              <div class="flex-1"></div>
              <button type="button" class="pf-btn pf-btn--ghost press" (click)="cancelEdit()">Cancel</button>
              <button type="button" class="pf-btn pf-btn--primary press" [disabled]="saving()" (click)="saveEdits()">
                {{ saving() ? 'Saving…' : 'Save changes' }}
              </button>
            } @else {
              <span class="pf-stickybar__meta">
                @if (sampleTests().length > 1) {
                  @if (hasSampleCritical()) {
                    <span class="pf-stickybar__dot" data-state="critical"></span>
                    <b>Critical</b> in this sample · validating notifies the referring doctor
                  } @else {
                    <span class="pf-stickybar__dot" data-state="ok"></span>
                    {{ sampleProgress().done }} validated · {{ sampleProgress().rej }} rejected · {{ pendingSampleTests().length }} pending
                  }
                } @else if (hasCritical()) {
                  <span class="pf-stickybar__dot" data-state="critical"></span>
                  <b>Critical</b> · validating notifies the referring doctor
                } @else {
                  <span class="pf-stickybar__dot" data-state="ok"></span>
                  Ready to validate
                }
              </span>
              <div class="flex-1"></div>

              @if (hasMoreActions()) {
                <div class="pf-more">
                  <button type="button" class="pf-btn pf-btn--ghost press" (click)="moreOpen.set(!moreOpen())"
                          aria-haspopup="menu" [attr.aria-expanded]="moreOpen()">
                    More
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>
                  </button>
                  @if (moreOpen()) {
                    <div class="pf-more__bd" (click)="moreOpen.set(false)"></div>
                    <div class="pf-more__menu" role="menu">
                      @if (sampleTests().length <= 1) {
                        <button type="button" role="menuitem" class="pf-more__item press" (click)="moreOpen.set(false); reassign()">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3l4 4-4 4"/><path d="M20 7H4"/><path d="M8 21l-4-4 4-4"/><path d="M4 17h16"/></svg>
                          Reassign to another pathologist
                        </button>
                        @if (!isCulture()) {
                          <button type="button" role="menuitem" class="pf-more__item press" (click)="moreOpen.set(false); startEdit()">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                            Edit values myself
                          </button>
                        }
                      }
                      @if (canEditResult() && editOrderId()) {
                        <button type="button" role="menuitem" class="pf-more__item press" (click)="moreOpen.set(false); editDialogOpen.set(true)">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>
                          Send back for correction
                        </button>
                      }
                    </div>
                  }
                </div>
              }

              @if (sampleTests().length > 1) {
                <button type="button"
                        class="pf-btn pf-btn--icony"
                        [class.pf-btn--primary]="!hasSampleCritical()"
                        [class.pf-btn--danger]="hasSampleCritical()"
                        [disabled]="saving() || pendingSampleTests().length === 0"
                        (click)="validateAllRemaining()">
                  <svg class="pf-btn__ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                  <span class="pf-btn-label">{{ saving() ? 'Validating…' : 'Validate all remaining (' + pendingSampleTests().length + ')' }}</span>
                </button>
              } @else {
                <button type="button" class="pf-btn pf-btn--ghost pf-btn--icony press" (click)="reject()" aria-label="Reject">
                  <svg class="pf-btn__ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/></svg>
                  <span class="pf-btn-label">Reject</span>
                </button>
                <button type="button"
                        class="pf-btn pf-btn--icony"
                        [class.pf-btn--primary]="!hasCritical()"
                        [class.pf-btn--danger]="hasCritical()"
                        [disabled]="saving() || isCulture() || valueRows().length === 0"
                        (click)="validate()"
                        [attr.aria-label]="hasCritical() ? 'Validate and notify' : 'Validate'">
                  <svg class="pf-btn__ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                  <span class="pf-btn-label">{{ saving() ? 'Validating…' : (hasCritical() ? 'Validate · notify' : 'Validate') }}</span>
                </button>
              }
            }
          </div>
        </footer>
      }

      <!-- Detail drawer -->
      @if (detailRow(); as r) {
        <div class="pf-drawer-bd" (click)="closeDetail()"></div>
        <aside class="pf-drawer" role="dialog" aria-modal="true">
          <header class="pf-drawer__hdr">
            <div class="min-w-0 flex-1">
              <h2 class="pf-drawer__title">{{ r.title }}</h2>
            </div>
            @if (r.flag !== 'normal' || r.hasRef) {
              <span class="pf-vcard__chip pf-vcard__chip--lg" [attr.data-flag]="r.flag">
                <span class="pf-vcard__chip-dot"></span>
                {{ flagLabel(r.flag) }}
              </span>
            }
            <button type="button" class="pf-drawer__close press" (click)="closeDetail()" aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
              </svg>
            </button>
          </header>

          <div class="pf-drawer__body">
            <div class="pf-drawer__value">
              <span class="pf-drawer__num">{{ r.value ?? '—' }}</span>
              @if (r.unit) { <span class="pf-drawer__unit">{{ r.unit }}</span> }
            </div>

            @if (r.isNumeric && (r.min !== undefined || r.critLow !== undefined)) {
              <div class="pf-rangebar pf-rangebar--lg">
                <div class="pf-rangebar__track">
                  @for (z of zonesFor(r); track z.label) {
                    <span class="pf-rangebar__zone" [attr.data-tone]="z.tone" [style.flex]="z.weight"></span>
                  }
                </div>
                <span class="pf-rangebar__pin" [style.left.%]="pinFor(r)" [attr.data-flag]="r.flag"></span>
                <div class="pf-rangebar__labels">
                  @for (tick of ticksFor(r); track tick.label) {
                    <span class="pf-rangebar__tick" [style.left.%]="tick.pos">
                      <span class="pf-rangebar__tick-v">{{ tick.label }}</span>
                    </span>
                  }
                </div>
              </div>
            }

            <section class="pf-drawer__sec">
              <dl class="pf-drawer__meta">
                <div>
                  <dt>Normal range</dt>
                  <dd>{{ r.range ?? '—' }}</dd>
                </div>
                <div>
                  <dt>Critical low</dt>
                  <dd>{{ r.critLow ?? '—' }}</dd>
                </div>
                <div>
                  <dt>Critical high</dt>
                  <dd>{{ r.critHigh ?? '—' }}</dd>
                </div>
                <div>
                  <dt>Units</dt>
                  <dd>{{ r.unit ?? '—' }}</dd>
                </div>
              </dl>
            </section>

            @if (r.flag !== 'normal') {
              <section class="pf-drawer__sec pf-drawer__sec--alert" [attr.data-flag]="r.flag">
                <p class="pf-drawer__why">{{ flagExplanation(r) }}</p>
              </section>
            }
          </div>
        </aside>
      }
    </section>
    `,
  styles: [`
    /* ── WORK page: non-scroll app layout ─────────────────────
       The PAGE itself never scrolls. :host fills the shell's main
       area; the screen header is fixed (flex:0 0 auto); the SCROLL
       happens inside .pf-page__body. The verdict bar is a
       position:fixed overlay floating above the body. */
    :host { display: block; height: 100%; overflow: hidden; }
    .pf-page { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
    .pf-page__header { flex: 0 0 auto; }
    .pf-page__body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; padding-top: 4px; -webkit-overflow-scrolling: touch; }

    /* ── Compact page header ─────────────────────────────────── */
    .pf-head { display: flex; align-items: center; gap: 10px; padding: 6px 0 10px; }
    .pf-head__id { min-width: 0; flex: 1; }
    .pf-head__title { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; color: var(--text-primary); line-height: 1.15; }
    @media (min-width: 768px) { .pf-head__title { font-size: 26px; } }
    .pf-head__sub { margin: 2px 0 0; font-size: 12.5px; color: var(--text-secondary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .pf-hdr-back { width: 38px; height: 38px; margin-left: -8px; border-radius: 11px; color: var(--text-primary); background: transparent; border: 0; cursor: pointer; -webkit-tap-highlight-color: transparent; transition: background .15s ease, transform .08s ease; }
    .pf-hdr-back:active { transform: scale(0.9); background: var(--glass-bg, rgba(255,255,255,0.06)); }
    @media (hover: hover) { .pf-hdr-back:hover { background: var(--glass-bg, rgba(255,255,255,0.06)); } }

    .pf-empty-block { padding: 40px 0; text-align: center; font-size: 13px; color: var(--text-tertiary); }

    /* ── Cockpit: results + always-visible context rail ──────── */
    .pf-cockpit { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
    @media (min-width: 1100px) { .pf-cockpit { grid-template-columns: minmax(0, 1fr) 344px; gap: 20px; } }
    .pf-cockpit__main { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
    .pf-cockpit__rail { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    @media (min-width: 1100px) { .pf-cockpit__rail { position: sticky; top: 4px; } }

    /* ── Test section ────────────────────────────────────────── */
    .pf-vt__culturelink { margin: 4px 16px 16px; width: calc(100% - 32px); cursor: pointer; }
    .pf-vt { border-radius: 16px; border: 1px solid var(--glass-border); background: var(--glass-bg); overflow: hidden; }
    .pf-vt[data-outcome='validated'] { border-color: rgba(168, 85, 247, 0.35); }
    .pf-vt[data-outcome='rejected']  { border-color: rgba(239, 68, 68, 0.32); }
    .pf-vt__hdr { display: flex; align-items: center; gap: 10px; padding: 13px 16px 11px; flex-wrap: wrap; }
    .pf-vt__id { min-width: 0; }
    .pf-vt__name { margin: 0; font-size: 15.5px; font-weight: 700; letter-spacing: -0.01em; color: var(--text-primary); }
    .pf-vt__meta { margin: 3px 0 0; font-size: 11px; font-family: 'JetBrains Mono', ui-monospace, monospace; color: var(--text-tertiary); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .pf-flagtag { display: inline-flex; align-items: center; padding: 1px 7px; border-radius: 9999px; font-size: 10px; font-weight: 700; border: 1px solid transparent; }
    .pf-flagtag[data-flag='normal']   { color: var(--text-tertiary); border-color: var(--glass-border); }
    .pf-flagtag[data-flag='abnormal'] { color: #d97706; border-color: rgba(245, 158, 11, 0.32); }
    .pf-flagtag[data-flag='critical'] { color: #dc2626; border-color: rgba(239, 68, 68, 0.35); }
    :root.dark .pf-flagtag[data-flag='abnormal'] { color: #fbbf24; }
    :root.dark .pf-flagtag[data-flag='critical'] { color: #fca5a5; }

    .pf-vt__badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 9999px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; font-family: 'JetBrains Mono', ui-monospace, monospace; border: 1px solid transparent; }
    .pf-vt__badge[data-outcome='validated']  { color: var(--violet-text, #c4b5fd); border-color: rgba(168, 85, 247, 0.35); background: rgba(168, 85, 247, 0.08); }
    .pf-vt__badge[data-outcome='rejected']   { color: #dc2626; border-color: rgba(239, 68, 68, 0.32); background: rgba(239, 68, 68, 0.08); }
    .pf-vt__badge[data-outcome='validating'] { color: var(--text-tertiary); border-color: var(--glass-border); }
    :root.dark .pf-vt__badge[data-outcome='rejected']  { color: #fca5a5; }

    .pf-vt__act { height: 30px; padding: 0 14px; border-radius: 9999px; font-size: 12.5px; font-weight: 600; cursor: pointer; border: 1px solid transparent; background: transparent; transition: background .15s, color .15s, border-color .15s; }
    .pf-vt__act:disabled { opacity: 0.5; cursor: not-allowed; }
    .pf-vt__act--approve { color: var(--violet-text, #c4b5fd); border-color: rgba(168, 85, 247, 0.45); }
    .pf-vt__act--reject  { color: var(--text-tertiary); }
    @media (hover: hover) {
      .pf-vt__act--approve:hover:not(:disabled) { background: rgba(168, 85, 247, 0.14); }
      .pf-vt__act--reject:hover:not(:disabled)  { background: rgba(239, 68, 68, 0.1); color: var(--red-text, #f87171); }
    }

    .pf-vt__banner { margin: 0 16px 10px; }

    /* ── Sent-back banner ────────────────────────────────────── */
    .pf-reject-banner { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 12px;
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.14), rgba(239, 68, 68, 0.04)); border: 1px solid rgba(239, 68, 68, 0.34); }
    .pf-reject-banner__icon { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 9999px;
      background: rgba(239, 68, 68, 0.22); color: var(--red-text); flex-shrink: 0; }
    .pf-reject-banner__text { margin: 0; font-size: 13px; line-height: 1.4; color: var(--text-secondary); }
    .pf-reject-banner__text strong { color: var(--red-text); margin-right: 4px; }

    /* ── Culture meta strip ──────────────────────────────────── */
    /* Report-row checkbox — checked = prints on the PDF; review always shows. */
    .pf-rh { width: 14px; height: 14px; accent-color: #8b5cf6; flex-shrink: 0; cursor: pointer; }

    /* ── Parameter list — one view, attention-first ──────────── */
    .pf-plist { border-top: 1px solid var(--border-muted); }
    .pf-plist__head, .pf-prow__row {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(110px, 1.1fr) minmax(0, 1fr) 96px 36px;
      gap: 12px; align-items: center; padding: 10px 16px;
    }
    .pf-plist__head { padding: 9px 16px; background: rgba(0, 0, 0, 0.1); border-bottom: 1px solid var(--border-muted); }
    .pf-plist__head > span { font-size: 10.5px; font-family: 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-muted); }
    .pf-prow + .pf-prow { border-top: 1px solid var(--border-muted); }
    .pf-prow__row { cursor: pointer; transition: background .15s; color: var(--text-primary); font-size: 13px; }
    .pf-prow__row--static { cursor: default; }
    .pf-prow__row:focus-visible { outline: 2px solid rgba(168, 85, 247, 0.6); outline-offset: -2px; border-radius: 8px; }
    @media (hover: hover) { .pf-prow__row:not(.pf-prow__row--static):hover { background: var(--glass-bg-hover); } }
    .pf-prow__name { font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
    .pf-prow__val { font-variant-numeric: tabular-nums; font-weight: 600; display: inline-flex; align-items: baseline; gap: 4px; min-width: 0; }
    .pf-prow__val em { font-style: normal; color: var(--text-tertiary); font-size: 11.5px; }
    .pf-prow__ref { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; color: var(--text-tertiary); min-width: 0; overflow-wrap: anywhere; }
    .pf-prow__dash { color: var(--text-muted); }
    .pf-prow__editin { width: 100%; max-width: 120px; padding: 6px 9px; border-radius: 8px; font-size: 13px; font-weight: 600;
      font-variant-numeric: tabular-nums; background: var(--bg-card-solid); border: 1px solid rgba(168, 85, 247, 0.45); color: var(--text-primary); outline: none; }
    .pf-prow__editin:focus { box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.18); }

    .pf-prow__cbtn { width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; border-radius: 9999px;
      border: 1px solid transparent; background: transparent; color: var(--text-muted); cursor: pointer; position: relative; transition: color .15s, background .15s; }
    @media (hover: hover) { .pf-prow__cbtn:hover { color: var(--text-primary); background: var(--glass-bg-hover); } }
    .pf-prow__cbtn--live { color: var(--violet-text, #c4b5fd); }
    .pf-prow__cbtn--live::after { content: ''; position: absolute; top: 3px; right: 3px; width: 7px; height: 7px; border-radius: 9999px; background: #a855f7; }

    .pf-prow__thread { padding: 12px 16px 14px 32px; background: rgba(96, 165, 250, 0.04); border-top: 1px solid var(--glass-border); }

    .pf-plist__more { width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 16px;
      border: none; border-top: 1px solid var(--border-muted); background: transparent; color: var(--text-tertiary);
      font-size: 12px; font-weight: 600; cursor: pointer; transition: color .15s, background .15s; }
    @media (hover: hover) { .pf-plist__more:hover { color: var(--text-primary); background: var(--glass-bg-hover); } }

    /* ── Flag chips (shared with drawer) ─────────────────────── */
    .pf-vcard__chip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 9999px; font-size: 10px;
      font-family: 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 0.1em; text-transform: uppercase; font-weight: 700;
      background: transparent; border: 1px solid transparent; }
    .pf-vcard__chip--lg { font-size: 11px; padding: 5px 12px; }
    .pf-vcard__chip-dot { width: 6px; height: 6px; border-radius: 9999px; background: currentColor; }
    .pf-vcard__chip[data-flag='normal']   { color: var(--text-tertiary); border-color: var(--glass-border); }
    .pf-vcard__chip[data-flag='abnormal'] { color: #d97706; border-color: rgba(245, 158, 11, 0.32); }
    .pf-vcard__chip[data-flag='critical'] { color: #dc2626; border-color: rgba(239, 68, 68, 0.35); }
    :root.dark .pf-vcard__chip[data-flag='abnormal'] { color: #fbbf24; }
    :root.dark .pf-vcard__chip[data-flag='critical'] { color: #fca5a5; }

    /* ── Range bar ───────────────────────────────────────────── */
    .pf-rangebar { position: relative; width: 100%; padding: 6px 0 0; }
    .pf-rangebar__track { display: flex; height: 8px; border-radius: 9999px; overflow: hidden; background: var(--glass-bg); border: 1px solid var(--glass-border); }
    .pf-rangebar__zone { display: block; height: 100%; background: transparent; }
    .pf-rangebar__zone[data-tone='normal'] { background: var(--gradient-primary); opacity: 0.82; }
    .pf-rangebar__pin { position: absolute; top: 4px; transform: translateX(-50%); width: 14px; height: 14px; pointer-events: none; }
    .pf-rangebar__pin::before { content: ''; position: absolute; inset: 0; border-radius: 9999px; background: var(--text-primary); border: 2px solid var(--bg-card-solid); }
    .pf-rangebar__pin[data-flag='critical']::before { background: #dc2626; }
    .pf-rangebar__pin[data-flag='abnormal']::before { background: #d97706; }
    :root.dark .pf-rangebar__pin[data-flag='critical']::before { background: #ef4444; }
    :root.dark .pf-rangebar__pin[data-flag='abnormal']::before { background: #f59e0b; }
    .pf-rangebar--mini { padding: 2px 0 0; min-width: 100px; }
    .pf-rangebar--mini .pf-rangebar__track { height: 6px; }
    .pf-rangebar--mini .pf-rangebar__pin   { width: 12px; height: 12px; top: 1px; }
    .pf-rangebar--lg { padding: 18px 0 0; }
    .pf-rangebar--lg .pf-rangebar__track { height: 12px; }
    .pf-rangebar--lg .pf-rangebar__pin   { width: 20px; height: 20px; top: 16px; }
    .pf-rangebar--lg .pf-rangebar__pin::before { border-width: 3px; }
    .pf-rangebar__labels { position: relative; margin-top: 10px; height: 14px; }
    .pf-rangebar__tick { position: absolute; transform: translateX(-50%); font-size: 10.5px; font-family: 'JetBrains Mono', ui-monospace, monospace; color: var(--text-muted); }

    /* ── Context rail ────────────────────────────────────────── */
    .pf-rail-card { padding: 13px 14px; border-radius: 14px; background: var(--glass-bg); border: 1px solid var(--glass-border); }
    .pf-rail-lbl { display: block; margin: 0 0 8px; font-size: 10.5px; font-family: 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-muted); }
    .pf-railpat { display: flex; align-items: center; gap: 12px; }
    .pf-railpat__id { min-width: 0; flex: 1; }
    .pf-railpat__name { margin: 0; font-size: 14.5px; font-weight: 700; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pf-railpat__meta { margin: 2px 0 0; font-size: 11px; font-family: 'JetBrains Mono', ui-monospace, monospace; color: var(--text-tertiary); }
    .pf-railpat__entered { margin: 10px 0 0; font-size: 11.5px; color: var(--text-tertiary); }

    .pf-checklist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .pf-checklist__item { width: 100%; display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; align-items: center; gap: 8px;
      padding: 8px 10px; border-radius: 10px; border: 1px solid transparent; background: transparent; cursor: pointer;
      text-align: left; color: var(--text-secondary); font-size: 13px; transition: background .15s, border-color .15s, color .15s; }
    @media (hover: hover) { .pf-checklist__item:hover { background: var(--glass-bg-hover); color: var(--text-primary); } }
    .pf-checklist__item--focus { border-color: rgba(168, 85, 247, 0.4); background: rgba(168, 85, 247, 0.07); color: var(--text-primary); }
    .pf-checklist__ic { display: inline-flex; align-items: center; justify-content: center; color: var(--text-muted); }
    .pf-checklist__item[data-outcome='validated'] .pf-checklist__ic { color: var(--violet-text, #c4b5fd); }
    .pf-checklist__item[data-outcome='rejected'] .pf-checklist__ic  { color: #dc2626; }
    :root.dark .pf-checklist__item[data-outcome='rejected'] .pf-checklist__ic  { color: #fca5a5; }
    .pf-checklist__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .pf-checklist__hint { font-size: 10.5px; font-family: 'JetBrains Mono', ui-monospace, monospace; color: var(--text-muted); }

    .pf-comment__input { width: 100%; min-height: 76px; padding: 10px 12px; border-radius: 10px; background: var(--bg-card-solid);
      border: 1px solid var(--glass-border); color: var(--text-primary); font-size: 13px; outline: none; resize: vertical; font-family: inherit; }
    .pf-comment__input:focus { border-color: rgba(168, 85, 247, 0.5); box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.18); }

    .pf-trendrow { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--text-secondary); cursor: pointer; }
    .pf-trendrow input { accent-color: #a855f7; width: 15px; height: 15px; }
    .pf-trendsel { display: block; margin-top: 10px; }

    /* ── Sticky verdict bar ──────────────────────────────────── */
    .pf-stickybar { position: fixed; left: 0; right: 0; bottom: calc(5.75rem + env(safe-area-inset-bottom, 0px)); z-index: 30; padding: 0 16px; pointer-events: none; }
    @media (min-width: 1280px) { .pf-stickybar { bottom: 1rem; } }
    .pf-stickybar__inner { pointer-events: auto; display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 16px;
      background: var(--bg-card-solid); border: 1px solid var(--glass-border); box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(22px); -webkit-backdrop-filter: blur(22px); max-width: 1400px; margin: 0 auto; }
    @media (max-width: 640px) { .pf-stickybar__inner { flex-wrap: wrap; } }
    .pf-stickybar__meta { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-secondary); }
    .pf-stickybar__dot { width: 7px; height: 7px; border-radius: 9999px; }
    .pf-stickybar__dot[data-state='ok']       { background: #a855f7; }
    .pf-stickybar__dot[data-state='critical'] { background: #dc2626; animation: pf-pulse 1.8s infinite; }
    .pf-stickybar__dot[data-state='edit']     { background: #8b5cf6; }
    :root.dark .pf-stickybar__dot[data-state='critical'] { background: #ef4444; }
    :root.dark .pf-stickybar__dot[data-state='edit']     { background: #a78bfa; }
    @keyframes pf-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

    .pf-btn { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px; border-radius: 9999px; font-size: 13px;
      font-weight: 600; border: 1px solid transparent; cursor: pointer; white-space: nowrap; transition: background .15s, color .15s, box-shadow .25s, transform 80ms; }
    .pf-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .pf-btn--ghost { background: transparent; color: var(--text-secondary); }
    .pf-btn--ghost:hover:not(:disabled) { background: var(--glass-bg-hover); color: var(--text-primary); }
    .pf-btn--primary { background: var(--gradient-primary); color: #ffffff; box-shadow: 0 6px 18px rgba(124, 58, 237, 0.4); }
    .pf-btn--primary:hover:not(:disabled) { box-shadow: 0 10px 26px rgba(124, 58, 237, 0.55); transform: translateY(-1px); }
    .pf-btn--danger { background: linear-gradient(135deg, #ef4444, #db2777); color: #ffffff; box-shadow: 0 6px 18px rgba(239, 68, 68, 0.4); }
    .pf-btn--danger:hover:not(:disabled) { box-shadow: 0 10px 26px rgba(239, 68, 68, 0.55); }
    .pf-btn--icony .pf-btn__ic { display: none; }

    /* ── More menu (secondary actions) ───────────────────────── */
    .pf-more { position: relative; }
    .pf-more__bd { position: fixed; inset: 0; z-index: 1; }
    .pf-more__menu { position: absolute; bottom: calc(100% + 10px); right: 0; z-index: 2; min-width: 250px; padding: 6px;
      border-radius: 14px; background: var(--bg-card-solid); border: 1px solid var(--glass-border);
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45); animation: pf-menu-in 0.16s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
    .pf-more__item { width: 100%; display: flex; align-items: center; gap: 10px; padding: 9px 11px; border-radius: 9px; border: none;
      background: transparent; color: var(--text-secondary); font-size: 13px; font-weight: 600; text-align: left; cursor: pointer;
      transition: background .15s, color .15s; }
    .pf-more__item:hover { background: var(--glass-bg-hover); color: var(--text-primary); }
    .pf-more__item svg { flex-shrink: 0; color: var(--text-tertiary); }
    @keyframes pf-menu-in { from { transform: translateY(6px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

    /* ── Detail drawer ───────────────────────────────────────── */
    .pf-drawer-bd { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55); backdrop-filter: blur(6px); z-index: 44; animation: pf-fade 0.2s ease both; }
    .pf-drawer { position: fixed; right: 0; top: var(--navbar-height, 4rem); bottom: 0; width: min(100%, 520px); background: var(--bg-card-solid);
      border-left: 1px solid var(--glass-border); box-shadow: -12px 0 48px rgba(0, 0, 0, 0.5); z-index: 45; display: flex; flex-direction: column;
      animation: pf-drawer-in 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
    .pf-drawer__hdr { display: flex; align-items: center; gap: 12px; padding: 16px; border-bottom: 1px solid var(--border-muted); }
    .pf-drawer__title { margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.02em; color: var(--text-primary); }
    .pf-drawer__close { width: 36px; height: 36px; border-radius: 9999px; background: var(--glass-bg); border: 1px solid var(--glass-border);
      color: var(--text-secondary); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
    .pf-drawer__body { flex: 1; min-height: 0; overflow-y: auto; padding: 18px; }
    .pf-drawer__value { display: flex; align-items: baseline; gap: 10px; padding: 20px 22px; border-radius: 18px; background: var(--glass-bg);
      border: 1px solid var(--glass-border); margin-bottom: 8px; }
    .pf-drawer__num { font-size: 46px; font-weight: 800; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; color: var(--text-primary); line-height: 1; }
    .pf-drawer__unit { font-size: 16px; color: var(--text-secondary); font-family: 'JetBrains Mono', ui-monospace, monospace; }
    .pf-drawer__sec { margin-top: 20px; }
    .pf-drawer__meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; }
    .pf-drawer__meta > div { display: flex; flex-direction: column; gap: 2px; }
    .pf-drawer__meta dt { font-size: 10.5px; font-family: 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-muted); margin: 0; }
    .pf-drawer__meta dd { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); font-variant-numeric: tabular-nums; }
    .pf-drawer__sec--alert { padding: 14px; border-radius: 14px; background: var(--glass-bg); border: 1px solid var(--glass-border); }
    .pf-drawer__sec--alert[data-flag='abnormal'] { border-color: rgba(245, 158, 11, 0.4); }
    .pf-drawer__sec--alert[data-flag='critical'] { border-color: rgba(239, 68, 68, 0.45); }
    .pf-drawer__why { margin: 0; font-size: 13px; color: var(--text-primary); line-height: 1.5; }
    @keyframes pf-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes pf-drawer-in { from { transform: translateX(20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

    /* ── Phone (<=640px) ─────────────────────────────────────── */
    @media (max-width: 640px) {
      :host .pf-comment__input { font-size: 16px; }
      :host .pf-head__sub { display: none; }
      :host .pf-btn--icony .pf-btn-label { display: none; }
      :host .pf-btn--icony .pf-btn__ic { display: inline-block; }
      :host .pf-btn--icony { width: 44px; min-width: 44px; height: 44px; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
      :host .pf-page__body { padding-bottom: calc(var(--tab-nav-total-height) + 150px); }
      :host .pf-railpat { flex-wrap: wrap; }
      :host .pf-drawer { top: auto; bottom: 0; left: 0; right: 0; width: 100%; max-height: 88dvh; border-left: none;
        border-top: 1px solid var(--glass-border); border-radius: 18px 18px 0 0; animation: pf-sheet-in 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
      :host .pf-drawer__body { padding-bottom: calc(18px + env(safe-area-inset-bottom, 0px)); }
      :host .pf-drawer__meta { grid-template-columns: 1fr; }
      :host .pf-stickybar__meta { width: 100%; }
    }
    @keyframes pf-sheet-in { from { transform: translateY(24px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

    /* Parameter rows stack on narrow screens (grid-areas, no h-scroll). */
    @media (max-width: 767px) {
      .pf-plist__head { display: none; }
      .pf-plist__head, .pf-prow__row {
        grid-template-columns: minmax(0, 1fr) auto;
        grid-template-areas:
          'name  cbtn'
          'value flag'
          'bar   bar'
          'ref   ref';
        gap: 5px 12px;
      }
      .pf-prow__name { grid-area: name; }
      .pf-prow__val  { grid-area: value; }
      .pf-prow__bar  { grid-area: bar; }
      .pf-prow__ref  { grid-area: ref; }
      .pf-prow__flag { grid-area: flag; justify-self: end; }
      .pf-prow__cbtn { grid-area: cbtn; justify-self: end; }
    }

    /* ── Touch sizing (coarse pointer) ───────────────────────── */
    @media (pointer: coarse) {
      :host .pf-btn { min-height: 44px; }
      :host .pf-vt__act { min-height: 40px; }
      :host .pf-prow__cbtn { width: 38px; height: 38px; }
      :host .pf-drawer__close { width: 44px; height: 44px; }
      :host .pf-more__item { min-height: 44px; }
    }

    /* Touch devices: neutralize sticky :hover states after a tap. */
    @media (hover: none) {
      :host .pf-btn--ghost:hover:not(:disabled) { background: transparent; color: var(--text-secondary); }
      :host .pf-more__item:hover { background: transparent; color: var(--text-secondary); }
    }

    /* ── Capacitor native: fixed chrome clears the notch ─────── */
    :host-context(html.cap-native) .pf-drawer { top: calc(var(--navbar-height, 4rem) + env(safe-area-inset-top, 0px)); }
    @media (max-width: 640px) {
      :host-context(html.cap-native) .pf-drawer { top: auto; }
      :host-context(html.cap-native) .pf-drawer__body { padding-bottom: calc(18px + env(safe-area-inset-bottom, 0px)); }
    }
`]
})
export class ValidateResultComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthService);

  // ── Post-result edit ──────────────────────────────────
  // edit_result: Lab Technician, Pathologist, Lab Admin — never front desk.
  readonly canEditResult = computed(() => this.auth.hasPermission('edit_result'));
  readonly editDialogOpen = signal(false);
  /** The dialog works per ORDER — take it off the loaded test's sample. */
  readonly editOrderId = computed(() =>
    this.selected()?.subOrder?.orderId ?? this.selected()?.subOrder?.order?.id ?? null);

  /** Re-opened work leaves the validation queue — reload what this screen
   *  fetches so the (now empty) state is honest. */
  onEdited() {
    this.editDialogOpen.set(false);
    this.ngOnInit();
  }

  // ── Trendogram: add serial-result trend charts to this order's report ──
  readonly trendEligible = signal<TrendTest[]>([]);
  readonly trendogramOn = signal(false);
  readonly trendogramDuration = signal('5');
  private trendPatientId: string | null = null;

  constructor() {
    effect(() => {
      const pid = this.selected()?.subOrder?.order?.patient?.id ?? null;
      if (pid && pid !== this.trendPatientId) {
        this.trendPatientId = pid;
        this.api.get<{ tests: TrendTest[] }>(`/api/patients/${pid}/lab-trends`).subscribe({
          next: r => this.trendEligible.set(r?.tests ?? []),
          error: () => this.trendEligible.set([]),
        });
      }
    });
  }

  toggleTrendogram() { this.trendogramOn.set(!this.trendogramOn()); this.saveTrendogram(); }
  setTrendDuration(d: string) { this.trendogramDuration.set(d); if (this.trendogramOn()) this.saveTrendogram(); }
  private saveTrendogram() {
    const oid = this.selected()?.subOrder?.order?.id;
    if (!oid) return;
    const body = this.trendogramOn()
      ? { enabled: true, duration: this.trendogramDuration(), chartType: 'line',
          charts: this.trendEligible()
            .map(t => ({ testId: t.testId, parameter: t.parameters[0]?.parameter ?? '' }))
            .filter(c => !!c.parameter) }
      : {};
    this.api.patch(`/api/orders/${oid}/trendogram`, body).subscribe({
      next: () => this.toasts.success(this.trendogramOn() ? 'Trendogram will be added to the report' : 'Trendogram removed'),
      error: () => this.toasts.error('Could not update trendogram'),
    });
  }
  private readonly dialog = inject(DialogService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly navBack = inject(NavBackService);
  protected readonly formatPatient = formatPatientInfo;

  private readonly _id = signal<string | null>(null);
  // Validator ↔ tech conversation. Loaded whenever a new OrderTest
  // is selected; passed into <pf-comment-thread> instances at the top
  // of the screen (overall) and inside each parameter row (per-param).
  private readonly _comments = signal<OrderTestComment[]>([]);
  readonly comments = this._comments.asReadonly();
  // Which parameter row currently has its comment thread open (only
  // one at a time so the table stays compact).
  private readonly _openParamComment = signal<string | null>(null);
  readonly openParamComment = this._openParamComment.asReadonly();
  toggleParamComment(name: string) {
    this._openParamComment.set(this._openParamComment() === name ? null : name);
  }

  commentsFor(parameterName: string | null = null): OrderTestComment[] {
    return this._comments().filter(c =>
      (parameterName === null && !c.parameterName) || c.parameterName === parameterName
    );
  }
  hasOpenComment(parameterName: string): boolean {
    return this._comments().some(c =>
      c.parameterName === parameterName && !c.isResolved
    );
  }

  private async loadComments() {
    const t = this._selected();
    if (!t) return;
    try {
      const list = await firstValueFrom(this.api.get<OrderTestComment[]>(`/api/results/${t.id}/comments`));
      this._comments.set(list ?? []);
    } catch { /* non-fatal */ }
  }

  async addOverallComment(body: string, type: 'observation' | 'correction') {
    await this.postComment(null, null, body, type);
  }
  async replyToOverall(parentId: string, body: string) {
    await this.postComment(null, parentId, body, 'correction');
  }
  async addParameterComment(paramName: string, body: string, type: 'observation' | 'correction') {
    await this.postComment(paramName, null, body, type);
  }
  async replyToParameter(paramName: string, parentId: string, body: string) {
    await this.postComment(paramName, parentId, body, 'correction');
  }

  private async postComment(
    parameterName: string | null,
    parentId: string | null,
    body: string,
    commentType: 'observation' | 'correction'
  ) {
    const t = this._selected();
    if (!t) return;
    try {
      await firstValueFrom(this.api.post<OrderTestComment>(
        `/api/results/${t.id}/comments`,
        { parameterName, parentId, commentType, body }
      ));
      await this.loadComments();
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    }
  }

  private readonly _selected = signal<OrderTest | null>(null);
  private readonly _comment = signal('');
  private readonly _loading = signal(false);
  private readonly _saving = signal(false);
  private readonly _editing = signal(false);
  private readonly _edits = signal<Record<string, unknown>>({});
  private readonly _detailRow = signal<ValueRow | null>(null);

  readonly selected = this._selected.asReadonly();
  /** List → detail zoom (core/navigation/zoom.directive): the pending row
   *  answers to the order-test id or its tube's sample id. */
  protected readonly zoom = inject(ZoomTransitionService);
  readonly zoomKeys = computed(() => [this._id(), this._selected()?.id, this._selected()?.subOrder?.id]);
  readonly comment = this._comment.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly editing = this._editing.asReadonly();
  readonly detailRow = this._detailRow.asReadonly();

  // ── Sample-level validation (all tests on one tube reviewed together) ──
  /** The full validation queue, kept so we can show every sibling test of the
   *  focused sample without re-fetching. */
  private readonly _queue = signal<OrderTest[]>([]);
  /** Per-test outcome as the pathologist works through the sample. */
  private readonly _outcome = signal<Record<string, 'pending' | 'validating' | 'validated' | 'rejected'>>({});
  /** Tests whose normal rows are shown (attention-first collapse). */
  private readonly _shownNormals = signal<Set<string>>(new Set());

  /** Stable key identifying the tube/sample a test belongs to. */
  private sampleKey(t: OrderTest | null | undefined): string {
    if (!t) return '';
    return t.subOrder?.id
      ?? `${t.subOrder?.orderId ?? t.subOrder?.order?.id ?? ''}|${t.test?.department?.id ?? ''}`;
  }

  /** Every queued test on the same tube as the focused test (self as fallback). */
  readonly sampleTests = computed<OrderTest[]>(() => {
    const sel = this._selected();
    if (!sel) return [];
    const key = this.sampleKey(sel);
    const sibs = this._queue().filter(t => this.sampleKey(t) === key);
    return sibs.length ? sibs : [sel];
  });

  outcomeOf(t: OrderTest): 'pending' | 'validating' | 'validated' | 'rejected' {
    return this._outcome()[t.id] ?? 'pending';
  }
  showsNormals(t: OrderTest): boolean { return this._shownNormals().has(t.id); }
  toggleNormals(t: OrderTest) {
    this._shownNormals.update(s => { const n = new Set(s); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; });
  }
  /** Focus a test so the detailed review / edit / comments below reflect it. */
  focusTest(t: OrderTest) { this._selected.set(t); void this.loadComments(); }

  /** Sample header helpers. */
  readonly sampleLabel = computed(() => {
    const s = this._selected()?.subOrder;
    return s?.barcode ?? s?.id?.slice(0, 8) ?? 'Sample';
  });
  readonly sampleDept = computed(() => this._selected()?.test?.department?.name ?? '—');
  readonly pendingSampleTests = computed(() => this.sampleTests().filter(t => this.outcomeOf(t) === 'pending' && !this.isCultureFor(t)));
  readonly sampleProgress = computed(() => {
    const all = this.sampleTests();
    const done = all.filter(t => this.outcomeOf(t) === 'validated').length;
    const rej = all.filter(t => this.outcomeOf(t) === 'rejected').length;
    return { done, rej, total: all.length };
  });
  readonly hasSampleCritical = computed(() => this.sampleTests().some(t => this.countsFor(t).critical > 0));

  // ── Cockpit helpers ────────────────────────────────────────
  readonly moreOpen = signal(false);
  readonly hasMoreActions = computed(() =>
    this.sampleTests().length <= 1 || !!(this.canEditResult() && this.editOrderId()));

  /** Attention-first: flagged rows always visible; normals collapse behind
   *  the expander. Editing shows everything — any value may need fixing. */
  visibleRowsFor(t: OrderTest): ValueRow[] {
    const rows = this.valueRowsFor(t);
    if (this.isEditingTest(t) || this.showsNormals(t)) return rows;
    const flagged = rows.filter(r => r.flag !== 'normal');
    return flagged.length ? flagged : rows;
  }
  /** Any row with a real reference — gates the "all within range" tag. */
  hasRefRows(t: OrderTest): boolean { return this.valueRowsFor(t).some(r => r.hasRef); }
  hiddenNormals(t: OrderTest): number {
    return this.valueRowsFor(t).length - this.visibleRowsFor(t).length;
  }
  canCollapseNormals(t: OrderTest): boolean {
    if (!this.showsNormals(t) || this.isEditingTest(t)) return false;
    const rows = this.valueRowsFor(t);
    return rows.some(r => r.flag !== 'normal') && rows.some(r => r.flag === 'normal');
  }

  isEditingTest(t: OrderTest): boolean { return this.editing() && this._selected()?.id === t.id; }
  editVal(name: string): string {
    const v = this._edits()[name];
    return v == null ? '' : String(v);
  }
  setEditVal(name: string, v: string) { this._edits.update(e => ({ ...e, [name]: v })); }

  /** Rail checklist → jump to (and focus) that test's section. */
  scrollToTest(t: OrderTest) {
    this.focusTest(t);
    document.getElementById('vt-' + t.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  /** A row's comment affordance follows focus: discussing a sibling test's
   *  parameter first makes that test the conversation context. */
  rowComment(t: OrderTest, paramName: string) {
    if (this._selected()?.id !== t.id) this.focusTest(t);
    this.toggleParamComment(paramName);
  }

  readonly trendDurations: PfSelectOption[] = [
    { value: '5', label: 'Last 5 results' },
    { value: '10', label: 'Last 10 results' },
    { value: '3m', label: 'Last 3 months' },
    { value: '6m', label: 'Last 6 months' },
    { value: 'all', label: 'All history' },
  ];

  approveTest(t: OrderTest) {
    if (this.outcomeOf(t) !== 'pending') return;
    this._outcome.update(m => ({ ...m, [t.id]: 'validating' }));
    this.api.post<OrderTest>(`/api/validation/${t.id}/validate`, { note: null }).subscribe({
      next: () => {
        this._outcome.update(m => ({ ...m, [t.id]: 'validated' }));
        this.toasts.success(`${t.test?.name ?? 'Test'} validated`);
        this.finishIfSampleDone();
      },
      error: e => {
        this._outcome.update(m => ({ ...m, [t.id]: 'pending' }));
        this.toasts.error(ApiError.from(e).message);
      }
    });
  }

  async rejectTest(t: OrderTest) {
    if (this.outcomeOf(t) !== 'pending') return;
    const reason = await this.dialog.prompt({
      title: 'Reject result?',
      message: `Reject "${t.test?.name}". The lab tech will be notified to re-enter it.`,
      placeholder: 'Reason for rejection…',
      multiline: true, required: true, tone: 'danger', confirmLabel: 'Reject result'
    });
    if (!reason) return;
    this.api.post<OrderTest>(`/api/validation/${t.id}/reject`, { reason, note: null }).subscribe({
      next: () => {
        this._outcome.update(m => ({ ...m, [t.id]: 'rejected' }));
        this.toasts.success('Rejected — lab tech notified');
        this.finishIfSampleDone();
      },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }

  /** Bulk-validate every still-pending test in the sample, sequentially. */
  async validateAllRemaining() {
    const pending = this.pendingSampleTests();
    if (pending.length === 0) return;
    this._saving.set(true);
    let ok = 0; const failed: string[] = [];
    for (const t of pending) {
      this._outcome.update(m => ({ ...m, [t.id]: 'validating' }));
      try {
        await firstValueFrom(this.api.post<OrderTest>(`/api/validation/${t.id}/validate`, { note: null }));
        this._outcome.update(m => ({ ...m, [t.id]: 'validated' }));
        ok++;
      } catch (e) {
        this._outcome.update(m => ({ ...m, [t.id]: 'pending' }));
        failed.push(t.test?.name ?? 'Test');
      }
    }
    this._saving.set(false);
    if (failed.length === 0) this.toasts.success(`Validated ${ok} test${ok === 1 ? '' : 's'}`);
    else this.toasts.warning(`Validated ${ok}; ${failed.length} failed: ${failed.join(', ')}`);
    this.finishIfSampleDone();
  }

  /** When no test on the sample is pending, return to the queue. */
  private finishIfSampleDone() {
    if (this.pendingSampleTests().length === 0) setTimeout(() => this.back(), 600);
  }

  readonly headTitle = computed(() => {
    if (this.sampleTests().length > 1) return `Sample ${this.sampleLabel()}`;
    return this._selected()?.test?.name ?? 'Validate';
  });
  readonly subtitleText = computed(() => {
    const t = this._selected();
    if (!t) return 'Review the entered result.';
    const name = t.subOrder?.order?.patient?.displayName ?? '—';
    const dept = t.test?.department?.name ?? '—';
    const n = this.sampleTests().length;
    return n > 1 ? `${name} · ${dept} · ${n} tests on this tube` : `${name} · ${dept} · ${this.sampleLabel()}`;
  });

  private snapshotFor(t: OrderTest | null): ResultSnapshot | null {
    const raw = t?.currentResult;
    if (!raw) return null;
    try { return JSON.parse(raw) as ResultSnapshot; } catch { return null; }
  }
  readonly snapshot = computed<ResultSnapshot | null>(() => this.snapshotFor(this._selected()));

  readonly valueRows = computed<ValueRow[]>(() => this.valueRowsFor(this._selected()));

  /** Parameter rows for ANY test in the sample (not just the focused one).
   *  The FLAG and printed range are the ones mw saved with the result
   *  (snapshot `flagged` map) — the pathologist signs off exactly what will
   *  print. The band below only draws the range bar: picked for THIS
   *  patient's sex/age by the shared resolver (never `[0]`), with the band's
   *  own criticals ahead of the parameter pair — the same band mw flagged with. */
  valueRowsFor(t: OrderTest | null): ValueRow[] {
    const snap = this.snapshotFor(t);
    if (!t?.test?.parameters || !snap?.values) return [];
    const params = readParameters(parseParametersBlob(t.test.parameters)) as unknown as ParamDef[];
    if (params.length === 0) return [];

    const patient = t.subOrder?.order?.patient;
    const sex = normalizeSex(patient?.sex);
    const ageYears = typeof patient?.age === 'number' ? patient.age : null;

    return params.map(p => {
      const v = snap.values![p.name];
      const n = Number(v);
      const isNum = !Number.isNaN(n) && v !== null && v !== undefined && v !== '';
      const r = selectReferenceRange(p.referenceRanges ?? [], sex, ageYears);
      const critLow = r?.criticalLow ?? p.criticalLow ?? undefined;
      const critHigh = r?.criticalHigh ?? p.criticalHigh ?? undefined;
      const saved = savedFlagOf(snap, p.name);
      const unit = (saved?.unit ?? p.unit) || undefined;
      const rangeText = saved ? (saved.range ?? null) : (r?.reportText?.trim() || formatRange(r));
      return {
        name: p.name,
        title: p.title,
        value: v ?? '—',
        numeric: isNum ? n : undefined,
        unit,
        range: rangeWithUnit(rangeText, unit),
        min: r?.min ?? undefined,
        max: r?.max ?? undefined,
        critLow,
        critHigh,
        isNumeric: isNum || (p.type === 'numeric' || p.type === 'numeric_with_range'),
        flag: flagTone(saved?.flag),
        hasRef: !!rangeText || critLow != null || critHigh != null
      };
    });
  }

  countsFor(t: OrderTest | null) {
    const rows = this.valueRowsFor(t);
    return {
      total: rows.length,
      normal: rows.filter(r => r.flag === 'normal').length,
      abnormal: rows.filter(r => r.flag === 'abnormal').length,
      critical: rows.filter(r => r.flag === 'critical').length
    };
  }
  readonly counts = computed(() => this.countsFor(this._selected()));

  readonly hasCritical = computed(() => this.counts().critical > 0);

  // ── Microbiology Culture & Sensitivity ─────────────────────────────
  /** A structured culture test — shown here only as a link: it is reviewed
   *  and signed out on the Culture case page (owner). */
  /** Culture tests are reviewed + signed out on the Culture case page. */
  openCultureBench(t: OrderTest) { void this.router.navigate(['/lab/culture', t.id]); }
  isCultureFor(t: OrderTest | null): boolean {
    const raw = t?.test?.parameters;
    if (!raw) return false;
    try { return (JSON.parse(raw) as { microFormat?: string }).microFormat === 'culture_sensitivity'; }
    catch { return false; }
  }
  readonly isCulture = computed<boolean>(() => this.isCultureFor(this._selected()));

  // ── Range-bar zone computation ─────────────────────────────
  /** Produce zones (critical-low / low / normal / high / critical-high) with proportional widths. */
  zonesFor(r: ValueRow): Array<{ label: string; tone: string; weight: number }> {
    // Establish bar's min/max extent. Use critical bounds if present, else extend normal range by 40% each side.
    const normalMin = r.min ?? r.critLow ?? 0;
    const normalMax = r.max ?? r.critHigh ?? normalMin + 1;
    const range = Math.max(1, normalMax - normalMin);
    const barMin = r.critLow  ?? (normalMin - range * 0.4);
    const barMax = r.critHigh ?? (normalMax + range * 0.4);

    const zones: Array<{ label: string; tone: string; from: number; to: number }> = [];
    if (r.critLow !== undefined) zones.push({ label: 'crit-lo', tone: 'critical-low',  from: barMin, to: r.critLow });
    if (r.min     !== undefined) zones.push({ label: 'low',     tone: 'low',           from: r.critLow ?? barMin, to: r.min });
    zones.push({ label: 'normal', tone: 'normal', from: r.min ?? barMin, to: r.max ?? barMax });
    if (r.max     !== undefined) zones.push({ label: 'high',    tone: 'high',          from: r.max, to: r.critHigh ?? barMax });
    if (r.critHigh !== undefined) zones.push({ label: 'crit-hi', tone: 'critical-high', from: r.critHigh, to: barMax });

    const total = barMax - barMin;
    return zones.map(z => ({ label: z.label, tone: z.tone, weight: Math.max(0.01, (z.to - z.from) / total) }));
  }

  pinFor(r: ValueRow): number {
    if (r.numeric === undefined) return 50;
    const normalMin = r.min ?? r.critLow ?? 0;
    const normalMax = r.max ?? r.critHigh ?? normalMin + 1;
    const range = Math.max(1, normalMax - normalMin);
    const barMin = r.critLow  ?? (normalMin - range * 0.4);
    const barMax = r.critHigh ?? (normalMax + range * 0.4);
    const total = barMax - barMin;
    const pct = ((r.numeric - barMin) / total) * 100;
    return Math.max(0, Math.min(100, pct));
  }

  ticksFor(r: ValueRow): Array<{ label: string; pos: number }> {
    const normalMin = r.min ?? r.critLow ?? 0;
    const normalMax = r.max ?? r.critHigh ?? normalMin + 1;
    const range = Math.max(1, normalMax - normalMin);
    const barMin = r.critLow  ?? (normalMin - range * 0.4);
    const barMax = r.critHigh ?? (normalMax + range * 0.4);
    const total = barMax - barMin;
    const posOf = (v: number) => Math.max(0, Math.min(100, ((v - barMin) / total) * 100));

    const ticks: Array<{ label: string; pos: number }> = [];
    if (r.critLow !== undefined)  ticks.push({ label: String(r.critLow),  pos: posOf(r.critLow) });
    if (r.min     !== undefined)  ticks.push({ label: String(r.min),      pos: posOf(r.min) });
    if (r.max     !== undefined)  ticks.push({ label: String(r.max),      pos: posOf(r.max) });
    if (r.critHigh !== undefined) ticks.push({ label: String(r.critHigh), pos: posOf(r.critHigh) });
    return ticks;
  }

  flagLabel(f: Flag): string {
    return f === 'critical' ? 'CRITICAL' : f === 'abnormal' ? 'ABNORMAL' : 'NORMAL';
  }

  flagExplanation(r: ValueRow): string {
    if (r.flag === 'normal') return '';
    if (r.numeric === undefined) return `Flagged ${r.flag} based on the entered value.`;
    if (r.flag === 'critical') {
      if (r.critLow !== undefined && r.numeric <= r.critLow) return `Value ${r.numeric}${r.unit ? ' ' + r.unit : ''} is at or below the critical-low threshold of ${r.critLow}.`;
      if (r.critHigh !== undefined && r.numeric >= r.critHigh) return `Value ${r.numeric}${r.unit ? ' ' + r.unit : ''} is at or above the critical-high threshold of ${r.critHigh}.`;
    }
    if (r.min !== undefined && r.numeric < r.min) return `Value ${r.numeric}${r.unit ? ' ' + r.unit : ''} is below the normal minimum of ${r.min}.`;
    if (r.max !== undefined && r.numeric > r.max) return `Value ${r.numeric}${r.unit ? ' ' + r.unit : ''} is above the normal maximum of ${r.max}.`;
    return 'Flagged based on the entered value.';
  }

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    this._id.set(id);
    if (!id) return;
    this._loading.set(true);
    this.api.get<OrderTest[]>('/api/validation/queue?mine=false').subscribe({
      next: rows => {
        this._loading.set(false);
        this._queue.set(rows ?? []);
        const match = (rows ?? []).find(r => r.id === id) ?? null;
        this._selected.set(match);
        if (match) void this.loadComments();
      },
      error: () => this._loading.set(false)
    });
  }

  onComment(e: Event) { this._comment.set((e.target as HTMLTextAreaElement).value); }

  back() { this.navBack.backTo('/pathologist'); }

  openDetail(r: ValueRow) { this._detailRow.set(r); }
  closeDetail() { this._detailRow.set(null); }

  startEdit() {
    if (this._editing()) return;
    const snap = this.snapshot();
    const seed: Record<string, unknown> = {};
    for (const r of this.valueRows()) {
      const v = snap?.values?.[r.name];
      seed[r.name] = v == null ? '' : v;
    }
    this._edits.set(seed);
    this._editing.set(true);
    this.toasts.success('Edit mode — change values inline, then Save');
  }

  cancelEdit() {
    this._editing.set(false);
    this._edits.set({});
  }

  saveEdits() {
    const t = this._selected();
    if (!t || this._saving()) return;

    const edits = this._edits();
    const out: Record<string, unknown> = {};
    for (const r of this.valueRows()) {
      const raw = edits[r.name];
      if (raw === '' || raw == null) { out[r.name] = null; continue; }
      const n = Number(raw);
      out[r.name] = Number.isNaN(n) ? String(raw) : n;
    }

    this._saving.set(true);
    this.api.post<{ orderTest: OrderTest; flags: { critical: boolean } }>(
      `/api/results/${t.id}/enter`,
      { values: out, note: this._comment() || null }
    ).subscribe({
      next: res => {
        this._saving.set(false);
        this._editing.set(false);
        this._edits.set({});
        this._selected.set(res.orderTest);
        if (res.flags.critical) this.toasts.warning('Saved — flagged critical');
        else this.toasts.success('Values updated');
      },
      error: e => {
        this._saving.set(false);
        this.toasts.error(ApiError.from(e).message);
      }
    });
  }

  validate() {
    const t = this._selected();
    if (!t) return;
    this._saving.set(true);
    this.api.post<OrderTest>(`/api/validation/${t.id}/validate`, { note: this._comment() || null }).subscribe({
      next: () => {
        this._saving.set(false);
        this.toasts.success('Validated');
        this.back();
      },
      error: e => {
        this._saving.set(false);
        this.toasts.error(ApiError.from(e).message);
      }
    });
  }

  async reject() {
    const t = this._selected();
    if (!t) return;
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
    this.api.post<OrderTest>(`/api/validation/${t.id}/reject`, { reason, note: this._comment() || null }).subscribe({
      next: () => {
        this.toasts.success('Rejected — lab tech notified');
        this.back();
      },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }

  async reassign() {
    const t = this._selected();
    if (!t) return;
    const id = await this.dialog.prompt({
      title: 'Reassign to pathologist',
      message: `Move "${t.test?.name}" to another pathologist's queue.`,
      placeholder: 'Pathologist user id',
      required: true,
      confirmLabel: 'Reassign'
    });
    if (!id) return;
    this.api.post<OrderTest>(`/api/validation/${t.id}/reassign`, { assigneeId: id }).subscribe({
      next: () => {
        this.toasts.success('Reassigned');
        this.back();
      },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }
}
