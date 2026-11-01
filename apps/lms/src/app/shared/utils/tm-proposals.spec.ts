import type { TmProposal } from '../models/tm-proposal.model';
import {
  DASH, tmCanSeeKind, tmChangeLine, tmClinicalItems, tmConfidenceLine, tmDiffRows, tmExpiresLine, tmFailedWords, tmFieldLabel,
  tmKindLabel, tmMatches, tmMemberRows, tmNeedsClinicalConfirm, tmIsGuess, tmParameterRows, tmPeopleLine, tmProposalPath, tmSourceLine,
  tmSourceShort, tmStatusLabel, tmWhenLine,
} from './tm-proposals';

const base = (over: Partial<TmProposal> = {}): TmProposal => ({
  id: 'p1', kind: 'price', status: 'pending', targetTestId: 't1', targetLabel: 'CBC (HEM001)', summary: 'Price ₹250 → ₹300',
  clinicalFields: [], confidence: 96, source: 'pf_sense', sourceModel: 'gemini:gemini-2.5-flash', clientId: null, proposedBy: 'Lakshmi Admin',
  isMine: true, createdAt: '2026-11-01T10:00:00Z', expiresAt: '2026-12-01T10:00:00Z', ...over,
});

describe('tm-proposals helpers', () => {
  it('one path per proposal — there is no bulk path', () => {
    expect(tmProposalPath('a b', 'approve')).toBe('/api/tm-proposals/a%20b/approve');
    expect(tmProposalPath('x')).toBe('/api/tm-proposals/x');
  });

  it('permissions mirror the server: price kinds for pricing roles, the rest need Test Master', () => {
    const pricingOnly = (c: string) => c === 'manage_test_pricing';
    const tm = (c: string) => c === 'manage_test_master';
    expect(tmCanSeeKind(pricingOnly, 'price')).toBe(true);
    expect(tmCanSeeKind(pricingOnly, 'offered')).toBe(true);
    expect(tmCanSeeKind(pricingOnly, 'test_update')).toBe(false);
    expect(tmCanSeeKind(pricingOnly, 'test_create')).toBe(false);
    expect(tmCanSeeKind(pricingOnly, 'bundle_members')).toBe(false);
    expect(tmCanSeeKind(tm, 'test_update')).toBe(true);
    expect(tmCanSeeKind(tm, 'price')).toBe(true);
    expect(tmCanSeeKind(() => false, 'price')).toBe(false);
  });

  it('source says Cortex (never "AI") and an outside assistant through the AI connector', () => {
    expect(tmSourceLine(base())).toBe('Cortex (Gemini)');
    expect(tmSourceLine(base({ sourceModel: 'claude:claude-sonnet-5-5' }))).toBe('Cortex (Claude)');
    expect(tmSourceLine(base({ sourceModel: null }))).toBe('Cortex');
    expect(tmSourceShort(base())).toBe('Cortex');
    const outside = base({ source: 'connector', sourceModel: null, clientId: 'claude-desktop' });
    expect(tmSourceShort(outside)).toBe('Outside assistant');
    expect(tmSourceLine(outside)).toBe('Outside assistant through the AI connector · claude-desktop');
    for (const s of [tmSourceLine(base()), tmSourceShort(outside), tmConfidenceLine(base({ confidence: 70 }))])
      expect(s.replace('AI connector', '')).not.toMatch(/\bAI\b/);
  });

  it('confidence: only a model / similarity match is called a guess (matchedBy), never a score threshold', () => {
    expect(tmConfidenceLine(base({ matchedBy: 'code' }))).toBe('Confidence 96');
    expect(tmConfidenceLine(base({ confidence: 60, matchedBy: 'code' }))).toBe('Confidence 60');
    expect(tmConfidenceLine(base({ confidence: 72, matchedBy: 'model' }))).toBe('Cortex guessed this match (confidence 72)');
    expect(tmConfidenceLine(base({ confidence: 91, matchedBy: 'similarity' }))).toBe('Cortex guessed this match (confidence 91)');
    expect(tmConfidenceLine(base({ confidence: 72, matchedBy: null }))).toBe('Confidence 72');
    expect(tmConfidenceLine(base({ confidence: null }))).toBe('');
    expect(tmIsGuess(base({ matchedBy: 'model' }))).toBe(true);
    expect(tmIsGuess(base({ confidence: 10 }))).toBe(false);
  });

  it('words for kinds, statuses, failures, people and time', () => {
    expect(tmKindLabel('test_update')).toBe('Test edit');
    expect(tmStatusLabel('stale')).toBe('Changed since suggested');
    expect(tmStatusLabel('failed')).toBe('Could not apply');
    expect(tmFailedWords('family_via_profile')).toMatch(/only be used inside a profile/);
    expect(tmFailedWords('something_new')).toMatch(/could not be applied/);
    expect(tmPeopleLine(base())).toBe('Asked by Lakshmi Admin (you)');
    expect(tmPeopleLine(base({ status: 'approved', resolvedBy: 'Lakshmi Admin' }))).toBe('Asked by Lakshmi Admin (you) · Approved by Lakshmi Admin');
    const now = Date.parse('2026-11-01T10:02:00Z');
    expect(tmWhenLine(base(), now)).toBe('Suggested 2 min ago');
    expect(tmExpiresLine(base(), now)).toBe('Expires in 30 days');
    expect(tmExpiresLine(base({ status: 'approved' }), now)).toBe('');
  });

  it('the list line is the server wording passed through', () => {
    expect(tmChangeLine(base())).toBe('Price ₹250 → ₹300');
    expect(tmChangeLine(base({ summary: 'Price not set → ₹120' }))).toBe('Price not set → ₹120');
    expect(tmChangeLine(base({ kind: 'test_update', summary: 'Edit: Unit, Reference range' }))).toBe('Edit: Unit, Reference range');
    expect(tmChangeLine(base({ kind: 'bundle_members', summary: 'Tests in bundle 3 → 4' }))).toBe('Tests in bundle 3 → 4');
    expect(tmChangeLine(base({ kind: 'test_create', summary: 'New test' }))).toBe('New test');
    expect(tmChangeLine(base({ kind: 'test_create', summary: '' }))).toBe('New test');
    expect(tmFieldLabel('tatHours')).toBe('Turnaround');
  });

  it('diff rows prefer the server changes[] (plain label, ₹ text) over formatting the payload', () => {
    const rows = tmDiffRows(base({
      kind: 'test_update', clinicalFields: ['tatHours'], payload: { tatHours: 6, price: 1250.5 }, before: { tatHours: 4, price: 1000 },
      changes: [
        { field: 'tatHours', label: 'Turnaround (hours)', before: '4', after: '6', clinical: true },
        { field: 'price', label: 'Price', before: '₹1,000', after: '₹1,250.50', clinical: false },
      ],
    }));
    expect(rows.map(r => [r.label, r.current, r.proposed])).toEqual([
      ['Turnaround (hours)', '4', '6'], ['Price', '₹1,000', '₹1,250.50'],
    ]);
    expect(rows[0].clinical).toBe(true);
  });

  it('price diff: Field | Current | Proposed with ₹, the test id is context only', () => {
    const rows = tmDiffRows(base({ payload: { testId: 't1', price: 300 }, before: { price: 250, taxSlab: 0, notPriced: false } }));
    expect(rows).toEqual([{ key: 'price', label: 'Price', current: '₹250', proposed: '₹300', clinical: false }]);
    const notPriced = tmDiffRows(base({ payload: { testId: 't1', price: 300 }, before: { price: null, notPriced: true } }));
    expect(notPriced[0].current).toBe('Not set');
  });

  it('stale: adds "At proposal" and reads Current from the live value', () => {
    const rows = tmDiffRows(base({ status: 'stale', payload: { testId: 't1', price: 300 }, before: { price: 250 }, current: { price: 195 } }));
    expect(rows[0]).toEqual({ key: 'price', label: 'Price', current: '₹195', atProposal: '₹250', proposed: '₹300', clinical: false });
  });

  it('clinical fields are flagged and listed for the confirm dialog', () => {
    const p = base({ kind: 'test_update', clinicalFields: ['adultReferenceRange', 'unit'],
      payload: { unit: 'mmol/L', adultReferenceRange: '3.5 - 5.5', tatHours: 24 }, before: { unit: 'mg/dL', adultReferenceRange: '70 - 110', tatHours: 12 } });
    expect(tmNeedsClinicalConfirm(p)).toBe(true);
    expect(tmNeedsClinicalConfirm(base())).toBe(false);
    const rows = tmDiffRows(p);
    expect(rows.map(r => [r.label, r.clinical])).toEqual([['Unit', true], ['Reference range', true], ['Turnaround', false]]);
    expect(rows[2]).toMatchObject({ current: '12 h', proposed: '24 h' });
    expect(tmClinicalItems(rows)).toEqual(['Unit: mg/dL → mmol/L', 'Reference range: 70 - 110 → 3.5 - 5.5']);
  });

  it('parametersJson is shown per parameter, never as two walls of JSON', () => {
    const before = JSON.stringify({ parameters: [{ name: 'Glucose', unit: 'mg/dL', referenceRanges: [{ min: 70, max: 110 }] }] });
    const after = JSON.stringify({ parameters: [{ name: 'Glucose', unit: 'mmol/L', referenceRanges: [{ min: 3.9, max: 6.1 }] }, { name: 'Note', type: 'text' }] });
    const rows = tmParameterRows(before, after);
    expect(rows.map(r => r.label)).toEqual(['Glucose · Unit', 'Glucose · Range', 'Note']);
    expect(rows[0]).toMatchObject({ current: 'mg/dL', proposed: 'mmol/L', clinical: true });
    expect(rows[1].current).toMatch(/70/);
    expect(rows[1].proposed).toMatch(/3\.9/);
    expect(rows[2]).toMatchObject({ current: DASH });
    // Unreadable blob → the raw text, never cut.
    const raw = tmParameterRows('not json', '{"parameters":[]}');
    expect(raw[0].current).toBe('not json');
  });

  it('a new test lists the proposed values; its ₹0 start price is not a diff line', () => {
    const rows = tmDiffRows(base({ kind: 'test_create', clinicalFields: ['unit'],
      payload: { name: 'Vitamin B12', departmentId: 'd1', unit: 'pg/mL', price: 0, taxSlab: 0, tatHours: 24 }, before: {} }),
      { department: id => (id === 'd1' ? 'Biochemistry' : null) });
    expect(rows.map(r => [r.label, r.current, r.proposed])).toEqual([
      ['Name', DASH, 'Vitamin B12'], ['Department', DASH, 'Biochemistry'], ['Unit', DASH, 'pg/mL'], ['Turnaround', DASH, '24 h'],
    ]);
    expect(rows.find(r => r.label === 'Unit')!.clinical).toBe(true);
  });

  it('profile members: Added / Removed and the full list', () => {
    const p = base({ kind: 'bundle_members', before: { members: [{ name: 'Urea', code: 'BIO004' }, { name: 'Creatinine', code: 'BIO005' }] },
      payload: { parametersJson: JSON.stringify({ items: [{ testId: 'u' }, { testId: 'c' }, { testId: 'h' }] }) } });
    const look = { test: (k: string) => ({ u: { name: 'Urea', code: 'BIO004' }, c: { name: 'Creatinine', code: 'BIO005' }, h: { name: 'HDL', code: 'BIO030' } } as Record<string, { name: string; code: string }>)[k] };
    const rows = tmMemberRows(p, look);
    expect(rows[0]).toMatchObject({ label: 'Added', proposed: 'HDL (BIO030)' });
    expect(rows[1]).toMatchObject({ label: 'Members (2 → 3)', current: 'Urea (BIO004), Creatinine (BIO005)' });
  });

  it('band search matches the test, the change and who', () => {
    expect(tmMatches(base(), 'hem001')).toBe(true);
    expect(tmMatches(base(), 'lakshmi')).toBe(true);
    expect(tmMatches(base(), 'cortex')).toBe(true);
    expect(tmMatches(base(), 'ferritin')).toBe(false);
  });
});
