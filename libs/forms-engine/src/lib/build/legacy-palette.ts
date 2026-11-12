import { FieldDef, FormDefinition, OptionDef } from '../core/types';
import { FieldSlot, insertField, newField } from './doc';

/**
 * The components palette of the legacy Studio ("Input Fields", "Selection Fields", "Special Fields"), in the same words and the same
 * order, each mapped onto one of our kinds with the settings that make it behave as the old one did. The 4th group, "Department",
 * holds the kinds the old Studio never had. ONE table: the palette and its spec read this.
 */
export type PaletteGroup = 'Input Fields' | 'Selection Fields' | 'Special Fields' | 'Department';

export interface PaletteEntry {
  /** Stable id (a data attribute for tests). */
  id: string;
  /** The legacy name; the new question starts with this label. */
  label: string;
  /** A glyph name from the engine's icon set. */
  icon: string;
  group: PaletteGroup;
  kind: string;
  /** Settings the legacy component implied, on top of the kind's own defaults. */
  config?: Record<string, unknown>;
  /** Starting choices, when the legacy component had its own (a toggle starts with No / Yes). */
  options?: { key: string; label: string }[];
  /** One short line for the tile's tooltip. */
  hint: string;
}

export const PALETTE_GROUPS: PaletteGroup[] = ['Input Fields', 'Selection Fields', 'Special Fields', 'Department'];

