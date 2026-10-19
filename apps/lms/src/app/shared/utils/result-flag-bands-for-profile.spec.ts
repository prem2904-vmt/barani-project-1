/**
 * bandsForProfile — the UI mirror of mw ReferenceRangeResolver.DisplayBands /
 * Select's own profile-scoped exclusion (H1, Work Register item 1 logic
 * review, 2026-10-02): a profile-tagged band must never show or flag on a
 * STANDALONE report when an untagged (generic) band exists for the same
 * parameter — BIO010's Gestational OGTT <92 must never apply to a routine
 * Fasting Blood Sugar ordered on its own. An ALL-tagged parameter (CLP body
 * fluids: CSF/pleural/ascitic/…, no untagged alternative) keeps every band
 * eligible exactly as it did before profile scoping existed.
 */
import { bandsForProfile, liveFlag } from './result-flag';
import type { RangeLike } from './reference-range';

type Band = RangeLike & { profileCode?: string | null };

const FBS_GENERAL: Band = { segment: 'default', min: 70, max: 125 };
const G_OGTT: Band = { segment: 'g_ogtt', min: null, max: 92, label: 'G-OGTT: <92', profileCode: 'BIO004' };
const FBS_BANDS: Band[] = [FBS_GENERAL, G_OGTT];

const CLP_BANDS: Band[] = [
  { segment: 'csf', min: null, max: null, label: 'CSF: Colourless', profileCode: 'CLP250' },
  { segment: 'pleural', min: null, max: null, label: 'Pleural: pale yellow', profileCode: 'CLP251' },
];

describe('bandsForProfile — H1 (2026-10-02)', () => {
  it('standalone (no profile code): drops the profile-tagged band when an untagged one exists', () => {
    const result = bandsForProfile(FBS_BANDS, null);
    expect(result).toEqual([FBS_GENERAL]);
  });

  it('undefined profile code behaves the same as null/blank', () => {
    expect(bandsForProfile(FBS_BANDS, undefined)).toEqual([FBS_GENERAL]);
    expect(bandsForProfile(FBS_BANDS, '  ')).toEqual([FBS_GENERAL]);
  });

  it('under its own profile: only the profile-tagged band', () => {
    expect(bandsForProfile(FBS_BANDS, 'BIO004')).toEqual([G_OGTT]);
  });

  it('under a DIFFERENT profile: falls back to the untagged band, never the other profile\'s', () => {
    expect(bandsForProfile(FBS_BANDS, 'BIO002')).toEqual([FBS_GENERAL]);
  });

  it('ALL-tagged parameter (CLP body fluids): no profile code still returns every band — unchanged from before profile scoping', () => {
    expect(bandsForProfile(CLP_BANDS, null)).toEqual(CLP_BANDS);
  });

  it('ALL-tagged parameter: a profile code still scopes to just that profile\'s band', () => {
    expect(bandsForProfile(CLP_BANDS, 'CLP250')).toEqual([CLP_BANDS[0]]);
  });
});

describe('liveFlag — the bench never flags a standalone Fasting Blood Sugar against G-OGTT', () => {
  it('91 (inside G-OGTT\'s <92 but ALSO inside the general 70-125 band) reads Normal, not High, with no profile code', () => {
    const hit = liveFlag({ referenceRanges: FBS_BANDS, criticalLow: 40, criticalHigh: 500 }, 91, null, 30, null);
    expect(hit?.code).toBe('N');
  });

  it('under the Gestational OGTT profile, 92 flags High (IADPSG, the label\'s own "<92" glyph reads strict)', () => {
    const hit = liveFlag({ referenceRanges: FBS_BANDS, criticalLow: 40, criticalHigh: 500 }, 92, 'F', 28, 'BIO004');
    expect(hit?.code).toBe('H');
  });

  it('the same 92 standalone (no profile code) stays Normal — judged against the general band\'s 125 ceiling', () => {
    const hit = liveFlag({ referenceRanges: FBS_BANDS, criticalLow: 40, criticalHigh: 500 }, 92, 'F', 28, null);
    expect(hit?.code).toBe('N');
  });
});
