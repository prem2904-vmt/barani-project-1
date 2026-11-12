import type { IconName } from './icons';

/**
 * The icons a page can wear (the legacy Studio's "Medical Icon" picker, redrawn as stroked SVG line icons).
 * `value` is what a page stores in `icon`; `icon` is the glyph in ICONS.
 */
export const MEDICAL_ICONS: { value: string; label: string; icon: IconName }[] = [
  { value: 'user', label: 'Patient', icon: 'med-user' },
  { value: 'clipboard', label: 'Clipboard', icon: 'med-clipboard' },
  { value: 'clock', label: 'Clock', icon: 'med-clock' },
  { value: 'activity', label: 'Activity', icon: 'med-activity' },
  { value: 'wind', label: 'Breathing', icon: 'med-wind' },
  { value: 'droplet', label: 'Blood', icon: 'med-droplet' },
  { value: 'brain', label: 'Brain', icon: 'med-brain' },
  { value: 'heart', label: 'Heart', icon: 'med-heart' },
  { value: 'eye', label: 'Eye', icon: 'med-eye' },
  { value: 'ear', label: 'Ear', icon: 'med-ear' },
  { value: 'thermometer', label: 'Temperature', icon: 'med-thermometer' },
  { value: 'stethoscope', label: 'Stethoscope', icon: 'med-stethoscope' },
  { value: 'pill', label: 'Medicine', icon: 'med-pill' },
  { value: 'syringe', label: 'Injection', icon: 'med-syringe' },
  { value: 'bone', label: 'Bone', icon: 'med-bone' },
  { value: 'tooth', label: 'Tooth', icon: 'med-tooth' },
  { value: 'baby', label: 'Baby', icon: 'med-baby' },
  { value: 'lungs', label: 'Lungs', icon: 'med-lungs' },
  { value: 'flask', label: 'Lab test', icon: 'med-flask' },
  { value: 'bandage', label: 'Wound', icon: 'med-bandage' },
  { value: 'scalpel', label: 'Surgery', icon: 'med-scalpel' },
  { value: 'shield', label: 'Vaccines', icon: 'med-shield' },
];

/** The glyph for a stored page icon (null when none / unknown). */
export function medicalIcon(value: string | undefined | null): IconName | null {
  return MEDICAL_ICONS.find((i) => i.value === value)?.icon ?? null;
}
