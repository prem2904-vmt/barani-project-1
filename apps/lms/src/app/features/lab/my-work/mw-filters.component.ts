import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, inject, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ModalPortalDirective } from '../../../shared/directives/modal-portal.directive';
import { mediaSignal } from '../../admin/tests/tests/tm-two-panel';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { LabSortComponent } from '../../../shared/components/lab-sort/lab-sort.component';
import { MwFilter, NO_MW_FILTER } from './my-work.grid';

/**
 * My Work's card-head FILTERS popover (owner 2026-11-20: "the filter in the grid is missing") — Frontdesk's More
 * filters pattern: FILTERS + Clear, then Priority (Urgent / Normal — the only two), Department (when the list has 2+),
 * the Completed window (Today · 7 days) and, on phones only (no column headers there), Sort. pf-select / pf-segmented
 * only. Phones: a bottom sheet portalled to <body>.
 */
@Component({
  selector: 'pf-mw-filters',
  standalone: true,
  imports: [SegmentedComponent, SelectComponent, LabSortComponent, NgTemplateOutlet, ModalPortalDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (sheet()) {
      <div pfModalPortal class="mwf-layer"><ng-container [ngTemplateOutlet]="body" /></div>
    } @else {
      <ng-container [ngTemplateOutlet]="body" />
    }
    <ng-template #body>
      <div class="mwf__bd" (click)="closed.emit()" aria-hidden="true"></div>
      <div class="mwf" role="dialog" aria-label="Filters" data-testid="mw-filters" (click)="$event.stopPropagation()">
        <div class="mwf__head">
          <span class="mwf__title">Filters</span>
          <button type="button" class="pf-btn pf-btn--tertiary mwf__clear" [disabled]="!dirty()" (click)="clear()">Clear</button>
          <button type="button" class="mwf__x" aria-label="Close filters" (click)="closed.emit()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        @if (showPriority()) {
          <div class="mwf__field">
            <span class="mwf__label">Priority</span>
            <pf-segmented class="mwf__seg" ariaLabel="Priority" data-filter="priority" [options]="priorityOptions" [value]="filter().priority"
              (valueChange)="patch({ priority: $any($event) })" />
          </div>
        }
        @if (depts().length > 1) {
          <div class="mwf__field">
            <span class="mwf__label">Department</span>
            <pf-select data-filter="dept" [options]="deptOptions()" [value]="filter().dept ?? ''" placeholder="All departments"
              (valueChange)="patch({ dept: $any($event) || null })" />
          </div>
        }
        @if (windowValue(); as w) {
          <div class="mwf__field">
            <span class="mwf__label">Completed</span>
            <pf-segmented class="mwf__seg" ariaLabel="Completed window" data-filter="window" [options]="windowOptions()" [value]="w"
              (valueChange)="windowChange.emit($any($event))" />
          </div>
        }
        @if (sheet()) {
          <div class="mwf__field">
            <span class="mwf__label">Sort</span>
            <pf-lab-sort class="mwf__sort" [scope]="sortScope()" />
          </div>
        }
      </div>
    </ng-template>
  `,
  styles: [`
    :host { display: contents; }
    .mwf__bd { position: fixed; inset: 0; z-index: 60; }
    .mwf {
      position: absolute; top: calc(100% + 8px); right: 0; z-index: 61;
      width: 320px; max-width: calc(100vw - 32px); box-sizing: border-box;
      display: flex; flex-direction: column; gap: 12px; padding: 14px 16px 16px;
      border-radius: 16px; background: var(--pf-card-bg, var(--bg-card-solid)); border: 1px solid var(--pf-line);
      box-shadow: 0 18px 44px rgba(15, 23, 42, 0.18), 0 2px 6px rgba(15, 23, 42, 0.08);
      text-align: left; cursor: default; animation: mwf-in var(--pf-dur-fast, 200ms) ease both;
    }
    @keyframes mwf-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .mwf { animation: none; } }
    .mwf__head { display: flex; align-items: center; gap: 4px; }
    .mwf__title { flex: 1; font-size: 11.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-primary); }
    .mwf__clear { min-height: 32px; height: 32px; padding: 0 10px; }
    .mwf__x { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border: 0; border-radius: 8px;
      background: transparent; color: var(--text-tertiary); cursor: pointer; }
    .mwf__field { display: flex; flex-direction: column; gap: 6px; }
    .mwf__label { font-size: 12px; font-weight: 500; color: var(--text-tertiary); }
    .mwf__seg { display: flex; min-width: 0; overflow: hidden; }
    .mwf__seg ::ng-deep .bar { width: 100%; }
    .mwf__seg ::ng-deep .seg-item { flex: 1 1 0; min-width: 0 !important; }
    .mwf__sort { display: block; width: 100%; }
    @media not ((hover: hover) and (pointer: fine)) {
      .mwf__x, .mwf__clear { min-width: 44px; min-height: 44px; height: 44px; }
    }
    .mwf-layer .mwf__bd { z-index: 1000; background: rgba(15, 23, 42, 0.35); }
    @media (max-width: 640px) {
      .mwf { z-index: 1001; position: fixed; top: auto; left: 0; right: 0; bottom: var(--pf-nav-h, 0px);
        max-height: calc(100dvh - var(--pf-nav-h, 0px) - 80px); overflow-y: auto; }
    }
  `],
})
export class MwFiltersComponent {
  readonly filter = input<MwFilter>(NO_MW_FILTER);
  readonly depts = input<Array<{ id: string; name: string }>>([]);
  readonly showPriority = input(true);
  /** Completed only: the Today · 7 days window (null hides it). */
  readonly windowValue = input<string | null>(null);
  readonly windowOptions = input<SegmentedOption<string>[]>([]);
  readonly sortScope = input<'work' | 'completed'>('work');

  readonly filterChange = output<MwFilter>();
  readonly windowChange = output<string>();
  readonly closed = output<void>();
  /** Phones: a bottom sheet above the navbar. */
  readonly sheet = mediaSignal('(max-width: 640px)', inject(DestroyRef));

  readonly priorityOptions: SegmentedOption<string>[] = [
    { value: 'all', label: 'All' }, { value: 'urgent', label: 'Urgent' }, { value: 'normal', label: 'Normal' },
  ];
  readonly deptOptions = computed<PfSelectOption<string>[]>(() =>
    [{ value: '', label: 'All departments' }, ...this.depts().map(d => ({ value: d.id, label: d.name }))]);
  readonly dirty = computed(() => {
    const f = this.filter();
    return f.priority !== 'all' || !!f.dept || (this.windowValue() != null && this.windowValue() !== 'today');
  });

  patch(p: Partial<MwFilter>): void { this.filterChange.emit({ ...this.filter(), ...p }); }
  clear(): void {
    this.filterChange.emit({ ...this.filter(), priority: 'all', dept: null });
    if (this.windowValue() != null && this.windowValue() !== 'today') this.windowChange.emit('today');
  }

  @HostListener('document:keydown.escape')
  onEsc(): void { this.closed.emit(); }
}
