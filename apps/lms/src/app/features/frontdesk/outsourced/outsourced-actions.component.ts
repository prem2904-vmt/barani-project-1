import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, computed, inject, input, signal } from '@angular/core';
import { DialogService } from '../../../core/services/dialog.service';
import { OutsourcingService } from '../../../core/services/outsourcing.service';
import { UploadsService } from '../../../core/services/uploads.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { ActionsMenuComponent, PfAction } from '../../../shared/components/actions-menu/actions-menu.component';
import {
  ATTACH_DEFAULT, OutsourcedTube, PARTNER_REPORT_ACCEPT, actionLines, attachState, firstAttachProblem,
  partnerFileProblem, rowReport,
} from './outsourced-view';

/**
 * ONE outsourced tube's row actions — Upload / Replace report, View, Attach
 * to / Detach from our report, Mark completed, Undo. ONE home (owner,
 * 2026-10-01): used by OutsourcedListComponent's own rows AND the frontdesk
 * merged work list's "also outsourced" rows, so the upload/attach flow is
 * never duplicated. All state (the tube itself) lives in OutsourcingService,
 * a root singleton — every consumer reading `svc.rows()` / `svc.visible()`
 * re-renders the moment an action completes, so this component takes no
 * outputs; it only needs the tube to act on.
 */
