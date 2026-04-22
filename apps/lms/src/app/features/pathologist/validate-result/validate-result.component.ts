import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { OrderTest } from '../../../shared/models/order.model';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ChipComponent, ChipTone } from '../../../shared/primitives/chip.component';

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
  imports: [FormsModule, DatePipe, AvatarComponent, ChipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-page">
      <!-- Compact header -->
      <header class="pf-page__header px-4 md:px-8 lg:px-10 pt-4">
        <div class="pf-head">
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
          <div class="pf-empty-block">Loading…</div>
        }

        @if (!loading() && !selected()) {
          <div class="pf-empty-block">Order test not found in the validation queue.</div>
        }

        @if (selected(); as t) {

          <!-- Patient + context strip -->
          <div class="pf-ctx">
            <pf-avatar [name]="t.subOrder?.order?.patient?.name ?? '—'" [size]="44"></pf-avatar>
            <div class="pf-ctx__id">
              <p class="pf-ctx__name">{{ t.subOrder?.order?.patient?.name ?? '—' }}</p>
              <p class="pf-ctx__meta">
                {{ t.subOrder?.order?.patient?.sex ?? '—' }} ·
                {{ t.subOrder?.order?.patient?.age ?? '—' }}y ·
                {{ t.test?.department?.name ?? '—' }} ·
                entered {{ t.resultedAt ? (t.resultedAt | date:'MMM d, h:mm a') : '—' }}
              </p>
            </div>
            @if (snapshot()?.flags?.critical) {
              <pf-chip tone="rose" size="sm">CRITICAL</pf-chip>
            }
          </div>

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
                          [attr.data-flag]="r.flag"
                          (click)="openDetail(r)">
                    <span class="pf-table__name">{{ r.title }}</span>
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
                }
              </div>
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
              <button type="button" class="pf-btn pf-btn--ghost press" (click)="reject()">Reject</button>
              <button type="button" class="pf-btn pf-btn--ghost press" (click)="reassign()">Reassign</button>
              <button type="button" class="pf-btn pf-btn--secondary press" (click)="startEdit()">Edit values</button>
              <button type="button"
                      class="pf-btn"
                      [class.pf-btn--primary]="!hasCritical()"
                      [class.pf-btn--danger]="hasCritical()"
                      [disabled]="saving() || valueRows().length === 0"
                      (click)="validate()">
                {{ saving() ? 'Validating…' : (hasCritical() ? 'Validate · notify' : 'Validate') }}
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
    :host { display: block; height: 100%; overflow-y: auto; overflow-x: hidden; }
    .pf-page { min-height: 100%; display: flex; flex-direction: column; }
    .pf-page__header { flex-shrink: 0; }
    .pf-page__body { padding-top: 4px; }

    /* ── Compact page header (same shape as other screens) ─── */
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
      overflow: hidden;
    }
    .pf-table__head, .pf-table__row {
      display: grid;
      grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr) minmax(100px, 1.4fr) 130px;
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
      right: 0; top: 0; bottom: 0;
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
  `]
})
export class ValidateResultComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly _id = signal<string | null>(null);
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
    const name = t.subOrder?.order?.patient?.name ?? '—';
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

    return params.map(p => {
      const v = snap.values![p.name];
      const n = Number(v);
      const isNum = !Number.isNaN(n) && v !== null && v !== undefined && v !== '';
      const r = (p.referenceRanges ?? [])[0];
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
        this.toasts.error(e.message ?? 'Save failed');
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
        this.toasts.error(e.message ?? 'Validation failed');
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
      error: e => this.toasts.error(e.message ?? 'Reject failed')
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
      error: e => this.toasts.error(e.message ?? 'Reassign failed')
    });
  }
}
