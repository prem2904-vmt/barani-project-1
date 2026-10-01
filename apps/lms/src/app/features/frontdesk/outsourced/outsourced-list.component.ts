import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, OnInit, ViewChild, computed, inject, input, signal } from '@angular/core';
import { DialogService } from '../../../core/services/dialog.service';
import { OutsourcingService } from '../../../core/services/outsourcing.service';
import { UploadsService } from '../../../core/services/uploads.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { SkeletonRowsComponent } from '../../../shared/primitives/skeleton-kit.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import {
  ATTACH_DEFAULT, ATTACH_LABEL, OutsourcedStatusFilter, OutsourcedTube, PARTNER_REPORT_ACCEPT, STATUS_LABEL, actionLines,
  attachState, filterOutsourced, firstAttachProblem, partnerFileProblem, rowReport,
} from './outsourced-view';
import { DailyNoComponent } from '../../../shared/components/daily-no/daily-no.component';

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
  imports: [DatePipe, SegmentedComponent, SelectComponent, BusyDirective, SkeletonRowsComponent, DailyNoComponent],
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

    <input #file type="file" class="pf-out__file" [accept]="accept" (change)="onFile($event)" tabindex="-1" aria-hidden="true" />

    @if (svc.loading() && svc.rows().length === 0) {
      <pf-skeleton-rows [rows]="4" [avatar]="false" label="Loading outsourced tests…"></pf-skeleton-rows>
    } @else if (shown().length === 0) {
      <div class="nd-empty pf-out__none" data-empty="out">
        <span class="nd-empty__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9"/></svg></span>
        <p class="nd-empty__title">{{ svc.rows().length ? 'No outsourced tests match this search.' : 'No outsourced tests yet.' }}</p>
      </div>
    } @else {
      <ul class="pf-out__list" aria-label="Outsourced tests">
        @for (r of shown(); track r.sampleId) {
          <li class="nd-row pf-out__row" [attr.data-status]="r.status">
            <div class="pf-out__main">
              <p class="pf-out__sample nd-num">{{ r.barcode ?? '—' }}</p>
              <p class="pf-out__who"><pf-daily-no [of]="r" />{{ r.patientName }} · <span class="nd-num">{{ r.orderNumber ?? '' }}</span></p>
              <p class="pf-out__tests">{{ testNames(r) }}</p>
            </div>
            <div class="pf-out__meta">
              <span class="nd-chip nd-chip--static pf-out__partner">{{ r.partnerLabName ?? 'Partner lab' }}</span>
              <span class="pf-out__date">
                @if (r.dispatchedAt) { Dispatched <span class="nd-num">{{ r.dispatchedAt | date:'d MMM, HH:mm' }}</span> }
                @else { Not dispatched yet }
              </span>
              <span class="nd-chip nd-chip--static pf-out__status" [attr.data-status]="r.status">
                @if (r.status === 'completed') {
                  <svg class="pf-out__check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>
                }
                {{ statusLabel[r.status] }}
              </span>
              @if (attachLabel[attachState(r)]; as al) {
                <span class="nd-chip nd-chip--static pf-out__attach" [attr.data-attach]="attachState(r)"
                      [attr.title]="attachState(r) === 'problem' ? rowReport(r)?.attachProblem : null">{{ al }}</span>
              }
              @if (rowReport(r); as rep) {
                @if (uploads.isMissing(rep.url)) {
                  <!-- The server no longer has this file (it sat on a disk a
                       deploy wiped): say so, and point at Replace. -->
                  <span class="nd-chip nd-chip--static pf-out__attach" data-attach="problem" data-testid="out-file-missing"
                        role="status">File no longer available — upload it again</span>
                }
              }
            </div>
            <div class="pf-out__acts">
              @if (rowReport(r); as rep) {
                <button type="button" class="nd-rowact" [class.nd-rowact--icon]="!web()"
                        [attr.aria-label]="'View partner report for ' + (r.barcode ?? 'this tube')" (click)="view(rep.url)">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
                       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>
                  </svg>
                  <span class="nd-rowact__t">View</span>
                </button>
              }
              @if (rowReport(r)) {
                <button type="button" class="nd-rowact pf-out__attach-btn" [class.nd-rowact--icon]="!web()" [disabled]="busy() === r.sampleId"
                        [pfBusy]="busy() === r.sampleId && busyAct() === 'attach'" pfBusyLabel="Saving…"
                        [attr.aria-label]="(attachState(r) === 'separate' ? 'Attach partner report to our report for ' : 'Detach partner report from our report for ') + (r.barcode ?? 'this tube')"
                        (click)="toggleAttach(r)">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
                       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="m21.4 11.1-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8"/>
                  </svg>
                  <span class="nd-rowact__t">{{ attachState(r) === 'separate' ? 'Attach to report' : 'Detach from report' }}</span>
                </button>
              }
              @if (r.status === 'completed') {
                <button type="button" class="nd-rowact" [class.nd-rowact--icon]="!web()" [disabled]="busy() === r.sampleId"
                        [pfBusy]="busy() === r.sampleId && busyAct() === 'undo'" pfBusyLabel="Undoing…"
                        [attr.aria-label]="'Undo completed for ' + (r.barcode ?? 'this tube')" (click)="undo(r)">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
                       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>
                  </svg>
                  <span class="nd-rowact__t">Undo</span>
                </button>
              } @else if (r.hasReport) {
                <button type="button" class="nd-rowact" [class.nd-rowact--icon]="!web()" [disabled]="busy() === r.sampleId"
                        [pfBusy]="busy() === r.sampleId && busyAct() === 'complete'" pfBusyLabel="Completing…"
                        [attr.aria-label]="'Mark completed for ' + (r.barcode ?? 'this tube')" (click)="markCompleted(r)">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>
                  <span class="nd-rowact__t">Mark completed</span>
                </button>
              }
              <button type="button" class="nd-rowact" [class.nd-rowact--icon]="!web()" [disabled]="busy() === r.sampleId"
                      [pfBusy]="busy() === r.sampleId && busyAct() === 'upload'" pfBusyLabel="Uploading…"
                      [attr.aria-label]="(r.hasReport ? 'Replace partner report for ' : 'Upload partner report for ') + (r.barcode ?? 'this tube')"
                      (click)="pick(r)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 20h16"/>
                </svg>
                <span class="nd-rowact__t">{{ busy() === r.sampleId ? 'Uploading…' : (r.hasReport ? 'Replace report' : 'Upload report') }}</span>
              </button>
            </div>
          </li>
        }
      </ul>
      @if (svc.hasMore()) {
      <!-- Server paging (release 2026-10-01): the next page, appended — same
           pattern as the report queue (report-queue.component.html). -->
      <div class="pf-out__more">
        <button type="button" class="nd-btn nd-btn--secondary pf-out__more-btn press"
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
    .pf-out__file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
    .pf-out__empty { margin: 0; padding: 24px 12px; text-align: center; font-size: 13px; color: var(--text-muted); }
    .pf-out__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .pf-out__row { flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 10px 12px; }
    .pf-out__main { flex: 1 1 220px; min-width: 0; }
    .pf-out__main p { margin: 0; }
    .pf-out__sample { font-size: 16.5px; font-weight: 600; color: var(--text-primary); }
    .pf-out__who { font-size: 13px; font-weight: 500; color: var(--text-secondary); }
    .pf-out__tests { font-size: 12px; color: var(--text-muted); }
    .pf-out__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
    .pf-out__partner, .pf-out__status, .pf-out__attach { height: 26px; }
    .pf-out__attach[data-attach='problem'] { color: var(--warning-text, #b45309); }
    .pf-out__date { font-size: 12px; color: var(--text-muted); white-space: nowrap; }
    .pf-out__check { color: var(--violet-text, #6d28d9); }
    .pf-out__row[data-status='completed'] { background: var(--nd-done-tint); border-color: var(--nd-sel-border); }
    .pf-out__acts { display: flex; align-items: center; gap: 6px; margin-left: auto; }
    @media (max-width: 640px) {
      .pf-out__acts { margin-left: 0; width: 100%; justify-content: flex-end; }
    }
    .pf-out__more { display: flex; justify-content: center; padding: 12px 0 2px; }
  `],
})
export class OutsourcedListComponent implements OnInit {
  readonly svc = inject(OutsourcingService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);

  /** Classic design renders the status / partner filters here; the new design has none. */
  readonly showFilters = input(false);

  /** Rows on screen: classic = the service's filtered set; new design = every
   *  status (search only), open tubes before completed ones. */
  readonly shown = computed(() => {
    if (this.showFilters()) return this.svc.visible();
    const rows = filterOutsourced(this.svc.rows(), { query: this.svc.query(), status: 'all', partnerId: null });
    return [...rows.filter(r => r.status !== 'completed'), ...rows.filter(r => r.status === 'completed')];
  });

  readonly web = webPointerSignal();
  readonly busy = signal<string | null>(null);
  /** Which row action holds `busy` (only that button shows the dots). */
  readonly busyAct = signal<'upload' | 'complete' | 'undo' | 'attach'>('upload');
  readonly statusLabel = STATUS_LABEL;
  readonly attachLabel = ATTACH_LABEL;
  readonly attachState = attachState;
  readonly accept = PARTNER_REPORT_ACCEPT;
  readonly rowReport = rowReport;

  @ViewChild('file') private fileInput?: ElementRef<HTMLInputElement>;
  private target: OutsourcedTube | null = null;

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
    void this.svc.load();
  }

  /** The next page, appended (the service itself no-ops mid-fetch / once
   *  every row for the current filter is loaded). */
  loadMore(): void { void this.svc.loadMore(); }

  setStatus(v: string) { this.svc.status.set(v as OutsourcedStatusFilter); }

  testNames(r: OutsourcedTube): string { return r.tests.map(t => t.testName).join(', '); }

  protected readonly uploads = inject(UploadsService);
  /** Partner files are private uploads — opened through a signed URL. */
  /** Open the partner file; one the server no longer has (410) toasts
   *  "upload it again" and flags the row (see isMissing in the template). */
  view(url: string) { void this.uploads.open(url); }

  pick(r: OutsourcedTube) {
    this.target = r;
    const el = this.fileInput?.nativeElement;
    if (el) { el.value = ''; el.click(); }
  }

  async onFile(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const r = this.target;
    this.target = null;
    if (!file || !r) return;
    const problem = partnerFileProblem(file);
    if (problem) { this.toasts.error(problem); return; }
    const attach = await this.askAttach(r, file);
    if (attach === null) return;
    await this.uploadAndComplete(r, file, attach);
  }

  /** The upload step's one question: join the partner report to ours (one
   *  PDF for the patient — default ON) or keep it a separate file. Null =
   *  cancelled. */
  async askAttach(r: OutsourcedTube, file: File): Promise<boolean | null> {
    const res = await this.dialog.actions({
      title: r.hasReport ? 'Replace partner report' : 'Upload partner report',
      message: `${file.name} — ${this.testNames(r)}${r.partnerLabName ? ` (${r.partnerLabName})` : ''}.`,
      checkbox: { label: 'Attach to our report — the patient gets one PDF (our report, then these pages)', initial: ATTACH_DEFAULT },
      actions: [{ value: 'upload', label: r.hasReport ? 'Replace & complete' : 'Upload & complete', variant: 'primary' }],
    });
    return res.action === 'upload' ? res.checked : null;
  }

  /** Upload the partner report and mark the tube's outsourced tests Completed. */
  async uploadAndComplete(r: OutsourcedTube, file: File, attachToReport = ATTACH_DEFAULT) {
    const problem = partnerFileProblem(file);
    if (problem) { this.toasts.error(problem); return; }
    this.busyAct.set('upload');
    this.busy.set(r.sampleId);
    try {
      const url = await this.svc.upload(file);
      const updated = await this.svc.complete(actionLines(r), { url, name: file.name, type: file.type }, attachToReport);
      this.toasts.success(`${r.hasReport ? 'Report replaced' : 'Report uploaded'} — ${this.testNames(r)} completed`);
      await this.warnIfNotJoinable(updated);
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.busy.set(null);
    }
  }

  async markCompleted(r: OutsourcedTube) {
    this.busyAct.set('complete');
    this.busy.set(r.sampleId);
    try {
      await this.svc.complete(actionLines(r), null);
      this.toasts.success(`${this.testNames(r)} completed`);
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.busy.set(null);
    }
  }

  /** Attach to / detach from our report, later. */
  async toggleAttach(r: OutsourcedTube) {
    const attach = attachState(r) === 'separate';
    this.busyAct.set('attach');
    this.busy.set(r.sampleId);
    try {
      const updated = await this.svc.setAttachToReport(r.tests.filter(t => t.report).map(t => t.orderTestId), attach);
      if (attach && firstAttachProblem(updated)) await this.warnIfNotJoinable(updated);
      else this.toasts.success(attach
        ? 'Attached — the patient gets one PDF with the partner report'
        : 'Detached — the partner report is sent as a separate file');
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.busy.set(null);
    }
  }

  /** A partner file that can't be joined (password-protected / unreadable):
   *  say so — it goes to the patient as a separate file instead. */
  private async warnIfNotJoinable(updated: OutsourcedTube[] | null | undefined) {
    const problem = firstAttachProblem(updated);
    if (!problem) return;
    await this.dialog.actions({
      title: 'Partner report kept as a separate file',
      message: problem,
      actions: [],
      cancelLabel: 'OK',
    });
  }

  async undo(r: OutsourcedTube) {
    const ok = await this.dialog.confirm({
      title: 'Undo Completed?',
      message: `${this.testNames(r)} goes back to Outsourced. The uploaded report stays attached; a report already released is not changed.`,
      confirmLabel: 'Undo completed',
      tone: 'danger',
    });
    if (!ok) return;
    this.busyAct.set('undo');
    this.busy.set(r.sampleId);
    try {
      await this.svc.reopen(r.tests.map(t => t.orderTestId));
      this.toasts.success('Moved back to Outsourced');
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.busy.set(null);
    }
  }
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
