import { aiFallbackMessage, CodeSlot, formatTokens, mapAiRead } from './disk-read';
import { baseDrug, drugForCode, masterCandidates, normCode, panelCandidates } from './disk-codes';

/** The ONE AI call: panel → candidate codes, the answer → rows (suggestions
 *  only), and the manual fallback when the endpoint is absent. */

const PANEL = ['Amoxicillin-Clavulanate', 'Cefixime', 'Ceftazidime', 'Imipenem', 'Cefepime', 'Ceftriaxone',
  'Piperacillin-Tazobactam', 'Cefoperazone-Sulbactam'];

describe('panel → disk codes', () => {
  it('every panel drug offers its printed codes (maker + CLSI)', () => {
    const c = panelCandidates(PANEL);
    const codes = c.map(x => x.code);
    for (const k of ['AMC 30', 'CFM 5', 'CAZ 30', 'IPM 10', 'CPM 30', 'FEP 30', 'CTR 30', 'CRO 30', 'PIT 100/10', 'CFS 105'])
      expect(codes).toContain(k);
    expect(drugForCode('ctr  30', c)).toBe('Ceftriaxone');
    expect(drugForCode('CRO 30', c)).toBe('Ceftriaxone');
    expect(drugForCode('PIT 100 / 10', c)).toBe('Piperacillin-Tazobactam');
    expect(drugForCode('VA 30', c)).toBeNull();            // not on this panel
  });

  it('split-content rows claim the code with their own potency', () => {
    const c = panelCandidates(['Piperacillin-Tazobactam 10', 'Piperacillin-Tazobactam 100']);
    expect(drugForCode('PIT 100/10', c)).toBe('Piperacillin-Tazobactam 100');
  });

  it('"AMC 30" is the 20/10 disk — it belongs to the "…20" row', () => {
    const c = panelCandidates(['Amoxicillin-Clavulanate 20', 'Amoxicillin-Clavulanate 10']);
    expect(drugForCode('AMC 30', c)).toBe('Amoxicillin-Clavulanate 20');
    expect(drugForCode('AMC 20/10', c)).toBe('Amoxicillin-Clavulanate 20');
  });

  it('breakpoint short labels cover drugs outside the table', () => {
    const c = panelCandidates(['Aztreonam-Avibactam 30'], { 'Aztreonam-Avibactam 30': 'AZA 30' });
    expect(drugForCode('AZA 30', c)).toBe('Aztreonam-Avibactam 30');
  });

  it('the WHOLE master: every drug\'s printed codes; breakpoint label + content, else short name', () => {
    const c = masterCandidates(
      [{ name: 'Ceftriaxone', shortName: 'CRO' }, { name: 'Aztreonam-Avibactam', shortName: 'AZA' }, { name: 'Dalbavancin', shortName: 'DAL' },
       { name: 'Fancy-new', shortName: 'FNW' }],
      [{ antibiotic: 'Aztreonam-Avibactam 30', shortLabel: 'AZA 30', diskLabel: '30 μg' }, { antibiotic: 'Dalbavancin', shortLabel: 'DAL' },
       { antibiotic: 'Fancy-new', diskLabel: '15 μg' }]);
    const codes = c.map(x => x.code);
    expect(codes).toEqual(expect.arrayContaining(['CTR 30', 'CRO 30', 'AZA 30', 'DAL', 'FNW 15']));
    expect(drugForCode('AZA 30', c)).toBe('Aztreonam-Avibactam');
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('names normalise', () => {
    expect(baseDrug('Amoxicillin/Clavulanate')).toBe('amoxicillin-clavulanate');
    expect(baseDrug('Cefuroxime (oral)')).toBe('cefuroxime');
    expect(baseDrug('Co-trimoxazole')).toBe('trimethoprim-sulfamethoxazole');
    expect(normCode(' amc  30 ')).toBe('AMC 30');
  });
});

type Row = CodeSlot & { n: number };
const rows = (): Row[] => Array.from({ length: 8 }, (_, i) => ({ id: 100 + i, n: i + 1, code: null, codeSrc: null, aiConf: null, notDisk: false }));
const tiles = (rs: Row[]) => new Map(rs.map(r => [r.n, r.id]));

describe('AI result → rows', () => {
  const cands = panelCandidates(PANEL);

  it('maps each tile\'s code onto its row; unknown / off-panel stay unknown', () => {
    const rs = rows();
    const out = mapAiRead(rs, { disks: [
      { n: 1, code: 'AMC 30', confidence: 0.95 }, { n: 2, code: 'UNKNOWN', confidence: 0 },
      { n: 3, code: 'VA 30', confidence: 0.9 }, { n: 8, code: 'pit 100/10', confidence: 0.8 },
    ] }, tiles(rs), cands);
    expect(out[0]).toMatchObject({ code: 'AMC 30', codeSrc: 'ai', aiConf: 0.95 });
    expect(out[1]).toMatchObject({ code: null, codeSrc: 'ai' });
    expect(out[2].code).toBeNull();
    expect(out[7].code).toBe('PIT 100/10');
    expect(out[4]).toBe(rs[4]);                             // not in the answer → untouched
  });

  it('a code is used once: the more confident tile keeps it', () => {
    const rs = rows();
    const out = mapAiRead(rs, { disks: [{ n: 2, code: 'CTR 30', confidence: 0.6 }, { n: 5, code: 'CTR 30', confidence: 0.9 }] }, tiles(rs), cands);
    expect(out[1].code).toBeNull();
    expect(out[4].code).toBe('CTR 30');
  });

  it('two printed aliases of ONE drug count as the same (live flash-lite read: CFS 105 + CFS 75/30)', () => {
    const rs = rows();
    const out = mapAiRead(rs, { disks: [
      { n: 3, code: 'CFS 105', confidence: 0.8 },           // really CAZ 30 — misread
      { n: 8, code: 'CFS 75/30', confidence: 1.0 },          // the real CFS disk
    ] }, tiles(rs), cands);
    expect(out[7].code).toBe('CFS 75/30');
    expect(out[2].code).toBeNull();
    expect(out[2].codeSrc).toBe('ai');
  });

  it('never overrides the technician — rows they coded, codes they placed', () => {
    const rs = rows();
    rs[0] = { ...rs[0], code: 'IPM 10', codeSrc: 'tech' };
    const out = mapAiRead(rs, { disks: [{ n: 1, code: 'AMC 30', confidence: 1 }, { n: 2, code: 'IPM 10', confidence: 1 }] }, tiles(rs), cands);
    expect(out[0]).toMatchObject({ code: 'IPM 10', codeSrc: 'tech' });
    expect(out[1].code).toBeNull();
  });

  it('suggestedCode on an unknown tile is kept as "probably", never applied', () => {
    const rs = rows();
    const out = mapAiRead(rs, { disks: [
      { n: 1, code: 'AMC 30', confidence: 0.9 },
      { n: 3, code: 'UNKNOWN', confidence: 0, suggestedCode: 'CAZ 30' },
      { n: 4, code: 'UNKNOWN', confidence: 0, suggestedCode: 'AMC 30' },   // already used → dropped
    ] }, tiles(rs), cands);
    expect(out[2]).toMatchObject({ code: null, suggested: 'CAZ 30' });
    expect(out[3]).toMatchObject({ code: null, suggested: null });
  });

  it('tile numbers map through the ids captured at call time', () => {
    const rs = rows();
    const map = tiles(rs);
    const later = rs.filter(r => r.n !== 2);                // disk 2 deleted mid-call
    const out = mapAiRead(later, { disks: [{ n: 2, code: 'CFM 5', confidence: 1 }, { n: 3, code: 'CAZ 30', confidence: 1 }] }, map, cands);
    expect(out.find(r => r.n === 3)?.code).toBe('CAZ 30');
    expect(out.some(r => r.code === 'CFM 5')).toBe(false);
  });
});

describe('API absent → manual fallback', () => {
  it('404 / ai_unavailable → "Codes: pick manually"; cap → says so', () => {
    expect(aiFallbackMessage({ status: 404, error: {} })).toBe('Codes: pick manually');
    expect(aiFallbackMessage({ status: 503, error: { error: 'ai_unavailable', message: 'off' } })).toBe('Codes: pick manually');
    expect(aiFallbackMessage({ status: 429, error: { error: 'ai_cap_reached', message: 'cap' } })).toMatch(/PF Sense limit reached.*pick manually/);
    expect(aiFallbackMessage({ status: 500, error: { error: 'ai_failed', message: 'x' } })).toMatch(/pick manually/);
  });

  it('PF Sense off / limit reached → the two quiet lines', () => {
    expect(aiFallbackMessage({ status: 200, error: { error: 'pf_sense_off', message: 'off' } })).toBe('Codes: pick manually');
    expect(aiFallbackMessage({ status: 200, error: { error: 'ai_cap_reached', message: 'cap' } })).toBe('PF Sense limit reached for this month — codes: pick manually');
  });

  it('usage reads small', () => {
    expect(formatTokens(1_200_000)).toBe('1.2M');
    expect(formatTokens(2_000_000)).toBe('2M');
    expect(formatTokens(45_300)).toBe('45.3k');
  });
});
