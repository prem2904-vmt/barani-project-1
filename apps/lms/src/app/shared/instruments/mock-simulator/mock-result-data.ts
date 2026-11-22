/**
 * Isolated Clinical Mock Result Datasets & Protocol-Specific Example Generator.
 *
 * Provides dedicated 5 clinical example result profiles per analyzer protocol/discipline:
 *
 *  1. Haematology 5-Part CBC (Sysmex / Mindray / CBC Malar):
 *     - Normal Adult Complete Blood Count
 *     - Microcytic Hypochromic Anemia (Abnormal)
 *     - Severe Sepsis / Leukocytosis with Left Shift (Critical High Panic)
 *     - Severe Pancytopenia / Aplastic Crisis (Critical Low Panic)
 *     - Hypereosinophilic Syndrome / Marked Allergy (Atypical Variant)
 *
 *  2. Clinical Chemistry (Erba / Chem-200 / AU480 / Photometers - Glucose/RBS/FBS/PPBS, Renal, LFT):
 *     - Normal Glycemic & Metabolic Profile (Glucose 95 mg/dL, Urea 22, Creat 0.85)
 *     - Impaired Glucose / Prediabetes (Glucose 162 mg/dL High, Dyslipidemia)
 *     - Diabetic Ketoacidosis / Severe Hyperglycemia (Glucose 485 mg/dL Critical High Panic)
 *     - Severe Hypoglycemia (Glucose 38 mg/dL Critical Low Panic)
 *     - Severe Transaminitis / Acute Liver Injury (Glucose 220 mg/dL, AST 720 / ALT 950 Critical High)
 *
 *  3. HPLC Glycated Hemoglobin (LifeDx HBPro / Bio-Rad D-10):
 *     - Normal Non-Diabetic (HbA1c 5.3%)
 *     - Prediabetes (HbA1c 6.2% High)
 *     - Severe Uncontrolled Diabetes (HbA1c 13.2% Critical High Panic)
 *     - Hypoglycemia / Variant (HbA1c 4.0% Critical Low)
 *     - Moderate Uncontrolled Type 2 Diabetes (HbA1c 8.4% High)
 *
 *  4. Sinocare POCT (iCARE-2100 FHIR):
 *     - Normal (5.2%)
 *     - Prediabetes (6.1%)
 *     - Severe Hyperglycemia (13.0%)
 *     - Hypoglycemia (3.9%)
 *     - Uncontrolled (8.5%)
 */

import { CodeMapDto, ParserType } from '../instrument.models';
import { OrderTest } from '../../models/order.model';

export type ProtocolDiscipline = 'haematology' | 'chemistry' | 'hplc' | 'poct' | 'text3part' | 'urinalysis';

export type MockScenarioKey =
  | 'random'
  | 'example_1_normal'
  | 'example_2_abnormal'
  | 'example_3_critical_high'
  | 'example_4_critical_low'
  | 'example_5_atypical'
  | 'qc';

export interface MockScenarioMeta {
  key: MockScenarioKey;
  label: string;
  shortLabel: string;
  badge: 'normal' | 'abnormal' | 'critical' | 'atypical' | 'qc';
  description: string;
}

export const FIVE_CANONICAL_KEYS: MockScenarioKey[] = [
  'example_1_normal',
  'example_2_abnormal',
  'example_3_critical_high',
  'example_4_critical_low',
  'example_5_atypical',
];

// ── 1. Haematology (CBC) Scenarios ──────────────────────────────────────────
export const HAEMATOLOGY_SCENARIOS: MockScenarioMeta[] = [
  {
    key: 'random',
    label: 'Random (1 of 5 CBC profiles)',
    shortLabel: 'Random',
    badge: 'normal',
    description: 'Picks one of the 5 realistic CBC clinical cases randomly on each run',
  },
  {
    key: 'example_1_normal',
    label: 'Normal Adult Complete Blood Count',
    shortLabel: 'Normal',
    badge: 'normal',
    description: 'Hb 14.2 g/dL, WBC 7,200 cells/µL, PLT 255k, RBC 4.80, PCV 42.5%',
  },
  {
    key: 'example_2_abnormal',
    label: 'Microcytic Hypochromic Anemia (Abnormal)',
    shortLabel: 'Anemia',
    badge: 'abnormal',
    description: 'Hb 8.8 (Low), RBC 3.65 (Low), MCV 68.2 (Low), RDW 17.5% (High)',
  },
  {
    key: 'example_3_critical_high',
    label: 'Severe Sepsis / Leukocytosis (Critical High)',
    shortLabel: 'Crit High',
    badge: 'critical',
    description: 'WBC 34,500 (Critical High), Neutrophils 88.5%, PLT 560k',
  },
  {
    key: 'example_4_critical_low',
    label: 'Severe Pancytopenia (Critical Low Panic)',
    shortLabel: 'Crit Low',
    badge: 'critical',
    description: 'Hb 5.4 (Critical Low), WBC 1,700 (Critical Low), PLT 16k (Critical Low)',
  },
  {
    key: 'example_5_atypical',
    label: 'Marked Eosinophilia / Allergy (Atypical)',
    shortLabel: 'Atypical',
    badge: 'atypical',
    description: 'Eosinophils 19.2% (Critical High), Absolute Eos 2.92, WBC 15,200',
  },
];

