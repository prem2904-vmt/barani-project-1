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
import { CultureResult } from '../../../shared/models/culture.model';
import { OrderTestComment } from '../../../shared/models/comment.model';
import { CommentThreadComponent } from '../../../shared/components/comment-thread/comment-thread.component';
import { LoadingLogoComponent } from '../../../shared/components/loading-logo/loading-logo.component';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ChipComponent } from '../../../shared/primitives/chip.component';
import { firstValueFrom } from 'rxjs';
import { formatPatientInfo } from '../../../shared/models/patient.model';
import { normalizeSex, selectReferenceRange } from '../../../shared/utils/reference-range';

interface ResultSnapshot {
  values?: Record<string, unknown>;
  note?: string;
  flags?: { critical: boolean; notifications: string[] };
}

type Flag = 'normal' | 'abnormal' | 'critical';
type View = 'cards' | 'table';

interface ParamDef {
  name: string;
  title: string;
  type?: string;
  unit?: string;
  options?: string[];
  criticalLow?: number;
  criticalHigh?: number;
  referenceRanges?: Array<{ segment: string; min: number; max: number }>;
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
}

@Component({
  selector: 'pf-validate-result',
  standalone: true,
  imports: [FormsModule, DatePipe, AvatarComponent, ChipComponent, CommentThreadComponent, LoadingLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-page">
      <!-- Compact header -->
      <header class="pf-page__header px-4 md:px-8 lg:px-10 pt-4">
        <div class="pf-head">
          @if (navBack.showBack()) {
            <button type="button" class="pf-hdr-back shrink-0 inline-flex items-center justify-center" (click)="navBack.back()" aria-label="Go back">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
            </button>
          }
          <button type="button" class="pf-head__back press" (click)="back()" aria-label="Back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
            <span class="hidden sm:inline">Back</span>
          </button>
          <h1 class="pf-head__title">{{ selected()?.test?.name ?? 'Validate' }}</h1>
          <p class="pf-head__sub">{{ subtitleText() }}</p>
        </div>
      </header>

      <div class="pf-page__body px-4 md:px-8 lg:px-10 pt-2 pb-32">
        @if (loading() && !selected()) {
          <div class="pf-empty-block flex justify-center py-12">
            <pf-loading-logo size="xl" color="purple" [showDna]="true"
                             [showText]="true" text="Loading validation…"></pf-loading-logo>
          </div>
        }

        @if (!loading() && !selected()) {
          <div class="pf-empty-block">Order test not found in the validation queue.</div>
        }

        @if (selected(); as t) {

          <!-- Patient + context strip -->
          <div class="pf-ctx">
            <pf-avatar [name]="t.subOrder?.order?.patient?.displayName ?? '—'" [size]="44"></pf-avatar>
            <div class="pf-ctx__id">
              <p class="pf-ctx__name">{{ formatPatient(t.subOrder?.order?.patient) }}</p>
              <p class="pf-ctx__meta">
                {{ t.test?.department?.name ?? '—' }} ·
                entered {{ t.resultedAt ? (t.resultedAt | date:'MMM d, h:mm a') : '—' }}
              </p>
            </div>
            @if (snapshot()?.flags?.critical) {
              <pf-chip tone="rose" size="sm">CRITICAL</pf-chip>
            }
          </div>

          <!-- Sent-back banner — this result was previously rejected and
               re-entered by the tech. Repeats the rejection reason so the
               validator remembers WHY it was sent back before signing off.
               Visual pattern mirrors sample-result-entry's reject banner. -->
          @if (t.rejectionReason) {
            <div class="pf-reject-banner">
              <span class="pf-reject-banner__icon" aria-hidden="true">↻</span>
              <p class="pf-reject-banner__text">
                <strong>Sent back:</strong> {{ t.rejectionReason }}
              </p>
            </div>
          }

          <!-- Validator ↔ tech overall conversation. Bidirectional —
               tech can post observations ("patient was nervous, two
               attempts"); validator posts corrections ("recheck
               platelet count"). Per-parameter comments live below
               each row in the table view. -->
          <section class="pf-overall-comments">
            <p class="pf-eyebrow">Overall conversation</p>
            <pf-comment-thread
              [comments]="commentsFor(null)"
              currentRole="validator"
              (add)="addOverallComment($event.body, $event.type)"
              (reply)="replyToOverall($event.parentId, $event.body)">
            </pf-comment-thread>
          </section>

          <!-- Microbiology Culture & Sensitivity → structured read-only review -->
          @if (isCulture()) {
            @if (cultureResult(); as c) {
              <div class="pf-culture-rev">
                <div class="pf-culture-rev__meta">
                  <div><span class="pf-eyebrow">Specimen</span><p>{{ c.specimen || '—' }}</p></div>
                  <div><span class="pf-eyebrow">Gram stain</span><p>{{ c.gramStain || '—' }}</p></div>
                  <div><span class="pf-eyebrow">Colony count</span><p>{{ c.colonyCount || '—' }}</p></div>
                </div>
                @if (c.noGrowth) {
                  <p class="pf-culture-rev__growth">No significant growth</p>
                } @else if ((c.organisms ?? []).length === 0) {
                  <p class="pf-culture-rev__empty">No organisms recorded.</p>
                } @else {
                  @for (org of c.organisms ?? []; track $index) {
                    <div class="pf-culture-rev__org">
                      <div class="pf-culture-rev__org-name">{{ org.name || 'Organism' }}</div>
                      <table class="pf-culture-rev__ast">
                        <thead>
                          <tr><th>Antimicrobial</th><th class="w-16">Zone</th><th class="w-32">Interpretation</th></tr>
                        </thead>
                        <tbody>
                          @for (ab of org.antibiotics; track $index) {
                            <tr>
                              <td>{{ ab.name }}</td>
                              <td class="text-center">{{ ab.zoneSize != null ? ab.zoneSize + ' mm' : '—' }}</td>
                              <td class="font-bold" [style.color]="interpTone(ab.interpretation)">{{ interpLabel(ab.interpretation) }}</td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                  }
                }
                @if (c.resistancePattern) { <p class="pf-culture-rev__note"><span class="pf-eyebrow">Resistance pattern</span> {{ c.resistancePattern }}</p> }
                @if (c.intrinsicResistance) { <p class="pf-culture-rev__note"><span class="pf-eyebrow">Intrinsic resistance</span> {{ c.intrinsicResistance }}</p> }
                @if (c.clinicalNotes) { <p class="pf-culture-rev__note"><span class="pf-eyebrow">Clinical notes</span> {{ c.clinicalNotes }}</p> }
                @if (c.infectionControlAdvice) { <p class="pf-culture-rev__note"><span class="pf-eyebrow">Infection control advice</span> {{ c.infectionControlAdvice }}</p> }
              </div>
            } @else {
              <div class="pf-empty-block">No culture result recorded.</div>
            }
          }

          @if (!isCulture()) {
          <!-- Summary strip: param counts with color-coded cells -->
          @if (valueRows().length > 0) {
            <div class="pf-summary">
              <div class="pf-summary__cell">
                <span class="pf-summary__num">{{ counts().total }}</span>
                <span class="pf-summary__lbl">Parameters</span>
              </div>
              <div class="pf-summary__cell" data-tone="normal">
                <span class="pf-summary__num">{{ counts().normal }}</span>
                <span class="pf-summary__lbl">Normal</span>
              </div>
              <div class="pf-summary__cell" data-tone="abnormal">
                <span class="pf-summary__num">{{ counts().abnormal }}</span>
                <span class="pf-summary__lbl">Abnormal</span>
              </div>
              <div class="pf-summary__cell" data-tone="critical">
                <span class="pf-summary__num">{{ counts().critical }}</span>
                <span class="pf-summary__lbl">Critical</span>
              </div>
            </div>
          }

          <!-- Parameters header with view toggle -->
          <div class="pf-params-head">
            <p class="pf-eyebrow m-0">Parameters</p>
            <div class="pf-view-toggle" role="group">
              <button type="button"
                      class="pf-view-toggle__btn"
                      [class.pf-view-toggle__btn--on]="view() === 'cards'"
                      (click)="setView('cards')">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                  <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
                </svg>
                Cards
              </button>
              <button type="button"
                      class="pf-view-toggle__btn"
                      [class.pf-view-toggle__btn--on]="view() === 'table'"
                      (click)="setView('table')">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
                </svg>
                Table
              </button>
            </div>
          </div>

          <!-- CARDS VIEW -->
          @if (view() === 'cards') {
            @if (valueRows().length === 0) {
              <div class="pf-empty-block">No values recorded.</div>
            } @else {
              <ul class="pf-cards">
                @for (r of valueRows(); track r.name) {
                  <li>
                    <button type="button"
                            class="pf-vcard press"
                            [attr.data-flag]="r.flag"
                            (click)="openDetail(r)">
                      <header class="pf-vcard__hdr">
                        <span class="pf-vcard__name">{{ r.title }}</span>
                        <span class="pf-vcard__chip" [attr.data-flag]="r.flag">
                          <span class="pf-vcard__chip-dot"></span>
                          {{ flagLabel(r.flag) }}
                        </span>
                      </header>

                      <div class="pf-vcard__value">
                        <span class="pf-vcard__num">{{ r.value ?? '—' }}</span>
                        @if (r.unit) { <span class="pf-vcard__unit">{{ r.unit }}</span> }
                      </div>

                      <!-- Range visualization — muted rail, highlighted normal zone, value pin. -->
                      @if (r.isNumeric && (r.min !== undefined || r.critLow !== undefined)) {
                        <div class="pf-rangebar">
                          <div class="pf-rangebar__track">
                            @for (z of zonesFor(r); track z.label) {
                              <span class="pf-rangebar__zone"
                                    [attr.data-tone]="z.tone"
                                    [style.flex]="z.weight"></span>
                            }
                          </div>
                          <span class="pf-rangebar__pin"
                                [style.left.%]="pinFor(r)"
                                [attr.data-flag]="r.flag"
                                [attr.title]="r.value">
                          </span>
                          <div class="pf-rangebar__scale">
                            <span>{{ r.min ?? r.critLow ?? '—' }}</span>
                            <span class="pf-rangebar__scale-mid">normal</span>
                            <span>{{ r.max ?? r.critHigh ?? '—' }}</span>
                          </div>
                        </div>
                      }

                      <p class="pf-vcard__range">
                        @if (r.range) { Normal · {{ r.range }} }
                        @else if (!r.isNumeric) { categorical }
                        @else { no range }
                      </p>
                    </button>
                  </li>
                }
              </ul>
            }
          }

          <!-- TABLE VIEW -->
          @if (view() === 'table') {
            @if (valueRows().length === 0) {
              <div class="pf-empty-block">No values recorded.</div>
            } @else {
              <div class="pf-table">
                <div class="pf-table__head">
                  <span>Parameter</span>
                  <span>Value</span>
                  <span>Range</span>
                  <span>Where</span>
                  <span>Flag</span>
                </div>
                @for (r of valueRows(); track r.name) {
                  <button type="button"
                          class="pf-table__row press"
                          [class.pf-table__row--has-comments]="hasOpenComment(r.name)"
                          [attr.data-flag]="r.flag"
                          (click)="toggleParamComment(r.name); $event.stopPropagation()">
                    <span class="pf-table__name">
                      {{ r.title }}
                      @if (hasOpenComment(r.name)) {
                        <span class="pf-table__comment-flag" title="Open comment">💬</span>
                      }
                    </span>
                    <span class="pf-table__value">
                      {{ r.value ?? '—' }} @if (r.unit) { <em class="pf-table__unit">{{ r.unit }}</em> }
                    </span>
                    <span class="pf-table__range">{{ r.range ?? '—' }}</span>
                    <span class="pf-table__where">
                      @if (r.isNumeric && (r.min !== undefined || r.critLow !== undefined)) {
                        <div class="pf-rangebar pf-rangebar--mini">
                          <div class="pf-rangebar__track">
                            @for (z of zonesFor(r); track z.label) {
                              <span class="pf-rangebar__zone"
                                    [attr.data-tone]="z.tone"
                                    [style.flex]="z.weight"></span>
                            }
                          </div>
                          <span class="pf-rangebar__pin"
                                [style.left.%]="pinFor(r)"
                                [attr.data-flag]="r.flag"></span>
                        </div>
                      } @else { — }
                    </span>
                    <span>
                      <span class="pf-vcard__chip" [attr.data-flag]="r.flag">
                        <span class="pf-vcard__chip-dot"></span>
                        {{ flagLabel(r.flag) }}
                      </span>
                    </span>
                  </button>
                  @if (openParamComment() === r.name) {
                    <div class="pf-table__row-comments" (click)="$event.stopPropagation()">
                      <p class="pf-eyebrow pf-table__row-comments-label">{{ r.title }} · conversation</p>
                      <pf-comment-thread
                        [comments]="commentsFor(r.name)"
                        currentRole="validator"
                        [composeLabel]="'Comment on this parameter'"
                        (add)="addParameterComment(r.name, $event.body, $event.type)"
                        (reply)="replyToParameter(r.name, $event.parentId, $event.body)">
                      </pf-comment-thread>
                    </div>
                  }
                }
              </div>
            }
          }
          }

          <!-- Clinical comment -->
          <section class="pf-comment">
            <label class="pf-eyebrow pf-comment__label">
              Clinical comment <span class="pf-comment__optional">(optional)</span>
            </label>
            <textarea class="pf-comment__input"
                      [value]="comment()"
                      (input)="onComment($event)"
                      placeholder="Notes for the report or the follow-up team…"></textarea>
          </section>
        }
      </div>

      <!-- Sticky validate bar -->
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
                @if (hasCritical()) {
                  <span class="pf-stickybar__dot" data-state="critical"></span>
                  <b>Critical</b> · validation will notify referring doctor
                } @else {
                  <span class="pf-stickybar__dot" data-state="ok"></span>
                  Ready to validate
                }
              </span>
              <div class="flex-1"></div>
              <button type="button" class="pf-btn pf-btn--ghost pf-btn--icony press" (click)="reject()" aria-label="Reject">
                <svg class="pf-btn__ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/></svg>
                <span class="pf-btn-label">Reject</span>
              </button>
              <button type="button" class="pf-btn pf-btn--ghost pf-btn--icony press" (click)="reassign()" aria-label="Reassign">
                <svg class="pf-btn__ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3l4 4-4 4"/><path d="M20 7H4"/><path d="M8 21l-4-4 4-4"/><path d="M4 17h16"/></svg>
                <span class="pf-btn-label">Reassign</span>
              </button>
              @if (!isCulture()) {
                <!-- Culture values are a structured object; editing them as flat
                     fields would corrupt the shape. The validator rejects for
                     re-entry instead, which reopens the structured tech screen. -->
                <button type="button" class="pf-btn pf-btn--secondary pf-btn--icony press" (click)="startEdit()" aria-label="Edit values">
                  <svg class="pf-btn__ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                  <span class="pf-btn-label">Edit values</span>
                </button>
              }
              @if (trendEligible().length > 0) {
                <label class="pf-trend-chk" title="Embed serial-result trend charts in the report">
                  <input type="checkbox" [checked]="trendogramOn()" (change)="toggleTrendogram()" />
                  <span>Trendogram</span>
                  @if (trendogramOn()) {
                    <select (click)="$event.stopPropagation()" [value]="trendogramDuration()" (change)="setTrendDuration($any($event.target).value)">
                      <option value="5">Last 5</option>
                      <option value="10">Last 10</option>
                      <option value="3m">3 mo</option>
                      <option value="6m">6 mo</option>
                      <option value="all">All</option>
                    </select>
                  }
                </label>
              }
              <button type="button"
                      class="pf-btn pf-btn--icony"
                      [class.pf-btn--primary]="!hasCritical()"
                      [class.pf-btn--danger]="hasCritical()"
                      [disabled]="saving() || (!isCulture() && valueRows().length === 0)"
                      (click)="validate()"
                      [attr.aria-label]="hasCritical() ? 'Validate and notify' : 'Validate'">
                <svg class="pf-btn__ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                <span class="pf-btn-label">{{ saving() ? 'Validating…' : (hasCritical() ? 'Validate · notify' : 'Validate') }}</span>
              </button>
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
              <p class="pf-eyebrow">Parameter</p>
              <h2 class="pf-drawer__title">{{ r.title }}</h2>
            </div>
            <span class="pf-vcard__chip pf-vcard__chip--lg" [attr.data-flag]="r.flag">
              <span class="pf-vcard__chip-dot"></span>
              {{ flagLabel(r.flag) }}
            </span>
            <button type="button" class="pf-drawer__close press" (click)="closeDetail()" aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
              </svg>
            </button>
          </header>

          <div class="pf-drawer__body">
            <!-- Big value display -->
            <div class="pf-drawer__value">
              <span class="pf-drawer__num">{{ r.value ?? '—' }}</span>
              @if (r.unit) { <span class="pf-drawer__unit">{{ r.unit }}</span> }
            </div>

            <!-- Big range bar -->
            @if (r.isNumeric && (r.min !== undefined || r.critLow !== undefined)) {
              <div class="pf-rangebar pf-rangebar--lg">
                <div class="pf-rangebar__track">
                  @for (z of zonesFor(r); track z.label) {
                    <span class="pf-rangebar__zone"
                          [attr.data-tone]="z.tone"
                          [style.flex]="z.weight"></span>
                  }
                </div>
                <span class="pf-rangebar__pin"
                      [style.left.%]="pinFor(r)"
                      [attr.data-flag]="r.flag">
                </span>
                <!-- Zone labels along the bottom -->
                <div class="pf-rangebar__labels">
                  @for (tick of ticksFor(r); track tick.label) {
                    <span class="pf-rangebar__tick" [style.left.%]="tick.pos">
                      <span class="pf-rangebar__tick-v">{{ tick.label }}</span>
                    </span>
                  }
                </div>
              </div>
            }

            <!-- Reference ranges -->
            <section class="pf-drawer__sec">
              <p class="pf-eyebrow mb-2">Reference</p>
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

            <!-- Flag explanation -->
            @if (r.flag !== 'normal') {
              <section class="pf-drawer__sec pf-drawer__sec--alert" [attr.data-flag]="r.flag">
                <p class="pf-eyebrow mb-2">Why flagged</p>
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
       area (shell-main is flex:1; min-height:0; overflow-y:auto, so
       a height:100% child fits exactly). The screen header is fixed
       (flex:0 0 auto); the SCROLL happens inside .pf-page__body. The
       validate bar is a position:fixed overlay that floats above the
       body, so it stays out of the flex flow. */
    :host { display: block; height: 100%; overflow: hidden; }
    .pf-page { height: 100%; display: flex; flex-direction: column; overflow: hidden; }

    /* ── Culture & Sensitivity read-only review ─────────────── */
    .pf-culture-rev { display: flex; flex-direction: column; gap: 12px; margin-bottom: 8px; }
    .pf-culture-rev__meta { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 12px; }
    .pf-culture-rev__meta p { margin: 2px 0 0; font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .pf-culture-rev__growth { margin: 0; font-size: 14px; font-weight: 700; color: var(--text-secondary); }
    .pf-culture-rev__empty { margin: 0; font-size: 13px; color: var(--text-tertiary); }
    .pf-culture-rev__org { padding: 12px 14px; border-radius: 12px; border: 1px solid var(--glass-border); background: var(--glass-bg); }
    .pf-culture-rev__org-name { font-size: 14px; font-weight: 700; color: var(--text-primary); margin-bottom: 8px; }
    .pf-culture-rev__ast { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    .pf-culture-rev__ast th { text-align: left; font-weight: 700; font-size: 10.5px; letter-spacing: 0.06em;
      text-transform: uppercase; color: var(--text-tertiary); padding: 4px 6px; border-bottom: 1px solid var(--glass-border); }
    .pf-culture-rev__ast td { padding: 5px 6px; border-bottom: 1px solid var(--glass-border); color: var(--text-secondary); }
    .pf-culture-rev__ast tr:last-child td { border-bottom: 0; }
    .pf-culture-rev__note { margin: 0; font-size: 12.5px; color: var(--text-secondary); }
    .pf-culture-rev__note .pf-eyebrow { margin-right: 6px; }
    .pf-page__header { flex: 0 0 auto; }
    /* Internal scroll region: this is the ONLY scroll on the page. */
    .pf-page__body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; padding-top: 4px; -webkit-overflow-scrolling: touch; }

    /* ── Compact page header (same shape as other screens) ─── */
    .pf-head {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      padding: 6px 0 10px;
    }
    /* Legacy desktop text pill — retired at ALL widths. The single back
       affordance is now the .pf-hdr-back chevron, rendered on every breakpoint. */
    .pf-head__back {
      display: none;
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
      align-self: center;
    }
    .pf-head__back:hover { background: var(--glass-bg-hover); color: var(--text-primary); }
    .pf-head__title {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--text-primary);
      line-height: 1.1;
    }
    @media (min-width: 768px) { .pf-head__title { font-size: 26px; } }
    .pf-head__sub {
      margin: 0;
      font-size: 12.5px;
      color: var(--text-secondary);
      flex: 1;
      min-width: 0;
    }

    .pf-eyebrow {
      margin: 0;
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
    }

    .pf-empty-block {
      padding: 40px 0;
      text-align: center;
      font-size: 13px;
      color: var(--text-tertiary);
    }

    /* ── Sent-back banner (previously rejected, now re-entered) ─
       Visual pattern copied from sample-result-entry's reject banner. */
    .pf-reject-banner {
      display: flex; align-items: center; gap: 10px;
      padding: 12px 14px;
      margin-bottom: 12px;
      border-radius: 12px;
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.14), rgba(239, 68, 68, 0.04));
      border: 1px solid rgba(239, 68, 68, 0.34);
    }
    .pf-reject-banner__icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 24px; height: 24px;
      border-radius: 9999px;
      background: rgba(239, 68, 68, 0.22);
      color: var(--red-text);
      font-size: 13px; font-weight: 700;
      flex-shrink: 0;
    }
    .pf-reject-banner__text {
      margin: 0;
      font-size: 13px; line-height: 1.4;
      color: var(--text-secondary);
    }
    .pf-reject-banner__text strong { color: var(--red-text); margin-right: 4px; }

    /* ── Patient context strip ─────────────────────────────── */
    .pf-ctx {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      border-radius: 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      margin-bottom: 12px;
    }
    .pf-ctx__id { min-width: 0; flex: 1; }
    .pf-ctx__name {
      margin: 0;
      font-size: 15px;
      font-weight: 700;
      color: var(--text-primary);
    }
    .pf-ctx__meta {
      margin: 2px 0 0;
      font-size: 11.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: var(--text-tertiary);
    }

    /* ── Summary strip — neutral cells, only number colored ── */
    .pf-summary {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0;
      padding: 4px;
      border-radius: 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      margin-bottom: 16px;
    }
    .pf-summary__cell {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      padding: 10px 14px;
      position: relative;
    }
    .pf-summary__cell + .pf-summary__cell::before {
      content: '';
      position: absolute;
      left: 0; top: 20%; bottom: 20%;
      width: 1px;
      background: var(--border-muted);
    }
    .pf-summary__num {
      font-size: 22px;
      font-weight: 800;
      font-variant-numeric: tabular-nums;
      color: var(--text-primary);
      line-height: 1;
      letter-spacing: -0.02em;
    }
    .pf-summary__cell[data-tone='normal']   .pf-summary__num { color: #10b981; }
    .pf-summary__cell[data-tone='abnormal'] .pf-summary__num { color: #d97706; }
    .pf-summary__cell[data-tone='critical'] .pf-summary__num { color: #dc2626; }
    :root.dark .pf-summary__cell[data-tone='normal']   .pf-summary__num { color: #34d399; }
    :root.dark .pf-summary__cell[data-tone='abnormal'] .pf-summary__num { color: #fbbf24; }
    :root.dark .pf-summary__cell[data-tone='critical'] .pf-summary__num { color: #fca5a5; }
    .pf-summary__lbl {
      font-size: 10px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
    }

    /* ── Params header + view toggle ───────────────────────── */
    .pf-params-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
      padding: 0 4px;
    }
    .pf-view-toggle {
      display: inline-flex;
      padding: 3px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      gap: 2px;
    }
    .pf-view-toggle__btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 28px;
      padding: 0 12px;
      border: none;
      background: transparent;
      color: var(--text-tertiary);
      font-size: 11px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      border-radius: 9999px;
      cursor: pointer;
      transition: color 0.15s, background 0.15s;
    }
    .pf-view-toggle__btn:hover { color: var(--text-primary); }
    .pf-view-toggle__btn--on {
      background: var(--bg-card-solid);
      color: var(--text-primary);
      border: 1px solid var(--glass-border-hover);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
    }

    /* ── Parameter cards ───────────────────────────────────── */
    .pf-cards {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
    }
    @media (min-width: 768px) { .pf-cards { grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); } }

    /* Cards: all neutral. Flag signal lives ONLY in the chip + pin. Sleek. */
    .pf-vcard {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 14px 16px;
      border-radius: 16px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      text-align: left;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, transform 0.08s;
    }
    .pf-vcard:hover { background: var(--glass-bg-hover); border-color: var(--glass-border-hover); }
    .pf-vcard:active { transform: scale(0.996); }

    .pf-vcard__hdr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .pf-vcard__name {
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--text-muted);
    }

    /* Single source of color: the flag chip. Subtle dot + text, no heavy fills. */
    .pf-vcard__chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 10px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      font-weight: 700;
      background: transparent;
      border: 1px solid transparent;
    }
    .pf-vcard__chip--lg { font-size: 11px; padding: 5px 12px; }
    .pf-vcard__chip-dot { width: 6px; height: 6px; border-radius: 9999px; background: currentColor; }
    .pf-vcard__chip[data-flag='normal']   { color: #10b981; border-color: rgba(16, 185, 129, 0.28); }
    .pf-vcard__chip[data-flag='abnormal'] { color: #d97706; border-color: rgba(245, 158, 11, 0.32); }
    .pf-vcard__chip[data-flag='critical'] { color: #dc2626; border-color: rgba(239, 68, 68, 0.35); }
    :root.dark .pf-vcard__chip[data-flag='normal']   { color: #34d399; }
    :root.dark .pf-vcard__chip[data-flag='abnormal'] { color: #fbbf24; }
    :root.dark .pf-vcard__chip[data-flag='critical'] { color: #fca5a5; }

    .pf-vcard__value {
      display: flex;
      align-items: baseline;
      gap: 6px;
    }
    /* Value text is ALWAYS neutral — the flag info is conveyed by the chip + pin. */
    .pf-vcard__num {
      font-size: 30px;
      font-weight: 800;
      font-variant-numeric: tabular-nums;
      color: var(--text-primary);
      letter-spacing: -0.02em;
      line-height: 1;
    }
    .pf-vcard__unit {
      font-size: 13px;
      color: var(--text-tertiary);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }
    .pf-vcard__range {
      margin: 0;
      font-size: 11px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: var(--text-muted);
    }

    /* ── Range bar ──
       Layout: a full-width rail represents the possible value span.
       - The whole rail is muted (means "full scale, mostly unused area").
       - The NORMAL zone (between min and max) is filled with the theme accent
         so the eye immediately sees "this is the good range".
       - The pin sits at the value's actual position. Its color reflects the
         flag (mint = in range, amber = outside normal, red = critical).
       - A 3-part scale below labels: normal-min · "normal" · normal-max. */
    .pf-rangebar {
      position: relative;
      width: 100%;
      padding: 6px 0 0;
    }
    .pf-rangebar__track {
      display: flex;
      height: 8px;
      border-radius: 9999px;
      overflow: hidden;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
    }
    .pf-rangebar__zone {
      display: block;
      height: 100%;
      background: transparent;
    }
    .pf-rangebar__zone[data-tone='normal'] {
      background: var(--gradient-primary);
      opacity: 0.82;
    }
    .pf-rangebar__pin {
      position: absolute;
      top: 4px;
      transform: translateX(-50%);
      width: 14px;
      height: 14px;
      pointer-events: none;
    }
    .pf-rangebar__pin::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 9999px;
      background: var(--text-primary);
      border: 2px solid var(--bg-card-solid);
    }
    .pf-rangebar__pin[data-flag='critical']::before { background: #dc2626; }
    .pf-rangebar__pin[data-flag='abnormal']::before { background: #d97706; }
    .pf-rangebar__pin[data-flag='normal']::before   { background: #10b981; }
    :root.dark .pf-rangebar__pin[data-flag='critical']::before { background: #ef4444; }
    :root.dark .pf-rangebar__pin[data-flag='abnormal']::before { background: #f59e0b; }
    :root.dark .pf-rangebar__pin[data-flag='normal']::before   { background: #34d399; }

    .pf-rangebar__scale {
      display: flex;
      justify-content: space-between;
      margin-top: 8px;
      font-size: 10px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.08em;
      color: var(--text-muted);
    }
    .pf-rangebar__scale-mid {
      text-transform: uppercase;
      letter-spacing: 0.16em;
    }

    /* Mini (table) — drop the scale, keep the bar only */
    .pf-rangebar--mini { padding: 2px 0 0; min-width: 110px; }
    .pf-rangebar--mini .pf-rangebar__track { height: 6px; }
    .pf-rangebar--mini .pf-rangebar__pin   { width: 12px; height: 12px; top: 1px; }
    .pf-rangebar--mini .pf-rangebar__scale { display: none; }

    /* Large (drawer) */
    .pf-rangebar--lg { padding: 18px 0 0; }
    .pf-rangebar--lg .pf-rangebar__track { height: 12px; }
    .pf-rangebar--lg .pf-rangebar__pin   { width: 20px; height: 20px; top: 16px; }
    .pf-rangebar--lg .pf-rangebar__pin::before { border-width: 3px; }

    /* Tick labels under drawer bar */
    .pf-rangebar__labels {
      position: relative;
      margin-top: 10px;
      height: 14px;
    }
    .pf-rangebar__tick {
      position: absolute;
      transform: translateX(-50%);
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: var(--text-muted);
    }

    /* ── Table view ───────────────────────────────────────── */
    .pf-table {
      border-radius: 14px;
      border: 1px solid var(--glass-border);
      background: var(--glass-bg);
      /* Horizontal scroll fallback below the mobile-area layout breakpoint
         (767px) so the table stays readable even on the narrowest devices
         before grid-areas kicks in. */
      /* One shorthand: horizontal scroll, vertical clip — the previous pair
         cancelled the overflow-x on the next line, clipping the flag column
         on iPad portrait instead of scrolling. */
      overflow: auto hidden;
    }
    .pf-table__head, .pf-table__row {
      display: grid;
      /* Flag column min-content (was hard 130px) so the cell shrinks to
         the chip's intrinsic size on narrow tablets and we don't force
         horizontal scroll on iPad Mini (768px). */
      grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr) minmax(100px, 1.4fr) min-content;
      gap: 12px;
      padding: 10px 14px;
      align-items: center;
    }
    .pf-table__head {
      padding: 12px 14px;
      border-bottom: 1px solid var(--border-muted);
      background: rgba(0,0,0,0.1);
    }
    .pf-table__head > span {
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .pf-table__row {
      width: 100%;
      border: none;
      border-top: 1px solid var(--border-muted);
      background: transparent;
      color: var(--text-primary);
      font-size: 13px;
      text-align: left;
      cursor: pointer;
      transition: background 0.15s;
    }
    .pf-table__row:first-of-type { border-top: 0; }
    .pf-table__row:hover { background: var(--glass-bg-hover); }
    /* Neutral value text in table; flag is carried by the chip only. */
    .pf-table__name { font-weight: 600; }
    .pf-table__value { font-variant-numeric: tabular-nums; font-weight: 600; }
    .pf-table__unit { font-style: normal; color: var(--text-tertiary); font-size: 11.5px; margin-left: 4px; }
    .pf-table__range { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; color: var(--text-tertiary); }

    @media (max-width: 767px) {
      .pf-table__head { display: none; }
      .pf-table__row {
        grid-template-columns: 1fr auto;
        grid-template-areas:
          'name flag'
          'value flag'
          'range flag'
          'where flag';
        gap: 4px 12px;
      }
      .pf-table__name  { grid-area: name; }
      .pf-table__value { grid-area: value; }
      .pf-table__range { grid-area: range; }
      .pf-table__where { grid-area: where; }
      .pf-table__row > span:last-child { grid-area: flag; }
    }

    /* ── Comment ──────────────────────────────────────────── */
    .pf-comment {
      margin-top: 20px;
      padding: 14px;
      border-radius: 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
    }
    .pf-comment__label { display: block; margin-bottom: 8px; }
    .pf-comment__optional { text-transform: none; letter-spacing: 0; opacity: 0.6; font-weight: 400; }
    .pf-comment__input {
      width: 100%;
      min-height: 80px;
      padding: 10px 12px;
      border-radius: 10px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      font-size: 13px;
      outline: none;
      resize: vertical;
      font-family: inherit;
    }
    .pf-comment__input:focus {
      border-color: rgba(168, 85, 247, 0.5);
      box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.18);
    }

    /* ── Sticky validate bar ──────────────────────────────── */
    .pf-stickybar {
      position: fixed;
      left: 0; right: 0;
      bottom: calc(5.75rem + env(safe-area-inset-bottom, 0px));
      z-index: 30;
      padding: 0 16px;
      pointer-events: none;
    }
    @media (min-width: 1280px) { .pf-stickybar { bottom: 1rem; } }
    .pf-stickybar__inner {
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 16px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(22px);
      -webkit-backdrop-filter: blur(22px);
      max-width: 1400px;
      margin: 0 auto;
    }
    @media (max-width: 640px) { .pf-stickybar__inner { flex-wrap: wrap; } }
    .pf-stickybar__meta {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--text-secondary);
    }
    .pf-stickybar__dot { width: 7px; height: 7px; border-radius: 9999px; }
    .pf-stickybar__dot[data-state='ok']       { background: #10b981; }
    .pf-stickybar__dot[data-state='critical'] { background: #dc2626; animation: pf-pulse 1.8s infinite; }
    .pf-stickybar__dot[data-state='edit']     { background: #8b5cf6; }
    :root.dark .pf-stickybar__dot[data-state='ok']       { background: #34d399; }
    :root.dark .pf-stickybar__dot[data-state='critical'] { background: #ef4444; }
    :root.dark .pf-stickybar__dot[data-state='edit']     { background: #a78bfa; }
    @keyframes pf-pulse {
      0%, 100% { opacity: 1; }
      50%      { opacity: 0.5; }
    }

    .pf-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 36px;
      padding: 0 14px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      border: 1px solid transparent;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s, color 0.15s, box-shadow 0.25s, transform 80ms;
    }
    .pf-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .pf-btn--ghost {
      background: transparent;
      color: var(--text-secondary);
    }
    .pf-btn--ghost:hover:not(:disabled) {
      background: var(--glass-bg-hover);
      color: var(--text-primary);
    }
    .pf-btn--secondary {
      background: var(--glass-bg);
      color: var(--text-primary);
      border-color: var(--glass-border);
    }
    .pf-btn--secondary:hover:not(:disabled) { background: var(--glass-bg-hover); }
    .pf-btn--primary {
      background: var(--gradient-primary);
      color: #ffffff;
      box-shadow: 0 6px 18px rgba(124, 58, 237, 0.4);
    }
    .pf-btn--primary:hover:not(:disabled) {
      box-shadow: 0 10px 26px rgba(124, 58, 237, 0.55);
      transform: translateY(-1px);
    }
    .pf-btn--danger {
      background: linear-gradient(135deg, #ef4444, #db2777);
      color: #ffffff;
      box-shadow: 0 6px 18px rgba(239, 68, 68, 0.4);
    }
    .pf-btn--danger:hover:not(:disabled) {
      box-shadow: 0 10px 26px rgba(239, 68, 68, 0.55);
    }

    /* ── Detail drawer ────────────────────────────────────── */
    .pf-drawer-bd {
      position: fixed; inset: 0;
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(6px);
      z-index: 44;
      animation: pf-fade 0.2s ease both;
    }
    .pf-drawer {
      position: fixed;
      right: 0;
      top: var(--navbar-height, 4rem);
      bottom: 0;
      width: min(100%, 520px);
      background: var(--bg-card-solid);
      border-left: 1px solid var(--glass-border);
      box-shadow: -12px 0 48px rgba(0, 0, 0, 0.5);
      z-index: 45;
      display: flex;
      flex-direction: column;
      animation: pf-drawer-in 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }
    .pf-drawer__hdr {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px;
      border-bottom: 1px solid var(--border-muted);
    }
    .pf-drawer__title {
      margin: 2px 0 0;
      font-size: 20px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: var(--text-primary);
    }
    .pf-drawer__close {
      width: 36px; height: 36px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer;
    }
    .pf-drawer__body {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 18px;
    }
    .pf-drawer__value {
      display: flex;
      align-items: baseline;
      gap: 10px;
      padding: 20px 22px;
      border-radius: 18px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      margin-bottom: 8px;
    }
    .pf-drawer__num {
      font-size: 46px;
      font-weight: 800;
      letter-spacing: -0.03em;
      font-variant-numeric: tabular-nums;
      color: var(--text-primary);
      line-height: 1;
    }
    .pf-drawer__unit {
      font-size: 16px;
      color: var(--text-secondary);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }
    .pf-drawer__sec { margin-top: 20px; }
    .pf-drawer__meta {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px 18px;
    }
    .pf-drawer__meta > div { display: flex; flex-direction: column; gap: 2px; }
    .pf-drawer__meta dt {
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
      margin: 0;
    }
    .pf-drawer__meta dd {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
      font-variant-numeric: tabular-nums;
    }
    .pf-drawer__sec--alert {
      padding: 14px;
      border-radius: 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-left-width: 3px;
    }
    .pf-drawer__sec--alert[data-flag='abnormal'] { border-left-color: #d97706; }
    .pf-drawer__sec--alert[data-flag='critical'] { border-left-color: #dc2626; }
    :root.dark .pf-drawer__sec--alert[data-flag='abnormal'] { border-left-color: #fbbf24; }
    :root.dark .pf-drawer__sec--alert[data-flag='critical'] { border-left-color: #fca5a5; }
    .pf-drawer__why {
      margin: 0;
      font-size: 13px;
      color: var(--text-primary);
      line-height: 1.5;
    }

    @keyframes pf-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes pf-drawer-in { from { transform: translateX(20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

    /* ── Validator ↔ tech conversation surfaces ─────────────────── */
    .pf-overall-comments {
      margin: 16px 0 20px;
      padding: 14px 16px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--glass-border);
    }
    .pf-overall-comments .pf-eyebrow { margin-bottom: 8px; }

    /* Per-row inline comment thread (table view). Sits between the
       tapped row and the next, indented + soft-bordered so the
       conversation visually belongs to that row. */
    .pf-table__row--has-comments .pf-table__name { color: var(--red-text); font-weight: 600; }
    .pf-table__comment-flag { margin-left: 6px; font-size: 12px; }
    .pf-table__row-comments {
      grid-column: 1 / -1;
      padding: 12px 16px 14px 32px;
      background: rgba(96, 165, 250, 0.04);
      border-top: 1px solid var(--glass-border);
      border-bottom: 1px solid var(--glass-border);
    }
    .pf-table__row-comments-label { margin: 0 0 8px; }

    /* Phones (<640px): tighten the new comment surfaces and the
       overall section so they don't dominate the screen. */
    @media (max-width: 639px) {
      .pf-overall-comments {
        margin: 12px 0 16px;
        padding: 12px 14px;
      }
      .pf-table__row-comments {
        padding: 10px 14px 12px 14px;
      }
      .pf-table__comment-flag { font-size: 11px; }
    }

    /* ════════════════════════════════════════════════════════════
       CROSS-PLATFORM ADDITIVE OVERRIDES (scoped to :host)
       Desktop-web >=1280px is untouched: every rule below is gated
       behind a sub-desktop @media query, a touch/coarse-pointer
       query, or a platform host-context. No base rule is edited.
       ════════════════════════════════════════════════════════════ */

    /* Non-scroll WORK page: :host stays height:100% on ALL sizes so it
       fits the shell's main scroll host exactly (no outer page scroll,
       no double scrollbars). The internal scroll lives in .pf-page__body,
       whose min-height:0 lets it shrink and scroll on short mobile
       viewports. (Prior sweep set 100dvh here — that fights the
       non-scroll model and is intentionally removed.) */

    /* Action-bar icons are phone-only — desktop keeps text labels (no icon). */
    .pf-btn--icony .pf-btn__ic { display: none; }

    /* ── Standard app-wide back chevron (before the title) ──
       The single back affordance at ALL widths (web, iPad, phone). The legacy
       text pill is retired everywhere, and .pf-head centers the row so this
       38px chevron lines up vertically with the title on every breakpoint. */
    .pf-hdr-back { width:38px; height:38px; margin-left:-8px; border-radius:11px; color:var(--text-primary); background:transparent; border:0; cursor:pointer; -webkit-tap-highlight-color:transparent; transition:background .15s ease, transform .08s ease; }
    .pf-hdr-back:active { transform:scale(0.9); background:var(--glass-bg, rgba(255,255,255,0.06)); }
    @media (hover:hover){ .pf-hdr-back:hover{ background:var(--glass-bg, rgba(255,255,255,0.06)); } }

    /* ── Phone (<=640px) ─────────────────────────────────────── */
    @media (max-width: 640px) {
      /* Stop iOS auto-zoom on focus: form text >=16px on phones. */
      :host .pf-comment__input { font-size: 16px; }

      /* Drop the header description on phone — it squeezes into a thin column
         next to the long title and reads as broken. Title is enough. */
      :host .pf-head__sub { display: none; }

      /* Validate-bar actions → icon-only on phone. Show the glyph, hide the
         text label, make each a square 44px tap target. Cancel/Save (edit
         mode) keep their text — they aren't .pf-btn--icony. */
      :host .pf-btn--icony .pf-btn-label { display: none; }
      :host .pf-btn--icony .pf-btn__ic { display: inline-block; }
      :host .pf-btn--icony {
        width: 44px; min-width: 44px; height: 44px;
        padding: 0;
        display: inline-flex; align-items: center; justify-content: center;
      }

      /* The sticky validate bar wraps to multiple rows on phones (status
         line on its own row + Reject/Reassign/Edit/Validate buttons), so
         the base pb-32 (128px) on the scroll body isn't enough to clear
         it — the trailing clinical-comment textarea hides behind the
         floating bar. Reserve the bar's offset (~tab-nav) plus its wrapped
         height so the last field is always reachable above it. */
      :host .pf-page__body { padding-bottom: calc(var(--tab-nav-total-height) + 150px); }

      /* Patient context strip lets the CRITICAL chip wrap under the
         identity block instead of squeezing the name. */
      :host .pf-ctx { flex-wrap: wrap; }

      /* Culture meta grid: 3 cols is too tight on a phone. */
      :host .pf-culture-rev__meta { grid-template-columns: 1fr; }

      /* Detail drawer becomes a full-width bottom sheet on phones. */
      :host .pf-drawer {
        top: auto;
        bottom: 0;
        left: 0;
        right: 0;
        width: 100%;
        max-height: 88dvh;
        border-left: none;
        border-top: 1px solid var(--glass-border);
        border-radius: 18px 18px 0 0;
        animation: pf-sheet-in 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) both;
      }
      /* Sheet body clears the home-indicator safe area. */
      :host .pf-drawer__body { padding-bottom: calc(18px + env(safe-area-inset-bottom, 0px)); }

      /* Drawer meta to single column so labels/values don't crush. */
      :host .pf-drawer__meta { grid-template-columns: 1fr; }

      /* Sticky bar: when buttons wrap, give the status line its own row. */
      :host .pf-stickybar__meta { width: 100%; }
    }
    @keyframes pf-sheet-in { from { transform: translateY(24px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

    /* ── iPad / tablet (641–1279px) ──────────────────────────── */
    @media (min-width: 641px) and (max-width: 1279px) {
      /* Use the extra width: 2-up parameter cards rather than the
         auto-fill min that can leave a lonely single column. */
      :host .pf-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }

    /* ── Touch sizing (coarse pointer, any platform) ─────────── */
    @media (pointer: coarse) {
      :host .pf-head__back { min-height: 44px; }
      /* >=44px hit area (was 40px) — the toggle visually stays pill-sized
         via line-height, but the tap target meets the touch minimum. */
      :host .pf-view-toggle__btn { min-height: 44px; }
      :host .pf-btn { min-height: 44px; }
      :host .pf-drawer__close { width: 44px; height: 44px; }
    }

    /* ── Hover-only affordances gated to real hover devices ──── */
    @media (hover: hover) {
      :host .pf-head__back:hover { background: var(--glass-bg-hover); color: var(--text-primary); }
      :host .pf-vcard:hover { background: var(--glass-bg-hover); border-color: var(--glass-border-hover); }
      :host .pf-view-toggle__btn:hover { color: var(--text-primary); }
      :host .pf-table__row:hover { background: var(--glass-bg-hover); }
    }

    /* On touch devices the un-gated base :hover rules above can "stick"
       after a tap (hover persists until the next tap elsewhere). Reset
       them on coarse/no-hover pointers so tapped cards/rows don't keep a
       highlighted state. Additive — desktop hover is untouched. */
    @media (hover: none) {
      :host .pf-head__back:hover { background: var(--glass-bg); color: var(--text-secondary); }
      :host .pf-vcard:hover { background: var(--glass-bg); border-color: var(--glass-border); }
      :host .pf-view-toggle__btn:hover { color: var(--text-tertiary); }
      :host .pf-view-toggle__btn--on:hover { color: var(--text-primary); }
      :host .pf-table__row:hover { background: transparent; }
    }

    /* ── Capacitor native: this page's own fixed chrome must clear
         the notch / home indicator. Global body insets do not reach
         position:fixed descendants. ──────────────────────────── */
    :host-context(html.cap-native) .pf-drawer { top: calc(var(--navbar-height, 4rem) + env(safe-area-inset-top, 0px)); }
    @media (max-width: 640px) {
      :host-context(html.cap-native) .pf-drawer { top: auto; }
      :host-context(html.cap-native) .pf-drawer__body { padding-bottom: calc(18px + env(safe-area-inset-bottom, 0px)); }
    }

    .pf-trend-chk {
      display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
      padding: 7px 12px; border-radius: 10px; font-size: 12.5px; font-weight: 600;
      color: var(--text-secondary); background: rgba(124,58,237,0.08); border: 1px solid rgba(168,85,247,0.25);
    }
    .pf-trend-chk input { width: 15px; height: 15px; accent-color: #7c3aed; }
    .pf-trend-chk select {
      background: var(--input-bg, rgba(255,255,255,0.05)); border: 1px solid var(--glass-border);
      border-radius: 6px; padding: 3px 6px; color: var(--text-primary); font-size: 11.5px;
    }
  
    @media (max-width: 640px) {
      .pf-summary { grid-template-columns: repeat(2, 1fr); }
    }
`]
})
export class ValidateResultComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);

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
  private readonly _view = signal<View>('cards');
  private readonly _detailRow = signal<ValueRow | null>(null);

  readonly selected = this._selected.asReadonly();
  readonly comment = this._comment.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly editing = this._editing.asReadonly();
  readonly view = this._view.asReadonly();
  readonly detailRow = this._detailRow.asReadonly();
  setView(v: View) { this._view.set(v); }

  readonly subtitleText = computed(() => {
    const t = this._selected();
    if (!t) return 'Review the entered result.';
    const name = t.subOrder?.order?.patient?.displayName ?? '—';
    const dept = t.test?.department?.name ?? '—';
    return `${name} · ${dept} · review and sign off`;
  });

  readonly snapshot = computed<ResultSnapshot | null>(() => {
    const raw = this._selected()?.currentResult;
    if (!raw) return null;
    try { return JSON.parse(raw) as ResultSnapshot; } catch { return null; }
  });

  readonly valueRows = computed<ValueRow[]>(() => {
    const t = this._selected();
    const snap = this.snapshot();
    if (!t?.test?.parameters || !snap?.values) return [];

    let params: ParamDef[] = [];
    try {
      const blob = JSON.parse(t.test.parameters);
      params = blob.parameters ?? [];
    } catch { return []; }

    // Pick each parameter's band for THIS patient's sex/age — same resolver
    // as result entry and the report, so the pathologist reviews against the
    // exact range the flag was computed with (the old `[0]` shortcut showed
    // whatever band happened to be listed first).
    const patient = t.subOrder?.order?.patient;
    const sex = normalizeSex(patient?.sex);
    const ageYears = typeof patient?.age === 'number' ? patient.age : null;

    return params.map(p => {
      const v = snap.values![p.name];
      const n = Number(v);
      const isNum = !Number.isNaN(n) && v !== null && v !== undefined && v !== '';
      const r = selectReferenceRange(p.referenceRanges ?? [], sex, ageYears);
      let flag: Flag = 'normal';
      if (isNum) {
        if ((p.criticalLow != null && n <= p.criticalLow) || (p.criticalHigh != null && n >= p.criticalHigh)) flag = 'critical';
        else if (r && (n < r.min || n > r.max)) flag = 'abnormal';
      }
      return {
        name: p.name,
        title: p.title,
        value: v ?? '—',
        numeric: isNum ? n : undefined,
        unit: p.unit,
        range: r ? `${r.min}–${r.max}${p.unit ? ' ' + p.unit : ''}` : undefined,
        min: r?.min,
        max: r?.max,
        critLow: p.criticalLow,
        critHigh: p.criticalHigh,
        isNumeric: isNum || (p.type === 'numeric' || p.type === 'numeric_with_range'),
        flag
      };
    });
  });

  readonly counts = computed(() => {
    const rows = this.valueRows();
    return {
      total: rows.length,
      normal: rows.filter(r => r.flag === 'normal').length,
      abnormal: rows.filter(r => r.flag === 'abnormal').length,
      critical: rows.filter(r => r.flag === 'critical').length
    };
  });

  readonly hasCritical = computed(() => this.counts().critical > 0);

  // ── Microbiology Culture & Sensitivity (read-only review) ──────────
  /** True when this test is a structured culture — renders the organism +
   *  antibiotic (S/I/R) review instead of the flat parameter cards. */
  readonly isCulture = computed<boolean>(() => {
    const raw = this._selected()?.test?.parameters;
    if (!raw) return false;
    try { return (JSON.parse(raw) as { microFormat?: string }).microFormat === 'culture_sensitivity'; }
    catch { return false; }
  });
  /** The entered culture structure (specimen, organisms, AST, notes). */
  readonly cultureResult = computed<CultureResult | null>(
    () => (this.snapshot()?.values as CultureResult) ?? null);

  interpLabel(v?: string): string {
    return v === 'S' ? 'Sensitive' : v === 'R' ? 'Resistant' : v === 'I' ? 'Intermediate' : '—';
  }
  interpTone(v?: string): string {
    return v === 'S' ? '#10b981' : v === 'R' ? '#ef4444' : v === 'I' ? '#f59e0b' : 'var(--text-tertiary)';
  }

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
        const match = (rows ?? []).find(r => r.id === id) ?? null;
        this._selected.set(match);
        if (match) void this.loadComments();
      },
      error: () => this._loading.set(false)
    });
  }

  onComment(e: Event) { this._comment.set((e.target as HTMLTextAreaElement).value); }

  back() { this.router.navigateByUrl('/pathologist'); }

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
    this.toasts.success('Edit mode — click a parameter to change');
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
