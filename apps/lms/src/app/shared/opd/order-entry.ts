import { CartMode } from './module-scope';

/**
 * Pure routing decision for the "new order" entry points (OPD build). Given the
 * user's cart mode, decide which screen a *new* order should open. Kept DOM-free
 * so the branching is unit-tested and the same decision is reused at every
 * entry point (frontdesk landing, patient profile, search, post-register).
 *
 * SAFETY INVARIANT: `'lab'` (and the inert `'none'`/default) → the existing lab
 * order-create target, byte-identical to today. OPD only diverts when the mode
 * is genuinely `'opd'` or `'choose'`, which cannot happen until a tenant has OPD
 * on AND the user is OPD-scoped.
 */
export interface NavTarget {
  commands: unknown[];
  queryParams?: Record<string, string>;
}

export function labOrderTarget(patientId?: string | null): NavTarget {
  return patientId
    ? { commands: ['/frontdesk/order'], queryParams: { patientId } }
    : { commands: ['/frontdesk/order'] };
}

export function consultTarget(patientId?: string | null): NavTarget {
  return patientId
    ? { commands: ['/frontdesk/consult'], queryParams: { patientId } }
    : { commands: ['/frontdesk/consult'] };
}

/**
 * Where a NEW order should go. `'choose'` means "ask the user" (both modules
 * usable) — the caller resolves it to a target after the user picks.
 */
export function newOrderTarget(mode: CartMode, patientId?: string | null): NavTarget | 'choose' {
  if (mode === 'opd') return consultTarget(patientId);
  if (mode === 'choose') return 'choose';
  return labOrderTarget(patientId); // 'lab' | 'none' → lab (today's behaviour)
}
