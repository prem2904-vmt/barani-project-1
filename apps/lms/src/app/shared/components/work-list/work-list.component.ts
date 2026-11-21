import { ChangeDetectionStrategy, Component, TemplateRef, ViewEncapsulation, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActionsMenuComponent } from '../actions-menu/actions-menu.component';
import { DailyNoComponent } from '../daily-no/daily-no.component';
import { BusyDirective } from '../../directives/busy.directive';
import { SkeletonComponent } from '../../primitives/skeleton.component';
import { StatusWordsComponent } from '../status-words/status-words.component';
import type { StatusWords } from '../../utils/status-words';
import { WorkListItem, WorkListStatus, factsLine, statusLine } from './work-list';

/**
 * `<pf-work-list>` — the ONE list every work screen draws below 1024px (see work-list.ts). Divider rows, never boxed
 * cards; a row tap emits `(open)`; the right edge carries the ONE primary (≥44px) + ⋯ (or the screen's own
 * `[actionTpl]`, e.g. the Outsourced upload control). Classes are global (`pf-wl…`, encapsulation None) so the
 * screens specs and a host's head can find them. Colours are theme tokens only.
 */
@Component({
  selector: 'pf-work-list',
  standalone: true,
  imports: [NgTemplateOutlet, StatusWordsComponent, ActionsMenuComponent, DailyNoComponent, BusyDirective, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { class: 'pf-wl' },
  template: `
    @if (loading() && !items().length) {
      <ul class="pf-wl__list" aria-busy="true" [attr.aria-label]="label()">
        @for (i of [0, 1, 2, 3]; track i) {
          <li class="pf-wl__row pf-wl__row--skel">
            <span class="pf-wl__main">
              <pf-skeleton variant="line" width="55%"></pf-skeleton>
              <pf-skeleton variant="line" width="80%" height="10px"></pf-skeleton>
              <pf-skeleton variant="line" width="40%" height="10px"></pf-skeleton>
            </span>
            <span class="pf-wl__act"><pf-skeleton variant="block" width="96px" height="44px"></pf-skeleton></span>
          </li>
        }
      </ul>
    } @else if (!items().length) {
      <div class="pf-wl__empty pf-empty" role="status">
        <p class="pf-empty__title">{{ emptyTitle() }}</p>
        @if (emptyBody()) { <p class="pf-empty__body">{{ emptyBody() }}</p> }
      </div>
    } @else {
      <ul class="pf-wl__list" [attr.aria-label]="label()">
        @for (it of items(); track it.id) {
          <li class="pf-wl__row" [class.pf-wl__row--sub]="it.sub" [class.pf-wl__row--on]="it.selected"
              [attr.data-id]="it.id" [attr.data-key]="it.key ?? null" [attr.data-noact]="it.noAction ? '' : null" [attr.data-tone]="it.status?.tone ?? 'normal'">
            <span class="pf-wl__main" role="button" tabindex="0" [attr.aria-label]="it.aria || it.name"
                  (click)="open.emit(it)" (keydown.enter)="open.emit(it)" (keydown.space)="$event.preventDefault(); open.emit(it)">
              <span class="pf-wl__l1">
                @if (it.lead) { <span class="pf-wl__lead pf-num">{{ it.lead }}</span> }
                <span class="pf-wl__name">@if (it.daily) { <pf-daily-no [of]="it.daily" /> } @else if (it.token) { <span class="pf-wl__token pf-num">{{ it.token }}</span> }{{ it.name }}</span>
                @if (it.urgent) { <span class="pf-wl__urgent">Urgent</span> }
              </span>
              @if (facts(it); as f) { <span class="pf-wl__l2">{{ f }}</span> }
              @for (n of it.notes ?? []; track $index) { <span class="pf-wl__note">{{ n }}</span> }
              @if (it.status || it.time) {
                <span class="pf-wl__l3">
                  @if (it.status; as st) { <pf-status-words class="pf-wl__status" [words]="words(st)" /> } @else { <span class="pf-wl__status"></span> }
                  @if (it.time) { <span class="pf-wl__time pf-num" [class.pf-wl__time--late]="it.time.late" [attr.title]="it.time.title || null">{{ it.time.text }}</span> }
                </span>
              }
            </span>
            <span class="pf-wl__act">
              @if (actionTpl(); as tpl) {
                <ng-container [ngTemplateOutlet]="tpl" [ngTemplateOutletContext]="{ $implicit: it }" />
              } @else {
                @if (it.primary; as p) {
                  <button type="button" class="pf-rowact pf-wl__primary press" [disabled]="p.disabled || p.busy"
                          [pfBusy]="!!p.busy" [pfBusyLabel]="p.busyLabel || p.label" [attr.aria-label]="p.aria || null"
                          (click)="primary.emit(it)">{{ p.label }}</button>
                }
                @if (it.more?.length) {
                  <pf-actions-menu [actions]="it.more!" triggerClass="pf-rowact pf-rowact--icon pf-wl__more"
                                   [label]="'More for ' + it.name" [heading]="it.name" (action)="action.emit({ item: it, id: $event })" />
                }
              }
            </span>
          </li>
        }
      </ul>
    }
  `,
  styles: [`
    .pf-wl { display: block; min-width: 0; }
    .pf-wl__list { list-style: none; margin: 0; padding: 0; }
    .pf-wl__row {
      display: flex; align-items: center; gap: 8px 12px; min-height: 64px; padding: 10px 4px 10px 12px;
      border-bottom: 1px solid var(--pf-line, var(--glass-border));
    }
    .pf-wl__row:last-child { border-bottom: 0; }
    .pf-wl__row--sub { padding-left: 32px; }
    .pf-wl__row--on { background: var(--pf-sel-bg, color-mix(in srgb, var(--color-primary, #7c3aed) 8%, transparent)); }
    .pf-wl__main {
      flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; cursor: pointer; outline: none;
      border-radius: var(--pf-radius-sm, 8px);
    }
    .pf-wl__main:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .pf-wl__l1 { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; min-width: 0; }
    .pf-wl__name {
      min-width: 0; font-size: 15px; font-weight: 600; line-height: 1.3; color: var(--text-primary);
      white-space: normal; overflow-wrap: break-word; word-break: normal;
    }
    .pf-wl__lead { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
    .pf-wl__token { margin-right: 6px; font-size: 12px; font-weight: 700; color: var(--text-secondary); }
    .pf-wl__urgent { font-size: 12px; font-weight: 600; color: var(--pf-late-text, var(--red-text)); }
    .pf-wl__l2 { font-size: 12.5px; line-height: 1.35; color: var(--text-secondary); overflow-wrap: break-word; }
    .pf-wl__note { font-size: 12px; line-height: 1.35; color: var(--pf-late-text, var(--red-text)); }
    .pf-wl__l3 { display: flex; align-items: baseline; justify-content: space-between; gap: 4px 12px; min-width: 0; }
    .pf-wl__status { flex: 1 1 auto; min-width: 0; }
    .pf-wl__l3 .pf-sw { flex-direction: row; flex-wrap: wrap; align-items: baseline; justify-content: flex-start; gap: 0 6px; text-align: left; }
    .pf-wl__l3 .pf-sw__detail::before { content: '· '; }
    .pf-wl__time { flex: none; font-size: 12px; color: var(--text-secondary); white-space: nowrap; }
    .pf-wl__time--late { color: var(--pf-late-text, var(--red-text)); font-weight: 600; }
    /* The right edge never takes more than half the row (owner 2026-11-21: the name was squeezed to one letter wide by
       a row of actions) — a screen with several actions hands in ONE primary + ⋯; anything wider wraps inside its half. */
    .pf-wl__act { flex: 0 1 auto; max-width: 50%; display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 6px; }
    .pf-wl .pf-wl__primary { height: 44px; min-height: 44px; padding: 0 14px; font-size: 13px; }
    .pf-wl .pf-wl__more { width: 44px; height: 44px; min-height: 44px; }
    /* The row's primary is a TEXT button on touch too (never icon-only): an icon-mode action handed in through
       [actionTpl] (e.g. the Outsourced upload) shows its words; only a ⋯ trigger stays an icon. */
    .pf-wl__act .pf-rowact.pf-rowact--icon:has(> .pf-rowact__t) { width: auto; min-width: 0; padding: 0 14px; color: var(--violet-text, var(--text-primary)); }
    .pf-wl__act .pf-rowact.pf-rowact--icon:has(> .pf-rowact__t) > svg { display: none; }
    .pf-wl__act .pf-rowact.pf-rowact--icon > .pf-rowact__t { position: static; width: auto; height: auto; overflow: visible; clip: auto; }
    .pf-wl__empty { padding: 32px 12px; text-align: center; }
    .pf-wl__row--skel .pf-wl__main { cursor: default; gap: 8px; }
  `],
})
export class WorkListComponent<T = unknown> {
  readonly items = input<WorkListItem<T>[]>([]);
  readonly loading = input(false);
  readonly label = input('Work list');
  readonly emptyTitle = input('Nothing here right now.');
  readonly emptyBody = input('');
  /** The screen's own right-edge control (context: `$implicit` = the item) instead of primary + ⋯. */
  readonly actionTpl = input<TemplateRef<{ $implicit: WorkListItem<T> }> | null>(null);

  readonly open = output<WorkListItem<T>>();
  readonly primary = output<WorkListItem<T>>();
  readonly action = output<{ item: WorkListItem<T>; id: string }>();

  protected facts(it: WorkListItem<T>): string { return factsLine(it.facts); }
  protected status(it: WorkListItem<T>): string { return statusLine(it.status); }
  /** Line 3 is THE status-words cell (shared/components/status-words): now + detail, rose late / green done. */
  protected words(s: WorkListStatus): StatusWords { return { now: s.now, detail: s.detail ?? null, tone: s.tone ?? 'normal' }; }
}
