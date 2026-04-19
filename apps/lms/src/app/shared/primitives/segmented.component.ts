import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';

export interface SegmentedOption<T = string> {
  value: T;
  label: string;
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
                (click)="select(opt.value)">
          {{ opt.label }}
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
    .seg-item:active { transform: scale(0.97); }
    .seg-item:hover  { color: var(--text-primary); }

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
