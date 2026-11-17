import { ChangeDetectionStrategy, Component, DestroyRef, Injector, OnInit, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Observable } from 'rxjs';
import { AgGridAngular } from 'ag-grid-angular';
import { CellKeyDownEvent, ColDef, FullWidthCellKeyDownEvent, GetRowIdParams, GridApi, GridReadyEvent, ICellRendererParams, RowClassParams, RowClickedEvent } from 'ag-grid-community';
import { ThemeService } from '../../../../core/services/theme.service';
import { ToastService } from '../../../../core/services/toast.service';
import { DialogService } from '../../../../core/services/dialog.service';
import { BranchSwitchService } from '../../../../core/services/branch-switch.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { TmListFilter, TmProposalsService } from '../../../../core/services/tm-proposals.service';
import { ApiError } from '../../../../shared/models/api-response.model';
import type { TmProposal } from '../../../../shared/models/tm-proposal.model';
import type { Test } from '../../../../shared/models/test.model';
import { ndGridDark, ndGridLight } from '../../../../shared/utils/pf-grid-theme';
import { PfSelectOption, SelectComponent } from '../../../../shared/primitives/select.component';
import { SKELETON_KIT } from '../../../../shared/primitives/skeleton-kit.component';
import { BusyDirective } from '../../../../shared/directives/busy.directive';
import { agoWords } from '../../../../shared/instruments/instrument-config';
import {
  TmDiffRow, TmLookups, isOpen, tmCanSeeKind, tmChangeLine, tmClinicalItems, tmConfidenceLine, tmDiffRows, tmExpiresLine,
  tmFailedWords, tmKindLabel, tmMatches, tmNeedsClinicalConfirm, tmPeopleLine, tmSourceLine, tmSourceShort, tmStatusLabel, tmWhenLine,
} from '../../../../shared/utils/tm-proposals';

/** Status → the dot tone of `.pf-sdot` (data, never decoration). */
function statusTone(s: string): string {
  return s === 'failed' ? 'bad' : s === 'stale' ? 'warn' : s === 'approved' ? 'done' : '';
}

