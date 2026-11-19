import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal, untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDragMove, CdkDropList } from '@angular/cdk/drag-drop';
import { DialogService } from '../../core/services/dialog.service';
import { WORKAREA_ICONS, isLockedItem, isMandatoryItem, workAreaIconPath } from './wf-model';
import { Lane, LaneItem, areaDot, hintOf, iconOf, labelOf, lockReason, switchTip } from './workflow-editor';
import { WorkflowPage } from './workflow-page';
import { WfMenuComponent, WfMenuItem, WfMenuTriggerDirective, WfPortalDirective } from './wf-menu.component';

/** Narrow screens (phone, tablet portrait): the work-area list becomes a picker sheet. */
const NARROW_MQ = '(max-width: 900px)';
const PEEK_OPEN_MS = 320;
const PEEK_CLOSE_MS = 220;
const LONG_PRESS_MS = 480;

interface PeekState { areaId: string; top: number; left: number; sheet: boolean; }
type DragData = { itemId: string; from: 'main' | 'peek' };

/**
 * The workflow editor body (owner-approved layout A, 2026-11-19), in Test Master's frame:
 *  LEFT side card  — "Work areas": the navigation, in this order (drag to reorder; hover = peek; History, + Add).
 *  RIGHT main card — the selected area: who works here, its actions (full names + one-line hint, lock pill,
 *                    Move to, on/off), + Add action (unused actions), Warnings, branch "Changed for" + Reset.
 * Phone / tablet portrait: the list becomes a picker sheet; peek = long-press sheet. Nothing clickable at the bottom.
 * Shared file for file by the LMS Work steps page and the admin console's Master workflow (see wf-model.ts).
 */
