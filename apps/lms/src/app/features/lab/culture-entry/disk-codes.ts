/**
 * AST disk codes ↔ panel antibiotics.
 *
 * The code PRINTED on a disk ("CTR 30", "PIT 100/10") depends on the maker:
 * Indian labs mostly use HiMedia codes, CLSI tables use their own
 * abbreviations (CRO, TZP…). The AI reads what is printed, so every panel
 * drug offers all its known printed codes; the reply is mapped back to the
 * panel row by drug. Codes not in this table fall back to the breakpoint's
 * short label (+ disk content) when the lab set one.
 */

/** Base drug name (lower-case) → printed codes, most common first. */
const PRINTED: Record<string, string[]> = {
  'amikacin': ['AK 30', 'AMK 30'],
  'amoxicillin-clavulanate': ['AMC 30', 'AMC 20/10'],
  'ampicillin': ['AMP 10'],
  'ampicillin-sulbactam': ['A/S 10/10', 'SAM 10/10'],
  'azithromycin': ['AZM 15'],
  'aztreonam': ['AT 30', 'ATM 30'],
  'cefazolin': ['CZ 30'],
  'cefepime': ['CPM 30', 'FEP 30'],
  'cefixime': ['CFM 5'],
  'cefoperazone-sulbactam': ['CFS 105', 'CFS 75/30'],
  'cefotaxime': ['CTX 30'],
  'cefoxitin': ['CX 30', 'FOX 30'],
  'cefpodoxime': ['CPD 10'],
  'ceftazidime': ['CAZ 30'],
  'ceftazidime-avibactam': ['CZA 30/20', 'CZA 30'],
  'ceftriaxone': ['CTR 30', 'CRO 30'],
  'cefuroxime': ['CXM 30'],
  'chloramphenicol': ['C 30'],
  'ciprofloxacin': ['CIP 5'],
  'clindamycin': ['CD 2', 'CLI 2'],
  'colistin': ['CL 10'],
  'doxycycline': ['DO 30', 'DOX 30'],
  'ertapenem': ['ETP 10'],
  'erythromycin': ['E 15', 'ERY 15'],
  'fosfomycin': ['FO 200', 'FOS 200'],
  'gentamicin': ['GEN 10'],
  'imipenem': ['IPM 10'],
  'levofloxacin': ['LE 5', 'LVX 5'],
  'linezolid': ['LZ 30', 'LZD 30'],
  'meropenem': ['MRP 10', 'MEM 10'],
  'minocycline': ['MI 30', 'MIN 30'],
  'moxifloxacin': ['MO 5', 'MXF 5'],
  'nalidixic acid': ['NA 30'],
  'netilmicin': ['NET 30'],
  'nitrofurantoin': ['NIT 300'],
  'norfloxacin': ['NX 10'],
  'ofloxacin': ['OF 5'],
  'oxacillin': ['OX 1'],
  'penicillin': ['P 10'],
  'piperacillin-tazobactam': ['PIT 100/10', 'TZP 100/10'],
  'polymyxin b': ['PB 300'],
  'rifampin': ['RIF 5'],
  'teicoplanin': ['TEI 30'],
  'tetracycline': ['TE 30', 'TET 30'],
  'tigecycline': ['TGC 15'],
  'tobramycin': ['TOB 10'],
  'trimethoprim-sulfamethoxazole': ['COT 25', 'SXT 25'],
  'vancomycin': ['VA 30', 'VAN 30'],
};

const SYNONYMS: Record<string, string> = {
  'amoxyclav': 'amoxicillin-clavulanate',
  'amoxicillin-clavulanic acid': 'amoxicillin-clavulanate',
  'co-amoxiclav': 'amoxicillin-clavulanate',
  'co-trimoxazole': 'trimethoprim-sulfamethoxazole',
  'cotrimoxazole': 'trimethoprim-sulfamethoxazole',
  'rifampicin': 'rifampin',
  'piperacillin-tazobactum': 'piperacillin-tazobactam',
  'cefoperazone-sulbactum': 'cefoperazone-sulbactam',
};

/** "Piperacillin-Tazobactam 100", "Cefuroxime (oral)", "Amoxicillin/Clavulanate"
 *  → "piperacillin-tazobactam", "cefuroxime", "amoxicillin-clavulanate". */
export function baseDrug(name: string): string {
  let s = (name || '').toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\s*[/+]\s*/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/(\s+[\d.]+)+\s*$/g, '')
    .replace(/\s+(or|inv\.?)$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  s = SYNONYMS[s] ?? s;
  return s;
}

/** Canonical code form for comparing: upper-case, single spaces. */
export function normCode(code: string | null | undefined): string {
  return (code ?? '').toUpperCase().replace(/\s+/g, ' ').replace(/\s*\/\s*/g, '/').trim();
}

/** Leading potency number of a code or a drug label ("PIT 100/10" → 100). */
function potency(s: string): number | null {
  const m = /(\d+(?:\.\d+)?)/.exec(s.replace(/^[A-Za-z/-]+\s*/, ''));
  return m ? Number(m[1]) : null;
}

export interface DiskCandidate { code: string; drug: string; }

/**
 * The disk codes the AI may answer with for this panel: every printed code
 * of every panel drug. `hints` (drug → breakpoint short label, e.g. "AZA 30")
 * covers drugs outside the table.
 */
export function panelCandidates(drugs: string[], hints: Record<string, string> = {}): DiskCandidate[] {
  const out: DiskCandidate[] = [];
  const seen = new Set<string>();
  const add = (code: string, drug: string) => {
    const c = normCode(code);
    if (!c || seen.has(c)) return;
    seen.add(c); out.push({ code: c, drug });
  };
  // Split-content rows ("Piperacillin-Tazobactam 10" / "… 100") claim the
  // codes whose potency matches their own number FIRST; the rest follow.
  const rows = drugs.filter(d => d?.trim()).map(drug => {
    const codes = PRINTED[baseDrug(drug)] ?? [];
    const p = potency(drug.replace(/\(.*?\)/g, ''));
    const match = p != null ? codes.filter(c => potency(c) === p) : [];
    return { drug, codes: match.length ? match : codes, exact: match.length > 0 };
  });
  for (const r of rows.filter(r => r.exact)) r.codes.forEach(c => add(c, r.drug));
  for (const r of rows) {
    if (!r.exact) r.codes.forEach(c => add(c, r.drug));
    const hint = hints[r.drug];
    if (hint) add(hint, r.drug);
  }
  return out;
}

/** The panel drug a code stands for (null = not on this panel). */
export function drugForCode(code: string | null | undefined, candidates: DiskCandidate[]): string | null {
  const c = normCode(code);
  if (!c) return null;
  return candidates.find(x => x.code === c)?.drug ?? null;
}
