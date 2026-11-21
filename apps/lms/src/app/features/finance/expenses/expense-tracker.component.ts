import { SkelGridComponent } from '../../../shared/components/skeleton-frame/skeleton-frame.component';
import { ViewStateService } from '../../../shared/services/view-state.service';
import { GridViewStateDirective } from '../../../shared/services/grid-view-state';
import { BackToTodayComponent } from '../../../shared/components/back-to-today/back-to-today.component';
import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, effect, inject, signal, untracked } from '@angular/core';
import { NgTemplateOutlet, formatDate } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { AllCommunityModule, CellClickedEvent, ColDef, GetRowIdParams, ModuleRegistry } from 'ag-grid-community';
import { AgGridAngular } from 'ag-grid-angular';
import { AuthService } from '../../../core/auth/auth.service';
import { ExpenseService } from '../../../core/services/expense.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ApiError } from '../../../shared/models/api-response.model';
import {
  EXPENSE_MODES, EXPENSE_TAB_LABEL, ExpenseBook, ExpenseCategory, ExpenseDay, ExpenseEntry, ExpenseFilter, ExpenseKind, ExpenseMode,
  ExpenseTab, expenseAbilities, expenseHaystack, expenseKindLabel, expenseModeLabel, expenseTabs,
} from '../../../shared/models/expense.model';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { PfDateComponent } from '../../../shared/components/pf-date/pf-date.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { ModalPortalDirective } from '../../../shared/directives/modal-portal.directive';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { SkeletonTableComponent } from '../../../shared/primitives/skeleton-kit.component';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { ndGridDark, ndGridLight } from '../../../shared/utils/pf-grid-theme';
import { bandFilter } from '../../../shared/utils/band-search';
import { LAB_TIME_ZONE, labDaysAgo, labToday } from '../../../shared/utils/lab-clock';
import { plural } from '../../../shared/utils/plural';
import { spinDelay } from '../../../shared/utils/busy';
import { ExpenseEntryDialogComponent } from './expense-entry-dialog.component';
import { DayClosingComponent } from './day-closing.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { dayLabel, inr, dayStatusWords } from './expense-format';
import { statusWordsCol } from '../../../shared/components/status-words/status-words.component';

ModuleRegistry.registerModules([AllCommunityModule]);

type View = 'entries' | 'days';
type QuickRange = 'today' | '7d' | '30d' | 'month' | 'custom';

export { dayLabel, inr } from './expense-format';

/** The loaded entries that match the band search. */
export function searchExpenses(rows: readonly ExpenseEntry[], q: string): ExpenseEntry[] {
  return bandFilter(rows, q, expenseHaystack);
}

/** First day of the IST month of `ymd`. */
function monthStart(ymd: string): string { return ymd.slice(0, 8) + '01'; }

/**
 * Expenses — a PRIMARY everyday screen (main nav, /expenses; /finance/expenses
 * redirects here), shown to anyone holding expense_viewer / _modifier / _admin.
 * ND pattern: band (search pill over the loaded
 * entries; Filters on narrow screens, Export CSV, and the ONE primary — Add
 * expense, an icon on phones), a FILTERS companion on the LEFT (range, type,
 * category, mode + the range's category totals) and the EXPENSE BOOK as the
 * main card: the range's opening · cash in · expenses · closing, then either
 * the entries grid or the DAY BOOK (every IST day's opening / cash in /
 * expenses / closing, open or closed, with the admin's day actions). The
 * server decides every permission; the screen only reflects its verdicts.
 */
