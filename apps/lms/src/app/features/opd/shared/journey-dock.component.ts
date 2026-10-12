import { ChangeDetectionStrategy, Component, inject, output, viewChild } from '@angular/core';
import { JourneyAxisComponent } from '../../../shared/components/journey-axis/journey-axis.component';
import { DockFilter, JourneyDockService } from './journey-dock.service';

/**
 * `pf-journey-dock` — the patient timeline docked just above the bottom
 * navbar on the doctor screens (consult v6). Collapsed: a 44px strip with a
 * one-line summary. Expanded: the shared journey axis (pf-journey-axis) with
 * All / OPD / Lab and − / + zoom. The pin is per user; an unpinned dock folds
 * away as soon as the doctor types in the consult (JourneyDockService
 * .noteTyping). Tapping a date selects that visit (service.selectedKey) and
 * emits it for hosts that navigate.
 */
@Component({
  selector: 'pf-journey-dock',
  standalone: true,
  imports: [JourneyAxisComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (dock.patient(); as p) {
      <section class="jd" [class.jd--open]="dock.open()" [attr.aria-label]="'Timeline of ' + p.name">
        <div class="jd__bar">
          <button type="button" class="jd__ttl" (click)="dock.toggleOpen()" [attr.aria-expanded]="dock.open()" aria-controls="jd-body">
            <span class="jd__ci" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12h3M14 12h3"/></svg>
            </span>
            <b>Patient timeline</b>
            <span class="jd__sum pf-num">
              @if (dock.loading()) { Loading the patient's history… }
              @else { {{ dock.summary().text }}@if (dock.summary().flagged; as f) { · <em>{{ f }}</em> } }
            </span>
          </button>
          <div class="jd__ctl">
            @if (dock.open()) {
              <span class="jd__pills" role="group" aria-label="Show">
                @for (f of filters; track f.id) {
                  <button type="button" class="jd__pill" [attr.aria-pressed]="dock.filter() === f.id" (click)="dock.filter.set(f.id)">{{ f.label }}</button>
                }
              </span>
              <span class="jd__zoom">
                <button type="button" class="jd__ib" (click)="axis()?.zoomBy(1 / 1.4)" aria-label="Zoom out" title="Zoom out">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14"/></svg>
                </button>
                <button type="button" class="jd__ib" (click)="axis()?.zoomBy(1.4)" aria-label="Zoom in" title="Zoom in">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
                </button>
              </span>
            }
            <button type="button" class="jd__ib" (click)="dock.togglePin()" [attr.aria-pressed]="dock.pinned()" data-pin
                    [title]="dock.pinned() ? 'Pinned: stays open while you type' : 'Unpinned: folds away when you type'"
                    [attr.aria-label]="dock.pinned() ? 'Unpin the timeline' : 'Pin the timeline open'">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.8V4h6v6.8l2 3.2H7l2-3.2Z"/></svg>
            </button>
            <button type="button" class="jd__ib" (click)="dock.toggleOpen()" [attr.aria-label]="dock.open() ? 'Collapse the timeline' : 'Expand the timeline'">
              @if (dock.open()) { <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg> }
              @else { <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg> }
            </button>
          </div>
        </div>
        @if (dock.open()) {
          <div class="jd__body" id="jd-body">
            @if (dock.events().length) {
              <pf-journey-axis [events]="dock.events()" [selectedKey]="dock.selectedKey()" [maxLanes]="2" [railBase]="72" [laneGap]="28"
                               [stemBase]="10" [minWidth]="420" [gutter]="8" [tight]="true" (select)="pick($event)"></pf-journey-axis>
            } @else if (!dock.loading()) {
              <p class="jd__none">No earlier visits, lab reports or files for this patient.</p>
            }
          </div>
        }
      </section>
    }
  `,
  styles: [`
    :host { display: block; flex: none; min-width: 0; }
    .jd { position: relative; z-index: 5; background: var(--pf-card-bg); border-top: 1px solid var(--pf-card-border, var(--pf-line)); }
    .jd__bar { display: flex; align-items: center; gap: 12px; height: 44px; padding: 0 16px; }
    .jd__ttl { flex: 1; min-width: 0; height: 100%; display: flex; align-items: center; gap: 10px; border: 0; background: none; padding: 0; font: inherit; color: inherit; text-align: left; cursor: pointer; }
    .jd__ttl:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: -2px; border-radius: 8px; }
    .jd__ci { flex: none; width: 24px; height: 24px; border-radius: 7px; display: grid; place-items: center; color: var(--violet-text, #6d28d9);
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent); }
    .jd__ttl b { flex: none; font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-secondary); white-space: nowrap; }
    .jd__sum { min-width: 0; font-size: 12.5px; color: var(--text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .jd__sum em { font-style: normal; font-weight: 600; color: var(--red-text, #dc2626); }
    .jd__ctl { flex: none; display: flex; align-items: center; gap: 6px; }
    .jd__pills, .jd__zoom { display: inline-flex; gap: 4px; }
    .jd__pills { margin-right: 4px; }
    .jd__pill { height: 28px; padding: 0 11px; border-radius: 999px; border: 1px solid var(--pf-line); background: none; font: inherit; font-size: 12px; font-weight: 500; color: var(--text-secondary); cursor: pointer; }
    .jd__pill[aria-pressed='true'] { border-color: transparent; color: #fff; font-weight: 600; background: linear-gradient(135deg, #7c3aed, #ec4899); }
    .jd__ib { height: 28px; min-width: 28px; padding: 0 6px; border-radius: 8px; border: 1px solid var(--pf-line); background: none; color: var(--text-secondary);
      display: inline-grid; place-items: center; cursor: pointer; }
    .jd__ib:hover, .jd__pill:hover { color: var(--text-primary); }
    .jd__ib[aria-pressed='true'] { border-color: transparent; color: var(--violet-text, #6d28d9); background: color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent); }
    .jd__ib:focus-visible, .jd__pill:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .jd__body { padding: 4px 16px 8px; }
    .jd__none { margin: 0; padding: 6px 4px 10px; font-size: 12.5px; color: var(--text-tertiary); }
    @media (max-width: 600px) {
      .jd__bar { padding: 0 12px; }
      .jd__sum, .jd__pills { display: none; }
      .jd__body { padding: 0 8px 8px; }
    }
    @media (pointer: coarse) { .jd__ib, .jd__pill { height: 36px; min-width: 36px; } }
  `],
})
export class JourneyDockComponent {
  readonly dock = inject(JourneyDockService);
  /** A date was tapped (after the service selected it). */
  readonly picked = output<string>();
  readonly axis = viewChild(JourneyAxisComponent);

  readonly filters: { id: DockFilter; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'opd', label: 'OPD' }, { id: 'lab', label: 'Lab' }];

  pick(key: string) { this.dock.select(key); this.picked.emit(key); }
}
