import {
  ChangeDetectionStrategy, Component, EventEmitter,
  Input, Output
} from '@angular/core';

export interface PfSelectOption<T = string> {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
}

export type PfSelectSize = 'sm' | 'md';

@Component({
  selector: 'pf-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <select
      class="pf-select"
      [attr.data-size]="size"
      [disabled]="disabled"
      [value]="value"
      (change)="onChange($event)">
      @if (placeholder && (value === undefined || value === null || value === '')) {
        <option value="" disabled selected>{{ placeholder }}</option>
      }
      @for (opt of options; track opt.value) {
        <option [value]="opt.value" [disabled]="opt.disabled ?? false">{{ opt.label }}</option>
      }
    </select>
  `,
  styles: [`
    :host { display: inline-block; width: 100%; }

    .pf-select {
      display: block;
      width: 100%;
      padding: 0.625rem 0.875rem;
      padding-right: 2.25rem;
      height: auto;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      color: var(--input-text);
      border-radius: 12px;
      font-size: 0.9375rem;
      cursor: pointer;
      appearance: none;
      -webkit-appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 0.875rem center;
      outline: none;
      transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }

    .pf-select[data-size='sm'] {
      padding: 0.4rem 0.75rem;
      padding-right: 2rem;
      font-size: 13px;
      border-radius: 10px;
      background-position: right 0.75rem center;
    }

    .pf-select:focus {
      border-color: var(--input-border-focus);
      box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.18);
    }

    .pf-select:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .pf-select option {
      background: var(--input-bg);
      color: var(--input-text);
    }
  `]
})
export class SelectComponent<T = unknown> {
  @Input({ required: true }) options: PfSelectOption<T>[] = [];
  @Input() value!: T;
  @Input() placeholder = 'Select…';
  @Input() size: PfSelectSize = 'md';
  @Input() disabled = false;

  @Output() valueChange = new EventEmitter<T>();

  onChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const opt = this.options[select.selectedIndex - (this.placeholder ? 1 : 0)];
    if (opt) this.valueChange.emit(opt.value);
  }
}
