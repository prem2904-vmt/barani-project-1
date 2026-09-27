import { LEGACY_HEADER_GOLDEN } from './report-header-legacy.golden';
import { hash, legacyMatrix, renderLegacy, silenceJsdomCanvas } from './report-header-legacy.spec-helpers';

/**
 * OLD TEMPLATES PRINT EXACTLY AS BEFORE (owner, 2026-09-27).
 *
 * The letterhead / footer renderer was rebuilt around a layout model so the
 * report designer can move, resize, align and hide each element. A template
 * saved BEFORE that (no `metadata.headerLayout`) must produce a byte-identical
 * PDF. The golden hashes below were captured from the pre-refactor renderer
 * (commit 132d054c) over a matrix of every header preset × logo position ×
 * logo size, with/without NABL, contact fields, accent bar, font scale, long
 * address, disclaimer and footer text. If this fails, an untouched template
 * changed on paper — fix the renderer, never the hashes.
 *
 * Regenerate ONLY for an intentional legacy change: run with
 * PF_PRINT_GOLDEN=1 and paste the printed map into the .golden.ts file.
 */

const MATRIX = legacyMatrix();
/** One test per header style (≈37 renders each) instead of 146 in one. */
const GROUPS = [...new Set(MATRIX.map(([n]) => n.split('/')[0]))];

describe('report header — untouched templates print exactly as before', () => {
  silenceJsdomCanvas();
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-27T05:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it('the matrix and the golden list the same renders', () => {
    expect(MATRIX.map(([n]) => n).sort()).toEqual(Object.keys(LEGACY_HEADER_GOLDEN).sort());
  });

  it.each(GROUPS)('%s: every legacy render matches its golden hash', group => {
    const got: Record<string, string> = {};
    for (const [name, patch] of MATRIX.filter(([n]) => n.split('/')[0] === group)) got[name] = hash(renderLegacy(name, patch));
    if ((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.['PF_PRINT_GOLDEN']) {
      console.log('LEGACY_HEADER_GOLDEN(' + group + ')=' + JSON.stringify(got, null, 2));
    }
    const want = Object.fromEntries(Object.keys(got).map(k => [k, LEGACY_HEADER_GOLDEN[k]]));
    expect(got).toEqual(want);
  });
});
