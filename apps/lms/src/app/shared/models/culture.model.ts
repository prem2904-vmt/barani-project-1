/** Antibiotic-sensitivity row. `zoneSize` (mm) is captured now so a future
 *  CLSI breakpoint engine can auto-fill `interpretation`. */
export interface AstRow {
  name: string;
  zoneSize?: number | null;
  interpretation: 'S' | 'I' | 'R' | '';
  /** Per-row CLSI cutoff overrides (mm). When set they replace the seeded
   *  breakpoint for THIS row's auto-interpretation and are stored with the
   *  result — so the report records the cutoffs actually used. */
  sMin?: number | null;
  rMax?: number | null;
}

export interface CultureOrganism {
  name: string;
  antibiotics: AstRow[];
  /** Relative URL of the AST-plate photo this organism's zones were measured
   *  from (camera measure-assist). Kept as evidence for the validator. */
  plateImageUrl?: string | null;
}

/** One zone measured off the plate photo, mapped back to an antibiotic row
 *  by its index in the organism's AST table. Emitted by pf-plate-measure. */
export interface PlateMeasurement {
  index: number;
  zoneMm: number;
}

/** Structured Culture & Sensitivity result — stored as the test's `values`. */
export interface CultureResult {
  specimen?: string;
  gramStain?: string;
  colonyCount?: string;
  noGrowth?: boolean;
  organisms?: CultureOrganism[];
  resistancePattern?: string;
  intrinsicResistance?: string;
  clinicalNotes?: string;
  infectionControlAdvice?: string;
}

/** Common isolates for the organism picker (free text always allowed). */
export const COMMON_ORGANISMS: string[] = [
  'Escherichia coli', 'Klebsiella pneumoniae', 'Klebsiella oxytoca',
  'Pseudomonas aeruginosa', 'Acinetobacter baumannii', 'Proteus mirabilis',
  'Enterobacter cloacae', 'Citrobacter freundii', 'Serratia marcescens',
  'Salmonella Typhi', 'Staphylococcus aureus (MSSA)', 'Staphylococcus aureus (MRSA)',
  'Coagulase-negative Staphylococcus', 'Enterococcus faecalis', 'Enterococcus faecium',
  'Streptococcus pneumoniae', 'Streptococcus pyogenes', 'Candida albicans',
  'Candida tropicalis', 'No growth'
];

const GRAM_NEG = [
  'Amikacin', 'Amoxycillin/Clavulanate', 'Ampicillin', 'Cefepime', 'Cefotaxime',
  'Ceftazidime', 'Ceftriaxone', 'Cefuroxime', 'Ciprofloxacin', 'Cotrimoxazole',
  'Gentamicin', 'Imipenem', 'Meropenem', 'Piperacillin/Tazobactam'
];
const GRAM_POS = [
  'Penicillin', 'Ampicillin', 'Cefoxitin (Oxacillin)', 'Ciprofloxacin', 'Clindamycin',
  'Erythromycin', 'Gentamicin', 'Linezolid', 'Teicoplanin', 'Vancomycin', 'Cotrimoxazole'
];

/** Default antimicrobial panel keyed by specimen — pre-fills a new organism's
 *  AST table. Admins/techs add or remove rows. `default` is the fallback. */
export const ANTIBIOTIC_PANELS: Record<string, string[]> = {
  default: GRAM_NEG,
  urine: [...GRAM_NEG, 'Nitrofurantoin', 'Norfloxacin', 'Fosfomycin'],
  blood: [...new Set([...GRAM_NEG, ...GRAM_POS])],
  pus: [...new Set([...GRAM_NEG, ...GRAM_POS])],
  'wound swab': [...new Set([...GRAM_NEG, ...GRAM_POS])],
  sputum: [...GRAM_NEG, 'Levofloxacin', 'Azithromycin'],
  stool: ['Ampicillin', 'Ciprofloxacin', 'Ceftriaxone', 'Cotrimoxazole', 'Azithromycin'],
};

export function panelForSpecimen(specimen?: string): string[] {
  const key = (specimen ?? '').trim().toLowerCase();
  return ANTIBIOTIC_PANELS[key] ?? ANTIBIOTIC_PANELS['default'];
}