// ── 2. Clinical Chemistry Scenarios (Glucose/RBS/FBS, Renal, LFT, Lipid) ────
export const CHEMISTRY_SCENARIOS: MockScenarioMeta[] = [
  {
    key: 'random',
    label: 'Random (1 of 5 Chemistry profiles)',
    shortLabel: 'Random',
    badge: 'normal',
    description: 'Picks one of the 5 realistic glycemic & metabolic cases randomly on each run',
  },
  {
    key: 'example_1_normal',
    label: 'Normal Glycemic & Metabolic Profile',
    shortLabel: 'Normal',
    badge: 'normal',
    description: 'Glucose 95 mg/dL (Normal < 140/200), Urea 22, Creatinine 0.85, Chol 175',
  },
  {
    key: 'example_2_abnormal',
    label: 'Impaired Glucose / Prediabetes (Abnormal)',
    shortLabel: 'Impaired',
    badge: 'abnormal',
    description: 'Glucose 162 mg/dL (Elevated), Chol 248, Triglycerides 235',
  },
  {
    key: 'example_3_critical_high',
    label: 'Severe Hyperglycemia / DKA (Critical High)',
    shortLabel: 'Crit High',
    badge: 'critical',
    description: 'Glucose 485 mg/dL (Critical High Panic), Urea 68, Creatinine 2.1',
  },
  {
    key: 'example_4_critical_low',
    label: 'Severe Hypoglycemia (Critical Low Panic)',
    shortLabel: 'Crit Low',
    badge: 'critical',
    description: 'Glucose 38 mg/dL (Critical Low Panic), Urea 18, Creatinine 0.75',
  },
  {
    key: 'example_5_atypical',
    label: 'Severe Transaminitis / Liver Injury (Atypical)',
    shortLabel: 'Atypical',
    badge: 'atypical',
    description: 'Glucose 220 mg/dL, AST 720 U/L (Critical High), ALT 950 U/L, Bilirubin 6.8',
  },
];

// ── 3. HPLC HbA1c Scenarios ────────────────────────────────────────────────
export const HPLC_SCENARIOS: MockScenarioMeta[] = [
  {
    key: 'random',
    label: 'Random (1 of 5 HbA1c profiles)',
    shortLabel: 'Random',
    badge: 'normal',
    description: 'Picks one of the 5 realistic HPLC chromatogram cases randomly on each run',
  },
  {
    key: 'example_1_normal',
    label: 'Normal Non-Diabetic (< 5.7%)',
    shortLabel: 'Normal',
    badge: 'normal',
    description: 'HbA1c 5.3% (Normal adult glycemic control)',
  },
  {
    key: 'example_2_abnormal',
    label: 'Prediabetes (5.7 - 6.4%)',
    shortLabel: 'Prediabetes',
    badge: 'abnormal',
    description: 'HbA1c 6.2% (Elevated glycated fraction)',
  },
  {
    key: 'example_3_critical_high',
    label: 'Severe Hyperglycemia (Critical High)',
    shortLabel: 'Crit High',
    badge: 'critical',
    description: 'HbA1c 13.2% (Critical High Panic, severe uncontrolled diabetes)',
  },
  {
    key: 'example_4_critical_low',
    label: 'Hypoglycemia / Variant (Critical Low)',
    shortLabel: 'Crit Low',
    badge: 'critical',
    description: 'HbA1c 4.0% (Critical Low / hemoglobinopathy variant)',
  },
  {
    key: 'example_5_atypical',
    label: 'Moderate Uncontrolled Type 2 Diabetes',
    shortLabel: 'Uncontrolled',
    badge: 'abnormal',
    description: 'HbA1c 8.4% (Sub-optimal glycemic control)',
  },
];

export const POCT_SCENARIOS = HPLC_SCENARIOS;
export const TEXT_SCENARIOS = HAEMATOLOGY_SCENARIOS;

// ── 5. Urinalysis (Urine Routine & Microscopy) Scenarios ───────────────────
export const URINALYSIS_SCENARIOS: MockScenarioMeta[] = [
  {
    key: 'random',
    label: 'Random (1 of 5 Urine profiles)',
    shortLabel: 'Random',
    badge: 'normal',
    description: 'Picks one of the 5 realistic urinalysis profiles randomly',
  },
  {
    key: 'example_1_normal',
    label: 'Normal / Clear Urinalysis',
    shortLabel: 'Normal',
    badge: 'normal',
    description: 'RBC 0-1, Pus cells 0-2, Epithelial Nil, Casts Nil, Crystals Nil, Albumin Nil, Sugar Nil',
  },
  {
    key: 'example_2_abnormal',
    label: 'Urinary Tract Infection (Active UTI)',
    shortLabel: 'UTI (Abn)',
    badge: 'abnormal',
    description: 'Pus cells 25-30 /HPF, Bacteria +++, Nitrite Pos, RBC 4-6, Epithelial 2-4',
  },
  {
    key: 'example_3_critical_high',
    label: 'Acute Hematuria / Nephritic (Critical High)',
    shortLabel: 'Hematuria',
    badge: 'critical',
    description: 'RBC 45-50 /HPF (Plentiful), RBC Casts 2-4, Protein ++ (100 mg/dL)',
  },
  {
    key: 'example_4_critical_low',
    label: 'Renal Tubular / Nephrotic Casts (Critical)',
    shortLabel: 'Renal Casts',
    badge: 'critical',
    description: 'Hyaline Casts 4-6 /LPF, Granular Casts 3-5, Renal Tubular Cells 2-4, Protein +++',
  },
  {
    key: 'example_5_atypical',
    label: 'Non-Specific Contamination / Crystals',
    shortLabel: 'Crystals',
    badge: 'atypical',
    description: 'Squamous Epithelial 15-20, Calcium Oxalate Crystals ++, Pus cells 3-5, RBC 1-2',
  },
];

