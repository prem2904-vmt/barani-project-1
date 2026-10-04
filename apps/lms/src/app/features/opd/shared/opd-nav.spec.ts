import { OPD_AREAS, OpdArea, opdAreasFor, orderOpdAreas } from './opd-nav';

/**
 * opdAreasFor / orderOpdAreas — the ONE "can this user open at least one OPD
 * area" rule and the hub's doctor-first ordering. Reused by the OPD home hub
 * AND the shell nav's "OPD" primary tab (top strip + bottom nav) so the two
 * never drift apart (see layout/nav-items.ts / top-strip / bottom-nav).
 */
describe('opdAreasFor', () => {
  it('keeps every area with no permission requirement for ANY signed-in user', () => {
    const any = () => false; // holds nothing at all
    const ids = opdAreasFor(any).map(a => a.id);
    // Consults, Pharmacy, the walk-in counter and Pharmacy stock carry no
    // permission — only their own opdGuard route guard protects them.
    expect(ids).toEqual(expect.arrayContaining(['consult', 'pharmacy', 'counter', 'stock']));
    // Desk/Book/Queue/Vitals (FRONT) and Settings (ADMIN_PERMS) are excluded.
    expect(ids).not.toEqual(expect.arrayContaining(['desk', 'book', 'queue', 'vitals', 'settings']));
    expect(ids.length).toBeGreaterThan(0);
  });

  it('admits the front-desk areas for create_order/register_patient/view_order', () => {
    const front = (perms: string[]) => perms.includes('create_order');
    const ids = opdAreasFor(front).map(a => a.id);
    expect(ids).toEqual(expect.arrayContaining(['desk', 'book', 'queue', 'vitals']));
    expect(ids).not.toContain('settings');
  });

  it('admits OPD settings only for an admin permission', () => {
    const admin = (perms: string[]) => perms.includes('manage_tests');
    expect(opdAreasFor(admin).map(a => a.id)).toContain('settings');
  });

  it('is exactly the OPD home hub tile filter (same predicate as the hub)', () => {
    const has = (perms: string[]) => perms.includes('create_order');
    const expected = OPD_AREAS.filter((a: OpdArea) => !a.permissions?.length || has(a.permissions));
    expect(opdAreasFor(has)).toEqual(expected);
  });
});

describe('orderOpdAreas', () => {
  it('leaves the order unchanged for a non-doctor', () => {
    expect(orderOpdAreas(OPD_AREAS, false)).toEqual(OPD_AREAS);
  });

  it('puts Consults first for a doctor, without dropping or reordering the rest', () => {
    const ordered = orderOpdAreas(OPD_AREAS, true);
    expect(ordered[0].id).toBe('consult');
    expect(ordered.map(a => a.id).sort()).toEqual(OPD_AREAS.map(a => a.id).sort());
    // Everything else keeps its relative order (minus 'consult').
    const restBefore = OPD_AREAS.filter(a => a.id !== 'consult').map(a => a.id);
    const restAfter = ordered.slice(1).map(a => a.id);
    expect(restAfter).toEqual(restBefore);
  });

  it('is a no-op on an already-consult-first list', () => {
    const already = orderOpdAreas(OPD_AREAS, true);
    expect(orderOpdAreas(already, true)).toEqual(already);
  });

  it('is a no-op on a filtered list missing consult', () => {
    const noConsult = OPD_AREAS.filter(a => a.id !== 'consult');
    expect(orderOpdAreas(noConsult, true)).toEqual(noConsult);
  });
});
