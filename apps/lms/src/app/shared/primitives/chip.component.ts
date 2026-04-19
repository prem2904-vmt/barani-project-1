import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

export type ChipTone = 'default' | 'violet' | 'pink' | 'emerald' | 'amber' | 'rose' | 'sky' | 'mint' | 'teal';
export type ChipSize = 'sm' | 'md';

@Component({
  selector: 'pf-chip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button"
            [class]="rootClasses"
            [disabled]="disabled"
            (click)="onClick($event)">
      <ng-content select="[icon-left]"></ng-content>
      <ng-content></ng-content>
      <ng-content select="[icon-right]"></ng-content>
    </button>
  `,
  styles: [`
    :host { display: inline-flex; }
    button {
      display: inline-flex;
      align-items: center;
      font-weight: 500;
      border-radius: 9999px;
      border: 1px solid transparent;
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.08s ease;
      white-space: nowrap;
    }
    button:active:not(:disabled) { transform: scale(0.97); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }

    .sz-sm { height: 32px; padding: 0 12px; font-size: 12px; gap: 6px; }
    .sz-md { height: 40px; padding: 0 16px; font-size: 13px; gap: 8px; }

    /* Unselected tones --------------------------------------- */
    .t-default { background: var(--glass-bg);            color: var(--text-secondary); border-color: var(--glass-border); }
    .t-violet  { background: rgba(124, 58, 237, 0.15); color: #c4b5fd; border-color: rgba(124, 58, 237, 0.3); }
    .t-pink    { background: rgba(236, 72, 153, 0.15); color: #f9a8d4; border-color: rgba(236, 72, 153, 0.3); }
    .t-emerald { background: rgba(16, 185, 129, 0.15); color: #6ee7b7; border-color: rgba(16, 185, 129, 0.3); }
    .t-amber   { background: rgba(245, 158, 11, 0.15); color: #fcd34d; border-color: rgba(245, 158, 11, 0.3); }
    .t-rose    { background: rgba(239, 68, 68, 0.15);  color: #fca5a5; border-color: rgba(239, 68, 68, 0.3); }
    .t-sky     { background: rgba(56, 189, 248, 0.15); color: #7dd3fc; border-color: rgba(56, 189, 248, 0.3); }
    .t-mint    { background: rgba(52, 211, 153, 0.15); color: #6ee7b7; border-color: rgba(52, 211, 153, 0.3); }
    .t-teal    { background: rgba(20, 184, 166, 0.15); color: #5eead4; border-color: rgba(20, 184, 166, 0.3); }

    button:hover:not(:disabled) { filter: brightness(1.1); }


    /* Selected state always wins */
    .is-selected.t-default,
    .is-selected {
      background: var(--gradient-primary);
      color: #ffffff;
      border-color: transparent;
      box-shadow: 0 4px 14px rgba(124, 58, 237, 0.3);
    }
  `]
})
export class ChipComponent {
  @Input() tone: ChipTone = 'default';
  @Input() size: ChipSize = 'md';
  @Input() selected = false;
  @Input() disabled = false;

  @Output() tapped = new EventEmitter<MouseEvent>();

  get rootClasses(): string {
    return [
      `sz-${this.size}`,
      `t-${this.tone}`,
      this.selected ? 'is-selected' : ''
    ].filter(Boolean).join(' ');
  }

  onClick(ev: MouseEvent): void {
    if (this.disabled) return;
    this.tapped.emit(ev);
  }
}
