import { build, textRuns } from './report-signature-eor-page.spec-helpers';

/**
 * Owner's report 2026-10-01 (report-ADAE321E.pdf): page 1 ended with the OGTT
 * chart and "****End of Report****" with real free space still left, yet the
 * 3-signatory sign-off that signs BELOW the marker jumped alone to an
 * almost-empty page 2 — the marker's own small page-break reserve didn't
 * account for the sign-off block that follows it, so only the signatures
 * moved when the page actually ran out of room.
 *
 * Fix (report-pdf.ts): the marker and its deferred sign-off are now a SINGLE
 * pagination decision — a page break (when genuinely needed) carries the
 * marker along; the common case (room for both) is untouched.
 */
describe('report PDF — End-of-Report + deferred signatures never split across pages', () => {
  const eorOf = (runs: ReturnType<typeof textRuns>) => runs.find(r => /End of Report/.test(r.text))!;
  const sigsOf = (runs: ReturnType<typeof textRuns>) => runs.filter(r => r.text === 'Admin User');

  it('with ample free space (the owner\'s baseline content), both print on page 1', () => {
    const { doc } = build(0);
    const runs = textRuns(doc);
    const pages = new Set(runs.map(r => r.page));
    expect(pages.size).toBe(1);
    expect(eorOf(runs).page).toBe(1);
    for (const s of sigsOf(runs)) expect(s.page).toBe(1);
  });

  it('never strands the marker alone while the sign-off moves to the next page', () => {
    // Sweep from the comfortable baseline up through the point where the
    // page genuinely runs out — the exact shape of the owner's bug: under
    // the old code, a small amount of extra content moved the sign-off
    // (whose own placement check runs AFTER the marker is already drawn)
    // without moving the marker that precedes it.
    for (let words = 0; words <= 40; words++) {
      const { doc } = build(words);
      const runs = textRuns(doc);
      const eor = eorOf(runs);
      const sigs = sigsOf(runs);
      expect(sigs.length).toBeGreaterThan(0);
      for (const s of sigs) {
        expect(s.page).toBe(eor.page);
      }
    }
  });

  it('when the block truly does not fit, EOR moves to the new page WITH the signatures (never left behind)', () => {
    // A large filler guarantees overflow — confirms the "move together"
    // branch actually engages, not just that the sweep above never hit it.
    const { doc } = build(60);
    const runs = textRuns(doc);
    const pages = new Set(runs.map(r => r.page));
    expect(pages.size).toBeGreaterThan(1);
    const eor = eorOf(runs);
    const sigs = sigsOf(runs);
    expect(eor.page).toBe(Math.max(...pages));
    for (const s of sigs) expect(s.page).toBe(eor.page);
  });
});
