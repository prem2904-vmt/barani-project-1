import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, NgZone,
  OnChanges, OnDestroy, Output, ViewChild, inject, signal,
} from '@angular/core';
import { ActionsMenuComponent, ActionsMenuTriggerDirective, type PfAction } from '../components/navigation/actions-menu.component.js';
import { pillFitState, pillFitSummary, type PillFit } from '../utils/pill-fit.js';

export interface SegmentedOption<T = string> {
  value: T;
  label: string;
  /** Greyed out + unclickable; `hint` explains why (shown as tooltip). */
  disabled?: boolean;
  hint?: string;
  /** Optional state colour — rendered as a leading dot when no icon is shown. */
  dot?: string;
  /** Optional count shown after the label. */
  count?: number | null;
  /** Warning tone for the count (e.g. failed items > 0). */
  warn?: boolean;
  /** Data tone for the count (e.g. 'active', 'ok', 'warning'). */
  tone?: string;
  /** Optional SVG path data for icon + label display. */
  iconPath?: string[];
  /** Optional icon name or string. */
  icon?: string;
  /** Optional icon color override. */
  iconColor?: string;
  /** Per-item display override: 'both' | 'text' | 'icon' */
  mode?: 'both' | 'text' | 'icon';
  /** Accessible name override (default: the label) — e.g. "Appointments, 7, 1 overdue". */
  aria?: string;
  /** A small rose attention dot at the option's top-right (e.g. overdue appointments). */
  alert?: boolean;
  /** Whether this option has an inline clear button when active (e.g. custom date range with value). */
  clearable?: boolean;
}

export type SegmentedSize = 'sm' | 'md';
export type SegmentedDisplayMode = 'auto' | 'both' | 'text' | 'icon' | 'icon-text' | 'text-only';
/** `auto` (default): tighten, then collapse to the selected-pill menu when the group does not fit its
 *  slot. `off`: always the full row (a host that already gives the pill all the room it needs). */
export type SegmentedFitMode = 'auto' | 'off';