/** Detects which clinical discipline applies to the tube's tests. Defaults to chemistry if unclassified. */
export function detectDiscipline(tests: readonly OrderTest[]): ProtocolDiscipline {
  if (!tests || !tests.length) return 'chemistry';

  // 1. HbA1c HPLC
  const hasHbA1c = tests.some((t) =>
    /hba1c|glycated/i.test(t.name || t.profileName || t.test?.name || '')
  );
  if (hasHbA1c && !tests.some((t) => /cbc|hemogram|blood count/i.test(t.name || ''))) {
    return 'hplc';
  }

  // 2. Haematology CBC
  const hasCbc = tests.some((t) =>
    /cbc|hemogram|blood count|platelet|haemoglobin|hemoglobin|leukocyte|erythrocyte|packed cell|differential count|rdw|mcv|mch|mchc/i.test(
      t.name || t.profileName || t.test?.name || ''
    )
  );
  if (hasCbc) return 'haematology';

  // 3. Urinalysis / Urine Routine & Microscopy
  const hasUrine = tests.some((t) =>
    /urine|urinalysis|pus cell|microscopy|casts|epithelial|crystal/i.test(
      t.name || t.profileName || t.test?.name || ''
    )
  );
  if (hasUrine) return 'urinalysis';

  // 4. Clinical Chemistry (Glucose/RBS/FBS, Renal, LFT, Lipid, etc.)
  const hasChem = tests.some((t) =>
    /glucose|sugar|rbs|fbs|ppbs|grbs|urea|creatinine|cholesterol|triglyceride|bilirubin|sgot|sgpt|ast\b|alt\b|uric|lipid|liver|renal|lft|kft|rft/i.test(
      t.name || t.profileName || t.test?.name || ''
    )
  );
  if (hasChem) return 'chemistry';

  return 'chemistry';
}

export function scenariosForDiscipline(d: ProtocolDiscipline): MockScenarioMeta[] {
  switch (d) {
    case 'urinalysis':
      return URINALYSIS_SCENARIOS;
    case 'chemistry':
      return CHEMISTRY_SCENARIOS;
    case 'hplc':
      return HPLC_SCENARIOS;
    case 'poct':
      return POCT_SCENARIOS;
    case 'text3part':
      return TEXT_SCENARIOS;
    case 'haematology':
    default:
      return HAEMATOLOGY_SCENARIOS;
  }
}

export function resolveScenarioForDiscipline(
  d: ProtocolDiscipline,
  requested?: MockScenarioKey
): MockScenarioMeta {
  const list = scenariosForDiscipline(d);
  let k = requested || 'random';
  if (k === 'random') {
    const idx = Math.floor(Math.random() * FIVE_CANONICAL_KEYS.length);
    k = FIVE_CANONICAL_KEYS[idx];
  }
  return list.find((s) => s.key === k) || list[1];
}

// ── 1. Haematology (CBC) Datasets ───────────────────────────────────────────
export interface MockCbcValues {
  hgb: { val: number; flag?: string };
  rbc: { val: number; flag?: string };
  pcv: { val: number; flag?: string };
  mcv: { val: number; flag?: string };
  mch: { val: number; flag?: string };
  mchc: { val: number; flag?: string };
  rdw: { val: number; flag?: string };
  wbc: { val: number; flag?: string }; // raw in 10^3/µL
  plt: { val: number; flag?: string }; // raw in 10^3/µL
  mpv: { val: number; flag?: string };
  pdw: { val: number; flag?: string };
  pct: { val: number; flag?: string };
  neutPct: { val: number; flag?: string };
  lymphPct: { val: number; flag?: string };
  monoPct: { val: number; flag?: string };
  eosPct: { val: number; flag?: string };
  basoPct: { val: number; flag?: string };
  neutAbs: { val: number; flag?: string };
  lymphAbs: { val: number; flag?: string };
  monoAbs: { val: number; flag?: string };
  eosAbs: { val: number; flag?: string };
  basoAbs: { val: number; flag?: string };
}

