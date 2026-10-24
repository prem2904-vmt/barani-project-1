// Central registry for every FormFieldType. Each entry carries display
// metadata + an `enabled` flag so we can ship all types but gate which ones
// appear in the field-type picker. Flip `enabled` here (or at runtime via
// setFieldTypeEnabled) to roll out types one at a time without touching
// call-sites.

import { FormFieldCategory, FormFieldType } from './form-field.model';

export interface FieldTypeEntry {
  type: FormFieldType;
  label: string;
  category: FormFieldCategory;
  enabled: boolean;
  hasOptions: boolean; // drives the options editor in the test editor
  description?: string;
}

// Default table. Only the lab-useful types start enabled; the rest are
// listed but parked — flip `enabled: true` as each widget is implemented.
const DEFAULT_ENTRIES: FieldTypeEntry[] = [
  // INPUT
  { type: 'text',           label: 'Text',             category: 'input',  enabled: true,  hasOptions: false, description: 'Single-line text input' },
  { type: 'number',         label: 'Number',           category: 'input',  enabled: true,  hasOptions: false, description: 'Numeric value with optional unit' },
  { type: 'textarea',       label: 'Text area',        category: 'input',  enabled: true,  hasOptions: false, description: 'Multi-line free text' },
  { type: 'voice-text',     label: 'Voice → text',     category: 'input',  enabled: true, hasOptions: false, description: 'Speech-to-text capture' },
  { type: 'phone',          label: 'Phone',            category: 'input',  enabled: true, hasOptions: false, description: 'Phone number with validation' },
  { type: 'email',          label: 'Email',            category: 'input',  enabled: true, hasOptions: false, description: 'Email with validation' },
  { type: 'date',           label: 'Date',             category: 'input',  enabled: true,  hasOptions: false, description: 'Date picker' },
  { type: 'time',           label: 'Time',             category: 'input',  enabled: true, hasOptions: false, description: 'Time picker' },
  { type: 'datetime',       label: 'Date + time',      category: 'input',  enabled: true, hasOptions: false, description: 'Combined date and time' },
  { type: 'duration',       label: 'Duration',         category: 'input',  enabled: true, hasOptions: false, description: 'Duration (days/weeks/months/years)' },
  { type: 'duration-time',  label: 'Duration (time)',  category: 'input',  enabled: true, hasOptions: false, description: 'Duration (seconds/minutes/hours/days)' },
  { type: 'duration-period',label: 'Time of day',      category: 'input',  enabled: true, hasOptions: false, description: 'Morning/afternoon/evening/night' },

  // CHOICE
  { type: 'select',         label: 'Dropdown',         category: 'choice', enabled: true,  hasOptions: true,  description: 'Single-choice dropdown' },
  { type: 'multiselect',    label: 'Multi-select',     category: 'choice', enabled: true,  hasOptions: true,  description: 'Multi-choice dropdown' },
  { type: 'checkbox',       label: 'Checkbox',         category: 'choice', enabled: true,  hasOptions: false, description: 'Single on/off toggle' },
  { type: 'radio',          label: 'Radio buttons',    category: 'choice', enabled: true,  hasOptions: true,  description: 'Grouped single-choice' },
  { type: 'buttonSelect',   label: 'Button select',    category: 'choice', enabled: true, hasOptions: true,  description: 'Single-choice rendered as pills' },
  { type: 'imageSelect',    label: 'Image select',     category: 'choice', enabled: true, hasOptions: true,  description: 'Choose from image thumbnails' },
  { type: 'yesno',          label: 'Yes / No',         category: 'choice', enabled: true, hasOptions: false, description: 'Binary yes-or-no' },
  { type: 'yesNoNa',        label: 'Yes / No / N-A',   category: 'choice', enabled: true, hasOptions: false, description: 'Yes, no, or not applicable' },
  // A family is built INSIDE a profile (profile editor → "+ Add family"),
  // never picked as a field type on a test — kept for rendering only.
  { type: 'family',         label: 'Family (tree)',    category: 'choice', enabled: false, hasOptions: false, description: 'Answer + sub-choices with quantity, from an option family' },
  { type: 'toggle',         label: 'Toggle switch',    category: 'choice', enabled: true, hasOptions: false, description: 'Visual toggle switch' },

  // LAYOUT
  { type: 'section-header', label: 'Section header',   category: 'layout', enabled: true,  hasOptions: false, description: 'Visual divider with title' },
  { type: 'info-text',      label: 'Info text',        category: 'layout', enabled: true,  hasOptions: false, description: 'Read-only guidance note' },

  // MEDIA / ADVANCED
  { type: 'imageGallery',   label: 'Image gallery',    category: 'media',    enabled: true, hasOptions: false, description: 'Attached images with layout' },
  { type: 'scribblePad',    label: 'Scribble pad',     category: 'media',    enabled: true, hasOptions: false, description: 'Freehand drawing' },
  { type: 'imageInfo',      label: 'Image with markers', category: 'media',  enabled: true, hasOptions: true,  description: 'Clickable markers on an image' },
  { type: 'multiTextbox',   label: 'Multi-textbox',    category: 'advanced', enabled: true, hasOptions: false, description: 'Textboxes arranged in a layout/shape' },
  { type: 'signature',      label: 'Signature',        category: 'media',    enabled: true, hasOptions: false, description: 'Signature pad' },
  { type: 'file-upload',    label: 'File upload',      category: 'media',    enabled: true, hasOptions: false, description: 'Attach arbitrary files' },
  { type: 'size',           label: 'Size measurement', category: 'advanced', enabled: true, hasOptions: false, description: 'Dimension inputs with unit' },
  { type: 'measure',        label: 'Measure (slider)', category: 'advanced', enabled: true, hasOptions: false, description: 'Slider-based measurement' },
  { type: 'table',          label: 'Table / grid',     category: 'advanced', enabled: true, hasOptions: false, description: 'Row-repeating grid' },
  { type: 'recursive',      label: 'Recursive group',  category: 'advanced', enabled: true, hasOptions: false, description: 'Group that repeats N times' },
  { type: 'recursivePages', label: 'Recursive pages',  category: 'advanced', enabled: true, hasOptions: false, description: 'Pages that repeat N times' }
];

