import { ViewStateService } from '../../shared/services/view-state.service';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { DialogService } from '../../core/services/dialog.service';
import { ToastService } from '../../core/services/toast.service';
import { ThemeService } from '../../core/services/theme.service';
import { ApiError } from '../../shared/models/api-response.model';
import { BusyDirective } from '../../shared/directives/busy.directive';
import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { PfDateComponent } from '../../shared/components/pf-date/pf-date.component';
import { BackToTodayComponent } from '../../shared/components/back-to-today/back-to-today.component';
import { ScreenHeaderComponent } from '../../shared/primitives/screen-header.component';
import { SelectComponent, PfSelectOption } from '../../shared/primitives/select.component';
import { SkeletonCardComponent, SkeletonRowsComponent } from '../../shared/primitives/skeleton-kit.component';
import { TouchButtonComponent } from '../../shared/primitives/touch-button.component';
import { SG_NARROW_MQ, SG_PHONE_MQ, sgMedia } from '../../shared/settings-grid/settings-grid';
import { bandFilter } from '../../shared/utils/band-search';
import { labToday } from '../../shared/utils/lab-clock';
import { plural } from '../../shared/utils/plural';
import { parseRupees } from './expenses/day-closing.component';
import {
  Closure, DayRow, ModeTotal, canCloseDay, closedWords, closureTotals, closureWord, dayHaystack, dayRows, dayShort, modeRows,
  money, money2, noteRequired, shiftsOf, timeOf, varianceKind, varianceOf, varianceRow,
} from './daily-statement.logic';

interface DailyStatement {
  date: string;
  shift?: string | null;
  openingBalance: number;
  payments: ModeTotal[];
  refunds: ModeTotal[];
  totalCollected: number;
  totalRefunded: number;
  net: number;
  cashCollected: number;
  cashRefunded: number;
  cashExpenses?: number;
  cashTopUps?: number;
  expectedCash: number;
  closure?: Closure | null;
}

/**
 * Finance → Daily statement, the Day closing screen. Test Master's frame: the band (back, lab logo + name, search
 * pill with the shift pick, Close day as the ONE primary), the DAYS side card on the LEFT (today "Open" on top,
 * then the closures newest first) and the day's main card on the right: ONE compact figures strip, then COLLECTED
 * BY MODE beside COUNT THE CASH. Close day stays disabled until a count is entered (and, when the drawer is short or
 * over, until the note is filled), asks to confirm with the amounts and posts to the same close endpoint as ever;
 * a closed day is read-only. On phones it is one card with the Days list in a sheet.
 */