function svg(paths: string[], size = 14): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const el = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({ width: String(size), height: String(size), viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) el.setAttribute(k, v);
  for (const d of paths) { const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); el.appendChild(p); }
  return el;
}
const ICON_STALE = ['M21 12a9 9 0 1 1-3-6.7', 'M21 3v6h-6'];
const ICON_FAILED = ['M12 9v4', 'M12 17h.01', 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z'];

/**
 * Test Master → "Pending" (beta `assistant`, dev only): the inbox of changes
 * Cortex or an outside assistant (AI connector) SUGGESTED. Nothing applies
 * itself. ND "two jobs": the list is the MAIN card (AG-Grid, one row per
 * change, a row tap opens it — no checkboxes, no select-all, no approve-all:
 * owner rule, one by one only) and the REVIEW side card shows that ONE
 * change before → after with the one primary (Approve). Clinical changes ask
 * for the "I checked these values against the lab's SOP" tick (DialogService;
 * the server refuses without it). A row that changed since it was suggested
 * shows Current now | At proposal | Proposed and must be re-reviewed first; a
 * failed apply says why. Phones: the list is the card, the review a sheet.
 */
@Component({
  selector: 'pf-tm-pending-panel',
  standalone: true,
  imports: [AgGridAngular, NgTemplateOutlet, SelectComponent, BusyDirective, ...SKELETON_KIT],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-tmp" [class.pf-tmp--narrow]="narrow()">
      <section class="pf-card pf-tmp__main" aria-label="Pending changes">
        <header class="pf-card__head pf-tmp__head">
          <span class="pf-card__icon" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          </span>
          <span class="pf-card__label">Pending changes</span>
          <span class="pf-card__note pf-tmp__hint">Suggested by Cortex or an outside assistant. Nothing changes until you approve it.</span>
          <span class="pf-card__spacer"></span>
          <span class="pf-tmp__count pf-num" aria-live="polite">{{ countLabel() }}</span>
          <pf-select class="pf-tmp__filter" size="sm" [options]="filterOptions" [value]="filter()"
                     (valueChange)="setFilter($event)" aria-label="Show"></pf-select>
        </header>
        @if (batch()) {
          <div class="pf-tmp__batch" data-tmp-batch>
            <span class="pf-chip pf-chip--static pf-chip--violet">From the rate card you just read</span>
            <button type="button" class="pf-btn pf-btn--quiet press" (click)="batchCleared.emit()">Show all pending</button>
          </div>
        }
        <div class="pf-tmp__body">
          @if (loading() && !loadedOnce()) {
            <pf-skeleton-table [rows]="6" [cols]="4" label="Loading pending changes…"></pf-skeleton-table>
          } @else if (shown().length === 0) {
            <div class="pf-empty pf-empty--compact" data-tmp-empty>
              <span class="pf-empty__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              </span>
              <p class="pf-empty__title">{{ emptyTitle() }}</p>
              <p class="pf-empty__body">{{ emptyBody() }}</p>
            </div>
          } @else {
            <ag-grid-angular class="pf-tmp__grid" [theme]="gridTheme()" [rowData]="shown()" [columnDefs]="cols()"
                             [defaultColDef]="defaultColDef" [getRowId]="rowId" [getRowClass]="rowClass"
                             [animateRows]="true" (gridReady)="onGridReady($event)" (rowClicked)="onRowClicked($event)" (cellKeyDown)="onCellKey($event)"></ag-grid-angular>
          }
          @if (total() > items().length) {
            <p class="pf-tmp__more pf-num">Showing the newest {{ items().length }} of {{ total() }}. Review these first; the rest appear as these are done.</p>
          }
        </div>
      </section>

      @if (narrow()) {
        @if (sheetOpen() && selectedId()) {
          <div class="pf-sheet-backdrop pf-tmp__backdrop" (click)="closeSheet()"></div>
          <aside class="pf-card pf-tmp__side pf-tmp__side--sheet" role="dialog" aria-modal="true" aria-label="Review change"
                 (keydown.escape)="closeSheet()">
            <span class="pf-sheet__handle pf-tmp__handle" aria-hidden="true"></span>
            <ng-container *ngTemplateOutlet="review; context: { sheet: true }"></ng-container>
          </aside>
        }
      } @else {
        <aside class="pf-card pf-tmp__side" aria-label="Review change">
          <ng-container *ngTemplateOutlet="review; context: { sheet: false }"></ng-container>
        </aside>
      }
    </div>

    <ng-template #review let-sheet="sheet">
      <header class="pf-card__head">
        <span class="pf-card__icon" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M8 21H3v-5"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>
        </span>
        <span class="pf-card__label">Review</span>
        <span class="pf-card__spacer"></span>
        @if (sheet) {
          <button type="button" class="pf-btn pf-btn--icon" (click)="closeSheet()" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        }
      </header>
      @if (detail(); as p) {
        <div class="pf-card__body pf-tmp__detail" data-tmp-detail [attr.data-status]="p.status">
          <div class="pf-tmp__title">
            <h3 class="pf-tmp__target">{{ p.targetLabel }}</h3>
            <div class="pf-tmp__chips">
              <span class="pf-chip pf-chip--static">{{ kindLabel(p.kind) }}</span>
              <span class="pf-sdot" [attr.data-tone]="tone(p.status)">{{ statusLabel(p.status) }}</span>
              @if (p.clinicalFields.length > 0) {
                <span class="pf-tmp__clin" data-tmp-clinical><span class="pf-dot-unpriced" aria-hidden="true"></span>Clinical</span>
              }
            </div>
          </div>

          @if (branchTarget(); as bt) {
            <div class="pf-tmp__banner pf-tmp__banner--warn" role="status" data-tmp-branch>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
              <div>
                <p class="pf-tmp__banner-t">Suggested for {{ bt.name }}</p>
                <p class="pf-tmp__banner-b">A test change is applied in the branch you are working in. Switch to {{ bt.name }} to approve it.</p>
                <button type="button" class="pf-btn pf-btn--tertiary pf-tmp__switch press" [disabled]="busy()" (click)="switchToBranch()" data-tmp-switch>Switch to {{ bt.name }}</button>
              </div>
            </div>
          }
          @if (p.status === 'stale') {
            <div class="pf-tmp__banner pf-tmp__banner--warn" role="status" data-tmp-stale>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>
              <div>
                <p class="pf-tmp__banner-t">Changed since suggested</p>
                <p class="pf-tmp__banner-b">Someone changed this test after the suggestion was made. Compare the values below, then re-review it before you can approve.</p>
              </div>
            </div>
          }
          @if (p.status === 'failed') {
            <div class="pf-tmp__banner pf-tmp__banner--bad" role="status" data-tmp-failed>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>
              <div>
                <p class="pf-tmp__banner-t">Could not apply</p>
                <p class="pf-tmp__banner-b">{{ failedWords(p.error) }}</p>
              </div>
            </div>
          }

          @if (rows().length > 0) {
            <div class="pf-tmp__diffwrap">
              <table class="pf-tmp__diff" [class.pf-tmp__diff--three]="p.status === 'stale'">
                <thead>
                  <tr>
                    <th scope="col">Field</th>
                    <th scope="col">{{ p.status === 'stale' ? 'Current now' : 'Current' }}</th>
                    @if (p.status === 'stale') { <th scope="col">At proposal</th> }
                    <th scope="col">Proposed</th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of rows(); track r.key) {
                    <tr [class.pf-tmp__row--clin]="r.clinical">
                      <th scope="row">
                        <span class="pf-tmp__field">{{ r.label }}</span>
                        @if (r.clinical) { <span class="pf-tmp__clin pf-tmp__clin--sm"><span class="pf-dot-unpriced" aria-hidden="true"></span>Clinical</span> }
                      </th>
                      <td class="pf-tmp__cur">{{ r.current }}</td>
                      @if (p.status === 'stale') { <td class="pf-tmp__at">{{ r.atProposal }}</td> }
                      <td class="pf-tmp__new">{{ r.proposed }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
          @if (p.status === 'pending' && p.clinicalFields.length > 0) {
            <p class="pf-tmp__clinnote"><span class="pf-dot-unpriced" aria-hidden="true"></span>These values affect results. Approving asks you to confirm you checked them against the lab's SOP.</p>
          }

          <dl class="pf-tmp__meta">
            <div><dt>From</dt><dd data-tmp-source>{{ sourceLine(p) }}</dd></div>
            @if (confidenceLine(p)) { <div><dt>Match</dt><dd data-tmp-confidence>{{ confidenceLine(p) }}</dd></div> }
            @if (p.reason) { <div><dt>Why</dt><dd>{{ p.reason }}</dd></div> }
            <div><dt>Who</dt><dd data-tmp-people>{{ peopleLine(p) }}</dd></div>
            <div><dt>When</dt><dd>{{ whenLine(p) }}@if (expiresLine(p)) { · {{ expiresLine(p) }} }</dd></div>
            @if (p.resolutionNote) { <div><dt>Note</dt><dd>{{ p.resolutionNote }}</dd></div> }
          </dl>
        </div>
        @if (actionable(p)) {
          <footer class="pf-card__foot pf-tmp__foot" data-tmp-actions>
            @if (p.isMine) {
              <button type="button" class="pf-btn pf-btn--tertiary pf-span press" [disabled]="busy()" [pfBusy]="busyKey() === 'withdraw'"
                      pfBusyLabel="Withdrawing…" (click)="withdraw()" data-tmp-withdraw>Withdraw my suggestion</button>
            }
            <button type="button" class="pf-btn pf-btn--danger press" [disabled]="busy()" [pfBusy]="busyKey() === 'reject'"
                    pfBusyLabel="Rejecting…" (click)="reject()" data-tmp-reject>Reject</button>
            @if (p.status === 'pending') {
              <button type="button" class="pf-btn pf-btn--primary press" [disabled]="busy()" [pfBusy]="busyKey() === 'approve'"
                      pfBusyLabel="Approving…" (click)="approve()" data-tmp-approve>Approve</button>
            } @else {
              <button type="button" class="pf-btn pf-btn--primary press" [disabled]="busy()" [pfBusy]="busyKey() === 'rereview'"
                      pfBusyLabel="Checking…" (click)="reReview()" data-tmp-rereview>Re-review</button>
            }
          </footer>
        }
      } @else if (detailLoading()) {
        <div class="pf-card__body"><pf-skeleton-rows [rows]="5" [avatar]="false" [dense]="true" [trailing]="false" label="Loading the change…"></pf-skeleton-rows></div>
      } @else {
        <div class="pf-card__body pf-tmp__pick">
          <p>Pick a change on the left to see it before and after.</p>
          <p class="pf-tmp__pick-sub">Each change is approved or rejected on its own.</p>
        </div>
      }
    </ng-template>
  `,
  styles: [`
    :host { display: block; min-height: 0; height: 100%; }
    /* Test Master's two-panel (owner 2026-11-17): the side card (Review) on the LEFT, the main card on the right. */
    .pf-tmp { display: grid; grid-template-columns: 420px minmax(0, 1fr); gap: 16px; align-items: stretch; height: 100%; min-height: 0; }
    .pf-tmp > .pf-tmp__side:not(.pf-tmp__side--sheet) { order: -1; }
    .pf-tmp--narrow { grid-template-columns: minmax(0, 1fr); }
    .pf-tmp__main, .pf-tmp__side { min-height: 0; }
    .pf-tmp__head { row-gap: 8px; }
    .pf-tmp__hint { font-size: 12px; color: var(--text-tertiary); }
    .pf-tmp__count { font-size: 12.5px; color: var(--text-tertiary); white-space: nowrap; }
    .pf-tmp__filter { min-width: 190px; }
    .pf-tmp__batch { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 16px; border-bottom: 1px solid var(--pf-line); }
    .pf-tmp__body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
    .pf-tmp__grid { flex: 1 1 auto; min-height: 280px; width: 100%; }
    .pf-tmp__more { margin: 0; padding: 8px 14px 10px; font-size: 12px; color: var(--text-tertiary); border-top: 1px solid var(--pf-line); }
    :host ::ng-deep .pf-tmp-row { cursor: pointer; }
    :host ::ng-deep .pf-tmp-row--sel { background: var(--pf-in-tint) !important; }
    :host ::ng-deep .pf-tmp-cell { display: flex; flex-direction: column; justify-content: flex-start; gap: 2px; line-height: 1.35; padding: 12px 0; white-space: normal; overflow-wrap: anywhere; }
    :host ::ng-deep .pf-tmp-cell__main { color: var(--text-primary); font-weight: 500; }
    :host ::ng-deep .pf-tmp-cell__text { color: var(--text-primary); }
    :host ::ng-deep .pf-tmp-cell__sub { color: var(--text-secondary); font-size: 12px; }
    :host ::ng-deep .pf-tmp-status { display: flex; align-items: flex-start; gap: 6px; white-space: normal; }
    :host ::ng-deep .pf-tmp-status .pf-sdot { white-space: normal; }
    :host ::ng-deep .pf-tmp-status svg { flex: none; margin-top: 2px; color: var(--text-secondary); }
    :host ::ng-deep .pf-tmp-status__t { font-size: 12.5px; font-weight: 500; color: var(--text-secondary); }
    :host ::ng-deep .pf-tmp-flag { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); }

    .pf-tmp__detail { display: flex; flex-direction: column; gap: 14px; overflow-y: auto; }
    .pf-tmp__title { display: flex; flex-direction: column; gap: 8px; }
    .pf-tmp__target { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; line-height: 1.35; }
    .pf-tmp__chips { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .pf-tmp__clin { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; color: var(--text-secondary); white-space: nowrap; }
    .pf-tmp__clin--sm { margin-top: 3px; font-size: 11.5px; font-weight: 400; }
    .pf-tmp__banner { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: var(--pf-radius-sm, 10px);
      border: 1px solid var(--pf-line); background: var(--pf-chip-bg); color: var(--text-primary); }
    .pf-tmp__banner > svg { flex: none; margin-top: 2px; }
    .pf-tmp__banner--warn > svg { color: var(--amber-text, #d97706); }
    .pf-tmp__banner--bad > svg { color: var(--red-text, #dc2626); }
    .pf-tmp__banner-t { margin: 0 0 2px; font-size: 13px; font-weight: 600; }
    .pf-tmp__switch { margin-top: 8px; }
    .pf-tmp__banner-b { margin: 0; font-size: 12.5px; color: var(--text-secondary); line-height: 1.45; }
    .pf-tmp__diffwrap { overflow-x: auto; }
    .pf-tmp__diff { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    .pf-tmp__diff th, .pf-tmp__diff td { text-align: left; padding: 8px 8px; vertical-align: top; border-top: 1px solid var(--pf-line);
      overflow-wrap: anywhere; white-space: pre-line; }
    .pf-tmp__diff thead th { border-top: 0; font-size: 12px; font-weight: 500; color: var(--text-tertiary); white-space: nowrap; }
    .pf-tmp__diff tbody th { font-weight: 500; color: var(--text-secondary); width: 30%; }
    .pf-tmp__field { display: block; }
    .pf-tmp__cur, .pf-tmp__at { color: var(--text-primary); }
    .pf-tmp__at { color: var(--text-secondary); }
    .pf-tmp__new { color: var(--text-primary); font-weight: 600; }
    .pf-tmp__clinnote { display: flex; gap: 8px; align-items: baseline; margin: 0; font-size: 12.5px; color: var(--text-secondary); line-height: 1.45; }
    .pf-tmp__meta { margin: 0; display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; }
    .pf-tmp__meta > div { display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 8px; }
    .pf-tmp__meta dt { color: var(--text-tertiary); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; padding-top: 2px; }
    .pf-tmp__meta dd { margin: 0; color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-tmp__pick { display: flex; flex-direction: column; gap: 4px; justify-content: center; text-align: center; color: var(--text-secondary); font-size: 13px; }
    .pf-tmp__pick p { margin: 0; }
    .pf-tmp__pick-sub { font-size: 12px; color: var(--text-tertiary); }

    .pf-tmp__backdrop { display: block; position: fixed; inset: 0 0 var(--pf-nav-h, 0px) 0; z-index: 1001; background: rgba(0, 0, 0, 0.45); }
    .pf-tmp__side--sheet { position: fixed; left: 0; right: 0; bottom: var(--pf-nav-h, 0px); z-index: 1002;
      height: min(92dvh, calc(100dvh - env(safe-area-inset-top, 0px) - var(--pf-nav-h, 0px) - 8px));
      border-radius: 20px 20px 0 0; animation: pf-rise var(--pf-dur-sheet, 320ms) var(--pf-spring-bounce, ease) both; }
    .pf-tmp__handle { display: block; flex: none; width: 40px; height: 5px; margin: 8px auto 2px; border-radius: 999px; background: var(--pf-line); }
    .pf-tmp__foot .pf-btn { min-height: 44px; }
    @media (min-width: 641px) and (max-width: 900px) {
      .pf-tmp__side--sheet { left: max(16px, calc(50% - 320px)); right: max(16px, calc(50% - 320px)); }
    }
    @media (max-width: 640px) {
      .pf-tmp__hint { display: none; }
      .pf-tmp__filter { min-width: 0; flex: 1 1 100%; }
      .pf-tmp__diff tbody th { width: 34%; }
    }
    @media (prefers-reduced-motion: reduce) { .pf-tmp__side--sheet { animation: none; } }
  `],
})
export class PendingChangesPanelComponent implements OnInit {
  private readonly svc = inject(TmProposalsService);
  private readonly theme = inject(ThemeService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly auth = inject(AuthService, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  /** The branch switcher is looked up only when a switch is needed (it pulls in the router and the branch caches). */
  private readonly injector = inject(Injector);

  /** Band search text (the host's band pill drives it). */
  readonly query = input<string>('');
  /** Narrow to the suggestions of ONE rate-card read (the assistant's "Review in Pending"); null = everything. */
  readonly batch = input<string | null>(null);
  /** The person cleared the batch chip: show everything again. */
  readonly batchCleared = output<void>();
  /** ≤900px: the review is a sheet over the list. */
  readonly narrow = input<boolean>(false);
  /** The loaded catalogue (names for profile members). */
  readonly tests = input<readonly Test[]>([]);
  /** Department id → name (for a department change). */
  readonly departments = input<readonly { id: string; name: string }[]>([]);
  /** Open (pending + stale + failed) after every load / action — the band badge. */
  readonly countChange = output<number>();
  /** A change was applied: the host reloads the catalogue. */
  readonly applied = output<void>();

  readonly filterOptions: PfSelectOption<TmListFilter>[] = [
    { value: 'review', label: 'Needs review' },
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'withdrawn', label: 'Withdrawn' },
    { value: 'expired', label: 'Expired' },
    { value: 'all', label: 'All' },
  ];
  readonly filter = signal<TmListFilter>('review');
  readonly items = signal<TmProposal[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly loadedOnce = signal(false);
  readonly selectedId = signal<string | null>(null);
  readonly detail = signal<TmProposal | null>(null);
  readonly detailLoading = signal(false);
  readonly sheetOpen = signal(false);
  /** The branch a pending TEST edit was suggested for when it is not the one open now (and the person can go there).
   *  Mirrors the server's wrong_branch rule: prices name their own branch row and are not affected. */
  readonly branchTarget = computed<{ id: string; name: string } | null>(() => {
    const p = this.detail();
    if (!p || p.status !== 'pending' || !p.branchId || p.kind === 'price' || p.kind === 'offered') return null;
    const a = this.auth;
    if (!a || p.branchId === a.activeBranchId?.()) return null;
    const b = a.user?.()?.branches?.find(x => x.id === p.branchId);
    return b ? { id: b.id, name: b.name } : null;
  });
  readonly busy = signal(false);
  readonly busyKey = signal<string | null>(null);
  private now = Date.now();

  readonly gridTheme = computed(() => (this.theme.isDark() ? ndGridDark : ndGridLight));
  readonly shown = computed(() => this.items().filter(p => tmMatches(p, this.query())));
  readonly countLabel = computed(() => {
    const n = this.shown().length;
    return `${n} change${n === 1 ? '' : 's'}`;
  });
  readonly emptyTitle = computed(() => this.query().trim() ? `Nothing matches "${this.query().trim()}"`
    : this.filter() === 'review' ? 'Nothing waiting for review' : 'No changes here');
  readonly emptyBody = computed(() => this.query().trim() ? 'Try a test name, a code or who suggested it.'
    : this.filter() === 'review' ? 'When Cortex or an outside assistant suggests a Test Master change, it waits here for you.' : 'Pick another status to see older changes.');

  private readonly has = (code: string): boolean => {
    const a = this.auth;
    return !a || typeof a.hasPermission !== 'function' ? true : a.hasPermission(code);
  };

  private readonly lookups = computed<TmLookups>(() => {
    const depts = new Map(this.departments().map(d => [d.id, d.name] as const));
    const tests = new Map<string, { name: string; code?: string | null }>();
    for (const t of this.tests()) {
      const v = { name: t.name, code: t.testCode };
      tests.set(t.id, v);
      const key = (t as { catalogKey?: string | null }).catalogKey;
      if (key) tests.set(key, v);
    }
    return { department: id => depts.get(id) ?? null, test: k => tests.get(k) ?? null };
  });
  readonly rows = computed<TmDiffRow[]>(() => { const p = this.detail(); return p ? tmDiffRows(p, this.lookups()) : []; });

  // ── grid ──
  readonly defaultColDef: ColDef<TmProposal> = { sortable: false, resizable: true, suppressMovable: true, wrapText: true, autoHeight: true };
  readonly rowId = (p: GetRowIdParams<TmProposal>) => p.data.id;
  readonly rowClass = (p: RowClassParams<TmProposal>): string =>
    'pf-tmp-row' + (p.data && p.data.id === this.selectedId() ? ' pf-tmp-row--sel' : '');

  /** Plain text, top-aligned like the multi-line cells beside it. */
  private readonly textCell = (p: ICellRendererParams<TmProposal>): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.className = 'pf-tmp-cell';
    const a = document.createElement('span'); a.className = 'pf-tmp-cell__text'; a.textContent = p.value == null ? '' : String(p.value);
    wrap.appendChild(a);
    return wrap;
  };
  private readonly testCell = (p: ICellRendererParams<TmProposal>): HTMLElement => {
    const d = p.data!;
    const wrap = document.createElement('div');
    wrap.className = 'pf-tmp-cell';
    const a = document.createElement('span'); a.className = 'pf-tmp-cell__main'; a.textContent = d.targetLabel;
    wrap.appendChild(a);
    if (this.narrow()) {
      const b = document.createElement('span'); b.className = 'pf-tmp-cell__sub'; b.textContent = `${tmChangeLine(d)} · ${tmSourceShort(d)}`;
      wrap.appendChild(b);
    }
    return wrap;
  };
  private readonly changeCell = (p: ICellRendererParams<TmProposal>): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.className = 'pf-tmp-cell';
    const a = document.createElement('span'); a.className = 'pf-tmp-cell__main'; a.textContent = tmChangeLine(p.data!);
    wrap.append(a);
    return wrap;
  };
  private readonly statusCell = (p: ICellRendererParams<TmProposal>): HTMLElement => {
    const d = p.data!;
    const wrap = document.createElement('div');
    wrap.className = 'pf-tmp-cell';
    const line = document.createElement('span'); line.className = 'pf-tmp-status';
    if (d.status === 'stale') line.appendChild(svg(ICON_STALE));
    if (d.status === 'failed') line.appendChild(svg(ICON_FAILED));
    const s = document.createElement('span'); s.className = 'pf-sdot'; s.textContent = tmStatusLabel(d.status);
    const tone = statusTone(d.status); if (tone) s.setAttribute('data-tone', tone);
    if (d.status === 'stale' || d.status === 'failed') s.className = 'pf-tmp-status__t';
    line.appendChild(s);
    wrap.appendChild(line);
    if ((d.clinicalFields ?? []).length > 0) {
      const c = document.createElement('span'); c.className = 'pf-tmp-flag';
      const dot = document.createElement('span'); dot.className = 'pf-dot-unpriced'; dot.setAttribute('aria-hidden', 'true');
      c.append(dot, document.createTextNode('Clinical'));
      wrap.appendChild(c);
    }
    return wrap;
  };

  readonly cols = computed<ColDef<TmProposal>[]>(() => {
    const narrow = this.narrow();
    const test: ColDef<TmProposal> = { headerName: 'Test', colId: 'test', flex: narrow ? 1.7 : 1.3, minWidth: narrow ? 120 : 150, cellRenderer: this.testCell };
    const status: ColDef<TmProposal> = { headerName: 'Status', colId: 'status', flex: 1, minWidth: narrow ? 104 : 130, cellRenderer: this.statusCell };
    if (narrow) return [test, status];
    return [
      test,
      { headerName: 'Change', colId: 'change', flex: 1.5, minWidth: 170, cellRenderer: this.changeCell },
      { headerName: 'From', colId: 'from', flex: 0.8, minWidth: 110, valueGetter: p => (p.data ? tmSourceShort(p.data) : ''), cellRenderer: this.textCell },
      status,
      { headerName: 'When', colId: 'when', flex: 0.7, minWidth: 96, valueGetter: p => (p.data ? agoWords(p.data.createdAt, this.now) : ''), cellRenderer: this.textCell },
    ];
  });

  constructor() {
    // The host picks / clears a rate-card batch after the panel exists: reload when it changes (not on first run).
    let seen: string | null | undefined;
    effect(() => {
      const b = this.batch();
      if (seen === undefined) { seen = b; return; }   // first run: ngOnInit already loads
      if (b === seen) return;
      seen = b;
      untracked(() => { this.selectedId.set(null); this.detail.set(null); this.sheetOpen.set(false); this.reload(false); });
    });
  }

  ngOnInit(): void { this.reload(); }

  setFilter(f: TmListFilter) {
    if (f === this.filter()) return;
    this.filter.set(f);
    this.selectedId.set(null); this.detail.set(null); this.sheetOpen.set(false);
    this.reload();
  }

  /** Reload the list (and the open detail). `next` = select this id after (or the first open one). */
  reload(keepSelection = true, next?: string | null) {
    this.loading.set(true);
    this.now = Date.now();
    (this.batch() ? this.svc.list(this.filter(), this.batch()) : this.svc.list(this.filter())).subscribe({
      next: r => {
        this.items.set(r.items); this.total.set(r.total);
        this.loading.set(false); this.loadedOnce.set(true);
        this.countChange.emit(r.openCount);
        const want = next !== undefined ? next : keepSelection ? this.selectedId() : null;
        const still = want && r.items.some(p => p.id === want) ? want : null;
        if (still) this.open(still, false);
        else if (!this.narrow() && r.items.length > 0 && next !== null) this.open(r.items[0].id, false);
        else { this.selectedId.set(null); this.detail.set(null); this.sheetOpen.set(false); }
      },
      error: e => {
        this.loading.set(false); this.loadedOnce.set(true);
        this.items.set([]); this.total.set(0);
        this.toasts.error(ApiError.from(e).message);
      },
    });
  }

  private gridApi?: GridApi<TmProposal>;
  onGridReady(e: GridReadyEvent<TmProposal>) { this.gridApi = e.api; }

  onRowClicked(e: RowClickedEvent<TmProposal>) { if (e.data) this.open(e.data.id, true); }
  onCellKey(e: CellKeyDownEvent<TmProposal> | FullWidthCellKeyDownEvent<TmProposal>) {
    const k = (e.event as KeyboardEvent | undefined)?.key;
    if ((k === 'Enter' || k === ' ') && e.data) this.open(e.data.id, true);
  }

  /** Open ONE change in the review card (a sheet on phones). */
  open(id: string, fromTap: boolean) {
    this.selectedId.set(id);
    try { this.gridApi?.redrawRows(); } catch { /* grid gone */ }
    if (fromTap && this.narrow()) this.sheetOpen.set(true);
    const cached = this.detail();
    if (!cached || cached.id !== id) this.detail.set(null);
    this.detailLoading.set(true);
    this.svc.get(id).subscribe({
      next: p => {
        if (this.selectedId() !== id) return;
        this.detail.set(p); this.detailLoading.set(false);
        // GET may have just found it stale: keep the list row in step.
        this.items.update(list => list.map(x => (x.id === id ? { ...x, status: p.status, clinicalFields: p.clinicalFields ?? x.clinicalFields } : x)));
      },
      error: e => { this.detailLoading.set(false); this.toasts.error(ApiError.from(e).message); },
    });
  }

  closeSheet() { this.sheetOpen.set(false); }

  /** A DialogService confirm opened over a sheet (z ≥ 1001) would sit UNDER it: close the sheet first, reopen on Cancel. */
  private hideSheetForDialog(): () => void {
    const was = this.sheetOpen();
    if (was) this.sheetOpen.set(false);
    return () => { if (was) this.sheetOpen.set(true); };
  }

  actionable(p: TmProposal): boolean {
    return isOpen(p) && tmCanSeeKind(this.has, p.kind);
  }

  async approve() {
    const p = this.detail();
    if (!p || this.busy() || p.status !== 'pending') return;
    if (this.branchTarget()) { await this.askSwitchBranch(); return; }   // the server would refuse (wrong_branch): say it first
    let confirmClinical = false;
    if (tmNeedsClinicalConfirm(p)) {
      const reopen = this.hideSheetForDialog();
      const r = await this.dialog.actions({
        title: 'Clinical values change',
        message: `Approving changes values that affect results for ${p.targetLabel}:`,
        items: tmClinicalItems(this.rows()),
        checkbox: { label: 'I checked these values against the lab’s SOP' },
        actions: [{ value: 'approve', label: 'Approve', variant: 'primary', requiresCheck: true }],
        cancelLabel: 'Cancel',
        tone: 'primary',
      });
      reopen();
      if (r.action !== 'approve' || !r.checked) return;
      confirmClinical = true;
    }
    this.run('approve', this.svc.approve(p.id, confirmClinical), `Approved: ${p.targetLabel}`, true);
  }

  async reject() {
    const p = this.detail();
    if (!p || this.busy()) return;
    const reopen = this.hideSheetForDialog();
    const note = await this.dialog.prompt({
      title: 'Reject this change?',
      message: `${p.targetLabel} stays as it is. You can say why (optional); the note is kept with the change.`,
      placeholder: 'Reason (optional)',
      multiline: true,
      confirmLabel: 'Reject',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    reopen();
    if (note === null) return;
    this.run('reject', this.svc.reject(p.id, note), `Rejected: ${p.targetLabel}`, false);
  }

  async withdraw() {
    const p = this.detail();
    if (!p || this.busy() || !p.isMine) return;
    const reopen = this.hideSheetForDialog();
    const ok = await this.dialog.confirm({
      title: 'Withdraw your suggestion?',
      message: `The suggested change to ${p.targetLabel} is taken back. Nothing in the Test Master changes.`,
      confirmLabel: 'Withdraw',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    reopen();
    if (!ok) return;
    this.run('withdraw', this.svc.withdraw(p.id), 'Suggestion withdrawn', false);
  }

  /** "I re-checked": measured against today's values again; it then waits for Approve like any other. */
  reReview() {
    const p = this.detail();
    if (!p || this.busy() || (p.status !== 'stale' && p.status !== 'failed')) return;
    this.busy.set(true); this.busyKey.set('rereview');
    this.svc.reReview(p.id).subscribe({
      next: v => {
        this.busy.set(false); this.busyKey.set(null);
        this.toasts.success('Re-reviewed. Check the values, then approve or reject.');
        this.detail.set(v);
        this.reload(true, p.id);
      },
      error: e => this.failed(e, p.id),
    });
  }

  private run(key: string, call: Observable<unknown>, done: string, applied: boolean) {
    const p = this.detail();
    if (!p) return;
    this.busy.set(true); this.busyKey.set(key);
    const nextId = this.nextAfter(p.id);
    call.subscribe({
      next: () => {
        this.busy.set(false); this.busyKey.set(null);
        this.toasts.success(done);
        if (applied) this.applied.emit();
        // One by one: on phones back to the list; on desktop the next change opens.
        if (this.narrow()) { this.sheetOpen.set(false); this.reload(false, null); }
        else this.reload(false, nextId);
      },
      error: e => this.failed(e, p.id),
    });
  }

  /** "Switch to <branch>": the existing in-app branch switch (veil, caches, guards), nothing else. */
  async switchToBranch(): Promise<void> {
    const t = this.branchTarget();
    if (!t) return;
    const ok = await this.injector.get(BranchSwitchService).switchTo(t.id);
    if (!ok) this.toasts.error('Could not switch branch. Use the branch switcher at the top.');
  }

  private async askSwitchBranch(): Promise<void> {
    const t = this.branchTarget();
    if (!t) return;
    const reopen = this.hideSheetForDialog();
    const ok = await this.dialog.confirm({
      title: `Switch to ${t.name}?`,
      message: `This change was suggested for ${t.name}. A test change is applied in the branch you are working in, so switch there first, then approve it.`,
      confirmLabel: `Switch to ${t.name}`,
      cancelLabel: 'Stay here',
      tone: 'primary',
    });
    reopen();
    if (ok) await this.switchToBranch();
  }

  /** A refused action: say why (server words), then re-read the change — it may be stale or failed now. */
  private failed(e: unknown, id: string) {
    this.busy.set(false); this.busyKey.set(null);
    const err = ApiError.from(e);
    if (err.code === 'changed_since_proposed') this.toasts.warning('This test changed after it was suggested. Compare the values and re-review it first.');
    else if (err.code === 'wrong_branch') {
      // The server refused because this lab acts in another branch: offer the switch (the row carries its branch);
      // with no branch of the person's to go to, say the server's words.
      if (this.branchTarget()) void this.askSwitchBranch();
      else this.toasts.error(err.message);
    }
    else this.toasts.error(err.message);
    this.reload(true, id);
  }

  private nextAfter(id: string): string | null {
    const list = this.shown();
    const i = list.findIndex(p => p.id === id);
    const rest = [...list.slice(i + 1), ...list.slice(0, Math.max(0, i))].filter(p => p.id !== id && isOpen(p));
    return rest[0]?.id ?? null;
  }

  // template helpers
  kindLabel = tmKindLabel;
  statusLabel = tmStatusLabel;
  tone = statusTone;
  failedWords = tmFailedWords;
  sourceLine = tmSourceLine;
  confidenceLine = tmConfidenceLine;
  peopleLine = tmPeopleLine;
  whenLine = (p: TmProposal) => tmWhenLine(p, this.now);
  expiresLine = (p: TmProposal) => tmExpiresLine(p, this.now);
}
