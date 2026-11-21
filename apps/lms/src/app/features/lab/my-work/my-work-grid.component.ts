import {
  AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, TemplateRef, computed, inject, input, signal, viewChild,
} from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import type { ColDef, GetRowIdParams, GridReadyEvent, IsFullWidthRowParams, RowClassParams, RowClickedEvent } from 'ag-grid-community';
import { LabSortService } from '../../../core/services/lab-sort.service';
import { DataGridComponent } from '../../../shared/components/data-grid/data-grid.component';
import { DataGridTemplateCellComponent } from '../../../shared/components/data-grid/template-cell.component';
import { ActionsMenuComponent, PfAction } from '../../../shared/components/actions-menu/actions-menu.component';
import { DailyNoComponent } from '../../../shared/components/daily-no/daily-no.component';
import { SkeletonComponent } from '../../../shared/primitives/skeleton.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { ZoomSourceDirective } from '../../../core/navigation/zoom.directive';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { GridFold, actionCol, dateCol, dueCell, durationCol, durationText, fitFold, minWidthOf, minutesSince, textCol, valuesCol } from '../../../shared/utils/work-grid';
import { WorkSetFilterComponent } from '../../../shared/components/work-set-filter/work-set-filter.component';
import type { OrderTest } from '../../../shared/models/order.model';
import {
  MwAction, MwDoneTube, MwMode, MwRow, MwRules, MwTube, doneMenu, donePrimary, doneStatus, groupPrimary,
  MwSortCol, groupStatus, mwColumns, sortColOf, sortKeyOf, tatCell, testNames, testsSummary, tubeMenu, tubePrimary, tubeStatus,
} from './my-work.grid';

/** What My Work hands its grid: its existing handlers and busy states (nothing new is decided here). */
export interface MwGridContext {
  rules(): MwRules;
  ownerName(id: string): string;
  /** The tube tap (`onCardActivate`): pick from the queue / open for entry (scan gate, claim, zoom). */
  activate(tube: MwTube, patientName: string, ev?: Event): void;
  /** Patient focus: show / hide a patient's tubes (`toggleExpand`). */
  toggle(orderId: string): void;
  delegate(tests: OrderTest[]): void;
  print(d: MwDoneTube): void;
  edit(d: MwDoneTube): void;
  view(d: MwDoneTube): void;
  /** Busy looks: tube being picked / claimed, report printing, tube re-opening. */
  pending(sampleId: string): boolean;
  printing(sampleId: string): boolean;
  reopening(sampleId: string): boolean;
  /** Press-and-hold peek (sample rows). */
  peekDown(tube: MwTube, ev: PointerEvent): void;
  peekMove(ev: PointerEvent): void;
  peekUp(): void;
}

const ICON: Partial<Record<string, PfAction['icon']>> = { delegate: 'reassign', view: 'view', edit: 'edit', print: 'print' };

/**
 * My Work's work list on the shared pf-data-grid (owner 2026-11-20: "the grid format we had against Frontdesk and
 * Results"). Row height, header and touch hit areas come from the shared grid theme only. Sample focus = a row per
 * tube; patient focus = a row per patient with their tubes inline; Completed = a row per finished tube. One primary
 * action at the row end + ⋯; a row tap does what the tile tap did. Phones (≤640px) get card rows.
 */
