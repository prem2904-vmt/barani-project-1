import { orderPartnerLines, orderPartnerBody } from './order-partner-picks.logic';

const PARTNERS = [{ id: 'v1', name: 'Metro Labs', isActive: true }, { id: 'v2', name: 'Quest Partner', isActive: true }, { id: 'v3', name: 'Old Lab', isActive: false }];
const TESTS: Record<string, any> = {
  tsh: { id: 'tsh', name: 'TSH', type: 'individual', outsourcedVendorId: 'v1' },
  cbc: { id: 'cbc', name: 'CBC', type: 'individual' },
  bone: { id: 'bone', name: 'Bone Panel', type: 'package', parameters: JSON.stringify({ items: [{ testId: 'vitd' }] }) },
  vitd: { id: 'vitd', name: 'Vitamin D', type: 'individual', outsourcedVendorId: 'v2' },
};
const byId = (id: string) => TESTS[id];
const line = (testId: string, over: any = {}) => ({ testId, status: 'pending', test: { id: testId, name: TESTS[testId].name }, ...over });
const order = (tests: any[], sample: any = {}) => ({ samples: [{ status: 'pending', tests, ...sample }] });

describe('orderPartnerLines (OPS-106)', () => {
  it('lists only the outsourced ordered items, with the Test Master partner as default and the picker options', () => {
    const rows = orderPartnerLines(order([line('tsh'), line('cbc')]), byId, PARTNERS, false);
    expect(rows.map(r => r.id)).toEqual(['tsh']);
    const r = rows[0];
    expect(r.label).toBe('Outsourced · Metro Labs');
    expect(r.locked).toBe(false);
    expect(r.options.map(o => o.label)).toEqual(['Metro Labs (default)', 'In-house', 'Quest Partner']);   // inactive partner never offered
    expect(r.options[0].value).toBe('');
  });

  it('a bundle is one row (keyed by the ordered package id) and counts through its members', () => {
    const o = order([line('vitd', { packageTestId: 'bone', test: { id: 'vitd', name: 'Vitamin D' } })]);
    const rows = orderPartnerLines(o, byId, PARTNERS, false);
    expect(rows.map(r => r.id)).toEqual(['bone']);
    expect(rows[0].name).toBe('Bone Panel');
    expect(rows[0].defaults).toEqual(['v2']);
  });

  it('a stored pick shows in plain words; in-house too', () => {
    const o1 = order([line('tsh', { outsourcingOverride: 'v2', effectivePartnerId: 'v2' })]);
    const r1 = orderPartnerLines(o1, byId, PARTNERS, false)[0];
    expect(r1.pick).toBe('v2');
    expect(r1.label).toBe('Outsourced · Quest Partner');
    const o2 = order([line('tsh', { outsourcingOverride: 'inhouse', effectivePartnerId: null })]);
    expect(orderPartnerLines(o2, byId, PARTNERS, false)[0].label).toBe('In-house');
  });

  it('locked once the tube is collected or the line moved on, and once the bill is paid (read-only text)', () => {
    const drawn = order([line('tsh', { effectivePartnerId: 'v1' })], { status: 'collected' });
    const r = orderPartnerLines(drawn, byId, PARTNERS, false)[0];
    expect(r.locked).toBe(true);
    expect(r.label).toBe('Outsourced · Metro Labs');
    const moved = order([line('tsh', { status: 'received' })]);
    expect(orderPartnerLines(moved, byId, PARTNERS, false)[0].locked).toBe(true);
    expect(orderPartnerLines(order([line('tsh')]), byId, PARTNERS, true)[0].locked).toBe(true);
  });

  it('a retired default partner still has a name', () => {
    const t = { ...TESTS['tsh'], outsourcedVendorId: 'v3' };
    const rows = orderPartnerLines(order([line('tsh')]), id => (id === 'tsh' ? t : TESTS[id]), PARTNERS, false);
    expect(rows[0].label).toBe('Outsourced · Old Lab');
  });

  it('PATCH body: every ordered item stays, the one pick rides along ("" = back to the Test Master partner)', () => {
    const o = order([line('tsh'), line('cbc'), line('vitd', { packageTestId: 'bone' })]);
    expect(orderPartnerBody(o, 'tsh', 'v2')).toEqual({ testIds: ['tsh', 'cbc', 'bone'], outsourcing: { tsh: 'v2' }, reason: 'billing partner change' });
    expect((orderPartnerBody(o, 'tsh', '') as any).outsourcing).toEqual({ tsh: '' });
  });
});
