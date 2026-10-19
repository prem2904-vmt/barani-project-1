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

/** Printed codes whose number is the TOTAL content: the split behind it
 *  ("AMC 30" is amoxicillin 20 + clavulanate 10). */
const CONTENT: Record<string, string> = {
  'AMC 30': '20/10', 'CFS 105': '75/30', 'COT 25': '23.75/1.25', 'SXT 25': '23.75/1.25', 'CZA 30': '30/20',
};

/** Leading potency number of a code or a drug label ("PIT 100/10" → 100,
 *  "AMC 30" → 20 — its first component). */
function potency(s: string): number | null {
  const body = CONTENT[normCode(s)] ?? s.replace(/^[A-Za-z/-]+\s*/, '');
  const m = /(\d+(?:\.\d+)?)/.exec(body);
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

/** One antibiotic-master row (the lab's own list). */
export interface MasterAntibiotic { name: string; shortName?: string | null; }
/** One breakpoint row, for its printed disk label ("AZA 30") and content. */
export interface BreakpointLabel { antibiotic: string; shortLabel?: string | null; diskLabel?: string | null; }

/**
 * Candidate codes for a plate read BEFORE any organism exists: EVERY drug in
 * the lab's antibiotic master, each with its printed codes (maker + CLSI,
 * from the table above). A drug the table lacks falls back to a breakpoint's
 * short label with its disk content ("AZA 30"), else the master's short name
 * (+ the disk content when a breakpoint knows it). Codes are unique.
 */
export function masterCandidates(master: MasterAntibiotic[], breakpoints: BreakpointLabel[] = []): DiskCandidate[] {
  const byBase = new Map<string, BreakpointLabel[]>();
  for (const b of breakpoints) {
    const k = baseDrug(b.antibiotic);
    byBase.set(k, [...(byBase.get(k) ?? []), b]);
  }
  const content = (b?: BreakpointLabel) => { const m = /(\d+(?:\.\d+)?)/.exec(b?.diskLabel ?? ''); return m ? m[1] : null; };
  const hints: Record<string, string> = {};
  for (const m of master) {
    if (!m.name?.trim()) continue;
    const rows = byBase.get(baseDrug(m.name)) ?? [];
    const labelled = rows.find(r => r.shortLabel?.trim());
    const withContent = rows.find(r => content(r) != null);
    if (labelled?.shortLabel) {
      const sl = labelled.shortLabel.trim();
      const pot = content(labelled) ?? content(withContent);
      hints[m.name] = /\d/.test(sl) || !pot ? sl : `${sl} ${pot}`;
    } else if (m.shortName?.trim()) {
      const pot = content(withContent);
      hints[m.name] = pot ? `${m.shortName.trim()} ${pot}` : m.shortName.trim();
    }
  }
  return panelCandidates(master.map(m => m.name), hints);
}