@Component({
  selector: 'pf-mw-grid',
  standalone: true,
  imports: [DataGridComponent, ActionsMenuComponent, DailyNoComponent, SkeletonComponent, BusyDirective, ZoomSourceDirective, DatePipe, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (phone()) {
      @if (loading() && !rows().length) {
        <ul class="wg-cards" aria-busy="true" data-testid="mw-cards-skel">
          @for (i of [0, 1, 2, 3]; track i) {
            <li class="wg-card wg-card--skel">
              <span class="wg-card__l1"><pf-skeleton variant="line" width="55%"></pf-skeleton><pf-skeleton variant="line" width="64px"></pf-skeleton></span>
              <pf-skeleton variant="line" width="80%" height="10px"></pf-skeleton>
              <span class="wg-card__foot"><span class="wg-acts"><pf-skeleton variant="block" width="112px" height="44px"></pf-skeleton><pf-skeleton variant="block" width="44px" height="44px"></pf-skeleton></span></span>
            </li>
          }
        </ul>
      } @else if (!rows().length) {
        <p class="mwg-empty">{{ emptyTitle() }}</p>
      } @else {
        <ul class="wg-cards" data-testid="mw-cards">
          @for (row of rows(); track row.id) {
            @switch (row.kind) {
              @case ('tube') {
                <li><ng-container [ngTemplateOutlet]="tubeCard" [ngTemplateOutletContext]="{ $implicit: row.tube, name: row.tube.patientName, urgent: row.priority === 'urgent', who: true }" /></li>
              }
              @case ('patient') {
                @let st = gStatus(row.tubes);
                @let p = gPrimary(row.tubes, row.open);
                <li class="wg-card" role="button" tabindex="0" [attr.data-urgent]="row.priority === 'urgent'" [attr.aria-expanded]="row.open"
                    [attr.aria-label]="(row.open ? 'Hide tubes for ' : 'Show tubes for ') + row.group.patientName"
                    (click)="onCard(row, $event)" (keydown.enter)="onCard(row, $event)" (keydown.space)="$event.preventDefault(); onCard(row, $event)">
                  <span class="wg-card__l1">
                    <span class="wg-who"><span class="wg-who__name"><pf-daily-no [of]="row.group.items[0]?.subOrder" />{{ row.group.patientName }}</span>
                      @if (row.group.patientMeta) { <span class="wg-who__meta">{{ row.group.patientMeta }}</span> }</span>
                    <ng-container [ngTemplateOutlet]="pill" [ngTemplateOutletContext]="{ $implicit: st }" />
                  </span>
                  <span class="wg-sub" [attr.title]="testsOf(row.group.items)">{{ summary(row.group.items) }}</span>
                  @for (t of row.tubes; track t.sampleId) { @for (r of t.rejections; track r.testName) { <span class="wg-note">{{ r.testName }}: {{ r.reason }}</span> } }
                  <span class="wg-card__foot">
                    @let tc = tat(row.group, row.group.items);
                    <span class="wg-tat" [class.wg-tat--late]="tc.late" [attr.title]="tc.detail">{{ tc.text }}</span>
                    @if (row.priority === 'urgent') { <span class="wg-prio" data-p="urgent">Urgent</span> }
                    <span class="wg-acts">
                      @if (p) { <ng-container [ngTemplateOutlet]="primaryBtn" [ngTemplateOutletContext]="{ a: p, tube: row.tubes[0], row: row, name: row.group.patientName }" /> }
                    </span>
                  </span>
                </li>
                @if (row.open) {
                  @for (t of row.tubes; track t.sampleId) {
                    <li class="mwg-subcard"><ng-container [ngTemplateOutlet]="tubeCard" [ngTemplateOutletContext]="{ $implicit: t, name: row.group.patientName, urgent: false, who: false }" /></li>
                  }
                }
              }
              @case ('done') {
                @let st = dStatus(row.done);
                @let p = dPrimary(row.done);
                <li class="wg-card" role="link" tabindex="0" [pfZoomSource]="row.done.sampleId"
                    [attr.aria-label]="'View results for ' + (row.done.barcode || row.done.sampleId)"
                    (click)="onCard(row, $event)" (keydown.enter)="onCard(row, $event)">
                  <span class="wg-card__l1">
                    <span class="wg-id">{{ row.done.barcode || row.done.sampleId }}</span>
                    <ng-container [ngTemplateOutlet]="pill" [ngTemplateOutletContext]="{ $implicit: st }" />
                  </span>
                  <span class="wg-who"><span class="wg-who__name"><pf-daily-no [of]="row.done.tests[0]?.subOrder" />{{ row.done.patientName }}</span>
                    <span class="wg-who__meta" [attr.title]="row.done.testNames">{{ metaJoin(row.done.patientMeta, summary(row.done.tests)) }}</span></span>
                  <span class="wg-card__foot">
                    <span class="wg-sub">{{ row.done.completedAt | date:'d MMM, h:mm a' }}</span>
                    <span class="wg-acts">
                      @if (p) { <ng-container [ngTemplateOutlet]="doneBtn" [ngTemplateOutletContext]="{ a: p, d: row.done }" /> }
                      <ng-container [ngTemplateOutlet]="doneMore" [ngTemplateOutletContext]="{ d: row.done }" />
                    </span>
                  </span>
                </li>
              }
            }
          }
        </ul>
      }
    } @else {
      <pf-data-grid class="mwg" data-testid="mw-grid" [rowData]="rows()" [columnDefs]="cols()" [defaultColDef]="defaultCol"
        [getRowId]="rowId" [getRowClass]="rowClass" [clickable]="true" [suppressColumnVirtualisation]="true"
        [isFullWidthRow]="isDetail" [fullWidthCellRenderer]="detailRenderer" [fullWidthCellRendererParams]="detailParams()"
        [loading]="loading() && !rows().length" loadingLabel="Loading the queue…" [emptyTitle]="emptyTitle()"
        [viewStateKey]="viewStateKey()"
        (rowClicked)="onRow($event)" (gridReady)="onGridReady($event)" />
    }

    <!-- ── Cell templates (pf-data-grid template cells — the page's own nodes) ── -->
    <ng-template #cSample let-row>
      @if (row.kind === 'tube') {
        <span class="wg-cell" [pfZoomSource]="row.tube.sampleId"
              (pointerdown)="ctx().peekDown(row.tube, $event)" (pointerup)="ctx().peekUp()" (pointercancel)="ctx().peekUp()"
              (pointerleave)="ctx().peekUp()" (pointermove)="ctx().peekMove($event)">
          <span class="wg-id wg-link" role="link" tabindex="0" [attr.aria-label]="tubeAria(row.tube)"
                (keydown.enter)="key(row, $event)" (keydown.space)="key(row, $event)">{{ row.tube.barcode || 'no label' }}</span>
          <ng-container [ngTemplateOutlet]="tags" [ngTemplateOutletContext]="{ $implicit: row.tube }" />
        </span>
      } @else if (row.kind === 'done') {
        <span class="wg-cell" [pfZoomSource]="row.done.sampleId">
          <span class="wg-id wg-link" role="link" tabindex="0" [attr.aria-label]="'View results for ' + (row.done.barcode || row.done.sampleId)"
                (keydown.enter)="key(row, $event)">{{ row.done.barcode || row.done.sampleId }}</span>
        </span>
      }
    </ng-template>

    <ng-template #cPatient let-row>
      @switch (row.kind) {
        @case ('tube') {
          <span class="wg-who">
            @if (fold() === 'tight') { <span class="wg-id">{{ row.tube.barcode || 'no label' }}</span> }
            <span class="wg-who__name"><pf-daily-no [of]="row.tube.tests[0]?.subOrder" />{{ row.tube.patientName }}</span>
            <span class="wg-who__meta" [attr.title]="testsOf(row.tube.tests)">{{ metaJoin(row.tube.patientMeta, summary(row.tube.tests)) }}</span>
            @for (r of row.tube.rejections; track r.testName) { <span class="wg-note">{{ r.testName }}: {{ r.reason }}</span> }
            <ng-container [ngTemplateOutlet]="foldTpl" [ngTemplateOutletContext]="{ st: tStatus(row.tube), urgent: row.priority === 'urgent' }" />
          </span>
        }
        @case ('patient') {
          <span class="wg-who">
            <span class="wg-who__name wg-link" role="link" tabindex="0"
                  [attr.aria-label]="(row.open ? 'Hide tubes for ' : 'Show tubes for ') + row.group.patientName"
                  (keydown.enter)="key(row, $event)" (keydown.space)="key(row, $event)"><pf-daily-no [of]="row.group.items[0]?.subOrder" />{{ row.group.patientName }}</span>
            <span class="wg-who__meta" [attr.title]="testsOf(row.group.items)">{{ metaJoin(row.group.patientMeta, summary(row.group.items)) }}</span>
            @for (t of row.tubes; track t.sampleId) { @for (r of t.rejections; track r.testName) { <span class="wg-note">{{ r.testName }}: {{ r.reason }}</span> } }
            <ng-container [ngTemplateOutlet]="foldTpl" [ngTemplateOutletContext]="{ st: gStatus(row.tubes), urgent: row.priority === 'urgent' }" />
          </span>
        }
        @case ('done') {
          <span class="wg-who">
            @if (fold() === 'tight') { <span class="wg-id">{{ row.done.barcode || row.done.sampleId }}</span> }
            <span class="wg-who__name"><pf-daily-no [of]="row.done.tests[0]?.subOrder" />{{ row.done.patientName }}</span>
            <span class="wg-who__meta" [attr.title]="row.done.testNames">{{ metaJoin(row.done.patientMeta, summary(row.done.tests)) }}</span>
            @if (fold() !== 'full') {
              <span class="wg-who__fold">
                <ng-container [ngTemplateOutlet]="pill" [ngTemplateOutletContext]="{ $implicit: dStatus(row.done) }" />
                @if (fold() === 'tight') { <span class="wg-sub">{{ row.done.completedAt | date:'d MMM, h:mm a' }}</span> }
              </span>
            }
          </span>
        }
      }
    </ng-template>

    <ng-template #cPriority let-row>
      <span class="wg-prio" [attr.data-p]="row.priority">{{ row.priority === 'urgent' ? 'Urgent' : 'Normal' }}</span>
    </ng-template>

    <!-- Due: time left to TAT (owner 2026-11-21 — every row here is at the same step, so no journey ring). -->
    <ng-template #cDue let-row>
      @let tc = row.kind === 'tube' ? tat(row.tube, row.tube.tests, row.tube.allDone) : tat(row.group, row.group.items);
      <span class="wg-cell"><span class="wg-tat mwg-due" [class.wg-tat--late]="tc.late" [attr.title]="tc.detail">{{ tc.text }}</span></span>
    </ng-template>

    <ng-template #cWait let-row>
      @let m = fMinutes(row);
      <span class="wg-cell"><span class="wg-tat" [attr.title]="m != null ? 'Time in the lab' : null">{{ m != null ? waitWords(m) : '—' }}</span></span>
    </ng-template>

    <ng-template #cStatus let-row>
      <span class="wg-cell">
        @switch (row.kind) {
          @case ('tube') { <ng-container [ngTemplateOutlet]="pill" [ngTemplateOutletContext]="{ $implicit: tStatus(row.tube) }" /> }
          @case ('patient') { <ng-container [ngTemplateOutlet]="pill" [ngTemplateOutletContext]="{ $implicit: gStatus(row.tubes) }" /> }
          @case ('done') { <ng-container [ngTemplateOutlet]="pill" [ngTemplateOutletContext]="{ $implicit: dStatus(row.done) }" /> }
        }
      </span>
    </ng-template>

    <ng-template #cWhen let-row>
      <span class="wg-tat">{{ row.done?.completedAt | date:'d MMM, h:mm a' }}</span>
    </ng-template>

    <ng-template #cActs let-row>
      <span class="wg-acts">
        @switch (row.kind) {
          @case ('tube') {
            @if (tPrimary(row.tube); as a) { <ng-container [ngTemplateOutlet]="primaryBtn" [ngTemplateOutletContext]="{ a: a, tube: row.tube, row: row, name: row.tube.patientName }" /> }
            <ng-container [ngTemplateOutlet]="tubeMore" [ngTemplateOutletContext]="{ tube: row.tube }" />
          }
          @case ('patient') {
            @if (gPrimary(row.tubes, row.open); as a) { <ng-container [ngTemplateOutlet]="primaryBtn" [ngTemplateOutletContext]="{ a: a, tube: row.tubes[0], row: row, name: row.group.patientName }" /> }
            @if (row.tubes.length === 1) { <ng-container [ngTemplateOutlet]="tubeMore" [ngTemplateOutletContext]="{ tube: row.tubes[0] }" /> }
          }
          @case ('done') {
            @if (dPrimary(row.done); as a) { <ng-container [ngTemplateOutlet]="doneBtn" [ngTemplateOutletContext]="{ a: a, d: row.done }" /> }
            <ng-container [ngTemplateOutlet]="doneMore" [ngTemplateOutletContext]="{ d: row.done }" />
          }
        }
      </span>
    </ng-template>

    <!-- Patient focus: the patient's tubes, inline under their row (a full-width row). Each tube keeps the tube tap. -->
    <ng-template #cDetail let-row>
      <ul class="mwg-tubes" data-testid="mw-tubes">
        @for (t of row.tubes; track t.sampleId) {
          @let st = tStatus(t);
          @let tc = tat(t, t.tests, t.allDone);
          <li class="mwg-tube" role="button" tabindex="0" [pfZoomSource]="t.sampleId" [attr.aria-label]="tubeAria(t)"
              [attr.aria-busy]="ctx().pending(t.sampleId) || null" [class.pf-nav-pending]="ctx().pending(t.sampleId)"
              (click)="ctx().activate(t, row.group.patientName, $event)"
              (keydown.enter)="ctx().activate(t, row.group.patientName)" (keydown.space)="$event.preventDefault(); ctx().activate(t, row.group.patientName)">
            <span class="wg-cell mwg-tube__id">
              <span class="wg-id">{{ t.barcode || 'no label' }}</span>
              <ng-container [ngTemplateOutlet]="tags" [ngTemplateOutletContext]="{ $implicit: t }" />
            </span>
            <span class="wg-cell mwg-tube__tests" [attr.title]="testsOf(t.tests)">
              <span class="wg-sub">{{ summary(t.tests) }}</span>
              @for (r of t.rejections; track r.testName) { <span class="wg-note">{{ r.testName }}: {{ r.reason }}</span> }
            </span>
            <span class="mwg-tube__st"><ng-container [ngTemplateOutlet]="pill" [ngTemplateOutletContext]="{ $implicit: st }" /></span>
            <span class="wg-tat mwg-tube__tat" [class.wg-tat--late]="tc.late" [attr.title]="tc.detail">{{ tc.text }}</span>
            <span class="wg-acts mwg-tube__acts">
              @if (tPrimary(t); as a) { <ng-container [ngTemplateOutlet]="primaryBtn" [ngTemplateOutletContext]="{ a: a, tube: t, row: row, name: row.group.patientName }" /> }
              <ng-container [ngTemplateOutlet]="tubeMore" [ngTemplateOutletContext]="{ tube: t }" />
            </span>
          </li>
        }
      </ul>
    </ng-template>

    <!-- ── Shared bits ── -->
    <ng-template #pill let-st>
      <span class="wg-pill" [attr.data-tone]="st.tone"><span class="wg-dot" aria-hidden="true"></span>{{ st.label }}</span>
    </ng-template>

    <ng-template #tags let-t>
      @if ((t.hasDraft && !t.allDone) || t.rejections.length) {
        <span class="wg-tags">
          @if (t.hasDraft && !t.allDone) { <span class="wg-tag" data-tone="violet">Draft</span> }
          @if (t.rejections.length) { <span class="wg-tag" data-tone="rose">Re-entry</span> }
        </span>
      }
    </ng-template>

    <ng-template #foldTpl let-st="st" let-urgent="urgent">
      @if (fold() !== 'full') {
        <span class="wg-who__fold">
          <span class="wg-pill" [attr.data-tone]="st.tone"><span class="wg-dot" aria-hidden="true"></span>{{ st.label }}</span>
          @if (urgent) { <span class="wg-prio" data-p="urgent">Urgent</span> }
        </span>
      }
    </ng-template>

    <ng-template #primaryBtn let-a="a" let-tube="tube" let-row="row" let-name="name">
      <button type="button" class="pf-rowact wg-act" [attr.data-action]="a.id" [attr.aria-label]="a.aria"
              [attr.aria-expanded]="a.id === 'tubes' ? row.open : null"
              [pfBusy]="a.id !== 'tubes' && ctx().pending(tube.sampleId)" pfBusyLabel="Opening…"
              (click)="run(a, tube, row, name, $event)">
        {{ a.label }}
        @if (a.id === 'tubes') {
          <svg class="wg-chev" [attr.data-open]="row.open" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block"><path d="m9 18 6-6-6-6"/></svg>
        }
      </button>
    </ng-template>

    <ng-template #tubeMore let-tube="tube">
      @let m = tMenu(tube);
      @if (m.length) {
        <pf-actions-menu [actions]="m" heading="More actions" [label]="'More actions for ' + (tube.barcode || tube.sampleId)"
          triggerClass="pf-rowact pf-rowact--icon wg-more" (action)="pickTube($event, tube)" />
      }
    </ng-template>

    <ng-template #doneBtn let-a="a" let-d="d">
      <button type="button" class="pf-rowact wg-act" [attr.data-action]="a.id" [attr.aria-label]="a.aria"
              [disabled]="a.id === 'print' ? ctx().printing(d.sampleId) : ctx().reopening(d.sampleId)"
              [pfBusy]="a.id === 'print' ? ctx().printing(d.sampleId) : ctx().reopening(d.sampleId)"
              [pfBusyLabel]="a.id === 'print' ? 'Opening the report…' : 'Opening…'"
              (click)="runDone(a.id, d, $event)">{{ a.label }}</button>
    </ng-template>

    <ng-template #doneMore let-d="d">
      <pf-actions-menu [actions]="dMenu(d)" heading="More actions" [label]="'More actions for ' + (d.barcode || d.sampleId)"
        triggerClass="pf-rowact pf-rowact--icon wg-more" (action)="pickDone($event, d)" />
    </ng-template>

    <ng-template #tubeCard let-t let-name="name" let-urgent="urgent" let-who="who">
      @let st = tStatus(t);
      @let tc = tat(t, t.tests, t.allDone);
      <div class="wg-card" role="button" tabindex="0" [attr.data-urgent]="urgent" [pfZoomSource]="t.sampleId" [attr.aria-label]="tubeAria(t)"
           [attr.aria-busy]="ctx().pending(t.sampleId) || null" [class.pf-nav-pending]="ctx().pending(t.sampleId)"
           (pointerdown)="ctx().peekDown(t, $event)" (pointerup)="ctx().peekUp()" (pointercancel)="ctx().peekUp()"
           (pointerleave)="ctx().peekUp()" (pointermove)="ctx().peekMove($event)"
           (click)="ctx().activate(t, name, $event)" (keydown.enter)="ctx().activate(t, name)" (keydown.space)="$event.preventDefault(); ctx().activate(t, name)">
        <span class="wg-card__l1">
          <span class="wg-id">{{ t.barcode || 'no label' }}</span>
          <ng-container [ngTemplateOutlet]="pill" [ngTemplateOutletContext]="{ $implicit: st }" />
        </span>
        @if (who) {
          <span class="wg-who"><span class="wg-who__name"><pf-daily-no [of]="t.tests[0]?.subOrder" />{{ t.patientName }}</span>
            <span class="wg-who__meta" [attr.title]="testsOf(t.tests)">{{ metaJoin(t.patientMeta, summary(t.tests)) }}</span></span>
        } @else { <span class="wg-sub" [attr.title]="testsOf(t.tests)">{{ summary(t.tests) }}</span> }
        @for (r of t.rejections; track r.testName) { <span class="wg-note">{{ r.testName }}: {{ r.reason }}</span> }
        <span class="wg-card__foot">
          <span class="wg-tat" [class.wg-tat--late]="tc.late" [attr.title]="tc.detail">{{ tc.text }}</span>
          @if (urgent) { <span class="wg-prio" data-p="urgent">Urgent</span> }
          <span class="wg-acts">
            @if (tPrimary(t); as a) { <ng-container [ngTemplateOutlet]="primaryBtn" [ngTemplateOutletContext]="{ a: a, tube: t, row: null, name: name }" /> }
            <ng-container [ngTemplateOutlet]="tubeMore" [ngTemplateOutletContext]="{ tube: t }" />
          </span>
        </span>
      </div>
    </ng-template>
  `,
  styles: [`
    @use '../../../shared/styles/work-grid' as wg;
    @include wg.cells;
    :host { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; min-width: 0; }
    .mwg { flex: 1 1 auto; min-height: 0; }
    .mwg-empty { margin: 0; padding: 32px 16px; text-align: center; font-size: 13.5px; color: var(--text-tertiary); }

    /* Patient focus: the tubes under a patient row — each a full tap target (≥ the touch row height). */
    .mwg-tubes { list-style: none; margin: 0; padding: 4px 10px 10px 28px; display: flex; flex-direction: column; gap: 6px;
      border-bottom: 1px solid var(--pf-line); background: color-mix(in srgb, var(--color-primary, #7c3aed) 3%, var(--pf-card-bg)); }
    .mwg-tube {
      display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px;
      min-height: var(--pf-grid-row-h, 56px); padding: 4px 4px 4px 12px; border-radius: var(--pf-radius-sm, 10px);
      border: 1px solid var(--pf-line); background: var(--pf-card-bg); cursor: pointer;
    }
    .mwg-tube:focus-visible { outline: 2px solid var(--color-primary, #7c3aed); outline-offset: 2px; }
    @media (hover: hover) and (pointer: fine) { .mwg-tube:hover { border-color: var(--glass-border-hover, rgba(124, 58, 237, 0.3)); } }
    .mwg-tube__id { flex: 0 0 112px; }
    .mwg-tube__tests { flex: 1 1 220px; }
    .mwg-tube__st, .mwg-tube__tat { flex: none; }
    .mwg-tube__acts { width: auto; flex: none; margin-left: auto; }
    .mwg-subcard { padding-left: 16px; }
  `],
})
export class MyWorkGridComponent implements AfterViewInit {
  readonly rows = input<MwRow[]>([]);
  readonly mode = input<MwMode>('sample');
  readonly ctx = input.required<MwGridContext>();
  readonly loading = input(false);
  readonly emptyTitle = input('');
  readonly phone = input(false);
  /** Keep the column filters / scroll across in-app navigation (ViewStateService); sort persists per user already. */
  readonly viewStateKey = input('');

  readonly web = webPointerSignal();
  private readonly sorts = inject(LabSortService);
  private readonly scope = computed(() => (this.mode() === 'done' ? 'completed' : 'work') as 'completed' | 'work');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly width = signal(1200);
  /** The widest column tier whose minimum widths fit the grid (columns fold before any button shrinks). */
  readonly fold = computed<GridFold>(() => this.foldFor(this.width()));
  private foldFor(w: number): GridFold {
    // Fixed columns lay out at their `width`, flex columns at least at `minWidth` — per tier.
    const mins = (f: GridFold) => Object.fromEntries(Object.entries(this.sizes(!this.web(), f)).map(([k, v]) => [k, v.width ?? v.minWidth ?? 0]));
    return fitFold(w, f => minWidthOf(mwColumns(this.mode(), f), mins(f)));
  }
  private sizes(touch: boolean, fold: GridFold = this.fold()): Record<string, ColDef<MwRow>> {
    return {
      sample: { width: 128, minWidth: 116 },
      patient: { flex: 2, minWidth: fold === 'tight' ? 190 : 220 },
      // Wide enough for the header words + sort / filter icons (headers never ellipsise).
      priority: { width: 128, minWidth: 128 },
      due: { width: 108, minWidth: 104 },
      wait: { width: 118, minWidth: 118 },
      status: { width: 150, minWidth: 136 },
      when: { width: 160, minWidth: 160 },
      // One primary + ⋯ at their full size (touch: 44 tall, 8 apart) — columns fold before the buttons shrink.
      acts: { width: touch ? 200 : 190, minWidth: touch ? 200 : 190 },
    };
  }

  /** Every column through the shared work-grid helpers (shared/utils/work-grid.ts): alignment + header filter + a
   *  sort on the REAL value (minutes, epoch, Urgent-first), built together so no column filters without sorting. */
  private colRule(colId: string, def: ColDef<MwRow>): ColDef<MwRow> {
    const set = WorkSetFilterComponent;
    const wrap = (d: ColDef<MwRow>) => ({ ...d, cellClass: 'wg-c-wrap' });
    switch (colId) {
      case 'sample': return textCol<MwRow>(def, r => this.fSample(r));
      case 'patient': return textCol<MwRow>(wrap(def), r => this.fPatient(r), 'left', r => this.fName(r));
      case 'priority': return valuesCol<MwRow>(def, r => (r.kind === 'done' ? '' : r.priority === 'urgent' ? 'Urgent' : 'Normal'), set, 'center',
        r => (r.kind === 'done' ? null : r.priority === 'urgent' ? 0 : 1));
      case 'due': return durationCol<MwRow>(def, r => this.fDue(r), { kind: 'due' });
      case 'wait': return durationCol<MwRow>(def, r => this.fMinutes(r), { kind: 'wait' });
      case 'status': return valuesCol<MwRow>(wrap(def), r => this.fStatus(r), set, 'center');
      case 'when': return dateCol<MwRow>(def, r => (r.kind === 'done' ? r.done.completedAt : null));
      default: return actionCol<MwRow>({ ...def, cellClass: 'wg-c-acts' });
    }
  }
  // Filter values per row (a patient's inline tubes row answers like its patient row).
  private linesOf(r: MwRow): OrderTest[] { return r.kind === 'tube' ? r.tube.tests : r.kind === 'done' ? r.done.tests : r.group.items; }
  private fSample(r: MwRow): string {
    return r.kind === 'tube' ? r.tube.barcode || r.tube.sampleId : r.kind === 'done' ? r.done.barcode || r.done.sampleId
      : r.tubes.map(t => t.barcode || t.sampleId).join(' ');
  }
  private fPatient(r: MwRow): string {
    const p = this.linesOf(r)[0]?.subOrder?.order?.patient as { displayName?: string; mrn?: string; phone?: string } | undefined;
    const name = r.kind === 'tube' ? r.tube.patientName : r.kind === 'done' ? r.done.patientName : r.group.patientName;
    return [name, p?.mrn, p?.phone].filter(Boolean).join(' ');
  }
  private fName(r: MwRow): string { return r.kind === 'tube' ? r.tube.patientName : r.kind === 'done' ? r.done.patientName : r.group.patientName; }
  private fStatus(r: MwRow): string {
    return r.kind === 'tube' ? this.tStatus(r.tube).label : r.kind === 'done' ? this.dStatus(r.done).label : this.gStatus(r.tubes).label;
  }
  /** Minutes left to TAT (negative = late) — the Due filter's number. */
  private fDue(r: MwRow): number | null {
    const x = r.kind === 'tube' ? r.tube : r.kind === 'done' ? null : r.group;
    return x?.remainingMin == null ? null : Math.round(x.remainingMin);
  }
  /** Minutes in the lab (the TAT cell's "in lab 40m"). */
  fMinutes(r: MwRow): number | null {
    const rec = this.linesOf(r).map(l => l.subOrder?.receivedAtLab).filter((v): v is string => !!v).sort()[0];
    return minutesSince(rec ?? null);
  }


  private readonly sampleTpl = viewChild<TemplateRef<unknown>>('cSample');
  private readonly patientTpl = viewChild<TemplateRef<unknown>>('cPatient');
  private readonly priorityTpl = viewChild<TemplateRef<unknown>>('cPriority');
  private readonly dueTpl = viewChild<TemplateRef<unknown>>('cDue');
  private readonly waitTpl = viewChild<TemplateRef<unknown>>('cWait');
  private readonly statusTpl = viewChild<TemplateRef<unknown>>('cStatus');
  private readonly whenTpl = viewChild<TemplateRef<unknown>>('cWhen');
  private readonly actsTpl = viewChild<TemplateRef<unknown>>('cActs');
  private readonly detailTpl = viewChild<TemplateRef<unknown>>('cDetail');

  readonly defaultCol: ColDef<MwRow> = { sortable: false, resizable: false, filter: false, suppressMovable: true, wrapText: true, autoHeight: true, minWidth: 60 };
  readonly rowId = (p: GetRowIdParams<MwRow>) => p.data.id;
  readonly rowClass = (p: RowClassParams<MwRow>) => {
    const d = p.data;
    if (!d) return undefined;
    if (d.kind === 'detail') return 'mwg-detailrow';
    const c = ['mwg-row', `mwg-row--${d.kind}`];
    if (d.kind !== 'done' && d.priority === 'urgent') c.push('wg-row--urgent');
    return c;
  };
  readonly isDetail = (p: IsFullWidthRowParams<MwRow>) => p.rowNode.data?.kind === 'detail';
  readonly detailRenderer = DataGridTemplateCellComponent;
  readonly detailParams = computed(() => ({ tpl: this.detailTpl(), measure: true }));

  readonly cols = computed<ColDef<MwRow>[]>(() => {
    const tpl: Record<string, TemplateRef<unknown> | undefined> = {
      sample: this.sampleTpl(), patient: this.patientTpl(), priority: this.priorityTpl(), due: this.dueTpl(),
      wait: this.waitTpl(), status: this.statusTpl(), when: this.whenTpl(), acts: this.actsTpl(),
    };
    const size = this.sizes(!this.web(), this.fold());
    // The GRID sorts, on the real value (minutes / epoch / Urgent first), asc → desc → none; "none" = My Work's own
    // default order (Urgent first, then soonest due). The header's sort is also saved as the lab's sort key
    // (LabSortService, so phones and the next visit start from it) — see onGridReady.
    const on = this.gridSort();
    return mwColumns(this.mode(), this.fold()).map(p => this.colRule(p.colId, {
      colId: p.colId, headerName: p.header, hide: p.hide, ...size[p.colId],
      sort: on?.colId === p.colId ? on.sort : null,
      cellRenderer: DataGridTemplateCellComponent, cellRendererParams: { tpl: tpl[p.colId] },
    }));
  });

  ngAfterViewInit(): void {
    if (typeof ResizeObserver === 'undefined') return;
    const el = this.host.nativeElement;
    this.zone.runOutsideAngular(() => {
      const ro = new ResizeObserver(entries => {
        const w = Math.round(entries[0]?.contentRect.width ?? el.clientWidth);
        if (w <= 0) return;
        if (this.foldFor(w) !== this.foldFor(this.width())) this.zone.run(() => this.width.set(w));
        else this.width.set(w);
      });
      ro.observe(el);
      this.destroyRef.onDestroy(() => ro.disconnect());
    });
  }

  // ── Row model (pure rules in my-work.grid.ts) ──
  private rules(): MwRules { return this.ctx().rules(); }
  tStatus(t: MwTube) { return tubeStatus(t, this.rules(), id => this.ctx().ownerName(id)); }
  gStatus(tubes: MwTube[]) { return groupStatus(tubes, this.rules(), id => this.ctx().ownerName(id)); }
  dStatus(d: MwDoneTube) { return doneStatus(d); }
  tPrimary(t: MwTube): MwAction | null { return tubePrimary(t, this.rules()); }
  gPrimary(tubes: MwTube[], open: boolean): MwAction | null { return groupPrimary(tubes, this.rules(), open); }
  dPrimary(d: MwDoneTube): MwAction | null { return donePrimary(d, this.rules()); }
  tMenu(t: MwTube): PfAction[] { return tubeMenu(t, this.rules()).map(a => ({ id: a.id, label: a.label, icon: ICON[a.id] })); }
  dMenu(d: MwDoneTube): PfAction[] { return doneMenu(d, this.rules()).map(a => ({ id: a.id, label: a.label, icon: ICON[a.id] })); }
  /** The row's clock: Due ("in 25m" / rose "12m late"), with the time in the lab as the sub-line. */
  tat(x: { remainingMin: number | null; dueAt: number | null }, lines: OrderTest[], done = false) {
    return { ...dueCell(x.remainingMin, { done }), sub: tatCell(x, lines, done).sub };
  }
  /** The shared duration words ("2d 4h", never "1364h 20m"). */
  waitWords(m: number): string { return durationText(m); }
  testsOf(lines: Array<{ test?: { name?: string } | null }>): string { return testNames(lines); }
  summary(lines: OrderTest[]): string { return testsSummary(lines); }

  /** The header sort on screen: starts from the saved key; a header click replaces it (the grid sorts itself). */
  private readonly picked = signal<{ mode: MwMode; sort: MwSortCol } | null>(null);
  readonly gridSort = computed<MwSortCol>(() => {
    const p = this.picked();
    return p && p.mode === this.mode() ? p.sort : sortColOf(this.mode(), this.sorts.keyFor(this.scope()));
  });
  /** A header click sorts the grid and saves the lab's sort key (persisted per user, same as the old picker). */
  onGridReady(e: GridReadyEvent<MwRow>): void {
    const sync = () => {
      const st = e.api.getColumnState().find(c => c.sort);
      const sort: MwSortCol = st ? { colId: st.colId, sort: st.sort as 'asc' | 'desc' } : null;
      const cur = this.gridSort();
      if (cur?.colId !== sort?.colId || cur?.sort !== sort?.sort) this.picked.set({ mode: this.mode(), sort });
      return sort;
    };
    // The screen's kept view state (view-state, restored by pf-data-grid before this runs) may have brought a sort
    // back — any column, Due / Status too: adopt it so the column defs keep it.
    if (e.api.getColumnState().some(c => c.sort)) sync();
    e.api.addEventListener('sortChanged', () => {
      const key = sortKeyOf(this.mode(), sync());
      if (key !== this.sorts.keyFor(this.scope())) this.sorts.set(this.scope(), key);
    });
  }

  metaJoin(...parts: Array<string | null | undefined>): string { return parts.filter(Boolean).join(' · '); }
  tubeAria(t: MwTube): string { return (this.rules().tab === 'service_queue' ? 'Pick tube ' : 'Open tube ') + (t.barcode || t.sampleId); }

  // ── Taps ──
  /** A tap on the row = the old tile tap; a control inside the row does its own thing. */
  onRow(e: RowClickedEvent<MwRow>): void {
    const t = e.event?.target as HTMLElement | null;
    if (t?.closest?.('button, a, input, [role="menu"], .pf-am-layer, .mwg-tubes')) return;
    if (e.data) this.tap(e.data, e.event ?? undefined);
  }
  onCard(row: MwRow, ev: Event): void {
    const t = ev.target as HTMLElement | null;
    if (t?.closest?.('button, a, [role="menu"], .pf-am-layer')) return;
    if (ev.type === 'keydown') ev.preventDefault();
    this.tap(row);
  }
  key(row: MwRow, ev: Event): void { ev.preventDefault(); ev.stopPropagation(); this.tap(row); }
  private tap(row: MwRow, ev?: Event): void {
    const c = this.ctx();
    if (row.kind === 'tube') c.activate(row.tube, row.tube.patientName, ev);
    else if (row.kind === 'patient') c.toggle(row.group.orderId);
    else if (row.kind === 'done') c.view(row.done);
  }
  run(a: MwAction, tube: MwTube | undefined, row: MwRow | null, name: string, ev: Event): void {
    ev.stopPropagation();
    const c = this.ctx();
    if (a.id === 'tubes' && row && row.kind === 'patient') { c.toggle(row.group.orderId); return; }
    if (tube && (a.id === 'enter' || a.id === 'pick')) c.activate(tube, name);
  }
  pickTube(id: string, tube: MwTube): void { if (id === 'delegate') this.ctx().delegate(tube.tests); }
  runDone(id: string, d: MwDoneTube, ev: Event): void { ev.stopPropagation(); this.pickDone(id, d); }
  pickDone(id: string, d: MwDoneTube): void {
    const c = this.ctx();
    if (id === 'print') c.print(d); else if (id === 'edit') void c.edit(d); else if (id === 'view') c.view(d);
  }
}