export const MOCK_CBC_DATASETS: Record<string, MockCbcValues> = {
  example_1_normal: {
    hgb: { val: 14.2 },
    rbc: { val: 4.80 },
    pcv: { val: 42.5 },
    mcv: { val: 88.5 },
    mch: { val: 29.6 },
    mchc: { val: 33.4 },
    rdw: { val: 12.8 },
    wbc: { val: 7.20 },
    plt: { val: 255 },
    mpv: { val: 9.4 },
    pdw: { val: 15.6 },
    pct: { val: 0.240 },
    neutPct: { val: 62.0 },
    lymphPct: { val: 28.0 },
    monoPct: { val: 6.0 },
    eosPct: { val: 3.2 },
    basoPct: { val: 0.8 },
    neutAbs: { val: 4.46 },
    lymphAbs: { val: 2.02 },
    monoAbs: { val: 0.43 },
    eosAbs: { val: 0.23 },
    basoAbs: { val: 0.06 },
  },

  example_2_abnormal: {
    hgb: { val: 8.8, flag: 'L' },
    rbc: { val: 3.65, flag: 'L' },
    pcv: { val: 28.2, flag: 'L' },
    mcv: { val: 68.2, flag: 'L' },
    mch: { val: 22.1, flag: 'L' },
    mchc: { val: 30.2, flag: 'L' },
    rdw: { val: 17.5, flag: 'H' },
    wbc: { val: 8.40 },
    plt: { val: 390 },
    mpv: { val: 8.8 },
    pdw: { val: 16.2 },
    pct: { val: 0.343 },
    neutPct: { val: 64.0 },
    lymphPct: { val: 26.0 },
    monoPct: { val: 6.5 },
    eosPct: { val: 2.8 },
    basoPct: { val: 0.7 },
    neutAbs: { val: 5.38 },
    lymphAbs: { val: 2.18 },
    monoAbs: { val: 0.55 },
    eosAbs: { val: 0.24 },
    basoAbs: { val: 0.06 },
  },

  example_3_critical_high: {
    hgb: { val: 12.8 },
    rbc: { val: 4.30 },
    pcv: { val: 38.5 },
    mcv: { val: 89.5 },
    mch: { val: 29.8 },
    mchc: { val: 33.2 },
    rdw: { val: 15.2 },
    wbc: { val: 34.50, flag: 'H' },
    plt: { val: 560, flag: 'H' },
    mpv: { val: 11.4, flag: 'H' },
    pdw: { val: 17.8, flag: 'H' },
    pct: { val: 0.638, flag: 'H' },
    neutPct: { val: 88.5, flag: 'H' },
    lymphPct: { val: 6.5, flag: 'L' },
    monoPct: { val: 3.5 },
    eosPct: { val: 1.0, flag: 'L' },
    basoPct: { val: 0.5 },
    neutAbs: { val: 30.53, flag: 'H' },
    lymphAbs: { val: 2.24 },
    monoAbs: { val: 1.21 },
    eosAbs: { val: 0.35 },
    basoAbs: { val: 0.17 },
  },

  example_4_critical_low: {
    hgb: { val: 5.4, flag: 'L' },
    rbc: { val: 1.75, flag: 'L' },
    pcv: { val: 16.5, flag: 'L' },
    mcv: { val: 94.2 },
    mch: { val: 30.8 },
    mchc: { val: 32.7 },
    rdw: { val: 14.8 },
    wbc: { val: 1.70, flag: 'L' },
    plt: { val: 16, flag: 'L' },
    mpv: { val: 8.2 },
    pdw: { val: 14.5 },
    pct: { val: 0.013, flag: 'L' },
    neutPct: { val: 42.0, flag: 'L' },
    lymphPct: { val: 50.0, flag: 'H' },
    monoPct: { val: 6.0 },
    eosPct: { val: 1.5 },
    basoPct: { val: 0.5 },
    neutAbs: { val: 0.71, flag: 'L' },
    lymphAbs: { val: 0.85, flag: 'L' },
    monoAbs: { val: 0.10 },
    eosAbs: { val: 0.03 },
    basoAbs: { val: 0.01 },
  },

  example_5_atypical: {
    hgb: { val: 13.6 },
    rbc: { val: 4.60 },
    pcv: { val: 41.0 },
    mcv: { val: 89.1 },
    mch: { val: 29.6 },
    mchc: { val: 33.2 },
    rdw: { val: 13.0 },
    wbc: { val: 15.20, flag: 'H' },
    plt: { val: 290 },
    mpv: { val: 9.6 },
    pdw: { val: 15.8 },
    pct: { val: 0.278 },
    neutPct: { val: 48.0 },
    lymphPct: { val: 27.0 },
    monoPct: { val: 5.0 },
    eosPct: { val: 19.2, flag: 'H' },
    basoPct: { val: 0.8 },
    neutAbs: { val: 7.30 },
    lymphAbs: { val: 4.10 },
    monoAbs: { val: 0.76 },
    eosAbs: { val: 2.92, flag: 'H' },
    basoAbs: { val: 0.12 },
  },
};

