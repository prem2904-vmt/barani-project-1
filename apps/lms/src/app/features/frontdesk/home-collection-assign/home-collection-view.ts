import type { Appointment, HomeCollectionAgent } from '../../../shared/models/appointment.model';
import type { WorkListItem } from '../../../shared/components/work-list/work-list';

/**
 * Pure helpers for Front desk → Unassigned home collections (unit-tested; the component draws).
 * One fact order for the grid columns AND the small-screen list (small-screens-same-grid):
 * Patient · Address · PIN · Slot · Phone.
 */

export const visitName = (a: Appointment): string => a.patient?.displayName || 'Patient';
export const visitAddress = (a: Appointment): string => (a.address ?? '').trim();
export const visitPin = (a: Appointment): string => (a.pincode ?? '').trim();
export const visitSlot = (a: Appointment): string => (a.slotTime ?? '').trim();
export const visitPhone = (a: Appointment): string => (a.patient?.phone ?? '').trim();

/** The agent's display name: display name → name → first + father's name → email → a short id. */
export function agentName(a: HomeCollectionAgent): string {
  const u = a.user;
  return u?.displayName || u?.name
    || [u?.firstName, u?.fathersName].filter(Boolean).join(' ')
    || u?.email || a.userId.slice(0, 8);
}

/** Only ACTIVE agents can take a visit. */
export function agentOptions(agents: readonly HomeCollectionAgent[]): Array<{ value: string; label: string }> {
  return agents.filter(a => a.isActive).map(a => ({ value: a.userId, label: agentName(a) }));
}

/** The band search: every word must match the patient, address, PIN, slot or phone (case-insensitive). */
export function filterVisits(list: readonly Appointment[], q: string): Appointment[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...list];
  return list.filter(a => {
    const hay = [visitName(a), visitAddress(a), visitPin(a), visitSlot(a), visitPhone(a)].join(' ').toLowerCase();
    return words.every(w => hay.includes(w));
  });
}

/** A visit as a shared work-list row: the name, the facts in the grid's column order, Assign at the right edge. */
export function visitItem(a: Appointment, selectedId: string | null): WorkListItem<Appointment> {
  return {
    id: a.id,
    name: visitName(a),
    facts: [visitAddress(a) || 'No address', visitPin(a) && `PIN ${visitPin(a)}`, visitSlot(a) && `Slot ${visitSlot(a)}`, visitPhone(a)],
    status: { now: 'No agent yet' },
    primary: { id: 'assign', label: 'Assign' },
    selected: a.id === selectedId,
    key: a.id,
    data: a,
  };
}
