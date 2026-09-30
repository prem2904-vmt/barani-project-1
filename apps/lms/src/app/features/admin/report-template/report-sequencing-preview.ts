import type { Department } from '../../../shared/models/tenant.model';
import type { Test } from '../../../shared/models/test.model';
import { sortItemsByMode } from '../../../shared/utils/report-sequencing';

/** One orderable item of a department on the Sequencing list: a test ordered
 *  on its own, or a profile (one block on the report). Packages never appear —
 *  a package is billing vocabulary; its members print standalone / under their
 *  profile. */
export interface SeqItem { id: string; code: string; name: string; isProfile: boolean; memberIds: string[] }

const enabled = (t: Test) => t.isActive !== false && t.isEnabled !== false;

/** A profile's printed member order: its `reportOrder`, else its `items`. */
export function profileMemberIds(t: Pick<Test, 'parameters'>): string[] {
  if (!t.parameters) return [];
  try {
    const o = JSON.parse(t.parameters) as Record<string, unknown>;
    const pick = (v: unknown) => (Array.isArray(v) ? v : [])
      .map(e => typeof e === 'string' ? e : (e && typeof e === 'object' ? (e as { testId?: unknown }).testId : null))
      .filter((id): id is string => typeof id === 'string' && !!id);
    const rep = pick(o['reportOrder']);
    return rep.length ? rep : pick(o['items']);
  } catch { return []; }
}

/** The department's orderable items (tests + profiles), in test-number order. */
export function departmentItems(dept: Pick<Department, 'id' | 'code'>, tests: Test[]): SeqItem[] {
  const code = (dept.code ?? '').trim().toUpperCase();
  const mine = tests.filter(t => enabled(t) && (t.type === 'individual' || t.type === 'profile')
    && (t.departmentId === dept.id || (!!code && (t.department?.code ?? '').trim().toUpperCase() === code)));
  const seen = new Set<string>();
  const items: SeqItem[] = [];
  for (const t of mine) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    items.push({ id: t.id, code: (t.testCode ?? '').trim(), name: t.name ?? '', isProfile: t.type === 'profile',
      memberIds: t.type === 'profile' ? profileMemberIds(t) : [] });
  }
  return sortItemsByMode(items, 'code');
}

/**
 * A preview order built from the lab's OWN departments and tests, so the
 * designer shows the lab's real names moving: up to six departments, a few
 * items each (the department being arranged gets more, and a profile when it
 * has one). The "desk" order deliberately interleaves departments and runs
 * backwards — today's default prints what the desk booked, so the preview
 * shows that too until a lab picks an order.
 */
export function buildSequencePreviewTests(
  depts: Department[], tests: Test[], focusDeptId: string | null,
): Array<Record<string, unknown>> {
  const byId = new Map(tests.map(t => [t.id, t]));
  const picked: Array<{ d: Department; items: SeqItem[] }> = [];
  for (const d of depts) {
    if (picked.length >= 6) break;
    const all = departmentItems(d, tests);
    if (!all.length) continue;
    const n = d.id === focusDeptId ? 6 : 3;
    // One profile when the department has one; its members don't also
    // appear on their own (a desk books one or the other).
    const prof = all.find(i => i.isProfile);
    const members = new Set(prof?.memberIds ?? []);
    const items = all.filter(i => !members.has(i.id)).slice(0, n);
    if (prof && !items.includes(prof)) items[items.length - 1] = prof;
    picked.push({ d, items });
  }
  // Desk order: round-robin over the departments, last first.
  const queues = picked.slice().reverse().map(p => ({ d: p.d, items: p.items.slice().reverse() }));
  const desk: Array<{ d: Department; it: SeqItem }> = [];
  for (let more = true; more;) {
    more = false;
    for (const q of queues) {
      const it = q.items.shift();
      if (it) { desk.push({ d: q.d, it }); more = true; }
    }
  }
  const line = (d: Department, id: string, name: string, code: string) => ({
    testId: id, name, code, department: d.name, departmentCode: d.code, departmentId: d.id,
    status: 'validated', result: { values: { [name]: { value: '—' } } },
  });
  const out: Array<Record<string, unknown>> = [];
  for (const { d, it } of desk) {
    if (!it.isProfile) { out.push(line(d, it.id, it.name, it.code)); continue; }
    const members = it.memberIds.map(id => byId.get(id)).filter((t): t is Test => !!t).slice(0, 3);
    const rows = members.length ? members : [{ id: it.id + ':m', name: it.name, testCode: it.code } as Test];
    for (const m of rows) {
      out.push({ ...line(d, m.id, m.name, (m.testCode ?? '').trim()),
        packageTestId: it.id, packageType: 'profile', packageName: it.name,
        profileTestId: it.id, profileName: it.name, profileCode: it.code });
    }
  }
  return out;
}
