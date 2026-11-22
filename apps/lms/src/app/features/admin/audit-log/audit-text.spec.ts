import { AuditLog, AuditRef } from '../../../shared/models/audit.model';
import {
  AUDIT_AREAS, ENTITY_RULES, STATUS_WORDS, areaOf, csvRow, dayLabel, describeRow, entityTypesOf, friendlyChanges,
  groupByDay, groupEvents, humanize, initialsOf, plainValue, sentenceText,
} from './audit-text';

/**
 * The ONE audit mapping table: every sentence, plain word and fallback the
 * Audit trail prints. IDs never show — a GUID only ever comes out as a name
 * from the server's refs or as a plain noun.
 */
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const ORDER = '11111111-1111-4111-8111-111111111111';
const SAMPLE = '22222222-2222-4222-8222-222222222222';
const SAMPLE2 = '22222222-2222-4222-8222-222222222223';
const LINE = '33333333-3333-4333-8333-333333333333';
const TEST = '44444444-4444-4444-8444-444444444444';
const USER = '55555555-5555-4555-8555-555555555555';
const RAVI = '66666666-6666-4666-8666-666666666666';
const ROLE = '77777777-7777-4777-8777-777777777777';
const UR = '88888888-8888-4888-8888-888888888888';
const BRANCH = '99999999-9999-4999-8999-999999999999';
const PAT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const REFS: Record<string, AuditRef> = {
  [ORDER]: { kind: 'order', label: 'LAB-2611-000016', orderId: ORDER, patient: 'Mr. Kumar Prem' },
  [SAMPLE]: { kind: 'sample', label: 'S-0042', orderId: ORDER },
  [SAMPLE2]: { kind: 'sample', label: 'S-0043', orderId: ORDER },
  [LINE]: { kind: 'orderTest', label: 'Complete Blood Count', orderId: ORDER, sampleId: SAMPLE },
  [TEST]: { kind: 'test', label: 'Iron studies panel' },
  [USER]: { kind: 'user', label: 'Admin User' },
  [RAVI]: { kind: 'user', label: 'Ravi Kumar' },
  [ROLE]: { kind: 'role', label: 'Phlebotomist' },
  [UR]: { kind: 'userRole', label: 'Ravi Kumar', sub: 'Phlebotomist at Chennai Main' },
  [BRANCH]: { kind: 'branch', label: 'Chennai Main' },
};

let seq = 0;
function row(p: Omit<Partial<AuditLog>, 'changes'> & { changes?: unknown }): AuditLog {
  const changes = typeof p.changes === 'string' || p.changes === undefined ? p.changes as string | undefined : JSON.stringify(p.changes);
  return {
    id: 'row-' + ++seq, entityType: 'OrderEntity', entityId: ORDER, action: 'update', userId: USER, userName: 'admin@lab',
    at: '2026-11-19T06:26:00.000Z', ...p, changes,
  } as AuditLog;
}
const say = (log: AuditLog, refs: Record<string, AuditRef> = REFS) => sentenceText(describeRow(log, refs));

