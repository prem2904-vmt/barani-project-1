import { filterTestList, filterTestListStrict, enrichForCatalogueSearch } from './test-search';
import { Test } from '../models/test.model';

/**
 * Panel short-name search (Prefrontal Work Register #2, 2026-10-02 — OPS-67:
 * "searching LFT doesn't list Liver function test"; owner-approved fix:
 * backend ProfileLabel persisted + searched + backfilled — see
 * mw's TestProfileBackfillService and docs/ENGINEERING-RULES.md §1).
 *
 * Fixtures below mirror the REAL shipped catalogue shape 1:1 (checked against
 * Prefrontal/Seed/Master/master_catalog.tests_bio.json on the mw side before
 * writing these):
 *   - a profile/bundle row (type 'profile') carries the panel's own
 *     abbreviation as its shortName ("RFT1", "LFT-1", "TFT-1") and lists its
 *     members by catalogKey in parameters.items[].
 *   - an individual member's own `profile` field is sometimes the exact
 *     abbreviation ("LFT" on Bilirubin) and sometimes a full-word CATEGORY
 *     ("Renal" on Urea, "Thyroid" on TSH) — real catalogue data is
 *     inconsistent here, which is exactly why membership-derived aliases
 *     (profileAliases, via CatalogKey) — not the `profile` tag alone — are
 *     what makes "RFT"/"TFT" findable for a member test.
 */
const testOf = (overrides: Partial<Test> = {}): Test => ({
  id: overrides.id ?? 'id',
  tenantId: 'tenant-1',
  name: 'Test',
  code: 'CODE',
  type: 'individual',
  flow: 'direct',
  price: 0,
  discount: 0,
  taxSlab: 0,
  tatHours: 24,
  isActive: true,
  createdAt: new Date().toISOString(),
  ...overrides,
});

// ---- Liver panel: member's own `profile` field already IS the abbreviation ----
const bilirubin = testOf({
  id: 'bilirubin', name: 'Bilirubin, Total', testCode: 'BIO103', catalogKey: 'BIO103',
  shortName: 'TBIL', section: 'Liver Function', profile: 'LFT',
});
const lft1 = testOf({
  id: 'lft1', name: 'Liver Function Test – 1', testCode: 'BIO100', catalogKey: 'BIO100',
  shortName: 'LFT-1', type: 'profile', profile: 'Liver', section: 'Liver Function',
  parameters: JSON.stringify({ items: [{ catalogKey: 'BIO103' }, { catalogKey: 'BIO104' }] }),
});

// ---- Renal panel: member's own `profile` field is the CATEGORY, not "RFT" ----
const urea = testOf({
  id: 'urea', name: 'Urea', testCode: 'BIO054', catalogKey: 'BIO054',
  shortName: 'UREA', section: 'Renal Function', profile: 'Renal',
});
const creatinine = testOf({
  id: 'creatinine', name: 'Creatinine', testCode: 'BIO055', catalogKey: 'BIO055',
  shortName: 'CREA', section: 'Renal Function', profile: 'Renal',
});
const rft1 = testOf({
  id: 'rft1', name: 'Renal Function Test 1', testCode: 'BIO051', catalogKey: 'BIO051',
  shortName: 'RFT1', type: 'profile', profile: 'Renal', section: 'Renal Function',
  parameters: JSON.stringify({ items: [{ catalogKey: 'BIO054' }, { catalogKey: 'BIO055' }, { catalogKey: 'BIO056' }] }),
});

// ---- Thyroid panel: same shape as Renal (category, not abbreviation, on the member) ----
const tsh = testOf({
  id: 'tsh', name: 'Thyroid Stimulating Hormone', testCode: 'BIO178', catalogKey: 'BIO178',
  shortName: 'TSH', section: 'Thyroid Function', profile: 'Thyroid',
});
const tft1 = testOf({
  id: 'tft1', name: 'Thyroid Function Test – 1', testCode: 'BIO175', catalogKey: 'BIO175',
  shortName: 'TFT-1', type: 'profile', profile: 'Thyroid', section: 'Thyroid Function',
  parameters: JSON.stringify({ items: [{ catalogKey: 'BIO178' }, { catalogKey: 'BIO179' }] }),
});

// ---- An unrelated test that must NEVER show up for these panel searches ----
const glucose = testOf({
  id: 'glucose', name: 'Fasting Blood Sugar', testCode: 'BIO010', catalogKey: 'BIO010',
  shortName: 'FBS', section: 'Glucose', profile: 'Diabetes',
});

