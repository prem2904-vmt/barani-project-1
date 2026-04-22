import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { FormFieldCategory, FormFieldType } from './form-field.model';
import { enabledFieldTypes, FieldTypeEntry, fieldTypesByCategory } from './field-registry';

// Drop-in dropdown that lists every ENABLED field type from the registry,
// grouped by category via native <optgroup>. Used by the test editor for
// "what kind of parameter is this?" and by the workflow builder field
// editor for the same question on workflow fields.

const CATEGORY_LABELS: Record<FormFieldCategory, string> = {
  input:   'Input',
  choice:  'Choice',
  layout:  'Layout',
  media:   'Media',
  advanced:'Advanced'
};

@Component({
  selector: 'pf-field-type-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <select class="pf-field-type-picker"
            [disabled]="disabled"
            (change)="onChange($event)"
            [attr.aria-label]="ariaLabel || 'Field type'">
      @if (placeholder) {
        <option value="" [disabled]="!!value" [selected]="!value">{{ placeholder }}</option>
      }
      @for (group of groups(); track group.category) {
        @if (group.entries.length > 0) {
          <optgroup [label]="group.label">
            @for (entry of group.entries; track entry.type) {
              <option [value]="entry.type" [selected]="entry.type === value">{{ entry.label }}</option>
            }
          </optgroup>
        }
      }
    </select>
  `,
  styles: [`
    :host { display: inline-block; width: 100%; }

    .pf-field-type-picker {
      display: block;
      width: 100%;
      padding: 0.5rem 0.75rem;
      font-size: 13px;
      color: var(--text-primary);
      background: var(--bg-card-solid);
      border: 1px solid var(--border-muted);
      border-radius: 10px;
      appearance: none;
      -webkit-appearance: none;
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237c7c8a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>");
      background-repeat: no-repeat;
      background-position: right 10px center;
      padding-right: 28px;
      cursor: pointer;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    .pf-field-type-picker:hover { border-color: var(--glass-border-hover); }
    .pf-field-type-picker:focus {
      outline: none;
      border-color: rgba(168, 85, 247, 0.6);
      box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.15);
    }
    .pf-field-type-picker:disabled { opacity: 0.5; cursor: not-allowed; }

    optgroup { font-weight: 600; }
    option   { font-weight: 400; }
  `]
})
export class FieldTypePickerComponent {
  @Input() value: FormFieldType | '' = '';
  @Input() placeholder = 'Select field type…';
  @Input() disabled = false;
  @Input() ariaLabel?: string;
  // If true, shows disabled types as greyed-out entries instead of hiding
  // them. Useful in the workflow-builder where an admin should see what's
  // coming vs what's live.
  @Input() set showDisabledTypes(v: boolean) { this._showAll.set(v); }

  @Output() valueChange = new EventEmitter<FormFieldType>();

  private readonly _showAll = signal(false);

  readonly groups = computed(() => {
    const grouped = fieldTypesByCategory(!this._showAll());
    return (Object.keys(grouped) as FormFieldCategory[]).map(category => ({
      category,
      label: CATEGORY_LABELS[category],
      entries: grouped[category]
    }));
  });

  protected onChange(ev: Event) {
    const v = (ev.target as HTMLSelectElement).value as FormFieldType;
    if (v) this.valueChange.emit(v);
  }
}
