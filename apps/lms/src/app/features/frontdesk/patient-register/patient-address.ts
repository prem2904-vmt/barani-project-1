import type { WorkflowConfig } from '../../../shared/models/workflow.model';

/** Field names that live in the registration form's "Contact & IDs" section. */
export const REGISTER_CONTACT_FIELDS = new Set(['phone', 'email', 'abha_id', 'aadhaar_last4']);

export const isAddressField = (f: { name?: string; storageKey?: string }) =>
  f.name === 'address' || f.storageKey === 'metadata.address';

/** A field shown in the "Contact & IDs" section: the phone / email / ID fields and the address. */
export const isContactField = (f: { name?: string; storageKey?: string }) =>
  REGISTER_CONTACT_FIELDS.has(f.name ?? '') || isAddressField(f);

/**
 * OPS-119 follow-up: the address / place sits with the other contact fields
 * ("Contact & IDs"), not under "Additional details". The field MOVES (not
 * copied) inside the loaded config, so the storage key (`<step>::address`),
 * initial values and save all agree with where it is shown. Only the classic
 * `basic_info` step is touched, and only when it has contact fields; any other
 * form (custom steps) is returned as it is.
 */
export function addressIntoContact(cfg: WorkflowConfig): WorkflowConfig {
  const basic = cfg.steps.find(s => s.name === 'basic_info');
  if (!basic || !basic.fields.some(f => REGISTER_CONTACT_FIELDS.has(f.name))) return cfg;
  if (basic.fields.some(isAddressField)) return cfg; // already there
  const donor = cfg.steps.find(s => s !== basic && s.fields.some(isAddressField));
  if (!donor) return cfg;
  const addr = donor.fields.find(isAddressField)!;
  return {
    ...cfg,
    steps: cfg.steps.map(s =>
      s === donor ? { ...s, fields: s.fields.filter(f => f !== addr) }
      : s === basic ? { ...s, fields: [...s.fields, addr] }
      : s),
  };
}

/** The patient's address / place line from the registration attributes
 *  (`attributes.address`, plus district / state when ABHA brought them). */
export function patientAddressLine(attributes: string | null | undefined): string {
  if (!attributes) return '';
  let a: Record<string, unknown>;
  try { a = JSON.parse(attributes); } catch { return ''; }
  const pick = (k: string) => (typeof a?.[k] === 'string' ? (a[k] as string).trim() : '');
  return [pick('address'), pick('district'), pick('state')].filter(Boolean).join(', ');
}