const catalogue = [bilirubin, lft1, urea, creatinine, rft1, tsh, tft1, glucose];

describe('panel short-name search — LFT/RFT/TFT (fuzzy matcher: filterTestList)', () => {
  it('"LFT" finds the Liver panel itself (by its own shortName)', () => {
    const hits = filterTestList(catalogue, 'LFT').map(t => t.id);
    expect(hits).toContain('lft1');
  });

  it('"LFT" finds the Liver panel\'s member (Bilirubin) via its own profile tag', () => {
    const hits = filterTestList(catalogue, 'LFT').map(t => t.id);
    expect(hits).toContain('bilirubin');
  });

  it('"RFT" finds the Renal panel itself (by its own shortName)', () => {
    const hits = filterTestList(catalogue, 'RFT').map(t => t.id);
    expect(hits).toContain('rft1');
  });

  it('"RFT" finds Renal panel MEMBERS (Urea, Creatinine) via membership-derived aliases, even though their own `profile` tag is the category "Renal", not "RFT"', () => {
    const hits = filterTestList(catalogue, 'RFT').map(t => t.id);
    expect(hits).toContain('urea');
    expect(hits).toContain('creatinine');
  });

  it('"TFT" finds the Thyroid panel and its member (TSH) the same way', () => {
    const hits = filterTestList(catalogue, 'TFT').map(t => t.id);
    expect(hits).toContain('tft1');
    expect(hits).toContain('tsh');
  });

  it('mixed-case "ReNaL" / "lFt" / "Tft" match exactly like the lower-case query', () => {
    expect(filterTestList(catalogue, 'ReNaL').map(t => t.id)).toEqual(
      expect.arrayContaining(['urea', 'creatinine', 'rft1']));
    expect(filterTestList(catalogue, 'lFt').map(t => t.id)).toEqual(
      expect.arrayContaining(['lft1', 'bilirubin']));
    expect(filterTestList(catalogue, 'Tft').map(t => t.id)).toEqual(
      expect.arrayContaining(['tft1', 'tsh']));
  });

  it('a query that matches NONE of these panels returns none of them (negative case)', () => {
    const hits = filterTestList(catalogue, 'xyznotarealquery').map(t => t.id);
    expect(hits).toEqual([]);
  });

  it('"RFT" never pulls in an unrelated test (Glucose) just because it is in the same catalogue', () => {
    const hits = filterTestList(catalogue, 'RFT').map(t => t.id);
    expect(hits).not.toContain('glucose');
  });
});

describe('panel short-name search — LFT/RFT/TFT (strict matcher: filterTestListStrict, the order-create dropdown)', () => {
  it('"LFT" / "RFT" / "TFT" each find their panel + at least one real member', () => {
    expect(filterTestListStrict(catalogue, 'LFT').map(t => t.id)).toEqual(
      expect.arrayContaining(['lft1', 'bilirubin']));
    expect(filterTestListStrict(catalogue, 'RFT').map(t => t.id)).toEqual(
      expect.arrayContaining(['rft1', 'urea', 'creatinine']));
    expect(filterTestListStrict(catalogue, 'TFT').map(t => t.id)).toEqual(
      expect.arrayContaining(['tft1', 'tsh']));
  });

  it('mixed-case query ("rFt") ranks identically to the lower-case query', () => {
    const lower = filterTestListStrict(catalogue, 'rft').map(t => t.id);
    const mixed = filterTestListStrict(catalogue, 'rFt').map(t => t.id);
    expect(mixed).toEqual(lower);
  });

  it('a non-matching query returns an empty list (negative case)', () => {
    expect(filterTestListStrict(catalogue, 'zzz-no-such-panel')).toEqual([]);
  });

  it('a sub-list (e.g. only individual tests, profiles excluded from the VISIBLE rows) still resolves aliases as long as the FULL catalogue is passed as the 3rd argument — proving the call-site wiring contract', () => {
    const individualsOnly = catalogue.filter(t => t.type === 'individual');
    // Without the full catalogue, membership-derived aliases are unavailable
    // for a member whose own `profile` tag is the category, not the abbreviation.
    expect(filterTestListStrict(individualsOnly, 'RFT').map(t => t.id)).not.toContain('urea');
    // With the full catalogue supplied as the 3rd arg, the same narrower list resolves correctly.
    expect(filterTestListStrict(individualsOnly, 'RFT', catalogue).map(t => t.id)).toContain('urea');
  });
});