describe('audit text — sentences from the one table', () => {
  it('order billed: who, verb, order number, patient', () => {
    const r = row({ changes: { status: { old: 'collected', new: 'billed' }, updatedAt: { old: 'a', new: 'b' } } });
    expect(say(r)).toBe('Admin User billed order LAB-2611-000016 for Mr. Kumar Prem');
    expect(describeRow(r, REFS).area).toBe('orders');
    expect(describeRow(r, REFS).link).toEqual({ label: 'Open order', url: `/o/${ORDER}` });
  });

  it('sample collected names the sample number, patient and order', () => {
    const r = row({ entityType: 'OrderSampleEntity', entityId: SAMPLE, userId: RAVI, changes: { status: { old: 'pending', new: 'collected' } } });
    expect(say(r)).toBe('Ravi Kumar collected S-0042 for Mr. Kumar Prem · LAB-2611-000016');
    expect(describeRow(r, REFS).area).toBe('samples');
  });

  it('a validated line is a Results event with the test name', () => {
    const r = row({ entityType: 'OrderTestEntity', entityId: LINE, changes: { status: { old: 'entered', new: 'validated' } } });
    expect(say(r)).toBe('Admin User validated Complete Blood Count for Mr. Kumar Prem · LAB-2611-000016');
    expect(describeRow(r, REFS).area).toBe('results');
  });

  it('Test Master: created with a price, deleted in rose (danger)', () => {
    const created = row({ entityType: 'TestEntity', entityId: TEST, action: 'create', changes: { name: 'Iron studies panel', price: 850 } });
    expect(say(created)).toBe('Admin User created the test Iron studies panel and set its price to ₹850');
    const deleted = row({ entityType: 'TestEntity', entityId: 'gone-id', action: 'delete', changes: { name: 'Vitamin D (25-OH)', price: 1200 } });
    const d = describeRow(deleted, REFS);
    expect(sentenceText(d)).toBe('Admin User deleted the test Vitamin D (25-OH) from Test Master');
    expect(d.danger).toBe(true);
    expect(d.area).toBe('tm');
    expect(d.link).toBeNull();
  });

  it('role given at a branch reads like the mock', () => {
    const r = row({ entityType: 'UserRoleEntity', entityId: UR, action: 'create', changes: { userId: RAVI, roleId: ROLE, branchId: BRANCH } });
    expect(say(r)).toBe('Admin User gave Ravi Kumar the Phlebotomist role at Chennai Main');
    expect(describeRow(r, REFS).area).toBe('people');
  });

  it('sign-in events need no record', () => {
    expect(say(row({ entityType: 'Auth', entityId: USER, action: 'login', changes: undefined }))).toBe('Admin User signed in');
    const failed = describeRow(row({ entityType: 'Auth', entityId: USER, action: 'login_failed' }), REFS);
    expect(failed.danger).toBe(true);
  });

  it('unknown entity types fall back to a generic, readable sentence', () => {
    const r = row({ entityType: 'BranchEntity', entityId: BRANCH, changes: { name: { old: 'Main', new: 'Main Road' }, updatedAt: { old: 1, new: 2 } } });
    const d = describeRow(r, REFS);
    expect(sentenceText(d)).toBe('Admin User changed a branch (Name: Main → Main Road)');
    expect(d.area).toBe('other');
    const del = describeRow(row({ entityType: 'SomethingNewEntity', entityId: 'x', action: 'delete' }), REFS);
    expect(sentenceText(del)).toBe('Admin User deleted a something new');
    expect(del.danger).toBe(true);
    expect(sentenceText(describeRow(row({ entityType: 'WidgetEntity', entityId: 'x', action: 'widget_rebuilt' }), REFS)))
      .toBe('Admin User widget rebuilt a widget');
  });

  it('a record that cannot be named (another branch, deleted) is a plain noun — never its id', () => {
    const r = row({ entityType: 'OrderSampleEntity', entityId: SAMPLE, changes: { status: { old: 'pending', new: 'received' }, orderId: ORDER } });
    const text = say(r, {});
    expect(text).toBe('admin@lab received a sample');
    expect(text).not.toMatch(GUID);
  });

  it('who: the server name first, never an id; the platform is "Prefrontal"', () => {
    expect(describeRow(row({ userId: undefined, userName: 'Asha' }), {}).who).toBe('Asha');
    expect(describeRow(row({ userId: undefined, userName: USER }), {}).who).toBe('System');
    expect(describeRow(row({ userId: undefined, userName: 'service:platform' }), {}).who).toBe('Prefrontal');
  });

  it('every entity rule says something for create / update / delete without throwing or printing an id', () => {
    for (const type of Object.keys(ENTITY_RULES)) {
      for (const action of ['create', 'update', 'delete']) {
        const d = describeRow(row({ entityType: type, entityId: 'f0000000-0000-4000-8000-000000000000', action, changes: { name: 'X' } }), {});
        expect(d.verb.length, `${type} ${action}`).toBeGreaterThan(0);
        expect(sentenceText(d)).not.toMatch(GUID);
      }
    }
  });
});