@Component({
  selector: 'pf-expense-tracker',
  standalone: true,
  imports: [BackToTodayComponent, GridViewStateDirective, SkelGridComponent, NgTemplateOutlet, AgGridAngular, HeroBandComponent, ScreenHeaderComponent, PfDateComponent, SelectComponent,
    ModalPortalDirective, BusyDirective, SkeletonTableComponent, CurrencyInrPipe, ExpenseEntryDialogComponent, DayClosingComponent, SegmentedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-xt pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" placeholder="Search item, category, vendor, notes…"
                      [value]="q()" (valueChange)="q.set($event)">
          <!-- The screen's sections ride the band pill next to the search
               (owner): no orphan tab row above the cards. Role-gated by
               expenseTabs() exactly as before — one section = no switch. -->
          <ng-container band-tools>
            @if (tabs().length > 1) {
              <ng-container *ngTemplateOutlet="tabSwitch"></ng-container>
            }
          </ng-container>
          <ng-container band-actions>
            @if (narrow() && tab() !== 'closing') {
              <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" (click)="sheetOpen.set(true)"
                      aria-haspopup="dialog" [attr.aria-expanded]="sheetOpen()" aria-label="Filters" title="Filters">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4 2v-8L3 5z"/></svg>
                Filters
              </button>
            }
            @if (tab() !== 'closing') {
            <button type="button" class="pf-hb-btn pf-hb-btn--ghost press pf-xt__export" [disabled]="exporting()" [pfBusy]="exporting()" pfBusyLabel="Preparing the CSV…"
                    (click)="exportCsv()" aria-label="Export CSV" title="Download the entries as CSV">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
              Export CSV
            </button>
            }
            @if (can().canAdd && tab() !== 'closing') {
              <!-- Day closing owns its primary (Close day). Phones: the ONE primary moves to the bottom bar (above the navbar). -->
              <button type="button" class="pf-hb-btn pf-hb-btn--primary press pf-xt__addbtn" (click)="openAdd()" aria-label="Add expense" title="Add expense">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                Add expense
              </button>
            }
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only" eyebrow="Daily work" title="Expenses" subtitle="Enter day-to-day expenses and cash in, with the bill photo.">
        <div actions>
          <button type="button" class="pf-btn pf-btn--secondary" [disabled]="exporting()" (click)="exportCsv()">Export CSV</button>
          @if (can().canAdd) { <button type="button" class="pf-btn pf-btn--primary" (click)="openAdd()">Add expense</button> }
        </div>
      </pf-screen-header>

      <div class="pf-band-body pf-band-body--fill pf-xt__body" [class.pf-xt__body--bar]="can().canAdd && tab() !== 'closing'">
        @if (tabs().length > 1 && !theme.isNewDesign()) {
          <!-- Classic design has no band: the switch keeps its own row. -->
          <div class="pf-xt__tabrow"><ng-container *ngTemplateOutlet="tabSwitch"></ng-container></div>
        }
        @if (tab() === 'closing') {
          <pf-day-closing [date]="closingDate()" [today]="today" [narrow]="narrow()"
                          (dateChange)="closingDate.set($event)" (changed)="load()"></pf-day-closing>
        } @else {
        <div class="pf-xt__panels" [class.pf-xt__panels--narrow]="narrow()">
          @if (narrow()) {
            @if (sheetOpen()) {
              <div class="pf-sheet-backdrop" (click)="sheetOpen.set(false)"></div>
              <aside class="pf-card pf-xt__side pf-xt__side--sheet" role="dialog" aria-modal="true" aria-label="Filters" (keydown.escape)="sheetOpen.set(false)">
                <span class="pf-sheet__handle" aria-hidden="true"></span>
                <ng-container *ngTemplateOutlet="filterHead; context: { sheet: true }"></ng-container>
                <ng-container *ngTemplateOutlet="filterBody"></ng-container>
              </aside>
            }
          } @else {
            <aside class="pf-card pf-xt__side" aria-label="Filters">
              <ng-container *ngTemplateOutlet="filterHead; context: { sheet: false }"></ng-container>
              <ng-container *ngTemplateOutlet="filterBody"></ng-container>
            </aside>
          }

          <section class="pf-card pf-xt__main" aria-label="Expense book">
            <header class="pf-card__head pf-xt__head">
              <span class="pf-card__icon" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v20l2-1.5L8 22l2-1.5L12 22l2-1.5L16 22l2-1.5L20 22V2l-2 1.5L16 2l-2 1.5L12 2l-2 1.5L8 2 6 3.5Z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>
              </span>
              <h2 class="pf-card__label">{{ tab() === 'mine' ? 'My expenses' : 'Expense book' }}</h2>
              @if (seesAll()) {
                <span class="pf-seg pf-xt__view" role="radiogroup" aria-label="View">
                  <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="view() === 'entries'" (click)="view.set('entries')">Entries</button>
                  <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="view() === 'days'" (click)="view.set('days')">Day book</button>
                </span>
              }
              <span class="pf-xt__count pf-num" aria-live="polite">{{ countLabel() }}</span>
            </header>

            @if (book(); as b) {
              <!-- The range as one ledger line: Opening + Cash in − Expenses =
                   Closing. The operators carry the formula; Closing (the
                   result) is the one emphasised figure. -->
              <div class="pf-xt__stats" [class.pf-xt__stats--book]="seesAll()" role="group" aria-label="Range totals">
                @if (seesAll()) {
                  <div class="pf-xt__stat"><span class="pf-xt__statk">Opening</span><span class="pf-xt__statv pf-num">{{ b.opening ?? 0 | inr }}</span><span class="pf-xt__stath pf-num">{{ dayShort(b.from) }}</span></div>
                  <span class="pf-xt__op" aria-hidden="true">+</span>
                }
                <div class="pf-xt__stat"><span class="pf-xt__statk">Cash in</span><span class="pf-xt__statv pf-num">{{ b.totalCashIn | inr }}</span><span class="pf-xt__stath">{{ seesAll() ? 'Top-ups in range' : 'You entered' }}</span></div>
                @if (seesAll()) { <span class="pf-xt__op" aria-hidden="true">−</span> }
                <div class="pf-xt__stat"><span class="pf-xt__statk">Expenses</span><span class="pf-xt__statv pf-num">{{ b.totalExpenses | inr }}</span><span class="pf-xt__stath">{{ seesAll() ? 'All modes' : 'You entered' }}</span></div>
                @if (seesAll()) {
                  <span class="pf-xt__op" aria-hidden="true">=</span>
                  <div class="pf-xt__stat pf-xt__stat--result" [attr.data-neg]="(b.closing ?? 0) < 0">
                    <span class="pf-xt__statk">Closing</span>
                    <span class="pf-xt__statv pf-num" [class.pf-xt__neg]="(b.closing ?? 0) < 0">{{ b.closing ?? 0 | inr }}</span>
                    <span class="pf-xt__stath pf-num">{{ (b.closing ?? 0) < 0 ? 'Below zero · ' + dayShort(b.to) : dayShort(b.to) }}</span>
                  </div>
                }
              </div>
            }

            <div class="pf-xt__grid-wrap">
              @if (listSkeleton()) {
                <pf-skel-grid class="pf-xt__skel" [rows]="30" [columns]="5" label="Loading expenses…"></pf-skel-grid>
              } @else if (view() === 'entries' && !loading() && visibleEntries().length === 0) {
                <div class="pf-empty pf-empty--compact">
                  <span class="pf-empty__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v20l2-1.5L8 22l2-1.5L12 22l2-1.5L16 22l2-1.5L20 22V2l-2 1.5L16 2l-2 1.5L12 2l-2 1.5L8 2 6 3.5Z"/></svg>
                  </span>
                  <p class="pf-empty__title">{{ q().trim() ? 'No entries match "' + q().trim() + '"' : 'No expenses in this range' }}</p>
                  <p class="pf-empty__body">{{ q().trim() ? 'Try another item, vendor or category.' : (can().canAdd ? 'Add the first one — snap the bill on your phone.' : 'Widen the date range.') }}</p>
                  @if (can().canAdd && !q().trim()) {
                    <button type="button" class="pf-btn pf-btn--secondary pf-empty__action" (click)="openAdd()">Add expense</button>
                  }
                </div>
              } @else if (view() === 'entries') {
                <ag-grid-angular class="pf-xt__grid" pfGridViewState="expenses.entries" [theme]="gridTheme()" [rowData]="visibleEntries()" [columnDefs]="entryCols()"
                                 [defaultColDef]="defaultColDef" [getRowId]="entryRowId" [rowClassRules]="entryRowRules" [animateRows]="true" [suppressCellFocus]="true"
                                 (cellClicked)="onEntryClicked($event)"></ag-grid-angular>
              } @else {
                <ag-grid-angular class="pf-xt__grid" pfGridViewState="expenses.days" [theme]="gridTheme()" [rowData]="book()?.days ?? []" [columnDefs]="dayCols()"
                                 [defaultColDef]="defaultColDef" [getRowId]="dayRowId" [animateRows]="true" [suppressCellFocus]="true"
                                 (cellClicked)="onDayClicked($event)"></ag-grid-angular>
              }
              @if (book()?.truncated && view() === 'entries') {
                <p class="pf-xt__more pf-num">Showing the latest {{ book()!.entries.length }} entries — narrow the dates, or Export CSV for every row.</p>
              }
            </div>
          </section>
        </div>
        }
      </div>

      @if (can().canAdd && tab() !== 'closing') {
        <!-- Phone bottom bar (ND .pf-bottombar, above the navbar): the range's
             spend + the ONE primary. "Snap bill" opens the rear camera first,
             then the form with the photo attached. -->
        <div class="pf-bottombar pf-xt__bar" role="region" aria-label="Add expense">
          <span class="pf-bottombar__info pf-num">{{ barInfo() }}</span>
          <label class="pf-btn pf-btn--secondary pf-btn--icon pf-xt__snap" title="Snap bill" aria-label="Snap a bill photo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            <input class="pf-xt__file" type="file" accept="image/*" capture="environment" (change)="snapBill($event)" />
          </label>
          <button type="button" class="pf-btn pf-btn--primary" (click)="openAdd()">Add expense</button>
        </div>
      }
    </section>

    <ng-template #tabSwitch>
      <pf-segmented class="pf-xt__tabs" [options]="expenseTabOptions()" [value]="tab()" (valueChange)="setTab($any($event))" />
    </ng-template>

    <ng-template #filterHead let-sheet="sheet">
      <header class="pf-card__head">
        <span class="pf-card__icon" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8v6l-4 2v-8L3 5z"/></svg>
        </span>
        <h2 class="pf-card__label">Filters</h2>
        <span class="pf-card__spacer"></span>
        @if (sheet) {
          <button type="button" class="pf-btn pf-btn--icon" (click)="sheetOpen.set(false)" aria-label="Close filters">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        }
      </header>
    </ng-template>

    <ng-template #filterBody>
      <div class="pf-card__body pf-xt__filters">
        <div class="pf-field">
          <span class="pf-field__lbl" id="pf-xt-range-lbl">Dates (IST)</span>
          <!-- Three presets share the row evenly (never wrap); a custom range
               is simply picking From / To below — the presets then show
               none selected and the date row says "Custom range". -->
          <span class="pf-seg pf-xt__seg" role="radiogroup" aria-labelledby="pf-xt-range-lbl">
            <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="quick() === 'today'" (click)="setQuick('today')">Today</button>
            <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="quick() === '7d'" (click)="setQuick('7d')">7 days</button>
            <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="quick() === 'month'" (click)="setQuick('month')">This month</button>
          </span>
          <div class="pf-xt__dates" [attr.data-custom]="quick() === 'custom'">
            @if (quick() === 'custom') { <span class="pf-xt__custom">Custom range</span> }
            <pf-back-to-today [show]="quick() === 'custom' && (to() ?? today) < today" (reset)="setQuick('today')" />
            <label class="pf-xt__dates-lbl" for="pf-xt-from">From</label>
            <pf-date label="From" inputId="pf-xt-from" [value]="from()" [max]="to()" (valueChange)="setFrom($event)"></pf-date>
            <label class="pf-xt__dates-lbl" for="pf-xt-to">To</label>
            <pf-date label="To" inputId="pf-xt-to" [value]="to()" [min]="from()" [max]="today" (valueChange)="setTo($event)"></pf-date>
          </div>
        </div>
        <div class="pf-field">
          <span class="pf-field__lbl" id="pf-xt-kind-lbl">Type</span>
          <span class="pf-seg pf-xt__seg" role="radiogroup" aria-labelledby="pf-xt-kind-lbl">
            <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="kind() === ''" (click)="kind.set('')">All</button>
            <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="kind() === 'expense'" (click)="kind.set('expense')">Expenses</button>
            <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="kind() === 'cash_in'" (click)="kind.set('cash_in')">Cash in</button>
          </span>
        </div>
        <div class="pf-field">
          <label class="pf-field__lbl" for="pf-xt-cat">Category</label>
          <pf-select id="pf-xt-cat" size="sm" [options]="categoryFilterOptions()" [value]="categoryId()" [searchable]="true"
                     (valueChange)="categoryId.set($event)"></pf-select>
        </div>
        <div class="pf-field">
          <label class="pf-field__lbl" for="pf-xt-mode">Payment mode</label>
          <pf-select id="pf-xt-mode" size="sm" [options]="modeFilterOptions" [value]="mode()" (valueChange)="mode.set($any($event) ?? '')"></pf-select>
        </div>

        @if (book(); as b) {
          <div class="pf-field">
            <span class="pf-field__lbl">By category</span>
            @if (b.byCategory.length === 0) {
              <p class="pf-field__hint">No expenses in this range.</p>
            } @else {
              <!-- Name · count · amount on one aligned row, with a hairline
                   share bar (of the range's expenses) under each. Tapping a
                   row filters by it; tapping again clears. -->
              <ul class="pf-xt__totals" aria-label="Expenses by category">
                @for (c of b.byCategory; track c.key) {
                  <li>
                    <button type="button" class="pf-xt__totrow" [attr.aria-pressed]="categoryId() === c.key" (click)="toggleCategory(c.key)"
                            [attr.aria-label]="c.label + ', ' + c.count + ' · ' + (c.total | inr) + (categoryId() === c.key ? ' — filtering, tap to clear' : '')">
                      <span class="pf-xt__totname">{{ c.label }}</span>
                      <span class="pf-xt__totn pf-num">{{ c.count }}</span>
                      <span class="pf-xt__totv pf-num">{{ c.total | inr }}</span>
                      <span class="pf-xt__totbar" aria-hidden="true"><span [style.width.%]="share(c.total, b.totalExpenses)"></span></span>
                    </button>
                  </li>
                }
              </ul>
            }
          </div>
          @if (b.byMode.length > 0) {
            <div class="pf-field">
              <span class="pf-field__lbl">By payment mode</span>
              <ul class="pf-xt__totals pf-xt__totals--static" aria-label="Expenses by payment mode">
                @for (m of b.byMode; track m.key) {
                  <li class="pf-xt__totrow">
                    <span class="pf-xt__totname">{{ m.label }}</span>
                    <span class="pf-xt__totn pf-num">{{ m.count }}</span>
                    <span class="pf-xt__totv pf-num">{{ m.total | inr }}</span>
                  </li>
                }
              </ul>
            </div>
          }
        }

        @if (can().isAdmin) {
          <button type="button" class="pf-btn pf-btn--tertiary pf-xt__managecats" (click)="catsOpen.set(true)">Manage categories</button>
        }
        <p class="pf-field__hint">
          @if (seesAll()) {
            Opening + cash in − expenses = closing (all payment modes). A closed day is locked for everyone until an admin reopens it.
          } @else {
            Only the entries you added. You can change them until the cashier closes the day.
          }
        </p>
      </div>
    </ng-template>

    @if (dialog(); as d) {
      <pf-expense-entry-dialog [entry]="d.entry" [categories]="categories()" [today]="today" [closedThrough]="book()?.closedThrough ?? null"
                               [isAdmin]="can().isAdmin" [initialKind]="d.kind" [initialDate]="d.date" [initialFiles]="d.files ?? []"
                               (closed)="dialog.set(null)" (changed)="load()" (categoryCreated)="addCategory($event)"></pf-expense-entry-dialog>
    }

    @if (billsFor(); as e) {
      <div class="pf-xt-modal" role="dialog" aria-modal="true" aria-labelledby="pf-xt-bills-title" pfModalPortal>
        <div class="pf-xt-modal__backdrop" (click)="billsFor.set(null)"></div>
        <div class="pf-xt-modal__card">
          <header class="pf-xt-modal__head">
            <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg></span>
            <h2 id="pf-xt-bills-title" class="pf-card__label pf-xt-modal__title">Bills · {{ e.description }}</h2>
            <button type="button" class="pf-btn pf-btn--icon" (click)="billsFor.set(null)" aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </header>
          <ul class="pf-xt-modal__bills">
            @for (a of e.attachments; track a.id) {
              <li>
                <a class="pf-xt-modal__bill" [href]="a.url" target="_blank" rel="noopener">
                  <span class="pf-xt-modal__thumb">
                    @if (a.contentType.startsWith('image/')) { <img [src]="a.url" alt="" loading="lazy" /> }
                    @else { <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg> }
                  </span>
                  <span class="pf-xt-modal__name">{{ a.fileName }}</span>
                </a>
              </li>
            }
          </ul>
        </div>
      </div>
    }

    @if (catsOpen()) {
      <div class="pf-xt-modal" role="dialog" aria-modal="true" aria-labelledby="pf-xt-cats-title" pfModalPortal>
        <div class="pf-xt-modal__backdrop" (click)="catsOpen.set(false)"></div>
        <div class="pf-xt-modal__card">
          <header class="pf-xt-modal__head">
            <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8Z"/><path d="M7 7h.01"/></svg></span>
            <h2 id="pf-xt-cats-title" class="pf-card__label pf-xt-modal__title">Expense categories</h2>
            <button type="button" class="pf-btn pf-btn--icon" (click)="catsOpen.set(false)" aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </header>
          <form class="pf-xt-modal__add" (submit)="$event.preventDefault(); createCategory()">
            <input class="pf-input" type="text" maxlength="80" placeholder="New category — e.g. Generator diesel" aria-label="New category name"
                   [value]="newCat()" (input)="newCat.set($any($event.target).value)" />
            <button type="submit" class="pf-btn pf-btn--secondary" [disabled]="!newCat().trim() || catBusy()" [pfBusy]="catBusy()" pfBusyLabel="Adding…">Add</button>
          </form>
          <ul class="pf-xt-modal__cats">
            @for (c of categories(); track c.id) {
              <li class="pf-row pf-xt-modal__cat">
                <span class="pf-row__name" [class.pf-xt__off]="!c.isActive">{{ c.name }}</span>
                @if (!c.isActive) { <span class="pf-chip pf-chip--static">Off</span> }
                <button type="button" class="pf-toggle" role="switch" [attr.aria-checked]="c.isActive"
                        [attr.aria-label]="'Use ' + c.name" (click)="toggleCategoryActive(c)">
                  <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                </button>
              </li>
            }
          </ul>
          <p class="pf-xt-modal__hint">Switched-off categories stay on past entries; they just can't be picked for new ones.</p>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; min-height: 0; }
    .pf-xt__body { display: flex; flex-direction: column; gap: 12px; min-height: 0; }
    /* Section switch: in the band pill (new design) / its own row (classic). */
    .pf-xt__tabrow { align-self: flex-start; flex: none; }
    .pf-xt__tabs { flex: none; }
    .pf-xt__tab { height: 26px; padding: 0 14px; font-size: 12.5px; white-space: nowrap; }
    .pf-xt__panels { display: grid; grid-template-columns: var(--pf-side-w, 340px) minmax(0, 1fr); gap: 16px; align-items: stretch; flex: 1 1 auto; min-height: 0; }
    .pf-xt__panels--narrow { grid-template-columns: minmax(0, 1fr); }
    .pf-xt__side { min-height: 0; }
    .pf-xt__side--sheet {
      position: fixed; left: 0; right: 0; bottom: var(--pf-nav-h, 0px); z-index: 80; max-height: 80dvh;
      border-radius: 18px 18px 0 0; padding-bottom: env(safe-area-inset-bottom, 0px);
    }
    .pf-xt__side--sheet .pf-sheet__handle { display: block; width: 40px; height: 4px; margin: 8px auto 0; border-radius: 999px; background: var(--pf-line); }
    .pf-xt__filters { gap: 20px; overflow-y: auto; }
    /* Presets fill the row in equal columns — never wrap. */
    .pf-xt__seg { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); width: 100%; }
    .pf-xt__seg .pf-seg__item { height: 32px; padding: 0 6px; white-space: nowrap; font-size: 12.5px; }
    .pf-xt__dates { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 8px; align-items: center; margin-top: 4px; }
    .pf-xt__dates-lbl { font-size: 12px; color: var(--text-tertiary); }
    .pf-xt__custom { grid-column: 1 / -1; font-size: 11.5px; font-weight: 500; color: var(--text-tertiary); }
    /* Range totals: aligned name · count · amount rows on hairlines. */
    .pf-xt__totals { list-style: none; margin: 0 -8px; padding: 0; display: flex; flex-direction: column; }
    .pf-xt__totrow {
      display: grid; grid-template-columns: minmax(0, 1fr) auto 92px; column-gap: 10px; row-gap: 6px; align-items: baseline;
      width: 100%; min-height: 44px; padding: 10px 8px 9px; border: 0; border-radius: 10px; background: transparent;
      font: inherit; font-size: 13px; color: var(--text-primary); text-align: left;
    }
    button.pf-xt__totrow { cursor: pointer; transition: background var(--pf-dur-fast, 200ms) ease; }
    button.pf-xt__totrow:hover { background: color-mix(in srgb, var(--text-primary) 4%, transparent); }
    button.pf-xt__totrow:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: -2px; }
    .pf-xt__totrow[aria-pressed='true'] { background: var(--pf-in-tint); box-shadow: inset 0 0 0 1px var(--pf-sel-border); }
    .pf-xt__totals li + li .pf-xt__totrow, li.pf-xt__totrow + li.pf-xt__totrow { border-top: 1px solid var(--pf-line); border-radius: 0; }
    .pf-xt__totals li + li .pf-xt__totrow[aria-pressed='true'] { border-radius: 10px; border-top-color: transparent; }
    .pf-xt__totals--static .pf-xt__totrow { min-height: 40px; padding-block: 9px; }
    .pf-xt__totname { min-width: 0; overflow-wrap: anywhere; font-weight: 500; }
    .pf-xt__totn { font-size: 12px; color: var(--text-tertiary); text-align: right; }
    .pf-xt__totv { text-align: right; font-weight: 500; }
    .pf-xt__totbar { grid-column: 1 / -1; height: 3px; border-radius: 999px; background: var(--pf-chip-bg); overflow: hidden; }
    .pf-xt__totbar > span { display: block; height: 100%; border-radius: inherit; background: var(--pf-toggle-on); }
    .pf-xt__totrow[aria-pressed='true'] .pf-xt__totbar > span { background: var(--pf-switch-on); }
    .pf-xt__managecats { align-self: flex-start; }
    .pf-xt__main { min-width: 0; min-height: 0; }
    .pf-xt__head { flex-wrap: wrap; row-gap: 8px; }
    .pf-xt__view { margin-left: 8px; }
    .pf-xt__count { flex: none; margin-left: auto; font-size: 12.5px; font-weight: 500; color: var(--text-tertiary); white-space: nowrap; }
    /* Ledger line: figures on one baseline, operators between, the result
       (Closing) on a quiet tinted plate. */
    .pf-xt__stats {
      display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: stretch; gap: 4px;
      padding: 12px 14px; border-bottom: 1px solid var(--pf-line);
    }
    .pf-xt__stats--book { grid-template-columns: minmax(0, 1fr) 20px minmax(0, 1fr) 20px minmax(0, 1fr) 20px minmax(0, 1.15fr); }
    .pf-xt__stat { display: flex; flex-direction: column; gap: 3px; padding: 8px 10px; min-width: 0; border-radius: 12px; }
    .pf-xt__stat--result { background: var(--pf-chip-bg); padding-inline: 14px; }
    .pf-xt__statk { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-tertiary); }
    .pf-xt__statv { font-size: 17px; font-weight: 500; line-height: 1.25; color: var(--text-primary); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .pf-xt__stat--result .pf-xt__statv { font-size: 19px; font-weight: 600; }
    .pf-xt__stath { font-size: 11.5px; color: var(--text-tertiary); }
    .pf-xt__op { align-self: center; justify-self: center; font-size: 16px; font-weight: 400; color: var(--text-tertiary); padding-top: 12px; }
    /* Below zero: a muted red figure (data, not an alarm) — no red plate. */
    .pf-xt__neg { color: color-mix(in srgb, var(--red-text, #dc2626) 78%, var(--text-primary)); }
    .pf-xt__off { color: var(--text-tertiary); }
    .pf-xt__grid-wrap { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
    .pf-xt__skel { display: block; }
    .pf-xt__grid { display: block; width: 100%; flex: 1 1 auto; height: calc(100dvh - 380px); min-height: 320px; }
    :host-context(.design-new) .pf-xt__grid { height: auto; min-height: 300px; }
    .pf-xt__main ::ng-deep .ag-root-wrapper { border: 0; border-radius: 0; }
    .pf-xt__main ::ng-deep .ag-row.pf-xt-row--open { cursor: pointer; }
    /* One vertical rhythm: every cell centres on the row (two-line cells and
       single figures no longer sit at different heights). */
    .pf-xt__main ::ng-deep .ag-cell { display: flex; align-items: center; }
    .pf-xt__main ::ng-deep .ag-cell.ag-right-aligned-cell { justify-content: flex-end; }
    .pf-xt__main ::ng-deep .ag-cell > .pf-xt-cell, .pf-xt__main ::ng-deep .ag-cell > .pf-xt-acts { height: auto; }
    /* A text cell always spans its column (the flex centring above must not
       shrink it to its text): the phone amount line then right-aligns to the
       column edge on every row, whatever the title / meta length. */
    .pf-xt__main ::ng-deep .ag-cell > .ag-cell-wrapper { flex: 1 1 auto; width: 100%; min-width: 0; }
    .pf-xt__main ::ng-deep .ag-cell-wrapper > .ag-cell-value { flex: 1 1 auto; min-width: 0; }
    .pf-xt__main ::ng-deep .ag-cell .pf-xt-cell { width: 100%; min-width: 0; }
    .pf-xt__more { margin: 0; padding: 8px 14px; font-size: 12px; color: var(--text-tertiary); border-top: 1px solid var(--pf-line); }
    .pf-xt__main ::ng-deep .pf-xt-cell { line-height: 1.3; display: flex; flex-direction: column; justify-content: center; height: 100%; padding: 6px 0; }
    .pf-xt__main ::ng-deep .pf-xt-cell__sub { font-size: 11.5px; color: var(--text-tertiary); }
    .pf-xt__main ::ng-deep .pf-xt-cell--end { align-items: flex-end; text-align: right; }
    .pf-xt__main ::ng-deep .pf-xt-amt { font-variant-numeric: tabular-nums; font-weight: 500; text-align: right; display: block; white-space: nowrap; }
    .pf-xt__main ::ng-deep .pf-xt-amt--in { color: var(--text-secondary); }
    .pf-xt__main ::ng-deep .pf-xt-amt--neg { color: var(--red-text, #dc2626); }
    .pf-xt__main ::ng-deep .pf-xt-num { font-variant-numeric: tabular-nums; text-align: right; display: block; }
    .pf-xt__main ::ng-deep .pf-xt-acts { display: inline-flex; gap: 6px; align-items: center; height: 100%; }
    .pf-xt__main ::ng-deep .ag-cell.pf-xt-actcell { padding-left: 6px; padding-right: 6px; }
    .pf-xt__main ::ng-deep .pf-xt-acts .pf-rowact--icon { width: 44px; height: 44px; }
    /* Quiet row actions: no outline at rest (the whole row already opens the
       entry); the outline comes back on row hover / keyboard focus. */
    .pf-xt__main ::ng-deep .pf-xt-acts .pf-rowact { border-color: transparent; background: transparent; color: var(--text-tertiary); }
    .pf-xt__main ::ng-deep .ag-row-hover .pf-xt-acts .pf-rowact,
    .pf-xt__main ::ng-deep .pf-xt-acts .pf-rowact:focus-visible { border-color: var(--pf-line); color: var(--text-primary); }
    .pf-xt__main ::ng-deep .pf-xt-billbtn { align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; min-height: 32px; padding: 0 8px; border-radius: 8px; border: 1px solid var(--pf-line); background: transparent; color: var(--text-secondary); font: inherit; font-size: 12px; cursor: pointer; }
    .pf-xt-modal { position: fixed; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center; padding: 16px; }
    .pf-xt-modal__backdrop { position: absolute; inset: 0; background: rgba(5, 5, 15, 0.55); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
    .pf-xt-modal__card { position: relative; width: 100%; max-width: 32rem; max-height: calc(100dvh - 32px); display: flex; flex-direction: column; gap: 12px; padding: 14px 16px 16px; overflow-y: auto;
      border-radius: var(--pf-radius-card, 18px); background: var(--pf-card-bg, var(--bg-card-solid)); border: 1px solid var(--pf-line); box-shadow: 0 30px 70px rgba(0, 0, 0, 0.45); }
    .pf-xt-modal__head { display: flex; align-items: center; gap: 12px; }
    .pf-xt-modal__title { margin: 0; flex: 1 1 auto; }
    .pf-xt-modal__bills { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
    .pf-xt-modal__bill { display: flex; flex-direction: column; gap: 6px; color: inherit; text-decoration: none; }
    .pf-xt-modal__thumb { display: flex; align-items: center; justify-content: center; aspect-ratio: 1; border-radius: 10px; overflow: hidden; border: 1px solid var(--pf-line); background: var(--glass-bg); color: var(--text-tertiary); }
    .pf-xt-modal__thumb img { width: 100%; height: 100%; object-fit: cover; }
    .pf-xt-modal__name { font-size: 12px; color: var(--text-secondary); overflow-wrap: anywhere; }
    .pf-xt-modal__add { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
    .pf-xt-modal__cats { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .pf-xt-modal__cat { gap: 10px; }
    .pf-xt-modal__hint { margin: 0; font-size: 12px; color: var(--text-tertiary); }
    .pf-xt__file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
    .pf-xt__snap { position: relative; width: 44px; height: 44px; flex: none; cursor: pointer; }
    .pf-xt__bar .pf-btn--primary { min-height: 44px; flex: none; }
    @media (max-width: 640px) {
      .pf-xt__addbtn { display: none; }
      .pf-xt__body--bar { padding-bottom: 76px; }
      /* Phones: the switch spans the band row in equal segments (the global
         phone rule keeps tab strips flex + scrollable, so grow, not grid). */
      .pf-xt__tabs { width: 100%; }
      .pf-xt__tab { flex: 1 0 0; height: 36px; padding: 0 8px; }
      .pf-xt__stats, .pf-xt__stats--book { grid-template-columns: 1fr 1fr; padding: 10px; gap: 6px; }
      .pf-xt__op { display: none; }
      .pf-xt__statv { font-size: 16px; }
      .pf-xt__stat--result .pf-xt__statv { font-size: 17px; }
      .pf-xt__view { margin-left: 0; order: 3; }
      .pf-xt__main ::ng-deep .pf-xt-acts { gap: 4px; }
      .pf-xt-modal { align-items: flex-end; padding: 0; bottom: var(--pf-nav-h, 0px); }
      .pf-xt-modal__card { max-width: none; border-radius: 18px 18px 0 0; padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px)); }
      .pf-xt-modal__add .pf-input { font-size: 16px; min-height: 44px; }
    }
  `],
})
export class ExpenseTrackerComponent {
  private readonly svc = inject(ExpenseService);
  private readonly toasts = inject(ToastService);
  private readonly dialogs = inject(DialogService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly theme = inject(ThemeService);

  readonly today = labToday();
  readonly isPhone = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
  readonly isCoarse = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  readonly narrow = signal(this.mq('(max-width: 900px)'));
  readonly sheetOpen = signal(false);

  readonly can = computed(() => expenseAbilities(c => this.auth.hasPermission(c)));
  /** My expenses (anyone who enters) · All expenses (viewer / cashier) · Day closing (cashier). */
  readonly tabs = computed(() => expenseTabs(this.can()));
  readonly tabLabel = EXPENSE_TAB_LABEL;
  private readonly tabPick = signal<ExpenseTab | null>(null);
  readonly tab = computed<ExpenseTab>(() => {
    const p = this.tabPick();
    const list = this.tabs();
    return p && list.includes(p) ? p : (list[0] ?? 'all');
  });
  readonly expenseTabOptions = computed<SegmentedOption<ExpenseTab>[]>(() =>
    this.tabs().map(t => ({ value: t, label: this.tabLabel[t] }))
  );
  readonly closingDate = signal(labToday());

  // ── Filters ───────────────────────────────────────────────────────────
  readonly q = signal('');
  readonly quick = signal<QuickRange>('7d');
  readonly from = signal<string | null>(labDaysAgo(6));
  readonly to = signal<string | null>(labToday());
  readonly kind = signal<ExpenseKind | ''>('');
  readonly categoryId = signal<string>('');
  readonly mode = signal<ExpenseMode | ''>('');
  readonly view = signal<View>('entries');

  // ── Data ──────────────────────────────────────────────────────────────
  readonly book = signal<ExpenseBook | null>(null);
  readonly categories = signal<ExpenseCategory[]>([]);
  readonly loading = signal(true);
  readonly exporting = signal(false);
  readonly listSkeleton = spinDelay(computed(() => this.loading() && !this.book()));
  readonly seesAll = computed(() => (this.book()?.scope ?? (this.can().seesAll ? 'all' : 'own')) === 'all');
  readonly visibleEntries = computed(() => searchExpenses(this.book()?.entries ?? [], this.q()));
  readonly dialog = signal<{ entry: ExpenseEntry | null; kind: ExpenseKind; date: string | null; files?: File[] } | null>(null);
  readonly billsFor = signal<ExpenseEntry | null>(null);
  readonly catsOpen = signal(false);
  readonly newCat = signal('');
  readonly catBusy = signal(false);
  private readonly busyDays = new Set<string>();

  readonly countLabel = computed(() => {
    const b = this.book();
    if (!b) return '';
    if (this.view() === 'days') return plural(b.days.length, 'day');
    const n = this.visibleEntries().length;
    return plural(n, 'entry', 'entries');
  });

  readonly categoryFilterOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: 'All categories' },
    ...this.categories().map(c => ({ value: c.id, label: c.isActive ? c.name : `${c.name} (off)` })),
  ]);
  readonly modeFilterOptions: PfSelectOption<string>[] = [{ value: '', label: 'All modes' }, ...EXPENSE_MODES.map(m => ({ value: m.value, label: m.label }))];
  /** Phone bottom bar: what the loaded range adds up to. */
  readonly barInfo = computed(() => {
    const b = this.book();
    const range = ({ today: 'Today', '7d': '7 days', '30d': '30 days', month: 'This month', custom: 'Range' } as Record<QuickRange, string>)[this.quick()];
    if (!b) return range;
    return `${range} · ${inr(b.totalExpenses)} ${this.seesAll() ? 'spent' : 'by you'}`;
  });
  /** A category's share of the range's expenses, for its hairline bar (0–100). */
  share(total: number, of: number): number { return of > 0 ? Math.max(0, Math.min(100, (total / of) * 100)) : 0; }

  // ── Grids ─────────────────────────────────────────────────────────────
  readonly gridTheme = computed(() => (this.theme.isDark() ? ndGridDark : ndGridLight));
  /** Rows that open something on click (edit, or the bills) show a pointer. */
  readonly entryRowRules = { 'pf-xt-row--open': (p: { data?: ExpenseEntry }) => !!p.data && (p.data.canEdit || p.data.attachments.length > 0) };
  readonly entryRowId = (p: GetRowIdParams<ExpenseEntry>) => p.data.id;
  readonly dayRowId = (p: GetRowIdParams<ExpenseDay>) => p.data.date;
  readonly defaultColDef: ColDef = { sortable: true, resizable: true, filter: false, minWidth: 100, autoHeight: true, wrapText: true };

  private readonly esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));
  private cell(main: string, sub?: string) {
    return `<div class="pf-xt-cell"><span>${this.esc(main)}</span>${sub ? `<span class="pf-xt-cell__sub">${this.esc(sub)}</span>` : ''}</div>`;
  }
  private amountHtml(e: ExpenseEntry) {
    const cls = e.kind === 'cash_in' ? 'pf-xt-amt pf-xt-amt--in' : 'pf-xt-amt';
    return `<span class="${cls}">${e.kind === 'cash_in' ? '+' : ''}${this.esc(inr(e.amount))}</span>`;
  }
  private rowBtn(act: string, label: string, path: string, aria: string, web: boolean) {
    return `<button type="button" class="pf-rowact${web ? '' : ' pf-rowact--icon'}" data-act="${act}" aria-label="${this.esc(aria)}" title="${this.esc(label)}">` +
      `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>` +
      `<span class="pf-rowact__t">${this.esc(label)}</span></button>`;
  }
  private billsHtml(e: ExpenseEntry) {
    const n = e.attachments.length;
    if (!n) return '';
    return `<button type="button" class="pf-xt-billbtn" data-act="bills" aria-label="${n} bill${n === 1 ? '' : 's'} — ${this.esc(e.description)}">` +
      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>${n}</button>`;
  }

  readonly entryCols = computed<ColDef<ExpenseEntry>[]>(() => {
    const web = !this.isCoarse && !this.isPhone;
    const canAdd = this.can().canAdd;
    const edit = '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>';
    const actions: ColDef<ExpenseEntry> = {
      colId: 'actions', headerName: '', sortable: false, resizable: false, pinned: 'right', lockPinned: true,
      width: web ? 84 : 60, minWidth: web ? 84 : 60, flex: 0, cellClass: 'pf-xt-actcell',
      cellRenderer: (p: { data?: ExpenseEntry }) => p.data?.canEdit
        ? `<span class="pf-xt-acts">${this.rowBtn('edit', 'Edit', edit, 'Edit — ' + p.data.description, web)}</span>` : '',
    };
    if (this.isPhone) {
      return [
        { colId: 'date', headerName: 'Day', width: 92, minWidth: 92, flex: 0, sort: 'desc',
          valueGetter: p => p.data?.date ?? '', cellRenderer: (p: { data?: ExpenseEntry }) => this.cell(dayLabel(p.data?.date ?? '', false)) },
        { colId: 'record', headerName: 'Entry', flex: 1, minWidth: 150, valueGetter: p => p.data?.description ?? '',
          cellRenderer: (p: { data?: ExpenseEntry }) => {
            const e = p.data; if (!e) return '';
            return `<div class="pf-xt-cell"><span>${this.esc(e.description)}</span>` +
              `<span class="pf-xt-cell__sub">${this.esc([e.kind === 'cash_in' ? 'Cash in' : e.categoryName, expenseModeLabel(e.paymentMode), e.paidTo].filter(Boolean).join(' · '))}</span>` +
              `${this.amountHtml(e)}${this.billsHtml(e)}</div>`;
          } },
        ...(canAdd ? [actions] : []),
      ];
    }
    const cols: ColDef<ExpenseEntry>[] = [
      { colId: 'date', headerName: 'Date', width: 120, minWidth: 110, flex: 0, sort: 'desc',
        valueGetter: p => p.data?.date ?? '', cellRenderer: (p: { data?: ExpenseEntry }) => this.cell(dayLabel(p.data?.date ?? '')) },
      { colId: 'item', headerName: 'Item', flex: 1.6, minWidth: 180, valueGetter: p => p.data?.description ?? '',
        cellRenderer: (p: { data?: ExpenseEntry }) => this.cell(p.data?.description ?? '', [p.data?.paidTo, p.data?.notes].filter(Boolean).join(' · ')) },
      { colId: 'category', headerName: 'Category', flex: 1, minWidth: 140,
        valueGetter: p => (p.data?.kind === 'cash_in' ? expenseKindLabel('cash_in') : p.data?.categoryName) ?? '',
        cellRenderer: (p: { data?: ExpenseEntry }) => this.cell(p.data?.kind === 'cash_in' ? 'Cash in' : p.data?.categoryName ?? '') },
      { colId: 'mode', headerName: 'Mode', width: 120, minWidth: 100, flex: 0, valueGetter: p => expenseModeLabel(p.data?.paymentMode) },
      // Pinned right (beside the row action): the money never scrolls out of
      // view when the grid is narrower than its columns (iPad + side card).
      { colId: 'amount', headerName: 'Amount', width: 130, minWidth: 120, flex: 0, type: 'rightAligned', pinned: 'right', lockPinned: true,
        valueGetter: p => (p.data ? (p.data.kind === 'cash_in' ? p.data.amount : -p.data.amount) : 0),
        cellRenderer: (p: { data?: ExpenseEntry }) => (p.data ? this.amountHtml(p.data) : '') },
      { colId: 'bills', headerName: 'Bills', width: 84, minWidth: 80, flex: 0, sortable: false,
        cellRenderer: (p: { data?: ExpenseEntry }) => (p.data ? this.billsHtml(p.data) : '') },
      { colId: 'by', headerName: 'Entered by', flex: 1, minWidth: 140, valueGetter: p => p.data?.createdByName ?? '',
        cellRenderer: (p: { data?: ExpenseEntry }) => this.cell(p.data?.createdByName ?? '',
          p.data ? formatDate(p.data.createdAt, 'd MMM, h:mm a', 'en-US', LAB_TIME_ZONE) : '') },
    ];
    return canAdd ? [...cols, actions] : cols;
  });

  readonly dayCols = computed<ColDef<ExpenseDay>[]>(() => {
    const web = !this.isCoarse && !this.isPhone;
    const b = this.book();
    const admin = this.can().isAdmin;
    // Phone card line: plain words (no pill / dot); the desktop Status column uses dayStatusWords.
    const status = (d?: ExpenseDay) => d ? `<span class="pf-xt-cell__sub">${d.isClosed ? 'Closed' : 'Open'}${d.isClosed && d.closedByName ? ` · by ${this.esc(d.closedByName)}` : ''}</span>` : '';
    const num = (v: number | null | undefined, neg = false) => `<span class="pf-xt-num${neg && (v ?? 0) < 0 ? ' pf-xt-amt--neg' : ''}">${this.esc(inr(v ?? 0))}</span>`;
    const actions: ColDef<ExpenseDay> = {
      colId: 'actions', headerName: '', sortable: false, resizable: false, pinned: 'right', lockPinned: true,
      width: web ? (admin ? 258 : 96) : (admin ? 150 : 60), minWidth: web ? (admin ? 258 : 96) : (admin ? 150 : 60), flex: 0, cellClass: 'pf-xt-actcell',
      cellRenderer: (p: { data?: ExpenseDay }) => {
        const d = p.data; if (!d) return '';
        const acts: string[] = [this.rowBtn('entries', 'Entries', '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>', 'Entries of ' + dayLabel(d.date), web)];
        if (admin && b) {
          const locked = !!b.closedThrough && d.date <= b.closedThrough;
          if (!locked) acts.push(this.rowBtn('opening', 'Opening', '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>', 'Set opening balance — ' + dayLabel(d.date), web));
          if (!d.isClosed && !locked && d.date <= b.today) acts.push(this.rowBtn('close', 'Day closing', '<path d="M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4"/>', 'Close ' + dayLabel(d.date), web));
          if (d.isClosed && d.date === b.closedThrough) acts.push(this.rowBtn('reopen', 'Day closing', '<path d="M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.9-1"/>', 'Reopen ' + dayLabel(d.date), web));
        }
        return `<span class="pf-xt-acts">${acts.join('')}</span>`;
      },
    };
    if (this.isPhone) {
      return [
        { colId: 'date', headerName: 'Day', flex: 1, minWidth: 140, valueGetter: p => p.data?.date ?? '',
          cellRenderer: (p: { data?: ExpenseDay }) => {
            const d = p.data; if (!d) return '';
            return `<div class="pf-xt-cell"><span>${this.esc(dayLabel(d.date))}</span>` +
              `<span class="pf-xt-cell__sub">Open ${this.esc(inr(d.opening))} · In ${this.esc(inr(d.cashIn))} · Out ${this.esc(inr(d.expenses))}</span>` +
              `<span>Close ${this.esc(inr(d.closing))}</span>${status(d)}</div>`;
          } },
        actions,
      ];
    }
    return [
      { colId: 'date', headerName: 'Day', width: 140, minWidth: 130, flex: 0, valueGetter: p => p.data?.date ?? '',
        cellRenderer: (p: { data?: ExpenseDay }) => this.cell(dayLabel(p.data?.date ?? ''), p.data ? plural(p.data.entryCount, 'entry', 'entries') : '') },
      { colId: 'opening', headerName: 'Opening', flex: 1, minWidth: 120, type: 'rightAligned', valueGetter: p => p.data?.opening ?? 0,
        cellRenderer: (p: { data?: ExpenseDay }) => `<div class="pf-xt-cell pf-xt-cell--end">${num(p.data?.opening)}${p.data?.openingSet ? '<span class="pf-xt-cell__sub">set by admin</span>' : ''}</div>` },
      { colId: 'cashIn', headerName: 'Cash in', flex: 1, minWidth: 110, type: 'rightAligned', valueGetter: p => p.data?.cashIn ?? 0,
        cellRenderer: (p: { data?: ExpenseDay }) => num(p.data?.cashIn) },
      { colId: 'expenses', headerName: 'Expenses', flex: 1, minWidth: 110, type: 'rightAligned', valueGetter: p => p.data?.expenses ?? 0,
        cellRenderer: (p: { data?: ExpenseDay }) => num(p.data?.expenses) },
      { colId: 'closing', headerName: 'Closing', flex: 1, minWidth: 120, type: 'rightAligned', valueGetter: p => p.data?.closing ?? 0,
        cellRenderer: (p: { data?: ExpenseDay }) => num(p.data?.closing, true) },
      statusWordsCol<ExpenseDay>({ colId: 'status', headerName: 'Status', width: 140, minWidth: 120, flex: 0, valueGetter: p => (p.data?.isClosed ? 'closed' : 'open') },
        dayStatusWords),
      actions,
    ];
  });

  constructor() {
    // Screen view state (owner 2026-11-21): tab, Day-closing day, search and every filter come back as left.
    inject(ViewStateService).bind('expenses', {
      tab: this.tabPick, closingDate: this.closingDate, q: this.q, quick: this.quick, from: this.from, to: this.to,
      kind: this.kind, categoryId: this.categoryId, mode: this.mode, view: this.view,
    });
    effect(() => {
      this.from(); this.to(); this.kind(); this.categoryId(); this.mode();
      if (this.tab() === 'closing') return;
      untracked(() => this.load());
    });
    this.loadCategories();
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.billsFor()) this.billsFor.set(null);
    else if (this.catsOpen()) this.catsOpen.set(false);
    else if (this.sheetOpen()) this.sheetOpen.set(false);
  }

  private mq(query: string): boolean {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    const m = window.matchMedia(query);
    const on = (ev: MediaQueryListEvent) => this.narrow?.set(ev.matches);
    try { m.addEventListener('change', on); this.destroyRef.onDestroy(() => m.removeEventListener('change', on)); } catch { /* old Safari */ }
    return m.matches;
  }

  dayShort(ymd: string) { return dayLabel(ymd, false); }

  setTab(t: ExpenseTab) {
    if (t === this.tab()) return;
    this.sheetOpen.set(false);
    if (t !== 'closing') this.book.set(null);   // never flash the other scope's rows
    this.tabPick.set(t);
  }

  /** Open Day closing on a given IST day (the day book's Close / Reopen). */
  openClosing(date: string) {
    this.closingDate.set(date);
    this.setTab('closing');
  }

  filter(): ExpenseFilter {
    return {
      from: this.from() ?? labDaysAgo(6), to: this.to() ?? labToday(),
      categoryId: this.categoryId() || null, kind: this.kind() || null, mode: this.mode() || null,
      mine: this.tab() === 'mine',
    };
  }

  load() {
    this.loading.set(true);
    this.svc.book(this.filter()).subscribe({
      next: b => { this.book.set(b); this.loading.set(false); },
      error: err => { this.loading.set(false); this.toasts.error(ApiError.from(err).message); },
    });
  }

  private loadCategories() {
    this.svc.categories().subscribe({ next: c => this.categories.set(c ?? []), error: () => this.categories.set([]) });
  }

  addCategory(c: ExpenseCategory) {
    this.categories.update(l => (l.some(x => x.id === c.id) ? l.map(x => (x.id === c.id ? c : x)) : [...l, c]));
  }

  setQuick(r: QuickRange) {
    this.quick.set(r);
    const t = labToday();
    if (r === 'today') { this.from.set(t); this.to.set(t); }
    else if (r === '7d') { this.from.set(labDaysAgo(6)); this.to.set(t); }
    else if (r === '30d') { this.from.set(labDaysAgo(29)); this.to.set(t); }
    else if (r === 'month') { this.from.set(monthStart(t)); this.to.set(t); }
  }
  setFrom(v: string | null) { if (v && v !== this.from()) { this.quick.set('custom'); this.from.set(v); } }
  setTo(v: string | null) { if (v && v !== this.to()) { this.quick.set('custom'); this.to.set(v); } }
  toggleCategory(id: string) { this.categoryId.set(this.categoryId() === id ? '' : id); }

  openAdd(kind: ExpenseKind = 'expense', date: string | null = null) {
    this.sheetOpen.set(false);
    this.dialog.set({ entry: null, kind, date });
  }

  /** "Snap bill" (phone bar): the camera first, then the form with the photo attached. */
  snapBill(ev: Event) {
    const el = ev.target as HTMLInputElement;
    const files = Array.from(el.files ?? []);
    el.value = '';
    if (!files.length) return;
    this.sheetOpen.set(false);
    this.dialog.set({ entry: null, kind: 'expense', date: null, files });
  }

  onEntryClicked(ev: CellClickedEvent<ExpenseEntry>) {
    const target = (ev.event?.target as HTMLElement | null)?.closest?.('[data-act]') as HTMLElement | null;
    const e = ev.data;
    if (!e) return;
    const act = target?.dataset['act'];
    if (act === 'bills') this.billsFor.set(e);
    else if (act === 'edit' || (!act && e.canEdit)) this.dialog.set({ entry: e, kind: e.kind, date: e.date });
    else if (!act && e.attachments.length) this.billsFor.set(e);
  }

  onDayClicked(ev: CellClickedEvent<ExpenseDay>) {
    const target = (ev.event?.target as HTMLElement | null)?.closest?.('[data-act]') as HTMLElement | null;
    const d = ev.data;
    if (!d || !target) return;
    const act = target.dataset['act'];
    if (act === 'entries') { this.quick.set('custom'); this.from.set(d.date); this.to.set(d.date); this.view.set('entries'); }
    else if (act === 'opening') void this.setOpening(d);
    // Closing / reopening a day is the cashier's Day closing (collections +
    // every staff member's expenses + counted cash) — one place to close.
    else if (act === 'close' || act === 'reopen') this.openClosing(d.date);
  }

  private async dayAction(d: ExpenseDay, run: () => Promise<unknown>, ok: string) {
    if (this.busyDays.has(d.date)) return;
    this.busyDays.add(d.date);
    try { await run(); this.toasts.success(ok); this.load(); }
    catch (err) { this.toasts.error(ApiError.from(err).message); }
    finally { this.busyDays.delete(d.date); }
  }

  async setOpening(d: ExpenseDay) {
    const v = await this.dialogs.prompt({
      title: `Opening balance · ${dayLabel(d.date)}`,
      message: 'The money in the expense account at the start of the day. Leave it empty to carry the previous day\'s closing forward.',
      inputType: 'number', initialValue: d.openingSet ? String(d.opening ?? '') : '', placeholder: '₹ 0.00', confirmLabel: 'Save opening', required: false,
    });
    if (v === null) return;
    const t = v.trim();
    const n = t === '' ? null : Number(t);
    if (n !== null && (!Number.isFinite(n) || Math.round(n * 100) / 100 !== n)) { this.toasts.error('Enter the amount in rupees (up to 2 decimals).'); return; }
    await this.dayAction(d, () => firstValueFrom(this.svc.setOpening(d.date, n)), n === null ? 'Opening carried forward' : 'Opening balance saved');
  }

  async createCategory() {
    const name = this.newCat().trim();
    if (!name || this.catBusy()) return;
    this.catBusy.set(true);
    try {
      const c = await firstValueFrom(this.svc.createCategory(name));
      this.addCategory(c);
      this.newCat.set('');
      this.toasts.success(`Category "${c.name}" added`);
    } catch (err) {
      this.toasts.error(ApiError.from(err).message);
    } finally {
      this.catBusy.set(false);
    }
  }

  async toggleCategoryActive(c: ExpenseCategory) {
    if (c.isActive) {
      const ok = await this.dialogs.confirm({
        title: `Switch off "${c.name}"?`, message: 'It stays on past entries but can\'t be picked for new ones.', confirmLabel: 'Switch off',
      });
      if (!ok) return;
    }
    try { this.addCategory(await firstValueFrom(this.svc.updateCategory(c.id, { isActive: !c.isActive }))); }
    catch (err) { this.toasts.error(ApiError.from(err).message); }
  }

  exportCsv() {
    if (this.exporting()) return;
    this.exporting.set(true);
    const f = this.filter();
    this.svc.exportCsv(f).subscribe({
      next: blob => {
        this.exporting.set(false);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `expenses-${f.from}_to_${f.to}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      },
      error: err => { this.exporting.set(false); this.toasts.error(ApiError.from(err).message); },
    });
  }
}
