import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, OnInit, ViewChild, inject, input, signal } from '@angular/core';
import { DialogService } from '../../../core/services/dialog.service';
import { OutsourcingService } from '../../../core/services/outsourcing.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import {
  OutsourcedStatusFilter, OutsourcedTube, PARTNER_REPORT_ACCEPT, STATUS_LABEL, absoluteFileUrl, actionLines,
  partnerFileProblem, rowReport,
} from './outsourced-view';

/**
 * Frontdesk "Outsourced" tab body. One row per outsourced tube: sample ID,
 * patient (full name), order ID, tests, partner lab, dispatched date and a
 * neutral status chip (Completed carries a violet check — never green).
 * Row actions (text on web, icon on touch): Upload report · View · Undo.
 * When `showFilters` is on (classic design — the new design puts them in the
 * band's pill) the status / partner / search controls render above the list.
 */
@Component({
  selector: 'pf-outsourced-list',
  standalone: true,
  imports: [DatePipe, SegmentedComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-out__filters">
      @if (showFilters()) {
        <pf-segmented [options]="statusOptions()" [value]="svc.status()" size="sm"
                      (valueChange)="setStatus($event)"></pf-segmented>
        <pf-select size="sm" [options]="partnerSelectOptions()" [value]="svc.partnerId() ?? ''"
                   placeholder="All partner labs" (valueChange)="svc.partnerId.set($event || null)"></pf-select>
      }
      <input class="nd-input pf-out__q" type="search" [value]="svc.query()"
             (input)="svc.query.set($any($event.target).value)"
             placeholder="Search patient, order, sample, test" aria-label="Search outsourced tests" />
    </div>

    <input #file type="file" class="pf-out__file" [accept]="accept" (change)="onFile($event)" tabindex="-1" aria-hidden="true" />

    @if (svc.loading() && svc.rows().length === 0) {
      <p class="pf-out__empty">Loading outsourced tests…</p>
    } @else if (svc.visible().length === 0) {
      <p class="pf-out__empty">{{ svc.rows().length ? 'No outsourced tests match these filters.' : 'No outsourced tests yet.' }}</p>
    } @else {
      <ul class="pf-out__list" aria-label="Outsourced tests">
        @for (r of svc.visible(); track r.sampleId) {
          <li class="nd-row pf-out__row" [attr.data-status]="r.status">
            <div class="pf-out__main">
              <p class="pf-out__sample nd-num">{{ r.barcode ?? '—' }}</p>
              <p class="pf-out__who">{{ r.patientName }} · <span class="nd-num">{{ r.orderNumber ?? '' }}</span></p>
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
              @if (r.status === 'completed') {
                <button type="button" class="nd-rowact" [class.nd-rowact--icon]="!web()" [disabled]="busy() === r.sampleId"
                        [attr.aria-label]="'Undo completed for ' + (r.barcode ?? 'this tube')" (click)="undo(r)">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
                       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>
                  </svg>
                  <span class="nd-rowact__t">Undo</span>
                </button>
              } @else if (r.hasReport) {
                <button type="button" class="nd-rowact" [class.nd-rowact--icon]="!web()" [disabled]="busy() === r.sampleId"
                        [attr.aria-label]="'Mark completed for ' + (r.barcode ?? 'this tube')" (click)="markCompleted(r)">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>
                  <span class="nd-rowact__t">Mark completed</span>
                </button>
              }
              <button type="button" class="nd-rowact" [class.nd-rowact--icon]="!web()" [disabled]="busy() === r.sampleId"
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
    }
  `,
  styles: [`
    :host { display: block; }
    .pf-out__filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 12px; }
    .pf-out__q { flex: 1 1 200px; min-width: 0; max-width: 320px; min-height: 36px; }
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
    .pf-out__partner, .pf-out__status { height: 26px; }
    .pf-out__date { font-size: 12px; color: var(--text-muted); white-space: nowrap; }
    .pf-out__check { color: var(--violet-text, #6d28d9); }
    .pf-out__row[data-status='completed'] { background: var(--nd-done-tint); border-color: var(--nd-sel-border); }
    .pf-out__acts { display: flex; align-items: center; gap: 6px; margin-left: auto; }
    @media (max-width: 640px) {
      .pf-out__acts { margin-left: 0; width: 100%; justify-content: flex-end; }
      .pf-out__q { max-width: none; font-size: 16px; }
    }
  `],
})
export class OutsourcedListComponent implements OnInit {
  readonly svc = inject(OutsourcingService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);

  /** Classic design renders the filters here; the new design puts them in the band pill. */
  readonly showFilters = input(false);

  readonly web = webPointerSignal();
  readonly busy = signal<string | null>(null);
  readonly statusLabel = STATUS_LABEL;
  readonly accept = PARTNER_REPORT_ACCEPT;
  readonly rowReport = rowReport;

  @ViewChild('file') private fileInput?: ElementRef<HTMLInputElement>;
  private target: OutsourcedTube | null = null;

  readonly statusOptions = () => outsourcedStatusOptions(this.svc.counts());
  readonly partnerSelectOptions = () => outsourcedPartnerOptions(this.svc.partners());

  ngOnInit(): void { void this.svc.load(); }

  setStatus(v: string) { this.svc.status.set(v as OutsourcedStatusFilter); }

  testNames(r: OutsourcedTube): string { return r.tests.map(t => t.testName).join(', '); }

  view(url: string) { window.open(absoluteFileUrl(url, this.svc.apiBase), '_blank', 'noopener'); }

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
    await this.uploadAndComplete(r, file);
  }

  /** Upload the partner report and mark the tube's outsourced tests Completed. */
  async uploadAndComplete(r: OutsourcedTube, file: File) {
    const problem = partnerFileProblem(file);
    if (problem) { this.toasts.error(problem); return; }
    this.busy.set(r.sampleId);
    try {
      const url = await this.svc.upload(file);
      await this.svc.complete(actionLines(r), { url, name: file.name, type: file.type });
      this.toasts.success(`${r.hasReport ? 'Report replaced' : 'Report uploaded'} — ${this.testNames(r)} completed`);
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.busy.set(null);
    }
  }

  async markCompleted(r: OutsourcedTube) {
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

  async undo(r: OutsourcedTube) {
    const ok = await this.dialog.confirm({
      title: 'Undo Completed?',
      message: `${this.testNames(r)} goes back to Outsourced. The uploaded report stays attached; a report already released is not changed.`,
      confirmLabel: 'Undo completed',
      tone: 'danger',
    });
    if (!ok) return;
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