// ── 2. HPLC HbA1c Datasets ──────────────────────────────────────────────────
export const MOCK_HBA1C_DATASETS: Record<string, { val: number; flag?: string }> = {
  example_1_normal: { val: 5.3 },
  example_2_abnormal: { val: 6.2, flag: 'H' },
  example_3_critical_high: { val: 13.2, flag: 'H' },
  example_4_critical_low: { val: 4.0, flag: 'L' },
  example_5_atypical: { val: 8.4, flag: 'H' },
};

// ── 3. Clinical Chemistry Datasets (Glucose / Renal / Liver / Lipid) ─────────
export interface MockChemValues {
  glu: { val: number; flag?: string };
  urea: { val: number; flag?: string };
  creat: { val: number; flag?: string };
  chol: { val: number; flag?: string };
  trig: { val: number; flag?: string };
  ast: { val: number; flag?: string };
  alt: { val: number; flag?: string };
  tbil: { val: number; flag?: string };
  uric: { val: number; flag?: string };
  tp: { val: number; flag?: string };
  alb: { val: number; flag?: string };
}

export const MOCK_CHEM_DATASETS: Record<string, MockChemValues> = {
  // Example 1: Normal Glycemic & Metabolic Profile
  example_1_normal: {
    glu: { val: 95 },
    urea: { val: 22 },
    creat: { val: 0.85 },
    chol: { val: 175 },
    trig: { val: 120 },
    ast: { val: 24 },
    alt: { val: 26 },
    tbil: { val: 0.70 },
    uric: { val: 4.8 },
    tp: { val: 7.2 },
    alb: { val: 4.4 },
  },

  // Example 2: Impaired Glucose / Prediabetes (Abnormal)
  example_2_abnormal: {
    glu: { val: 162, flag: 'H' },
    urea: { val: 28 },
    creat: { val: 1.02 },
    chol: { val: 248, flag: 'H' },
    trig: { val: 235, flag: 'H' },
    ast: { val: 38 },
    alt: { val: 46, flag: 'H' },
    tbil: { val: 0.90 },
    uric: { val: 6.8 },
    tp: { val: 7.0 },
    alb: { val: 4.2 },
  },

  // Example 3: Severe Hyperglycemia / DKA (Critical High Panic)
  example_3_critical_high: {
    glu: { val: 485, flag: 'H' },
    urea: { val: 68, flag: 'H' },
    creat: { val: 2.10, flag: 'H' },
    chol: { val: 310, flag: 'H' },
    trig: { val: 420, flag: 'H' },
    ast: { val: 45 },
    alt: { val: 52 },
    tbil: { val: 1.20 },
    uric: { val: 8.5, flag: 'H' },
    tp: { val: 7.8 },
    alb: { val: 4.5 },
  },

  // Example 4: Severe Hypoglycemia (Critical Low Panic)
  example_4_critical_low: {
    glu: { val: 38, flag: 'L' },
    urea: { val: 18 },
    creat: { val: 0.75 },
    chol: { val: 145 },
    trig: { val: 110 },
    ast: { val: 22 },
    alt: { val: 20 },
    tbil: { val: 0.65 },
    uric: { val: 3.8 },
    tp: { val: 6.5 },
    alb: { val: 4.0 },
  },

  // Example 5: Severe Transaminitis / Liver Injury (Atypical Variant)
  example_5_atypical: {
    glu: { val: 220, flag: 'H' },
    urea: { val: 165, flag: 'H' },
    creat: { val: 7.80, flag: 'H' },
    chol: { val: 190 },
    trig: { val: 160 },
    ast: { val: 720, flag: 'H' },
    alt: { val: 950, flag: 'H' },
    tbil: { val: 6.80, flag: 'H' },
    uric: { val: 12.4, flag: 'H' },
    tp: { val: 5.8, flag: 'L' },
    alb: { val: 2.9, flag: 'L' },
  },
};

// ── 5. Urinalysis (Urine Routine & Microscopy) Datasets ────────────────────
export interface MockUrineValues {
  rbc: { val: string | number; flag?: string };
  pusCells: { val: string | number; flag?: string };
  squamousEpi: { val: string | number; flag?: string };
  transitionalEpi: { val: string | number; flag?: string };
  renalTubularEpi: { val: string | number; flag?: string };
  hyalineCasts: { val: string | number; flag?: string };
  granularCasts: { val: string | number; flag?: string };
  rbcCasts: { val: string | number; flag?: string };
  wbcCasts: { val: string | number; flag?: string };
  calciumOxalate: { val: string | number; flag?: string };
  bacteria: { val: string | number; flag?: string };
  yeast: { val: string | number; flag?: string };
  mucus: { val: string | number; flag?: string };
  albumin: { val: string | number; flag?: string };
  sugar: { val: string | number; flag?: string };
  ketone: { val: string | number; flag?: string };
  nitrite: { val: string | number; flag?: string };
  spGravity: { val: string | number; flag?: string };
  ph: { val: string | number; flag?: string };
}

