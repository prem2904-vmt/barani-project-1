import { DOCUMENT, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy, Component, ElementRef, EventEmitter, HostListener,
  Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild,
  computed, inject, signal
} from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { Patient, patientDisplayName } from '../../../shared/models/patient.model';
import { ApiError } from '../../../shared/models/api-response.model';
import { Test } from '../../../shared/models/test.model';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { LoadingLogoComponent } from '../../../shared/components/loading-logo/loading-logo.component';

type DateRangePreset = 'any' | 'today' | 'yesterday' | '7d' | 'month' | 'custom';
type SexFilter = '' | 'male' | 'female' | 'other';

interface AdvancedFilters {
  phone: string;
  name: string;
  patientId: string;
  dateRange: DateRangePreset;
  dateFrom: string;
  dateTo: string;
  branchId: string;
  testIds: string[];
  age: string;
  sex: SexFilter;
}

interface SearchHit {
  patient: Patient;
  lastVisitAt?: string | null;
  lastBranchId?: string | null;
  lastBranchName?: string | null;
}

interface BranchSummary {
  id: string;
  name: string;
}

const EMPTY_FILTERS: AdvancedFilters = {
  phone: '', name: '', patientId: '',
  dateRange: 'any', dateFrom: '', dateTo: '',
  branchId: '', testIds: [], age: '', sex: ''
};

const DATE_PRESETS: Array<{ id: DateRangePreset; label: string }> = [
  { id: 'any',       label: 'Any date'  },
  { id: 'today',     label: 'Today'     },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d',        label: 'Last 7 days' },
  { id: 'month',     label: 'This month' },
  { id: 'custom',    label: 'Custom…'   }
];

const SEX_PRESETS: Array<{ id: SexFilter; label: string }> = [
  { id: '',       label: 'Any'    },
  { id: 'male',   label: 'Male'   },
  { id: 'female', label: 'Female' },
  { id: 'other',  label: 'Other'  }
];

const PAGE_SIZE = 20;