describe('audit text — plain words and hidden fields', () => {
  it('statuses map to plain words; technical fields never show', () => {
    const r = row({ changes: { status: { old: 'collected', new: 'billed' }, updatedAt: { old: 'x', new: 'y' }, id: 'z', concurrencyStamp: { old: 1, new: 2 }, metadata: { old: '{}', new: '{"a":1}' } } });
    expect(friendlyChanges(r, REFS)).toEqual([{ field: 'status', label: 'Status', from: 'Sample collected', to: 'Billed' }]);
    expect(STATUS_WORDS['re_entry']).toBe('Sent back for re-entry');
  });

  it('ids in a change become names (or a noun), money gets ₹, booleans Yes / No, priority Urgent', () => {
    const r = row({ entityType: 'OrderTestEntity', entityId: LINE, changes: {
      assignedTo: { old: null, new: RAVI }, testId: { old: TEST, new: 'b0000000-0000-4000-8000-000000000000' },
    } });
    const ch = friendlyChanges(r, REFS);
    expect(ch).toContainEqual({ field: 'assignedTo', label: 'Assigned to', from: '—', to: 'Ravi Kumar' });
    expect(ch).toContainEqual({ field: 'testId', label: 'Test', from: 'Iron studies panel', to: 'a test' });
    expect(JSON.stringify(ch)).not.toMatch(GUID);
    expect(plainValue('price', 1250.5, {})).toBe('₹1,250.5');
    expect(plainValue('isActive', false, {})).toBe('No');
    expect(plainValue('priority', 'stat', {})).toBe('Urgent');
    expect(plainValue('mode', 'upi', {})).toBe('UPI');
    expect(plainValue('somethingId', 'c0000000-0000-4000-8000-000000000000', {})).toBe('a linked record');
    expect(plainValue('currentResult', '{"values":{"HB":"10.2","WBC":"7000"}}', {})).toBe('HB 10.2, WBC 7000');
  });

  it('a create lists only the values that were set', () => {
    const r = row({ action: 'create', changes: { orderNumber: 'LAB-1', priority: 'normal', refDoctorName: null, isDemo: false, patientId: PAT } });
    expect(friendlyChanges(r, {})).toEqual([
      { field: 'orderNumber', label: 'Order number', from: null, to: 'LAB-1' },
      { field: 'priority', label: 'Priority', from: null, to: 'Normal' },
      { field: 'patientId', label: 'Patient', from: null, to: 'a patient' },
    ]);
  });

  it('humanize + initials', () => {
    expect(humanize('TenantCommunicationSettingsEntity')).toBe('Tenant communication settings');
    expect(humanize('tm.re_reviewed')).toBe('Tm re reviewed');
    expect(initialsOf('Dr. Rao')).toBe('R');
    expect(initialsOf('Admin User')).toBe('AU');
  });
});