@Component({
  selector: 'pf-daily-statement',
  standalone: true,
  imports: [BackToTodayComponent, NgTemplateOutlet, BusyDirective, HeroBandComponent, PfDateComponent, ScreenHeaderComponent, SelectComponent,
    SkeletonCardComponent, SkeletonRowsComponent, TouchButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../shared/settings-grid/settings-grid.scss'],
  template: `
    <section class="pf-cl pf-band-page px-4 md:px-8 pt-6 pb-10" data-testid="closing-page">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" placeholder="Search closures by date or person…"
                      [value]="closureQ()" (valueChange)="closureQ.set($event)">
          <ng-container band-tools>
            @if (narrow()) {
              <button type="button" class="pf-chip pf-sg-chip press" (click)="sheetOpen.set(true)" aria-haspopup="dialog"
                      [attr.aria-expanded]="sheetOpen()" title="Days" data-testid="closing-sheet-chip">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4M16 2v4M3 10h18"/><path d="M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/></svg>
                Days
              </button>
            }
            <pf-select class="pf-cl__shift" size="sm" [options]="shiftOptions()" [value]="shiftName()" [searchable]="true"
                       [allowCreate]="true" createVerb="Use shift" placeholder="All shifts" aria-label="Shift"
                       (valueChange)="setShift($event)"></pf-select>
          </ng-container>
          <ng-container band-actions>
            @if (stmt(); as s) {
              @if (!s.closure) {
                <button type="button" class="pf-hb-btn pf-hb-btn--primary press" data-testid="close-day"
                        [disabled]="!canClose()" [pfBusy]="saving()" pfBusyLabel="Closing…" (click)="closeDay()"
                        [attr.aria-label]="closeLabel()"
                        [title]="closeHint()">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4"/></svg>
                  {{ saving() ? 'Closing…' : closeLabel() }}
                </button>
              }
            }
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Finance"
        title="Day closing"
        subtitle="Collections by mode, cash count and day closure.">
        @if (stmt(); as s) {
          @if (!s.closure) {
            <pf-touch-btn actions size="md" variant="primary" [disabled]="!canClose()" [busy]="saving()" busyLabel="Closing…"
                          data-testid="close-day-classic" (pressed)="closeDay()">{{ closeLabel() }}</pf-touch-btn>
          }
        }
      </pf-screen-header>

      <div class="pf-band-body pf-band-body--fill">
        <div class="pf-sg-panels" [class.pf-sg-panels--narrow]="narrow()">
          @if (narrow()) {
            @if (sheetOpen()) {
              <div class="pf-sheet-backdrop" (click)="sheetOpen.set(false)"></div>
              <aside class="pf-card pf-sg-side pf-sg-side--sheet pf-cl__side" role="dialog" aria-modal="true" aria-label="Days"
                     data-testid="closing-side" (keydown.escape)="sheetOpen.set(false)">
                <span class="pf-sg-sheet-handle" aria-hidden="true"></span>
                <ng-container *ngTemplateOutlet="daysCard; context: { sheet: true }"></ng-container>
              </aside>
            }
          } @else {
            <aside class="pf-card pf-sg-side pf-cl__side" aria-label="Days" data-testid="closing-side">
              <ng-container *ngTemplateOutlet="daysCard; context: { sheet: false }"></ng-container>
            </aside>
          }

          <section class="pf-card pf-sg-main pf-cl__main" aria-label="Day figures" data-testid="closing-main">
            <header class="pf-card__head pf-sg-main__head pf-cl__head">
              <span class="pf-card__icon" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg>
              </span>
              <span class="pf-card__label" data-testid="closing-title">{{ headLabel() }}</span>
              @if (stmt(); as s) {
                <span class="pf-cl__state" [attr.data-state]="s.closure ? 'closed' : 'open'" data-testid="closing-state">
                  <span class="pf-cl__sdot" aria-hidden="true"></span>{{ s.closure ? 'Closed' : 'Open' }}
                </span>
              }
              <span class="pf-card__spacer"></span>
              <span class="pf-cl__scope">{{ scopeWords() }}</span>
              <pf-back-to-today [show]="!isToday()" (reset)="setDate(todayStr)" />
              <pf-date class="pf-cl__date" label="Business day" [max]="todayStr" [value]="dateStr()" (valueChange)="setDate($event)"></pf-date>
            </header>

            <div class="pf-cl__body">
              @if (stmt(); as s) {
                <div class="pf-cl__strip" role="group" aria-label="Day figures">
                  <div class="pf-cl__cell"><span class="pf-cl__k">Opening cash</span><span class="pf-cl__v pf-num">{{ money2(openingShown()) }}</span><span class="pf-cl__sub">Carried from the last closing</span></div>
                  <div class="pf-cl__cell"><span class="pf-cl__k">Collected</span><span class="pf-cl__v pf-num">{{ money2(collected()) }}</span><span class="pf-cl__sub">All modes, {{ plural(paymentCount(), 'payment') }}</span></div>
                  <div class="pf-cl__cell"><span class="pf-cl__k">Refunds</span><span class="pf-cl__v pf-num">{{ money2(refunded()) }}</span><span class="pf-cl__sub">Paid back to patients</span></div>
                  <div class="pf-cl__cell"><span class="pf-cl__k">Expected cash</span><span class="pf-cl__v pf-num" data-testid="closing-expected">{{ money2(expected()) }}</span><span class="pf-cl__sub">{{ expectedHint() }}</span></div>
                </div>

                <div class="pf-cl__cols">
                  <div class="pf-cl__col pf-cl__col--modes">
                    <h3 class="pf-cl__h">Collected by mode</h3>
                    <ul class="pf-cl__modes" aria-label="Collected by mode">
                      @for (m of modes(); track m.mode) {
                        <li class="pf-cl__mode">
                          <span class="pf-cl__micon" aria-hidden="true">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="m.iconPath"/></svg>
                          </span>
                          <span class="pf-cl__mtext">
                            <span class="pf-cl__mlabel">{{ m.label }}</span>
                            <span class="pf-cl__msub">{{ plural(m.count, 'payment') }}{{ m.refunded > 0 ? ' · ' + money(m.refunded) + ' refunded' : '' }}</span>
                          </span>
                          <span class="pf-cl__mval pf-num">{{ money2(m.collected) }}</span>
                        </li>
                      }
                    </ul>
                    <div class="pf-cl__net"><span>{{ isToday() ? 'Net collected today' : 'Net collected' }}</span><span class="pf-num">{{ money2(collected() - refunded()) }}</span></div>
                  </div>

                  <div class="pf-cl__col pf-cl__col--count">
                    <h3 class="pf-cl__h">Count the cash</h3>
                    <div class="pf-cl__field">
                      <label class="pf-cl__lbl" for="pf-cl-count">Cash in the drawer now</label>
                      <div class="pf-cl__money" [class.pf-cl__money--err]="countedText().trim() !== '' && counted() === null" [class.pf-cl__money--off]="closed()">
                        <span class="pf-cl__rs" aria-hidden="true">₹</span>
                        <input id="pf-cl-count" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00"
                               [disabled]="closed()" [value]="countedShown()" (input)="countedText.set($any($event.target).value)"
                               data-testid="closing-count" />
                      </div>
                      @if (countedText().trim() !== '' && counted() === null) {
                        <span class="pf-cl__err" role="alert">Type an amount like 3,950 or 3950.50.</span>
                      }
                    </div>

                    <dl class="pf-cl__sum" aria-label="Cash summary" aria-live="polite" data-testid="closing-summary">
                      <div><dt>Expected in the drawer</dt><dd class="pf-num">{{ money2(expected()) }}</dd></div>
                      <div><dt>You counted</dt><dd class="pf-num">{{ countedNow() === null ? '—' : money2(countedNow()) }}</dd></div>
                      @if (varianceNow() !== null) {
                        <div class="pf-cl__sumrow--end" [attr.data-kind]="vr().kind">
                          <dt>{{ vr().label }}</dt>
                          @if (vr().amount) { <dd class="pf-num pf-cl__var">{{ vr().amount }}</dd> }
                        </div>
                      }
                    </dl>

                    <div class="pf-cl__field">
                      <label class="pf-cl__lbl" for="pf-cl-note">Note <span class="pf-cl__req">{{ noteNeeded() ? '(needed, the drawer is ' + (varianceNow()! < 0 ? 'short' : 'over') + ')' : '(needed when short or over)' }}</span></label>
                      <textarea id="pf-cl-note" class="pf-input pf-cl__note" rows="3" [disabled]="closed()" data-testid="closing-note"
                                placeholder="e.g. ₹50 change given to a patient, will collect tomorrow"
                                [value]="noteShown()" (input)="note.set($any($event.target).value)"></textarea>
                    </div>

                    <p class="pf-cl__help" data-testid="closing-help">{{ helpLine() }}</p>
                  </div>
                </div>
              } @else {
                <div class="pf-cl__strip" aria-hidden="true">
                  @for (i of [1, 2, 3, 4]; track i) { <div class="pf-cl__cell"><pf-skeleton-card [lines]="2" [title]="false" [boxed]="false" label="Loading the day…"></pf-skeleton-card></div> }
                </div>
                <div class="pf-cl__cols">
                  <div class="pf-cl__col"><pf-skeleton-rows [rows]="5" [avatar]="true" [trailing]="true" label="Loading the day…"></pf-skeleton-rows></div>
                  <div class="pf-cl__col"><pf-skeleton-card [lines]="6" [title]="true" [boxed]="false" label="Loading the day…"></pf-skeleton-card></div>
                </div>
              }
            </div>
          </section>
        </div>
      </div>
    </section>

    <ng-template #daysCard let-sheet="sheet">
      <header class="pf-card__head">
        <span class="pf-card__icon" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4M16 2v4M3 10h18"/><path d="M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/></svg>
        </span>
        <span class="pf-card__label">Days</span>
        <span class="pf-card__spacer"></span>
        @if (sheet) {
          <button type="button" class="pf-btn pf-btn--icon" (click)="sheetOpen.set(false)" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        }
      </header>
      <div class="pf-card__body pf-cl__sidebody">
        @if (!closuresLoaded()) {
          <pf-skeleton-rows [rows]="6" [avatar]="false" [trailing]="true" label="Loading the days…"></pf-skeleton-rows>
        } @else {
          <ul class="pf-side-list pf-cl__days" aria-label="Days">
            @for (d of visibleDays(); track d.key) {
              <li>
                <button type="button" class="pf-side-item pf-cl__day" [attr.aria-pressed]="isSelected(d)" [attr.data-testid]="'closing-day-' + d.key"
                        (click)="pickDay(d); sheetOpen.set(false)">
                  <span class="pf-cl__dtext">
                    <span class="pf-cl__dlabel">{{ dayLabel(d) }}</span>
                    <span class="pf-cl__dsub">{{ daySub(d) }}</span>
                  </span>
                  <span class="pf-cl__dright">
                    <span class="pf-cl__damt pf-num">{{ dayAmount(d) }}</span>
                    <span class="pf-cl__dvar" [attr.data-kind]="d.closure ? kindOf(d) : 'open'">{{ d.closure ? closureWord(d.closure.variance) : 'Open' }}</span>
                  </span>
                </button>
              </li>
            }
          </ul>
          @if (visibleDays().length <= 1 && closureQ().trim()) {
            <p class="pf-cl__empty">No closures match "{{ closureQ().trim() }}".</p>
          } @else if (closures().length === 0) {
            <p class="pf-cl__empty">No closures in the last 30 days.</p>
          }
        }
      </div>
    </ng-template>
  `,
  styles: [`
    :host { display: block; }
    .pf-cl__shift { min-width: 150px; }
    .pf-cl__head { flex-wrap: nowrap; }
    .pf-cl__scope { font-size: 12.5px; color: var(--text-tertiary); white-space: nowrap; }
    .pf-cl__date { flex: none; width: 150px; }
    .pf-cl__state { display: inline-flex; align-items: center; gap: 6px; min-height: 24px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--pf-line); background: var(--pf-chip-bg); font-size: 12px; color: var(--text-secondary); }
    .pf-cl__sdot { width: 7px; height: 7px; border-radius: 999px; background: var(--violet-text); }
    .pf-cl__state[data-state='closed'] .pf-cl__sdot { background: var(--text-muted); }

    .pf-cl__main { min-height: 0; }
    .pf-cl__body { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; }
    .pf-cl__strip { flex: none; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-bottom: 1px solid var(--pf-line); }
    .pf-cl__cell { padding: 14px 18px; display: flex; flex-direction: column; gap: 3px; min-width: 0; border-right: 1px solid var(--pf-line); }
    .pf-cl__cell:last-child { border-right: 0; }
    .pf-cl__k { font-size: 12px; color: var(--text-tertiary); }
    .pf-cl__v { font-size: 20px; font-weight: 600; color: var(--text-primary); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .pf-cl__sub { font-size: 11.5px; color: var(--text-tertiary); overflow-wrap: anywhere; }

    .pf-cl__cols { flex: 1 1 auto; display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, 400px); }
    .pf-cl__col { min-width: 0; padding: 14px 18px; display: flex; flex-direction: column; gap: 12px; }
    .pf-cl__col--modes { border-right: 1px solid var(--pf-line); padding-left: 0; padding-right: 0; gap: 0; }
    .pf-cl__h { margin: 0; font-size: 11.5px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-cl__col--modes .pf-cl__h { padding: 0 18px 6px; }
    .pf-cl__modes { list-style: none; margin: 0; padding: 0; }
    .pf-cl__mode { display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 6px 18px; border-bottom: 1px solid var(--pf-line); }
    .pf-cl__micon { flex: none; width: 34px; height: 34px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent); color: var(--violet-text); }
    .pf-cl__mtext { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .pf-cl__mlabel { font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .pf-cl__msub { font-size: 12px; color: var(--text-tertiary); overflow-wrap: anywhere; }
    .pf-cl__mval { flex: none; font-size: 15px; font-weight: 600; color: var(--text-primary); font-variant-numeric: tabular-nums; }
    .pf-cl__net { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 56px; padding: 0 18px; font-size: 14px; color: var(--text-secondary); }
    .pf-cl__net .pf-num { font-size: 16px; font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; }

    .pf-cl__field { display: flex; flex-direction: column; gap: 6px; }
    .pf-cl__lbl { font-size: 13px; color: var(--text-secondary); }
    .pf-cl__req { color: var(--text-tertiary); }
    .pf-cl__money { display: flex; align-items: center; gap: 8px; height: 52px; padding: 0 14px; border-radius: 12px; border: 1px solid var(--pf-line); background: var(--pf-card-bg); }
    .pf-cl__money:focus-within { border-color: var(--pf-sel-border); box-shadow: 0 0 0 3px var(--pf-sel-bg); }
    .pf-cl__money--err { border-color: var(--rose-text); }
    .pf-cl__money--off { background: var(--pf-chip-bg); }
    .pf-cl__rs { font-size: 18px; color: var(--text-tertiary); }
    .pf-cl__money input { flex: 1 1 auto; min-width: 0; border: 0; background: transparent; outline: none; font: inherit; font-size: 20px; font-weight: 600; color: var(--text-primary); font-variant-numeric: tabular-nums; }
    .pf-cl__err { font-size: 12px; color: var(--rose-text); }
    .pf-cl__sum { margin: 0; display: flex; flex-direction: column; font-size: 13.5px; }
    .pf-cl__sum > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 36px; border-bottom: 1px solid var(--pf-line); }
    .pf-cl__sum dt { color: var(--text-tertiary); }
    .pf-cl__sum dd { margin: 0; color: var(--text-primary); font-variant-numeric: tabular-nums; }
    .pf-cl__sumrow--end { border-bottom: 0 !important; }
    .pf-cl__sumrow--end dt { font-weight: 600; color: var(--text-primary); }
    .pf-cl__sumrow--end[data-kind='short'] :is(dt, dd), .pf-cl__sumrow--end[data-kind='over'] :is(dt, dd) { color: var(--rose-text); }
    .pf-cl__var { font-weight: 700; }
    .pf-cl__note { min-height: 76px; resize: none; }
    .pf-cl__help { margin: 0; font-size: 12px; line-height: 1.5; color: var(--text-tertiary); }

    .pf-cl__sidebody { padding: 8px !important; gap: 4px !important; }
    .pf-cl__sidebody .pf-side-list { padding: 0; }
    .pf-cl__day { min-height: 56px; align-items: center; }
    .pf-cl__dtext { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; text-align: left; }
    .pf-cl__dlabel { overflow-wrap: anywhere; }
    .pf-cl__dsub { font-size: 11.5px; font-weight: 400; color: var(--text-tertiary); overflow-wrap: anywhere; }
    .pf-cl__dright { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
    .pf-cl__damt { font-size: 13.5px; font-variant-numeric: tabular-nums; }
    .pf-cl__dvar { font-size: 11.5px; font-weight: 400; color: var(--text-tertiary); }
    .pf-cl__dvar:is([data-kind='short'], [data-kind='over']) { color: var(--rose-text); }
    .pf-cl__empty { margin: 8px 10px; font-size: 12.5px; color: var(--text-tertiary); }

    @media (max-width: 1000px) {
      .pf-cl__cols { grid-template-columns: minmax(0, 1fr); }
      .pf-cl__col--modes { border-right: 0; border-bottom: 1px solid var(--pf-line); padding-bottom: 8px; }
    }
    @media (max-width: 640px) {
      .pf-cl__head { flex-wrap: wrap; }
      .pf-cl__scope { display: none; }
      .pf-cl__date { width: 100%; order: 9; }
      .pf-cl__strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .pf-cl__cell { padding: 12px 14px; }
      .pf-cl__cell:nth-child(2) { border-right: 0; }
      .pf-cl__cell:nth-child(-n + 2) { border-bottom: 1px solid var(--pf-line); }
      .pf-cl__v { font-size: 18px; }
      .pf-cl__col { padding: 14px; }
      .pf-cl__col--modes .pf-cl__h, .pf-cl__mode, .pf-cl__net { padding-left: 14px; padding-right: 14px; }
      .pf-cl__shift { min-width: 0; }
    }
  `],
})
export class DailyStatementComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly dialogs = inject(DialogService);
  private readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);

  readonly narrow = sgMedia(SG_NARROW_MQ);
  readonly phone = sgMedia(SG_PHONE_MQ);
  readonly sheetOpen = signal(false);

  /** Band pill search over the Days list (date, weekday words, shift). */
  readonly closureQ = signal('');
  /** Today's business date, strictly IST (lab-clock), never the device's day. */
  readonly todayStr = labToday();

  /** The day on show (yyyy-MM-dd) and its shift ('' = the whole day). */
  readonly dateStr = signal<string>(this.todayStr);
  readonly stmtShift = signal<string>('');
  /** The shift pick in the pill: filters the Days list and sets the shift the statement is read for. */
  readonly shiftName = signal<string>('');
  readonly note = signal<string>('');
  readonly countedText = signal<string>('');
  readonly saving = signal(false);

  private readonly _stmt = signal<DailyStatement | null>(null);
  readonly stmt = this._stmt.asReadonly();
  private readonly _closures = signal<Closure[]>([]);
  readonly closures = this._closures.asReadonly();
  readonly closuresLoaded = signal(false);
  /** Today's collected total, kept for the "Open" row while a past day is on show. */
  private readonly todayTotal = signal<number | null>(null);

  readonly counted = computed(() => parseRupees(this.countedText()));
  readonly closed = computed(() => !!this._stmt()?.closure);
  readonly isToday = computed(() => this.dateStr() === this.todayStr);

  /** What the drawer should hold: the closure's snapshot once closed, else the statement's own figure. */
  readonly expected = computed(() => this._stmt()?.closure?.expectedCash ?? this._stmt()?.expectedCash ?? 0);
  readonly countedNow = computed<number | null>(() => (this.closed() ? this._stmt()!.closure!.countedCash : this.counted()));
  readonly varianceNow = computed<number | null>(() => (this.closed() ? this._stmt()!.closure!.variance : varianceOf(this.counted(), this.expected())));
  /** Counted − expected, null until a count is typed. */
  readonly variance = computed(() => varianceOf(this.counted(), this._stmt()?.expectedCash ?? 0));
  readonly vr = computed(() => varianceRow(this.varianceNow()));
  readonly noteNeeded = computed(() => !this.closed() && noteRequired(this.varianceNow()));
  readonly countedShown = computed(() => (this.closed() ? String(this._stmt()!.closure!.countedCash) : this.countedText()));
  readonly noteShown = computed(() => (this.closed() ? (this._stmt()!.closure!.note ?? '') : this.note()));

  readonly canClose = computed(() => canCloseDay({
    loaded: !!this._stmt(), closed: this.closed(), counted: this.counted(), variance: this.variance(), note: this.note(), saving: this.saving(),
  }));
  readonly closeLabel = computed(() => (this.stmtShift().trim() ? 'Close shift' : 'Close day'));
  readonly closeHint = computed(() => {
    if (this.canClose()) return this.closeLabel();
    if (this.counted() === null) return 'Enter the cash in the drawer first';
    return this.noteNeeded() ? 'Add a note: the drawer is short or over' : this.closeLabel();
  });

  /** The closed day's snapshot (by mode) or the live statement. */
  private readonly snapshot = computed(() => {
    const c = this._stmt()?.closure;
    return c ? closureTotals(c) : null;
  });
  readonly payments = computed(() => this.snapshot()?.payments ?? this._stmt()?.payments ?? []);
  readonly refundsBy = computed(() => this.snapshot()?.refunds ?? this._stmt()?.refunds ?? []);
  readonly modes = computed(() => modeRows(this.payments(), this.refundsBy()));
  readonly collected = computed(() => this.snapshot()?.collected ?? this._stmt()?.totalCollected ?? 0);
  readonly refunded = computed(() => this.snapshot()?.refunded ?? this._stmt()?.totalRefunded ?? 0);
  readonly paymentCount = computed(() => this.payments().reduce((n, p) => n + (p.count ?? 0), 0));
  readonly openingShown = computed(() => this._stmt()?.closure?.openingBalance ?? this._stmt()?.openingBalance ?? 0);
  readonly expectedHint = computed(() => {
    const s = this._stmt();
    return (s?.cashExpenses ?? 0) > 0 || (s?.cashTopUps ?? 0) > 0 ? 'Opening + cash in − cash out, incl. expenses' : 'Opening + cash in − cash refunds';
  });

  /** The shifts the lab uses (from its closures + the one picked). */
  readonly shiftOptions = computed<PfSelectOption<string>[]>(() => {
    const names = new Set(shiftsOf(this._closures()));
    if (this.shiftName().trim()) names.add(this.shiftName().trim());
    return [{ value: '', label: 'All shifts' }, ...[...names].sort((a, b) => a.localeCompare(b)).map((n) => ({ value: n, label: n }))];
  });

  readonly rows = computed(() => dayRows(this._closures(), this.todayStr, this.shiftName().trim()));
  readonly visibleDays = computed(() => bandFilter(this.rows(), this.closureQ(), (r) => dayHaystack(r, [r.date, this.dayLabel(r)].join(' '))));

  readonly headLabel = computed(() => {
    const d = this.dateStr();
    const sh = this.stmtShift().trim();
    return `${d === this.todayStr ? 'Today · ' : ''}${dayShort(d)}${sh ? ' · ' + sh : ''}`;
  });
  readonly scopeWords = computed(() => {
    const branch = this.auth.user()?.branchName;
    const sh = this.stmtShift().trim();
    return `${branch ? branch + ' · ' : ''}${sh ? sh + ' shift' : 'all shifts'}`;
  });
  readonly helpLine = computed(() => {
    const c = this._stmt()?.closure;
    const unit = this.stmtShift().trim() ? 'shift' : 'day';
    if (c) return `Closed${timeOf(c.closedAt) ? ' at ' + timeOf(c.closedAt) : ''}. The counted cash, ${money2(c.countedCash)}, carried forward as the next opening cash.`;
    const n = this.counted();
    return `${this.closeLabel()}${this.theme.isNewDesign() ? ' (top right)' : ''} locks ${unit === 'day' ? "today's" : "this shift's"} totals and carries ${n === null ? 'the counted cash' : money2(n)} forward as ${unit === 'day' ? "tomorrow's" : 'the next'} opening cash.`;
  });

  readonly money = money;
  readonly money2 = money2;
  readonly plural = plural;
  readonly closureWord = closureWord;

  ngOnInit() {
    this.load();
    this.loadClosures();
  }

  setDate(d: string | null) {
    if (!d) return;
    this.dateStr.set(d);
    this.load();
  }

  /** The shift pick: filters the Days list and reads the statement for that shift. */
  setShift(v: string | null) {
    const s = (v ?? '').trim();
    this.shiftName.set(s);
    this.stmtShift.set(s);
    this.load();
  }

  isSelected(r: DayRow): boolean { return r.date === this.dateStr() && (r.shift ?? '') === this.stmtShift().trim(); }
  pickDay(r: DayRow) {
    this.dateStr.set(r.date);
    this.stmtShift.set(r.shift ?? '');
    this.load();
  }
  kindOf(r: DayRow) { return r.closure ? varianceKind(r.closure.variance) : 'none'; }
  dayLabel(r: DayRow): string {
    return `${r.open || r.date === this.todayStr ? 'Today · ' : ''}${dayShort(r.date)}${r.shift ? ' · ' + r.shift : ''}`;
  }
  daySub(r: DayRow): string {
    if (!r.closure) return 'Open · not closed yet';
    const u = this.auth.user();
    return closedWords(r.closure, { id: u?.id, name: u?.displayName });
  }
  dayAmount(r: DayRow): string {
    if (r.closure) { const t = closureTotals(r.closure); return t ? money(t.collected) : '—'; }
    return this.todayTotal() === null ? '—' : money(this.todayTotal());
  }

  load() {
    this._stmt.set(null);
    this.countedText.set('');
    this.note.set('');
    const shift = this.stmtShift().trim();
    const date = this.dateStr();
    const q = `/api/finance/daily?date=${date}${shift ? `&shift=${encodeURIComponent(shift)}` : ''}`;
    this.api.get<DailyStatement>(q).subscribe({
      next: s => {
        if (date !== this.dateStr() || shift !== this.stmtShift().trim()) return;   // a newer pick is already loading
        this._stmt.set(s);
        if (s.date === this.todayStr && !s.closure) this.todayTotal.set(s.totalCollected);
      },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }

  private loadClosures() {
    this.api.get<Closure[]>('/api/finance/closures?days=30').subscribe({
      next: l => { this._closures.set(l ?? []); this.closuresLoaded.set(true); },
      error: () => this.closuresLoaded.set(true),
    });
  }

  async closeDay() {
    const s = this._stmt();
    const counted = this.counted();
    if (!s || counted === null || this.saving() || !this.canClose()) return;
    const v = varianceOf(counted, s.expectedCash)!;
    const vr = varianceRow(v);
    const unit = this.stmtShift().trim() ? 'shift' : 'day';
    const ok = await this.dialogs.confirm({
      title: `${this.closeLabel()} for ${dayShort(this.dateStr())}?`,
      message: `Expected ${money2(s.expectedCash)}, you counted ${money2(counted)}${v === 0 ? ': balanced' : `: ${vr.label.toLowerCase()} ${vr.amount}`}. `
        + `This locks the ${unit}'s totals and carries ${money2(counted)} forward as the next opening cash.`,
      confirmLabel: this.closeLabel(),
    });
    if (!ok) return;
    this.saving.set(true);
    try {
      const c = await firstValueFrom(this.api.post<Closure>('/api/finance/close', {
        date: this.dateStr(),
        shift: this.stmtShift().trim() || null,
        openingBalance: s.openingBalance,
        countedCash: counted,
        note: this.note().trim() || null
      }));
      this._stmt.set({ ...s, closure: c });
      this.countedText.set('');
      this.note.set('');
      this.loadClosures();
      this.toasts.success(c.shift ? 'Shift closed' : 'Day closed');
    } catch (e) {
      const err = ApiError.from(e);
      this.toasts.error(err.message);
      if (err.code === 'already_closed') this.load();
    } finally {
      this.saving.set(false);
    }
  }

  // Screen view state (owner 2026-11-21): filters / tab / search come back as left after in-app navigation;
  // fresh on reload, sign-out and branch switch.
  private readonly _viewState = inject(ViewStateService).bind('finance.daily', { date: this.dateStr, stmtShift: this.stmtShift, shift: this.shiftName, closureQ: this.closureQ });
}
