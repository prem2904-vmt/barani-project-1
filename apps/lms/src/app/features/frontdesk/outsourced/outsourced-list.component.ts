import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input } from '@angular/core';
import { OutsourcingService } from '../../../core/services/outsourcing.service';
import { UploadsService } from '../../../core/services/uploads.service';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { SkeletonRowsComponent } from '../../../shared/primitives/skeleton-kit.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import {
  ATTACH_LABEL, OutsourcedStatusFilter, OutsourcedTube, STATUS_LABEL, attachState, filterOutsourced, rowReport,
} from './outsourced-view';
import { sortByDailySerial } from '../frontdesk-landing/work-merge';
import { DailyNoComponent } from '../../../shared/components/daily-no/daily-no.component';
import { OutsourcedActionsComponent } from './outsourced-actions.component';
import { WorkListComponent } from '../../../shared/components/work-list/work-list.component';
import { WorkListItem } from '../../../shared/components/work-list/work-list';

/**
 * Frontdesk "Outsourced" tab body. One row per outsourced tube: sample ID,
 * patient (full name), order ID, tests, partner lab, dispatched date and a
 * neutral status chip (Completed carries a violet check — never green).
 * Row actions (text on web, icon on touch): Upload report · View · Undo ·
 * Attach to / Detach from report. At upload the desk chooses "Attach to our
 * report" (default ON): the patient then gets ONE PDF — our report followed
 * by the partner pages. A file that can't be joined (password-protected /
 * unreadable) is flagged with a warning dialog and stays a separate file.
 * The search lives in the work card's header (it sets `svc.query`). Classic
 * design (`showFilters`) keeps the status / partner filters above the list;
 * the new design has NO filter bar (owner) — every tube is listed, still
 * outsourced first, and the status chip on each row carries the distinction.
 */
