import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { OrderSample, OrderTest } from '../../../shared/models/order.model';
import { TestParameter, TestParametersBlob } from '../../../shared/models/test.model';
import { OrderTestComment } from '../../../shared/models/comment.model';
import { CommentThreadComponent } from '../../../shared/components/comment-thread/comment-thread.component';
import { LoadingLogoComponent } from '../../../shared/components/loading-logo/loading-logo.component';
import { SelectComponent } from '../../../shared/primitives/select.component';
import { CultureEntryComponent } from '../culture-entry/culture-entry.component';
import { CultureResult } from '../../../shared/models/culture.model';

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
        <button type="button" class="pf-sre__back" (click)="back()" aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m15 18-6-6 6-6"/>
          </svg>
          Back
        </button>
        @if (sample(); as s) {
          <div class="pf-sre__hdr-title">
            <p class="pf-sre__eyebrow">{{ s.department?.code ?? 'Tube' }} · {{ s.barcode || '—' }}</p>
            <h1 class="pf-sre__title">{{ s.order?.patient?.displayName ?? 'Patient' }}</h1>
            <p class="pf-sre__sub">{{ s.tests.length }} test{{ s.tests.length === 1 ? '' : 's' }} on this tube</p>
          </div>
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
      </header>

      @if (loading()) {
        <div class="pf-sre__msg flex justify-center py-10">
          <pf-loading-logo size="xl" color="purple" [showDna]="true"
                           [showText]="true" text="Loading sample…"></pf-loading-logo>
        </div>
      } @else if (!sample()) {
        <p class="pf-sre__msg pf-sre__msg--err">Sample not found.</p>
      } @else {
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

        @for (t of sample()!.tests; track t.id) {
          <section class="pf-sre__test"
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
                          {{ p.title || p.name }}
                          @if (hasOpenComment(t.id, p.name)) {
                            <span class="pf-sre__param-flag" title="Pathologist commented">↻</span>
                          }
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

        <footer class="pf-sre__footer">
          <button type="button" class="pf-sre__submit"
                  [disabled]="submitting()"
                  (click)="submitAll()">
            {{ submitting() ? 'Submitting…' : 'Submit All Results' }}
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
      color: #c4b5fd;
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
      color: #c4b5fd;
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
      background: #ffffff;
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

    /* Mobile breakpoint — phones (<640px). Tighter every-thing so
       the form fits a 5" screen without horizontal scroll, and the
       submit button stays on screen so the tech doesn't lose it
       below the fold. */
    @media (max-width: 639px) {
      .pf-sre__hdr {
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
        padding-bottom: 12px;
        margin-bottom: 12px;
      }
      .pf-sre__title { font-size: 18px; }
      .pf-sre__sub { font-size: 11.5px; }
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
    .pf-sre__hdr-title { flex: 1; min-width: 0; }
    .pf-sre__eyebrow {
      margin: 0; font-size: 10.5px; font-weight: 700;
      letter-spacing: 0.12em; text-transform: uppercase;
      color: var(--text-tertiary);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }
    .pf-sre__title { margin: 4px 0 2px; font-size: 22px; font-weight: 700; color: var(--text-primary); }
    .pf-sre__sub { margin: 0; font-size: 12.5px; color: var(--text-secondary); }

    .pf-sre__msg { color: var(--text-secondary); font-size: 13px; padding: 24px 0; text-align: center; }
    .pf-sre__msg--err { color: #fca5a5; }

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
      color: #fca5a5;
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
      color: #fca5a5;
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
      color: #fca5a5;
      font-size: 13px; font-weight: 700;
      flex-shrink: 0;
    }
    .pf-sre__reject-title {
      font-size: 12px; font-weight: 700;
      letter-spacing: 0.08em; text-transform: uppercase;
      color: #fca5a5;
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
      background: rgba(16, 185, 129, 0.18); color: #6ee7b7;
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
      color: #c4b5fd;
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
      color: #93c5fd;
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
      background: #ffffff;
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
      color: #fca5a5;
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
     }
    /* Mobile: lift the sticky Submit bar above the floating bottom-nav
       pill so the violet avatar doesn't peek out from behind the button.
       The pill body sits ~72px tall + safe-area; we add 16px breathing
       on top of that. iPad/desktop fall through unchanged. */
    @media (max-width: 640px) {
      .pf-sre__footer {
        bottom: calc(72px + 12px + env(safe-area-inset-bottom, 0px));
        padding: 12px 0;
       
      }
      /* Each test card has its own table that overflows on a 375px
         viewport (PARAMETER | RESULT | UNIT | REF RANGE | METHOD = 5
         cols at ~80px each = 400px+). Wrap the table in a horizontal
         scroller so METHOD isn't clipped off the right edge. */
      .pf-sre__test table { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; max-width: 100%; }
      .pf-sre__test table thead, .pf-sre__test table tbody { display: table; width: max-content; min-width: 100%; }
      .pf-sre__test table th, .pf-sre__test table td { white-space: nowrap; padding-inline: 8px; }
    }
    .pf-sre__submit {
      width: 100%;
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
        bottom: calc(72px + 12px + env(safe-area-inset-bottom, 0px));
        padding-bottom: 12px;
      }
    }
  `]
})
export class SampleResultEntryComponent {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly _sample = signal<OrderSample | null>(null);
  private readonly _loading = signal<boolean>(true);
  private readonly _submitting = signal<boolean>(false);
  // values per OrderTestId → param.name → value
  private readonly _values = signal<Record<string, Record<string, unknown>>>({});
  private readonly _flags = signal<Array<{ label: string; note?: string; critical: boolean }>>([]);

  readonly sample = this._sample.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly submitting = this._submitting.asReadonly();
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
    const rr = p.referenceRanges?.[0];
    if (rr && rr.min != null && rr.max != null) return `${rr.min} – ${rr.max}`;
    if (rr && rr.min != null) return `> ${rr.min}`;
    if (rr && rr.max != null) return `< ${rr.max}`;
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
  }

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('sampleId');
    if (!id) { this._loading.set(false); return; }
    try {
      const sample = await firstValueFrom(this.api.get<OrderSample>(`/api/samples/${id}/tests`));
      this._sample.set(sample ?? null);
      // Pre-fill from any existing currentResult JSON so the tech can edit
      // a previously-entered value rather than starting from blank.
      if (sample?.tests) {
        const init: Record<string, Record<string, unknown>> = {};
        for (const t of sample.tests) {
          if (!t.currentResult) continue;
          try {
            const parsed = JSON.parse(t.currentResult);
            init[t.id] = parsed?.values ?? {};
          } catch { /* ignore malformed */ }
        }
        this._values.set(init);
      }
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
      this.toasts.error('Could not post comment');
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
      this._sample.set(resp?.sample ?? s);
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
      this.toasts.error('Could not submit — try again');
    } finally {
      this._submitting.set(false);
    }
  }

  back() { this.router.navigate(['/lab']); }
}