@Component({
  selector: 'pf-advanced-patient-search',
  standalone: true,
  imports: [DatePipe, AvatarComponent, SelectComponent, LoadingLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open) {
      <div class="pf-aps-root" role="dialog" aria-modal="true" aria-label="Advanced patient search">
        <div class="pf-aps-backdrop" (click)="close()"></div>

        <div class="pf-aps-shell">
          <header class="pf-aps-hdr">
            <div class="pf-aps-hdr-l">
              <span class="pf-aps-hdr-icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
                </svg>
              </span>
              <div>
                <h2 class="pf-aps-title">Search Patient</h2>
                <p class="pf-aps-sub">Combine fields to narrow down. At least one required.</p>
              </div>
            </div>
            <div class="pf-aps-hdr-r">
              <!-- Duplicate Reset removed — the action row's "Clear" button
                   already does the same. Two identical controls in
                   different positions was confusing. -->
              <button type="button" class="pf-aps-x" aria-label="Close" (click)="close()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
                </svg>
              </button>
            </div>
          </header>

          <section class="pf-aps-filters" (keydown.enter)="runSearch()">
            <div class="pf-aps-grid">
              <!-- Row 1 — four primary identifiers across the top -->
              <label class="pf-aps-field" style="grid-area: mobile">
                <span class="pf-aps-lbl">
                  Mobile number
                  <span class="pf-aps-pri" title="Highest priority match">priority</span>
                </span>
                <input #firstInput type="tel" class="pf-aps-inp" inputmode="numeric"
                       placeholder="+91 98765 43210"
                       [value]="filters().phone"
                       (input)="setFilter('phone', $any($event.target).value)" />
              </label>

              <label class="pf-aps-field" style="grid-area: name">
                <span class="pf-aps-lbl">Patient name</span>
                <input type="text" class="pf-aps-inp" placeholder="First or father's name"
                       [value]="filters().name"
                       (input)="setFilter('name', $any($event.target).value)" />
              </label>

              <label class="pf-aps-field" style="grid-area: pid">
                <span class="pf-aps-lbl">MRN</span>
                <input type="text" class="pf-aps-inp" placeholder="e.g. DEL-2605-004217-3"
                       [value]="filters().patientId"
                       (input)="setFilter('patientId', $any($event.target).value)" />
              </label>

              <label class="pf-aps-field" style="grid-area: age">
                <span class="pf-aps-lbl">Age</span>
                <input type="number" class="pf-aps-inp" min="0" max="130" placeholder="35"
                       [value]="filters().age"
                       (input)="setFilter('age', $any($event.target).value)" />
              </label>

              <div class="pf-aps-field" style="grid-area: sex">
                <span class="pf-aps-lbl">Sex</span>
                <div class="pf-aps-pills" role="tablist" aria-label="Sex">
                  @for (s of sexPresets; track s.id) {
                    <button type="button"
                            class="pf-aps-pill"
                            [class.pf-aps-pill--on]="filters().sex === s.id"
                            (click)="setSex(s.id)">
                      {{ s.label }}
                    </button>
                  }
                </div>
              </div>

              <!-- Row 2 — branch on the left, tests dominate the rest -->
              <label class="pf-aps-field" style="grid-area: branch">
                <span class="pf-aps-lbl">Branch</span>
                <pf-select
                  [options]="branchOptions()"
                  [value]="filters().branchId"
                  placeholder="Any branch"
                  (valueChange)="setFilter('branchId', $event)"></pf-select>
              </label>

              <div class="pf-aps-field" style="grid-area: tests">
                <span class="pf-aps-lbl">
                  Tests
                  @if (filters().testIds.length) {
                    <span class="pf-aps-count">{{ filters().testIds.length }} selected</span>
                  }
                </span>
                <div class="pf-aps-multi" [class.pf-aps-multi--open]="testPickerOpen()">
                  <button type="button" class="pf-aps-multi-trigger"
                          (click)="toggleTestPicker()"
                          [attr.aria-expanded]="testPickerOpen()">
                    @if (filters().testIds.length === 0) {
                      <span class="pf-aps-multi-placeholder">Pick one or more tests</span>
                    } @else {
                      <span class="pf-aps-chips">
                        @for (id of filters().testIds; track id) {
                          <span class="pf-aps-chip">
                            {{ testLabelById(id) }}
                            <button type="button" class="pf-aps-chip-x" aria-label="Remove"
                                    (click)="$event.stopPropagation(); toggleTest(id)">×</button>
                          </span>
                        }
                      </span>
                    }
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="m6 9 6 6 6-6"/>
                    </svg>
                  </button>
                  @if (testPickerOpen()) {
                    <div class="pf-aps-multi-pop" (click)="$event.stopPropagation()">
                      <input #testSearchInput type="text" class="pf-aps-multi-search"
                             placeholder="Search tests…"
                             [value]="testQuery()"
                             (input)="testQuery.set($any($event.target).value)" />
                      <div class="pf-aps-multi-list">
                        @for (t of filteredTests(); track t.id) {
                          <button type="button" class="pf-aps-multi-row"
                                  [class.pf-aps-multi-row--on]="filters().testIds.includes(t.id)"
                                  (click)="toggleTest(t.id)">
                            <span class="pf-aps-multi-check">
                              @if (filters().testIds.includes(t.id)) {
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                     stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                                  <path d="M20 6 9 17l-5-5"/>
                                </svg>
                              }
                            </span>
                            <span class="pf-aps-multi-name">{{ t.name }}</span>
                            @if (t.code) {
                              <span class="pf-aps-multi-meta">{{ t.code }}</span>
                            }
                          </button>
                        } @empty {
                          <div class="pf-aps-multi-empty">No tests match "{{ testQuery() }}"</div>
                        }
                      </div>
                    </div>
                  }
                </div>
              </div>

              <!-- Row 3 — visit-date pills span the full width so they stay
                   on a single line. Custom date inputs slide in next to the
                   pills only when 'Custom…' is selected. -->
              <div class="pf-aps-field" style="grid-area: date">
                <span class="pf-aps-lbl">Visit date</span>
                <div class="pf-aps-date-row">
                  <div class="pf-aps-pills" role="tablist" aria-label="Visit date range">
                    @for (p of datePresets; track p.id) {
                      <button type="button"
                              class="pf-aps-pill"
                              [class.pf-aps-pill--on]="filters().dateRange === p.id"
                              (click)="setDatePreset(p.id)">
                        {{ p.label }}
                      </button>
                    }
                  </div>
                  @if (filters().dateRange === 'custom') {
                    <div class="pf-aps-custom-range">
                      <input type="date" class="pf-aps-inp pf-aps-inp--sm" aria-label="From"
                             [value]="filters().dateFrom"
                             (input)="setFilter('dateFrom', $any($event.target).value)" />
                      <span class="pf-aps-range-sep" aria-hidden="true">→</span>
                      <input type="date" class="pf-aps-inp pf-aps-inp--sm" aria-label="To"
                             [value]="filters().dateTo"
                             (input)="setFilter('dateTo', $any($event.target).value)" />
                    </div>
                  }
                </div>
              </div>
            </div>

            <div class="pf-aps-actions">
              @if (errorMsg()) {
                <span class="pf-aps-err" role="alert">{{ errorMsg() }}</span>
              } @else {
                <span class="pf-aps-hint">
                  <kbd>Enter</kbd> to search · <kbd>Esc</kbd> to close
                </span>
              }
              <button type="button" class="pf-aps-btn pf-aps-btn--ghost"
                      [disabled]="!hasAnyFilter()"
                      (click)="reset()">Clear</button>
              <button type="button" class="pf-aps-btn pf-aps-btn--primary"
                      [disabled]="loading() || !hasAnyFilter()"
                      (click)="runSearch()">
                @if (loading()) {
                  <pf-loading-logo size="micro" color="white" [inline]="true"></pf-loading-logo>
                  Searching…
                } @else {
                  Search
                }
              </button>
            </div>
          </section>

          <section class="pf-aps-results">
            @switch (resultState()) {
              @case ('idle') {
                <div class="pf-aps-empty">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
                  </svg>
                  <h3>Enter at least one filter</h3>
                  <p>Mobile, patient ID, name, or any combination — we'll do the rest.</p>
                </div>
              }
              @case ('empty') {
                <div class="pf-aps-empty">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 8v4"/><path d="M12 16h.01"/><circle cx="12" cy="12" r="10"/>
                  </svg>
                  <h3>No patients found</h3>
                  <p>Try fewer filters or a partial spelling.</p>
                </div>
              }
              @case ('results') {
                <div class="pf-aps-table-wrap">
                  <table class="pf-aps-table">
                    <thead>
                      <tr>
                        <th>Patient</th>
                        <th>MRN</th>
                        <th>Mobile</th>
                        <th>Age / Sex</th>
                        <th>Last visit</th>
                        <th>Branch</th>
                        <th class="pf-aps-th-end">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (h of results(); track h.patient.id) {
                        <tr>
                          <td>
                            <button type="button" class="pf-aps-name-cell"
                                    (click)="onView(h.patient)">
                              <pf-avatar [name]="display(h.patient)" [size]="32"></pf-avatar>
                              <div class="pf-aps-name-stack">
                                <span class="pf-aps-name" [innerHTML]="highlightedName(h.patient)"></span>
                                @if (isExactMobile(h)) {
                                  <span class="pf-aps-tag pf-aps-tag--match" title="Exact mobile match">Best match</span>
                                }
                              </div>
                            </button>
                          </td>
                          <td>
                            @if (h.patient.mrn) {
                              <span class="pf-aps-mono" [title]="'MRN: ' + h.patient.mrn">{{ h.patient.mrn }}</span>
                            } @else {
                              <span class="pf-aps-muted">—</span>
                            }
                          </td>
                          <td>
                            @if (h.patient.phone) {
                              <span class="pf-aps-mono" [innerHTML]="highlightedPhone(h.patient)"></span>
                            } @else {
                              <span class="pf-aps-muted">—</span>
                            }
                          </td>
                          <td>
                            <span class="pf-aps-mono">
                              {{ h.patient.age ?? '—' }}@if (h.patient.age != null) {y} / {{ h.patient.sex ?? '—' }}
                            </span>
                          </td>
                          <td>
                            @if (h.lastVisitAt) {
                              {{ h.lastVisitAt | date:'mediumDate' }}
                            } @else {
                              <span class="pf-aps-muted">No visits</span>
                            }
                          </td>
                          <td>
                            @if (h.lastBranchName) {
                              <span class="pf-aps-branch">{{ h.lastBranchName }}</span>
                            } @else {
                              <span class="pf-aps-muted">—</span>
                            }
                          </td>
                          <td class="pf-aps-actions-cell">
                            <button type="button" class="pf-aps-row-btn" title="View profile" (click)="onView(h.patient)">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                              </svg>
                              View
                            </button>
                            <button type="button" class="pf-aps-row-btn pf-aps-row-btn--accent"
                                    title="Create new order" (click)="onNewOrder(h.patient)">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 5v14M5 12h14"/>
                              </svg>
                              Order
                            </button>
                            <button type="button" class="pf-aps-row-btn"
                                    title="Book appointment" (click)="onBookAppointment(h.patient)">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                   stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="3" y="4" width="18" height="18" rx="2"/>
                                <path d="M16 2v4M8 2v4M3 10h18"/>
                              </svg>
                              Book
                            </button>
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>

                  <footer class="pf-aps-table-foot">
                    <span class="pf-aps-foot-count">
                      Showing <strong>{{ results().length }}</strong> of <strong>{{ total() }}</strong>
                    </span>
                    @if (hasMore()) {
                      <button type="button" class="pf-aps-btn pf-aps-btn--ghost"
                              [disabled]="loadingMore()"
                              (click)="loadMore()">
                        @if (loadingMore()) {
                          <pf-loading-logo size="micro" color="purple" [inline]="true"></pf-loading-logo>
                          Loading…
                        } @else {
                          Load {{ remaining() }} more
                        }
                      </button>
                    }
                  </footer>
                </div>
              }
            }
          </section>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }

    /* ── Backdrop + shell ──────────────────────────────────── */
    /* z-index needs to beat the sticky top-strip (z-40) and any future
     * popover/dropdown. We portal this element to body on open so it
     * sits outside the shell-stack stacking context entirely — the real
     * escape hatch from any ancestor position:relative / transform that
     * would otherwise trap a position:fixed descendant. */
    .pf-aps-root {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 5vh 24px 24px;
    }
    .pf-aps-backdrop {
      position: absolute;
      inset: 0;
      background:
        radial-gradient(900px 600px at 50% 100%, rgba(124, 58, 237, 0.12), transparent 60%),
        rgba(5, 5, 15, 0.72);
      backdrop-filter: blur(14px) saturate(1.2);
      -webkit-backdrop-filter: blur(14px) saturate(1.2);
      animation: pf-aps-fade 0.18s ease-out both;
    }
    .pf-aps-shell {
      position: relative;
      width: 100%;
      max-width: 980px;
      max-height: 86dvh;
      display: flex;
      flex-direction: column;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      border-radius: 18px;
      box-shadow:
        0 1px 0 0 rgba(255, 255, 255, 0.04) inset,
        0 30px 70px rgba(0, 0, 0, 0.55),
        0 0 0 1px rgba(168, 85, 247, 0.06);
      overflow: hidden;
      animation: pf-aps-pop 0.24s cubic-bezier(0.2, 0.9, 0.25, 1.05) both;
    }

    /* ── Header ────────────────────────────────────────────── */
    .pf-aps-hdr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 18px 22px 14px;
      border-bottom: 1px solid var(--glass-border);
    }
    .pf-aps-hdr-l { display: flex; align-items: center; gap: 12px; }
    .pf-aps-hdr-icon {
      width: 36px; height: 36px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(168, 85, 247, 0.22), rgba(236, 72, 153, 0.12));
      border: 1px solid rgba(168, 85, 247, 0.3);
      color: var(--violet-text);
      box-shadow: 0 4px 14px rgba(124, 58, 237, 0.25);
    }
    .pf-aps-title {
      margin: 0;
      font-size: 17px;
      font-weight: 600;
      letter-spacing: -0.01em;
      color: var(--text-primary);
    }
    .pf-aps-sub {
      margin: 2px 0 0;
      font-size: 12.5px;
      color: var(--text-secondary);
    }
    .pf-aps-hdr-r { display: flex; align-items: center; gap: 6px; }
    .pf-aps-link {
      background: transparent;
      border: 0;
      color: var(--text-secondary);
      font-size: 13px;
      padding: 6px 10px;
      border-radius: 8px;
      cursor: pointer;
      transition: color 0.15s ease, background 0.15s ease;
    }
    .pf-aps-link:hover { color: var(--text-primary); background: var(--bg-hover); }
    .pf-aps-x {
      width: 32px; height: 32px;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 9px;
      color: var(--text-muted);
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    }
    .pf-aps-x:hover { background: var(--bg-hover); color: var(--text-primary); border-color: var(--glass-border); }

    /* ── Filters ───────────────────────────────────────────── */
    .pf-aps-filters {
      padding: 18px 22px 16px;
      border-bottom: 1px solid var(--glass-border);
    }
    /* 4-column grid sized so inputs match their data:
     *   Row 1 — Mobile · Name (2 cols, longest text) · Patient ID
     *   Row 2 — Age · Sex (2 cols, fits 4 pills) · Branch
     *   Row 3 — Tests, full-width so chips can breathe
     *   Row 4 — Visit date pills, full-width for a single line of presets
     * Tablet collapses to 2 cols; phone goes single-column.
     */
    .pf-aps-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      grid-template-areas:
        "mobile name   name    pid"
        "age    sex    sex     branch"
        "tests  tests  tests   tests"
        "date   date   date    date";
      gap: 14px 14px;
    }
    @media (max-width: 900px) {
      .pf-aps-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        grid-template-areas:
          "mobile name"
          "pid    branch"
          "age    sex"
          "tests  tests"
          "date   date";
      }
    }
    @media (max-width: 540px) {
      .pf-aps-grid {
        grid-template-columns: 1fr;
        grid-template-areas:
          "mobile" "name" "pid" "age" "sex" "branch" "tests" "date";
      }
    }

    .pf-aps-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .pf-aps-lbl {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 11.5px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      /* Brighter than --text-tertiary which disappears in light mode. */
      color: var(--text-secondary);
    }
    .pf-aps-pri {
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.1em;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(168, 85, 247, 0.20);
      color: #7c3aed;
      border: 1px solid rgba(168, 85, 247, 0.45);
      text-transform: uppercase;
    }

    /* The shared <pf-select> defaults to ~38px tall; pad it inside this
     * modal so all inputs read as one row of 44px controls. */
    :host ::ng-deep .pf-aps-field pf-select .pf-select {
      height: 44px;
      padding: 0.75rem 2.25rem 0.75rem 0.95rem;
      border-radius: 12px;
    }

    /* Touch target: ~44px tall (12px vertical padding + 1rem font + 1.4 line) */
    .pf-aps-inp {
      width: 100%;
      padding: 0.75rem 0.95rem;
      height: 44px;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      color: var(--input-text);
      border-radius: 12px;
      font-size: 0.9375rem;
      outline: none;
      transition: border-color 0.18s ease, box-shadow 0.18s ease;
    }
    .pf-aps-inp::placeholder { color: var(--text-muted); }
    .pf-aps-inp:focus {
      border-color: var(--input-border-focus);
      box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.18);
    }

    .pf-aps-count {
      font-size: 10.5px;
      font-weight: 600;
      letter-spacing: 0.04em;
      padding: 1px 6px;
      border-radius: 9999px;
      background: rgba(168, 85, 247, 0.18);
      border: 1px solid rgba(168, 85, 247, 0.32);
      color: #d8b4fe;
      text-transform: none;
      margin-left: 6px;
    }

    /* ── Date row (pills + optional custom range) ────────── */
    .pf-aps-date-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
    }
    /* Pill bars match the 44px input height for visual + touch parity. */
    .pf-aps-pills {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 4px;
      height: 44px;
      align-items: center;
      border-radius: 9999px;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
    }
    .pf-aps-pill {
      min-height: 36px;
      padding: 6px 14px;
      font-size: 13px;
      font-weight: 500;
      line-height: 1.2;
      border-radius: 9999px;
      border: 0;
      background: transparent;
      color: var(--text-secondary);
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .pf-aps-pill:hover { color: var(--text-primary); background: var(--bg-hover); }
    .pf-aps-pill--on {
      background: linear-gradient(135deg, #8b5cf6, #ec4899);
      color: white;
      box-shadow: 0 3px 10px rgba(124, 58, 237, 0.28);
    }
    .pf-aps-pill--on:hover { color: white; }

    .pf-aps-custom-range {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0 6px;
      border-left: 1px solid var(--glass-border);
    }
    .pf-aps-inp--sm {
      padding: 0.4rem 0.6rem;
      width: auto;
      min-width: 140px;
      font-size: 13px;
      border-radius: 8px;
    }
    .pf-aps-range-sep { color: var(--text-muted); font-size: 13px; }
    @media (max-width: 540px) {
      .pf-aps-custom-range { border-left: 0; padding: 0; width: 100%; }
      .pf-aps-inp--sm { flex: 1; }
    }

    /* ── Multi-select (tests) ─────────────────────────────── */
    .pf-aps-multi { position: relative; }
    .pf-aps-multi-trigger {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      min-height: 44px;
      padding: 6px 12px 6px 14px;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      border-radius: 12px;
      color: var(--input-text);
      font-size: 0.9375rem;
      cursor: pointer;
      text-align: left;
      transition: border-color 0.18s ease, box-shadow 0.18s ease;
    }
    .pf-aps-multi--open .pf-aps-multi-trigger {
      border-color: var(--input-border-focus);
      box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.18);
    }
    .pf-aps-multi-trigger svg { color: var(--text-muted); margin-left: auto; flex-shrink: 0; }
    .pf-aps-multi-placeholder { color: var(--text-muted); }

    .pf-aps-chips {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 4px;
      flex: 1;
      min-width: 0;
    }
    .pf-aps-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 4px 2px 8px;
      border-radius: 9999px;
      background: linear-gradient(135deg, rgba(168, 85, 247, 0.22), rgba(236, 72, 153, 0.16));
      border: 1px solid rgba(168, 85, 247, 0.34);
      color: #f5d0fe;
      font-size: 11.5px;
      font-weight: 500;
    }
    .pf-aps-chip-x {
      width: 16px;
      height: 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 9999px;
      background: rgba(0, 0, 0, 0.22);
      border: 0;
      color: inherit;
      cursor: pointer;
      font-size: 12px;
      line-height: 1;
      padding: 0;
    }
    .pf-aps-chip-x:hover { background: rgba(0, 0, 0, 0.4); }

    .pf-aps-multi-pop {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      right: 0;
      z-index: 5;
      max-height: 320px;
      display: flex;
      flex-direction: column;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      border-radius: 14px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
      overflow: hidden;
      animation: pf-aps-pop-fade 0.16s ease-out both;
    }
    .pf-aps-multi-search {
      width: 100%;
      padding: 10px 12px;
      background: transparent;
      border: 0;
      border-bottom: 1px solid var(--glass-border);
      color: var(--input-text);
      font-size: 13px;
      outline: none;
    }
    .pf-aps-multi-list {
      flex: 1;
      overflow-y: auto;
      padding: 4px;
    }
    .pf-aps-multi-row {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 8px 10px;
      background: transparent;
      border: 0;
      border-radius: 8px;
      color: var(--text-primary);
      cursor: pointer;
      text-align: left;
      transition: background 0.12s ease;
    }
    .pf-aps-multi-row:hover { background: var(--bg-hover); }
    .pf-aps-multi-row--on { background: linear-gradient(90deg, rgba(124, 58, 237, 0.14), rgba(124, 58, 237, 0.04)); }
    .pf-aps-multi-check {
      width: 18px;
      height: 18px;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 5px;
      border: 1.5px solid var(--input-border);
      color: white;
    }
    .pf-aps-multi-row--on .pf-aps-multi-check {
      background: linear-gradient(135deg, #8b5cf6, #ec4899);
      border-color: transparent;
    }
    .pf-aps-multi-name { flex: 1; font-size: 13px; }
    .pf-aps-multi-meta {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 11px;
      color: var(--text-muted);
    }
    .pf-aps-multi-empty {
      padding: 14px;
      text-align: center;
      font-size: 12.5px;
      color: var(--text-muted);
    }

    @keyframes pf-aps-pop-fade {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .pf-aps-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 14px;
    }
    .pf-aps-hint {
      flex: 1;
      font-size: 12px;
      color: var(--text-tertiary);
    }
    .pf-aps-hint kbd {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10.5px;
      padding: 1px 6px;
      border-radius: 5px;
      background: var(--bg-hover);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      margin: 0 2px;
    }
    .pf-aps-err {
      flex: 1;
      font-size: 12.5px;
      color: var(--red-text);
      font-weight: 500;
    }

    .pf-aps-btn {
      display: inline-flex; align-items: center; gap: 8px;
      min-height: 40px;
      padding: 0.6rem 1.1rem;
      font-size: 13px;
      font-weight: 600;
      border-radius: 10px;
      cursor: pointer;
      border: 1px solid transparent;
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, transform 0.05s ease;
    }
    .pf-aps-btn:active { transform: translateY(1px); }
    .pf-aps-btn[disabled] { opacity: 0.5; cursor: not-allowed; }
    .pf-aps-btn--ghost {
      background: transparent;
      border-color: var(--glass-border);
      color: var(--text-secondary);
    }
    .pf-aps-btn--ghost:hover:not([disabled]) { background: var(--bg-hover); color: var(--text-primary); }
    .pf-aps-btn--primary {
      background: linear-gradient(135deg, #8b5cf6, #ec4899);
      color: white;
      box-shadow: 0 6px 18px rgba(124, 58, 237, 0.35);
    }
    .pf-aps-btn--primary:hover:not([disabled]) { filter: brightness(1.08); }

    .pf-aps-spin {
      width: 13px; height: 13px;
      border-radius: 9999px;
      border: 2px solid rgba(255, 255, 255, 0.32);
      border-top-color: white;
      animation: pf-aps-spin 0.8s linear infinite;
      display: inline-block;
    }
    .pf-aps-btn--ghost .pf-aps-spin {
      border-color: rgba(168, 85, 247, 0.32);
      border-top-color: rgba(168, 85, 247, 0.9);
    }

    /* ── Results ───────────────────────────────────────────── */
    .pf-aps-results {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 8px 22px 18px;
    }
    /* When the modal is in the idle / empty state the body shouldn't
       balloon to fill the whole viewport — anchor at a sensible height. */
    .pf-aps-results:has(.pf-aps-empty) { flex: initial; }
    .pf-aps-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 28px 24px 32px;
      text-align: center;
      color: var(--text-secondary);
    }
    .pf-aps-empty svg { width: 28px; height: 28px; }
    .pf-aps-empty h3 { font-size: 14px; }
    .pf-aps-empty p { font-size: 12.5px; max-width: 32ch; }
    .pf-aps-empty h3 {
      margin: 6px 0 0;
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .pf-aps-empty p { margin: 0; font-size: 13px; max-width: 36ch; }
    .pf-aps-empty svg { color: var(--text-muted); opacity: 0.7; }

    .pf-aps-table-wrap {
      border: 1px solid var(--glass-border);
      border-radius: 14px;
      overflow: hidden;
      background: var(--bg-elevated, rgba(255, 255, 255, 0.02));
    }
    .pf-aps-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .pf-aps-table thead th {
      position: sticky;
      top: 0;
      background: rgba(0, 0, 0, 0.2);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      padding: 9px 14px;
      text-align: left;
      font-size: 10.5px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-tertiary);
      border-bottom: 1px solid var(--glass-border);
      z-index: 1;
    }
    .pf-aps-th-end { text-align: right; }
    .pf-aps-table tbody td {
      padding: 12px 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      color: var(--text-primary);
      vertical-align: middle;
    }
    .pf-aps-table tbody tr:last-child td { border-bottom: 0; }
    .pf-aps-table tbody tr {
      transition: background 0.12s ease;
    }
    .pf-aps-table tbody tr:hover {
      background: rgba(168, 85, 247, 0.06);
    }

    .pf-aps-name-cell {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
      text-align: left;
    }
    .pf-aps-name-cell:hover .pf-aps-name { color: #f3f4f6; }
    .pf-aps-name-stack {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      flex: 1;
    }
    .pf-aps-name {
      font-weight: 600;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* ::ng-deep is required because the highlight markup is injected via
     * [innerHTML] — Angular's emulated view encapsulation only adds the
     * _ngcontent attribute to template-authored DOM, so unprefixed
     * descendant selectors won't match the runtime-built <mark> nodes. The
     * default browser style (yellow background, black text) leaks through
     * unless we override it here. Scoped to .pf-aps-name and .pf-aps-mono
     * so the leak is contained to the search modal. */
    :host ::ng-deep .pf-aps-name mark,
    :host ::ng-deep .pf-aps-mono mark {
      background: rgba(168, 85, 247, 0.18);
      color: var(--violet-text);
      padding: 1px 3px;
      border-radius: 4px;
      font-weight: 600;
    }
    .pf-aps-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      width: max-content;
      font-size: 9.5px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 1px 5px;
      border-radius: 4px;
    }
    .pf-aps-tag--match {
      background: rgba(34, 197, 94, 0.12);
      border: 1px solid rgba(34, 197, 94, 0.22);
      color: #86efac;
    }
    /* Inline check glyph reads as 'best match' without the heavier label. */
    .pf-aps-tag--match::before {
      content: '✓';
      font-size: 10px;
      line-height: 1;
    }

    .pf-aps-mono {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 12.5px;
      color: var(--text-secondary);
    }
    .pf-aps-muted { color: var(--text-muted); font-style: italic; }
    .pf-aps-branch {
      font-size: 12.5px;
      color: var(--text-secondary);
    }

    .pf-aps-actions-cell {
      text-align: right;
      white-space: nowrap;
    }
    .pf-aps-row-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 5px 10px;
      margin-left: 4px;
      font-size: 12px;
      font-weight: 500;
      border-radius: 7px;
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-tertiary);
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    }
    .pf-aps-row-btn:hover {
      background: rgba(255, 255, 255, 0.04);
      color: var(--text-primary);
      border-color: var(--glass-border);
    }
    .pf-aps-row-btn--accent {
      color: var(--violet-text);
    }
    .pf-aps-row-btn--accent:hover {
      background: rgba(168, 85, 247, 0.12);
      border-color: rgba(168, 85, 247, 0.32);
      color: var(--violet-text);
    }

    .pf-aps-table-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      border-top: 1px solid var(--glass-border);
      background: var(--bg-card-solid);
    }
    .pf-aps-foot-count { font-size: 12.5px; color: var(--text-secondary); }
    .pf-aps-foot-count strong { color: var(--text-primary); font-weight: 600; }

    @keyframes pf-aps-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes pf-aps-pop {
      from { opacity: 0; transform: translateY(8px) scale(0.985); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes pf-aps-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      .pf-aps-backdrop, .pf-aps-shell, .pf-aps-spin { animation: none; }
    }

    /* Mobile = full screen */
    @media (max-width: 720px) {
      .pf-aps-root { padding: 0; }
      .pf-aps-shell {
        max-width: 100%;
        max-height: 100dvh;
        border-radius: 0;
        border: 0;
      }
      .pf-aps-table thead th { font-size: 10.5px; padding: 8px 10px; }
      .pf-aps-table tbody td { padding: 8px 10px; }
      .pf-aps-actions-cell .pf-aps-row-btn:not(:first-child) { display: none; }

      /* Phone: the single-column field stack can run taller than the screen,
         which previously pushed the Clear/Search row off the bottom with no
         way to scroll to it. Give the filter body its own constrained scroll
         region (min-height:0 so the flex child may shrink) and pin the action
         row as a sticky footer that always stays on screen — clearing the
         home indicator via the safe-area inset. */
      .pf-aps-filters {
        flex: 0 0 auto;
        min-height: 0;
        max-height: 60dvh;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        padding-bottom: 0;
      }
      .pf-aps-actions {
        position: sticky;
        bottom: 0;
        margin: 14px -22px 0;
        padding: 12px 22px max(12px, env(safe-area-inset-bottom));
        background: var(--bg-card-solid);
        border-top: 1px solid var(--glass-border);
      }
      /* Keep an open Tests dropdown stacked above the sticky action footer. */
      .pf-aps-multi--open { z-index: 3; }
    }
  `]
})
export class AdvancedPatientSearchComponent implements OnChanges, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly document = inject(DOCUMENT);
  // Whether we've moved this component's host element to <body>. We do this
  // on first open so the modal escapes any ancestor stacking context (the
  // shell-stack creates one, and Tailwind's `relative` on shell-main +
  // sticky top-strip would otherwise leave the modal trapped behind the
  // nav). Once portaled, we don't need to move it back — the host stays a
  // body child for the rest of its life and is removed on destroy.
  private _portaled = false;

  /** Imperative open flag — parent toggles, modal closes itself on ESC / X / pick. */
  @Input() open = false;
  /**
   * Pre-populate filters when the modal opens. When set on the same change
   * detection cycle as `open: true`, the modal also auto-runs the search.
   * This lets the parent restore state from the URL after a back-button
   * navigation so the user lands back on their last result set.
   */
  @Input() preset: AdvancedFilters | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() picked = new EventEmitter<Patient>();
  @Output() newOrder = new EventEmitter<Patient>();
  @Output() bookAppointment = new EventEmitter<Patient>();
  /** Fires whenever a search executes successfully — parent uses this to
   *  serialise the active filters into the URL for back-button restoration. */
  @Output() searchExecuted = new EventEmitter<AdvancedFilters>();

  @ViewChild('firstInput') firstInputRef?: ElementRef<HTMLInputElement>;

  protected readonly display = patientDisplayName;
  protected readonly datePresets = DATE_PRESETS;
  protected readonly sexPresets = SEX_PRESETS;

  protected readonly filters = signal<AdvancedFilters>({ ...EMPTY_FILTERS });
  private readonly _branches = signal<BranchSummary[]>([]);
  private readonly _tests = signal<Test[]>([]);
  private readonly _results = signal<SearchHit[]>([]);
  private readonly _total = signal(0);
  private readonly _loading = signal(false);
  private readonly _loadingMore = signal(false);
  private readonly _hasSearched = signal(false);
  private readonly _errorMsg = signal<string | null>(null);
  private readonly _testPickerOpen = signal(false);
  protected readonly testQuery = signal('');

  readonly results = this._results.asReadonly();
  readonly total = this._total.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly loadingMore = this._loadingMore.asReadonly();
  readonly errorMsg = this._errorMsg.asReadonly();
  readonly testPickerOpen = this._testPickerOpen.asReadonly();

  readonly hasMore = computed(() => this._results().length < this._total());
  readonly remaining = computed(() => Math.min(PAGE_SIZE, this._total() - this._results().length));

  readonly branchOptions = computed<PfSelectOption<string>[]>(() => {
    // De-dupe defensively by branch id — the API can return the same
    // branch via multiple sub-branch joins which made the dropdown
    // grow on every re-open.
    const seen = new Set<string>();
    const opts: PfSelectOption<string>[] = [{ value: '', label: 'Any branch' }];
    for (const b of this._branches()) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      opts.push({ value: b.id, label: b.name });
    }
    return opts;
  });

  readonly filteredTests = computed(() => {
    const q = this.testQuery().trim().toLowerCase();
    const list = this._tests();
    if (!q) return list.slice(0, 200);
    return list
      .filter(t =>
        t.name.toLowerCase().includes(q) ||
        (t.code ?? '').toLowerCase().includes(q))
      .slice(0, 200);
  });

  readonly resultState = computed<'idle' | 'empty' | 'results'>(() => {
    if (!this._hasSearched()) return 'idle';
    if (this._results().length === 0) return 'empty';
    return 'results';
  });

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open'] && this.open) {
      // Lazy-load branches the first time the modal opens so the dropdown is
      // populated. Using ngOnChanges (not effect) keeps this off the render
      // path when the modal is closed — we don't fetch tenants/branches until
      // the user actually opens the search.
      if (this._branches().length === 0) this.loadBranches();
      if (this._tests().length === 0) this.loadTests();
      this.portalToBody();
      // Auto-focus the priority field after the modal animates in.
      queueMicrotask(() => this.firstInputRef?.nativeElement.focus());

      // Restoring from URL: if the parent passed a preset and we're not
      // already mid-search, hydrate filters and auto-run. This is what
      // makes the back-button return the user to their last result set.
      if (this.preset && !this._hasSearched()) {
        this.filters.set({ ...EMPTY_FILTERS, ...this.preset });
        // Defer search until after focus + render so the inputs reflect the
        // preset before the spinner takes over.
        queueMicrotask(() => this.runSearch());
      }
    }
  }

  ngOnDestroy() {
    if (this._portaled && this.host.nativeElement.parentElement === this.document.body) {
      this.host.nativeElement.remove();
    }
  }

  private portalToBody() {
    if (this._portaled) return;
    const el = this.host.nativeElement;
    if (el.parentElement !== this.document.body) {
      this.document.body.appendChild(el);
    }
    this._portaled = true;
  }

  @HostListener('document:keydown.escape')
  onEsc() { if (this.open) this.close(); }

  setFilter<K extends keyof AdvancedFilters>(key: K, value: AdvancedFilters[K]) {
    // Sanitise text-y fields whose <input> can't enforce constraints
    // browser-side. Cleaning here keeps filter state always-valid.
    if (key === 'age' && typeof value === 'string') {
      const cleaned = (value as string).replace(/[^0-9]/g, '');
      if (cleaned === '') value = '' as AdvancedFilters[K];
      else {
        const n = Math.max(0, Math.min(130, parseInt(cleaned, 10) || 0));
        value = String(n) as AdvancedFilters[K];
      }
    } else if (key === 'patientId' && typeof value === 'string') {
      value = (value as string).replace(/[^A-Za-z0-9\-]/g, '') as AdvancedFilters[K];
    } else if (key === 'phone' && typeof value === 'string') {
      value = (value as string).replace(/[^0-9+]/g, '') as AdvancedFilters[K];
    } else if ((key === 'dateFrom' || key === 'dateTo') && typeof value === 'string') {
      const v = (value as string).trim();
      if (v === '') value = '' as AdvancedFilters[K];
      else {
        const d = new Date(v);
        const isoDay = isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
        if (isoDay !== v) {
          this._errorMsg.set(`Invalid date "${v}" — pick from the calendar`);
          return;
        }
      }
    }
    this.filters.update(f => ({ ...f, [key]: value }));
    if (this._errorMsg()) this._errorMsg.set(null);
  }

  hasAnyFilter(): boolean {
    const f = this.filters();
    return !!(f.phone || f.name || f.patientId
              || f.dateRange !== 'any'
              || f.branchId || f.testIds.length > 0 || f.age || f.sex);
  }

  setSex(sex: SexFilter) {
    this.filters.update(f => ({ ...f, sex }));
    if (this._errorMsg()) this._errorMsg.set(null);
  }

  setDatePreset(p: DateRangePreset) {
    this.filters.update(f => ({
      ...f,
      dateRange: p,
      // Custom keeps existing manual values; switching away clears them so a
      // future "Any date" doesn't accidentally re-send dates next search.
      dateFrom: p === 'custom' ? f.dateFrom : '',
      dateTo: p === 'custom' ? f.dateTo : ''
    }));
    if (this._errorMsg()) this._errorMsg.set(null);
  }

  toggleTestPicker() {
    this._testPickerOpen.update(v => !v);
    if (this._testPickerOpen()) this.testQuery.set('');
  }

  toggleTest(id: string) {
    this.filters.update(f => {
      const set = new Set(f.testIds);
      if (set.has(id)) set.delete(id); else set.add(id);
      return { ...f, testIds: [...set] };
    });
    if (this._errorMsg()) this._errorMsg.set(null);
  }

  testLabelById(id: string): string {
    return this._tests().find(t => t.id === id)?.name ?? id;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(ev: MouseEvent) {
    if (!this._testPickerOpen()) return;
    const target = ev.target as Node | null;
    if (!target) return;
    // Close the picker when clicking outside the multi-select widget.
    const root = this.host.nativeElement.querySelector('.pf-aps-multi');
    if (root && !root.contains(target)) this._testPickerOpen.set(false);
  }

  reset() {
    this.filters.set({ ...EMPTY_FILTERS });
    this._results.set([]);
    this._total.set(0);
    this._hasSearched.set(false);
    this._errorMsg.set(null);
    queueMicrotask(() => this.firstInputRef?.nativeElement.focus());
  }

  close() {
    this.closed.emit();
  }

  runSearch() {
    if (!this.hasAnyFilter()) {
      this._errorMsg.set('Enter at least one filter to search');
      return;
    }
    this._errorMsg.set(null);
    this._loading.set(true);
    this._hasSearched.set(true);
    const snapshot = this.filters();
    this.fetchPage(0).subscribe({
      next: ({ items, total }) => {
        this._results.set(items);
        this._total.set(total);
        this._loading.set(false);
        // Notify parent so it can persist filters into the URL — this is
        // what survives a navigation to the patient profile and restores
        // on back-button.
        this.searchExecuted.emit(snapshot);
      },
      error: err => {
        this._loading.set(false);
        this._errorMsg.set(this.parseError(err));
      }
    });
  }

  loadMore() {
    if (this.loadingMore() || !this.hasMore()) return;
    this._loadingMore.set(true);
    this.fetchPage(this._results().length).subscribe({
      next: ({ items }) => {
        this._results.update(prev => [...prev, ...items]);
        this._loadingMore.set(false);
      },
      error: () => this._loadingMore.set(false)
    });
  }

  private fetchPage(offset: number) {
    const params = this.buildQueryString(offset);
    return this.api.get<{ items: SearchHit[]; total: number }>(`/api/patients/advanced-search?${params}`);
  }

  private buildQueryString(offset: number): string {
    const f = this.filters();
    const params = new URLSearchParams();
    if (f.phone.trim()) params.set('phone', f.phone.trim());
    if (f.name.trim()) params.set('name', f.name.trim());
    if (f.patientId.trim()) params.set('mrn', f.patientId.trim());

    const { from, to } = this.resolveDateRange(f);
    if (from) params.set('dateFrom', from);
    if (to) params.set('dateTo', to);

    if (f.branchId) params.set('branchId', f.branchId);

    // Send each selected test as its own ?testName= key. Backend OR-merges
    // them so the patient must have ≥1 order containing ≥1 of the picks.
    for (const id of f.testIds) {
      const name = this.testLabelById(id);
      if (name) params.append('testName', name);
    }

    if (f.age.trim()) params.set('age', f.age.trim());
    if (f.sex) params.set('sex', f.sex);
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(offset));
    return params.toString();
  }

  private parseError(err: unknown): string {
    // Surface the REAL backend message for a failed search instead of a generic.
    return ApiError.from(err).message;
  }

  private loadBranches() {
    this.api.get<BranchSummary[]>('/api/tenants/branches').subscribe({
      next: list => this._branches.set(list ?? []),
      error: () => this._branches.set([])
    });
  }

  private loadTests() {
    this.api.get<Test[]>('/api/tests/').subscribe({
      next: list => this._tests.set((list ?? []).filter(t => t.isActive)),
      error: () => this._tests.set([])
    });
  }

  /**
   * Translate a date preset into ISO yyyy-MM-dd from/to bounds. The backend
   * treats the range as [from, to+1day) so a single-day preset (e.g. Today)
   * sets from=today and to=today.
   */
  private resolveDateRange(f: AdvancedFilters): { from: string; to: string } {
    if (f.dateRange === 'any') return { from: '', to: '' };
    if (f.dateRange === 'custom') return { from: f.dateFrom || '', to: f.dateTo || '' };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    switch (f.dateRange) {
      case 'today':     return { from: iso(today), to: iso(today) };
      case 'yesterday': {
        const y = new Date(today); y.setDate(y.getDate() - 1);
        return { from: iso(y), to: iso(y) };
      }
      case '7d': {
        const start = new Date(today); start.setDate(start.getDate() - 6);
        return { from: iso(start), to: iso(today) };
      }
      case 'month': {
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        return { from: iso(start), to: iso(today) };
      }
      default: return { from: '', to: '' };
    }
  }

  // ── Result-row helpers ─────────────────────────────────────
  isExactMobile(h: SearchHit): boolean {
    const filter = this.filters().phone.replace(/\D/g, '');
    if (!filter || !h.patient.phone) return false;
    return h.patient.phone.replace(/\D/g, '') === filter;
  }

  highlightedName(p: Patient): string {
    const name = patientDisplayName(p);
    const q = this.filters().name.trim();
    if (!q) return this.escapeHtml(name);
    return this.markMatches(name, q);
  }

  highlightedPhone(p: Patient): string {
    const phone = p.phone ?? '';
    const q = this.filters().phone.replace(/\D/g, '');
    if (!q) return this.escapeHtml(phone);
    // Highlight the digit-run match within the formatted phone.
    const idx = phone.replace(/\D/g, '').indexOf(q);
    if (idx < 0) return this.escapeHtml(phone);
    return this.markMatches(phone, q);
  }

  // ── Actions ────────────────────────────────────────────────
  // Don't close the modal here — the parent navigates to a different route
  // which unmounts the landing (and this modal) naturally. Closing
  // explicitly would clear the URL state we just persisted, breaking the
  // back-button restore.
  onView(p: Patient)            { this.picked.emit(p); }
  onNewOrder(p: Patient)        { this.newOrder.emit(p); }
  onBookAppointment(p: Patient) { this.bookAppointment.emit(p); }

  // ── Local utilities ────────────────────────────────────────
  private escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]!));
  }

  private markMatches(haystack: string, needle: string): string {
    const safe = this.escapeHtml(haystack);
    const safeNeedle = this.escapeHtml(needle).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!safeNeedle) return safe;
    const re = new RegExp(`(${safeNeedle})`, 'gi');
    return safe.replace(re, '<mark>$1</mark>');
  }
}
