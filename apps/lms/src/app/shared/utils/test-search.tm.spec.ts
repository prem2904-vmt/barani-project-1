import { filterTestList, profileAliases, scoreTestSearch } from './test-search';

/**
 * Test Master single-source — Stage 1 safety net for test search / the order
 * picker. TODAY the picker matches a member test through the TYPED
 * `tests.Profile` tag ("Liver Function Test") and codes are matched as plain
 * strings. Phase 0 derives `tests.Profile` from profile membership; the
 * effective-list DTO (Phase 3) may merge master + override rows per key.
 */
const alt = { id: 'alt', name: 'SGPT (ALT)', testCode: 'BIO021', profile: 'Liver Function Test', type: 'individual' };
const ast = { id: 'ast', name: 'SGOT (AST)', testCode: 'BIO022', profile: null, type: 'individual' };
const lft = { id: 'lft', name: 'Liver Function Test', testCode: 'LFT', type: 'profile',
  parameters: JSON.stringify({ items: [{ testId: 'alt' }, { testId: 'ast' }] }) };

describe('test search via tests.Profile (CURRENT)', () => {
  it('a member is found by its typed profile tag (substring + acronym)', () => {
    expect(scoreTestSearch(alt, 'liver')).toBeGreaterThan(0);
    expect(scoreTestSearch(alt, 'lft')).toBeGreaterThan(0);
  });

  it('scored ALONE (no catalogue), a member without the typed tag is not found by the profile', () => {
    expect(scoreTestSearch(ast, 'liver')).toBe(0);
  });

  it('exact code hit ranks first (master-shaped codes match like any string)', () => {
    expect(filterTestList([alt, ast], 'BIO022')[0].id).toBe('ast');
  });

  it('TARGET phase 0: tests.Profile is DERIVED from profile membership — AST is found via "liver"/"LFT"', () => {
    const hits = filterTestList([alt, ast, lft], 'liver').map(t => t.id);
    expect(hits).toContain('ast');
  });

  it('TARGET phase 3: effective list has ONE row per catalog key (master + override merged) — no duplicate hits', () => {
    const master = { ...alt, id: 'm-alt', origin: 'master', catalogKey: 'BIO021' };
    const override = { ...alt, id: 't-alt', origin: 'customised', catalogKey: 'BIO021' };
    expect(filterTestList([master, override], 'BIO021')).toHaveLength(1);
  });
});

describe('test search — derived profile aliases (phase 0 target)', () => {
  it('AST is found by the profile code "LFT" and the acronym of its name', () => {
    expect(filterTestList([alt, ast, lft], 'LFT').map(t => t.id)).toContain('ast');
    expect(filterTestList([alt, ast, lft], 'liver function').map(t => t.id)).toContain('ast');
  });

  it('a sub-list is searched against the FULL catalogue\'s memberships', () => {
    expect(filterTestList([ast], 'liver', [alt, ast, lft]).map(t => t.id)).toEqual(['ast']);
    expect(filterTestList([ast], 'liver')).toEqual([]);          // no catalogue → no aliases
  });

  it('bundles stamped with catalogKey map members by key (a lab copy keeps its aliases)', () => {
    const copy = { ...ast, id: 'ast-copy', catalogKey: 'BIO022', origin: 'customised' };
    const lftByKey = { ...lft, parameters: JSON.stringify({ items: [{ testId: 'ast', catalogKey: 'BIO022' }] }) };
    expect(filterTestList([copy, lftByKey], 'liver').map(t => t.id)).toContain('ast-copy');
    expect(profileAliases([lftByKey]).get('key:bio022')).toEqual(['Liver Function Test', 'LFT']);
  });

  it('rows without origin are never merged (clone payloads keep every row)', () => {
    const a = { ...alt, id: 'a1', catalogKey: 'BIO021' };
    const b = { ...alt, id: 'a2', catalogKey: 'BIO021' };
    expect(filterTestList([a, b], 'BIO021')).toHaveLength(2);
  });

  it('the lab copy wins over the master row for the same key', () => {
    const master = { ...alt, id: 'm-alt', origin: 'master', catalogKey: 'BIO021' };
    const branch = { ...alt, id: 'b-alt', origin: 'branch', catalogKey: 'BIO021' };
    expect(filterTestList([master, branch], 'SGPT').map(t => t.id)).toEqual(['b-alt']);
  });
});
