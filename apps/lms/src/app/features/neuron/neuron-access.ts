/** Who may do what in Neuron (prefrontal-mw `/api/office` enforces the same sets; the UI only hides what would be a 403). */
export const NEURON_READ_PERMS = ['view_report', 'validate_result', 'enter_result', 'view_analytics'] as const;
export const NEURON_WRITE_PERMS = ['validate_result', 'enter_result', 'view_analytics'] as const;
export const NEURON_INSERT_PERMS = ['view_report', 'validate_result', 'enter_result'] as const;
/** Without this the server blanks the Patient column of inserted results. */
export const PATIENT_DATA_PERM = 'export_patient_data';
export const PATIENT_HIDDEN_NOTE = 'Patient names are hidden for your role.';

export interface NeuronAccess { read: boolean; write: boolean; insert: boolean; patientNames: boolean }

/** `has(codes)` = the person holds at least one of these (AuthService.hasAnyPermission). */
export function neuronAccess(has: (codes: string[]) => boolean): NeuronAccess {
  return {
    read: has([...NEURON_READ_PERMS]),
    write: has([...NEURON_WRITE_PERMS]),
    insert: has([...NEURON_INSERT_PERMS]),
    patientNames: has([PATIENT_DATA_PERM]),
  };
}