describe('audit text — areas (the side-card filters)', () => {
  it('six areas in the owner order, each with a token dot', () => {
    expect(AUDIT_AREAS.map(a => a.label)).toEqual(['Orders & billing', 'Samples', 'Results & reports', 'Test Master', 'Settings', 'People & access']);
    for (const a of AUDIT_AREAS) expect(a.dot).toMatch(/^var\(--/);
  });
  it('the area filter sends the entity types of that area', () => {
    expect(entityTypesOf('orders')).toEqual(expect.arrayContaining(['OrderEntity', 'BillEntity', 'PaymentEntity', 'RefundEntity']));
    expect(entityTypesOf('samples')).toContain('OrderSampleEntity');
    expect(entityTypesOf('people')).toEqual(expect.arrayContaining(['UserEntity', 'RoleEntity', 'UserRoleEntity', 'RolePermissionEntity', 'Auth']));
    expect(entityTypesOf('tm')).toContain('TestEntity');
    expect(areaOf('NeverHeardOfEntity')).toBe('other');
  });
});

describe('audit text — merge noise', () => {
  it('rows of one save (same person, moment, order) become ONE event with "Also updated"', () => {
    const logs = [
      row({ id: 'o', changes: { status: { old: 'collected', new: 'billed' } }, at: '2026-11-19T06:26:00.100Z' }),
      row({ id: 's', entityType: 'OrderSampleEntity', entityId: SAMPLE, changes: { status: { old: 'pending', new: 'billed' } }, at: '2026-11-19T06:26:00.120Z' }),
      row({ id: 'b', entityType: 'BillEntity', entityId: 'bill-1', action: 'create', changes: { orderId: ORDER, totalPayable: 450 }, at: '2026-11-19T06:26:00.110Z' }),
    ];
    const ev = groupEvents(logs, REFS);
    expect(ev).toHaveLength(1);
    expect(ev[0].verb).toBe('billed order');
    expect(ev[0].what).toBe('LAB-2611-000016');
    expect(ev[0].rows).toHaveLength(3);
    expect(ev[0].also).toBe('1 bill, 1 sample');
  });

  it('several tubes collected together read as one plural sentence', () => {
    const logs = [SAMPLE, SAMPLE2].map((id, i) => row({ id: 'c' + i, entityType: 'OrderSampleEntity', entityId: id, userId: RAVI,
      changes: { status: { old: 'pending', new: 'collected' } }, at: `2026-11-19T06:10:00.${100 + i}Z` }));
    const ev = groupEvents(logs, REFS);
    expect(ev).toHaveLength(1);
    expect(sentenceText(ev[0])).toBe('Ravi Kumar collected 2 samples for Mr. Kumar Prem · LAB-2611-000016');
    expect(ev[0].also).toBeNull();
  });

  it('a different person, a different order or a later moment stays its own event', () => {
    const base = { changes: { status: { old: 'a', new: 'b' } } };
    const logs = [
      row({ ...base, id: '1', at: '2026-11-19T06:26:10Z' }),
      row({ ...base, id: '2', at: '2026-11-19T06:26:10Z', userId: RAVI }),
      row({ ...base, id: '3', at: '2026-11-19T06:26:10Z', entityId: 'another-order' }),
      row({ ...base, id: '4', at: '2026-11-19T06:20:00Z' }),
    ];
    expect(groupEvents(logs, REFS)).toHaveLength(4);
  });

  it('events group by IST day under Today / Yesterday · date / weekday · date', () => {
    const logs = [
      row({ id: 'a', at: '2026-11-19T05:00:00Z' }),
      row({ id: 'b', at: '2026-11-18T16:00:00Z', entityId: 'o2' }),   // 21:30 IST on the 18th
      row({ id: 'c', at: '2026-11-18T19:00:00Z', entityId: 'o3' }),   // 00:30 IST on the 19th
      row({ id: 'd', at: '2026-11-16T05:00:00Z', entityId: 'o4' }),
    ];
    const days = groupByDay(groupEvents(logs, {}), '2026-11-19');
    expect(days.map(d => d.label)).toEqual(['Today', 'Yesterday · 18 Nov', 'Mon · 16 Nov']);
    expect(days[0].events).toHaveLength(2);
    expect(dayLabel('2025-12-31', '2026-11-19')).toBe('Wed · 31 Dec 2025');
  });
});

describe('audit text — export', () => {
  it('CSV row: human columns first, raw ids in the extra columns', () => {
    const r = row({ id: 'row-x', changes: { status: { old: 'collected', new: 'billed' } } });
    const c = csvRow(r, REFS);
    expect(c[1]).toBe('Admin User');
    expect(c[2]).toBe('Admin User billed order LAB-2611-000016 for Mr. Kumar Prem');
    expect(c[3]).toBe('Orders & billing');
    expect(c[4]).toBe('Status: Sample collected → Billed');
    expect(c.slice(5)).toEqual(['OrderEntity', ORDER, 'update', USER, 'row-x']);
    expect(c.slice(0, 5).join(' ')).not.toMatch(GUID);
  });
});
