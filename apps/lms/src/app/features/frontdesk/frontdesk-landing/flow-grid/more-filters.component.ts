import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, inject, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ModalPortalDirective } from '../../../../shared/directives/modal-portal.directive';
import { mediaSignal } from '../../../admin/tests/tests/tm-two-panel';
import { SegmentedComponent, SegmentedOption } from '../../../../shared/primitives/segmented.component';
import { PfSelectOption, SelectComponent } from '../../../../shared/primitives/select.component';
import { NO_WORK_FILTERS, WORK_SORT_LABEL, WorkFilters, WorkSort } from './work-filters';

/**
 * The work card's "More filters" popover (owner-approved mock CurrentFilter): MORE FILTERS + Clear, then
 * Date (the existing Yesterday · Today · Custom), Doctor, Branch (only when the data has them), Only late,
 * Only with dues, Sort. pf-select / pf-segmented / the kit's slate switch only — no native controls.
 * The root keeps the old date popover's hook (`pf-hdr-filter__pop`) so the date options stay where specs and
 * muscle memory look for them.
 */
@Component({
  selector: 'pf-fd-more-filters',
  standalone: true,
  imports: [SegmentedComponent, SelectComponent, NgTemplateOutlet, ModalPortalDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Phones: a bottom sheet portalled to <body> (no card / container can clip or offset it). -->
    @if (sheet()) {
      <div pfModalPortal class="fd-mf-layer"><ng-container [ngTemplateOutlet]="body" /></div>
    } @else {
      <ng-container [ngTemplateOutlet]="body" />
    }
    <ng-template #body>
    <div class="fd-mf__bd" (click)="closed.emit()" aria-hidden="true"></div>
    <div class="fd-mf pf-hdr-filter__pop" role="dialog" aria-label="More filters" (click)="$event.stopPropagation()">
      <div class="fd-mf__head">
        <span class="fd-mf__title">More filters</span>
        <button type="button" class="pf-btn pf-btn--tertiary fd-mf__clear" [disabled]="!dirty()" (click)="clear()">Clear</button>
        <button type="button" class="fd-mf__x" aria-label="Close filters" (click)="closed.emit()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      <div class="fd-mf__field">
        <span class="fd-mf__label" id="fd-mf-date">Date</span>
        <pf-segmented class="fd-mf__seg" ariaLabel="Date" [options]="dateOptions()" [value]="dateValue()"
          (valueChange)="dateChange.emit($any($event))" (optionClick)="dateClick.emit($any($event))"
          (optionClear)="dateClear.emit()" />
      </div>

      @if (doctors().length) {
        <div class="fd-mf__field">
          <span class="fd-mf__label">Doctor</span>
          <pf-select [options]="doctorOptions()" [value]="filters().doctor ?? ''" [searchable]="doctors().length > 6"
            placeholder="All doctors" (valueChange)="patch({ doctor: $any($event) || null })" />
        </div>
      }
      @if (branches().length > 1) {
        <div class="fd-mf__field">
          <span class="fd-mf__label">Branch</span>
          <pf-select [options]="branchOptions()" [value]="filters().branch ?? ''" placeholder="All branches"
            (valueChange)="patch({ branch: $any($event) || null })" />
        </div>
      }

      <div class="fd-mf__row">
        <span class="fd-mf__rowlbl" id="fd-mf-late">Only late (over 30 min)</span>
        <button type="button" class="pf-toggle" role="switch" aria-labelledby="fd-mf-late" data-filter="late"
          [attr.aria-checked]="filters().onlyLate" (click)="patch({ onlyLate: !filters().onlyLate })">
          <span class="pf-toggle__track"><span class="pf-toggle__knob"></span></span>
        </button>
      </div>
      <div class="fd-mf__row">
        <span class="fd-mf__rowlbl" id="fd-mf-dues">Only with dues</span>
        <button type="button" class="pf-toggle" role="switch" aria-labelledby="fd-mf-dues" data-filter="dues"
          [attr.aria-checked]="filters().onlyDues" (click)="patch({ onlyDues: !filters().onlyDues })">
          <span class="pf-toggle__track"><span class="pf-toggle__knob"></span></span>
        </button>
      </div>

      <div class="fd-mf__field">
        <span class="fd-mf__label">Sort</span>
        <pf-segmented class="fd-mf__seg" ariaLabel="Sort" [options]="sortOptions" [value]="filters().sort"
          (valueChange)="patch({ sort: $any($event) })" />
      </div>
    </div>
    </ng-template>
  `,
  styles: [`
    :host { display: contents; }
    .fd-mf__bd { position: fixed; inset: 0; z-index: 60; }
    .fd-mf {
      position: absolute; top: calc(100% + 8px); right: 0; z-index: 61;
      width: 340px; max-width: calc(100vw - 32px); box-sizing: border-box;
      display: flex; flex-direction: column; gap: 12px; padding: 14px 16px 16px;
      border-radius: 16px; background: var(--pf-card-bg, var(--bg-card-solid));
      border: 1px solid var(--pf-line);
      box-shadow: 0 18px 44px rgba(15, 23, 42, 0.18), 0 2px 6px rgba(15, 23, 42, 0.08);
      text-align: left; cursor: default;
      animation: fd-mf-in var(--pf-dur-fast, 200ms) ease both;
    }
    @keyframes fd-mf-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .fd-mf { animation: none; } }
    .fd-mf__head { display: flex; align-items: center; gap: 4px; }
    .fd-mf__title { flex: 1; font-size: 11.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-primary); }
    .fd-mf__clear { min-height: 32px; height: 32px; padding: 0 10px; }
    .fd-mf__x { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border: 0; border-radius: 8px;
      background: transparent; color: var(--text-tertiary); cursor: pointer; }
    .fd-mf__x:hover { background: var(--bg-hover); color: var(--text-primary); }
    .fd-mf__field { display: flex; flex-direction: column; gap: 6px; }
    .fd-mf__label { font-size: 12px; font-weight: 500; color: var(--text-tertiary); }
    .fd-mf__seg { display: flex; }
    .fd-mf__seg ::ng-deep .bar { width: 100%; }
    .fd-mf__seg ::ng-deep .seg-item { flex: 1 1 0; min-width: 0 !important; overflow: hidden; }
    .fd-mf__seg { min-width: 0; overflow: hidden; }
    .fd-mf__row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 36px; }
    .fd-mf__rowlbl { font-size: 13px; color: var(--text-primary); }
    @media (pointer: coarse) {
      .fd-mf__x, .fd-mf__clear { min-width: 44px; min-height: 44px; height: 44px; }
      .fd-mf__row { min-height: 44px; }
      .fd-mf .pf-toggle { min-height: 44px; min-width: 44px; justify-content: flex-end; }
    }
    .fd-mf-layer .fd-mf__bd { z-index: 1000; background: rgba(15, 23, 42, 0.35); }
    @media (max-width: 640px) {
      /* The app's auto bottom-sheet (styles.scss: every [role=dialog] is full width on phones, !important) owns the
         width — so this is a true edge-to-edge sheet resting on the bottom nav, never an inset card it would overflow. */
      .fd-mf { z-index: 1001; position: fixed; top: auto; left: 0; right: 0; bottom: var(--pf-nav-h, 0px);
        max-height: calc(100dvh - var(--pf-nav-h, 0px) - 80px); overflow-y: auto; }
    }
  `],
})
export class MoreFiltersComponent {
  readonly filters = input<WorkFilters>(NO_WORK_FILTERS);
  readonly dateOptions = input<SegmentedOption<string>[]>([]);
  readonly dateValue = input<string>('today');
  readonly doctors = input<string[]>([]);
  readonly branches = input<{ id: string; name: string }[]>([]);
  /** The date is "changed" when it isn't Today (Clear brings it back). */
  readonly dateChanged = input(false);

  readonly filtersChange = output<WorkFilters>();
  readonly dateChange = output<string>();
  readonly dateClick = output<{ value: string; target: HTMLElement; event: MouseEvent }>();
  readonly dateClear = output<void>();
  readonly cleared = output<void>();
  readonly closed = output<void>();
  /** Phones: the popover is a bottom sheet above the navbar. */
  readonly sheet = mediaSignal('(max-width: 640px)', inject(DestroyRef));

  readonly sortOptions: SegmentedOption<WorkSort>[] = (['token', 'wait', 'newest'] as WorkSort[])
    .map(v => ({ value: v, label: WORK_SORT_LABEL[v] }));
  readonly doctorOptions = computed<PfSelectOption<string>[]>(() =>
    [{ value: '', label: 'All doctors' }, ...this.doctors().map(d => ({ value: d, label: d }))]);
  readonly branchOptions = computed<PfSelectOption<string>[]>(() =>
    [{ value: '', label: 'All branches' }, ...this.branches().map(b => ({ value: b.id, label: b.name }))]);
  readonly dirty = computed(() => {
    const f = this.filters();
    return this.dateChanged() || !!f.doctor || !!f.branch || f.onlyLate || f.onlyDues || f.sort !== 'token';
  });

  patch(p: Partial<WorkFilters>): void { this.filtersChange.emit({ ...this.filters(), ...p }); }

  clear(): void {
    this.filtersChange.emit({ ...NO_WORK_FILTERS });
    this.cleared.emit();
  }

  @HostListener('document:keydown.escape')
  onEsc(): void { this.closed.emit(); }
}
