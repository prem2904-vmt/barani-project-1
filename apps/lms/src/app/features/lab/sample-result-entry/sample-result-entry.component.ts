import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { TrendTest } from '../../../shared/utils/trend-chart';
import { describeAllRanges } from '../../../shared/utils/reference-range';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { AuthService } from '../../../core/auth/auth.service';
import { OrderSample, OrderTest, logicalTestCount, sortTestsForDisplay } from '../../../shared/models/order.model';
import { TestParameter, TestParametersBlob } from '../../../shared/models/test.model';
import { OrderTestComment } from '../../../shared/models/comment.model';
import { ApiError } from '../../../shared/models/api-response.model';
import { CommentThreadComponent } from '../../../shared/components/comment-thread/comment-thread.component';
import { LoadingLogoComponent } from '../../../shared/components/loading-logo/loading-logo.component';
import { SelectComponent } from '../../../shared/primitives/select.component';
import { CultureEntryComponent } from '../culture-entry/culture-entry.component';
import { CultureResult } from '../../../shared/models/culture.model';
import { formatPatientInfo } from '../../../shared/models/patient.model';

interface BulkSubmitResponse {
  sample: OrderSample;
  submitted: number;
  results: Array<{
    orderTest: OrderTest;
    flags: { critical: boolean; notifications: string[] };
  }>;
}

/** Generic single-value field used when a (non-culture) test has no parameter
 *  schema configured, so the tech can still enter and submit a result. Stored
 *  under the `result` key — humanises to "Result" in the report. */
function defaultResultParam(): TestParameter {
  return { id: 'result', name: 'result', title: 'Result', type: 'text' };
}

/**
 * Sample-level result entry. One barcode scan loads ALL tests on the
 * tube; tech enters every value in one screen and submits once. Backend
 * runs the conditions engine per test and returns combined flags.
 *
 * The unit of work is the tube, not the individual test — see Fix 6 in
 * the brief that introduced this view.
 */
