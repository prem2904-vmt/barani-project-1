import { build, compactFixture, fixture, textRuns, type Run } from './report-page-break.spec-helpers';

/**
 * Page breaks inside the department results table (owner bug 2026-09-29,
 * "our major bug"): on the continuation page the FIRST row's multi-line
 * reference range was painted on top of the repeated "Reference Range"
 * header cell, a profile heading was left orphaned at the foot of the page
 * with all its rows on the next, and the next page never said which profile
 * the rows belonged to.
 *
 * Root cause of the overlap: the blank-then-repaint stash for multi-band
 * range cells was keyed by row:col without the section, and autotable
 * numbers the head row 0 like body row 0 — so the repeated header of every
 * continuation page repainted body row 0's bands.
 *
 * Renders the REAL pipeline (buildReportPdf) with a made-up snapshot of the
 * same shape and reads every text run back WITH its page and position.
 */

const pageOf = (runs: Run[], re: RegExp) => runs.filter(r => re.test(r.text)).map(r => r.page);
const HEADER_LABELS = new Set(['Investigation', 'Result', 'Unit', 'Reference Range', 'Methodology']);

describe('report PDF — the results table across a page break', () => {
  const cases: Array<[string, number, boolean]> = [];
  for (const letterpad of [false, true]) for (const n of [3, 4, 5, 6, 7]) cases.push([`${n} lipid rows${letterpad ? ', letterpad' : ''}`, n, letterpad]);

  it.each(cases)('%s: nothing is painted over the repeated column header', (_l, n, letterpad) => {
    const runs = textRuns(build(fixture(n), { letterpad }));
    const pages = [...new Set(runs.map(r => r.page))];
    expect(pages.length).toBeGreaterThan(1);
    let checked = 0;
    for (const p of pages) {
      const head = runs.find(r => r.page === p && r.text === 'Reference Range');
      if (!head || p === Math.min(...pages)) continue;
      checked++;
      // Every data run on a continuation page sits BELOW the header row
      // (its baseline + the header's bottom padding); only the labels are in it.
      const inBand = runs.filter(r => r.page === p && r.top > head.top - 14 && r.top < head.top + 8);
      expect(inBand.filter(r => !HEADER_LABELS.has(r.text)).map(r => r.text)).toEqual([]);
      expect(runs.filter(r => r.page === p && r.top < head.top && /^Z|PROF/.test(r.text)).map(r => r.text)).toEqual([]);
    }
    expect(checked).toBeGreaterThan(0);
    // The first row's reference bands print exactly once — no ghost copy.
    for (let i = 0; i < 4; i++) expect(runs.filter(r => r.text.startsWith(`ZFIRST${i} `)).length).toBe(1);
  });

  it.each(cases)('%s: no result row is split across pages', (_l, n, letterpad) => {
    const tests = fixture(n);
    const runs = textRuns(build(tests, { letterpad }));
    for (const t of tests) {
      const tag = t.range.split(' ')[0].replace(/0$/, '');   // e.g. ZVIT2x
      const bandPages = pageOf(runs, new RegExp(`^${tag}\\d `));
      expect(bandPages.length).toBeGreaterThan(0);
      expect(new Set([...bandPages, ...pageOf(runs, new RegExp(`^${t.name}$`))]).size).toBe(1);
    }
  });

  // Every break position a row height apart, so one of them lands the
  // VITPROF band + Specimen line right at the foot of the page.
  const grid: Array<[string, number, number, boolean]> = [];
  for (const letterpad of [false, true]) for (let n = 2; n <= 8; n++) for (let m = 0; m <= 4; m++) {
    grid.push([`${n} lipid + ${m} short rows${letterpad ? ', letterpad' : ''}`, n, m, letterpad]);
  }

  it.each(grid)('%s: a panel heading is never the last thing on a page', (_l, n, m, letterpad) => {
    const runs = textRuns(build(fixture(n, 5, m), { letterpad }));
    for (const [band, first] of [['LIPIDPROF', 'Zlipid 0'], ['VITPROF', 'Zvitamin 0']] as const) {
      const b = runs.find(r => r.text === band)!;
      const f = runs.find(r => r.text === first)!;
      expect(b).toBeTruthy();
      expect(f.page).toBe(b.page);
      expect(f.top).toBeGreaterThan(b.top);
    }
    // Each "Specimen: Serum" sub-line shares its page with a result under it.
    for (const sp of runs.filter(r => r.text === 'Specimen: Serum')) {
      expect(runs.some(r => r.page === sp.page && r.top > sp.top && /^Z(lipid|vitamin) \d$/.test(r.text))).toBe(true);
    }
  });

  it.each(cases)('%s: a panel continuing on a new page repeats its heading', (_l, n, letterpad) => {
    const runs = textRuns(build(fixture(n), { letterpad }));
    const bandPage = runs.find(r => r.text === 'VITPROF')!.page;
    const vitPages = [...new Set(pageOf(runs, /^Zvitamin \d$/))];
    const later = vitPages.filter(p => p !== bandPage);
    expect(later.length).toBeGreaterThan(0);                 // the fixture does cross a page
    for (const p of later) {
      const cont = runs.filter(r => r.page === p && /^VITPROF .*CONTINUED$/.test(r.text));
      expect(cont.length).toBe(1);
      const head = runs.find(r => r.page === p && r.text === 'Reference Range')!;
      const firstRow = Math.min(...runs.filter(r => r.page === p && /^Zvitamin \d$/.test(r.text)).map(r => r.top));
      expect(cont[0].top).toBeGreaterThan(head.top);          // under the column header
      expect(cont[0].top).toBeLessThan(firstRow);             // above the rows
    }
    // A page that OPENS with the band itself does not add a second heading.
    expect(runs.filter(r => r.page === bandPage && /^VITPROF .*CONTINUED$/.test(r.text))).toEqual([]);
  });

  it('the continuation reserve under the column header is given back when unused', () => {
    // Page 1 never continues a panel; a table of compact (band-less) tests
    // never does either. In both, the first row sits right under the header
    // — the same gap as the header's own bottom padding, no blank band.
    const gapUnderHeader = (runs: Run[], page: number, first: RegExp) => {
      const head = runs.find(r => r.page === page && r.text === 'Reference Range')!;
      const row = runs.filter(r => r.page === page && first.test(r.text)).map(r => r.top).sort((a, b) => a - b)[0];
      return row - head.top;
    };
    const mixed = textRuns(build(fixture(4)));
    const firstPage = Math.min(...mixed.map(r => r.page));
    const g1 = gapUnderHeader(mixed, firstPage, /^Zfirst Glucose$/);

    const solo = textRuns(build(compactFixture(28)));
    const pages = [...new Set(solo.map(r => r.page))].sort((a, b) => a - b);
    expect(pages.length).toBeGreaterThan(1);
    expect(solo.filter(r => /CONTINUED$/.test(r.text) && !/^BIOCHEMISTRY/.test(r.text))).toEqual([]);
    for (const p of pages) {
      if (!solo.some(r => r.page === p && r.text === 'Reference Range')) continue;
      const g = gapUnderHeader(solo, p, /^Zsolo \d+$/);
      expect(Math.abs(g - g1)).toBeLessThan(1);
    }
    // Baseline to baseline: 6pt head padding + 4pt body padding + the ascent
    // ≈ 20pt. A leaked band-height blank would add ~19pt on top of that.
    expect(g1).toBeLessThan(28);
  });

  it('letterpad: a continuation page starts below the pre-printed header', () => {
    const runs = textRuns(build(fixture(4), { letterpad: true }));
    const cont = runs.filter(r => /^BIOCHEMISTRY .*CONTINUED$/.test(r.text));
    expect(cont.length).toBeGreaterThan(0);
    // 45 mm default letterpad header = 127.6 pt.
    for (const c of cont) expect(c.top).toBeGreaterThan(127);
  });
});