@Component({
  selector: 'pf-segmented',
  standalone: true,
  imports: [ActionsMenuComponent, ActionsMenuTriggerDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #bar [class]="rootClasses" role="radiogroup" [attr.aria-label]="ariaLabel || 'Options'" (keydown)="onKeydown($event)">
      @for (opt of options; track opt.value) {
        <button type="button"
                role="radio"
                [class]="itemClasses(opt.value)"
                [attr.data-value]="opt.value"
                [attr.data-filter]="opt.value"
                [attr.data-tab]="opt.value"
                [attr.aria-checked]="opt.value === value"
                [attr.aria-selected]="opt.value === value"
                [attr.tabindex]="opt.value === value ? 0 : -1"
                [disabled]="opt.disabled ?? false"
                [title]="opt.hint || opt.label"
                [attr.aria-label]="opt.aria || opt.label"
                (click)="select(opt.value, $event)">
          @if (hasIcon(opt)) {
            <span class="seg-ico" aria-hidden="true" [style.color]="opt.iconColor || null">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
                   stroke-linejoin="round">
                @for (d of opt.iconPath!; track d) { <path [attr.d]="d"/> }
              </svg>
            </span>
          }
          @if (opt.dot && !hasIcon(opt)) { <span class="seg-dot" [style.background]="opt.dot" aria-hidden="true"></span> }
          @if (hasText(opt)) {
            <span class="seg-lbl">{{ opt.label }}</span>
          }
          @if (opt.count !== undefined && opt.count !== null) {
            <span class="seg-count pf-num" [attr.data-tone]="opt.tone" [class.seg-count--warn]="opt.warn || (opt.value === 'failed' && opt.count > 0)">
              {{ opt.count }}
            </span>
          }
          @if (opt.alert) { <span class="seg-alert" aria-hidden="true"></span> }
          @if (opt.clearable && opt.value === value) {
            <span class="seg-clear" role="button" tabindex="0" (click)="$event.stopPropagation(); clearOption(opt, $event)" aria-label="Clear">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </span>
          }
        </button>
      }
    </div>
    @if (fit() === 'menu') {
      <!-- Collapsed (the group does not fit its slot): ONE pill = the selected option + count + chevron;
           the options open in the shared filter menu (pf-actions-menu, a popover by the pill). -->
      <pf-actions-menu class="seg-menu" [actions]="menuActions()" [checkCurrent]="true" [popover]="true"
                       align="start" [width]="menuWidth" [label]="ariaLabel || 'Options'" [heading]="ariaLabel || ''"
                       (action)="pickFromMenu($event)">
        <button #compact pfActionsTrigger type="button" class="seg-compact pf-seg-compact" [class]="'sz-' + size"
                [attr.aria-label]="(ariaLabel || 'Options') + ': ' + compactSummary()" [title]="compactSummary()"
                data-seg-compact>
          @let cur = selectedOption();
          @if (cur && hasIcon(cur)) {
            <span class="seg-ico" aria-hidden="true" [style.color]="cur.iconColor || null">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round">
                @for (d of cur.iconPath!; track d) { <path [attr.d]="d"/> }
              </svg>
            </span>
          } @else if (cur?.dot) {
            <span class="seg-dot" [style.background]="cur!.dot" aria-hidden="true"></span>
          }
          <span class="seg-lbl">{{ cur ? cur.label : allLabel }}</span>
          @if (cur && cur.count !== undefined && cur.count !== null) {
            <span class="seg-count pf-num" [attr.data-tone]="cur.tone"
                  [class.seg-count--warn]="cur.warn || (cur.value === 'failed' && cur.count > 0)">{{ cur.count }}</span>
          }
          @if (cur?.clearable) {
            <span class="seg-clear" role="button" tabindex="0" aria-label="Clear"
                  (click)="$event.stopPropagation(); clearOption(cur!, $event)">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </span>
          }
          <svg class="seg-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
        </button>
      </pf-actions-menu>
    }
  `,
  styles: [`
    /* min-width 0 + max-width 100%: the pill may shrink inside its slot (a nowrap card head, a narrow
       cell) — the fit logic then tightens / collapses it instead of letting it overflow or wrap the row. */
    :host { display: inline-flex; vertical-align: middle; min-width: 0; max-width: 100%; }
    /* A screen's own "flex: none / flex-shrink: 0 / overflow-x: auto" on the pill (written before the pill could fit
       itself) would pin it wider than its slot or scroll it: the fit owns that now. fitMode="off" opts out. */
    :host(:not(.seg-fit-off)) { flex-shrink: 1 !important; min-width: 0 !important; overflow-x: visible !important; }
    :host(.is-menu) { justify-content: flex-start; }
    :host(.is-menu.seg-fit-end) { justify-content: flex-end; }
    :host(.is-menu) .bar { display: none !important; }
    /* Measuring pass (synchronous, undone before the frame paints): the bar at its natural width. */
    :host(.is-measuring) .bar {
      display: inline-flex !important; position: absolute !important; visibility: hidden !important;
      width: max-content !important; max-width: none !important; flex: none !important; pointer-events: none;
    }
    /* Tight: a little less air per option; labels and counts stay whole. */
    :host(.is-tight) .bar .seg-item { padding: 0 8px; gap: 4px; }
    :host(.is-tight) .bar.sz-md .seg-item { padding: 0 10px; }
    :host(.is-tight) .bar { gap: 0; }
    .bar {
      display: inline-flex;
      align-items: center;
      padding: 3px;
      gap: 2px;
      height: 32px;
      border-radius: 9999px;
      background: var(--pf-chip-bg, #f1f5f9);
      border: 1px solid var(--pf-line, rgba(148, 163, 184, 0.2));
      box-sizing: border-box;
    }
    .sz-sm { height: 32px; padding: 3px; }
    .sz-md { height: 36px; padding: 3px; }

    .seg-item {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      white-space: nowrap;
      height: 26px;
      max-height: 26px;
      min-height: 26px !important;
      min-width: 0 !important;
      padding: 0 12px;
      margin: 0;
      border: 0;
      border-radius: 9999px;
      background: transparent;
      color: var(--text-secondary, #475569);
      font: inherit;
      font-size: 12.5px;
      font-weight: 500;
      line-height: 1;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
      box-sizing: border-box;
    }
    .sz-sm .seg-item { height: 26px; max-height: 26px; min-height: 26px !important; padding: 0 12px; font-size: 12.5px; }
    .sz-md .seg-item { height: 30px; max-height: 30px; min-height: 30px !important; padding: 0 14px; font-size: 13px; }

    .seg-item:hover:not(:disabled):not(.is-selected) {
      color: var(--text-primary, #0f172a);
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 8%, transparent);
      box-shadow: inset 0 0 0 1px var(--glass-border-hover, rgba(124, 58, 237, 0.3));
    }
    .seg-item:focus-visible {
      outline: 2px solid var(--color-violet-600, #7c3aed);
      outline-offset: 1px;
    }
    .seg-item:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .seg-item.is-selected {
      background: var(--pf-card-bg, #ffffff) !important;
      color: var(--color-violet-600, #7c3aed) !important;
      font-weight: 600;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08), 0 1px 2px rgba(15, 23, 42, 0.04) !important;
    }

    .seg-ico {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 14px;
      height: 14px;
      flex-shrink: 0;
      color: var(--text-tertiary, #94a3b8);
      transition: color 0.15s ease;
    }
    .seg-item:hover:not(:disabled) .seg-ico {
      color: var(--text-secondary, #475569);
    }
    .seg-item.is-selected .seg-ico {
      color: var(--color-violet-600, #7c3aed);
    }

    .seg-lbl {
      display: inline-block;
      line-height: 1;
    }

    .seg-count {
      font-size: 11.5px;
      font-weight: 500;
      font-family: inherit;
      font-variant-numeric: tabular-nums;
      color: var(--text-tertiary, #94a3b8);
      transition: color 0.15s ease;
      line-height: 1;
    }
    .seg-item.is-selected .seg-count {
      color: var(--color-violet-600, #7c3aed);
      opacity: 0.9;
    }
    .seg-count--warn,
    .seg-item.is-selected .seg-count--warn {
      color: var(--red-text, #b91c1c) !important;
    }

    .seg-dot { width: 6px; height: 6px; border-radius: 9999px; flex-shrink: 0; }
    /* Attention dot (option.alert): soft rose, top-right of the option, never moves the label. */
    .seg-item:has(.seg-alert) { position: relative; }
    .seg-alert { position: absolute; top: 2px; right: 3px; width: 7px; height: 7px; border-radius: 9999px; background: var(--rose-text, #e11d48); pointer-events: none; }

    .seg-clear {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 14px;
      height: 14px;
      border-radius: 9999px;
      margin-left: 2px;
      cursor: pointer;
      opacity: 0.7;
      transition: opacity 0.15s ease, background 0.15s ease;
    }
    .seg-clear:hover {
      opacity: 1;
      background: rgba(124, 58, 237, 0.12);
    }

    /* The collapsed pill: same capsule language as the bar (chip track + raised white selected look). */
    .seg-menu { display: inline-flex; flex: none; max-width: 100%; }
    .seg-compact {
      position: relative; display: inline-flex; align-items: center; gap: 6px; flex: none;
      height: 32px; min-height: 32px !important; padding: 0 10px 0 12px; margin: 0;
      border-radius: 9999px; border: 1px solid var(--pf-line, rgba(148, 163, 184, 0.2));
      background: var(--pf-card-bg, #ffffff); color: var(--color-violet-600, #7c3aed);
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08), 0 1px 2px rgba(15, 23, 42, 0.04);
      font: inherit; font-size: 12.5px; font-weight: 600; line-height: 1; white-space: nowrap; cursor: pointer;
      box-sizing: border-box; transition: background 0.15s ease, box-shadow 0.15s ease;
    }
    .seg-compact.sz-md { height: 36px; min-height: 36px !important; font-size: 13px; padding: 0 12px 0 14px; }
    /* 44px tap target on touch without growing the head: the hit area reaches past the capsule. */
    .seg-compact::after { content: ''; position: absolute; inset: -6px -2px; }
    .seg-compact:hover { background: color-mix(in srgb, var(--color-primary, #7c3aed) 6%, var(--pf-card-bg, #fff)); }
    .seg-compact:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 1px; }
    .seg-compact[aria-expanded='true'] { box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary, #7c3aed) 18%, transparent); }
    /* Touch (owner 2026-11-21: "44px on touch everywhere"): every pill and the collapsed pill are 44px targets; desktop
       keeps the slim capsule. */
    @media (pointer: coarse) {
      .bar, .bar.sz-sm, .bar.sz-md { height: 46px; padding: 0 1px; }
      .seg-item, .sz-sm .seg-item, .sz-md .seg-item { height: 44px; max-height: 44px; min-height: 44px !important; min-width: 44px !important; }
      .seg-compact, .seg-compact.sz-md { height: 44px; min-height: 44px !important; min-width: 44px; }
    }
    .seg-compact .seg-ico, .seg-compact .seg-count { color: inherit; }
    .seg-compact .seg-count { opacity: 0.9; }
    .seg-chev { flex: none; color: var(--text-tertiary, #94a3b8); transition: transform 0.18s ease; }
    .seg-compact[aria-expanded='true'] .seg-chev { transform: rotate(180deg); }
    :host-context(.dark) .seg-compact { color: var(--violet-text, #c4b5fd); }

    @media (max-width: 640px) {
      .bar { flex-wrap: nowrap; }
      .seg-item { flex-shrink: 0; white-space: nowrap; }
    }
    @media (prefers-reduced-motion: reduce) { .seg-chev { transition: none; } }
  `]
})
export class SegmentedComponent<T = string> implements AfterViewInit, OnChanges, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly zone = inject(NgZone);
  @ViewChild('bar', { static: true }) private readonly barRef?: ElementRef<HTMLElement>;
  private ro?: ResizeObserver;
  private remeasureQueued = false;

  @Input({ required: true }) options: SegmentedOption<T>[] = [];
  @Input() value!: T;
  @Input() size: SegmentedSize = 'sm';
  @Input() ariaLabel?: string;
  /** Display mode: 'auto' (shows icon if provided), 'both' (icon + text), 'text' (text only), or 'icon' (icon only) */
  @Input() mode: SegmentedDisplayMode = 'auto';
  /** Backwards compatibility: false forces text only, true forces both */
  @Input() showIcons?: boolean;
  /** Allow clicking the active item to deselect (emit null/undefined). */
  @Input() allowDeselect: boolean = false;
  /** Pill fit: 'auto' tightens, then collapses to the selected-pill menu when the group does not fit. */
  @Input() fitMode: SegmentedFitMode = 'auto';
  /** Where the collapsed pill sits inside the room the group keeps: 'start' (default) or 'end'. */
  @Input() fitAlign: 'start' | 'end' = 'start';
  /** The collapsed pill's text when nothing is selected (an `allowDeselect` group = every option). */
  @Input() allLabel = 'All';

  /** Current fit state (see `pillFitState`). */
  readonly fit = signal<PillFit>('full');
  readonly menuWidth = 248;

  @Output() valueChange = new EventEmitter<T>();
  @Output() optionClick = new EventEmitter<{ value: T; option: SegmentedOption<T>; event: MouseEvent; target: HTMLElement }>();
  @Output() optionClear = new EventEmitter<{ value: T; option: SegmentedOption<T>; event: MouseEvent }>();

  ngAfterViewInit(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.zone.runOutsideAngular(() => {
      this.ro = new ResizeObserver(() => this.refit());
      this.ro.observe(this.host.nativeElement);
      if (this.barRef) this.ro.observe(this.barRef.nativeElement);
    });
  }

  ngOnChanges(): void {
    // Labels / counts changed: the natural width did too. Re-measure after this render.
    if (!this.ro || this.remeasureQueued) return;
    this.remeasureQueued = true;
    queueMicrotask(() => requestAnimationFrame(() => { this.remeasureQueued = false; this.refit(); }));
  }

  ngOnDestroy(): void { this.ro?.disconnect(); }

  /**
   * Measure and apply the fit state SYNCHRONOUSLY (inside the ResizeObserver callback, i.e. after
   * layout and before paint — no frame ever shows the overflowing row). The host box is kept at the
   * natural width in every state, so the slot width it reads is the same whichever state is showing.
   */
  refit(): void {
    const host = this.host.nativeElement;
    const bar = this.barRef?.nativeElement;
    if (!bar || !host.isConnected) return;
    host.classList.toggle('seg-fit-off', this.fitMode === 'off');
    if (this.fitMode === 'off') { this.applyFit('full', 0); return; }
    const had = { tight: host.classList.contains('is-tight'), menu: host.classList.contains('is-menu') };
    host.classList.remove('is-tight', 'is-menu');
    host.classList.add('is-measuring');
    const full = bar.getBoundingClientRect().width;
    host.classList.add('is-tight');
    const tight = bar.getBoundingClientRect().width;
    host.classList.remove('is-measuring', 'is-tight');
    if (had.tight) host.classList.add('is-tight');
    if (had.menu) host.classList.add('is-menu');
    // The room the slot gives the pill (pinned to `full` in tight / menu, so it is state-independent).
    if (this.fit() !== 'full') host.style.width = `${full}px`;
    const avail = host.getBoundingClientRect().width;
    this.applyFit(pillFitState(avail, full, tight), full);
  }

  private applyFit(next: PillFit, full: number): void {
    const host = this.host.nativeElement;
    host.classList.toggle('is-tight', next === 'tight');
    host.classList.toggle('is-menu', next === 'menu');
    host.classList.toggle('seg-fit-end', this.fitAlign === 'end');
    if (next === 'full') host.style.removeProperty('width');
    else host.style.width = `${full}px`;
    if (next !== this.fit()) {
      this.fit.set(next);
      // Render the collapsed pill in this same frame (we are before paint).
      this.zone.run(() => this.cdr.detectChanges());
    }
  }

  selectedOption(): SegmentedOption<T> | undefined {
    return this.options?.find(o => o.value === this.value);
  }

  compactSummary(): string {
    const cur = this.selectedOption();
    return cur ? pillFitSummary(cur.label, cur.count) : this.allLabel;
  }

  /** The options as filter-menu rows (dot + label + count; the selected one carries the check). */
  menuActions(): PfAction[] {
    const rows: PfAction[] = [];
    const noneSelected = this.value === null || this.value === undefined;
    if (this.allowDeselect) rows.push({ id: 'all', label: this.allLabel, dot: 'ring', current: noneSelected });
    (this.options ?? []).forEach((o, i) => rows.push({
      id: `o${i}`, label: o.label, dot: o.dot, count: o.count ?? undefined, disabled: o.disabled,
      hint: o.disabled ? o.hint : undefined, current: o.value === this.value,
    }));
    return rows;
  }

  pickFromMenu(id: string): void {
    const trigger = this.host.nativeElement.querySelector<HTMLElement>('[data-seg-compact]') ?? this.host.nativeElement;
    if (id === 'all') {
      if (this.value === null || this.value === undefined) return;
      this.value = (null as unknown) as T;
      this.valueChange.emit(this.value);
      this.cdr.markForCheck();
      return;
    }
    const opt = this.options[Number(id.slice(1))];
    if (!opt) return;
    const ev = typeof MouseEvent === 'function' ? new MouseEvent('click') : ({} as MouseEvent);
    // A menu pick of the selected option is "keep it", never a deselect.
    if (this.allowDeselect && opt.value === this.value) {
      this.optionClick.emit({ value: opt.value, option: opt, event: ev, target: trigger });
      return;
    }
    this.select(opt.value, ev, trigger);
    this.cdr.markForCheck();
  }

  get rootClasses(): string {
    return `pf-seg bar sz-${this.size}`;
  }

  itemClasses(v: T): string {
    return 'pf-seg__item seg-item' + (v === this.value ? ' is-selected' : '');
  }

  hasIcon(opt: SegmentedOption<T>): boolean {
    if (this.showIcons === false || this.mode === 'text' || this.mode === 'text-only' || opt.mode === 'text') {
      return false;
    }
    return !!(opt.iconPath?.length || opt.icon);
  }

  hasText(opt: SegmentedOption<T>): boolean {
    if (this.mode === 'icon' || opt.mode === 'icon') {
      return false;
    }
    return true;
  }

  select(v: T, ev?: MouseEvent, target?: HTMLElement): void {
    const opt = this.options.find(o => o.value === v);
    if (opt?.disabled) return;
    if (ev) {
      this.optionClick.emit({ value: v, option: opt!, event: ev, target: target ?? (ev.currentTarget as HTMLElement) });
    }
    if (this.allowDeselect && this.value === v) {
      this.value = (null as unknown) as T;
      this.valueChange.emit(this.value);
      return;
    }
    if (v === this.value) return;
    this.value = v;
    this.valueChange.emit(v);
  }

  clearOption(opt: SegmentedOption<T>, ev: MouseEvent): void {
    this.optionClear.emit({ value: opt.value, option: opt, event: ev });
  }

  onKeydown(ev: KeyboardEvent): void {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(ev.key)) return;
    ev.preventDefault();
    if (!this.options?.length) return;
    const enabled = this.options.filter(o => !o.disabled);
    if (!enabled.length) return;
    const currIdx = enabled.findIndex(o => o.value === this.value);
    let nextIdx = 0;
    if (ev.key === 'Home') nextIdx = 0;
    else if (ev.key === 'End') nextIdx = enabled.length - 1;
    else if (ev.key === 'ArrowRight') nextIdx = (currIdx + 1) % enabled.length;
    else if (ev.key === 'ArrowLeft') nextIdx = (currIdx - 1 + enabled.length) % enabled.length;
    this.select(enabled[nextIdx].value);
  }
}