@Component({
  selector: 'pf-sample-result-entry',
  standalone: true,
  imports: [CommonModule, FormsModule, CommentThreadComponent, SelectComponent, LoadingLogoComponent, CultureEntryComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Full-width container matching FD/collect screens — was centered
         to 880px which left huge empty gutters on lab terminals. -->
    <section class="pf-sre px-4 md:px-8 lg:px-10 pt-6 pb-10">
      <header class="pf-sre__hdr pf-sre__hdr--sticky">
        <!-- App-wide standard back chevron. Sits BEFORE the title and shows at
             ALL widths; the legacy .pf-sre__back pill is suppressed everywhere
             via CSS so there is exactly ONE back affordance per viewport. -->
        @if (navBack.showBack()) {
          <button type="button" class="pf-hdr-back shrink-0 inline-flex items-center justify-center" (click)="navBack.back()" aria-label="Go back">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
          </button>
        }
        <button type="button" class="pf-sre__back" (click)="back()" aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m15 18-6-6 6-6"/>
          </svg>
          <span class="pf-sre__back-txt">Back</span>
        </button>
        @if (sample(); as s) {
          <div class="pf-sre__hdr-title">
            <!-- Sample-focused header: the Sample ID (tube barcode) is the primary
                 identity; the patient is demoted to a small secondary line. -->
            <p class="pf-sre__eyebrow">{{ s.department?.code ?? 'Tube' }} · {{ logicalCount() }} test{{ logicalCount() === 1 ? '' : 's' }} on this tube</p>
            <h1 class="pf-sre__title">{{ s.barcode || '—' }}</h1>
            <p class="pf-sre__pid">{{ formatPatient(s.order?.patient) }}</p>
            <!-- Glimpse of every test kind on this tube (tube-as-probe). -->
            @if (headerChips().length) {
              <div class="pf-sre__chips">
                @for (c of headerChips(); track $index) {
                  <span class="pf-sre__chip">{{ c }}</span>
                }
              </div>
            }
          </div>
        }
        <!-- Signed-in technician (right of header): name + medical
             registration ID (dash until the user adds one in My signature). -->
        <span class="pf-sre__tech" title="Signed-in technician">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
          </svg>
          <span class="pf-sre__tech-name">{{ techName() }}</span>
          <span class="pf-sre__tech-reg" title="Registration ID">Reg: {{ techRegId() }}</span>
        </span>
        <!-- Background autosave indicator (manual Save draft still available). -->
        @if (autosaving()) {
          <span class="pf-sre__autosave"><span class="pf-sre__autosave-dot"></span>Saving…</span>
        } @else if (lastSavedLabel(); as l) {
          <span class="pf-sre__autosave"><span class="pf-sre__autosave-dot pf-sre__autosave-dot--ok"></span>{{ l }}</span>
        }
        <span class="pf-sre__view" role="group" aria-label="Result view">
          <button type="button" class="pf-sre__view-btn"
                  [class.pf-sre__view-btn--on]="viewMode() === 'grid'"
                  (click)="setViewMode('grid')" aria-label="Grid view">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>
            </svg>
            Grid
          </button>
          <button type="button" class="pf-sre__view-btn"
                  [class.pf-sre__view-btn--on]="viewMode() === 'form'"
                  (click)="setViewMode('form')" aria-label="Form view">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="5" rx="1"/>
              <rect x="3" y="11" width="18" height="5" rx="1"/>
              <rect x="3" y="18" width="18" height="3" rx="1"/>
            </svg>
            Form
          </button>
        </span>
        <!-- Phone: the primary action moves into the header as an icon (top-
             right) so the bottom is free. Submitted-and-awaiting state flips it
             to an undo. Hidden >=641px (which uses the bottom action bar). -->
        @if (hasReopenable() && !hasWritable()) {
          <button type="button" class="pf-sre__hdr-action" [disabled]="submitting()"
                  (click)="reopenSample()" aria-label="Undo submit & edit" title="Undo submit & edit">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>
            </svg>
          </button>
        } @else {
          @if (hasWritable()) {
            <button type="button" class="pf-sre__hdr-action pf-sre__hdr-action--draft"
                    [disabled]="submitting() || savingDraft()"
                    (click)="saveDraft()" aria-label="Save draft" title="Save draft">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <path d="M17 21v-8H7v8M7 3v5h8"/>
              </svg>
            </button>
          }
          <button type="button" class="pf-sre__hdr-action pf-sre__hdr-action--go"
                  [disabled]="submitting() || savingDraft() || !hasWritable()"
                  (click)="submitAll()" aria-label="Submit all results" title="Submit all results">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 6 9 17l-5-5"/>
            </svg>
          </button>
        }
      </header>

      <!-- Trendogram: offer to embed serial-result trend charts in the report.
           Shown only when this patient has repeat tests. Persists on the order,
           so it applies when the report generates on validation. -->
      @if (trendEligible().length > 0) {
        <div class="pf-sre__trend">
          <label class="pf-sre__trend-toggle">
            <input type="checkbox" [checked]="trendogramOn()" (change)="toggleTrendogram()" />
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/></svg>
            <span>Include Trendogram in report
              <em>{{ trendEligible().length }} repeat test{{ trendEligible().length === 1 ? '' : 's' }} · trend charts</em>
            </span>
          </label>
          @if (trendogramOn()) {
            <select class="pf-sre__trend-sel" [value]="trendogramDuration()" (change)="setTrendDuration($any($event.target).value)">
              <option value="5">Last 5 tests</option>
              <option value="10">Last 10 tests</option>
              <option value="3m">Last 3 months</option>
              <option value="6m">Last 6 months</option>
              <option value="all">All time</option>
            </select>
          }
        </div>
      }

      @if (loading()) {
        <div class="pf-sre__msg flex justify-center py-10">
          <pf-loading-logo size="xl" color="purple" [showDna]="true"
                           [showText]="true" text="Loading sample…"></pf-loading-logo>
        </div>
      } @else if (!sample()) {
        <p class="pf-sre__msg pf-sre__msg--err">Sample not found.</p>
      } @else {
        <div class="pf-sre__scroll">
        <!-- Top-of-screen banner when one or more tests on this tube
             were sent back. Lists the affected tests + the pathologist's
             reason so the tech sees the why before scrolling into the
             entry sections. -->
        @if (rejectedTests().length > 0) {
          <div class="pf-sre__reject-banner">
            <div class="pf-sre__reject-banner-head">
              <span class="pf-sre__reject-icon" aria-hidden="true">↻</span>
              <span class="pf-sre__reject-title">
                Sent back for re-entry · {{ rejectedTests().length }} test{{ rejectedTests().length === 1 ? '' : 's' }}
              </span>
            </div>
            <ul class="pf-sre__reject-list">
              @for (r of rejectedTests(); track r.id) {
                <li class="pf-sre__reject-item">
                  <span class="pf-sre__reject-test">{{ r.test?.name ?? 'Test' }}</span>
                  <span class="pf-sre__reject-reason">{{ r.rejectionReason || '(no reason given)' }}</span>
                </li>
              }
            </ul>
          </div>
        }

        @for (blk of entryBlocks(); track blk.key) {
          @if (blk.kind === 'card' || viewMode() !== 'grid') {
            <!-- Classic cards: multi-parameter/culture/schema-less tests, and
                 the whole form view. -->
            <ng-container *ngTemplateOutlet="testCard; context: { $implicit: blk.tests, member: false }"></ng-container>
          } @else {
            <!-- FLAT block: one column-header strip, then a plain sequence of
                 rows. A profile shows its name once above (Profile → test,
                 test, test…); plain tests need no header at all — the row's
                 Parameter column already names the test. -->
            <section class="pf-sre__test pf-sre__flat">
              @if (blk.title) {
                <header class="pf-sre__flat-hdr">
                  <h2 class="pf-sre__profile-name">{{ blk.title }}</h2>
                  <span class="pf-sre__profile-count">{{ blk.tests.length }} tests</span>
                </header>
              }
              <div class="pf-sre__grid-wrap">
                <table class="pf-sre__grid">
                  <thead>
                    <tr>
                      <th class="pf-sre__gc-param">Parameter</th>
                      <th class="pf-sre__gc-result">Result</th>
                      <th class="pf-sre__gc-unit">Unit</th>
                      <th class="pf-sre__gc-range">Reference range</th>
                      <th class="pf-sre__gc-method">Method</th>
                      <th class="pf-sre__gc-note"></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (t of blk.tests; track t.id) {
                      @if (t.status === 're_entry' && t.rejectionReason) {
                        <tr class="pf-sre__grow-reject"><td colspan="6"><strong>Pathologist note:</strong> {{ t.rejectionReason }}</td></tr>
                      }
                      @if (parametersFor(t).length > 1) {
                        <!-- Multi-parameter member inside a profile: one slim
                             sub-label row, then its parameter rows. -->
                        <tr class="pf-sre__gsub"><td colspan="6">{{ t.test?.name ?? 'Test' }}</td></tr>
                      }
                      @for (p of parametersFor(t); track p.name; let idx = $index) {
                        <tr class="pf-sre__grow"
                            [class.pf-sre__grow--flagged]="hasOpenComment(t.id, p.name)">
                          <td class="pf-sre__gc-param">
                            <span class="pf-sre__gname">{{ parametersFor(t).length > 1 ? (p.title || p.name) : (t.test?.name || p.title || p.name) }}@if (hasOpenComment(t.id, p.name)) {<span class="pf-sre__param-flag" title="Pathologist commented"> ↻</span>}</span>
                          </td>
                          <td class="pf-sre__gc-result">
                            <ng-container *ngTemplateOutlet="resultInput; context: { t, p }"></ng-container>
                            @if (p.unit) {
                              <span class="pf-sre__gunit-inline" aria-hidden="true">{{ p.unit }}</span>
                            }
                          </td>
                          <td class="pf-sre__gc-unit">{{ p.unit || '—' }}</td>
                          <td class="pf-sre__gc-range">{{ refLabelFor(p) || '—' }}</td>
                          <td class="pf-sre__gc-method">{{ methodologyOf(p) }}</td>
                          <td class="pf-sre__gc-note">
                            @if (idx === 0) {
                              @if (t.status === 're_entry') { <span class="pf-sre__gdot pf-sre__gdot--rejected" title="Re-entry needed"></span> }
                              @else if (t.status === 'entered' || t.status === 'validated') { <span class="pf-sre__gdot pf-sre__gdot--done" title="Entered"></span> }
                              <button type="button" class="pf-sre__gnote press"
                                      [class.pf-sre__gnote--has]="commentsFor(t.id, null).length > 0"
                                      (click)="toggleOverall(t.id)" title="Note on this test">✎</button>
                            }
                          </td>
                        </tr>
                        @if (commentsFor(t.id, p.name).length > 0 || hasOpenComment(t.id, p.name)) {
                          <tr class="pf-sre__grow-comments">
                            <td colspan="6">
                              <pf-comment-thread
                                [comments]="commentsFor(t.id, p.name)"
                                currentRole="tech"
                                [composeLabel]="'Add note on this parameter'"
                                (add)="addParameterComment(t.id, p.name, $event.body, $event.type)"
                                (reply)="replyToParameter(t.id, p.name, $event.parentId, $event.body)">
                              </pf-comment-thread>
                            </td>
                          </tr>
                        }
                      }
                      @if (isOverallOpen(t.id) || commentsFor(t.id, null).length > 0) {
                        <tr class="pf-sre__grow-comments">
                          <td colspan="6">
                            <pf-comment-thread
                              [comments]="commentsFor(t.id, null)"
                              currentRole="tech"
                              (add)="addOverallComment(t.id, $event.body, $event.type)"
                              (reply)="replyToOverall(t.id, $event.parentId, $event.body)">
                            </pf-comment-thread>
                          </td>
                        </tr>
                      }
                    }
                  </tbody>
                </table>
              </div>
            </section>
          }
        }

        <!-- Shared result-input control (grid tables): one definition, used by
             both the flat block rows and the classic card grid. -->
        <ng-template #resultInput let-t="t" let-p="p">
          @switch (inputKindFor(p)) {
            @case ('number') {
              <input type="number" step="any" class="pf-sre__ginput pf-sre__ginput--num"
                     [class.pf-sre__input--flagged]="hasOpenComment(t.id, p.name)"
                     [ngModel]="getValue(t.id, p.name)"
                     (ngModelChange)="setValue(t.id, p.name, $event)" />
            }
            @case ('select') {
              <select class="pf-sre__ginput"
                      [class.pf-sre__input--flagged]="hasOpenComment(t.id, p.name)"
                      [ngModel]="getValue(t.id, p.name)"
                      (ngModelChange)="setValue(t.id, p.name, $event)">
                <option value="">—</option>
                @for (o of (p.options ?? []); track o) {
                  <option [value]="o">{{ o }}</option>
                }
              </select>
            }
            @case ('textarea') {
              <textarea class="pf-sre__ginput pf-sre__ginput--ta" rows="1"
                        [class.pf-sre__input--flagged]="hasOpenComment(t.id, p.name)"
                        [ngModel]="getValue(t.id, p.name)"
                        (ngModelChange)="setValue(t.id, p.name, $event)"></textarea>
            }
            @case ('checkbox') {
              <input type="checkbox" class="pf-sre__cb"
                     [ngModel]="!!getValue(t.id, p.name)"
                     (ngModelChange)="setValue(t.id, p.name, $event)" />
            }
            @case ('date') {
              <input type="date" class="pf-sre__ginput"
                     [class.pf-sre__input--flagged]="hasOpenComment(t.id, p.name)"
                     [ngModel]="getValue(t.id, p.name)"
                     (ngModelChange)="setValue(t.id, p.name, $event)" />
            }
            @default {
              <input type="text" class="pf-sre__ginput"
                     [class.pf-sre__input--flagged]="hasOpenComment(t.id, p.name)"
                     [ngModel]="getValue(t.id, p.name)"
                     (ngModelChange)="setValue(t.id, p.name, $event)" />
            }
          }
        </ng-template>

        <ng-template #testCard let-cardTests let-member="member">
        @for (t of cardTests; track t.id) {
          <section class="pf-sre__test"
                   [class.pf-sre__test--member]="member"
                   [class.pf-sre__test--done]="t.status === 'entered' || t.status === 'validated'"
                   [class.pf-sre__test--rejected]="t.status === 're_entry'">
            <header class="pf-sre__test-hdr">
              <h2 class="pf-sre__test-name">{{ t.test?.name ?? 'Test' }}</h2>
              @if (t.status === 're_entry') {
                <span class="pf-sre__test-pill pf-sre__test-pill--rejected">Re-entry needed</span>
              } @else if (t.status === 'entered' || t.status === 'validated') {
                <span class="pf-sre__test-pill">Entered</span>
              }
              <!-- Compact "+ Note" pill at the right edge of the header.
                   Replaces the full-width "Add Overall Observation" button
                   that used to consume a vertical slot above the params. -->
              @if (commentsFor(t.id, null).length > 0) {
                <button type="button" class="pf-sre__note-btn pf-sre__note-btn--has"
                        (click)="toggleOverall(t.id)"
                        [attr.aria-expanded]="isOverallOpen(t.id) || commentsFor(t.id, null).length > 0">
                  Notes ({{ commentsFor(t.id, null).length }})
                </button>
              } @else {
                <button type="button" class="pf-sre__note-btn"
                        (click)="toggleOverall(t.id)"
                        [attr.aria-expanded]="isOverallOpen(t.id)">
                  {{ isOverallOpen(t.id) ? '× Close note' : '+ Note' }}
                </button>
              }
            </header>
            <!-- Per-test rejection reason — repeats the banner info but
                 right next to the inputs the tech is about to edit, so
                 they don't have to scroll back up to remember WHY. -->
            @if (t.status === 're_entry' && t.rejectionReason) {
              <p class="pf-sre__test-reject-reason">
                <strong>Pathologist note:</strong> {{ t.rejectionReason }}
              </p>
            }

            <!-- Overall conversation thread for THIS test — comments
                 with parameterName == null. Rendered only when the tech
                 toggles it open via the "+ Note" header pill, OR when
                 the test already has overall comments (existing
                 conversation must always be visible). -->
            @if (isOverallOpen(t.id) || commentsFor(t.id, null).length > 0) {
              <div class="pf-sre__test-comments">
                <pf-comment-thread
                  [comments]="commentsFor(t.id, null)"
                  currentRole="tech"
                  (add)="addOverallComment(t.id, $event.body, $event.type)"
                  (reply)="replyToOverall(t.id, $event.parentId, $event.body)">
                </pf-comment-thread>
              </div>
            }

            @if (isCultureTest(t)) {
              <!-- Microbiology Culture & Sensitivity: structured organism +
                   antibiotic (zone / S-I-R) entry, replacing the flat grid. -->
              <pf-culture-entry [value]="cultureValueFor(t)"
                                (valueChange)="setCulture(t.id, $event)"></pf-culture-entry>
            } @else if (parametersFor(t).length === 0) {
              <p class="pf-sre__test-empty">No parameter schema — this test has no inputs.</p>
            } @else if (viewMode() === 'grid') {
              <!-- Grid view: mirrors the report PDF column structure so the
                   tech enters results in the same shape they'll appear in
                   the patient report. Toggle in the page header switches
                   back to the legacy form view. -->
              <div class="pf-sre__grid-wrap">
                <table class="pf-sre__grid">
                  <thead>
                    <tr>
                      <th class="pf-sre__gc-param">Parameter</th>
                      <th class="pf-sre__gc-result">Result</th>
                      <th class="pf-sre__gc-unit">Unit</th>
                      <th class="pf-sre__gc-range">Reference range</th>
                      <th class="pf-sre__gc-method">Method</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (p of parametersFor(t); track p.name; let idx = $index) {
                      <tr class="pf-sre__grow"
                          [class.pf-sre__grow--flagged]="hasOpenComment(t.id, p.name)">
                        <td class="pf-sre__gc-param">
                          <span class="pf-sre__gidx">{{ idx + 1 }}</span>
                          <span class="pf-sre__gname">{{ p.title || p.name }}@if (hasOpenComment(t.id, p.name)) {<span class="pf-sre__param-flag" title="Pathologist commented"> ↻</span>}</span>
                        </td>
                        <td class="pf-sre__gc-result">
                          @switch (inputKindFor(p)) {
                            @case ('number') {
                              <input type="number" step="any" class="pf-sre__ginput pf-sre__ginput--num"
                                     [class.pf-sre__input--flagged]="hasOpenComment(t.id, p.name)"
                                     [ngModel]="getValue(t.id, p.name)"
                                     (ngModelChange)="setValue(t.id, p.name, $event)" />
                            }
                            @case ('select') {
                              <select class="pf-sre__ginput"
                                      [class.pf-sre__input--flagged]="hasOpenComment(t.id, p.name)"
                                      [ngModel]="getValue(t.id, p.name)"
                                      (ngModelChange)="setValue(t.id, p.name, $event)">
                                <option value="">—</option>
                                @for (o of (p.options ?? []); track o) {
                                  <option [value]="o">{{ o }}</option>
                                }
                              </select>
                            }
                            @case ('textarea') {
                              <textarea class="pf-sre__ginput pf-sre__ginput--ta" rows="1"
                                        [class.pf-sre__input--flagged]="hasOpenComment(t.id, p.name)"
                                        [ngModel]="getValue(t.id, p.name)"
                                        (ngModelChange)="setValue(t.id, p.name, $event)"></textarea>
                            }
                            @case ('checkbox') {
                              <input type="checkbox" class="pf-sre__cb"
                                     [ngModel]="!!getValue(t.id, p.name)"
                                     (ngModelChange)="setValue(t.id, p.name, $event)" />
                            }
                            @case ('date') {
                              <input type="date" class="pf-sre__ginput"
                                     [class.pf-sre__input--flagged]="hasOpenComment(t.id, p.name)"
                                     [ngModel]="getValue(t.id, p.name)"
                                     (ngModelChange)="setValue(t.id, p.name, $event)" />
                            }
                            @default {
                              <input type="text" class="pf-sre__ginput"
                                     [class.pf-sre__input--flagged]="hasOpenComment(t.id, p.name)"
                                     [ngModel]="getValue(t.id, p.name)"
                                     (ngModelChange)="setValue(t.id, p.name, $event)" />
                            }
                          }
                          <!-- Phone only (CSS-gated): the dropped UNIT column re-shown
                               as a small inline suffix beside the result input. Reuses
                               the same p.unit value rendered in the UNIT column above. -->
                          @if (p.unit) {
                            <span class="pf-sre__gunit-inline" aria-hidden="true">{{ p.unit }}</span>
                          }
                        </td>
                        <td class="pf-sre__gc-unit">{{ p.unit || '—' }}</td>
                        <td class="pf-sre__gc-range">{{ refLabelFor(p) || '—' }}</td>
                        <td class="pf-sre__gc-method">{{ methodologyOf(p) }}</td>
                      </tr>
                      @if (commentsFor(t.id, p.name).length > 0 || hasOpenComment(t.id, p.name)) {
                        <tr class="pf-sre__grow-comments">
                          <td colspan="5">
                            <pf-comment-thread
                              [comments]="commentsFor(t.id, p.name)"
                              currentRole="tech"
                              [composeLabel]="'Add note on this parameter'"
                              (add)="addParameterComment(t.id, p.name, $event.body, $event.type)"
                              (reply)="replyToParameter(t.id, p.name, $event.parentId, $event.body)">
                            </pf-comment-thread>
                          </td>
                        </tr>
                      }
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <div class="pf-sre__params">
                @for (p of parametersFor(t); track p.name) {
                  <!-- Two siblings inside a wrapper <div>: the <label>
                       (input + label + hint) and the comment-thread.
                       Previously the thread sat INSIDE the <label>,
                       and clicks on Reply / Send / Add got stolen by
                       the label's "focus the input" behavior — buttons
                       worked on validator side (in <div>) but not here. -->
                  <div class="pf-sre__param-wrap"
                       [class.pf-sre__param-wrap--flagged]="hasOpenComment(t.id, p.name)">
                    <label class="pf-sre__param">
                      <span class="pf-sre__param-label">
                        {{ p.title || p.name }}
                        @if (p.unit) { <span class="pf-sre__unit">({{ p.unit }})</span> }
                        @if (hasOpenComment(t.id, p.name)) {
                          <span class="pf-sre__param-flag" title="Pathologist commented on this parameter">↻</span>
                        }
                      </span>
                      @switch (inputKindFor(p)) {
                        @case ('number') {
                          <input type="number" class="pf-sre__input"
                                 [class.pf-sre__input--flagged]="hasOpenComment(t.id, p.name)"
                                 [ngModel]="getValue(t.id, p.name)"
                                 (ngModelChange)="setValue(t.id, p.name, $event)" />
                        }
                        @case ('textarea') {
                          <textarea class="pf-sre__input pf-sre__input--ta" rows="2"
                                    [class.pf-sre__input--flagged]="hasOpenComment(t.id, p.name)"
                                    [ngModel]="getValue(t.id, p.name)"
                                    (ngModelChange)="setValue(t.id, p.name, $event)"></textarea>
                        }
                        @case ('select') {
                          <div class="pf-sre__select-wrap"
                               [class.pf-sre__input--flagged]="hasOpenComment(t.id, p.name)">
                            <pf-select
                              [options]="[{ value: '', label: '—' }, ...(p.options ?? []).map(o => ({ value: o, label: o }))]"
                              [value]="getValue(t.id, p.name)"
                              (valueChange)="setValue(t.id, p.name, $event)">
                            </pf-select>
                          </div>
                        }
                        @case ('checkbox') {
                          <input type="checkbox" class="pf-sre__cb"
                                 [ngModel]="!!getValue(t.id, p.name)"
                                 (ngModelChange)="setValue(t.id, p.name, $event)" />
                        }
                        @case ('date') {
                          <input type="date" class="pf-sre__input"
                                 [class.pf-sre__input--flagged]="hasOpenComment(t.id, p.name)"
                                 [ngModel]="getValue(t.id, p.name)"
                                 (ngModelChange)="setValue(t.id, p.name, $event)" />
                        }
                        @default {
                          <input type="text" class="pf-sre__input"
                                 [class.pf-sre__input--flagged]="hasOpenComment(t.id, p.name)"
                                 [ngModel]="getValue(t.id, p.name)"
                                 (ngModelChange)="setValue(t.id, p.name, $event)" />
                        }
                      }
                      @if (p.normalValue || p.criticalLow != null || p.criticalHigh != null) {
                        <span class="pf-sre__hint">
                          @if (p.normalValue) { Normal: {{ p.normalValue }} }
                          @if (p.criticalLow != null) { · Crit&lt; {{ p.criticalLow }} }
                          @if (p.criticalHigh != null) { · Crit&gt; {{ p.criticalHigh }} }
                        </span>
                      }
                    </label>

                    <!-- Per-parameter conversation thread, OUTSIDE the
                         label so its Reply / Send / Add buttons work. -->
                    @if (commentsFor(t.id, p.name).length > 0 || hasOpenComment(t.id, p.name)) {
                      <div class="pf-sre__param-comments">
                        <pf-comment-thread
                          [comments]="commentsFor(t.id, p.name)"
                          currentRole="tech"
                          [composeLabel]="'Add note on this parameter'"
                          (add)="addParameterComment(t.id, p.name, $event.body, $event.type)"
                          (reply)="replyToParameter(t.id, p.name, $event.parentId, $event.body)">
                        </pf-comment-thread>
                      </div>
                    }
                  </div>
                }
              </div>
            }
          </section>
        }
        </ng-template>
        </div>

        <footer class="pf-sre__footer">
          @if (hasReopenable()) {
            <!-- Submitted, awaiting validation — pull it back to edit + resubmit.
                 Every reopen is recorded in the result's audit trail. -->
            <button type="button" class="pf-sre__reopen"
                    [disabled]="submitting()"
                    (click)="reopenSample()">
              {{ submitting() ? 'Reopening…' : '↺ Undo submit & edit' }}
            </button>
          }
          <!-- Save partial work and come back later (tube stays in_progress). -->
          @if (hasWritable()) {
            <button type="button" class="pf-sre__draft"
                    [disabled]="submitting() || savingDraft()"
                    (click)="saveDraft()">
              {{ savingDraft() ? 'Saving…' : 'Save draft' }}
            </button>
          }
          <button type="button" class="pf-sre__submit"
                  [disabled]="submitting() || savingDraft() || !hasWritable()"
                  (click)="submitAll()">
            {{ submitting() ? 'Submitting…' : (hasReopenable() && !hasWritable() ? 'Submitted — awaiting validation' : 'Submit All Results') }}
          </button>
        </footer>

        @if (lastFlags().length > 0) {
          <ul class="pf-sre__flags">
            @for (f of lastFlags(); track f.label) {
              <li class="pf-sre__flag" [class.pf-sre__flag--crit]="f.critical">
                <strong>{{ f.label }}</strong>{{ f.note ? ' · ' + f.note : '' }}
              </li>
            }
          </ul>
        }
      }
    </section>
  `,
  styles: [`
    /* ── Grid / Form view toggle in page header ───────────────── */
    .pf-sre__view {
      display: inline-flex; gap: 2px;
      padding: 2px;
      margin-left: auto;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
    }
    .pf-sre__view-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 5px 12px;
      font-size: 12px; font-weight: 600;
      border: 0; background: transparent;
      border-radius: 9999px;
      color: var(--text-muted);
      cursor: pointer;
      transition: background 0.12s, color 0.12s;
    }
    .pf-sre__view-btn:hover { color: var(--text-primary); }
    .pf-sre__view-btn--on {
      background: rgba(168, 85, 247, 0.16);
      color: var(--violet-text);
    }

    /* ── Grid view (mirrors report PDF) ───────────────────────── */
    .pf-sre__grid-wrap {
      margin-top: 8px;
      border: 1px solid var(--glass-border);
      border-radius: 10px;
      overflow: hidden;
      background: var(--glass-bg);
    }
    .pf-sre__grid {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      table-layout: fixed;
      font-size: 13px;
    }
    .pf-sre__grid thead th {
      text-align: left;
      padding: 9px 10px;
      font-size: 10.5px; font-weight: 800;
      letter-spacing: 0.14em; text-transform: uppercase;
      color: var(--violet-text);
      background: linear-gradient(180deg, rgba(168, 85, 247, 0.18), rgba(168, 85, 247, 0.06));
      border-bottom: 1px solid rgba(168, 85, 247, 0.4);
    }
    .pf-sre__gc-param  { width: 28%; }
    .pf-sre__gc-result { width: 22%; }
    .pf-sre__gc-unit   { width: 12%; }
    .pf-sre__gc-range  { width: 22%; }
    .pf-sre__gc-method { width: 16%; }
    .pf-sre__grow td {
      padding: 5px 8px;
      border-bottom: 1px solid var(--glass-border);
      vertical-align: middle;
    }
    .pf-sre__grow:nth-child(odd) td { background: rgba(255, 255, 255, 0.012); }
    .pf-sre__grow:hover td { background: rgba(168, 85, 247, 0.06); }
    .pf-sre__grow--flagged td { background: rgba(244, 63, 94, 0.08) !important; }
    .pf-sre__gc-param {
      color: var(--text-primary);
      font-weight: 500;
    }
    .pf-sre__gidx {
      display: inline-block; min-width: 18px;
      font-size: 9.5px; font-weight: 700;
      color: var(--text-muted);
      margin-right: 4px;
    }
    .pf-sre__ginput {
      width: 100%;
      padding: 6px 8px;
      font-size: 13.5px; font-weight: 600;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--glass-border);
      border-radius: 6px;
      color: var(--text-primary);
      transition: border-color 0.12s, background 0.12s;
    }
    .pf-sre__ginput:focus {
      outline: 0;
      border-color: rgba(168, 85, 247, 0.6);
      background: rgba(168, 85, 247, 0.1);
    }
    
    /* Light mode grid inputs */
    :host-context(.light) .pf-sre__ginput {
      background: var(--bg-input);
      border: 1.5px solid #cbd5e1;
      color: #1e293b;
      box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.04);
    }
    :host-context(.light) .pf-sre__ginput:focus {
      border-color: #8b5cf6;
      background: rgba(139, 92, 246, 0.05);
      box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.12);
    }
    .pf-sre__ginput--num { text-align: right; font-variant-numeric: tabular-nums; }
    .pf-sre__ginput--ta  { resize: vertical; min-height: 32px; font-weight: 500; }
    .pf-sre__gc-unit, .pf-sre__gc-range, .pf-sre__gc-method {
      color: var(--text-tertiary);
      font-size: 12px;
    }
    /* Inline unit suffix beside the result input — phone only. Hidden by
       default so desktop/iPad keep their dedicated UNIT column unchanged;
       the phone breakpoint switches it on. */
    .pf-sre__gunit-inline { display: none; }
    .pf-sre__grow-comments td {
      padding: 8px 10px;
      background: rgba(168, 85, 247, 0.04);
    }

    /* WORK page (non-scroll app layout). The host fills the shell's main
       area; the PAGE itself never scrolls. Scrolling happens INSIDE the
       single .pf-sre panel below — header & footer stick to its edges so
       only the test cards move. Holds at phone / iPad / desktop. */
    :host { display: block; height: 100%; min-height: 0; overflow: hidden; }
    /* Full-width like FD/collect — Tailwind utility classes on the
       outer section provide the responsive padding; no max-width or
       margin auto here so the screen actually fills the lab terminal.
       This is the lone scroll panel: height:100% + overflow-y:auto so
       the inner content scrolls, not the window. */
    .pf-sre {
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      -webkit-overflow-scrolling: touch;
    }

    /* Header action icon styling — declared BEFORE the phone media query
       below so the media query's display:inline-flex wins on source order
       (media queries add no specificity; equal-specificity rules resolve by
       source order). Default = hidden so desktop keeps its Grid/Form toggle
       + bottom submit bar; the phone block re-shows it. */
    .pf-sre__hdr-action {
      display: none;
      flex: 0 0 auto;
      width: 40px; height: 40px;
      align-items: center; justify-content: center;
      border-radius: 11px;
      border: 1px solid transparent;
      background: var(--gradient-primary, linear-gradient(135deg, #a855f7, #d946ef));
      color: #fff;
      box-shadow: 0 6px 16px rgba(168, 85, 247, 0.4);
      cursor: pointer;
    }
    .pf-sre__hdr-action:disabled { opacity: 0.4; box-shadow: none; cursor: not-allowed; }
    .pf-sre__hdr-action:not(.pf-sre__hdr-action--go) {
      background: var(--glass-bg); border-color: var(--glass-border); color: var(--text-secondary); box-shadow: none;
    }

    /* Mobile breakpoint — phones (<640px). Tighter every-thing so
       the form fits a 5" screen without horizontal scroll, and the
       submit button stays on screen so the tech doesn't lose it
       below the fold. */
    @media (max-width: 640px) {
      /* Compact header. The global html.cap-native already pads the safe-area
         top, so the sticky header must NOT add env() again (that double-counted
         into a big dead gap above the title). Tight padding; back arrow inline. */
      .pf-sre { padding-top: 4px !important; }
      /* !important: the base .pf-sre__hdr--sticky{padding-top:env(safe-area-inset-top)}
         appears LATER in source and was overriding this, re-adding the notch
         inset that html.cap-native already applies → a big double-inset gap
         above the title. The global pad already clears the status bar. */
      .pf-sre__hdr--sticky { padding-top: 4px !important; }
      .pf-sre__hdr {
        flex-direction: row;
        align-items: center;
        gap: 10px;
        padding-bottom: 8px;
        margin-bottom: 8px;
      }
      .pf-sre__back { width: 34px; height: 34px; padding: 0; justify-content: center; flex: 0 0 auto; }
      .pf-sre__back-txt { display: none; }
      /* Title row: name FIRST (order 1), code under it (order 2); drop the
         "N tests on this tube" line — name + code is enough on a phone. */
      .pf-sre__hdr-title { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
      .pf-sre__title  { order: 1; font-size: 16px; margin: 0; line-height: 1.2;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
      .pf-sre__eyebrow { order: 2; font-size: 9.5px; letter-spacing: 0.1em; }
      .pf-sre__pid { order: 3; font-size: 11px; }
      /* Keep the phone header compact — chip glimpse + tech pill are desktop-only. */
      .pf-sre__chips { display: none; }
      .pf-sre__tech { display: none; }
      .pf-sre__sub { display: none; }
      /* Submit (or undo) lives top-right as an icon; the bottom bar is gone.
         margin-left:auto pins it to the far right even if the title is short,
         and flex:0 0 auto (from base) stops it being squeezed off-screen. */
      .pf-sre__hdr-action { display: inline-flex; margin-left: auto; }
      .pf-sre__footer { display: none !important; }
      .pf-sre__test {
        padding: 12px 14px;
        margin-bottom: 10px;
      }
      .pf-sre__test-name { font-size: 14px; }
    }
    .pf-sre__hdr {
      display: flex; align-items: flex-start; gap: 14px;
      padding-bottom: 18px; margin-bottom: 18px;
      border-bottom: 1px solid var(--glass-border);
    }
    /* Pin the header to the top of the scroll panel so test cards scroll
       beneath it. Backdrop blur keeps the title legible over scrolling
       cards; safe-area padding clears the notch on native iOS. */
    .pf-sre__hdr--sticky {
      position: sticky;
      top: 0;
      z-index: 5;
      padding-top: env(safe-area-inset-top, 0px);
      background: var(--bg-primary, rgba(12, 14, 20, 0.82));
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }
    /* Desktop: NON-SCROLL app screen (WORK page) — the same pattern
       result-entry uses. The page fills shell-main exactly (shell-main is
       flex:1; min-height:0; overflow-y:auto, so a height:100% child fits),
       the header and Submit bar are FIXED flex children, and scrolling
       happens only inside .pf-sre__scroll. No sticky maths against the
       chrome, so nothing can overlap the top bar and there is no dead gap —
       the two bugs the previous top-offset attempts traded between.
       Phones keep the existing flow: the wrapper div is inert there and the
       tuned sticky/safe-area behaviour stands. */
    @media (min-width: 641px) {
      :host { display: block; height: 100%; overflow: hidden; }
      .pf-sre {
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        padding-bottom: 0;
      }
      .pf-sre__hdr--sticky {
        position: static;            /* fixed by flex layout, not by pinning */
        flex: 0 0 auto;
        padding-top: 0;
        background: transparent;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
      }
      .pf-sre__scroll {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
      }
      .pf-sre__footer {
        position: static;
        flex: 0 0 auto;
      }
    }
    .pf-sre__back {
      display: inline-flex; align-items: center; gap: 4px;
      height: 36px; padding: 0 12px;
      border-radius: 8px;
      background: var(--glass-bg); border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      font-size: 13px; font-weight: 500;
      cursor: pointer;
    }
    .pf-sre__back:hover { color: var(--text-primary); }
    /* App-wide standard back chevron, shown at ALL widths and placed BEFORE the
       title. align-self:center keeps it vertically centred with the title block
       regardless of the header row's align-items (flex-start on desktop, center
       on phone). */
    .pf-hdr-back { align-self:center; width:38px; height:38px; margin-left:-8px; border-radius:11px; color:var(--text-primary); background:transparent; border:0; cursor:pointer; -webkit-tap-highlight-color:transparent; transition:background .15s ease, transform .08s ease; }
    .pf-hdr-back:active { transform:scale(0.9); background:var(--glass-bg, rgba(255,255,255,0.06)); }
    @media (hover:hover){ .pf-hdr-back:hover{ background:var(--glass-bg, rgba(255,255,255,0.06)); } }
    /* Single back affordance per viewport: the legacy pill back is hidden at ALL
       widths so only the standard .pf-hdr-back chevron shows everywhere. */
    .pf-sre__back { display: none; }
    .pf-sre__hdr-title { flex: 1; min-width: 0; }
    .pf-sre__eyebrow {
      margin: 0; font-size: 10.5px; font-weight: 700;
      letter-spacing: 0.12em; text-transform: uppercase;
      color: var(--text-tertiary);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }
    /* Sample ID is the primary identity — big + monospace like an accession no. */
    .pf-sre__title { margin: 4px 0 2px; font-size: 22px; font-weight: 700; color: var(--text-primary);
      font-family: 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 0.01em; }
    .pf-sre__sub { margin: 0; font-size: 12.5px; color: var(--text-secondary); }
    /* Demoted patient line — small + secondary, always visible. */
    .pf-sre__pid { margin: 1px 0 0; font-size: 12px; color: var(--text-secondary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* Test-kind glimpse chips (tube-as-probe). */
    .pf-sre__chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .pf-sre__chip {
      display: inline-flex; align-items: center; padding: 2px 9px;
      border-radius: 999px; font-size: 11.5px; font-weight: 600; line-height: 1.5;
      color: var(--text-secondary);
      background: color-mix(in srgb, var(--accent, #a855f7) 14%, transparent);
      border: 1px solid var(--glass-border, rgba(255,255,255,0.1));
    }

    /* Signed-in technician (right of header). */
    .pf-sre__tech {
      display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto;
      align-self: center; padding: 5px 11px; border-radius: 999px;
      font-size: 12.5px; font-weight: 600; color: var(--text-secondary);
      background: var(--glass-bg, rgba(255,255,255,0.04));
      border: 1px solid var(--glass-border, rgba(255,255,255,0.1));
    }
    .pf-sre__tech svg { flex: 0 0 auto; opacity: 0.75; }
    .pf-sre__tech-name { max-width: 160px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    @media (max-width: 640px) { .pf-sre__tech-name { display: none; } }
    /* Medical registration ID beside the name — dash until the user sets one. */
    .pf-sre__tech-reg {
      font-size: 11px; color: var(--text-tertiary, #94a3b8);
      font-family: 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 0.02em;
      white-space: nowrap;
    }
    @media (max-width: 640px) { .pf-sre__tech-reg { display: none; } }

    /* ── Profile / package block: one titled card, member tests inside ── */
    .pf-sre__profile {
      margin-bottom: 20px; padding: 14px 14px 6px;
      border: 1px solid var(--glass-border, rgba(148, 163, 184, 0.22));
      border-radius: 18px;
      background: var(--glass-bg, rgba(255, 255, 255, 0.03));
    }
    .pf-sre__profile-hdr {
      display: flex; align-items: baseline; gap: 10px;
      padding: 2px 4px 12px;
    }
    .pf-sre__profile-name { margin: 0; font-size: 17px; font-weight: 800; letter-spacing: 0.01em; }
    .pf-sre__profile-count {
      font-size: 11px; color: var(--text-tertiary, #94a3b8);
      font-family: 'JetBrains Mono', ui-monospace, monospace; text-transform: uppercase; letter-spacing: 0.08em;
    }
    /* Member cards inside a profile sit flatter — the profile card carries the
       chrome; members read as a sequence of rows under the one title. */
    .pf-sre__test--member {
      margin-bottom: 10px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.02);
    }
    .pf-sre__test--member .pf-sre__test-name { font-size: 13px; }

    /* ── FLAT block: one header strip + a plain sequence of rows ── */
    .pf-sre__flat-hdr {
      display: flex; align-items: baseline; gap: 10px;
      padding: 2px 4px 12px;
    }
    /* Sub-label row for a multi-parameter member inside a profile. */
    .pf-sre__gsub td {
      padding: 8px 10px 4px; font-size: 12.5px; font-weight: 700;
      color: var(--text-secondary, #cbd5e1); border-bottom: none;
    }
    /* Inline rejection note row. */
    .pf-sre__grow-reject td {
      padding: 6px 10px; font-size: 12px; color: #fca5a5;
      background: rgba(248, 113, 113, 0.06);
    }
    /* Status dot + per-test note button (last slim column). */
    .pf-sre__gc-note { width: 56px; text-align: right; white-space: nowrap; }
    .pf-sre__gdot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
    .pf-sre__gdot--done { background: #34d399; }
    .pf-sre__gdot--rejected { background: #f87171; }
    .pf-sre__gnote {
      border: 1px solid var(--glass-border, rgba(148, 163, 184, 0.25));
      background: transparent; color: var(--text-tertiary, #94a3b8);
      border-radius: 8px; width: 26px; height: 26px; font-size: 12px; cursor: pointer;
    }
    .pf-sre__gnote:hover { color: var(--text-primary, #e2e8f0); background: rgba(148, 163, 184, 0.12); }
    .pf-sre__gnote--has { color: var(--violet-400, #a78bfa); border-color: rgba(167, 139, 250, 0.5); }

    /* Background autosave pill. */
    .pf-sre__autosave {
      display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto;
      align-self: center; font-size: 11.5px; font-weight: 600; color: var(--text-tertiary);
    }
    .pf-sre__autosave-dot { width: 7px; height: 7px; border-radius: 50%;
      background: var(--amber-text, #f59e0b); animation: pf-sre-pulse 1s ease-in-out infinite; }
    .pf-sre__autosave-dot--ok { background: #10b981; animation: none; }
    @keyframes pf-sre-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }

    .pf-sre__msg { color: var(--text-secondary); font-size: 13px; padding: 24px 0; text-align: center; }
    .pf-sre__msg--err { color: var(--red-text); }

    .pf-sre__test {
      padding: 16px 18px;
      margin-bottom: 14px;
      border-radius: 14px;
      background: var(--bg-card-solid, rgba(20, 22, 30, 0.6));
      border: 1px solid var(--glass-border);
    }
    .pf-sre__test--done {
      border-color: rgba(16, 185, 129, 0.4);
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.06), transparent 60%);
    }
    .pf-sre__test--rejected {
      border-color: rgba(239, 68, 68, 0.34);
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.06), transparent 60%);
    }
    .pf-sre__test-pill--rejected {
      background: rgba(239, 68, 68, 0.18);
      color: var(--red-text);
      border-color: rgba(239, 68, 68, 0.34);
    }
    .pf-sre__test-reject-reason {
      margin: -4px 0 12px;
      padding: 8px 12px;
      border-radius: 8px;
      background: rgba(239, 68, 68, 0.10);
      border-left: 3px solid #ef4444;
      font-size: 12.5px;
      color: var(--text-secondary);
    }
    .pf-sre__test-reject-reason strong {
      color: var(--red-text);
      margin-right: 4px;
    }

    /* Top-of-screen banner — appears once per re-entered sample. */
    .pf-sre__reject-banner {
      padding: 14px 16px;
      margin-bottom: 18px;
      border-radius: 12px;
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.14), rgba(239, 68, 68, 0.04));
      border: 1px solid rgba(239, 68, 68, 0.34);
    }
    .pf-sre__reject-banner-head {
      display: flex; align-items: center; gap: 10px;
      margin-bottom: 8px;
    }
    .pf-sre__reject-icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 24px; height: 24px;
      border-radius: 9999px;
      background: rgba(239, 68, 68, 0.22);
      color: var(--red-text);
      font-size: 13px; font-weight: 700;
      flex-shrink: 0;
    }
    .pf-sre__reject-title {
      font-size: 12px; font-weight: 700;
      letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--red-text);
    }
    .pf-sre__reject-list {
      list-style: none; margin: 0; padding: 0;
      display: flex; flex-direction: column; gap: 4px;
    }
    .pf-sre__reject-item {
      display: flex; gap: 10px; align-items: baseline;
      font-size: 13px; line-height: 1.4;
    }
    .pf-sre__reject-test {
      font-weight: 600; color: var(--text-primary); flex-shrink: 0;
    }
    .pf-sre__reject-test::after { content: ':'; }
    .pf-sre__reject-reason {
      color: var(--text-secondary); flex: 1; min-width: 0;
    }
    .pf-sre__test-hdr {
      display: flex; align-items: center; gap: 10px;
      margin-bottom: 12px;
    }
    .pf-sre__test-name { margin: 0; flex: 1; font-size: 16px; font-weight: 700; color: var(--text-primary); }
    .pf-sre__test-pill {
      font-size: 10.5px; font-weight: 700;
      letter-spacing: 0.06em; text-transform: uppercase;
      padding: 3px 10px; border-radius: 9999px;
      background: rgba(16, 185, 129, 0.18); color: var(--green-text);
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .pf-sre__test-empty { font-size: 13px; color: var(--text-tertiary); margin: 0; }

    /* Compact "+ Note" pill in the test header's right corner — replaces
       the previous full-width "Add Overall Observation" button which was
       consuming a vertical slot per test. Toggles a thread block beneath
       the header; once notes exist, the pill switches to "Notes (N)". */
    .pf-sre__note-btn {
      margin-left: auto;
      font-size: 11px; font-weight: 600;
      letter-spacing: 0.04em;
      padding: 4px 10px; border-radius: 9999px;
      background: rgba(168, 85, 247, 0.10);
      color: var(--violet-text);
      border: 1px solid rgba(168, 85, 247, 0.30);
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }
    .pf-sre__note-btn:hover {
      background: rgba(168, 85, 247, 0.18);
      border-color: rgba(168, 85, 247, 0.45);
    }
    .pf-sre__note-btn--has {
      background: rgba(96, 165, 250, 0.12);
      color: var(--blue-text);
      border-color: rgba(96, 165, 250, 0.35);
    }
    .pf-sre__note-btn--has:hover {
      background: rgba(96, 165, 250, 0.20);
      border-color: rgba(96, 165, 250, 0.50);
    }

    .pf-sre__params {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
    }
    @media (min-width: 720px) {
      .pf-sre__params { grid-template-columns: 1fr 1fr; }
    }
    .pf-sre__param { display: flex; flex-direction: column; gap: 4px; }
    .pf-sre__param-label { font-size: 12.5px; font-weight: 600; color: var(--text-secondary); }
    .pf-sre__unit { color: var(--text-tertiary); font-weight: 400; }
    .pf-sre__input {
      width: 100%; min-height: 38px;
      padding: 8px 12px;
      border-radius: 8px;
      background: var(--bg-input);
      border: 1.5px solid var(--input-border, var(--glass-border));
      color: var(--text-primary);
      font-size: 13.5px;
      font-family: inherit;
    }
    .pf-sre__input:focus { outline: none; border-color: #a855f7; box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.18); }
    .pf-sre__input--ta { resize: vertical; min-height: 56px; font-family: inherit; }
    
    /* Light mode: Make input borders more visible */
    :host-context(.light) .pf-sre__input {
      border: 1.5px solid #cbd5e1;
      background: var(--bg-input);
      box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.04);
      color: #1e293b;
    }
    :host-context(.light) .pf-sre__input:focus {
      border-color: #8b5cf6;
      box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.12);
    }
    .pf-sre__cb { width: 18px; height: 18px; }
    .pf-sre__hint { font-size: 10.5px; color: var(--text-tertiary); font-family: 'JetBrains Mono', ui-monospace, monospace; }

    /* New wrapper around the per-parameter <label> + comment thread.
       Wrapper is the grid cell; label is one block, thread is the
       sibling block — that's how the thread's buttons stay clickable
       (a label was eating their clicks). */
    .pf-sre__param-wrap {
      display: flex;
      flex-direction: column;
      gap: 0;
    }
    /* Soft red wash on the whole wrapper when a thread is open here. */
    .pf-sre__param-wrap--flagged {
      padding: 4px;
      margin: -4px;
      border-radius: 10px;
      background: rgba(239, 68, 68, 0.04);
    }

    /* Per-parameter conversation: small bump of breathing room from
       the input so the thread doesn't collide visually with the field. */
    .pf-sre__param-comments {
      margin-top: 8px;
    }
    /* Parameter has an open thread → flag the input visually so the
       tech focuses there before submitting. */
    .pf-sre__input--flagged {
      border-color: rgba(239, 68, 68, 0.6) !important;
      box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.10);
    }
    .pf-sre__select-wrap {
      border: 1px solid transparent;
      border-radius: 12px;
      transition: border-color 0.18s, box-shadow 0.18s;
    }
    .pf-sre__select-wrap.pf-sre__input--flagged {
      border-color: rgba(239, 68, 68, 0.6);
      box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.10);
    }
    .pf-sre__param-flag {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px; height: 16px;
      border-radius: 9999px;
      background: rgba(239, 68, 68, 0.22);
      color: var(--red-text);
      font-size: 10px; font-weight: 700;
      margin-left: 6px;
    }

    /* Overall thread block for a test — separates conversation from
       the parameter inputs below it. */
    .pf-sre__test-comments {
      margin-bottom: 14px;
      padding: 10px 12px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--glass-border);
    }

    .pf-sre__footer {
      position: sticky; bottom: 0; padding: 16px 0 0;
      /* Backdrop so scrolling test cards don't bleed under the submit
         bar now that the panel (not the window) is the scroll context. */
      background: linear-gradient(180deg, transparent, var(--bg-primary, rgba(12, 14, 20, 0.92)) 40%);
      margin-top: 4px;
      display: flex; align-items: stretch; gap: 10px;
     }
    .pf-sre__reopen {
      flex: 0 0 auto;
      padding: 0 18px; border-radius: 14px; cursor: pointer;
      font-size: 14px; font-weight: 600;
      background: var(--glass-bg); color: var(--text-secondary);
      border: 1px solid var(--glass-border);
    }
    .pf-sre__reopen:hover:not(:disabled) { color: var(--text-primary); border-color: rgba(168,85,247,0.4); }
    .pf-sre__reopen:disabled { opacity: 0.55; cursor: not-allowed; }
    .pf-sre__draft {
      flex: 0 0 auto;
      padding: 0 18px; border-radius: 14px; cursor: pointer;
      font-size: 14px; font-weight: 600;
      background: var(--glass-bg); color: var(--text-secondary);
      border: 1px solid var(--glass-border);
    }
    .pf-sre__draft:hover:not(:disabled) { color: var(--text-primary); border-color: rgba(168,85,247,0.4); }
    .pf-sre__draft:disabled { opacity: 0.55; cursor: not-allowed; }
    /* Mobile: lift the sticky Submit bar above the floating bottom-nav
       pill so the violet avatar doesn't peek out from behind the button.
       The pill body sits ~72px tall + safe-area; we add 16px breathing
       on top of that. iPad/desktop fall through unchanged. */
    @media (max-width: 640px) {
      /* Single mode on phone: hide the Grid/Form toggle entirely — grid is
         the one view here. Form logic + DOM are left intact; only this
         control is hidden, and only at <=640px. */
      .pf-sre__view { display: none; }

      /* The bottom action bar is gone on phone (submit moved to the header
         icon — see .pf-sre__footer{display:none} above). The scroll area only
         needs to clear the floating bottom-nav now. */
      .pf-sre { padding-bottom: calc(var(--tab-nav-total-height) + 8px); }

      /* Phone: a <table> can't look right at 390px. Convert it to a clean
         full-width row list — each parameter is ONE row: name (left, wraps) +
         result input + unit (right). That's all the tech needs on a phone.
         The dedicated UNIT / REFERENCE-RANGE / METHOD columns are dropped
         (!important so the block-display below can't resurrect them); the unit
         is re-shown inline next to the input. >=641px keeps the 5-col table. */
      .pf-sre__gc-unit,
      .pf-sre__gc-range,
      .pf-sre__gc-method,
      .pf-sre__grid thead { display: none !important; }
      .pf-sre__grid-wrap { width: 100%; border: 0; border-radius: 0; background: none; }
      .pf-sre__grid,
      .pf-sre__grid tbody { display: block; width: 100%; }

      .pf-sre__grow {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        box-sizing: border-box;
        padding: 9px 6px;
        border-bottom: 1px solid var(--glass-border);
        border-radius: 8px;
        transition: background 0.12s ease;
      }
      /* Focus: highlight the row whose input is being edited so the tech always
         knows which parameter the keyboard is targeting. */
      .pf-sre__grow:focus-within { background: rgba(168, 85, 247, 0.12); }
      /* Reset only the cells we still show (NO blanket td{display:block}, which
         previously out-specified the display:none above and brought the
         range/method columns back, overlapping everything). */
      .pf-sre__grow td { padding: 0; border: 0; background: none !important; }
      /* Param cell: number is a fixed-width prefix; the name wraps in its OWN
         column so a 2nd line ("(PCV)") aligns under the name's first letter,
         NOT under the number — a clean hanging indent. */
      td.pf-sre__gc-param {
        display: flex; align-items: baseline; gap: 8px;
        flex: 1 1 auto; min-width: 0;
      }
      .pf-sre__gc-param .pf-sre__gidx { flex: 0 0 auto; margin: 0; }
      .pf-sre__gc-param .pf-sre__gname { flex: 1 1 auto; min-width: 0; white-space: normal; line-height: 1.3; }

      /* Result cell IS the field box (fixed width → every row symmetric). The
         input is borderless and fills it; the unit sits INSIDE on the right. */
      td.pf-sre__gc-result {
        display: flex; align-items: center; gap: 4px;
        flex: 0 0 auto; width: 132px;
        min-height: 42px;
        padding: 0 10px;
        border: 1px solid var(--input-border, rgba(255,255,255,0.16));
        border-radius: 10px;
        background: var(--bg-input, rgba(255, 255, 255, 0.06));
      }
      td.pf-sre__gc-result:focus-within { border-color: rgba(168, 85, 247, 0.75); background: rgba(168, 85, 247, 0.12); }
      td.pf-sre__gc-result .pf-sre__ginput {
        flex: 1 1 auto; min-width: 0; min-height: 0;
        border: 0 !important; background: transparent !important; padding: 8px 0 !important;
        text-align: left;
      }
      td.pf-sre__gc-result .pf-sre__ginput--num { text-align: right; }
      td.pf-sre__gc-result .pf-sre__cb { flex: 0 0 auto; width: 24px; height: 24px; }
      .pf-sre__gunit-inline {
        display: inline-flex; align-items: center; flex: 0 0 auto;
        font-size: 11.5px; font-weight: 600;
        color: var(--text-tertiary);
        font-variant-numeric: tabular-nums; white-space: nowrap;
      }
      .pf-sre__grow-comments { display: block; width: 100%; }
      .pf-sre__grow-comments td { display: block; width: 100%; padding: 8px 2px; }

      /* Lock the test name (e.g. "Complete Blood Count (CBC)") as a sticky
         section header while its parameters scroll, until the next test's
         header pushes it up. Sits just below the sticky page header. */
      .pf-sre__test-hdr {
        position: sticky;
        top: 52px;            /* just below the compact sticky page header */
        z-index: 4;
        background: var(--bg-secondary, #0e1018);   /* opaque — hides rows scrolling under */
        margin: 0 -14px; padding: 12px 14px;
      }
    }
    .pf-sre__submit {
      flex: 1 1 auto;
      min-height: 48px;
      border-radius: 12px;
      background: var(--gradient-primary, linear-gradient(135deg, #a855f7, #d946ef));
      color: #fff;
      font-size: 15px; font-weight: 700;
      border: 2px solid transparent;
      cursor: pointer;
      box-shadow: 0 8px 24px rgba(168, 85, 247, 0.35);
      transition: transform 0.1s, box-shadow 0.2s, border-color 0.2s, background 0.2s;
      /* Improve rendering on some browsers/devices to avoid
         a tiny anti-aliasing seam at the rounded corners. */
      -webkit-font-smoothing: antialiased;
      backface-visibility: hidden;
      -webkit-backface-visibility: hidden;
      transform: translateZ(0);
      will-change: transform, box-shadow;
      /* Ensure background doesn't bleed into the transparent border */
      background-clip: padding-box;
    }
    .pf-sre__submit:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 12px 30px rgba(168, 85, 247, 0.45); }
    .pf-sre__submit:active { transform: scale(0.98); }
    .pf-sre__submit:disabled { opacity: 0.55; cursor: not-allowed; }

    /* Light mode button styling for better contrast */
    :host-context(.light) .pf-sre__submit {
      background: linear-gradient(135deg, #8b5cf6, #d946ef);
      border: 2px solid #cbd5e1;
      box-shadow: 0 4px 12px rgba(139, 92, 246, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.8);
    }
    :host-context(.light) .pf-sre__submit:hover:not(:disabled) {
      border-color: #b8a3f2;
      box-shadow: 0 6px 16px rgba(139, 92, 246, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.9);
    }
    :host-context(.light) .pf-sre__submit:active {
      box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);
    }

    .pf-sre__flags { list-style: none; margin: 16px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .pf-sre__flag {
      padding: 8px 12px;
      border-radius: 8px;
      background: var(--glass-bg);
      border-left: 3px solid var(--text-secondary);
      font-size: 12.5px;
    }
    .pf-sre__flag--crit { border-left-color: #ef4444; background: rgba(239, 68, 68, 0.08); }

    /* ── Cross-platform overrides (additive, scoped) ──────────────────
       All rules below ONLY apply below desktop, to touch pointers, or
       under platform html classes. Desktop-web (>=1280px, fine pointer)
       falls through every guard unchanged. */

    /* Phone: stop iOS Safari/Capacitor WKWebView from auto-zooming when a
       field gains focus. Any text-entry control under ~16px triggers it,
       so bump every input/select/textarea to 16px on the small breakpoint.
       Desktop keeps its tighter 13.5px since this is width-gated. */
    @media (max-width: 640px) {
      .pf-sre__input,
      .pf-sre__input--ta,
      .pf-sre__ginput,
      .pf-sre__ginput--num,
      .pf-sre__ginput--ta {
        font-size: 16px;
      }
      :host ::ng-deep .pf-sre__test select,
      :host ::ng-deep .pf-sre__test input,
      :host ::ng-deep .pf-sre__test textarea {
        font-size: 16px;
      }
    }

    /* Touch devices (coarse pointer, any width incl. iPad): grow the
       small header controls to a >=44px tap target. These are visual-
       only size bumps; the desktop fine-pointer path is untouched. */
    @media (pointer: coarse) {
      .pf-sre__back { min-height: 44px; }
      .pf-sre__view-btn { min-height: 36px; padding: 8px 14px; }
      .pf-sre__note-btn { min-height: 36px; padding: 8px 12px; }
      .pf-sre__submit { min-height: 52px; }
      .pf-sre__cb { width: 22px; height: 22px; }
      /* The result-entry fields themselves are the densest, most-tapped
         controls on this page yet were below the 44px touch floor (grid
         inputs had no min-height; form inputs were 38px). Raise them on
         coarse pointers only — desktop fine-pointer keeps its tighter
         density. Also lifts grid row height since the input drives it. */
      .pf-sre__input,
      .pf-sre__ginput,
      .pf-sre__ginput--num,
      .pf-sre__select-wrap { min-height: 44px; }
    }

    /* Hover affordances only where a hover-capable pointer exists, so
       touch taps don't leave sticky hover states. Mirror (not replace)
       the base hovers — base rules stay intact for fine-pointer/legacy. */
    @media (hover: none) {
      .pf-sre__back:hover { color: var(--text-secondary); }
      .pf-sre__view-btn:hover { color: var(--text-muted); }
      .pf-sre__submit:hover:not(:disabled) { transform: none; box-shadow: 0 8px 24px rgba(168, 85, 247, 0.35); }
      .pf-sre__grow:hover td { background: inherit; }
      .pf-sre__note-btn:hover { background: rgba(168, 85, 247, 0.10); border-color: rgba(168, 85, 247, 0.30); }
      .pf-sre__note-btn--has:hover { background: rgba(96, 165, 250, 0.12); border-color: rgba(96, 165, 250, 0.35); }
    }

    /* Capacitor native: the sticky Submit footer is this page's own
       bottom chrome. The width-gated rule above already lifts it over
       the floating bottom-nav + safe-area on phones; on native iPad
       (coarse pointer, >640px) the bottom-nav is hidden, so only honour
       the home-indicator inset there. */
    :host-context(html.cap-native) .pf-sre__footer {
      padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
    }
    @media (max-width: 640px) {
      :host-context(html.cap-native) .pf-sre__footer {
        bottom: var(--tab-nav-total-height);
        padding-bottom: 12px;
      }
    }

    .pf-sre__trend {
      display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
      margin: 10px 0 4px; padding: 10px 14px; border-radius: 12px;
      background: rgba(124,58,237,0.06); border: 1px solid rgba(168,85,247,0.22);
    }
    .pf-sre__trend-toggle { display: flex; align-items: center; gap: 9px; cursor: pointer; }
    .pf-sre__trend-toggle input { width: 16px; height: 16px; accent-color: #7c3aed; flex-shrink: 0; }
    .pf-sre__trend-toggle svg { color: #a855f7; flex-shrink: 0; }
    .pf-sre__trend-toggle span { display: flex; flex-direction: column; font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .pf-sre__trend-toggle em { font-style: normal; font-size: 11px; font-weight: 400; color: var(--text-tertiary); }
    .pf-sre__trend-sel {
      margin-left: auto; background: var(--input-bg, rgba(255,255,255,0.04));
      border: 1px solid var(--glass-border); border-radius: 8px; padding: 6px 10px;
      color: var(--text-primary); font-size: 12.5px;
    }
  `]
})
export class SampleResultEntryComponent {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly navBack = inject(NavBackService);
  private readonly auth = inject(AuthService);
  protected readonly formatPatient = formatPatientInfo;

  /** Signed-in technician shown on the right of the header. Uses displayName
   *  (the /me response has no separate login username field today). */
  readonly techName = computed(() => this.auth.user()?.displayName?.trim() || 'Technician');
  /** Medical registration ID beside the name — a dash until the user sets one
   *  (editable on the My signature screen). */
  readonly techRegId = computed(() => this.auth.user()?.registrationId?.trim() || '—');

  /** Entry blocks for the grid view.
   *  - 'flat'  → ONE column-header strip + a sequence of rows. Used for
   *    profile/package members (titled with the profile name) AND for plain
   *    single-parameter tests (untitled — the row already names the test, so
   *    no per-test header/card).
   *  - 'card'  → the classic per-test card, kept only where it's needed:
   *    multi-parameter standalone tests, cultures, and schema-less tests. */
  /** Keep the tube's tests in their authored display order (profile member
   *  sequence), and expose the logical count (a profile counts as ONE). */
  private normalizeSample(s: OrderSample | null): OrderSample | null {
    if (!s?.tests) return s;
    return { ...s, tests: sortTestsForDisplay(s.tests) };
  }
  readonly logicalCount = computed(() => logicalTestCount(this.sample()?.tests));

  /**
   * Header chips — one per LOGICAL test, matching the "N tests on this tube"
   * count beside them. A profile collapses to a single chip carrying its own
   * name; its member analytes are NOT listed here (a 20-analyte CBC used to
   * spray 20 chips across the header while the counter next to it said "1").
   * The members are already laid out in the profile's block below, which is
   * where the tech actually reads them.
   */
  /**
   * The bench grouping rule: results compile under a PROFILE, never under a
   * package. A package is a commercial wrapper — "3 profiles + 4 tests" must
   * appear as those 3 profile blocks and 4 individual tests. Nearest profile
   * (profileTestId) wins; legacy rows without it fall back by the bundle's
   * TYPE, and rows where even the type is unknown keep the old
   * group-by-bundle behaviour rather than silently splitting.
   */
  private benchGroup(t: OrderTest): { id: string; name: string } | null {
    if (t.profileTestId) return { id: t.profileTestId, name: t.profileName || t.packageName || 'Profile' };
    if (!t.packageTestId) return null;
    if (t.packageType === 'profile') return { id: t.packageTestId, name: t.packageName || 'Profile' };
    if (t.packageType) return null;               // known package → members stand alone
    return { id: t.packageTestId, name: t.packageName || 'Profile' };  // unknown → legacy behaviour
  }

  readonly headerChips = computed<string[]>(() => {
    const out: string[] = [];
    const seenPkg = new Set<string>();
    for (const t of this.sample()?.tests ?? []) {
      const grp = this.benchGroup(t);
      if (grp) {
        if (seenPkg.has(grp.id)) continue;
        seenPkg.add(grp.id);
        out.push(grp.name);
        continue;
      }
      out.push(t.test?.shortName || t.test?.name || 'Test');
    }
    return out;
  });

  readonly entryBlocks = computed<Array<
    { kind: 'flat'; key: string; title: string | null; tests: OrderTest[] } |
    { kind: 'card'; key: string; tests: OrderTest[] }
  >>(() => {
    const tests = this.sample()?.tests ?? [];
    const out: Array<
      { kind: 'flat'; key: string; title: string | null; tests: OrderTest[] } |
      { kind: 'card'; key: string; tests: OrderTest[] }
    > = [];
    const byPkg = new Map<string, { kind: 'flat'; key: string; title: string | null; tests: OrderTest[] }>();
    let loose: { kind: 'flat'; key: string; title: string | null; tests: OrderTest[] } | null = null;
    for (const t of tests) {
      const rowable = !this.isCultureTest(t) && this.parametersFor(t).length > 0;
      const grp = this.benchGroup(t);
      if (grp) {
        if (!rowable) { out.push({ kind: 'card', key: t.id, tests: [t] }); continue; }
        let g = byPkg.get(grp.id);
        if (!g) {
          g = { kind: 'flat', key: 'pkg-' + grp.id, title: grp.name, tests: [] };
          byPkg.set(grp.id, g);
          out.push(g);
        }
        g.tests.push(t);
        continue;
      }
      if (rowable && this.parametersFor(t).length === 1) {
        if (!loose) { loose = { kind: 'flat', key: 'loose', title: null, tests: [] }; out.push(loose); }
        loose.tests.push(t);
        continue;
      }
      out.push({ kind: 'card', key: t.id, tests: [t] });
    }
    return out.filter(b => b.tests.length > 0);
  });

  // ── Background autosave (manual Save draft is still available) ──────
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly _autosaving = signal(false);
  readonly autosaving = this._autosaving.asReadonly();
  private readonly _lastSavedAt = signal<Date | null>(null);
  readonly lastSavedLabel = computed(() => {
    const t = this._lastSavedAt();
    if (!t) return '';
    return `Saved ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  });

  private readonly _sample = signal<OrderSample | null>(null);
  private readonly _loading = signal<boolean>(true);
  private readonly _submitting = signal<boolean>(false);
  private readonly _savingDraft = signal<boolean>(false);
  readonly savingDraft = this._savingDraft.asReadonly();
  // values per OrderTestId → param.name → value
  private readonly _values = signal<Record<string, Record<string, unknown>>>({});
  private readonly _flags = signal<Array<{ label: string; note?: string; critical: boolean }>>([]);

  readonly sample = this._sample.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly submitting = this._submitting.asReadonly();

  // ── Trendogram: add serial-result trend charts to this order's report ──
  readonly trendEligible = signal<TrendTest[]>([]);
  readonly trendogramOn = signal(false);
  readonly trendogramDuration = signal('5');
  private trendPatientId: string | null = null;

  constructor() {
    effect(() => {
      const pid = this.sample()?.order?.patient?.id ?? null;
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
    const oid = this.sample()?.orderId ?? this.sample()?.order?.id;
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

  /** A submitted (awaiting-validation) test exists → can be re-opened to edit. */
  readonly hasReopenable = computed(() =>
    (this._sample()?.tests ?? []).some(t => t.status === 'entered'));
  /** At least one test is in an editable/submittable state. */
  readonly hasWritable = computed(() =>
    (this._sample()?.tests ?? []).some(t =>
      t.status !== 'entered' && t.status !== 'validated' && t.status !== 'rejected'));

  /** Load each test's last saved values into the form (used on first load and
   *  after a re-open, so the prior submitted values come back for editing). */
  private prefillValues(sample: OrderSample | null) {
    if (!sample?.tests) { this._values.set({}); return; }
    const init: Record<string, Record<string, unknown>> = {};
    for (const t of sample.tests) {
      if (!t.currentResult) continue;
      try { init[t.id] = (JSON.parse(t.currentResult)?.values) ?? {}; } catch { /* ignore */ }
    }
    this._values.set(init);
  }

  /** Retrieve & edit a submitted tube: reopen on the server (audited), then
   *  reload the values so the tech can change them and re-submit. */
  async reopenSample() {
    const s = this._sample();
    if (!s || this._submitting()) return;
    this._submitting.set(true);
    try {
      const updated = await firstValueFrom(this.api.post<OrderSample>(`/api/samples/${s.id}/reopen`, {}));
      if (updated) { this._sample.set(this.normalizeSample(updated)); this.prefillValues(updated); }
      this.toasts.success('Reopened — edit and submit again');
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this._submitting.set(false);
    }
  }
  readonly lastFlags = this._flags.asReadonly();

  /** Tests on this sample that the pathologist sent back for re-entry. */
  readonly rejectedTests = computed<OrderTest[]>(() =>
    (this._sample()?.tests ?? []).filter(t => t.status === 're_entry')
  );

  // ── Validator ↔ tech conversation ─────────────────────────────────
  // Loaded from /api/samples/:id/comments — flat list across every
  // test in the sample. The view splits it: overall (parameterName ===
  // null) under the test header, per-parameter inline under each
  // input field. See comment.model.ts for the threading shape.
  private readonly _comments = signal<OrderTestComment[]>([]);
  readonly comments = this._comments.asReadonly();

  /** Comments for a single test, optionally filtered to one parameter. */
  commentsFor(testId: string, parameterName: string | null = null): OrderTestComment[] {
    return this._comments().filter(c =>
      c.orderTestId === testId &&
      ((parameterName === null && !c.parameterName) || c.parameterName === parameterName)
    );
  }

  /** True if this parameter has at least one open thread — used to
      red-border the input so the tech focuses there. */
  hasOpenComment(testId: string, parameterName: string): boolean {
    return this._comments().some(c =>
      c.orderTestId === testId &&
      c.parameterName === parameterName &&
      !c.isResolved
    );
  }

  // Cached parsed parameters per test so JSON.parse runs once per render.
  private readonly _paramsByTest = computed<Map<string, TestParameter[]>>(() => {
    const out = new Map<string, TestParameter[]>();
    const s = this._sample();
    if (!s) return out;
    for (const t of s.tests ?? []) {
      const raw = t.test?.parameters;
      let params: TestParameter[] = [];
      let isCulture = false;
      if (raw) {
        try {
          const blob = JSON.parse(raw) as TestParametersBlob;
          params = blob.parameters ?? [];
          isCulture = blob.microFormat === 'culture_sensitivity';
        } catch { params = []; }
      }
      // A non-culture test with no configured parameter schema would otherwise
      // dead-end at "No parameter schema — this test has no inputs" and be
      // impossible to fill (this is why a multi-dept order where one dept's
      // tests had no schema couldn't be entered). Fall back to a single generic
      // "Result" field so EVERY non-culture test is always enterable.
      out.set(t.id, (params.length === 0 && !isCulture) ? [defaultResultParam()] : params);
    }
    return out;
  });

  parametersFor(t: OrderTest): TestParameter[] {
    return this._paramsByTest().get(t.id) ?? [];
  }

  // ── Microbiology Culture & Sensitivity ───────────────────────────────
  // Tests flagged microFormat=culture_sensitivity render the structured
  // culture screen (pf-culture-entry) instead of the flat parameter grid.
  // The whole CultureResult is stored as that test's values payload.
  private readonly _cultureTestIds = computed<Set<string>>(() => {
    const set = new Set<string>();
    for (const t of this._sample()?.tests ?? []) {
      const raw = t.test?.parameters;
      if (!raw) continue;
      try {
        if ((JSON.parse(raw) as TestParametersBlob).microFormat === 'culture_sensitivity') set.add(t.id);
      } catch { /* malformed blob → treat as non-culture */ }
    }
    return set;
  });
  isCultureTest(t: OrderTest): boolean { return this._cultureTestIds().has(t.id); }
  cultureValueFor(t: OrderTest): CultureResult { return (this._values()[t.id] ?? {}) as CultureResult; }
  setCulture(testId: string, v: CultureResult) {
    this._values.update(all => ({ ...all, [testId]: v as unknown as Record<string, unknown> }));
    this.scheduleDraftSave();
    this.scheduleServerAutosave();
  }

  // ── Background server autosave ────────────────────────────────────
  // A silent, debounced draft POST so typed-but-unsubmitted results reach
  // the server without the tech pressing Save draft. Unlike the manual
  // saveDraft() it does NOT navigate away, does NOT toast, and does NOT
  // reset the sample (which would disrupt in-progress typing). The manual
  // Save draft button stays exactly as-is.
  private scheduleServerAutosave() {
    if (this.autosaveTimer !== null) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => { this.autosaveTimer = null; void this.autoSaveDraft(); }, 2500);
  }

  private async autoSaveDraft() {
    const s = this._sample();
    if (!s || this._submitting() || this._savingDraft() || this._autosaving()) return;
    const all = this._values();
    const writable = (s.tests ?? []).filter(t => t.status !== 'validated' && t.status !== 'entered');
    const payload = {
      results: writable
        .filter(t => all[t.id] && Object.keys(all[t.id]).length > 0)
        .map(t => ({ orderTestId: t.id, values: all[t.id], note: undefined }))
    };
    if (payload.results.length === 0) return;
    this._autosaving.set(true);
    try {
      await firstValueFrom(
        this.api.post<BulkSubmitResponse>(`/api/samples/${s.id}/results/draft`, payload)
      );
      this._lastSavedAt.set(new Date());
      // Keep the local crash-recovery copy until a manual save/submit clears it.
    } catch {
      /* silent — the localStorage draft remains the fallback */
    } finally {
      this._autosaving.set(false);
    }
  }

  inputKindFor(p: TestParameter): 'number' | 'textarea' | 'select' | 'checkbox' | 'date' | 'text' {
    switch (p.type) {
      case 'numeric':
      case 'numeric_with_range': return 'number';
      case 'textarea':           return 'textarea';
      case 'select':
      case 'radio':
      case 'button_select':      return 'select';
      case 'yesno':
      case 'toggle':             return 'checkbox';
      case 'date':               return 'date';
      default:                   return 'text';
    }
  }

  /** Grid vs form view — grid is the default (mirrors report PDF columns).
   *  Persisted across sessions in localStorage. */
  private readonly _viewMode = signal<'grid' | 'form'>(
    (typeof localStorage !== 'undefined' && (localStorage.getItem('pf-sre-view') as 'grid' | 'form')) || 'grid'
  );
  readonly viewMode = this._viewMode.asReadonly();
  setViewMode(mode: 'grid' | 'form') {
    this._viewMode.set(mode);
    try { localStorage.setItem('pf-sre-view', mode); } catch { /* no-op */ }
  }

  /** Per-test "show overall observation thread" toggle. The thread block
   *  is heavy (composer textarea + buttons), so we keep it collapsed until
   *  the tech clicks the compact "+ Note" pill in the test header. Threads
   *  with existing comments stay always-visible (see template @if). */
  private readonly _overallOpen = signal<Set<string>>(new Set<string>());
  isOverallOpen(testId: string): boolean { return this._overallOpen().has(testId); }
  toggleOverall(testId: string) {
    const next = new Set(this._overallOpen());
    next.has(testId) ? next.delete(testId) : next.add(testId);
    this._overallOpen.set(next);
  }

  /** Pretty-formatted reference range for the grid's Range column. Handles
   *  the standard {min,max} pair plus the `ref_range` text fallback used
   *  for sex-segmented + qualitative ranges. */
  refLabelFor(p: TestParameter): string {
    const r = (p as TestParameter & { ref_range?: string }).ref_range;
    if (r) return r;
    // Every band, labelled ("Adult Male 13–17 · Adult Female 12–15"). This
    // showed referenceRanges[0] alone, so a tech entering a FEMALE patient's
    // haemoglobin was shown the MALE band to judge it against. This screen has
    // no patient sex/age in scope, so naming a single band would be a guess —
    // showing them all is the honest form, and the backend still decides the
    // flag that gets persisted and printed.
    const bands = describeAllRanges(p.referenceRanges);
    if (bands.length) return bands.join(' · ');
    if (p.normalValue) return p.normalValue;
    return '';
  }

  /** Methodology lives on the legacy TestParameter, dropped through from
   *  the importer. Returns '—' so the column never reads blank. */
  methodologyOf(p: TestParameter): string {
    return (p as TestParameter & { methodology?: string }).methodology || '—';
  }

  getValue(testId: string, paramName: string): unknown {
    return this._values()[testId]?.[paramName] ?? '';
  }

  setValue(testId: string, paramName: string, v: unknown) {
    this._values.update(all => ({
      ...all,
      [testId]: { ...(all[testId] ?? {}), [paramName]: v }
    }));
    this.scheduleDraftSave();
    this.scheduleServerAutosave();
  }

  // ── Local draft persistence ───────────────────────────────────────
  // Typed-but-unsubmitted values survive an app kill / reload: every
  // change autosaves the whole _values map to localStorage (debounced),
  // and the draft is overlaid on top of the server prefill on the next
  // load (draft wins — it's newer typing that never reached the server).
  // Cleared once the values DO reach the server (submitAll / saveDraft).
  private draftKey: string | null = null;
  private draftTimer: ReturnType<typeof setTimeout> | null = null;

  private scheduleDraftSave() {
    if (!this.draftKey) return;
    if (this.draftTimer !== null) clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => {
      this.draftTimer = null;
      try { localStorage.setItem(this.draftKey!, JSON.stringify(this._values())); } catch { /* private mode */ }
    }, 500);
  }

  private restoreDraft() {
    if (!this.draftKey) return;
    try {
      const raw = localStorage.getItem(this.draftKey);
      if (!raw) return;
      const draft = JSON.parse(raw) as Record<string, Record<string, unknown>>;
      this._values.update(all => {
        const merged = { ...all };
        for (const [testId, vals] of Object.entries(draft)) {
          merged[testId] = { ...(merged[testId] ?? {}), ...vals };
        }
        return merged;
      });
    } catch { /* private mode / malformed draft */ }
  }

  private clearDraft() {
    if (this.draftTimer !== null) { clearTimeout(this.draftTimer); this.draftTimer = null; }
    if (this.autosaveTimer !== null) { clearTimeout(this.autosaveTimer); this.autosaveTimer = null; }
    if (!this.draftKey) return;
    try { localStorage.removeItem(this.draftKey); } catch { /* private mode */ }
  }

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('sampleId');
    if (!id) { this._loading.set(false); return; }
    this.draftKey = `pf-lms.sre-draft.${id}`;
    try {
      const sample = await firstValueFrom(this.api.get<OrderSample>(`/api/samples/${id}/tests`));
      this._sample.set(this.normalizeSample(sample ?? null));
      // Pre-fill from any existing currentResult JSON so the tech can edit
      // a previously-entered value rather than starting from blank.
      this.prefillValues(sample ?? null);
      // Then overlay any locally-autosaved draft — typing that never
      // reached the server (app killed mid-entry) beats the prefill.
      this.restoreDraft();
      await this.loadComments();
    } catch (e) {
      this.toasts.error('Could not load sample');
    } finally {
      this._loading.set(false);
    }
  }

  private async loadComments() {
    const s = this._sample();
    if (!s) return;
    try {
      const list = await firstValueFrom(this.api.get<OrderTestComment[]>(`/api/samples/${s.id}/comments`));
      this._comments.set(list ?? []);
    } catch { /* non-fatal — entry still works without comments */ }
  }

  async addOverallComment(testId: string, body: string, type: 'observation' | 'correction') {
    await this.postComment(testId, null, null, body, type);
  }
  async replyToOverall(testId: string, parentId: string, body: string) {
    await this.postComment(testId, null, parentId, body, 'observation');
  }
  async addParameterComment(testId: string, paramName: string, body: string, type: 'observation' | 'correction') {
    await this.postComment(testId, paramName, null, body, type);
  }
  async replyToParameter(testId: string, paramName: string, parentId: string, body: string) {
    await this.postComment(testId, paramName, parentId, body, 'observation');
  }

  private async postComment(
    testId: string,
    parameterName: string | null,
    parentId: string | null,
    body: string,
    commentType: 'observation' | 'correction'
  ) {
    try {
      await firstValueFrom(this.api.post<OrderTestComment>(
        `/api/results/${testId}/comments`,
        { parameterName, parentId, commentType, body }
      ));
      await this.loadComments();
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    }
  }

  async submitAll() {
    const s = this._sample();
    if (!s || this._submitting()) return;
    this._submitting.set(true);
    const all = this._values();
    // Skip tests that the backend will refuse:
    //   - 'validated' is signed off (must be rejected before re-entry)
    //   - 'entered' is awaiting validation (re-saving overwrites the
    //     submitted value, which the backend blocks too)
    // The form pre-fills values for these from currentResult so they
    // can be SEEN, but submitting them would 409 the whole batch.
    const writable = (s.tests ?? []).filter(t =>
      t.status !== 'validated' && t.status !== 'entered'
    );
    const payload = {
      results: writable
        .filter(t => all[t.id] && Object.keys(all[t.id]).length > 0)
        .map(t => ({
          orderTestId: t.id,
          values: all[t.id],
          note: undefined
        }))
    };
    if (payload.results.length === 0) {
      const allDone = (s.tests ?? []).length > 0 && writable.length === 0;
      this.toasts.warning(allDone
        ? 'Every test on this tube is already submitted or validated.'
        : 'Enter at least one value before submitting');
      this._submitting.set(false);
      return;
    }
    try {
      const resp = await firstValueFrom(
        this.api.post<BulkSubmitResponse>(`/api/samples/${s.id}/results`, payload)
      );
      const flags: Array<{ label: string; note?: string; critical: boolean }> = [];
      for (const r of resp?.results ?? []) {
        const name = r.orderTest?.test?.name ?? 'Test';
        if (r.flags?.critical) {
          flags.push({ label: `${name}: critical`, critical: true });
        }
        for (const n of r.flags?.notifications ?? []) {
          flags.push({ label: name, note: n, critical: false });
        }
      }
      this._flags.set(flags);
      this._sample.set(this.normalizeSample(resp?.sample ?? s));
      // Values reached the server — the local crash-recovery draft is done.
      this.clearDraft();
      // Backend auto-resolves correction threads on submit (see
      // ResultService.EnterAsync). Reload to reflect the new
      // resolution state in the UI.
      await this.loadComments();
      const n = resp?.submitted ?? 0;
      this.toasts.success(`Submitted ${n} test${n === 1 ? '' : 's'} — back to your queue`);
      // Hand the tech back to /lab/my-work so they can pick the next
      // tube. Without this nav, submitAll only ever showed a toast and
      // the user was stuck on the now-empty entry page.
      setTimeout(() => this.router.navigate(['/lab/my-work']), 700);
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this._submitting.set(false);
    }
  }

  /** Save whatever is filled so far WITHOUT finalising — the tech can leave
   *  and come back to finish. Persists partial values to each test's draft
   *  (status stays in_progress) so reopening pre-fills them, and the tube shows
   *  as in-progress under "My Work". Mirrors submitAll but targets the draft
   *  endpoint (no plausibility/critical engine, no validation transition). */
  async saveDraft() {
    const s = this._sample();
    if (!s || this._submitting() || this._savingDraft()) return;
    const all = this._values();
    const writable = (s.tests ?? []).filter(t =>
      t.status !== 'validated' && t.status !== 'entered'
    );
    const payload = {
      results: writable
        .filter(t => all[t.id] && Object.keys(all[t.id]).length > 0)
        .map(t => ({ orderTestId: t.id, values: all[t.id], note: undefined }))
    };
    if (payload.results.length === 0) {
      this.toasts.warning('Nothing to save yet — enter a value first.');
      return;
    }
    this._savingDraft.set(true);
    try {
      const resp = await firstValueFrom(
        this.api.post<BulkSubmitResponse>(`/api/samples/${s.id}/results/draft`, payload)
      );
      this._sample.set(this.normalizeSample(resp?.sample ?? s));
      // Draft now lives on the server (currentResult prefills it next
      // open) — drop the local crash-recovery copy.
      this.clearDraft();
      this.toasts.success('Draft saved — you can finish this tube later');
      setTimeout(() => this.router.navigate(['/lab/my-work']), 600);
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this._savingDraft.set(false);
    }
  }

  back() { this.router.navigate(['/lab/my-work']); }
}