export const MOCK_URINE_DATASETS: Record<string, MockUrineValues> = {
  example_1_normal: {
    rbc: { val: '0 - 1' },
    pusCells: { val: '0 - 2' },
    squamousEpi: { val: 'Nil' },
    transitionalEpi: { val: 'Nil' },
    renalTubularEpi: { val: 'Nil' },
    hyalineCasts: { val: 'Nil' },
    granularCasts: { val: 'Nil' },
    rbcCasts: { val: 'Nil' },
    wbcCasts: { val: 'Nil' },
    calciumOxalate: { val: 'Nil' },
    bacteria: { val: 'Nil' },
    yeast: { val: 'Nil' },
    mucus: { val: 'Nil' },
    albumin: { val: 'Nil' },
    sugar: { val: 'Nil' },
    ketone: { val: 'Nil' },
    nitrite: { val: 'Negative' },
    spGravity: { val: '1.015' },
    ph: { val: '6.0' },
  },
  example_2_abnormal: {
    rbc: { val: '4 - 6', flag: 'H' },
    pusCells: { val: '25 - 30', flag: 'H' },
    squamousEpi: { val: '2 - 4' },
    transitionalEpi: { val: '0 - 1' },
    renalTubularEpi: { val: 'Nil' },
    hyalineCasts: { val: 'Nil' },
    granularCasts: { val: 'Nil' },
    rbcCasts: { val: 'Nil' },
    wbcCasts: { val: 'Nil' },
    calciumOxalate: { val: 'Nil' },
    bacteria: { val: '+++', flag: 'H' },
    yeast: { val: 'Nil' },
    mucus: { val: '+' },
    albumin: { val: 'Trace', flag: 'H' },
    sugar: { val: 'Nil' },
    ketone: { val: 'Nil' },
    nitrite: { val: 'Positive', flag: 'H' },
    spGravity: { val: '1.020' },
    ph: { val: '6.5' },
  },
  example_3_critical_high: {
    rbc: { val: '45 - 50', flag: 'H' },
    pusCells: { val: '2 - 4' },
    squamousEpi: { val: '1 - 2' },
    transitionalEpi: { val: 'Nil' },
    renalTubularEpi: { val: 'Nil' },
    hyalineCasts: { val: '1 - 2', flag: 'H' },
    granularCasts: { val: 'Nil' },
    rbcCasts: { val: '2 - 4', flag: 'H' },
    wbcCasts: { val: 'Nil' },
    calciumOxalate: { val: 'Nil' },
    bacteria: { val: 'Nil' },
    yeast: { val: 'Nil' },
    mucus: { val: 'Nil' },
    albumin: { val: '++ (100 mg/dL)', flag: 'H' },
    sugar: { val: 'Nil' },
    ketone: { val: 'Nil' },
    nitrite: { val: 'Negative' },
    spGravity: { val: '1.025' },
    ph: { val: '5.5' },
  },
  example_4_critical_low: {
    rbc: { val: '2 - 4' },
    pusCells: { val: '1 - 2' },
    squamousEpi: { val: 'Nil' },
    transitionalEpi: { val: 'Nil' },
    renalTubularEpi: { val: '2 - 4', flag: 'H' },
    hyalineCasts: { val: '4 - 6', flag: 'H' },
    granularCasts: { val: '3 - 5', flag: 'H' },
    rbcCasts: { val: 'Nil' },
    wbcCasts: { val: 'Nil' },
    calciumOxalate: { val: 'Nil' },
    bacteria: { val: 'Nil' },
    yeast: { val: 'Nil' },
    mucus: { val: 'Nil' },
    albumin: { val: '+++ (300 mg/dL)', flag: 'H' },
    sugar: { val: 'Nil' },
    ketone: { val: 'Nil' },
    nitrite: { val: 'Negative' },
    spGravity: { val: '1.010' },
    ph: { val: '6.0' },
  },
  example_5_atypical: {
    rbc: { val: '1 - 2' },
    pusCells: { val: '3 - 5' },
    squamousEpi: { val: '15 - 20', flag: 'H' },
    transitionalEpi: { val: '1 - 2' },
    renalTubularEpi: { val: 'Nil' },
    hyalineCasts: { val: 'Nil' },
    granularCasts: { val: 'Nil' },
    rbcCasts: { val: 'Nil' },
    wbcCasts: { val: 'Nil' },
    calciumOxalate: { val: '++', flag: 'H' },
    bacteria: { val: 'Few' },
    yeast: { val: 'Nil' },
    mucus: { val: '+' },
    albumin: { val: 'Nil' },
    sugar: { val: 'Nil' },
    ketone: { val: 'Nil' },
    nitrite: { val: 'Negative' },
    spGravity: { val: '1.018' },
    ph: { val: '6.5' },
  },
};

/**
 * Extracts the appropriate simulated raw value for a code map according to the chosen scenario.
 */
