import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

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
  /** Whether this option has an inline clear button when active (e.g. custom date range with value). */
  clearable?: boolean;
}

export type SegmentedSize = 'sm' | 'md';
export type SegmentedDisplayMode = 'auto' | 'both' | 'text' | 'icon' | 'icon-text' | 'text-only';

@Component({
  selector: 'pf-segmented',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div [class]="rootClasses" role="radiogroup" [attr.aria-label]="ariaLabel || 'Options'" (keydown)="onKeydown($event)">
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
                [attr.aria-label]="opt.label"
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
  `,
  styles: [`
    :host { display: inline-flex; vertical-align: middle; }
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

    @media (max-width: 640px) {
      :host { flex-shrink: 0; max-width: none; }
      .bar { flex-wrap: nowrap; }
      .seg-item { flex-shrink: 0; white-space: nowrap; }
    }
  `]
})
export class SegmentedComponent<T = string> {
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

  @Output() valueChange = new EventEmitter<T>();
  @Output() optionClick = new EventEmitter<{ value: T; option: SegmentedOption<T>; event: MouseEvent; target: HTMLElement }>();
  @Output() optionClear = new EventEmitter<{ value: T; option: SegmentedOption<T>; event: MouseEvent }>();

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

  select(v: T, ev?: MouseEvent): void {
    const opt = this.options.find(o => o.value === v);
    if (opt?.disabled) return;
    if (ev) {
      this.optionClick.emit({ value: v, option: opt!, event: ev, target: ev.currentTarget as HTMLElement });
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