@Component({
  selector: 'pf-outsourced-list',
  standalone: true,
  imports: [DatePipe, WorkListComponent, SegmentedComponent, SelectComponent, SkeletonRowsComponent, DailyNoComponent, OutsourcedActionsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (showFilters()) {
      <div class="pf-out__filters">
        <pf-segmented [options]="statusOptions()" [value]="svc.status()" size="sm"
                      (valueChange)="setStatus($event)"></pf-segmented>
        <pf-select size="sm" [options]="partnerSelectOptions()" [value]="svc.partnerId() ?? ''"
                   placeholder="All partner labs" (valueChange)="svc.partnerId.set($event || null)"></pf-select>
      </div>
    }

    @if (svc.loading() && svc.rows().length === 0) {
      <pf-skeleton-rows [rows]="4" [avatar]="false" label="Loading outsourced tests…"></pf-skeleton-rows>
    } @else if (shown().length === 0) {
      <div class="pf-empty pf-out__none" data-empty="out">
        <span class="pf-empty__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9"/></svg></span>
        <p class="pf-empty__title">{{ svc.rows().length ? 'No outsourced tests match this search.' : 'No outsourced tests yet.' }}</p>
      </div>
    } @else if (!showFilters()) {
      <!-- New design: the ONE shared work list (owner 2026-11-21) — divider rows, status in words, the upload /
           view control at the right edge. No pills inside rows. -->
      <pf-work-list data-testid="out-list" label="Outsourced tests" [items]="items()" [actionTpl]="outActs" />
      <ng-template #outActs let-it><pf-outsourced-actions [tube]="it.data" /></ng-template>
      @if (svc.hasMore()) {
      <div class="pf-out__more">
        <button type="button" class="pf-btn pf-btn--secondary pf-out__more-btn press"
                [disabled]="svc.loadingMore()" [attr.aria-busy]="svc.loadingMore()" (click)="loadMore()">
          @if (svc.loadingMore()) { Loading… } @else { Load {{ svc.nextCount() }} more }
        </button>
      </div>
      }
    } @else {
      <ul class="pf-out__list" aria-label="Outsourced tests">
        @for (r of shown(); track r.sampleId) {
          <li class="pf-row pf-out__row" [attr.data-status]="r.status">
            <div class="pf-out__main">
              <p class="pf-out__sample pf-num">{{ r.barcode ?? '—' }}</p>
              <p class="pf-out__who"><pf-daily-no [of]="r" />{{ r.patientName }} · <span class="pf-num">{{ r.orderNumber ?? '' }}</span></p>
              <p class="pf-out__tests">{{ testNames(r) }}</p>
            </div>
            <!-- Chips + the upload button share ONE line (owner 2026-11-20): the button sits at the
                 right end of the chip row, never alone on a row of its own. -->
            <div class="pf-out__line">
            <div class="pf-out__meta">
              <span class="pf-chip pf-chip--static pf-out__partner">{{ r.partnerLabName ?? 'Partner lab' }}</span>
              <span class="pf-out__date">
                @if (r.dispatchedAt) { Dispatched <span class="pf-num">{{ r.dispatchedAt | date:'d MMM, HH:mm' }}</span> }
                @else { Not dispatched yet }
              </span>
              <span class="pf-chip pf-chip--static pf-out__status" [attr.data-status]="r.status">
                @if (r.status === 'completed') {
                  <svg class="pf-out__check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>
                }
                {{ statusLabel[r.status] }}
              </span>
              @if (attachLabel[attachState(r)]; as al) {
                <span class="pf-chip pf-chip--static pf-out__attach" [attr.data-attach]="attachState(r)"
                      [attr.title]="attachState(r) === 'problem' ? rowReport(r)?.attachProblem : null">{{ al }}</span>
              }
              @if (rowReport(r); as rep) {
                @if (uploads.isMissing(rep.url)) {
                  <!-- The server no longer has this file (it sat on a disk a
                       deploy wiped): say so, and point at Replace. -->
                  <span class="pf-chip pf-chip--static pf-out__attach" data-attach="problem" data-testid="out-file-missing"
                        role="status">File no longer available — upload it again</span>
                }
              }
            </div>
            <div class="pf-out__acts">
              <pf-outsourced-actions [tube]="r" />
            </div>
            </div>
          </li>
        }
      </ul>
      @if (svc.hasMore()) {
      <!-- Server paging (release 2026-10-01): the next page, appended — same
           pattern as the report queue (report-queue.component.html). -->
      <div class="pf-out__more">
        <button type="button" class="pf-btn pf-btn--secondary pf-out__more-btn press"
                [disabled]="svc.loadingMore()" [attr.aria-busy]="svc.loadingMore()" (click)="loadMore()">
          @if (svc.loadingMore()) { Loading… } @else { Load {{ svc.nextCount() }} more }
        </button>
      </div>
      }
    }
  `,
  styles: [`
    /* Flex column so the empty state can centre in the pane like its siblings. */
    :host { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
    .pf-out__none { min-height: 200px; }
    .pf-out__filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 12px; }
    .pf-out__empty { margin: 0; padding: 24px 12px; text-align: center; font-size: 13px; color: var(--text-muted); }
    .pf-out__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .pf-out__row { flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 10px 12px; }
    .pf-out__main { flex: 1 1 220px; min-width: 0; }
    .pf-out__main p { margin: 0; }
    .pf-out__sample { font-size: 16.5px; font-weight: 600; color: var(--text-primary); }
    .pf-out__who { font-size: 13px; font-weight: 500; color: var(--text-secondary); }
    .pf-out__tests { font-size: 12px; color: var(--text-muted); }
    .pf-out__line { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px 12px; }
    .pf-out__meta { flex: 1 1 auto; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
    .pf-out__partner, .pf-out__status, .pf-out__attach { height: 26px; }
    .pf-out__attach[data-attach='problem'] { color: var(--warning-text, #b45309); }
    .pf-out__date { font-size: 12px; color: var(--text-muted); white-space: nowrap; }
    .pf-out__check { color: var(--violet-text, #6d28d9); }
    .pf-out__row[data-status='completed'] { background: var(--pf-done-tint); border-color: var(--pf-sel-border); }
    .pf-out__acts { flex: none; display: flex; align-items: center; gap: 6px; margin-left: auto; }
    .pf-out__more { display: flex; justify-content: center; padding: 12px 0 2px; }
  `],
})
export class OutsourcedListComponent implements OnInit {
  readonly svc = inject(OutsourcingService);

  /** Classic design renders the status / partner filters here; the new design has none. */
  readonly showFilters = input(false);

  /** Rows on screen: classic = the service's filtered set; new design = every
   *  status (search only), open tubes before completed ones, and WITHIN each
   *  of those two groups the same business-day → #N ledger order as every
   *  other tab of the frontdesk list (owner, 2026-10-02 —
   *  `sortByDailySerial`, work-merge.ts). */
  readonly shown = computed(() => {
    if (this.showFilters()) return this.svc.visible();
    const rows = filterOutsourced(this.svc.rows(), { query: this.svc.query(), status: 'all', partnerId: null });
    const open = sortByDailySerial(rows.filter(r => r.status !== 'completed'));
    const completed = sortByDailySerial(rows.filter(r => r.status === 'completed'));
    return [...open, ...completed];
  });

  /** The rows as shared work-list items: sample ID · patient (token) · order · tests · partner, status in words. */
  readonly items = computed<WorkListItem<OutsourcedTube>[]>(() => this.shown().map(r => {
    const rep = rowReport(r);
    const att = ATTACH_LABEL[attachState(r)];
    const missing = rep ? this.uploads.isMissing(rep.url) : false;
    const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    return {
      id: r.sampleId, key: missing ? 'file-missing' : r.status, name: r.patientName, daily: r, lead: r.barcode ?? null,
      facts: [r.orderNumber ?? null, this.testNames(r), r.partnerLabName ?? 'Partner lab', att || null],
      notes: [attachState(r) === 'problem' ? rep?.attachProblem ?? null : null, missing ? 'File no longer available — upload it again' : null].filter((n): n is string => !!n),
      status: r.status === 'completed' ? { now: 'Completed', detail: 'partner report attached', tone: 'done' }
        : r.dispatchedAt ? { now: 'Outsourced', detail: 'waiting for the partner report', tone: 'normal' }
        : { now: 'Not dispatched yet', tone: 'late' },
      time: r.dispatchedAt ? { text: when(r.dispatchedAt), title: 'Dispatched' } : null,
      aria: `${r.barcode ?? ''} ${r.patientName}`.trim(), data: r,
    };
  }));

  readonly web = webPointerSignal();
  readonly statusLabel = STATUS_LABEL;
  readonly attachLabel = ATTACH_LABEL;
  readonly attachState = attachState;
  readonly rowReport = rowReport;

  readonly statusOptions = () => outsourcedStatusOptions(this.svc.counts());
  readonly partnerSelectOptions = () => outsourcedPartnerOptions(this.svc.partners());

  ngOnInit(): void {
    // Server paging (release 2026-10-01) now fetches by STATUS (cheaper —
    // the lean scan narrows before the rich fetch). The new design has no
    // status control and must still show every status (open tubes first,
    // then completed — see `shown` above): pin the fetch to "all" so
    // Completed tubes aren't silently left unloaded. Classic design keeps
    // whatever `svc.status` already is (its segmented control's own value).
    if (!this.showFilters()) this.svc.status.set('all');
    // ensureLoaded (not load): the frontdesk merged list already fully loads
    // status='all' for the window on its own (FrontdeskLandingComponent) —
    // visiting this tab right after must not re-fetch page 1 of data we
    // already have. A genuinely different filter (classic design narrowed
    // to 'completed', say) still fetches, same as before.
    void this.svc.ensureLoaded();
  }

  /** The next page, appended (the service itself no-ops mid-fetch / once
   *  every row for the current filter is loaded). */
  loadMore(): void { void this.svc.loadMore(); }

  setStatus(v: string) { this.svc.status.set(v as OutsourcedStatusFilter); }

  testNames(r: OutsourcedTube): string { return r.tests.map(t => t.testName).join(', '); }

  protected readonly uploads = inject(UploadsService);
}

/** Status segmented options with counts (shared by the band pill). */
export function outsourcedStatusOptions(c: { outsourced: number; completed: number }): SegmentedOption<string>[] {
  return [
    { value: 'outsourced', label: 'Outsourced', count: c.outsourced },
    { value: 'completed', label: 'Completed', count: c.completed },
    { value: 'all', label: 'All', count: c.outsourced + c.completed },
  ];
}

/** Partner-lab select options with the "all" entry first. */
export function outsourcedPartnerOptions(p: { value: string; label: string }[]): PfSelectOption<string>[] {
  return [{ value: '', label: 'All partner labs' }, ...p];
}
