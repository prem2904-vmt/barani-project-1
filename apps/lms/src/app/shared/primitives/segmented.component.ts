import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';

export interface SegmentedOption<T = string> {
  value: T;
  label: string;
  /** Greyed out + unclickable; `hint` explains why (shown as tooltip). */
  disabled?: boolean;
  hint?: string;
  /** Optional state colour — rendered as a leading dot, so the toggle
   *  doubles as the legend for colour-coded rows. */
  dot?: string;
  /** Optional count shown after the label. */
  count?: number;
  /** Optional SVG path data. When present, PHONES show the icon instead of
   *  the label (owner: the filters should be icons on mobile) — the label
   *  still drives the tooltip and the accessible name. Tinted with `dot`,
   *  so the colour legend survives the words going away. */
  iconPath?: string[];
}

export type SegmentedSize = 'sm' | 'md';

@Component({
  selector: 'pf-segmented',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div [class]="rootClasses">
      @for (opt of options; track opt.value) {
        <button type="button"
                [class]="itemClasses(opt.value)"
                [disabled]="opt.disabled ?? false"
                [title]="opt.hint || opt.label"
                [attr.aria-label]="opt.label"
                (click)="select(opt.value)">
          @if (opt.iconPath?.length) {
            <svg class="seg-ico" width="17" height="17" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round"
                 stroke-linejoin="round" [style.color]="opt.dot || null" aria-hidden="true">
              @for (d of opt.iconPath!; track d) { <path [attr.d]="d"/> }
            </svg>
          }
          @if (opt.dot) { <span class="seg-dot" [style.background]="opt.dot" aria-hidden="true"></span> }
          <span class="seg-lbl">{{ opt.label }}</span>
          @if (opt.count !== undefined) { <span class="seg-count">{{ opt.count }}</span> }
        </button>
      }
    </div>
  `,
  styles: [`
    :host { display: inline-flex; }
    .bar {
      display: inline-flex;
      padding: 4px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }
    .sz-sm { padding: 2px; }

    .seg-item {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-weight: 500;
      border-radius: 9999px;
      color: var(--text-tertiary);
      transition: background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease, transform 0.08s ease;
      cursor: pointer;
    }
    .seg-item { gap: 7px; }
    /* Words on web/iPad; the icon only takes over on phones (below). */
    .seg-ico { display: none; flex-shrink: 0; }
    .seg-dot { width: 7px; height: 7px; border-radius: 9999px; flex-shrink: 0; }
    .seg-count {
      font-size: 11px; font-weight: 600;
      font-variant-numeric: tabular-nums;
      opacity: 0.8;
    }
    .seg-item:active:not(:disabled) { transform: scale(0.97); }
    .seg-item:hover:not(:disabled)  { color: var(--text-primary); }
    .seg-item:disabled { opacity: 0.4; cursor: not-allowed; }

    .sz-md .seg-item { height: 40px; padding: 0 20px; font-size: 13px; }
    .sz-sm .seg-item { height: 32px; padding: 0 16px; font-size: 12px; }

    .seg-item.is-selected {
      background: var(--gradient-primary);
      color: #ffffff;
      box-shadow: 0 4px 14px rgba(124, 58, 237, 0.35);
    }

    /* ── Phone (<=640px) ────────────────────────────────────────
       These strips now live inside the hero band's scrollable filter
       row, so they must never shrink or wrap — they scroll instead. */
    @media (max-width: 640px) {
      :host { flex-shrink: 0; max-width: none; }
      .bar { flex-wrap: nowrap; }
      .seg-item { flex-shrink: 0; white-space: nowrap; }
      /* Icons replace the words on phones — five labelled chips do not fit
         a 390px row. The icon carries the option's dot colour so the legend
         still reads, and the count stays because that is the useful part. */
      .seg-ico { display: block; }
      /* ONLY swap the word out when there is an icon to swap in. Hiding
         every label left icon-less strips (Validate's My queue / All
         pathologists) rendering as blank pills. */
      .seg-item:has(.seg-ico) .seg-lbl { display: none; }
      .seg-item:has(.seg-ico) .seg-dot { display: none; }
      .seg-item:has(.seg-ico) { padding: 0 12px; gap: 6px; }
      /* Comfortable thumb target; sm was 32px. */
      .sz-sm .seg-item { height: 40px; padding: 0 14px; font-size: 12.5px; }
      .sz-md .seg-item { height: 42px; }
      /* NB: the selected pill's gradient is already quieted in BOTH themes
         by the global primary-colour rule in styles.scss
         (:root.{light,dark}.design-new button[class*="is-selected"]).
         Nothing to do here. */
      /* Blur is the costliest GPU op on weak phones. */
      .bar { backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
    }
  `]
})
export class SegmentedComponent<T = string> {
  @Input({ required: true }) options: SegmentedOption<T>[] = [];
  @Input() value!: T;
  @Input() size: SegmentedSize = 'md';
  @Output() valueChange = new EventEmitter<T>();

  get rootClasses(): string {
    return `bar sz-${this.size}`;
  }

  itemClasses(v: T): string {
    return 'seg-item' + (v === this.value ? ' is-selected' : '');
  }

  select(v: T): void {
    if (v === this.value) return;
    this.value = v;
    this.valueChange.emit(v);
  }
}
