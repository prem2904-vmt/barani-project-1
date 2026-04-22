import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnInit, QueryList, ViewChildren, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { TatIndicatorComponent } from '../../../shared/components/tat-indicator/tat-indicator.component';
import { OrderTest } from '../../../shared/models/order.model';
import { TestParameter, TestParametersBlob } from '../../../shared/models/test.model';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ChipComponent } from '../../../shared/primitives/chip.component';
import { NumPadComponent } from '../../../shared/primitives/num-pad.component';
import { TileComponent, TileTone } from '../../../shared/primitives/tile.component';

interface EnterResponse {
  orderTest: OrderTest;
  flags: { critical: boolean; notifications: string[] };
}

type FlagTone = 'critical' | 'low' | 'high' | 'normal';
interface Flag { tone: FlagTone; label: string }

@Component({
  selector: 'pf-result-entry',
  standalone: true,
  imports: [
    TatIndicatorComponent,
    AvatarComponent,
    ChipComponent,
    NumPadComponent,
    TileComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-page">
      <header class="pf-page__header px-4 md:px-8 lg:px-10 pt-4">
        <div class="pf-head">
          <button type="button" class="pf-head__back press" (click)="back()" aria-label="Back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
            <span class="hidden sm:inline">Back</span>
          </button>

          <h1 class="pf-head__title">{{ orderTest()?.test?.name ?? 'Result entry' }}</h1>

          @if (autoSavedAgo(); as t) {
            <span class="pf-autosave"><span class="pf-autosave__dot"></span>saved · {{ t }}</span>
          }

          <!-- Primary & secondary actions right-aligned in the header -->
          <div class="pf-head__actions">
            <button type="button" class="pf-head__btn pf-head__btn--ghost press"
                    (click)="rejectSample()" aria-label="Reject sample">
              Reject
            </button>
            <button type="button" class="pf-head__btn pf-head__btn--secondary press"
                    (click)="saveDraft()" [disabled]="saving()">
              Save draft
            </button>
            <button type="button"
                    class="pf-head__btn pf-head__btn--primary press"
                    [class.pf-head__btn--danger]="hasCritical()"
                    (click)="submit()"
                    [disabled]="saving() || !canSubmit()">
              {{ hasCritical() ? 'Submit · notify' : 'Submit' }}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12h14m-5-6 6 6-6 6"/>
              </svg>
            </button>
          </div>
        </div>
      </header>

      <!-- Body: static chrome around a scrolling param list.
           Mobile (<md): single col, FAB opens numpad drawer.
           Tablet / iPad (md to xl-): rail docked on the right.
           Desktop (xl+): no rail, full-width params. -->
      <div class="pf-page__body px-4 md:px-8 lg:px-10 grid grid-cols-1 md:grid-cols-[1fr_300px] lg:grid-cols-[1fr_340px] xl:grid-cols-1 gap-5">

        <!-- LEFT COLUMN — flex column, only params inside scroll -->
        <div class="pf-col-left min-w-0">

          <!-- Patient + TAT — single compact row -->
          @if (orderTest(); as t) {
            <pf-tile [tone]="panelTone()" padding="sm" class="pf-col-static pf-patient-tile">
              <div class="pf-patient-bar">
                <pf-avatar [name]="patientName()" [size]="40"></pf-avatar>
                <div class="pf-patient-bar__id">
                  <p class="pf-patient-bar__name">{{ patientName() }}</p>
                  <p class="pf-patient-bar__meta">
                    {{ patientSex() }} · {{ patientAge() }}y · {{ t.test?.department?.name ?? '—' }}
                    <span class="pf-patient-bar__sep">·</span> TAT {{ t.test?.tatHours }}h
                  </p>
                </div>
                <div class="pf-patient-bar__prog">
                  <div class="pf-tat-track">
                    <div class="pf-tat-fill"
                         [class]="'pf-tat-' + tatLevel()"
                         [style.width.%]="tatPercent()"></div>
                  </div>
                </div>
                <pf-tat-indicator [tatLevel]="tatLevel()" [remainingMinutes]="tatRemaining()"></pf-tat-indicator>
              </div>
            </pf-tile>
          }

          <!-- Results — the ONLY scrolling area on the page -->
          <!-- Critical values indicate themselves via row tint + flag pill;
               no separate banner needed. -->
          @if (parameters().length > 0) {
            <pf-tile tone="default" padding="sm" class="pf-col-scrolls">
              <header class="pf-col-scrolls__head pf-results-head">
                <span class="pf-results-head__eyebrow">Results</span>
                <span class="pf-results-head__count">
                  <span class="pf-results-head__filled">{{ filledCount() }}</span>
                  <span class="pf-results-head__sep">/</span>
                  <span class="pf-results-head__total">{{ requiredCount() }}</span>
                </span>
                <span class="pf-results-head__dots" aria-hidden="true">
                  @for (p of parameters(); track p.name) {
                    <span class="pf-dot-pip"
                          [class.pf-dot-pip--filled]="isFilled(p.name)"
                          [class.pf-dot-pip--active]="activeParam() === p.name"></span>
                  }
                </span>
                <span class="pf-results-head__pct">{{ filledPercentRounded() }}%</span>
              </header>

              <div class="pf-params pf-col-scrolls__body">
                @for (p of parameters(); track p.name; let idx = $index) {
                  <div class="pf-param"
                       [class.pf-param--active]="activeParam() === p.name"
                       [class.pf-param--critical]="isParamCritical(p)"
                       [attr.data-kind]="inputKindFor(p)"
                       (click)="setActive(p.name)">
                    <div class="pf-param__head">
                      <p class="pf-param__label">
                        <span class="pf-param__idx">{{ idx + 1 }}</span>
                        {{ p.title }}
                        <span class="pf-param__req">*</span>
                      </p>
                      <p class="pf-param__ref">
                        @if (refLabel(p); as r) { Reference: {{ r }} }
                        @else if (p.unit) { in {{ p.unit }} }
                      </p>
                    </div>

                    <!-- Input + inline flag live in the same cell; the flag pushes
                         to the right when present, otherwise input gets the full width. -->
                    <div class="pf-param__cell">
                      @switch (inputKindFor(p)) {
                        @case ('choice') {
                          <div class="pf-param__choices">
                            @for (opt of p.options ?? []; track opt) {
                              <pf-chip
                                [selected]="valueOf(p.name) === opt"
                                (tapped)="setValue(p.name, opt)">
                                {{ opt }}
                              </pf-chip>
                            }
                          </div>
                        }
                        @case ('radio') {
                          <div class="pf-param__radio">
                            @for (opt of p.options ?? []; track opt) {
                              <label class="pf-radio-row" (click)="setValue(p.name, opt)">
                                <span class="pf-radio-dot"
                                      [class.pf-radio-dot--on]="valueOf(p.name) === opt"></span>
                                <span>{{ opt }}</span>
                              </label>
                            }
                          </div>
                        }
                        @case ('yesno') {
                          <div class="pf-param__choices">
                            <pf-chip [selected]="valueOf(p.name) === 'yes'" (tapped)="setValue(p.name, 'yes')">Yes</pf-chip>
                            <pf-chip [selected]="valueOf(p.name) === 'no'"  (tapped)="setValue(p.name, 'no')">No</pf-chip>
                          </div>
                        }
                        @case ('text') {
                          <input type="text"
                                 class="pf-param__input"
                                 [value]="valueOf(p.name) ?? ''"
                                 (focus)="setActive(p.name)"
                                 (input)="setValue(p.name, asInput($event))"
                                 (keydown.enter)="advanceFrom(p.name)"
                                 [placeholder]="p.unit ?? ''"/>
                        }
                        @case ('textarea') {
                          <textarea class="pf-param__input pf-param__textarea"
                                    [value]="valueOf(p.name) ?? ''"
                                    (focus)="setActive(p.name)"
                                    (input)="setValue(p.name, asArea($event))"
                                    rows="3"
                                    placeholder="Notes…"></textarea>
                        }
                        @default {
                          <div class="pf-param__num">
                            <input type="text"
                                   inputmode="decimal"
                                   class="pf-param__input pf-param__input--num"
                                   [value]="valueOf(p.name) ?? ''"
                                   (focus)="setActive(p.name)"
                                   (input)="setValue(p.name, asInput($event))"
                                   (keydown.enter)="advanceFrom(p.name)"
                                   [attr.data-param]="p.name"
                                   #numInput
                                   [placeholder]="'—'"/>
                            @if (p.unit) { <span class="pf-param__unit">{{ p.unit }}</span> }
                          </div>
                        }
                      }

                      @if (flagFor(p); as f) {
                        @if (f.tone !== 'critical') {
                          <span class="pf-flag" [attr.data-tone]="f.tone">
                            <span class="pf-flag__dot"></span>
                            {{ f.label }}
                          </span>
                        }
                      }
                    </div>
                  </div>
                }
              </div>
            </pf-tile>
          } @else if (orderTest() && parameters().length === 0) {
            <pf-tile tone="amber" padding="lg" class="pf-col-static">
              <p class="text-[13px]" style="color: var(--text-primary);">
                This test has no parameter schema. Use free-form notes below, or ask an admin to configure parameters.
              </p>
            </pf-tile>
          }

          <!-- Notes — compact collapsed row -->
          <pf-tile tone="default" padding="sm" class="pf-col-static pf-notes-tile">
            <div class="pf-notes-wrap">
              <span class="pf-notes-label">Notes</span>
              <input type="text"
                     class="pf-notes-inline"
                     [value]="note()"
                     (focus)="clearActive()"
                     (input)="setNote(asInput($event))"
                     placeholder="Optional · visible to the validating pathologist"/>
            </div>
          </pf-tile>
        </div>

        <!-- RIGHT RAIL: always rendered. On lg+ lives in the grid column.
             On <lg it positions as a bottom drawer toggled by the FAB. -->
        <aside class="pf-rail" [class.pf-rail--drawer-open]="mobileRailOpen()">
          <div class="pf-rail__sticky">
            <div class="pf-rail__header">
              <div class="pf-rail__eyebrow-row">
                <p class="pf-rail__eyebrow">{{ railEyebrow() }}</p>
                <button type="button"
                        class="pf-rail__close press md:hidden"
                        (click)="closeMobileRail()"
                        aria-label="Hide keypad">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M6 6l12 12M18 6 6 18"/>
                  </svg>
                </button>
              </div>
              @if (activeParam(); as name) {
                <p class="pf-rail__target" [title]="titleFor(name)">
                  <span class="pf-rail__dot"></span>
                  {{ titleFor(name) }}
                </p>
                <p class="pf-rail__value">
                  <span class="pf-rail__value-num">{{ prettyValue(name) }}</span>
                  @if (unitFor(name); as u) { <span class="pf-rail__value-unit">{{ u }}</span> }
                </p>
              } @else {
                <p class="pf-rail__target pf-rail__target--idle">
                  <span class="pf-rail__dot pf-rail__dot--idle"></span>
                  Tap a field
                </p>
                <p class="pf-rail__value pf-rail__value--idle">—</p>
              }
            </div>

            <!-- Body: swaps based on active param kind -->
            @switch (railKind()) {
              @case ('numeric') {
                <pf-num-pad
                  [value]="(activeParam() ? (valueOf(activeParam()!) ?? '') : '').toString()"
                  [allowDecimal]="true"
                  [allowNegative]="false"
                  (valueChange)="padChange($event)"></pf-num-pad>
              }

              @case ('choice') {
                <div class="pf-rail__options">
                  @for (opt of activeOptions(); track opt) {
                    <button type="button"
                            class="pf-rail__opt press"
                            [class.pf-rail__opt--on]="valueOf(activeParam()!) === opt"
                            (click)="pickOption(opt)">
                      <span class="pf-rail__opt-tick">
                        @if (valueOf(activeParam()!) === opt) {
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
                            <path d="m5 12 4 4L19 6"/>
                          </svg>
                        }
                      </span>
                      <span class="pf-rail__opt-label">{{ opt }}</span>
                    </button>
                  }
                </div>
              }

              @case ('radio') {
                <div class="pf-rail__options">
                  @for (opt of activeOptions(); track opt) {
                    <button type="button"
                            class="pf-rail__opt press"
                            [class.pf-rail__opt--on]="valueOf(activeParam()!) === opt"
                            (click)="pickOption(opt)">
                      <span class="pf-radio-dot" [class.pf-radio-dot--on]="valueOf(activeParam()!) === opt"></span>
                      <span class="pf-rail__opt-label">{{ opt }}</span>
                    </button>
                  }
                </div>
              }

              @case ('yesno') {
                <div class="pf-rail__yesno">
                  <button type="button"
                          class="pf-rail__yn press"
                          [class.pf-rail__yn--on]="valueOf(activeParam()!) === 'yes'"
                          (click)="pickOption('yes')">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                      <path d="m5 12 4 4L19 6"/>
                    </svg>
                    Yes
                  </button>
                  <button type="button"
                          class="pf-rail__yn press"
                          [class.pf-rail__yn--on]="valueOf(activeParam()!) === 'no'"
                          (click)="pickOption('no')">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M6 6l12 12M18 6 6 18"/>
                    </svg>
                    No
                  </button>
                </div>
              }

              @case ('text') {
                <div class="pf-rail__kbd">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <rect x="2" y="6" width="20" height="12" rx="2"/>
                    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>
                  </svg>
                  <p>Type directly in the field. Press <kbd>Enter</kbd> to jump to the next.</p>
                </div>
              }

              @default {
                <div class="pf-rail__kbd">
                  <p>Tap any field on the left to begin.</p>
                </div>
              }
            }

            <div class="pf-rail__actions">
              <button type="button" class="pf-rail__next press" (click)="advance()" [disabled]="!hasNextEmpty()">
                Next empty
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12h14m-5-6 6 6-6 6"/>
                </svg>
              </button>
              <button type="button" class="pf-rail__clear press" (click)="clearActiveValue()" [disabled]="!activeParam()">
                Clear
              </button>
            </div>

            <p class="pf-rail__hint">
              <kbd>Tab</kbd>
              <span>between fields.</span>
              <kbd>Enter</kbd>
              <span>next empty.</span>
            </p>
          </div>
        </aside>

      </div>

      <!-- Mobile/tablet: backdrop dismisses the rail drawer -->
      @if (mobileRailOpen()) {
        <div class="pf-rail-backdrop md:hidden" (click)="closeMobileRail()"></div>
      }

      <!-- Mobile/tablet: FAB to toggle the rail drawer. Icon adapts to the
           active param kind so users know what's behind the button. -->
      <button type="button"
              class="pf-rail-fab press md:hidden"
              [class.pf-rail-fab--active]="mobileRailOpen()"
              (click)="toggleMobileRail()"
              [attr.aria-label]="mobileRailOpen() ? 'Hide input helper' : 'Show input helper'">
        @switch (railKind()) {
          @case ('numeric') {
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2"/>
              <path d="M7 9h.01M12 9h.01M17 9h.01M7 13h.01M12 13h.01M17 13h.01M7 17h10"/>
            </svg>
          }
          @case ('choice') {
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
            </svg>
          }
          @case ('radio') {
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>
            </svg>
          }
          @default {
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2"/>
              <path d="M7 9h.01M12 9h.01M17 9h.01M7 13h.01M12 13h.01M17 13h.01M7 17h10"/>
            </svg>
          }
        }
      </button>
    </section>
  `,
  styles: [`
    /* ── Patient bar (compact one-row banner) ─────────────────── */
    .pf-patient-tile { padding: 10px 14px !important; }
    .pf-patient-bar {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) minmax(120px, 220px) auto;
      align-items: center;
      gap: 14px;
    }
    @media (max-width: 767px) {
      .pf-patient-bar { grid-template-columns: auto 1fr auto; }
      .pf-patient-bar__prog { display: none; }
    }
    .pf-patient-bar__id { min-width: 0; }
    .pf-patient-bar__name {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
      letter-spacing: -0.01em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pf-patient-bar__meta {
      margin: 2px 0 0;
      font-size: 11.5px;
      color: var(--text-tertiary);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pf-patient-bar__sep { margin: 0 4px; opacity: 0.4; }

    /* ── TAT bar ──────────────────────────────────────────────── */
    .pf-tat-track {
      height: 6px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      overflow: hidden;
    }
    .pf-tat-fill {
      height: 100%;
      border-radius: 9999px;
      transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .pf-tat-normal { background: linear-gradient(90deg, #10b981, #34d399); box-shadow: 0 0 12px rgba(16, 185, 129, 0.45); }
    .pf-tat-high   { background: linear-gradient(90deg, #f59e0b, #fbbf24); box-shadow: 0 0 12px rgba(245, 158, 11, 0.45); }
    .pf-tat-urgent { background: linear-gradient(90deg, #ef4444, #f87171); box-shadow: 0 0 14px rgba(239, 68, 68, 0.55); }


    /* ── Results head — eyebrow + count + dot pips + % ──────── */
    .pf-results-head {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }
    .pf-results-head__eyebrow {
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: var(--text-muted);
    }
    .pf-results-head__count {
      display: inline-flex;
      align-items: baseline;
      gap: 2px;
      font-variant-numeric: tabular-nums;
    }
    .pf-results-head__filled {
      font-size: 20px;
      font-weight: 700;
      color: var(--text-primary);
      letter-spacing: -0.02em;
    }
    .pf-results-head__sep {
      font-size: 14px;
      color: var(--text-muted);
      margin: 0 2px;
    }
    .pf-results-head__total {
      font-size: 14px;
      color: var(--text-secondary);
      font-weight: 600;
    }
    .pf-results-head__dots {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex: 1;
      justify-content: center;
    }
    .pf-dot-pip {
      width: 8px;
      height: 8px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      transition: all 0.2s ease;
    }
    .pf-dot-pip--filled {
      background: var(--gradient-primary);
      border-color: transparent;
      box-shadow: 0 0 8px rgba(124, 58, 237, 0.6);
    }
    .pf-dot-pip--active {
      transform: scale(1.4);
      background: var(--gradient-primary);
      border-color: rgba(255, 255, 255, 0.3);
      box-shadow: 0 0 12px rgba(236, 72, 153, 0.8);
    }
    .pf-results-head__pct {
      font-size: 13px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      background: var(--gradient-primary);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -0.01em;
      min-width: 40px;
      text-align: right;
    }

    /* ── Param cards — adaptive grid ──
       Mobile: single column, label + input stack cleanly.
       Tablet+: multi-column adaptive flow. Multi-option (choice / radio /
       textarea) params always span the full row. */
    .pf-params {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
      align-items: stretch;  /* symmetric — every card in a row matches the tallest's height */
    }
    @media (min-width: 640px) {
      .pf-params { grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
    }
    .pf-param {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid var(--glass-border);
      background: var(--glass-bg);
      position: relative;
      cursor: pointer;
      transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.25s ease;
    }
    /* Push the input to the bottom so all numeric/text cards line up the same way. */
    .pf-param[data-kind='numeric'] .pf-param__cell,
    .pf-param[data-kind='text'] .pf-param__cell { margin-top: auto; }

    /* Only numeric + text cards participate in the multi-column grid.
       Choice / radio / yesno / textarea take the full row — they have their
       own layout needs (option chips, radio dots, multiline text) and don't
       benefit from sitting in a narrow grid cell. */
    .pf-param[data-kind='choice'],
    .pf-param[data-kind='radio'],
    .pf-param[data-kind='yesno'],
    .pf-param[data-kind='textarea'] {
      grid-column: 1 / -1;
    }
    .pf-param:hover {
      background: var(--glass-bg);
      border-color: var(--glass-border);
    }
    .pf-param--active {
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.16), rgba(236, 72, 153, 0.06)) !important;
      border-color: rgba(168, 85, 247, 0.5) !important;
      box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.14), 0 10px 28px rgba(124, 58, 237, 0.22);
    }
    .pf-param--active::before {
      content: '';
      position: absolute;
      left: -1px;
      top: 14%;
      bottom: 14%;
      width: 3px;
      border-radius: 3px;
      background: var(--gradient-primary);
      box-shadow: 0 0 10px rgba(168, 85, 247, 0.7);
    }

    /* Critical — the row becomes its own alert. Beats any top-of-page banner. */
    .pf-param--critical {
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.14), rgba(239, 68, 68, 0.04)) !important;
      border-color: rgba(239, 68, 68, 0.45) !important;
      box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);
    }
    .pf-param--critical::before {
      content: '';
      position: absolute;
      left: -1px;
      top: 14%;
      bottom: 14%;
      width: 3px;
      border-radius: 3px;
      background: linear-gradient(180deg, #ef4444, #db2777);
      box-shadow: 0 0 10px rgba(239, 68, 68, 0.7);
    }
    /* If a row is both active AND critical, the critical tint wins — the ::before accent
       also uses the red gradient so the user sees exactly which row is the problem. */
    .pf-param--critical.pf-param--active {
      box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.18), 0 10px 28px rgba(239, 68, 68, 0.22);
    }
    .pf-param--critical .pf-param__idx {
      background: linear-gradient(135deg, #ef4444, #db2777);
      border-color: transparent;
      color: #ffffff;
    }

    .pf-param__head {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    /* Input + flag area */
    .pf-param__cell {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .pf-param__cell > :first-child { flex: 1; min-width: 0; }
    .pf-param__cell .pf-param__num { flex: 1; min-width: 0; }

    /* Tablet+ only: pull the flag pill up to the card's top-right corner so the
       input cell gets the full width. Mobile keeps it inline for simplicity. */
    @media (min-width: 640px) {
      .pf-param[data-kind='numeric'] .pf-param__head,
      .pf-param[data-kind='text'] .pf-param__head { padding-right: 92px; }
      .pf-param[data-kind='numeric'] .pf-param__cell .pf-flag,
      .pf-param[data-kind='text'] .pf-param__cell .pf-flag {
        position: absolute;
        top: 10px;
        right: 12px;
      }
    }
    .pf-param__label {
      margin: 0;
      font-size: 13.5px;
      font-weight: 600;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 8px;
      line-height: 1.2;
    }
    .pf-param__idx {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 20px;
      height: 20px;
      padding: 0 5px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      font-size: 10.5px;
      font-weight: 700;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: var(--text-tertiary);
      flex-shrink: 0;
    }
    .pf-param--active .pf-param__idx {
      background: var(--gradient-primary);
      border-color: transparent;
      color: #ffffff;
      box-shadow: 0 3px 10px rgba(124, 58, 237, 0.5);
    }
    .pf-param__req { color: #f87171; font-weight: 700; margin-left: 2px; }
    .pf-param__ref {
      margin: 0 0 0 28px;
      font-size: 11px;
      color: var(--text-tertiary);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      line-height: 1.3;
    }

    .pf-param__num {
      position: relative;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .pf-param__input {
      flex: 1;
      min-width: 0;
      width: 100%;
      height: 42px;
      padding: 0 14px;
      border-radius: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      font-size: 15px;
      font-variant-numeric: tabular-nums;
      outline: none;
      transition: background 0.15s, border-color 0.15s, box-shadow 0.2s;
    }
    .pf-param__input:focus {
      background: var(--glass-bg-hover);
      border-color: rgba(168, 85, 247, 0.55);
      box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.18);
    }
    .pf-param--active .pf-param__input {
      background: rgba(255, 255, 255, 0.05);
      border-color: rgba(168, 85, 247, 0.45);
    }
    .pf-param__input--num {
      text-align: right;
      padding-right: 48px;
      font-size: 17px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    .pf-param__unit {
      position: absolute;
      right: 14px;
      font-size: 12px;
      color: var(--text-tertiary);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      pointer-events: none;
    }
    .pf-param__textarea { min-height: 56px; padding: 8px 12px; resize: vertical; font-size: 13px; height: auto; }

    .pf-param__choices { display: flex; flex-wrap: wrap; gap: 6px; }
    .pf-param__radio { display: flex; flex-wrap: wrap; gap: 16px; }
    .pf-radio-row {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 13.5px;
      color: var(--text-secondary);
      cursor: pointer;
    }
    .pf-radio-dot {
      width: 16px;
      height: 16px;
      border-radius: 9999px;
      border: 2px solid var(--border-muted);
      transition: all 0.15s;
    }
    .pf-radio-dot--on {
      border-color: transparent;
      background: var(--gradient-primary);
      box-shadow: 0 0 0 4px rgba(124, 58, 237, 0.18);
    }

    /* ── Live flag pill ─────────────────────────────────────── */
    .pf-flag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 13px;
      border-radius: 9999px;
      font-size: 11.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 600;
      border: 1px solid transparent;
      justify-self: start;
      white-space: nowrap;
      animation: pf-flag-in 0.25s ease both;
    }
    .pf-flag--empty {
      background: transparent;
      border-color: transparent;
      padding: 0;
      animation: none;
    }
    .pf-flag__dot { width: 6px; height: 6px; border-radius: 9999px; background: currentColor; }
    .pf-flag[data-tone='normal']   { background: rgba(16, 185, 129, 0.14);  color: #34d399; border-color: rgba(16, 185, 129, 0.3); }
    .pf-flag[data-tone='low']      { background: rgba(245, 158, 11, 0.14);  color: #fbbf24; border-color: rgba(245, 158, 11, 0.3); }
    .pf-flag[data-tone='high']     { background: rgba(245, 158, 11, 0.14);  color: #fbbf24; border-color: rgba(245, 158, 11, 0.3); }
    .pf-flag[data-tone='critical'] {
      background: rgba(239, 68, 68, 0.2);
      color: #fca5a5;
      border-color: rgba(239, 68, 68, 0.4);
      animation: pf-flag-crit 1.6s ease-in-out infinite, pf-flag-in 0.25s ease both;
      box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.08);
    }
    :root.light .pf-flag[data-tone='normal']   { color: #047857; }
    :root.light .pf-flag[data-tone='low'],
    :root.light .pf-flag[data-tone='high']     { color: #b45309; }
    :root.light .pf-flag[data-tone='critical'] { color: #b91c1c; }

    @keyframes pf-flag-in {
      from { opacity: 0; transform: translateY(-4px) scale(0.92); }
      to   { opacity: 1; transform: translateY(0)    scale(1); }
    }
    @keyframes pf-flag-crit {
      0%, 100% { box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.08); }
      50%      { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0.16); }
    }

    /* ── Notes ─────────────────────────────────────────────── */
    .pf-notes-tile { padding: 8px 12px !important; }
    .pf-notes-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .pf-notes-label {
      flex-shrink: 0;
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .pf-notes-inline {
      flex: 1;
      min-width: 0;
      height: 36px;
      padding: 0 10px;
      border-radius: 10px;
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-primary);
      font-size: 13px;
      outline: none;
      transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
    }
    .pf-notes-inline::placeholder { color: var(--text-muted); }
    .pf-notes-inline:hover {
      background: var(--glass-bg);
      border-color: var(--glass-border);
    }
    .pf-notes-inline:focus {
      background: var(--glass-bg-hover);
      border-color: rgba(168, 85, 247, 0.55);
      box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.18);
    }

    /* ── Right rail: lg+ is docked in the grid column, <lg is a bottom drawer ── */
    .pf-rail {
      display: block;
      min-height: 0;
      overflow: hidden;
      height: 100%;
    }
    /* Mobile only (<md, phone-size): the rail positions as a fixed bottom drawer,
       toggled by the FAB. Native keyboard is the default; users tap the FAB to
       reveal the touch keypad / option picker when they want it. */
    @media (max-width: 767px) {
      .pf-rail {
        position: fixed;
        left: 12px;
        right: 12px;
        bottom: calc(5.75rem + env(safe-area-inset-bottom, 0px));
        top: auto;
        height: auto;
        max-height: 70vh;
        z-index: 45;
        transform: translateY(120%) scale(0.98);
        opacity: 0;
        visibility: hidden;
        transition:
          transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1),
          opacity 0.2s ease,
          visibility 0s linear 0.25s;
      }
      .pf-rail--drawer-open {
        transform: translateY(0) scale(1);
        opacity: 1;
        visibility: visible;
        transition:
          transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1),
          opacity 0.2s ease,
          visibility 0s linear;
      }
      .pf-rail__sticky { max-height: 70vh; }
    }

    /* Backdrop behind the drawer on mobile/tablet */
    .pf-rail-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      z-index: 44;
      animation: pf-backdrop-in 0.2s ease both;
    }
    @keyframes pf-backdrop-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    /* Floating action button to toggle the rail drawer on mobile/tablet.
       Positioned above the bottom-nav pill, with a breathing-glow pulse so
       first-time users notice it. */
    .pf-rail-fab {
      position: fixed;
      right: 16px;
      bottom: calc(7.5rem + env(safe-area-inset-bottom, 0px));
      z-index: 46;
      width: 60px;
      height: 60px;
      border-radius: 9999px;
      background: var(--gradient-primary);
      color: #ffffff;
      border: 2px solid rgba(255, 255, 255, 0.18);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow:
        0 14px 36px rgba(124, 58, 237, 0.55),
        0 0 0 0 rgba(168, 85, 247, 0.45);
      transition:
        transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1),
        box-shadow 0.3s ease,
        background 0.25s ease,
        filter 80ms ease;
      animation: pf-fab-breathe 2.6s ease-in-out infinite;
    }
    @keyframes pf-fab-breathe {
      0%, 100% {
        box-shadow:
          0 14px 36px rgba(124, 58, 237, 0.55),
          0 0 0 0 rgba(168, 85, 247, 0.45);
      }
      50% {
        box-shadow:
          0 16px 40px rgba(124, 58, 237, 0.65),
          0 0 0 12px rgba(168, 85, 247, 0);
      }
    }
    .pf-rail-fab:hover {
      box-shadow: 0 18px 42px rgba(124, 58, 237, 0.7);
      animation-play-state: paused;
    }
    .pf-rail-fab:active { transform: scale(0.93); filter: brightness(1.08); }
    .pf-rail-fab--active {
      background: linear-gradient(135deg, #ef4444, #db2777);
      box-shadow: 0 14px 34px rgba(239, 68, 68, 0.55);
      transform: rotate(45deg);
      animation: none;
    }
    @media (prefers-reduced-motion: reduce) { .pf-rail-fab { animation: none; } }

    /* Tablet / iPad (md–xl-): rail is docked in the grid column, FAB + backdrop
       + close button all hidden (they're mobile-only affordances). */
    @media (min-width: 768px) {
      .pf-rail-fab,
      .pf-rail__close,
      .pf-rail-backdrop { display: none !important; }
    }
    /* Desktop (xl+) has a real keyboard — the whole rail is hidden so the
       params get the full viewport width. */
    @media (min-width: 1280px) {
      .pf-rail { display: none !important; }
    }

    /* ── Rail header row: eyebrow + close (mobile only) ── */
    .pf-rail__eyebrow-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .pf-rail__close {
      width: 32px;
      height: 32px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .pf-rail__close:hover { background: var(--glass-bg-hover); color: var(--text-primary); }

    .pf-rail__sticky {
      height: 100%;
      display: flex;
      flex-direction: column;
      padding: 18px;
      border-radius: 24px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
      backdrop-filter: blur(22px);
      -webkit-backdrop-filter: blur(22px);
      overflow: hidden;
    }
    .pf-rail__header { flex-shrink: 0; }
    .pf-rail__actions { flex-shrink: 0; }
    .pf-rail__hint    { flex-shrink: 0; }
    /* The central body (numpad / options / radio / yesno / kbd hint) gets
       whatever space is left between header and actions. */
    .pf-rail pf-num-pad,
    .pf-rail__options,
    .pf-rail__yesno,
    .pf-rail__kbd { flex-shrink: 0; }
    .pf-rail__options { max-height: 100%; overflow-y: auto; }

    .pf-rail__header { margin-bottom: 14px; }
    .pf-rail__eyebrow {
      margin: 0;
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .pf-rail__target {
      margin: 8px 0 0;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
      max-width: 100%;
      min-height: 22px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pf-rail__target--idle { color: var(--text-muted); font-weight: 500; font-size: 13px; }
    .pf-rail__dot {
      width: 8px;
      height: 8px;
      border-radius: 9999px;
      background: var(--gradient-primary);
      box-shadow: 0 0 10px rgba(168, 85, 247, 0.7);
      flex-shrink: 0;
    }
    .pf-rail__dot--idle {
      background: var(--text-muted);
      box-shadow: none;
      opacity: 0.5;
    }

    .pf-rail__value {
      margin: 6px 0 14px;
      display: flex;
      align-items: baseline;
      gap: 10px;
      padding: 14px 18px;
      border-radius: 16px;
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.22), rgba(236, 72, 153, 0.08));
      border: 1px solid rgba(168, 85, 247, 0.35);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 8px 24px rgba(124, 58, 237, 0.2);
      min-height: 64px;
      position: relative;
      overflow: hidden;
    }
    .pf-rail__value::before {
      content: '';
      position: absolute;
      inset: 0;
      background:
        radial-gradient(ellipse 60% 80% at 20% 30%, rgba(168, 85, 247, 0.25), transparent 60%),
        radial-gradient(ellipse 60% 80% at 80% 70%, rgba(236, 72, 153, 0.18), transparent 60%);
      pointer-events: none;
    }
    .pf-rail__value-num {
      position: relative;
      font-size: 32px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.03em;
      color: var(--text-primary);
      line-height: 1;
    }
    .pf-rail__value-unit {
      position: relative;
      font-size: 13px;
      color: var(--text-secondary);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }
    .pf-rail__value--idle {
      background: var(--glass-bg);
      border-color: var(--glass-border);
      box-shadow: none;
    }
    .pf-rail__value--idle::before { display: none; }
    .pf-rail__value--idle .pf-rail__value-num { color: var(--text-muted); font-size: 24px; }

    /* Rail body variants -------------------------------------- */
    .pf-rail__options {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding-right: 2px;
    }
    .pf-rail__opt {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 12px 14px;
      border-radius: 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      font-size: 14px;
      text-align: left;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, transform 80ms;
    }
    .pf-rail__opt:hover { background: var(--glass-bg-hover); }
    .pf-rail__opt:active { transform: scale(0.98); }
    .pf-rail__opt--on {
      background: var(--gradient-primary);
      border-color: transparent;
      color: #ffffff;
      box-shadow: 0 8px 22px rgba(124, 58, 237, 0.35);
    }
    .pf-rail__opt-tick {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 9999px;
      border: 2px solid var(--border-muted);
      flex-shrink: 0;
      transition: all 0.15s;
    }
    .pf-rail__opt--on .pf-rail__opt-tick {
      border-color: #ffffff;
      background: rgba(255, 255, 255, 0.18);
      color: #ffffff;
    }
    .pf-rail__opt-label { flex: 1; min-width: 0; }

    .pf-rail__yesno {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .pf-rail__yn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      height: 72px;
      border-radius: 18px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, transform 80ms;
    }
    .pf-rail__yn:hover { background: var(--glass-bg-hover); }
    .pf-rail__yn:active { transform: scale(0.98); }
    .pf-rail__yn--on {
      background: var(--gradient-primary);
      border-color: transparent;
      color: #ffffff;
      box-shadow: 0 8px 22px rgba(124, 58, 237, 0.35);
    }

    .pf-rail__kbd {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 32px 12px;
      text-align: center;
      color: var(--text-tertiary);
      font-size: 12.5px;
      line-height: 1.5;
    }
    .pf-rail__kbd svg { color: var(--text-muted); }
    .pf-rail__kbd kbd {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 26px;
      height: 20px;
      padding: 0 6px;
      border-radius: 6px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10.5px;
      color: var(--text-secondary);
      margin: 0 2px;
    }

    .pf-rail__actions {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      margin-top: 12px;
    }
    .pf-rail__next {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: 44px;
      padding: 0 14px;
      border-radius: 14px;
      background: var(--gradient-primary);
      color: #ffffff;
      font-size: 13px;
      font-weight: 600;
      border: 1px solid transparent;
      cursor: pointer;
      box-shadow: 0 6px 16px rgba(124, 58, 237, 0.35);
      transition: box-shadow 0.25s, transform 80ms, filter 80ms;
    }
    .pf-rail__next:hover:not(:disabled) {
      box-shadow: 0 10px 22px rgba(124, 58, 237, 0.5);
      transform: translateY(-1px);
    }
    .pf-rail__next:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; }
    .pf-rail__clear {
      height: 44px;
      padding: 0 14px;
      border-radius: 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .pf-rail__clear:hover:not(:disabled) {
      background: var(--glass-bg-hover);
      color: var(--text-primary);
    }
    .pf-rail__clear:disabled { opacity: 0.4; cursor: not-allowed; }

    .pf-rail__hint {
      margin: 12px 0 0;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 6px;
      font-size: 10.5px;
      color: var(--text-muted);
      line-height: 1.5;
    }
    .pf-rail__hint kbd {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 26px;
      height: 20px;
      padding: 0 6px;
      border-radius: 6px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10px;
      color: var(--text-secondary);
    }

    /* ── Page layout: content flows naturally. If content is short, the page
       hugs the content — no inflated empty boxes. If content overflows the
       viewport, the feature host's overflow-y: auto (from global CSS) scrolls. */
    :host {
      display: block;
      height: 100%;
      overflow-y: auto;
      overflow-x: hidden;
    }
    .pf-page {
      min-height: 100%;
      display: flex;
      flex-direction: column;
    }
    .pf-page__header { flex-shrink: 0; }
    .pf-page__body   {
      padding-top: 8px;
      padding-bottom: 12px;
    }

    /* ── Compact page header (pill row) ──────────────────────── */
    .pf-head {
      display: flex;
      align-items: baseline;
      gap: 10px;
      flex-wrap: wrap;
      padding: 6px 0 10px;
    }
    .pf-head__back {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 32px;
      padding: 0 10px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
      align-self: center;
      flex-shrink: 0;
    }
    .pf-head__back:hover { background: var(--glass-bg-hover); color: var(--text-primary); }
    .pf-head__eyebrow {
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: var(--text-muted);
      flex-shrink: 0;
    }
    .pf-head__title {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--text-primary);
      line-height: 1.1;
      flex-shrink: 0;
    }
    @media (min-width: 768px) { .pf-head__title { font-size: 26px; } }
    .pf-head__sep { color: var(--text-muted); opacity: 0.6; }
    .pf-head__sub {
      margin: 0;
      font-size: 13px;
      color: var(--text-secondary);
      min-width: 0;
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Left column: natural content flow — tiles stack at their content height.
       The feature host's overflow-y: auto (set globally) handles page overflow
       if there's too much content for the viewport. */
    .pf-col-left {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .pf-col-static { display: block; }
    .pf-col-scrolls { display: block; }
    .pf-col-scrolls__head { }
    .pf-col-scrolls__body { }

    /* ── Header action cluster (replaces the old bottom action bar) ── */
    .pf-head__actions {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }
    .pf-head__btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: 36px;
      padding: 0 14px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      font-family: inherit;
      border: 1px solid transparent;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.25s ease, transform 80ms ease;
    }
    .pf-head__btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .pf-head__btn--ghost {
      background: transparent;
      color: #fca5a5;
      border-color: transparent;
    }
    .pf-head__btn--ghost:hover:not(:disabled) {
      background: rgba(239, 68, 68, 0.12);
      color: #fca5a5;
    }
    :root.light .pf-head__btn--ghost { color: #b91c1c; }

    .pf-head__btn--secondary {
      background: var(--glass-bg);
      color: var(--text-primary);
      border-color: var(--glass-border);
    }
    .pf-head__btn--secondary:hover:not(:disabled) {
      background: var(--glass-bg-hover);
      border-color: var(--glass-border-hover);
    }

    .pf-head__btn--primary {
      background: var(--gradient-primary);
      color: #ffffff;
      box-shadow: 0 6px 18px rgba(124, 58, 237, 0.4);
    }
    .pf-head__btn--primary:hover:not(:disabled) {
      box-shadow: 0 10px 26px rgba(124, 58, 237, 0.55);
      transform: translateY(-1px);
    }
    .pf-head__btn--danger {
      background: linear-gradient(135deg, #ef4444, #db2777);
      box-shadow: 0 6px 18px rgba(239, 68, 68, 0.45);
    }
    .pf-head__btn--danger:hover:not(:disabled) {
      box-shadow: 0 10px 26px rgba(239, 68, 68, 0.6);
    }

    /* Autosave status chip inline with the eyebrow */
    .pf-autosave {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      margin-left: 10px;
      padding: 2px 8px;
      border-radius: 9999px;
      background: rgba(16, 185, 129, 0.14);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #34d399;
      font-size: 10px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      text-transform: none;
      letter-spacing: 0;
    }
    :root.light .pf-autosave { color: #047857; }
    .pf-autosave__dot {
      width: 6px;
      height: 6px;
      border-radius: 9999px;
      background: #34d399;
      box-shadow: 0 0 6px rgba(52, 211, 153, 0.7);
    }

    /* On narrow screens, allow the action cluster to wrap onto a second header row. */
    @media (max-width: 640px) {
      .pf-head { row-gap: 8px; }
      .pf-head__actions {
        order: 10;
        width: 100%;
        justify-content: flex-end;
        margin-left: 0;
      }
    }
  `]
})
export class ResultEntryComponent implements OnInit, AfterViewInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(DialogService);
  private readonly host = inject(ElementRef<HTMLElement>);

  @ViewChildren('numInput') private numInputs!: QueryList<ElementRef<HTMLInputElement>>;

  private readonly _ot = signal<OrderTest | null>(null);
  private readonly _saving = signal(false);
  private readonly _values = signal<Record<string, unknown>>({});
  private readonly _note = signal<string>('');
  private readonly _active = signal<string | null>(null);
  private readonly _lastSavedAt = signal<Date | null>(null);
  private readonly _now = signal<number>(Date.now());
  private readonly _mobileRailOpen = signal<boolean>(false);
  readonly mobileRailOpen = this._mobileRailOpen.asReadonly();

  readonly orderTest = this._ot.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly activeParam = this._active.asReadonly();
  readonly note = this._note.asReadonly();

  private readonly _paramsBlob = computed<TestParametersBlob | null>(() => {
    const raw = this._ot()?.test?.parameters;
    if (!raw) return null;
    try { return JSON.parse(raw) as TestParametersBlob; } catch { return null; }
  });
  readonly parameters = computed<TestParameter[]>(() => this._paramsBlob()?.parameters ?? []);

  readonly requiredCount = computed(() => this.parameters().length);
  readonly filledCount = computed(() => {
    const v = this._values();
    return this.parameters().filter(p => {
      const x = v[p.name];
      return x !== undefined && x !== null && x !== '';
    }).length;
  });
  readonly filledPercent = computed(() => {
    const r = this.requiredCount();
    return r ? (this.filledCount() / r) * 100 : 0;
  });
  readonly filledPercentRounded = computed(() => Math.round(this.filledPercent()));

  isFilled(name: string): boolean {
    const v = this._values()[name];
    return v !== undefined && v !== null && v !== '';
  }

  isParamCritical(p: TestParameter): boolean {
    return this.flagFor(p)?.tone === 'critical';
  }
  readonly canSubmit = computed(() => this.filledCount() === this.requiredCount() && this.requiredCount() > 0);

  // TAT
  readonly tatElapsedMin = computed(() => {
    const ral = this._ot()?.subOrder?.receivedAtLab;
    if (!ral) return 0;
    return Math.max(0, (Date.now() - new Date(ral).getTime()) / 60000);
  });
  readonly tatBudgetMin = computed(() => (this._ot()?.test?.tatHours ?? 0) * 60);
  readonly tatRemaining = computed(() => this.tatBudgetMin() - this.tatElapsedMin());
  readonly tatLevel = computed<'urgent' | 'high' | 'normal'>(() => {
    const r = this.tatRemaining();
    if (r <= 0) return 'urgent';
    if (r <= 60) return 'high';
    return 'normal';
  });
  readonly tatPercent = computed(() => {
    const b = this.tatBudgetMin();
    if (!b) return 0;
    return Math.max(0, Math.min(100, (this.tatElapsedMin() / b) * 100));
  });

  readonly patientName = computed(() => this._ot()?.subOrder?.order?.patient?.name ?? '—');
  readonly patientSex  = computed(() => this._ot()?.subOrder?.order?.patient?.sex ?? '—');
  readonly patientAge  = computed(() => this._ot()?.subOrder?.order?.patient?.age ?? '—');

  readonly subtitle = computed(() => {
    if (!this._ot()) return 'Capturing parameter values for this test.';
    const rem = this.tatRemaining();
    const state =
      this.tatLevel() === 'urgent' ? 'past TAT' :
      this.tatLevel() === 'high'   ? `${Math.round(rem)}m remaining` :
      `${Math.round(rem)}m to go`;
    return `Enter parameter values. Currently ${state}.`;
  });

  readonly panelTone = computed<TileTone>(() => {
    const l = this.tatLevel();
    return l === 'urgent' ? 'rose' : l === 'high' ? 'amber' : 'violet';
  });

  readonly criticalFlags = computed<Array<TestParameter & { value: string }>>(() => {
    const v = this._values();
    return this.parameters()
      .filter(p => this.inputKindFor(p) === 'numeric')
      .map(p => ({ ...p, value: String(v[p.name] ?? '') }))
      .filter(p => {
        if (!p.value) return false;
        const f = this.flagFor(p);
        return f?.tone === 'critical';
      });
  });
  readonly hasCritical = computed(() => this.criticalFlags().length > 0);

  readonly autoSavedAgo = computed(() => {
    const t = this._lastSavedAt();
    if (!t) return '';
    const secs = Math.max(1, Math.round((this._now() - t.getTime()) / 1000));
    if (secs < 60) return `${secs}s ago`;
    return `${Math.round(secs / 60)}m ago`;
  });

  readonly hasNextEmpty = computed(() => {
    const v = this._values();
    return this.parameters().some(p => {
      const val = v[p.name];
      return val === undefined || val === null || val === '';
    });
  });

  readonly activeParamDef = computed<TestParameter | null>(() => {
    const name = this._active();
    if (!name) return null;
    return this.parameters().find(p => p.name === name) ?? null;
  });

  readonly railKind = computed<'numeric' | 'choice' | 'radio' | 'yesno' | 'text' | 'idle'>(() => {
    const p = this.activeParamDef();
    if (!p) return 'idle';
    const k = this.inputKindFor(p);
    // textarea falls back to the same "type directly" hint as text
    return k === 'textarea' ? 'text' : k;
  });

  readonly railEyebrow = computed(() => {
    switch (this.railKind()) {
      case 'numeric': return 'Numeric keypad';
      case 'choice':  return 'Options';
      case 'radio':   return 'Select one';
      case 'yesno':   return 'Yes or No';
      case 'text':    return 'Keyboard input';
      default:        return 'Input helper';
    }
  });

  readonly activeOptions = computed<string[]>(() => this.activeParamDef()?.options ?? []);

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.back(); return; }
    this.api.get<OrderTest>(`/api/results/${id}`).subscribe({
      next: t => {
        this._ot.set(t);
        const raw = t.currentResult;
        if (raw) {
          try {
            const snap = JSON.parse(raw) as { values?: Record<string, unknown>; note?: string };
            if (snap.values) this._values.set({ ...snap.values });
            if (snap.note)   this._note.set(snap.note);
          } catch { /* ignore */ }
        }
        // Seed the right-rail target with the first numeric param so the pad has something to drive.
        const firstNumeric = this.parameters().find(p => this.inputKindFor(p) === 'numeric');
        if (firstNumeric) this._active.set(firstNumeric.name);
      },
      error: () => this.toasts.error('Could not load result entry')
    });
    setInterval(() => this._now.set(Date.now()), 10_000);
  }

  ngAfterViewInit() { /* no-op — numInputs are ready for advance() */ }

  inputKindFor(p: TestParameter): 'numeric' | 'text' | 'textarea' | 'choice' | 'radio' | 'yesno' {
    switch (p.type) {
      case 'numeric':
      case 'numeric_with_range':
        return 'numeric';
      case 'text':
        return 'text';
      case 'textarea':
        return 'textarea';
      case 'select':
      case 'multiselect':
      case 'button_select':
      case 'toggle':
        return 'choice';
      case 'radio':
        return 'radio';
      case 'yesno':
        return 'yesno';
      default:
        return 'text';
    }
  }

  refLabel(p: TestParameter): string {
    if (p.normalValue) return p.normalValue;
    const r = (p.referenceRanges ?? [])[0];
    if (r) {
      const seg = r.segment ? this.prettySegment(r.segment) : '';
      return `${r.min}–${r.max}${p.unit ? ' ' + p.unit : ''}${seg ? ' · ' + seg : ''}`;
    }
    if (p.criticalLow !== undefined && p.criticalHigh !== undefined) return `${p.criticalLow}–${p.criticalHigh}`;
    return '';
  }

  /** Turn backend segment keys like "adult_male" into "Adult male" for display. */
  private prettySegment(s: string): string {
    return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  flagFor(p: TestParameter): Flag | null {
    if (this.inputKindFor(p) !== 'numeric') return null;
    const raw = this._values()[p.name];
    if (raw === undefined || raw === null || raw === '') return null;
    const v = parseFloat(String(raw));
    if (Number.isNaN(v)) return null;

    if (p.criticalLow  !== undefined && v < p.criticalLow)  return { tone: 'critical', label: `Critical · below ${p.criticalLow}` };
    if (p.criticalHigh !== undefined && v > p.criticalHigh) return { tone: 'critical', label: `Critical · above ${p.criticalHigh}` };

    const r = (p.referenceRanges ?? [])[0];
    if (r) {
      if (v < r.min) return { tone: 'low',  label: 'Low' };
      if (v > r.max) return { tone: 'high', label: 'High' };
      return { tone: 'normal', label: 'Normal' };
    }
    return null;
  }

  valueOf(name: string | null): string | undefined {
    if (!name) return undefined;
    const v = this._values()[name];
    return v === undefined || v === null ? undefined : String(v);
  }

  titleFor(name: string): string {
    return this.parameters().find(p => p.name === name)?.title ?? name;
  }

  unitFor(name: string): string | undefined {
    return this.parameters().find(p => p.name === name)?.unit;
  }

  setValue(name: string, value: string) {
    this._values.update(s => ({ ...s, [name]: value }));
  }

  setNote(n: string) { this._note.set(n); }
  setActive(name: string) { this._active.set(name); }
  clearActive() { /* keep last target visible rather than blanking */ }

  toggleMobileRail() { this._mobileRailOpen.update(v => !v); }
  closeMobileRail() { this._mobileRailOpen.set(false); }

  /** NumPad changes only route when an input is active AND it's numeric. */
  padChange(v: string) {
    const name = this._active();
    if (!name) return;
    const p = this.parameters().find(x => x.name === name);
    if (!p || this.inputKindFor(p) !== 'numeric') return;
    this.setValue(name, v);
  }

  clearActiveValue() {
    const name = this._active();
    if (!name) return;
    this.setValue(name, '');
  }

  /** Called by the rail when an option tile is tapped. Writes the value and
   *  auto-advances to the next empty param. */
  pickOption(opt: string) {
    const name = this._active();
    if (!name) return;
    this.setValue(name, opt);
    // Advance after the signal settles so the new value counts toward "empty" check.
    queueMicrotask(() => this.advance());
  }

  /** Human-readable render of a value for the rail header. Shows the number
   *  right-aligned for numerics, passes through for choices. */
  prettyValue(name: string): string {
    const v = this.valueOf(name);
    if (v === undefined || v === '') return '—';
    return v;
  }

  /** Jump focus to the next empty numeric parameter (after current active). */
  advance() {
    const params = this.parameters();
    const cur = this._active();
    const startIdx = cur ? Math.max(0, params.findIndex(p => p.name === cur)) : -1;
    // Look forward first, then wrap around.
    const order = [
      ...params.slice(startIdx + 1),
      ...params.slice(0, startIdx + 1),
    ];
    const next = order.find(p => {
      if (this.inputKindFor(p) !== 'numeric') return false;
      const v = this._values()[p.name];
      return v === undefined || v === null || v === '';
    });
    if (!next) return;
    this._active.set(next.name);
    this.focusInput(next.name);
  }

  advanceFrom(name: string) {
    // Called from Enter key — prefer the immediate next param (even if filled) if the current is filled.
    const params = this.parameters();
    const idx = params.findIndex(p => p.name === name);
    if (idx < 0) return;
    const next = params.slice(idx + 1).concat(params.slice(0, idx))
      .find(p => {
        const kind = this.inputKindFor(p);
        return kind === 'numeric' || kind === 'text';
      });
    if (!next) return;
    this._active.set(next.name);
    this.focusInput(next.name);
  }

  private focusInput(name: string) {
    // Try numeric-ref first.
    const byRef = this.numInputs?.find(r => r.nativeElement.getAttribute('data-param') === name);
    if (byRef) { byRef.nativeElement.focus(); return; }
    // Fall back to querying any input with matching data-param.
    const el = this.host.nativeElement.querySelector(`[data-param="${name}"]`) as HTMLInputElement | HTMLTextAreaElement | null;
    if (el) el.focus();
  }

  asInput(ev: Event): string { return (ev.target as HTMLInputElement).value; }
  asArea(ev: Event): string  { return (ev.target as HTMLTextAreaElement).value; }

  saveDraft() {
    this._lastSavedAt.set(new Date());
    this.toasts.success('Draft saved');
  }

  submit() {
    const id = this._ot()?.id;
    if (!id || this._saving()) return;
    if (!this.canSubmit()) {
      this.toasts.warning(`Fill all ${this.requiredCount()} required parameters before submit.`);
      return;
    }
    this._saving.set(true);
    this.api.post<EnterResponse>(`/api/results/${id}/enter`, {
      values: this._values(),
      note: this._note() || null
    }).subscribe({
      next: res => {
        this._saving.set(false);
        if (res.flags.critical) this.toasts.warning('Submitted — flagged critical');
        else this.toasts.success('Result submitted');
        this.back();
      },
      error: e => { this._saving.set(false); this.toasts.error(e.message ?? 'Submit failed'); }
    });
  }

  async rejectSample() {
    const id = this._ot()?.id;
    if (!id) return;
    const reason = await this.dialog.prompt({
      title: 'Reject this sample?',
      message: 'The sample will be sent back for re-collection. Please describe what went wrong.',
      placeholder: 'Reason for rejection…',
      multiline: true,
      required: true,
      tone: 'danger',
      confirmLabel: 'Reject sample'
    });
    if (!reason) return;
    this.api.post(`/api/results/${id}/reject-sample`, { reason }).subscribe({
      next: () => { this.toasts.success('Sample rejected'); this.back(); }
    });
  }

  back() {
    const ot = this._ot();
    const returnTo = this.route.snapshot.queryParamMap.get('returnTo');
    if (returnTo === 'validate' && ot) {
      this.router.navigate(['/pathologist/validate', ot.id]);
      return;
    }
    this.router.navigateByUrl('/lab/my-work');
  }
}