@Component({
  selector: 'pf-wf-editor',
  standalone: true,
  imports: [NgTemplateOutlet, CdkDropList, CdkDrag, CdkDragHandle, WfMenuComponent, WfMenuTriggerDirective, WfPortalDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'wf-host', '[class.wf-host--narrow]': 'narrow()' },
  template: `
    <ng-template #grip>
      <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true"><circle cx="3" cy="3" r="1.4"/><circle cx="9" cy="3" r="1.4"/><circle cx="3" cy="8" r="1.4"/><circle cx="9" cy="8" r="1.4"/><circle cx="3" cy="13" r="1.4"/><circle cx="9" cy="13" r="1.4"/></svg>
    </ng-template>

    @if (page.loading()) {
      <div class="wf-grid" role="status" aria-busy="true" aria-label="Loading workflow…">
        @if (!narrow()) { <aside class="wf-card wf-skel"><span></span><span></span><span></span><span></span><span></span></aside> }
        <section class="wf-card wf-skel"><span></span><span></span><span></span><span></span></section>
      </div>
    } @else {
    @if (narrow()) {
      <!-- Phone / tablet portrait: the side list is a picker (sheet). -->
      <div class="wf-narrowbar">
        <button type="button" class="wf-areapick press" data-testid="wf-area-picker" (click)="sheetOpen.set(true)" aria-haspopup="dialog"
                [attr.aria-expanded]="sheetOpen()">
          @if (lane(); as l) { <span class="wf-dot" [style.background]="dotOf(l)"></span> }
          <span class="wf-areapick__t"><span class="wf-areapick__k">Work area</span><span class="wf-areapick__v">{{ lane()?.cat?.name }}</span></span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        <p class="wf-narrowstatus">{{ page.statusLine() }}</p>
      </div>
    }

    <div class="wf-grid">
      @if (!narrow()) {
        <aside class="wf-card wf-side" aria-label="Work areas" data-testid="wf-side">
<<<<<<< HEAD
          <header class="wf-head">
=======
          <header class="wf-head wf-head--side">
>>>>>>> pc/workflow-v2
            <span class="wf-head__icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg></span>
            <span class="wf-head__txt"><span class="wf-head__label">Work areas</span><span class="wf-head__note">The navigation, in this order</span></span>
            <button type="button" class="wf-btn wf-btn--ghost press" data-testid="wf-history" (click)="page.openHistory()" aria-haspopup="dialog" [attr.aria-expanded]="page.historyOpen()" title="Saved versions">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>
              History
            </button>
            <button type="button" class="wf-btn press" data-testid="wf-add-area" (click)="addArea()" title="Add a work area">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
              Add
            </button>
          </header>
          <div class="wf-side__body">
            <ng-container *ngTemplateOutlet="seeAsBanner"></ng-container>
            <ul class="wf-areas" cdkDropList id="wf-areas" [cdkDropListData]="page.lanes()" (cdkDropListDropped)="dropArea($event)"
                aria-label="Work areas — drag to reorder">
              <ng-container *ngTemplateOutlet="areaRows; context: { $implicit: false }"></ng-container>
            </ul>
          </div>
        </aside>
      }

      @if (lane(); as l) {
      <section class="wf-card wf-main" [attr.aria-label]="l.cat.name" data-testid="wf-main">
        <header class="wf-head wf-main__head" data-testid="wf-main-head">
          <span class="wf-head__icon wf-head__icon--area" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">@for (p of areaIcon(l); track $index) { <path [attr.d]="p" /> }</svg>
          </span>
          <span class="wf-head__label wf-main__name" data-testid="wf-area-name">{{ l.cat.name }}</span>
<<<<<<< HEAD
=======
          <span class="wf-head__note wf-main__note">{{ l.items.length }} {{ l.items.length === 1 ? 'action' : 'actions' }} · shown as “{{ l.cat.name }}” in the navigation</span>
>>>>>>> pc/workflow-v2
          @if (page.isChanged(l.cat.id)) {
            <span class="wf-changed" data-testid="wf-changed">Changed for {{ page.branchName(page.scope()) }}</span>
            <button type="button" class="wf-link press" data-testid="wf-reset" (click)="resetArea(l)">Reset to default</button>
          }
          <span class="wf-main__tools">
            @if (page.warnings().length) {
              <button type="button" class="wf-warnchip press" data-testid="wf-warnings" (click)="page.warningsOpen.set(!page.warningsOpen())"
                      [attr.aria-expanded]="page.warningsOpen()" aria-controls="wf-warnlist">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                Warnings <span class="wf-num">{{ page.warnings().length }}</span>
              </button>
            }
            <pf-wf-menu [items]="addActionItems()" heading="Add an action to {{ l.cat.name }}" empty="Every action is already in a work area"
                        testId="wf-add-action" (picked)="addAction(l, $event)">
              <button type="button" class="wf-btn wf-btn--accent press" wfMenuTrigger data-testid="wf-add-action">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                Add action
              </button>
            </pf-wf-menu>
            <pf-wf-menu [items]="areaMenuItems(l)" label="More for {{ l.cat.name }}" testId="wf-area-more" (picked)="areaMenu(l, $event)">
              <button type="button" class="wf-btn wf-btn--icon press" wfMenuTrigger data-testid="wf-area-more" [attr.aria-label]="'More for ' + l.cat.name">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>
              </button>
            </pf-wf-menu>
          </span>
        </header>

        @if (page.warningsOpen() && page.warnings().length) {
          <div class="wf-warnlist" id="wf-warnlist" role="region" aria-label="Warnings" data-testid="wf-warnlist">
            <p class="wf-warnlist__k">{{ page.warnings().length }} {{ page.warnings().length === 1 ? 'warning' : 'warnings' }} — pick “Show me” to go there.</p>
            <ul>
              @for (w of page.warnings(); track w.id; let i = $index) {
                <li class="wf-warn">
                  <span class="wf-warn__txt"><span class="wf-warn__t">{{ w.title }}</span><span class="wf-warn__d">{{ w.detail }}</span></span>
                  <button type="button" class="wf-link press" [attr.data-testid]="'wf-showme-' + i" (click)="showMe(w)">Show me</button>
                </li>
              }
            </ul>
          </div>
        }

        <div class="wf-main__body" #mainBody>
          <div class="wf-who" id="wf-who" [class.wf-flash]="page.flashId() === 'who'" data-testid="wf-who">
            <div class="wf-who__l">
              <div class="wf-rowlabel">Who works here</div>
              <div class="wf-rowhint">The roles that work in {{ l.cat.name }}</div>
            </div>
            <div class="wf-who__chips">
              @for (r of l.cat.roles ?? []; track r) {
                <span class="wf-role" [class.wf-role--seeas]="page.seeAs() === r" [attr.data-role]="r">
                  {{ r }}
                  <button type="button" class="wf-role__x press" [attr.aria-label]="'Remove ' + r + ' from ' + l.cat.name" (click)="page.editor.removeRole(l.cat.id, r)">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                  </button>
                </span>
              } @empty {
                <span class="wf-role wf-role--none">No role chosen</span>
              }
              <pf-wf-menu [items]="addRoleItems(l)" heading="Add a role to {{ l.cat.name }}" empty="Every role is already here" testId="wf-add-role"
                          align="end" (picked)="page.editor.addRole(l.cat.id, $event)">
                <button type="button" class="wf-role wf-role--add press" wfMenuTrigger data-testid="wf-add-role">+ Add role</button>
              </pf-wf-menu>
            </div>
          </div>

          <div class="wf-acthead">
            <span class="wf-acthead__k">Actions in this area</span>
            <span class="wf-acthead__n">drag to reorder · switch off to hide without removing</span>
          </div>

          <div class="wf-acts" cdkDropList id="wf-main" [cdkDropListData]="l.items" (cdkDropListDropped)="dropMain($event)"
               [attr.aria-label]="'Actions in ' + l.cat.name" data-testid="wf-actions">
            @for (it of l.items; track it.id; let i = $index) {
              <div class="wf-act" cdkDrag [cdkDragData]="dragData(it.id, 'main')" [cdkDragDisabled]="locked(it, l) || narrow()"
                   (cdkDragStarted)="dragStart()" (cdkDragMoved)="dragMove($event)" (cdkDragEnded)="dragEnd()"
                   [class.wf-act--off]="!it.enabled" [class.wf-act--locked]="locked(it, l)" [class.wf-flash]="page.flashId() === it.id"
                   [attr.data-item-id]="it.id" [attr.data-type]="it.type">
                <span class="wf-grip" cdkDragHandle [class.wf-grip--off]="locked(it, l)" aria-hidden="true"><ng-container *ngTemplateOutlet="grip"></ng-container></span>
                <span class="wf-act__ic" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">@for (p of icon(it.type); track $index) { <path [attr.d]="p" /> }</svg></span>
                <span class="wf-act__txt">
                  <span class="wf-act__name">{{ label(it) }}</span>
                  @if (hint(it.type)) { <span class="wf-act__hint">{{ hint(it.type) }}</span> }
                </span>
                @if (locked(it, l)) {
                  <span class="wf-lock" data-testid="wf-lock">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
                    {{ lockText(it, l) }}
                  </span>
                } @else {
                  <pf-wf-menu [items]="moveItems(l)" heading="Move {{ label(it) }} to…" testId="wf-move" (picked)="moveMenu(it, l, $event)">
                    <button type="button" class="wf-btn wf-btn--ghost wf-move press" wfMenuTrigger [attr.data-testid]="'wf-move-' + it.type"
                            [attr.aria-label]="'Move ' + label(it) + ' to another work area'">
                      Move to
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                    </button>
                  </pf-wf-menu>
                }
                <button type="button" class="wf-switch press" role="switch" [attr.aria-checked]="it.enabled" [disabled]="mandatory(it, l)"
                        [attr.aria-label]="label(it) + ' in ' + l.cat.name" [title]="tip(it, l)" [attr.data-testid]="'wf-switch-' + it.type"
                        (click)="page.editor.toggleItem(l.cat.id, it.id)"><span class="wf-switch__knob" aria-hidden="true"></span></button>
              </div>
            } @empty {
              <p class="wf-empty">No actions yet — use “Add action”, or drag one here from another work area.</p>
            }
          </div>
        </div>
      </section>
      }
    </div>
    }

    <!-- The work-area rows (side card and phone sheet share them). -->
    <ng-template #areaRows let-inSheet>
      @for (a of page.lanes(); track a.cat.id; let i = $index) {
        <li class="wf-arealist__li" cdkDrag [cdkDragData]="a.cat.id" [cdkDragDisabled]="inSheet">
          <button type="button" class="wf-area press" [attr.data-area-id]="a.cat.id" [attr.data-testid]="'wf-area-' + a.cat.id"
                  [class.is-on]="a.cat.id === lane()?.cat?.id" [class.is-dim]="!page.visibleFor(a)" [class.is-target]="dropTarget() === a.cat.id"
                  [class.wf-flash]="page.flashId() === 'area:' + a.cat.id" [attr.aria-current]="a.cat.id === lane()?.cat?.id ? 'true' : null"
                  (click)="pick(a.cat.id, inSheet)" (mouseenter)="peekEnter(a, $event)" (mouseleave)="peekLeave()"
                  (focus)="peekLeave()" (pointerdown)="pressStart(a, $event, inSheet)" (pointerup)="pressEnd()" (pointercancel)="pressEnd()"
                  (pointermove)="pressMove($event)" (contextmenu)="$event.preventDefault()">
            @if (!inSheet) { <span class="wf-grip" cdkDragHandle aria-hidden="true" (click)="$event.stopPropagation()"><ng-container *ngTemplateOutlet="grip"></ng-container></span> }
            <span class="wf-dot" [style.background]="dotOf(a)" aria-hidden="true"></span>
            <span class="wf-area__txt">
              <span class="wf-area__name">{{ a.cat.name }}</span>
              <span class="wf-area__note" [class.wf-area__note--changed]="page.isChanged(a.cat.id)">{{ areaNote(a) }}</span>
            </span>
            <span class="wf-count" [attr.aria-label]="a.items.length + ' actions'">{{ a.items.length }}</span>
          </button>
        </li>
      }
    </ng-template>

    <ng-template #seeAsBanner>
      @if (page.seeAs()) {
        <div class="wf-seeas" role="status" data-testid="wf-seeas">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
          <span class="wf-seeas__t">Seeing as <b>{{ page.seeAs() }}</b>: {{ page.seeAsCount() }} of {{ page.lanes().length }} areas</span>
          <button type="button" class="wf-link press" data-testid="wf-seeas-stop" (click)="page.seeAs.set('')">Stop</button>
        </div>
      }
    </ng-template>

    <!-- Hover peek (long-press sheet on touch). -->
    @if (peek(); as pk) {
      @if (peekLane(); as pl) {
        <div wfPortal class="wf-peek-layer" [class.wf-peek-layer--sheet]="pk.sheet">
          @if (pk.sheet) { <div class="wf-peek-backdrop" aria-hidden="true" (click)="closePeek()"></div> }
          <div class="wf-peek" role="dialog" [attr.aria-label]="pl.cat.name + ' — what is inside'" data-testid="wf-peek"
<<<<<<< HEAD
               [class.wf-peek--sheet]="pk.sheet" [style.top.px]="pk.sheet ? null : pk.top" [style.left.px]="pk.sheet ? null : pk.left"
=======
               [class.wf-peek--sheet]="pk.sheet" [class.wf-peek--dragging]="peekDragging()" [style.top.px]="pk.sheet ? null : pk.top" [style.left.px]="pk.sheet ? null : pk.left"
>>>>>>> pc/workflow-v2
               (mouseenter)="peekHold()" (mouseleave)="peekLeave()" (keydown.escape)="closePeek()">
            <div class="wf-peek__head">
              <span class="wf-dot" [style.background]="dotOf(pl)" aria-hidden="true"></span>
              <span class="wf-peek__title"><span class="wf-head__label">{{ pl.cat.name }}</span>
                <span class="wf-peek__roles">{{ (pl.cat.roles ?? []).length ? (pl.cat.roles ?? []).join(', ') : 'No role chosen' }}</span></span>
              @if (pk.sheet) {
                <button type="button" class="wf-btn wf-btn--icon press" aria-label="Close" (click)="closePeek()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
              } @else { <span class="wf-peek__tag">peek</span> }
            </div>
            <div class="wf-peek__show">
              <span>Show {{ pl.cat.name }} in the navigation</span>
              <button type="button" class="wf-switch press" role="switch" [attr.aria-checked]="page.editor.areaShown(pl.cat.id)" data-testid="wf-peek-show"
                      [disabled]="page.editor.areaShown(pl.cat.id) && !page.editor.canHideArea(pl.cat.id)"
                      [attr.aria-label]="'Show ' + pl.cat.name + ' in the navigation'"
                      (click)="page.editor.setAreaShown(pl.cat.id, !page.editor.areaShown(pl.cat.id))"><span class="wf-switch__knob" aria-hidden="true"></span></button>
            </div>
            <div class="wf-peek__list" cdkDropList id="wf-peek" [cdkDropListData]="pl.items" [cdkDropListConnectedTo]="['wf-main']"
                 [cdkDropListSortingDisabled]="true" (cdkDropListDropped)="dropPeek($event)">
              @for (it of pl.items; track it.id) {
                <div class="wf-peek__row" cdkDrag [cdkDragData]="dragData(it.id, 'peek')" [cdkDragDisabled]="locked(it, pl) || pk.sheet"
                     (cdkDragStarted)="dragStart(true)" (cdkDragMoved)="dragMove($event)" (cdkDragEnded)="dragEnd()"
                     [class.wf-peek__row--locked]="locked(it, pl)" [attr.data-type]="it.type">
                  <span class="wf-grip" [class.wf-grip--off]="locked(it, pl)" aria-hidden="true"><ng-container *ngTemplateOutlet="grip"></ng-container></span>
                  <span class="wf-peek__name">{{ label(it) }}</span>
                  @if (locked(it, pl)) {
                    <svg class="wf-peek__lock" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-label="Stays in this area" role="img"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
                  } @else if (pk.sheet && lane() && lane()!.cat.id !== pl.cat.id) {
                    <button type="button" class="wf-link press" (click)="moveHere(it)">Move to {{ lane()!.cat.name }}</button>
                  }
                  <button type="button" class="wf-switch wf-switch--sm press" role="switch" [attr.aria-checked]="it.enabled" [disabled]="mandatory(it, pl)"
                          [attr.aria-label]="label(it) + ' in ' + pl.cat.name" (click)="page.editor.toggleItem(pl.cat.id, it.id)"><span class="wf-switch__knob" aria-hidden="true"></span></button>
                </div>
              } @empty { <p class="wf-empty">No actions in {{ pl.cat.name }}.</p> }
            </div>
            @if (!pk.sheet) {
              <p class="wf-peek__note">Drag an action into {{ lane()?.cat?.name }}’s list or onto another work area. Hold Alt (Option) to copy.</p>
            }
          </div>
        </div>
      }
    }

    <!-- Phone / tablet portrait: work areas sheet. -->
    @if (narrow() && sheetOpen()) {
      <div wfPortal class="wf-peek-layer wf-peek-layer--sheet">
        <div class="wf-peek-backdrop" aria-hidden="true" (click)="sheetOpen.set(false)"></div>
        <div class="wf-peek wf-peek--sheet wf-areasheet" role="dialog" aria-label="Work areas" data-testid="wf-area-sheet" (keydown.escape)="sheetOpen.set(false)">
          <div class="wf-peek__head">
            <span class="wf-peek__title"><span class="wf-head__label">Work areas</span><span class="wf-peek__roles">The navigation, in this order · hold one to peek</span></span>
            <button type="button" class="wf-btn wf-btn--ghost press" (click)="sheetOpen.set(false); page.openHistory()">History</button>
            <button type="button" class="wf-btn press" (click)="sheetOpen.set(false); addArea()">+ Add</button>
            <button type="button" class="wf-btn wf-btn--icon press" aria-label="Close" (click)="sheetOpen.set(false)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
          </div>
          <ng-container *ngTemplateOutlet="seeAsBanner"></ng-container>
          <ul class="wf-areas wf-areas--sheet"><ng-container *ngTemplateOutlet="areaRows; context: { $implicit: true }"></ng-container></ul>
        </div>
      </div>
    }

    <!-- History (saved versions). -->
    @if (page.historyOpen()) {
      <div wfPortal class="wf-peek-layer wf-peek-layer--sheet wf-hist-layer">
        <div class="wf-peek-backdrop" aria-hidden="true" (click)="page.historyOpen.set(false)"></div>
        <div class="wf-peek wf-hist" role="dialog" aria-label="History — saved versions" data-testid="wf-history-panel" (keydown.escape)="page.historyOpen.set(false)">
          <div class="wf-peek__head">
            <span class="wf-peek__title"><span class="wf-head__label">History</span><span class="wf-peek__roles">Saved versions of {{ page.editor.savedName() || 'this workflow' }}</span></span>
            <button type="button" class="wf-btn wf-btn--icon press" aria-label="Close history" data-testid="wf-history-close" (click)="page.historyOpen.set(false)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
          </div>
          <div class="wf-hist__list">
            @if (page.historyLoading()) {
              <p class="wf-empty">Loading saved versions…</p>
            } @else {
              @for (v of page.history() ?? []; track v.id; let first = $first) {
                <div class="wf-hist__row" data-testid="wf-version">
                  <span class="wf-hist__txt">
                    <span class="wf-hist__t">{{ v.kind === 'baseline' ? 'Before history was kept' : 'Version ' + v.version }}@if (first && v.kind !== 'baseline') { <span class="wf-hist__now">· saved now</span> }</span>
                    <span class="wf-hist__d">{{ when(v.at) }}@if (v.by) { · {{ v.by }} } · {{ v.name }}</span>
                  </span>
                  <button type="button" class="wf-btn press" [attr.data-testid]="'wf-restore-' + v.version" [disabled]="first && v.kind !== 'baseline' && !page.dirty()" (click)="page.restore(v)">Restore</button>
                </div>
              } @empty {
                <p class="wf-empty">{{ page.currentId() ? 'No saved versions yet — every Save from now on is kept here.' : 'This draft has not been saved yet.' }}</p>
              }
            }
          </div>
        </div>
      </div>
    }

    <!-- Icon picker (area options → Change icon). -->
    @if (iconFor(); as areaId) {
      <div wfPortal class="wf-peek-layer wf-peek-layer--sheet">
        <div class="wf-peek-backdrop" aria-hidden="true" (click)="iconFor.set(null)"></div>
        <div class="wf-peek wf-hist" role="dialog" aria-label="Choose an icon" (keydown.escape)="iconFor.set(null)">
          <div class="wf-peek__head">
            <span class="wf-peek__title"><span class="wf-head__label">Icon</span><span class="wf-peek__roles">Shown in the navigation</span></span>
            <button type="button" class="wf-btn wf-btn--icon press" aria-label="Close" (click)="iconFor.set(null)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
          </div>
          <div class="wf-icons">
            @for (ic of icons; track ic.key) {
              <button type="button" class="wf-iconopt press" [attr.aria-pressed]="page.editor.lane(areaId)?.cat?.icon === ic.key" [attr.aria-label]="ic.label" [title]="ic.label"
                      (click)="page.editor.setAreaIcon(areaId, ic.key); iconFor.set(null)">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">@for (p of ic.path; track $index) { <path [attr.d]="p" /> }</svg>
              </button>
            }
          </div>
        </div>
      </div>
    }
  `,
  styleUrl: './workflow-editor.component.scss',
})
export class WorkflowEditorComponent {
  protected readonly page = inject(WorkflowPage);
  private readonly dialog = inject(DialogService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly icons = WORKAREA_ICONS;

  readonly narrow = signal(false);
  readonly sheetOpen = signal(false);
  readonly peek = signal<PeekState | null>(null);
  readonly iconFor = signal<string | null>(null);
  readonly dropTarget = signal<string | null>(null);
<<<<<<< HEAD
=======
  /** An action is being carried out of the peek: the peek fades and lets the list under it take the drop. */
  readonly peekDragging = signal(false);
>>>>>>> pc/workflow-v2
  private dragging = false;
  private peekPinned = false;
  private altHeld = false;
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private pressTimer: ReturnType<typeof setTimeout> | null = null;
  private pressAt: { x: number; y: number } | null = null;
  private suppressClick = false;

  readonly lane = computed<Lane | null>(() => this.page.selectedLane());
  readonly peekLane = computed<Lane | null>(() => this.page.lanes().find(l => l.cat.id === this.peek()?.areaId) ?? null);

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      const mq = window.matchMedia?.(NARROW_MQ);
      if (mq) {
        this.narrow.set(mq.matches);
        const on = (e: MediaQueryListEvent) => this.narrow.set(e.matches);
        mq.addEventListener?.('change', on);
        destroy.onDestroy(() => mq.removeEventListener?.('change', on));
      }
      const key = (e: KeyboardEvent) => { this.altHeld = e.altKey; };
      window.addEventListener('keydown', key, true);
      window.addEventListener('keyup', key, true);
      destroy.onDestroy(() => { window.removeEventListener('keydown', key, true); window.removeEventListener('keyup', key, true); });
    });
    destroy.onDestroy(() => this.clearTimers());
    // A warning / search jump: bring the lit row into view inside the card body (never scroll before it exists).
    effect(() => {
      const id = this.page.flashId();
      if (!id) return;
      untracked(() => setTimeout(() => {
        const sel = id === 'who' ? '#wf-who' : id.startsWith('area:') ? `[data-area-id="${id.slice(5)}"]` : `[data-item-id="${id}"]`;
        const el = this.host.nativeElement.querySelector<HTMLElement>(sel);
        el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      }, 60));
    });
  }

  // ── Display ──
  label(it: LaneItem): string { return labelOf(it); }
  hint(type: string): string { return hintOf(type); }
  icon(type: string): string[] { return iconOf(type); }
  areaIcon(l: Lane): string[] { return workAreaIconPath(l.cat.icon); }
  dotOf(l: Lane): string { return areaDot(this.page.lanes().indexOf(l)); }
  locked(it: LaneItem, l: Lane): boolean { return isLockedItem(it.type, l.cat.id); }
  mandatory(it: LaneItem, l: Lane): boolean { return isMandatoryItem(it.type, l.cat.id); }
  lockText(it: LaneItem, l: Lane): string { return lockReason(it.type, l.cat.name); }
  tip(it: LaneItem, l: Lane): string { return switchTip(it.type, l.cat.id, it.enabled); }
  dragData(itemId: string, from: 'main' | 'peek'): DragData { return { itemId, from }; }

  areaNote(a: Lane): string {
    if (this.page.isChanged(a.cat.id)) return `Changed for ${this.page.branchName(this.page.scope())}`;
    const r = this.page.seeAs();
    if (r) return this.page.visibleFor(a) ? `${r} sees this` : `Hidden for ${r}`;
    if (!a.items.some(i => i.enabled)) return 'Not in the navigation';
    const roles = a.cat.roles ?? [];
    return roles.length ? (roles.length === 1 ? roles[0] : `${roles.length} roles`) : 'No role chosen';
  }

  when(at: string): string {
    const d = new Date(at);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  // ── Menus ──
  readonly addActionItems = computed<WfMenuItem[]>(() =>
    this.page.editor.unused().map(a => ({ id: a.type, label: a.label, hint: a.hint, icon: a.iconPath })));

  addRoleItems(l: Lane): WfMenuItem[] {
    const have = new Set(l.cat.roles ?? []);
    return this.page.roles().filter(r => !have.has(r)).map(r => ({ id: r, label: r }));
  }

  moveItems(l: Lane): WfMenuItem[] {
    const areas = this.page.lanes().filter(x => x.cat.id !== l.cat.id)
      .map(x => ({ id: 'area:' + x.cat.id, label: x.cat.name, dot: this.dotOf(x), group: 'Move to' }));
    const copies = this.page.lanes().filter(x => x.cat.id !== l.cat.id)
      .map(x => ({ id: 'copy:' + x.cat.id, label: `Also show in ${x.cat.name}`, dot: this.dotOf(x), group: 'Copy to' }));
    return [...areas, ...copies, { id: 'remove', label: 'Take out of the navigation', hint: 'It waits in Add action', group: ' ' }];
  }

  areaMenuItems(l: Lane): WfMenuItem[] {
    const i = this.page.lanes().indexOf(l);
    return [
      { id: 'rename', label: 'Rename' },
      { id: 'icon', label: 'Change icon' },
      { id: 'up', label: 'Move up in the navigation', disabled: i <= 0 },
      { id: 'down', label: 'Move down in the navigation', disabled: i >= this.page.lanes().length - 1 },
      { id: 'delete', label: 'Remove this work area', hint: 'Its actions wait in Add action', group: ' ',
        disabled: l.items.some(it => isLockedItem(it.type, l.cat.id)) },
    ];
  }

  async areaMenu(l: Lane, id: string): Promise<void> {
    const i = this.page.lanes().indexOf(l);
    if (id === 'rename') {
      const name = await this.dialog.prompt({ title: 'Rename work area', message: 'This is the name in the navigation.', initialValue: l.cat.name, placeholder: 'Work area name', confirmLabel: 'Rename', required: true });
      if (name?.trim()) this.page.editor.renameArea(l.cat.id, name);
    } else if (id === 'icon') this.iconFor.set(l.cat.id);
    else if (id === 'up') this.page.editor.moveArea(i, i - 1);
    else if (id === 'down') this.page.editor.moveArea(i, i + 1);
    else if (id === 'delete') {
      const ok = await this.dialog.confirm({ title: `Remove ${l.cat.name}?`, message: 'It leaves the navigation when you Save. Its actions wait in “Add action”.', confirmLabel: 'Remove', tone: 'danger' });
      if (ok && this.page.editor.deleteArea(l.cat.id)) this.page.selectedAreaId.set(this.page.lanes()[Math.max(0, i - 1)]?.cat.id ?? null);
    }
  }

  async addArea(): Promise<void> {
    const name = await this.dialog.prompt({ title: 'New work area', message: 'Its name becomes a place in the navigation.', placeholder: 'Work area name', confirmLabel: 'Add', required: true });
    if (!name?.trim()) return;
    const id = this.page.editor.addArea(name.trim());
    this.page.selectedAreaId.set(id);
  }

  addAction(l: Lane, type: string): void {
    const id = this.page.editor.addAction(l.cat.id, type);
    if (id) this.page.flash(id);
  }

  moveMenu(it: LaneItem, l: Lane, id: string): void {
    if (id === 'remove') { this.page.editor.removeItem(it.id); return; }
    const [kind, area] = id.split(':');
    if (this.page.editor.moveItem(it.id, area, undefined, kind === 'copy')) {
      const to = this.page.editor.lane(area);
      if (to && kind === 'area') this.flashRow(to, it.type);
    }
  }

  private flashRow(to: Lane, type: string): void {
    const item = this.page.editor.lane(to.cat.id)?.items.filter(i => i.type === type).pop();
    this.page.flash('area:' + to.cat.id);
    if (item && this.page.selectedAreaId() === to.cat.id) this.page.flash(item.id);
  }

  async resetArea(l: Lane): Promise<void> {
    const inDefault = this.page.defaultLanes().some(b => b.cat.id === l.cat.id);
    const ok = await this.dialog.confirm({
      title: `Reset ${l.cat.name} to the default?`,
      message: inDefault
        ? `${l.cat.name} becomes exactly as in All branches. You can still Discard before you Save.`
        : `All branches has no ${l.cat.name}, so it is removed from ${this.page.branchName(this.page.scope())}. You can still Discard before you Save.`,
      confirmLabel: 'Reset', tone: 'primary',
    });
    if (ok) this.page.editor.resetArea(l.cat.id, this.page.defaultLanes());
  }

  showMe(w: Parameters<WorkflowPage['showMe']>[0]): void { this.page.showMe(w); }

  pick(areaId: string, inSheet: boolean): void {
    if (this.suppressClick) { this.suppressClick = false; return; }
    this.page.selectedAreaId.set(areaId);
    this.closePeek();
    if (inSheet) this.sheetOpen.set(false);
  }

  // ── Drag and drop ──
  dropArea(e: CdkDragDrop<Lane[]>): void { this.page.editor.moveArea(e.previousIndex, e.currentIndex); }

  dropMain(e: CdkDragDrop<LaneItem[], unknown, DragData>): void {
    const l = this.lane(); if (!l) return;
    const copy = this.copyKey(e);
    if (e.previousContainer.id === 'wf-peek') {
      if (this.page.editor.moveItem(e.item.data.itemId, l.cat.id, e.currentIndex, copy)) this.page.flash(this.page.editor.lane(l.cat.id)?.items[e.currentIndex]?.id ?? null);
    } else if (e.isPointerOverContainer) {
      this.page.editor.reorderItems(l.cat.id, e.previousIndex, e.currentIndex);
    } else {
      this.dropOnArea(e.item.data.itemId, e.dropPoint, copy);
    }
    this.finishDrag();
  }

  dropPeek(e: CdkDragDrop<LaneItem[], unknown, DragData>): void {
    if (!e.isPointerOverContainer) this.dropOnArea(e.item.data.itemId, e.dropPoint, this.copyKey(e));
    this.finishDrag();
  }

  /** An action dropped on a work-area row in the left list → it moves (Alt = copies) to the end of that area. */
  private dropOnArea(itemId: string, pt: { x: number; y: number }, copy: boolean): void {
    const areaId = this.areaAt(pt.x, pt.y);
    if (!areaId) return;
    const from = this.page.editor.areaOf(itemId);
    if (from?.cat.id === areaId && !copy) return;
    const type = from?.items.find(i => i.id === itemId)?.type;
    if (this.page.editor.moveItem(itemId, areaId, undefined, copy) && type) {
      const to = this.page.editor.lane(areaId);
      if (to) this.flashRow(to, type);
    }
  }

  private areaAt(x: number, y: number): string | null {
    if (typeof document === 'undefined') return null;
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    return el?.closest<HTMLElement>('[data-area-id]')?.dataset['areaId'] ?? null;
  }

  private copyKey(e: { event?: unknown }): boolean {
    const ev = e.event as { altKey?: boolean } | undefined;
    return !!ev?.altKey || this.altHeld;
  }

  dragStart(fromPeek = false): void {
    this.dragging = true;
<<<<<<< HEAD
    if (fromPeek) this.peekPinned = true;
=======
    if (fromPeek) { this.peekPinned = true; this.peekDragging.set(true); }
>>>>>>> pc/workflow-v2
    this.cancelOpen();
  }
  dragMove(e: CdkDragMove<DragData>): void {
    const id = this.areaAt(e.pointerPosition.x, e.pointerPosition.y);
    const from = this.page.editor.areaOf(e.source.data.itemId)?.cat.id;
    this.dropTarget.set(id && id !== from ? id : null);
  }
  dragEnd(): void { setTimeout(() => this.finishDrag(), 0); }
  private finishDrag(): void {
    this.dragging = false;
<<<<<<< HEAD
=======
    this.peekDragging.set(false);
>>>>>>> pc/workflow-v2
    this.dropTarget.set(null);
    if (this.peekPinned) { this.peekPinned = false; this.closePeek(); }
  }

  /** Keyboard / sheet equivalent of dragging out of the peek. */
  moveHere(it: LaneItem): void {
    const l = this.lane(); if (!l) return;
    if (this.page.editor.moveItem(it.id, l.cat.id)) this.flashRow(l, it.type);
  }

  // ── Peek (hover; long-press on touch) ──
  peekEnter(a: Lane, ev: MouseEvent): void {
    if (this.dragging || this.narrow()) return;
    if (this.closeTimer) { clearTimeout(this.closeTimer); this.closeTimer = null; }
    if (a.cat.id === this.lane()?.cat.id) { if (!this.peekPinned) this.schedulePeekClose(); return; }
    const row = ev.currentTarget as HTMLElement;
    this.cancelOpen();
    this.openTimer = setTimeout(() => this.openPeek(a.cat.id, row, false), this.peek() ? 60 : PEEK_OPEN_MS);
  }
  peekHold(): void { if (this.closeTimer) { clearTimeout(this.closeTimer); this.closeTimer = null; } }
  peekLeave(): void { this.cancelOpen(); if (this.peek() && !this.peek()!.sheet && !this.peekPinned) this.schedulePeekClose(); }
  private schedulePeekClose(): void {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => { if (!this.peekPinned && !this.dragging) this.peek.set(null); }, PEEK_CLOSE_MS);
  }
  closePeek(): void { this.cancelOpen(); this.peekPinned = false; this.peek.set(null); }
  private cancelOpen(): void { if (this.openTimer) { clearTimeout(this.openTimer); this.openTimer = null; } }

  private openPeek(areaId: string, row: HTMLElement, sheet: boolean): void {
    if (sheet || typeof window === 'undefined') { this.peek.set({ areaId, top: 0, left: 0, sheet: true }); return; }
    const r = row.getBoundingClientRect();
    const w = 340, h = 380;
    let left = r.right + 10;
    if (left + w > window.innerWidth - 8) left = Math.max(8, r.left - w - 10);
    const top = Math.max(8, Math.min(r.top - 8, window.innerHeight - h - 8));
    this.peek.set({ areaId, top, left, sheet: false });
  }

  pressStart(a: Lane, e: PointerEvent, inSheet: boolean): void {
    if (e.pointerType === 'mouse') return;
    this.pressAt = { x: e.clientX, y: e.clientY };
    const row = e.currentTarget as HTMLElement;
    if (this.pressTimer) clearTimeout(this.pressTimer);
    this.pressTimer = setTimeout(() => {
      this.suppressClick = true;
      if (inSheet) this.sheetOpen.set(false);
      this.openPeek(a.cat.id, row, true);
    }, LONG_PRESS_MS);
  }
  pressMove(e: PointerEvent): void {
    if (!this.pressAt) return;
    if (Math.abs(e.clientX - this.pressAt.x) > 8 || Math.abs(e.clientY - this.pressAt.y) > 8) this.pressEnd();
  }
  pressEnd(): void { if (this.pressTimer) { clearTimeout(this.pressTimer); this.pressTimer = null; } this.pressAt = null; }

  private clearTimers(): void { this.cancelOpen(); this.pressEnd(); if (this.closeTimer) clearTimeout(this.closeTimer); }
}