describe('panel short-name search — Lab Trends (enrichForCatalogueSearch + filterTestList)', () => {
  // Lab Trends' own fetched row (TrendTest: GET /api/patients/{id}/lab-trends)
  // is deliberately sparse — just testId/testName/count/parameters, no
  // shortName/profile/catalogKey at all (apps/lms/.../trend-chart.ts
  // `TrendTest`). `testId` is the backend's `OrderTestEntity.TestId`, i.e. the
  // SAME guid as the catalogue row's own `id` — that's the join key.
  const trendRows = [
    { testId: 'bilirubin', testName: 'Bilirubin, Total', count: 4, parameters: [] },
    { testId: 'urea', testName: 'Urea', count: 6, parameters: [] },
    { testId: 'creatinine', testName: 'Creatinine', count: 6, parameters: [] },
    { testId: 'tsh', testName: 'Thyroid Stimulating Hormone', count: 3, parameters: [] },
    { testId: 'glucose', testName: 'Fasting Blood Sugar', count: 10, parameters: [] },
    // A row whose testId has since left the catalogue (retired/deleted test) —
    // must pass through unenriched, never throw, never crash the join.
    { testId: 'long-gone', testName: 'Retired Test', count: 2, parameters: [] },
  ];

  it('enrichForCatalogueSearch joins by testId and carries catalogKey/profile/shortName/type — never duplicating the catalogue, just reading it', () => {
    const enriched = enrichForCatalogueSearch(trendRows, catalogue);
    const urea2 = enriched.find(t => t.testId === 'urea')!;
    expect(urea2.catalogKey).toBe('BIO054');
    expect(urea2.profile).toBe('Renal');
    expect(urea2.shortName).toBe('UREA');
    expect(urea2.type).toBe('individual');
    // The row's own trend fields are untouched.
    expect(urea2.testName).toBe('Urea');
    expect(urea2.count).toBe(6);
  });

  it('a testId no longer in the catalogue passes through unenriched (no crash, no stray fields)', () => {
    const enriched = enrichForCatalogueSearch(trendRows, catalogue);
    const goneRow = enriched.find(t => t.testId === 'long-gone')!;
    expect(goneRow.catalogKey).toBeUndefined();
    expect(goneRow.testName).toBe('Retired Test');
  });

  it('"LFT" finds Bilirubin among the PATIENT\'s own trend rows (not the whole catalogue) once enriched + searched against the full catalogue for aliases', () => {
    const enriched = enrichForCatalogueSearch(trendRows, catalogue);
    const hits = filterTestList(enriched, 'LFT', catalogue).map(t => t.testId);
    expect(hits).toEqual(['bilirubin']);
  });

  it('"RFT" finds Urea AND Creatinine among the patient\'s trend rows, keyed off CatalogKey membership (their own `profile` tag is "Renal", not "RFT")', () => {
    const enriched = enrichForCatalogueSearch(trendRows, catalogue);
    const hits = filterTestList(enriched, 'RFT', catalogue).map(t => t.testId);
    expect(hits).toEqual(expect.arrayContaining(['urea', 'creatinine']));
    expect(hits).not.toContain('glucose');
  });

  it('"TFT" finds TSH the same way', () => {
    const enriched = enrichForCatalogueSearch(trendRows, catalogue);
    const hits = filterTestList(enriched, 'TFT', catalogue).map(t => t.testId);
    expect(hits).toEqual(['tsh']);
  });

  it('mixed-case "rFt" matches identically to "RFT"', () => {
    const enriched = enrichForCatalogueSearch(trendRows, catalogue);
    expect(filterTestList(enriched, 'rFt', catalogue).map(t => t.testId)).toEqual(
      filterTestList(enriched, 'RFT', catalogue).map(t => t.testId));
  });

  it('a non-matching query returns none of the patient\'s trend rows (negative case)', () => {
    const enriched = enrichForCatalogueSearch(trendRows, catalogue);
    expect(filterTestList(enriched, 'zzz-no-such-panel', catalogue)).toEqual([]);
  });

  it('WITHOUT enrichment, the same sparse rows canNOT resolve "RFT"/"TFT" aliases — proving the join is load-bearing, not redundant', () => {
    // Unenriched TrendTest rows have no id/catalogKey for aliasesFor to key
    // off, and no profile/shortName for the substring pass either.
    expect(filterTestList(trendRows as any, 'RFT', catalogue).map((t: any) => t.testId)).not.toContain('urea');
    expect(filterTestList(trendRows as any, 'TFT', catalogue).map((t: any) => t.testId)).not.toContain('tsh');
  });
});
