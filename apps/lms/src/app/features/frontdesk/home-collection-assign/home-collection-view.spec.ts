import type { Appointment, HomeCollectionAgent } from '../../../shared/models/appointment.model';
import { agentName, agentOptions, filterVisits, visitItem } from './home-collection-view';

const v = (id: string, o: Partial<Appointment> & { name?: string; phone?: string } = {}): Appointment => ({
  id, address: o.address ?? null, pincode: o.pincode ?? null, slotTime: o.slotTime ?? null,
  patient: o.name ? { displayName: o.name, phone: o.phone } : undefined,
} as unknown as Appointment);
const ag = (userId: string, isActive: boolean, user: Record<string, string> = {}): HomeCollectionAgent =>
  ({ id: `a-${userId}`, userId, isActive, user } as unknown as HomeCollectionAgent);

describe('home-collection view helpers', () => {
  it('agentName falls back display name → name → first + father → email → short id', () => {
    expect(agentName(ag('u1', true, { displayName: 'Ravi S', name: 'x' }))).toBe('Ravi S');
    expect(agentName(ag('u1', true, { name: 'Ravi' }))).toBe('Ravi');
    expect(agentName(ag('u1', true, { firstName: 'Anu', fathersName: 'Mohan' }))).toBe('Anu Mohan');
    expect(agentName(ag('u1', true, { email: 'a@b.c' }))).toBe('a@b.c');
    expect(agentName(ag('abcdefghijkl', true))).toBe('abcdefgh');
  });

  it('agentOptions offers only active agents', () => {
    expect(agentOptions([ag('u1', true, { displayName: 'A' }), ag('u2', false, { displayName: 'B' })]))
      .toEqual([{ value: 'u1', label: 'A' }]);
  });

  it('filterVisits matches every word across patient, address, PIN, slot and phone', () => {
    const list = [v('1', { name: 'Sathish Kumar', address: 'Lake View, Velachery', pincode: '600042', phone: '98400' }), v('2', { name: 'Priya Nair', slotTime: '09:15' })];
    expect(filterVisits(list, '').map(x => x.id)).toEqual(['1', '2']);
    expect(filterVisits(list, 'velachery 600042').map(x => x.id)).toEqual(['1']);
    expect(filterVisits(list, 'PRIYA 09:15').map(x => x.id)).toEqual(['2']);
    expect(filterVisits(list, 'priya velachery')).toEqual([]);
  });

  it('visitItem: facts in the grid order, "No address" in words, Assign primary, selection', () => {
    const it1 = visitItem(v('1', { name: 'Sathish', address: '2/7 Lake View', pincode: '600042', slotTime: '08:00', phone: '98400' }), '1');
    expect(it1.facts).toEqual(['2/7 Lake View', 'PIN 600042', 'Slot 08:00', '98400']);
    expect(it1.primary).toEqual({ id: 'assign', label: 'Assign' });
    expect(it1.selected).toBe(true);
    const it2 = visitItem(v('2'), '1');
    expect(it2.name).toBe('Patient');
    expect(it2.facts?.[0]).toBe('No address');
    expect(it2.selected).toBe(false);
  });
});