// Mutable copy so runtime overrides (setFieldTypeEnabled) can stick for the
// lifetime of the app session.
const REGISTRY: Map<FormFieldType, FieldTypeEntry> = new Map(DEFAULT_ENTRIES.map(e => [e.type, { ...e }]));

export function allFieldTypes(): FieldTypeEntry[] {
  return Array.from(REGISTRY.values());
}

export function enabledFieldTypes(): FieldTypeEntry[] {
  return allFieldTypes().filter(e => e.enabled);
}

export function getFieldType(type: FormFieldType): FieldTypeEntry | undefined {
  return REGISTRY.get(type);
}

export function isFieldTypeEnabled(type: FormFieldType): boolean {
  return !!REGISTRY.get(type)?.enabled;
}

export function hasOptions(type: FormFieldType): boolean {
  return !!REGISTRY.get(type)?.hasOptions;
}

export function setFieldTypeEnabled(type: FormFieldType, enabled: boolean): void {
  const entry = REGISTRY.get(type);
  if (entry) entry.enabled = enabled;
}

// Grouped view for the picker UI.
export function fieldTypesByCategory(onlyEnabled = true): Record<FormFieldCategory, FieldTypeEntry[]> {
  const source = onlyEnabled ? enabledFieldTypes() : allFieldTypes();
  const out: Record<FormFieldCategory, FieldTypeEntry[]> = {
    input: [], choice: [], layout: [], media: [], advanced: []
  };
  for (const e of source) out[e.category].push(e);
  return out;
}
