import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { FormFieldCategory, FormFieldType } from './form-field.model';
import { fieldTypesByCategory } from './field-registry';
import { PfSelectOptGroup, PfSelectSize, SelectComponent } from '../primitives/select.component';

const CATEGORY_LABELS: Record<FormFieldCategory, string> = {
  input:    'Input',
  choice:   'Choice',
  layout:   'Layout',
  media:    'Media',
  advanced: 'Advanced'
};

@Component({
  selector: 'pf-field-type-picker',
  standalone: true,
  imports: [SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pf-select
      [size]="size"
      [options]="[]"
      [groups]="groupOptions()"
      [value]="value"
      [placeholder]="placeholder"
      [disabled]="disabled"
      [attr.aria-label]="ariaLabel || 'Field type'"
      (valueChange)="valueChange.emit($any($event))">
    </pf-select>
  `
})
export class FieldTypePickerComponent {
  @Input() value: FormFieldType | '' = '';
  @Input() size: PfSelectSize = 'md';
  @Input() placeholder = 'Select field type…';
  @Input() disabled = false;
  @Input() ariaLabel?: string;
  @Input() set showDisabledTypes(v: boolean) { this._showAll.set(v); }

  @Output() valueChange = new EventEmitter<FormFieldType>();

  private readonly _showAll = signal(false);

  readonly groupOptions = computed<PfSelectOptGroup<FormFieldType>[]>(() => {
    const grouped = fieldTypesByCategory(!this._showAll());
    return (Object.keys(grouped) as FormFieldCategory[])
      .map(cat => ({
        label: CATEGORY_LABELS[cat],
        options: grouped[cat].map(e => ({
          value: e.type,
          label: e.label,
          disabled: !e.enabled
        }))
      }))
      .filter(g => g.options.length > 0);
  });
}
