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
                [title]="opt.hint || ''"
                (click)="select(opt.value)">
          @if (opt.dot) { <span class="seg-dot" [style.background]="opt.dot" aria-hidden="true"></span> }
          {{ opt.label }}
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
    .seg-dot { width: 7px; height: 7px; border-radius: 9999px; flex-shrink: 0; }
    .seg-count {
      font-size: 11px; font-weight: 600;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
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
