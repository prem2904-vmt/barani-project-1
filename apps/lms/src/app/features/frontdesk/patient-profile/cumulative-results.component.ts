import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ZoomSourceDirective } from '../../../core/navigation/zoom.directive';
import {
  CumCell, CumGrid, CumRow, Spark, filterCumulative, sparkline,
} from './patient-profile.clinical';

/**
 * CUMULATIVE RESULTS — the doctor's results review (docs/PF-PATTERN.md §22):
 * an analyte × visit grid, newest visit first (older visits scroll
 * sideways), grouped department → panel. Each analyte carries a tiny
 * sparkline (reference band shaded) and a trend arrow; flagged cells are
 * tinted with the dot-word language (amber high / low, red critical);
 * a row whose visits used different units is flagged. A row opens the full
 * trend chart; a cell opens that visit's order + report.
 * Phones: one card per analyte (value, flag word, a wider sparkline).
 */
@Component({
  selector: 'pf-cumulative-results',
  standalone: true,
  imports: [ZoomSourceDirective, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pf-card pf-cr', '[attr.aria-busy]': 'loading()' },
  template: `
    <header class="pf-card__head pf-cr__head">
      <span class="pf-card__icon" aria-hidden="true">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/></svg>
      </span>
      <span class="pf-card__label pf-cr__label">Cumulative results</span>
      @if (grid(); as g) {
        @if (g.rowCount) {
          <label class="pf-cr__find">
            <svg class="pf-cr__find-i" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <input class="pf-input pf-cr__find-in" type="search" placeholder="Search analytes" aria-label="Search analytes"
                   [value]="query()" (input)="query.set($any($event.target).value)" />
          </label>
          <button type="button" class="pf-toggle pf-cr__abn" role="switch" [attr.aria-checked]="abnormalOnly()"
                  (click)="abnormalOnly.set(!abnormalOnly())">
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
            Abnormal only
          </button>
        }
      }
    </header>

    @if (grid(); as g) {
      @if (g.departments.length > 1) {
        <div class="pf-cr__chips" role="group" aria-label="Departments">
          <button type="button" class="pf-chip pf-cr__chip" [attr.aria-pressed]="!depts().length" (click)="depts.set([])">All</button>
          @for (d of g.departments; track d) {
            <button type="button" class="pf-chip pf-cr__chip" [attr.aria-pressed]="depts().includes(d)" (click)="toggleDept(d)">{{ d }}</button>
          }
        </div>
      }
    }

    <div class="pf-card__body pf-cr__body" [class.pf-cr__body--grid]="!cards()">
      @if (forbidden()) {
        <div class="pf-empty">
          <span class="pf-empty__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></span>
          <p class="pf-empty__title">Results need report access</p>
          <p class="pf-empty__body">Ask an admin for View report or View order to see this patient's results.</p>
        </div>
      } @else if (loading()) {
        <div class="pf-cr__skel" aria-hidden="true">
          @for (i of [1, 2, 3, 4, 5, 6]; track i) {
            <div class="pf-cr__skelrow"><span class="pf-cr__sk" style="width: 26%"></span><span class="pf-cr__sk" style="width: 12%"></span><span class="pf-cr__sk" style="width: 10%"></span><span class="pf-cr__sk" style="width: 10%"></span></div>
          }
        </div>
      } @else if (failed()) {
        <div class="pf-empty" role="alert">
          <span class="pf-empty__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16h.01"/></svg></span>
          <p class="pf-empty__title">Couldn’t load results</p>
          <button type="button" class="pf-btn pf-btn--secondary pf-empty__action" (click)="retry.emit()">Try again</button>
        </div>
      } @else if (!grid()?.rowCount) {
        <div class="pf-empty">
          <span class="pf-empty__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v6.5L4.5 17a3 3 0 0 0 2.7 4.5h9.6a3 3 0 0 0 2.7-4.5L15 8.5V2"/><path d="M8 2h8"/><path d="M7 14h10"/></svg></span>
          <p class="pf-empty__title">No results yet</p>
          <p class="pf-empty__body">Resulted tests appear here, one row per analyte, one column per visit.</p>
        </div>
      } @else if (!shown().length) {
        <div class="pf-empty">
          <span class="pf-empty__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></span>
          <p class="pf-empty__title">No analytes match</p>
          <button type="button" class="pf-btn pf-btn--secondary pf-empty__action" (click)="clear()">Clear filters</button>
        </div>
      } @else if (cards()) {
        <!-- Phones: one card per analyte. -->
        @for (g of shown(); track g.key) {
          <h3 class="pf-cr__ghead"><span>{{ g.department }}</span> · {{ g.panel }}</h3>
          <ul class="pf-cr__cards" role="list">
            @for (r of g.rows; track r.key; let i = $index) {
              <li class="pf-cr__cardli" [style.--i]="i < 10 ? i : 10">
                <button type="button" class="pf-cr__card" [attr.data-tone]="r.latest.tone" [pfZoomSource]="[r.key]" (click)="openRow(r)"
                        [attr.aria-label]="rowLabel(r)">
                  <span class="pf-cr__card-top">
                    <span class="pf-cr__card-name">{{ r.title }}</span>
                    @if (r.trend; as t) {
                      <span class="pf-cr__trend pf-num" [attr.data-dir]="t.dir">
                        <ng-container *ngTemplateOutlet="arrow; context: { $implicit: t.dir }"></ng-container>{{ t.text }}
                      </span>
                    }
                  </span>
                  <span class="pf-cr__card-mid">
                    <span class="pf-cr__card-val pf-num" [attr.data-tone]="r.latest.tone">
                      {{ r.latest.value }}@if (r.unit) {<span class="pf-cr__unit">{{ r.unit }}</span>}
                    </span>
                    @if (spark(r, 128, 34); as s) { <ng-container *ngTemplateOutlet="sparkTpl; context: { $implicit: s }"></ng-container> }
                  </span>
                  <span class="pf-cr__card-foot pf-num">
                    @if (r.latest.tone !== 'normal') {
                      <span class="pf-cr__word" [attr.data-tone]="r.latest.tone"><span class="pf-cr__dot" aria-hidden="true"></span>{{ flagWord(r.latest) }}</span>
                    }
                    @if (r.range) { <span>Ref {{ r.range }}</span> }
                    <span>{{ lastDate(r) }}</span>
                    @if (r.unitMismatch) { <span class="pf-cr__mis">Units differ</span> }
                  </span>
                </button>
              </li>
            }
          </ul>
        }
      } @else {
        <table class="pf-cr__t" [attr.aria-label]="'Cumulative results, ' + (grid()?.columns?.length ?? 0) + ' visits'">
          <thead>
            <tr>
              <th scope="col" class="pf-cr__th pf-cr__th--name">Analyte</th>
              <th scope="col" class="pf-cr__th pf-cr__th--ref">Reference</th>
              @for (c of grid()!.columns; track c.orderId) {
                <th scope="col" class="pf-cr__th pf-cr__th--date pf-num" [title]="(c.orderNumber || '') + (c.final ? '' : ' · awaiting validation')">
                  {{ c.label }}
                </th>
              }
            </tr>
          </thead>
          @for (g of shown(); track g.key) {
            <tbody>
              <tr class="pf-cr__grow"><th scope="colgroup" [attr.colspan]="2 + grid()!.columns.length" class="pf-cr__gcell"><span class="pf-cr__gtext"><span class="pf-cr__gdept">{{ g.department }}</span> · {{ g.panel }}</span></th></tr>
              @for (r of g.rows; track r.key) {
                <tr class="pf-cr__row" [attr.data-abn]="r.anyAbnormal ? '' : null">
                  <th scope="row" class="pf-cr__name">
                    <button type="button" class="pf-cr__namebtn" [pfZoomSource]="[r.key]" (click)="openRow(r)" [attr.aria-label]="rowLabel(r)">
                      <span class="pf-cr__nametext">
                        <span class="pf-cr__title">{{ r.title }}</span>
                        <span class="pf-cr__sub pf-num">
                          @if (r.unit) { {{ r.unit }} }
                          @if (r.unitMismatch) { <span class="pf-cr__mis" [title]="'Units used: ' + r.units.join(', ')">Units differ</span> }
                        </span>
                      </span>
                      <span class="pf-cr__viz">
                        @if (spark(r, 64, 22); as s) { <ng-container *ngTemplateOutlet="sparkTpl; context: { $implicit: s }"></ng-container> }
                        @if (r.trend; as t) {
                          <span class="pf-cr__trend pf-num" [attr.data-dir]="t.dir" [title]="'Change since the previous result: ' + t.text">
                            <ng-container *ngTemplateOutlet="arrow; context: { $implicit: t.dir }"></ng-container>{{ t.text === 'no change' ? '0%' : t.text }}
                          </span>
                        }
                      </span>
                    </button>
                  </th>
                  <td class="pf-cr__ref pf-num">{{ r.range || '—' }}</td>
                  @for (c of grid()!.columns; track c.orderId) {
                    @if (r.cells[c.orderId]; as cell) {
                      <td class="pf-cr__cell" [attr.data-tone]="cell.tone">
                        <button type="button" class="pf-cr__cellbtn pf-num" [class.pf-cr__cellbtn--prelim]="!cell.final" [pfZoomSource]="[c.orderId]"
                                (click)="openOrder.emit(c.orderId)" [attr.aria-label]="cellLabel(r, cell, c.label)"
                                [title]="cellTitle(cell)">
                          @if (cell.dir) { <ng-container *ngTemplateOutlet="arrow; context: { $implicit: cell.dir }"></ng-container> }
                          <span>{{ cell.value }}</span>
                          @if (cell.unitOff) { <span class="pf-cr__cellunit">{{ cell.unit }}</span> }
                        </button>
                      </td>
                    } @else {
                      <td class="pf-cr__cell pf-cr__cell--empty" aria-label="No result"></td>
                    }
                  }
                </tr>
              }
            </tbody>
          }
        </table>
      }
    </div>
    @if (grid()?.rowCount && !cards()) {
      <footer class="pf-cr__legend pf-num" aria-label="Legend">
        <span class="pf-cr__word" data-tone="abnormal"><span class="pf-cr__dot" aria-hidden="true"></span>High / low</span>
        <span class="pf-cr__word" data-tone="critical"><span class="pf-cr__dot" aria-hidden="true"></span>Critical</span>
        <span class="pf-cr__lg"><span class="pf-cr__lg-band" aria-hidden="true"></span>Reference band</span>
        <span class="pf-cr__lg"><span class="pf-cr__lg-prelim" aria-hidden="true">12</span>Awaiting validation</span>
        @if (truncated()) { <span class="pf-cr__lg">Latest 600 results</span> }
      </footer>
    }

    <ng-template #arrow let-dir>
      @if (dir === 'up') {
        <svg class="pf-cr__arrow" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
      } @else if (dir === 'down') {
        <svg class="pf-cr__arrow" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>
      } @else {
        <svg class="pf-cr__arrow" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/></svg>
      }
    </ng-template>
    <ng-template #sparkTpl let-s>
      <svg class="pf-cr__spark" [attr.width]="s.w" [attr.height]="s.h" [attr.viewBox]="'0 0 ' + s.w + ' ' + s.h" aria-hidden="true" focusable="false">
        @if (s.band) { <rect class="pf-cr__band" x="0" [attr.y]="s.band.y" [attr.width]="s.w" [attr.height]="s.band.h" rx="2"></rect> }
        <path class="pf-cr__line" [attr.d]="s.d"></path>
        @for (p of s.dots; track $index; let last = $last) {
          @if (last || p.tone !== 'normal') {
            <circle [attr.cx]="p.x" [attr.cy]="p.y" [attr.r]="last ? 2.6 : 2" class="pf-cr__pt" [attr.data-tone]="p.tone"></circle>
          }
        }
      </svg>
    </ng-template>
  `,
  styles: [`
    :host { min-width: 0; min-height: 0; container-type: inline-size; }
    .pf-cr__head { gap: 10px; flex-wrap: nowrap; min-height: 56px; }
    .pf-cr__label { white-space: nowrap; }
    .pf-cr__find { position: relative; display: block; flex: 0 1 240px; min-width: 120px; margin-left: auto; }
    .pf-cr__find-i { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary); pointer-events: none; }
    .pf-cr__find-in { width: 100%; height: 36px; min-height: 36px; padding-left: 34px; font-size: 13px; }
    .pf-cr__abn { flex: none; min-height: 36px; font-size: 12.5px; }
    .pf-cr__chips { display: flex; gap: 6px; padding: 10px 16px; border-bottom: 1px solid var(--pf-line); overflow-x: auto; scrollbar-width: none; flex: none; }
    .pf-cr__chips::-webkit-scrollbar { display: none; }
    .pf-cr__chip { flex: none; }

    .pf-cr__body { overscroll-behavior: contain; }
    .pf-cr__body--grid { padding: 0; overflow: auto; }

    /* ── Grid: sticky header row + sticky analyte column ── */
    .pf-cr__t { border-collapse: separate; border-spacing: 0; min-width: 100%; font-size: 13px; color: var(--text-primary); }
    .pf-cr__th {
      position: sticky; top: 0; z-index: 2; background: var(--pf-card-bg);
      padding: 8px 12px; border-bottom: 1px solid var(--pf-line);
      font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-tertiary);
      text-align: right; white-space: nowrap;
    }
    .pf-cr__th--name { left: 0; z-index: 3; text-align: left; min-width: 250px; }
    .pf-cr__th--ref { text-align: left; }
    .pf-cr__th--date { text-transform: none; letter-spacing: 0; font-size: 12px; font-weight: 600; color: var(--text-secondary); min-width: 76px; }
    .pf-cr__gcell { position: sticky; left: 0; z-index: 1; padding: 14px 12px 6px; text-align: left; background: var(--pf-card-bg); }
    .pf-cr__gtext { position: sticky; left: 12px; font-size: 12px; font-weight: 500; color: var(--text-secondary); white-space: nowrap; }
    .pf-cr__gdept { font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-cr__row > * { border-bottom: 1px solid var(--pf-line); }
    .pf-cr__name { position: sticky; left: 0; z-index: 1; background: var(--pf-card-bg); padding: 0; text-align: left; font-weight: 400; box-shadow: 1px 0 0 var(--pf-line); }
    .pf-cr__namebtn {
      display: flex; align-items: center; gap: 10px; width: 100%; min-height: 48px; padding: 6px 12px;
      border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer;
    }
    .pf-cr__namebtn:hover { background: var(--pf-chip-bg); }
    .pf-cr__namebtn:focus-visible, .pf-cr__cellbtn:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: -2px; }
    .pf-cr__nametext { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
    .pf-cr__title { font-size: 13px; font-weight: 500; line-height: 1.3; overflow-wrap: anywhere; }
    .pf-cr__sub { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 11.5px; color: var(--text-tertiary); }
    .pf-cr__viz { flex: none; display: inline-flex; align-items: center; gap: 6px; }
    .pf-cr__ref { padding: 6px 12px; font-size: 12px; color: var(--text-tertiary); white-space: nowrap; max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
    .pf-cr__cell { padding: 0; text-align: right; }
    .pf-cr__cellbtn {
      display: inline-flex; align-items: center; justify-content: flex-end; gap: 3px; width: 100%; min-height: 48px; padding: 6px 12px;
      border: 0; background: transparent; color: inherit; font: inherit; font-size: 13px; cursor: pointer; white-space: nowrap;
    }
    .pf-cr__cellbtn:hover { background: var(--pf-chip-bg); }
    .pf-cr__cellbtn--prelim span:first-of-type { text-decoration: underline dotted; text-underline-offset: 3px; }
    .pf-cr__cellunit { font-size: 11px; font-weight: 500; color: color-mix(in srgb, var(--amber-text) 80%, var(--text-primary)); }
    /* Flag tint: subtle, the dot-word tones (amber high / low, red critical). */
    .pf-cr__cell[data-tone='abnormal'] { background: color-mix(in srgb, var(--amber-text) 9%, transparent); }
    .pf-cr__cell[data-tone='abnormal'] .pf-cr__cellbtn { color: color-mix(in srgb, var(--amber-text) 78%, var(--text-primary)); font-weight: 600; }
    .pf-cr__cell[data-tone='critical'] { background: color-mix(in srgb, var(--red-text) 11%, transparent); }
    .pf-cr__cell[data-tone='critical'] .pf-cr__cellbtn { color: color-mix(in srgb, var(--red-text) 85%, var(--text-primary)); font-weight: 600; }
    .pf-cr__arrow { flex: none; }

    .pf-cr__trend { display: inline-flex; align-items: center; gap: 2px; min-width: 46px; font-size: 11.5px; font-weight: 500; color: var(--text-tertiary); white-space: nowrap; }
    .pf-cr__mis {
      display: inline-flex; align-items: center; height: 18px; padding: 0 6px; border-radius: 999px;
      font-size: 10.5px; font-weight: 600; color: color-mix(in srgb, var(--amber-text) 80%, var(--text-primary));
      background: color-mix(in srgb, var(--amber-text) 12%, transparent);
    }

    /* Sparkline: violet line, neutral band, toned flagged points. */
    .pf-cr__spark { flex: none; overflow: visible; }
    .pf-cr__band { fill: color-mix(in srgb, var(--text-tertiary) 16%, transparent); }
    .pf-cr__line { fill: none; stroke: var(--violet-text, #7c3aed); stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; }
    .pf-cr__pt { fill: var(--violet-text, #7c3aed); }
    .pf-cr__pt[data-tone='abnormal'] { fill: var(--amber-text); }
    .pf-cr__pt[data-tone='critical'] { fill: var(--red-text); }

    /* Dot + coloured word. */
    .pf-cr__word { --t: var(--text-tertiary); display: inline-flex; align-items: center; gap: 6px; font-weight: 500; color: color-mix(in srgb, var(--t) 75%, var(--text-primary)); }
    .pf-cr__word[data-tone='abnormal'] { --t: var(--amber-text); }
    .pf-cr__word[data-tone='critical'] { --t: var(--red-text); }
    .pf-cr__dot { flex: none; width: 7px; height: 7px; border-radius: 999px; background: var(--t); }

    .pf-cr__legend { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; padding: 8px 16px 10px; border-top: 1px solid var(--pf-line); font-size: 11.5px; color: var(--text-tertiary); }
    .pf-cr__lg { display: inline-flex; align-items: center; gap: 6px; }
    .pf-cr__lg-band { width: 18px; height: 8px; border-radius: 2px; background: color-mix(in srgb, var(--text-tertiary) 16%, transparent); }
    .pf-cr__lg-prelim { text-decoration: underline dotted; text-underline-offset: 3px; color: var(--text-secondary); }

    .pf-cr__skel { display: flex; flex-direction: column; gap: 6px; padding: 12px 16px; }
    .pf-cr__skelrow { display: flex; gap: 24px; height: 40px; align-items: center; border-bottom: 1px solid var(--pf-line); }
    .pf-cr__sk { display: block; height: 11px; border-radius: 6px; background: var(--pf-chip-bg); }

    /* ── Phone cards ── */
    .pf-cr__ghead { margin: 14px 2px 8px; font-size: 12px; font-weight: 500; color: var(--text-secondary); }
    .pf-cr__ghead:first-child { margin-top: 2px; }
    .pf-cr__ghead span { font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-cr__cards { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr; gap: 8px; }
    .pf-cr__cardli { animation: pf-cr-in var(--pf-dur, 320ms) var(--pf-spring) both; animation-delay: calc(var(--i, 0) * 18ms); }
    @keyframes pf-cr-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    .pf-cr__card {
      display: flex; flex-direction: column; gap: 6px; width: 100%; min-height: 44px; padding: 12px 14px; text-align: left; cursor: pointer;
      border-radius: var(--pf-radius, 12px); border: 1px solid var(--pf-line); background: var(--pf-card-bg); color: var(--text-primary); font: inherit;
    }
    .pf-cr__card[data-tone='abnormal'] { border-left: 3px solid color-mix(in srgb, var(--amber-text) 70%, transparent); }
    .pf-cr__card[data-tone='critical'] { border-left: 3px solid color-mix(in srgb, var(--red-text) 75%, transparent); }
    .pf-cr__card-top, .pf-cr__card-mid { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .pf-cr__card-name { font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
    .pf-cr__card-val { font-size: 20px; font-weight: 600; }
    .pf-cr__card-val[data-tone='abnormal'] { color: color-mix(in srgb, var(--amber-text) 80%, var(--text-primary)); }
    .pf-cr__card-val[data-tone='critical'] { color: color-mix(in srgb, var(--red-text) 85%, var(--text-primary)); }
    .pf-cr__unit { margin-left: 4px; font-size: 12px; font-weight: 400; color: var(--text-tertiary); }
    .pf-cr__card-foot { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; color: var(--text-tertiary); }

    @container (max-width: 720px) {
      .pf-cr__label { display: none; }
      .pf-cr__find { margin-left: 0; flex: 1 1 auto; }
    }
    @media (max-width: 640px) {
      .pf-cr__head { flex-wrap: wrap; padding: 10px 12px; min-height: 0; }
      .pf-cr__head > .pf-card__icon { display: none; }
      .pf-cr__label { display: inline; flex: 1 1 auto; }
      .pf-cr__find { flex: 1 1 100%; order: 3; }
      .pf-cr__find-in { height: 44px; min-height: 44px; font-size: 16px; }
      .pf-cr__abn { min-height: 44px; }
      .pf-cr__chips { padding: 8px 12px; }
      .pf-cr__chip { height: 36px; }
    }
    @media (prefers-reduced-motion: reduce) { .pf-cr__cardli { animation: none !important; } }
  `],
})
export class CumulativeResultsComponent {
  readonly grid = input<CumGrid | null>(null);
  readonly loading = input(false);
  readonly failed = input(false);
  readonly forbidden = input(false);
  readonly truncated = input(false);
  /** Phones: per-analyte cards instead of the wide grid. */
  readonly cards = input(false);
  /** Seed the filter (the snapshot's "N more" → abnormal only). */
  readonly abnormalSeed = input(0);

  readonly openTrend = output<CumRow>();
  readonly openOrder = output<string>();
  readonly retry = output<void>();

  readonly query = signal('');
  readonly abnormalOnly = signal(false);
  readonly depts = signal<string[]>([]);
  private readonly _seed = effect(() => { if (this.abnormalSeed()) untracked(() => this.abnormalOnly.set(true)); });

  readonly shown = computed(() => {
    const g = this.grid();
    return g ? filterCumulative(g, { departments: this.depts(), abnormalOnly: this.abnormalOnly(), query: this.query() }) : [];
  });

  private readonly sparkCache = new Map<string, Spark | null>();
  spark(r: CumRow, w: number, h: number): Spark | null {
    const k = `${r.key}|${w}|${h}|${r.points.length}|${r.range}`;
    if (!this.sparkCache.has(k)) this.sparkCache.set(k, sparkline(r.points, r.range, w, h));
    return this.sparkCache.get(k)!;
  }

  toggleDept(d: string): void {
    this.depts.update(list => list.includes(d) ? list.filter(x => x !== d) : [...list, d]);
  }
  clear(): void { this.query.set(''); this.abnormalOnly.set(false); this.depts.set([]); }

  /** A row with a real series opens the trend chart; a one-off value opens
   *  its visit instead (there is nothing to chart). */
  openRow(r: CumRow): void {
    if (r.points.length >= 2) this.openTrend.emit(r);
    else this.openOrder.emit(r.latest.orderId);
  }

  flagWord(c: CumCell): string {
    if (c.tone === 'critical') return c.dir === 'down' ? 'Critical low' : c.dir === 'up' ? 'Critical high' : 'Critical';
    return c.dir === 'up' ? 'High' : c.dir === 'down' ? 'Low' : 'Abnormal';
  }
  lastDate(r: CumRow): string {
    const col = this.grid()?.columns.find(c => c.orderId === r.latest.orderId);
    const n = Object.keys(r.cells).length;
    return `${col?.label ?? ''}${n > 1 ? ` · ${n} results` : ''}`;
  }
  rowLabel(r: CumRow): string {
    const t = r.trend ? `, ${r.trend.text} since the previous result` : '';
    return `${r.title}, latest ${r.latest.value}${r.unit ? ' ' + r.unit : ''}${r.latest.tone !== 'normal' ? ', ' + this.flagWord(r.latest) : ''}${t}. ${r.points.length >= 2 ? 'Open the trend' : 'Open the visit'}`;
  }
  cellLabel(r: CumRow, c: CumCell, date: string): string {
    return `${r.title} ${c.value}${c.unit ? ' ' + c.unit : ''} on ${date}${c.tone !== 'normal' ? ', ' + this.flagWord(c) : ''}${c.final ? '' : ', awaiting validation'}. Open the report`;
  }
  cellTitle(c: CumCell): string {
    return [c.tone !== 'normal' ? this.flagWord(c) : '', c.range ? `Ref ${c.range}` : '', c.unitOff ? `Unit ${c.unit}` : '', c.final ? '' : 'Awaiting validation']
      .filter(Boolean).join(' · ');
  }
}