export const PALETTE: PaletteEntry[] = [
  // ---- Input Fields
  { id: 'text', label: 'Text Input', icon: 'text', group: 'Input Fields', kind: 'text', config: { voice: false }, hint: 'One line of words' },
  { id: 'number', label: 'Number', icon: 'k-number', group: 'Input Fields', kind: 'number', hint: 'A number, with a unit if you like' },
  { id: 'textarea', label: 'Text Area', icon: 'text', group: 'Input Fields', kind: 'text', config: { multiline: true, voice: false }, hint: 'Several lines of words' },
  { id: 'voice', label: 'Voice Input', icon: 'mic', group: 'Input Fields', kind: 'text', config: { multiline: true, voice: true }, hint: 'Several lines, spoken or typed' },
  { id: 'phone', label: 'Phone', icon: 'phone', group: 'Input Fields', kind: 'text', config: { format: 'phone', voice: false }, hint: 'A phone number' },
  { id: 'email', label: 'Email', icon: 'message', group: 'Input Fields', kind: 'text', config: { format: 'email', voice: false }, hint: 'An e-mail address' },
  { id: 'date', label: 'Date', icon: 'calendar', group: 'Input Fields', kind: 'date', hint: 'A date' },
  // ---- Selection Fields
  { id: 'select', label: 'Dropdown', icon: 'chevron-down', group: 'Selection Fields', kind: 'choice', config: { display: 'dropdown' }, hint: 'Pick one from a drop-down list' },
  { id: 'multiselect', label: 'Multi-Select', icon: 'list-check', group: 'Selection Fields', kind: 'multi', hint: 'Pick any number of choices' },
  { id: 'radio', label: 'Radio Buttons', icon: 'k-choice', group: 'Selection Fields', kind: 'choice', config: { display: 'list' }, hint: 'Pick one from a short list' },
  { id: 'checkbox', label: 'Checkbox', icon: 'check', group: 'Selection Fields', kind: 'multi', hint: 'Tick any that apply (multiple choice)' },
  { id: 'buttonSelect', label: 'Button Select', icon: 'k-choice', group: 'Selection Fields', kind: 'choice', config: { display: 'buttons' }, hint: 'Pick one with big buttons' },
  { id: 'yesNoNa', label: 'Yes/No', icon: 'k-yesno', group: 'Selection Fields', kind: 'yesno', hint: 'Yes or No buttons' },
  {
    id: 'toggle', label: 'Toggle Switch', icon: 'k-yesno', group: 'Selection Fields', kind: 'yesno', config: { display: 'switch', labelFallback: true },
    options: [{ key: 'no', label: 'No' }, { key: 'yes', label: 'Yes' }], hint: 'A yes / no slider (two words you choose)',
  },
  // ---- Special Fields
  { id: 'duration', label: 'Duration', icon: 'k-duration', group: 'Special Fields', kind: 'duration', hint: 'How long: days, weeks, months, years' },
  { id: 'duration-time', label: 'Duration (Time)', icon: 'k-duration', group: 'Special Fields', kind: 'duration', config: { scale: 'clock' }, hint: 'How long: seconds, minutes, hours' },
  { id: 'duration-period', label: 'Time of Day', icon: 'med-clock', group: 'Special Fields', kind: 'duration', config: { scale: 'period' }, hint: 'Morning, afternoon, evening, night' },
  { id: 'imageSelect', label: 'Image Select', icon: 'image', group: 'Special Fields', kind: 'choice', config: { display: 'images' }, hint: 'Pick one picture from a few' },
  { id: 'multiTextbox', label: 'Multi-Textbox', icon: 'k-grid', group: 'Special Fields', kind: 'grid', hint: 'A table of small boxes' },
  { id: 'imageGallery', label: 'Image Gallery', icon: 'k-photo', group: 'Special Fields', kind: 'photos', hint: 'Photos with captions' },
  { id: 'scribblePad', label: 'Scribble Pad', icon: 'k-drawing', group: 'Special Fields', kind: 'drawing', hint: 'Draw or write by hand' },
  { id: 'imageInfo', label: 'Image Info', icon: 'k-picture', group: 'Special Fields', kind: 'photoMarkup', hint: 'A picture with marked places' },
  { id: 'size', label: 'Size', icon: 'k-size', group: 'Special Fields', kind: 'size', hint: 'Length, width, height' },
  { id: 'measure', label: 'Measure', icon: 'k-measure', group: 'Special Fields', kind: 'measure', hint: 'A reading on a slider' },
  { id: 'recursive', label: 'Recursive Group', icon: 'k-repeat', group: 'Special Fields', kind: 'repeat', hint: 'The same questions, again and again' },
  { id: 'recursivePages', label: 'Recursive Pages', icon: 'k-pages', group: 'Special Fields', kind: 'repeatPages', hint: 'The same pages, again and again' },
  { id: 'eom', label: 'EOM (Eye Movements)', icon: 'k-eye', group: 'Special Fields', kind: 'eyeDiagram', hint: 'Eye movements on a diagram' },
  { id: 'bmi', label: 'BMI', icon: 'k-bmi', group: 'Special Fields', kind: 'bmi', hint: 'Height, weight and BMI' },
  // ---- Department (the kinds the old Studio never had)
  { id: 'sidePair', label: 'Left and Right', icon: 'k-pair', group: 'Department', kind: 'sidePair', hint: 'One question, asked for both sides' },
  { id: 'shorthand', label: 'Shorthand Boxes', icon: 'k-shorthand', group: 'Department', kind: 'shorthand', hint: 'Clinical shorthand in boxes' },
  { id: 'pictureChoice', label: 'Picture Choice', icon: 'k-picture', group: 'Department', kind: 'pictureChoice', hint: 'Parts of a picture to tick' },
  { id: 'bodyMap', label: 'Body Map', icon: 'k-body', group: 'Department', kind: 'bodyMap', hint: 'Mark places on a body' },
  { id: 'readings', label: 'Timed Readings', icon: 'k-readings', group: 'Department', kind: 'readings', hint: 'Readings taken over time' },
  { id: 'plotChart', label: 'Chart', icon: 'k-chart', group: 'Department', kind: 'plotChart', hint: 'Growth, audiogram, partograph' },
  { id: 'familyTree', label: 'Family Tree', icon: 'k-family', group: 'Department', kind: 'familyTree', hint: 'A family tree' },
  { id: 'ageChecklist', label: 'Checklist by Age', icon: 'k-checklist', group: 'Department', kind: 'ageChecklist', hint: 'What to check at each age' },
  { id: 'toothChart', label: 'Tooth Chart', icon: 'k-tooth', group: 'Department', kind: 'toothChart', hint: 'Mark teeth on a chart' },
];

/** The entries of one group, in order. */
export const paletteGroup = (g: PaletteGroup): PaletteEntry[] => PALETTE.filter((e) => e.group === g);

/** The question a palette tile makes: the kind's own start, then the legacy component's settings and choices on top. */
export function paletteField(def: FormDefinition, entry: PaletteEntry, catalogueDefaults: Record<string, unknown> = {}): FieldDef {
  const f = newField(def, entry.kind, { ...catalogueDefaults, ...(entry.config ?? {}) }, entry.label);
  if (entry.options) f.options = entry.options.map((o): OptionDef => ({ key: o.key, label: o.label, subFields: [] }));
  return f;
}

export function addPaletteField(def: FormDefinition, slot: FieldSlot, entry: PaletteEntry, catalogueDefaults: Record<string, unknown> = {}): { def: FormDefinition; key: string } {
  return insertField(def, slot, paletteField(def, entry, catalogueDefaults));
}
