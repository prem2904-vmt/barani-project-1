import { filterTestList, filterTestListStrict, profileAliases } from './test-search';
import { asksSpecimen, specimenLookupIds } from './micro-specimen';
import { bundleMemberIds, departmentKeys, memberDepartmentNames } from './package-department';
import { bundleMemberIds as cartBundleMemberIds, cartOverlaps } from '../../features/frontdesk/order-create/cart-duplicates';
import { summarizeRanges } from './reference-range';

/**
 * Contract between the server's `GET /api/tests?view=summary` and the list
 * screens (DB optimisation phase 2). The summary row's `parameters` is the
 * server's `TestSummaryDto.TrimParameters`: `items` verbatim, the wrapper flags
 * `askSpecimen` / `microFormat`, and `parameters: [first value's unit /
 * referenceRanges / normalValue]`. Every list helper must read the trimmed
 * blob EXACTLY as it reads the full one.
 */
function trim(json: string | undefined): string | undefined {
  if (!json) return undefined;
  const root = JSON.parse(json);
  const slim: Record<string, unknown> = {};
  if ('items' in root) slim['items'] = root.items;
  for (const k of ['askSpecimen', 'microFormat']) if (k in root) slim[k] = root[k];
  if (Array.isArray(root.parameters) && root.parameters.length > 0) {
    const p0 = root.parameters[0] ?? {};
    const first: Record<string, unknown> = {};
    for (const k of ['unit', 'referenceRanges', 'normalValue']) if (k in p0) first[k] = p0[k];
    slim['parameters'] = [first];
  }
  return JSON.stringify(slim);
}

const value = (name: string, unit: string, min: number, max: number) => ({
  name, title: name, unit, type: 'numeric', printOnReport: true, methodology: 'Photometry',
  referenceRanges: [{ segment: 'default', min, max }], optionRows: [{ value: 'x' }], notes: 'long text '.repeat(20),
});
type Row = { id: string; name: string; testCode?: string; shortName?: string; type: string; department?: { name: string }; parameters?: string };
const FULL: Row[] = [
  { id: 'alt', name: 'SGPT (ALT)', testCode: 'BIO010', type: 'individual', department: { name: 'Biochemistry' },
    parameters: JSON.stringify({ parameters: [value('ALT', 'U/L', 7, 56)] }) },
  { id: 'ast', name: 'SGOT (AST)', testCode: 'BIO011', type: 'individual', department: { name: 'Biochemistry' },
    parameters: JSON.stringify({ parameters: [value('AST', 'U/L', 5, 40), value('Ratio', '', 0, 2)] }) },
  { id: 'cbc', name: 'Complete Blood Count', testCode: 'HEM001', type: 'individual', department: { name: 'Haematology' },
    parameters: JSON.stringify({ reportOrder: ['x'], parameters: [value('Hb', 'g/dL', 13, 17), value('WBC', '/uL', 4000, 11000)] }) },
  { id: 'cs', name: 'Urine Culture', testCode: 'MIC105', type: 'individual', department: { name: 'Microbiology' },
    parameters: JSON.stringify({ microFormat: 'culture_sensitivity', attachments: true, parameters: [value('Org', '', 0, 0)] }) },
  { id: 'gram', name: 'Gram Stain', testCode: 'MIC001', type: 'individual', department: { name: 'Microbiology' },
    parameters: JSON.stringify({ askSpecimen: true, parameters: [] }) },
  { id: 'lft', name: 'Liver Function Test', testCode: 'BIO900', shortName: 'LFT', type: 'profile', department: { name: 'Biochemistry' },
    parameters: JSON.stringify({ items: [{ testId: 'alt', catalogKey: 'BIO010' }, { testId: 'ast' }], reportOrder: ['ast', 'alt'] }) },
  { id: 'pkg', name: 'Fever Package', type: 'package',
    parameters: JSON.stringify({ items: [{ testId: 'lft' }, { testId: 'cbc' }, { testId: 'cs' }] }) },
];
const SUMMARY: Row[] = FULL.map(t => ({ ...t, parameters: trim(t.parameters) }));
const byId = (list: Row[]) => new Map(list.map(t => [t.id, t] as const));

describe('summary-view parameters are read exactly like the full blob by every list helper', () => {
  it('the trimmed blob is much smaller', () => {
    const full = JSON.stringify(FULL).length, slim = JSON.stringify(SUMMARY).length;
    expect(slim).toBeLessThan(full / 2);
  });

  it('search: profile aliases (order desk, appointment pickers)', () => {
    expect([...profileAliases(SUMMARY)]).toEqual([...profileAliases(FULL)]);
    for (const q of ['LFT', 'liver', 'BIO011', 'culture', 'fever'])
      expect(filterTestList(SUMMARY, q).map(t => t.id)).toEqual(filterTestList(FULL, q).map(t => t.id));
    for (const q of ['LFT', 'sgot', 'HEM001'])
      expect(filterTestListStrict(SUMMARY, q).map(t => t.id)).toEqual(filterTestListStrict(FULL, q).map(t => t.id));
  });

  it('specimen pick: own flags and bundle members (order desk)', () => {
    const fb = byId(FULL), sb = byId(SUMMARY);
    for (const t of FULL) {
      const s = sb.get(t.id)!;
      expect(asksSpecimen(s, id => sb.get(id))).toBe(asksSpecimen(t, id => fb.get(id)));
      expect(specimenLookupIds(s, id => sb.get(id))).toEqual(specimenLookupIds(t, id => fb.get(id)));
    }
  });

  it('bundle members, package departments, cart overlap (order desk, Test Master tree, pricing)', () => {
    const fb = byId(FULL), sb = byId(SUMMARY);
    for (const t of FULL) {
      const s = sb.get(t.id)!;
      expect(bundleMemberIds(s)).toEqual(bundleMemberIds(t));
      expect(cartBundleMemberIds(s.parameters)).toEqual(cartBundleMemberIds(t.parameters));
    }
    expect(memberDepartmentNames(sb.get('pkg')!, sb)).toEqual(memberDepartmentNames(fb.get('pkg')!, fb));
    expect(departmentKeys(sb.get('pkg')!, sb, 'none')).toEqual(departmentKeys(fb.get('pkg')!, fb, 'none'));
    const ids = (list: Row[]) => cartOverlaps(list, ['pkg', 'alt', 'lft']).map(o => `${o.container.id}>${o.member.id}`);
    expect(ids(SUMMARY)).toEqual(ids(FULL));
    expect(ids(FULL).length).toBeGreaterThan(0);
  });

  it('Test Master grid fallback: the first value\'s unit and bands', () => {
    const first = (json?: string) => { const p = JSON.parse(json ?? '{}').parameters?.[0]; return p ? summarizeRanges(p.referenceRanges, p.unit, { keepLines: true }) + '|' + (p.unit ?? '') : ''; };
    for (const t of FULL) expect(first(trim(t.parameters))).toBe(first(t.parameters));
  });
});