@Component({
  selector: 'pf-outsourced-actions',
  standalone: true,
  imports: [BusyDirective, ActionsMenuComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <input #file type="file" class="pf-out-acts__file" [accept]="accept" (change)="onFile($event)" tabindex="-1" aria-hidden="true" />
    @if (compact()) {
      <!-- Phone list (owner 2026-11-21): ONE primary + ⋯ so the patient name keeps the row's width. -->
      <div class="pf-out-acts pf-out-acts--compact">
        @switch (primaryAct()) {
          @case ('view') {
            <button type="button" class="pf-rowact pf-out-acts__primary" data-testid="out-act-primary"
                    [attr.aria-label]="'View partner report for ' + (tube().barcode ?? 'this tube')" (click)="run('view')">View</button>
          }
          @case ('complete') {
            <button type="button" class="pf-rowact pf-out-acts__primary" data-testid="out-act-primary" [disabled]="busy()"
                    [pfBusy]="busy() && busyAct() === 'complete'" pfBusyLabel="Completing…"
                    [attr.aria-label]="'Mark completed for ' + (tube().barcode ?? 'this tube')" (click)="run('complete')">Complete</button>
          }
          @default {
            <button type="button" class="pf-rowact pf-out-acts__primary" data-testid="out-act-primary" [disabled]="busy()"
                    [pfBusy]="busy() && busyAct() === 'upload'" pfBusyLabel="Uploading…"
                    [attr.aria-label]="'Upload partner report for ' + (tube().barcode ?? 'this tube')" (click)="run('upload')">Upload</button>
          }
        }
        @if (moreActs().length) {
          <pf-actions-menu [actions]="moreActs()" triggerClass="pf-rowact pf-rowact--icon pf-out-acts__more"
                           [label]="'More for ' + (tube().barcode ?? 'this tube')" [heading]="tube().barcode ?? ''" (action)="run($event)" />
        }
      </div>
    } @else {
    <div class="pf-out-acts">
      @if (rowReport(tube()); as rep) {
        <button type="button" class="pf-rowact" [class.pf-rowact--icon]="!web()"
                [attr.aria-label]="'View partner report for ' + (tube().barcode ?? 'this tube')" (click)="view(rep.url)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>
          </svg>
          <span class="pf-rowact__t">View</span>
        </button>
      }
      @if (rowReport(tube())) {
        <button type="button" class="pf-rowact pf-out-acts__attach-btn" [class.pf-rowact--icon]="!web()" [disabled]="busy()"
                [pfBusy]="busy() && busyAct() === 'attach'" pfBusyLabel="Saving…"
                [attr.aria-label]="(attachState(tube()) === 'separate' ? 'Attach partner report to our report for ' : 'Detach partner report from our report for ') + (tube().barcode ?? 'this tube')"
                (click)="toggleAttach()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m21.4 11.1-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8"/>
          </svg>
          <span class="pf-rowact__t">{{ attachState(tube()) === 'separate' ? 'Attach to report' : 'Detach from report' }}</span>
        </button>
      }
      @if (tube().status === 'completed') {
        <button type="button" class="pf-rowact" [class.pf-rowact--icon]="!web()" [disabled]="busy()"
                [pfBusy]="busy() && busyAct() === 'undo'" pfBusyLabel="Undoing…"
                [attr.aria-label]="'Undo completed for ' + (tube().barcode ?? 'this tube')" (click)="undo()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>
          </svg>
          <span class="pf-rowact__t">Undo</span>
        </button>
      } @else if (tube().hasReport) {
        <button type="button" class="pf-rowact" [class.pf-rowact--icon]="!web()" [disabled]="busy()"
                [pfBusy]="busy() && busyAct() === 'complete'" pfBusyLabel="Completing…"
                [attr.aria-label]="'Mark completed for ' + (tube().barcode ?? 'this tube')" (click)="markCompleted()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>
          <span class="pf-rowact__t">Mark completed</span>
        </button>
      }
      <button type="button" class="pf-rowact" [class.pf-rowact--icon]="!web()" [disabled]="busy()"
              [pfBusy]="busy() && busyAct() === 'upload'" pfBusyLabel="Uploading…"
              [attr.aria-label]="(tube().hasReport ? 'Replace partner report for ' : 'Upload partner report for ') + (tube().barcode ?? 'this tube')"
              (click)="pick()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 20h16"/>
        </svg>
        <span class="pf-rowact__t">{{ busy() ? 'Uploading…' : (tube().hasReport ? 'Replace report' : 'Upload report') }}</span>
      </button>
    </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    .pf-out-acts__file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
    .pf-out-acts { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 6px; }
    .pf-out-acts--compact { flex: none; }
    .pf-out-acts__primary { height: 44px; min-height: 44px; padding: 0 14px; font-size: 13px; white-space: nowrap; color: var(--violet-text, var(--text-primary)); }
    :host ::ng-deep .pf-out-acts__more { width: 44px; height: 44px; min-height: 44px; }
  `],
})
export class OutsourcedActionsComponent {
  readonly tube = input.required<OutsourcedTube>();
  /** Phone list: ONE primary + ⋯ (the rest of the same actions) instead of the full button row. */
  readonly compact = input(false);

  private readonly svc = inject(OutsourcingService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);
  protected readonly uploads = inject(UploadsService);

  readonly web = webPointerSignal();
  readonly busy = signal(false);
  /** Which action holds `busy` (only that button shows the dots). */
  readonly busyAct = signal<'upload' | 'complete' | 'undo' | 'attach'>('upload');
  readonly accept = PARTNER_REPORT_ACCEPT;
  readonly rowReport = rowReport;
  readonly attachState = attachState;

  @ViewChild('file') private fileInput?: ElementRef<HTMLInputElement>;

  /** Compact: the row's ONE primary — the next step for the tube (pure: `outsourcedCompactActs`). */
  readonly primaryAct = computed(() => outsourcedCompactActs(this.tube()).primary);
  readonly moreActs = computed<PfAction[]>(() => outsourcedCompactActs(this.tube()).more);
  /** One entry point for the compact primary and the ⋯ menu (the same handlers as the full row). */
  run(id: string): void {
    const rep = rowReport(this.tube());
    switch (id) {
      case 'view': if (rep) this.view(rep.url); break;
      case 'attach': void this.toggleAttach(); break;
      case 'complete': void this.markCompleted(); break;
      case 'undo': void this.undo(); break;
      case 'upload': this.pick(); break;
    }
  }

  private testNames(): string { return this.tube().tests.map(t => t.testName).join(', '); }

  /** Partner files are private uploads — opened through a signed URL. */
  view(url: string) { void this.uploads.open(url); }

  pick() {
    const el = this.fileInput?.nativeElement;
    if (el) { el.value = ''; el.click(); }
  }

  async onFile(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const problem = partnerFileProblem(file);
    if (problem) { this.toasts.error(problem); return; }
    const attach = await this.askAttach(file);
    if (attach === null) return;
    await this.uploadAndComplete(file, attach);
  }

  /** The upload step's one question: join the partner report to ours (one
   *  PDF for the patient — default ON) or keep it a separate file. Null =
   *  cancelled. */
  private async askAttach(file: File): Promise<boolean | null> {
    const r = this.tube();
    const res = await this.dialog.actions({
      title: r.hasReport ? 'Replace partner report' : 'Upload partner report',
      message: `${file.name} — ${this.testNames()}${r.partnerLabName ? ` (${r.partnerLabName})` : ''}.`,
      checkbox: { label: 'Attach to our report — the patient gets one PDF (our report, then these pages)', initial: ATTACH_DEFAULT },
      actions: [{ value: 'upload', label: r.hasReport ? 'Replace & complete' : 'Upload & complete', variant: 'primary' }],
    });
    return res.action === 'upload' ? res.checked : null;
  }

  /** Upload the partner report and mark the tube's outsourced tests Completed. */
  private async uploadAndComplete(file: File, attachToReport = ATTACH_DEFAULT) {
    const r = this.tube();
    const problem = partnerFileProblem(file);
    if (problem) { this.toasts.error(problem); return; }
    this.busyAct.set('upload');
    this.busy.set(true);
    try {
      const url = await this.svc.upload(file);
      const updated = await this.svc.complete(actionLines(r), { url, name: file.name, type: file.type }, attachToReport);
      this.toasts.success(`${r.hasReport ? 'Report replaced' : 'Report uploaded'} — ${this.testNames()} completed`);
      await this.warnIfNotJoinable(updated);
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.busy.set(false);
    }
  }

  async markCompleted() {
    const r = this.tube();
    this.busyAct.set('complete');
    this.busy.set(true);
    try {
      await this.svc.complete(actionLines(r), null);
      this.toasts.success(`${this.testNames()} completed`);
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.busy.set(false);
    }
  }

  /** Attach to / detach from our report, later. */
  async toggleAttach() {
    const r = this.tube();
    const attach = attachState(r) === 'separate';
    this.busyAct.set('attach');
    this.busy.set(true);
    try {
      const updated = await this.svc.setAttachToReport(r.tests.filter(t => t.report).map(t => t.orderTestId), attach);
      if (attach && firstAttachProblem(updated)) await this.warnIfNotJoinable(updated);
      else this.toasts.success(attach
        ? 'Attached — the patient gets one PDF with the partner report'
        : 'Detached — the partner report is sent as a separate file');
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.busy.set(false);
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

  async undo() {
    const r = this.tube();
    const ok = await this.dialog.confirm({
      title: 'Undo Completed?',
      message: `${this.testNames()} goes back to Outsourced. The uploaded report stays attached; a report already released is not changed.`,
      confirmLabel: 'Undo completed',
      tone: 'danger',
    });
    if (!ok) return;
    this.busyAct.set('undo');
    this.busy.set(true);
    try {
      await this.svc.reopen(r.tests.map(t => t.orderTestId));
      this.toasts.success('Moved back to Outsourced');
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.busy.set(false);
    }
  }
}

/** The compact (phone) action set for one outsourced tube: the ONE primary (the tube's next step — View once
 *  completed with a report, Complete when a report waits, else Upload) and the rest, in the full row's order. */
export function outsourcedCompactActs(t: OutsourcedTube): { primary: 'view' | 'complete' | 'upload'; more: PfAction[] } {
  const rep = rowReport(t);
  const all: PfAction[] = [];
  if (rep) all.push({ id: 'view', label: 'View partner report', icon: 'view' });
  if (rep) all.push({ id: 'attach', label: attachState(t) === 'separate' ? 'Attach to report' : 'Detach from report', icon: 'link' });
  if (t.status === 'completed') all.push({ id: 'undo', label: 'Undo completed', tone: 'danger' });
  else if (t.hasReport) all.push({ id: 'complete', label: 'Mark completed' });
  all.push({ id: 'upload', label: t.hasReport ? 'Replace report' : 'Upload report' });
  const primary: 'view' | 'complete' | 'upload' = t.status === 'completed' && rep ? 'view' : (t.status !== 'completed' && t.hasReport ? 'complete' : 'upload');
  return { primary, more: all.filter(a => a.id !== primary) };
}