export function extractMockValueFromMap(
  map: CodeMapDto,
  scenarioKey: string
): { rawValue: number | string; flag?: string } {
  const key = (map.testCatalogKey || '').toUpperCase();
  const name = (map.testName || '').toLowerCase();
  const code = (map.analyzerCode || '').toUpperCase();

  const cbc = MOCK_CBC_DATASETS[scenarioKey] || MOCK_CBC_DATASETS['example_1_normal'];
  const chem = MOCK_CHEM_DATASETS[scenarioKey] || MOCK_CHEM_DATASETS['example_1_normal'];
  const hba1c = MOCK_HBA1C_DATASETS[scenarioKey] || MOCK_HBA1C_DATASETS['example_1_normal'];
  const urine = MOCK_URINE_DATASETS[scenarioKey] || MOCK_URINE_DATASETS['example_1_normal'];

  // Urine Routine & Microscopy parameters
  if (/pus cell|wbc.*urine|white blood.*urine/i.test(name)) {
    return { rawValue: urine.pusCells.val, flag: urine.pusCells.flag };
  }
  if (/red blood.*urine|rbc.*urine/i.test(name) || (name.includes('urine') && /red blood|rbc/i.test(name))) {
    return { rawValue: urine.rbc.val, flag: urine.rbc.flag };
  }
  if (/squamous/i.test(name)) {
    return { rawValue: urine.squamousEpi.val, flag: urine.squamousEpi.flag };
  }
  if (/transitional/i.test(name)) {
    return { rawValue: urine.transitionalEpi.val, flag: urine.transitionalEpi.flag };
  }
  if (/renal tubular/i.test(name)) {
    return { rawValue: urine.renalTubularEpi.val, flag: urine.renalTubularEpi.flag };
  }
  if (/hyaline/i.test(name)) {
    return { rawValue: urine.hyalineCasts.val, flag: urine.hyalineCasts.flag };
  }
  if (/granular/i.test(name)) {
    return { rawValue: urine.granularCasts.val, flag: urine.granularCasts.flag };
  }
  if (/rbc cast|red blood.*cast/i.test(name)) {
    return { rawValue: urine.rbcCasts.val, flag: urine.rbcCasts.flag };
  }
  if (/wbc cast|pus cell.*cast/i.test(name)) {
    return { rawValue: urine.wbcCasts.val, flag: urine.wbcCasts.flag };
  }
  if (/calcium oxalate|crystal/i.test(name)) {
    return { rawValue: urine.calciumOxalate.val, flag: urine.calciumOxalate.flag };
  }
  if (/bacteria/i.test(name)) {
    return { rawValue: urine.bacteria.val, flag: urine.bacteria.flag };
  }
  if (/yeast/i.test(name)) {
    return { rawValue: urine.yeast.val, flag: urine.yeast.flag };
  }
  if (/mucus/i.test(name)) {
    return { rawValue: urine.mucus.val, flag: urine.mucus.flag };
  }
  if (/epithelial/i.test(name)) {
    return { rawValue: urine.squamousEpi.val, flag: urine.squamousEpi.flag };
  }
  if (/cast/i.test(name)) {
    return { rawValue: urine.hyalineCasts.val, flag: urine.hyalineCasts.flag };
  }

  // Hemoglobin
  if (key === 'HEM011' || code === '718-7' || /haemoglobin|hemoglobin/i.test(name)) {
    return { rawValue: cbc.hgb.val, flag: cbc.hgb.flag };
  }
  // RBC
  if (key === 'HEM012' || code === '789-8' || /red blood/i.test(name)) {
    return { rawValue: cbc.rbc.val, flag: cbc.rbc.flag };
  }
  // PCV / HCT
  if (key === 'HEM013' || code === '4544-3' || /haematocrit|hematocrit|packed cell/i.test(name)) {
    return { rawValue: cbc.pcv.val, flag: cbc.pcv.flag };
  }
  // MCV
  if (key === 'HEM014' || code === '787-2' || /mean corpuscular volume/i.test(name)) {
    return { rawValue: cbc.mcv.val, flag: cbc.mcv.flag };
  }
  // MCH
  if (key === 'HEM015' || code === '785-6' || /mean corpuscular haemoglobin$|mean corpuscular hemoglobin$/i.test(name)) {
    return { rawValue: cbc.mch.val, flag: cbc.mch.flag };
  }
  // MCHC
  if (key === 'HEM016' || code === '786-4' || /concentration/i.test(name)) {
    return { rawValue: cbc.mchc.val, flag: cbc.mchc.flag };
  }
  // RDW-CV
  if (key === 'HEM017' || code === '788-0' || /rdw|red cell distribution/i.test(name)) {
    return { rawValue: cbc.rdw.val, flag: cbc.rdw.flag };
  }
  // WBC (apply raw units vs master factor)
  if (key === 'HEM019' || code === '6690-2' || /leukocyte|wbc|white blood/i.test(name)) {
    const rawVal = map.factor === 1000 ? cbc.wbc.val : cbc.wbc.val * 1000;
    return { rawValue: rawVal, flag: cbc.wbc.flag };
  }
  // Platelet (apply raw units vs master factor)
  if (key === 'HEM030' || code === '777-3' || /platelet count/i.test(name)) {
    const rawVal = map.factor === 1000 ? cbc.plt.val : cbc.plt.val * 1000;
    return { rawValue: rawVal, flag: cbc.plt.flag };
  }
  // MPV
  if (key === 'HEM031' || code === '32623-1' || /mean platelet volume/i.test(name)) {
    return { rawValue: cbc.mpv.val, flag: cbc.mpv.flag };
  }
  // PDW
  if (key === 'HEM032' || code === '32207-3' || /platelet distribution width/i.test(name)) {
    return { rawValue: cbc.pdw.val, flag: cbc.pdw.flag };
  }
  // Plateletcrit
  if (key === 'HEM033' || code === '11003' || /plateletcrit/i.test(name)) {
    return { rawValue: cbc.pct.val, flag: cbc.pct.flag };
  }
  // Differentials
  if (key === 'HEM020' || code === '770-8' || /neutrophil percentage/i.test(name)) {
    return { rawValue: cbc.neutPct.val, flag: cbc.neutPct.flag };
  }
  if (key === 'HEM021' || code === '736-9' || /lymphocyte percentage/i.test(name)) {
    return { rawValue: cbc.lymphPct.val, flag: cbc.lymphPct.flag };
  }
  if (key === 'HEM022' || code === '5905-5' || /monocyte percentage/i.test(name)) {
    return { rawValue: cbc.monoPct.val, flag: cbc.monoPct.flag };
  }
  if (key === 'HEM023' || code === '713-8' || /eosinophil percentage/i.test(name)) {
    return { rawValue: cbc.eosPct.val, flag: cbc.eosPct.flag };
  }
  if (key === 'HEM024' || code === '706-2' || /basophil percentage/i.test(name)) {
    return { rawValue: cbc.basoPct.val, flag: cbc.basoPct.flag };
  }
  // Absolute counts
  if (key === 'HEM025' || code === '751-8' || /absolute neutrophil/i.test(name)) {
    return { rawValue: cbc.neutAbs.val, flag: cbc.neutAbs.flag };
  }
  if (key === 'HEM026' || code === '731-0' || /absolute lymphocyte/i.test(name)) {
    return { rawValue: cbc.lymphAbs.val, flag: cbc.lymphAbs.flag };
  }
  if (key === 'HEM027' || code === '742-7' || /absolute monocyte/i.test(name)) {
    return { rawValue: cbc.monoAbs.val, flag: cbc.monoAbs.flag };
  }
  if (key === 'HEM028' || code === '711-2' || /absolute eosinophil/i.test(name)) {
    return { rawValue: cbc.eosAbs.val, flag: cbc.eosAbs.flag };
  }
  if (key === 'HEM029' || code === '704-7' || /absolute basophil/i.test(name)) {
    return { rawValue: cbc.basoAbs.val, flag: cbc.basoAbs.flag };
  }

  // HbA1c
  if (/hba1c|glycated/i.test(name) || /hba1c/i.test(code) || code === '4548-4') {
    return { rawValue: hba1c.val, flag: hba1c.flag };
  }

  // Glucose / Blood Sugar (Random Blood Sugar, Fasting, Postprandial, GRBS)
  if (/glucose|sugar|rbs|fbs|ppbs|grbs/i.test(name) || /glu|rbs|fbs|2345-7/i.test(code)) {
    return { rawValue: chem.glu.val, flag: chem.glu.flag };
  }
  if (/urea|bun/i.test(name) || /urea/i.test(code) || code === '3094-0') {
    return { rawValue: chem.urea.val, flag: chem.urea.flag };
  }
  if (/creatinine/i.test(name) || /creat/i.test(code) || code === '2160-0') {
    return { rawValue: chem.creat.val, flag: chem.creat.flag };
  }
  if (/cholesterol/i.test(name) || /chol/i.test(code)) {
    return { rawValue: chem.chol.val, flag: chem.chol.flag };
  }
  if (/triglyceride/i.test(name) || /trig/i.test(code)) {
    return { rawValue: chem.trig.val, flag: chem.trig.flag };
  }
  if (/sgot|ast/i.test(name) || /ast/i.test(code)) {
    return { rawValue: chem.ast.val, flag: chem.ast.flag };
  }
  if (/sgpt|alt/i.test(name) || /alt/i.test(code)) {
    return { rawValue: chem.alt.val, flag: chem.alt.flag };
  }
  if (/bilirubin/i.test(name) || /bil/i.test(code)) {
    return { rawValue: chem.tbil.val, flag: chem.tbil.flag };
  }
  if (/uric/i.test(name) || /ua/i.test(code)) {
    return { rawValue: chem.uric.val, flag: chem.uric.flag };
  }
  if (/total protein/i.test(name) || /tp/i.test(code)) {
    return { rawValue: chem.tp.val, flag: chem.tp.flag };
  }
  if (/albumin/i.test(name) || /alb/i.test(code)) {
    return { rawValue: chem.alb.val, flag: chem.alb.flag };
  }

  return { rawValue: 1.0 };
}

/** Formats the raw numeric value with code map's factor, offset, and decimal places. */
export function formatMockConvertedValue(raw: number | string, map: CodeMapDto): string {
  if (typeof raw === 'string') return raw;
  const num = Number(raw);
  if (isNaN(num)) return String(raw);
  const factor = map.factor == null || map.factor === 0 ? 1 : Number(map.factor);
  const offset = map.offset == null ? 0 : Number(map.offset);
  const v = num * factor + offset;
  if (map.decimals != null && map.decimals >= 0) {
    return v.toFixed(map.decimals);
  }
  return String(v);
}
