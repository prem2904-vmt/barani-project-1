/**
 * Comprehensive Analyzer Protocol Simulator & Frame Generator.
 * Generates standards-compliant, clinically realistic frames and records
 * for all analyzer protocol families supported by Prefrontal LMS:
 *
 *  1. ASTM E1381 / E1394 (Haematology 5-Part CBC, Clinical Chemistry)
 *  2. HL7 v2.3.1 / v2.5 MLLP (Biochemistry, Immunoassay)
 *  3. LifeDx HBPro HPLC (Fixed-width STX/ETX ASCII + HbA1c Chromatogram Curve)
 *  4. Sinocare iCARE-2100 (Binary SN Frames with FHIR JSON Observation)
 *  5. Text / Ticket (3-Part Counter, Urine Strip printouts with \f terminator)
 *
 * Features 5 distinct, internally consistent clinical example profiles per instrument:
 *  - Example 1: Normal Adult Reference Range
 *  - Example 2: Abnormal / Moderate Pathology (e.g. Microcytic Anemia, Prediabetes, Dyslipidemia)
 *  - Example 3: Critical High / Panic Value (e.g. Severe Sepsis Leukocytosis, DKA Hyperglycemia)
 *  - Example 4: Critical Low / Panic Value (e.g. Severe Pancytopenia / Thrombocytopenia, Hypoglycemia)
 *  - Example 5: Atypical / Variant (e.g. Hypereosinophilic Syndrome, Acute Renal / Liver Failure)
 */

import { CodeMapDto, InstrumentMessage, InstrumentResult, ParserType } from './instrument.models';

export type CanonicalScenario =
  | 'example_1_normal'
  | 'example_2_abnormal'
  | 'example_3_critical_high'
  | 'example_4_critical_low'
  | 'example_5_atypical'
  | 'qc'
  | 'corrupted';

export type SimulationScenario =
  | 'random'
  | 'normal'
  | 'abnormal'
  | 'high_panic'
  | 'low_panic'
  | 'atypical'
  | 'example_1_normal'
  | 'example_2_abnormal'
  | 'example_3_critical_high'
  | 'example_4_critical_low'
  | 'example_5_atypical'
  | 'qc'
  | 'corrupted';

export const FIVE_EXAMPLE_SCENARIOS: CanonicalScenario[] = [
  'example_1_normal',
  'example_2_abnormal',
  'example_3_critical_high',
  'example_4_critical_low',
  'example_5_atypical',
];

export interface ScenarioMeta {
  canonical: CanonicalScenario;
  key: string;
  label: string;
  badge: string;
  clinicalNote: string;
}

export function resolveSimulationScenario(scenario?: SimulationScenario): ScenarioMeta {
  let s: string | undefined = scenario;
  if (!s || s === 'random') {
    const idx = Math.floor(Math.random() * FIVE_EXAMPLE_SCENARIOS.length);
    s = FIVE_EXAMPLE_SCENARIOS[idx];
  }

  switch (s) {
    case 'example_1_normal':
    case 'normal':
      return {
        canonical: 'example_1_normal',
        key: 'example_1_normal',
        label: 'Normal Adult Reference',
        badge: 'Normal',
        clinicalNote: 'All parameters within healthy adult reference ranges',
      };
    case 'example_2_abnormal':
    case 'abnormal':
      return {
        canonical: 'example_2_abnormal',
        key: 'example_2_abnormal',
        label: 'Microcytic Hypochromic Anemia (Abnormal)',
        badge: 'Abnormal',
        clinicalNote: 'Low hemoglobin, microcytic RBCs, elevated RDW',
      };
    case 'example_3_critical_high':
    case 'high_panic':
      return {
        canonical: 'example_3_critical_high',
        key: 'example_3_critical_high',
        label: 'Severe Sepsis / Leukocytosis (Critical High Panic)',
        badge: 'Critical High',
        clinicalNote: 'Critical WBC > 30,000 cells/µL, neutrophil shift, thrombocytosis',
      };
    case 'example_4_critical_low':
    case 'low_panic':
      return {
        canonical: 'example_4_critical_low',
        key: 'example_4_critical_low',
        label: 'Severe Pancytopenia (Critical Low Panic)',
        badge: 'Critical Low',
        clinicalNote: 'Critical low Hb < 6.0 g/dL, WBC < 2000 cells/µL, PLT < 20,000 cells/µL',
      };
    case 'example_5_atypical':
    case 'atypical':
      return {
        canonical: 'example_5_atypical',
        key: 'example_5_atypical',
        label: 'Marked Eosinophilia / Allergy (Atypical Variant)',
        badge: 'Atypical',
        clinicalNote: 'Markedly elevated eosinophils > 18%, moderate leukocytosis',
      };
    case 'qc':
      return {
        canonical: 'qc',
        key: 'qc',
        label: 'Quality Control (QC run)',
        badge: 'QC',
        clinicalNote: 'Known calibration control material on target',
      };
    case 'corrupted':
      return {
        canonical: 'corrupted',
        key: 'corrupted',
        label: 'Framing Glitch / Checksum Error',
        badge: 'Corrupted',
        clinicalNote: 'Simulated communication parity or framing error',
      };
    default:
      return {
        canonical: 'example_1_normal',
        key: 'example_1_normal',
        label: 'Normal Adult Reference',
        badge: 'Normal',
        clinicalNote: 'All parameters within healthy adult reference ranges',
      };
  }
}

export interface SimulationJob {
  protocol: ParserType;
  sampleId: string;
  patientName?: string;
  patientAge?: number;
  patientSex?: 'M' | 'F' | 'O';
  scenario?: SimulationScenario;
  analyzerSerial?: string;
  runAt?: Date;
  tests?: string[];
  customValues?: Record<string, number | string>;
  codeMaps?: CodeMapDto[];
}

export interface GeneratedSimulation {
  protocol: ParserType;
  sampleId: string;
  rawText: string;
  rawBytes?: Uint8Array;
  message: InstrumentMessage;
  summary: string;
  scenarioMeta: ScenarioMeta;
}

// ── Date Formatting Helpers ────────────────────────────────────────────────
function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

export function formatAstmTimestamp(d: Date = new Date()): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function formatHl7Timestamp(d: Date = new Date()): string {
  return formatAstmTimestamp(d);
}

// ── ASTM E1381 Framing Helpers ─────────────────────────────────────────────
const ENQ = '\x05';
const ACK = '\x06';
const NAK = '\x15';
const STX = '\x02';
const ETX = '\x03';
const ETB = '\x17';
const EOT = '\x04';
const CR = '\x0D';
const LF = '\x0A';

/** Computes the 2-digit hex checksum for ASTM E1381 frame payload (bytes between STX and ETX/ETB inclusive). */
export function calculateAstmChecksum(frameContent: string): string {
  let sum = 0;
  for (let i = 0; i < frameContent.length; i++) {
    sum = (sum + frameContent.charCodeAt(i)) & 0xff;
  }
  return sum.toString(16).toUpperCase().padStart(2, '0');
}

/** Wraps a single ASTM record string in E1381 frame with sequence number, ETX, and checksum. */
export function wrapAstmFrame(seq: number, content: string, isIntermediate = false): string {
  const term = isIntermediate ? ETB : ETX;
  const body = `${seq % 8}${content}${CR}${term}`;
  const cs = calculateAstmChecksum(body);
  return `${STX}${body}${cs}${CR}${LF}`;
}

// ── MLLP Framing Helpers ───────────────────────────────────────────────────
const MLLP_START = '\x0B'; // <VT>
const MLLP_END = '\x1C\x0D'; // <FS><CR>

export function wrapMllp(hl7Text: string): string {
  return `${MLLP_START}${hl7Text}${MLLP_END}`;
}

// ── 5 Clinical Example Profiles for Haematology (CBC) ────────────────────────
export interface SimulatedCbcProfile {
  hgb: { val: number; flag?: string };
  rbc: { val: number; flag?: string };
  pcv: { val: number; flag?: string };
  mcv: { val: number; flag?: string };
  mch: { val: number; flag?: string };
  mchc: { val: number; flag?: string };
  rdw: { val: number; flag?: string };
  wbc: { val: number; flag?: string }; // in 10^3/µL (raw)
  plt: { val: number; flag?: string }; // in 10^3/µL (raw)
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

export const CBC_EXAMPLES: Record<CanonicalScenario, SimulatedCbcProfile> = {
  // Example 1: Normal Adult Complete Blood Count
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

  // Example 2: Microcytic Hypochromic Anemia (Abnormal)
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

  // Example 3: Severe Sepsis / Leukocytosis with Left Shift (Critical High Panic)
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

  // Example 4: Severe Pancytopenia / Aplastic Crisis (Critical Low Panic)
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

  // Example 5: Hypereosinophilic Syndrome / Marked Allergy (Atypical Variant)
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

  // QC fallback (target calibration values)
  qc: {
    hgb: { val: 14.0 },
    rbc: { val: 4.80 },
    pcv: { val: 42.0 },
    mcv: { val: 88.0 },
    mch: { val: 29.5 },
    mchc: { val: 33.0 },
    rdw: { val: 12.5 },
    wbc: { val: 7.00 },
    plt: { val: 250 },
    mpv: { val: 9.5 },
    pdw: { val: 15.5 },
    pct: { val: 0.240 },
    neutPct: { val: 60.0 },
    lymphPct: { val: 30.0 },
    monoPct: { val: 6.0 },
    eosPct: { val: 3.0 },
    basoPct: { val: 1.0 },
    neutAbs: { val: 4.20 },
    lymphAbs: { val: 2.10 },
    monoAbs: { val: 0.42 },
    eosAbs: { val: 0.21 },
    basoAbs: { val: 0.07 },
  },

  // Corrupted fallback
  corrupted: {
    hgb: { val: 0 },
    rbc: { val: 0 },
    pcv: { val: 0 },
    mcv: { val: 0 },
    mch: { val: 0 },
    mchc: { val: 0 },
    rdw: { val: 0 },
    wbc: { val: 0 },
    plt: { val: 0 },
    mpv: { val: 0 },
    pdw: { val: 0 },
    pct: { val: 0 },
    neutPct: { val: 0 },
    lymphPct: { val: 0 },
    monoPct: { val: 0 },
    eosPct: { val: 0 },
    basoPct: { val: 0 },
    neutAbs: { val: 0 },
    lymphAbs: { val: 0 },
    monoAbs: { val: 0 },
    eosAbs: { val: 0 },
    basoAbs: { val: 0 },
  },
};

// ── 5 Clinical Example Profiles for HPLC HbA1c ──────────────────────────────
export const HBA1C_EXAMPLES: Record<CanonicalScenario, { val: number; flag?: string; note: string }> = {
  example_1_normal: { val: 5.3, note: 'Normal Non-Diabetic (< 5.7%)' },
  example_2_abnormal: { val: 6.2, flag: 'H', note: 'Prediabetes (5.7 - 6.4%)' },
  example_3_critical_high: { val: 13.2, flag: 'H', note: 'Severe Hyperglycemia / Critical High (> 12.0%)' },
  example_4_critical_low: { val: 4.0, flag: 'L', note: 'Hypoglycemia / Variant (< 4.5%)' },
  example_5_atypical: { val: 8.4, flag: 'H', note: 'Uncontrolled Type 2 Diabetes' },
  qc: { val: 6.0, note: 'QC Level 1 Target' },
  corrupted: { val: 0, note: 'Signal Loss' },
};

// ── 5 Clinical Example Profiles for Clinical Chemistry ───────────────────────
export interface SimulatedChemProfile {
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

export const CHEM_EXAMPLES: Record<CanonicalScenario, SimulatedChemProfile> = {
  // Example 1: Normal Adult Metabolic Panel
  example_1_normal: {
    glu: { val: 92 },
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

  // Example 2: Impaired Glucose & Dyslipidemia (Abnormal)
  example_2_abnormal: {
    glu: { val: 124, flag: 'H' },
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

  // Example 3: Severe Hyperglycemia / Diabetic Ketoacidosis (Critical High Panic)
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

  // Example 4: Acute Renal Failure / Uremia (Critical High Panic Renal)
  example_4_critical_low: {
    glu: { val: 108 },
    urea: { val: 165, flag: 'H' },
    creat: { val: 7.80, flag: 'H' },
    chol: { val: 190 },
    trig: { val: 160 },
    ast: { val: 32 },
    alt: { val: 35 },
    tbil: { val: 1.00 },
    uric: { val: 12.4, flag: 'H' },
    tp: { val: 6.2, flag: 'L' },
    alb: { val: 3.2, flag: 'L' },
  },

  // Example 5: Acute Hepatic Necrosis / Hepatitis (Critical High Panic Transaminases)
  example_5_atypical: {
    glu: { val: 62, flag: 'L' },
    urea: { val: 18 },
    creat: { val: 0.75 },
    chol: { val: 145 },
    trig: { val: 110 },
    ast: { val: 720, flag: 'H' },
    alt: { val: 950, flag: 'H' },
    tbil: { val: 6.80, flag: 'H' },
    uric: { val: 4.2 },
    tp: { val: 5.8, flag: 'L' },
    alb: { val: 2.9, flag: 'L' },
  },

  qc: {
    glu: { val: 100 },
    urea: { val: 30 },
    creat: { val: 1.00 },
    chol: { val: 200 },
    trig: { val: 150 },
    ast: { val: 30 },
    alt: { val: 30 },
    tbil: { val: 1.00 },
    uric: { val: 5.0 },
    tp: { val: 7.0 },
    alb: { val: 4.0 },
  },

  corrupted: {
    glu: { val: 0 },
    urea: { val: 0 },
    creat: { val: 0 },
    chol: { val: 0 },
    trig: { val: 0 },
    ast: { val: 0 },
    alt: { val: 0 },
    tbil: { val: 0 },
    uric: { val: 0 },
    tp: { val: 0 },
    alb: { val: 0 },
  },
};

// ── Value Extraction Engine using Code Maps ──────────────────────────────────
export function getSimulatedRawValue(
  m: CodeMapDto,
  scenario: SimulationScenario = 'random'
): { value: number; flag?: string; scenarioMeta: ScenarioMeta } {
  const meta = resolveSimulationScenario(scenario);
  const key = (m.testCatalogKey || '').toUpperCase();
  const name = (m.testName || '').toLowerCase();
  const code = (m.analyzerCode || '').toUpperCase();

  const cbc = CBC_EXAMPLES[meta.canonical] || CBC_EXAMPLES.example_1_normal;
  const chem = CHEM_EXAMPLES[meta.canonical] || CHEM_EXAMPLES.example_1_normal;
  const hba1c = HBA1C_EXAMPLES[meta.canonical] || HBA1C_EXAMPLES.example_1_normal;

  // 1. Hemoglobin (HEM011, 718-7, HGB)
  if (key === 'HEM011' || code === '718-7' || /haemoglobin|hemoglobin/i.test(name)) {
    return { value: cbc.hgb.val, flag: cbc.hgb.flag, scenarioMeta: meta };
  }

  // 2. RBC (HEM012, 789-8, RBC)
  if (key === 'HEM012' || code === '789-8' || /red blood/i.test(name)) {
    return { value: cbc.rbc.val, flag: cbc.rbc.flag, scenarioMeta: meta };
  }

  // 3. Hematocrit / PCV (HEM013, 4544-3, HCT, PCV)
  if (key === 'HEM013' || code === '4544-3' || /haematocrit|hematocrit|packed cell/i.test(name)) {
    return { value: cbc.pcv.val, flag: cbc.pcv.flag, scenarioMeta: meta };
  }

  // 4. MCV (HEM014, 787-2, MCV)
  if (key === 'HEM014' || code === '787-2' || /mean corpuscular volume/i.test(name)) {
    return { value: cbc.mcv.val, flag: cbc.mcv.flag, scenarioMeta: meta };
  }

  // 5. MCH (HEM015, 785-6, MCH)
  if (key === 'HEM015' || code === '785-6' || /mean corpuscular haemoglobin$|mean corpuscular hemoglobin$/i.test(name)) {
    return { value: cbc.mch.val, flag: cbc.mch.flag, scenarioMeta: meta };
  }

  // 6. MCHC (HEM016, 786-4, MCHC)
  if (key === 'HEM016' || code === '786-4' || /concentration/i.test(name)) {
    return { value: cbc.mchc.val, flag: cbc.mchc.flag, scenarioMeta: meta };
  }

  // 7. RDW-CV (HEM017, 788-0, RDW)
  if (key === 'HEM017' || code === '788-0' || /rdw|red cell distribution/i.test(name)) {
    return { value: cbc.rdw.val, flag: cbc.rdw.flag, scenarioMeta: meta };
  }

  // 8. Total Leukocyte Count / WBC (HEM019, 6690-2, WBC)
  if (key === 'HEM019' || code === '6690-2' || /leukocyte|wbc|white blood/i.test(name)) {
    const rawUnits = m.factor === 1000;
    const val = rawUnits ? cbc.wbc.val : cbc.wbc.val * 1000;
    return { value: val, flag: cbc.wbc.flag, scenarioMeta: meta };
  }

  // 9. Platelet Count (HEM030, 777-3, PLT)
  if (key === 'HEM030' || code === '777-3' || /platelet count/i.test(name)) {
    const rawUnits = m.factor === 1000;
    const val = rawUnits ? cbc.plt.val : cbc.plt.val * 1000;
    return { value: val, flag: cbc.plt.flag, scenarioMeta: meta };
  }

  // 10. MPV (HEM031, 32623-1, MPV)
  if (key === 'HEM031' || code === '32623-1' || /mean platelet volume/i.test(name)) {
    return { value: cbc.mpv.val, flag: cbc.mpv.flag, scenarioMeta: meta };
  }

  // 11. PDW (HEM032, 32207-3, PDW)
  if (key === 'HEM032' || code === '32207-3' || /platelet distribution width/i.test(name)) {
    return { value: cbc.pdw.val, flag: cbc.pdw.flag, scenarioMeta: meta };
  }

  // 12. Plateletcrit / PCT (HEM033, 11003, PCT)
  if (key === 'HEM033' || code === '11003' || /plateletcrit/i.test(name)) {
    return { value: cbc.pct.val, flag: cbc.pct.flag, scenarioMeta: meta };
  }

  // 13. Differentials Percentages
  if (key === 'HEM020' || code === '770-8' || /neutrophil percentage/i.test(name)) {
    return { value: cbc.neutPct.val, flag: cbc.neutPct.flag, scenarioMeta: meta };
  }
  if (key === 'HEM021' || code === '736-9' || /lymphocyte percentage/i.test(name)) {
    return { value: cbc.lymphPct.val, flag: cbc.lymphPct.flag, scenarioMeta: meta };
  }
  if (key === 'HEM022' || code === '5905-5' || /monocyte percentage/i.test(name)) {
    return { value: cbc.monoPct.val, flag: cbc.monoPct.flag, scenarioMeta: meta };
  }
  if (key === 'HEM023' || code === '713-8' || /eosinophil percentage/i.test(name)) {
    return { value: cbc.eosPct.val, flag: cbc.eosPct.flag, scenarioMeta: meta };
  }
  if (key === 'HEM024' || code === '706-2' || /basophil percentage/i.test(name)) {
    return { value: cbc.basoPct.val, flag: cbc.basoPct.flag, scenarioMeta: meta };
  }

  // 14. Absolute Differential Counts
  if (key === 'HEM025' || code === '751-8' || /absolute neutrophil/i.test(name)) {
    return { value: cbc.neutAbs.val, flag: cbc.neutAbs.flag, scenarioMeta: meta };
  }
  if (key === 'HEM026' || code === '731-0' || /absolute lymphocyte/i.test(name)) {
    return { value: cbc.lymphAbs.val, flag: cbc.lymphAbs.flag, scenarioMeta: meta };
  }
  if (key === 'HEM027' || code === '742-7' || /absolute monocyte/i.test(name)) {
    return { value: cbc.monoAbs.val, flag: cbc.monoAbs.flag, scenarioMeta: meta };
  }
  if (key === 'HEM028' || code === '711-2' || /absolute eosinophil/i.test(name)) {
    return { value: cbc.eosAbs.val, flag: cbc.eosAbs.flag, scenarioMeta: meta };
  }
  if (key === 'HEM029' || code === '704-7' || /absolute basophil/i.test(name)) {
    return { value: cbc.basoAbs.val, flag: cbc.basoAbs.flag, scenarioMeta: meta };
  }

  // 15. HbA1c
  if (/hba1c|glycated/i.test(name) || /hba1c/i.test(code) || code === '4548-4') {
    return { value: hba1c.val, flag: hba1c.flag, scenarioMeta: meta };
  }

  // 16. Chemistry
  if (/glucose|sugar/i.test(name) || /glu/i.test(code) || code === '2345-7') {
    return { value: chem.glu.val, flag: chem.glu.flag, scenarioMeta: meta };
  }
  if (/urea|bun/i.test(name) || /urea/i.test(code) || code === '3094-0') {
    return { value: chem.urea.val, flag: chem.urea.flag, scenarioMeta: meta };
  }
  if (/creatinine/i.test(name) || /creat/i.test(code) || code === '2160-0') {
    return { value: chem.creat.val, flag: chem.creat.flag, scenarioMeta: meta };
  }
  if (/cholesterol/i.test(name) || /chol/i.test(code)) {
    return { value: chem.chol.val, flag: chem.chol.flag, scenarioMeta: meta };
  }
  if (/triglyceride/i.test(name) || /trig/i.test(code)) {
    return { value: chem.trig.val, flag: chem.trig.flag, scenarioMeta: meta };
  }
  if (/sgot|ast/i.test(name) || /ast/i.test(code)) {
    return { value: chem.ast.val, flag: chem.ast.flag, scenarioMeta: meta };
  }
  if (/sgpt|alt/i.test(name) || /alt/i.test(code)) {
    return { value: chem.alt.val, flag: chem.alt.flag, scenarioMeta: meta };
  }
  if (/bilirubin/i.test(name) || /bil/i.test(code)) {
    return { value: chem.tbil.val, flag: chem.tbil.flag, scenarioMeta: meta };
  }
  if (/uric/i.test(name) || /ua/i.test(code)) {
    return { value: chem.uric.val, flag: chem.uric.flag, scenarioMeta: meta };
  }
  if (/total protein/i.test(name) || /tp/i.test(code)) {
    return { value: chem.tp.val, flag: chem.tp.flag, scenarioMeta: meta };
  }
  if (/albumin/i.test(name) || /alb/i.test(code)) {
    return { value: chem.alb.val, flag: chem.alb.flag, scenarioMeta: meta };
  }

  return { value: 1.0, scenarioMeta: meta };
}

export function formatConvertedValue(raw: number, m: CodeMapDto): string {
  const factor = m.factor == null || m.factor === 0 ? 1 : Number(m.factor);
  const offset = m.offset == null ? 0 : Number(m.offset);
  const val = raw * factor + offset;
  if (m.decimals != null && m.decimals >= 0) {
    return val.toFixed(m.decimals);
  }
  return String(val);
}

// ── 1. LifeDx HBPro HPLC (HbA1c) Generator ─────────────────────────────────
export function generateLifeDxHbProSimulation(job: SimulationJob): GeneratedSimulation {
  const d = job.runAt || new Date();
  const sample = (job.sampleId || '26354').replace(/[^A-Za-z0-9-]/g, '');
  const paddedSample = sample.padStart(6, '-').slice(-6);

  const name = (job.patientName || 'PREM KUMAR K').padEnd(16, ' ').slice(0, 16);
  const age = String(job.patientAge ?? 30).padStart(3, '0').slice(-3);
  const sex = job.patientSex || 'M';

  const meta = resolveSimulationScenario(job.scenario);
  const ex = HBA1C_EXAMPLES[meta.canonical] || HBA1C_EXAMPLES.example_1_normal;
  let hba1cVal = ex.val;
  let flag = ex.flag;

  if (job.customValues && job.customValues['HbA1c'] !== undefined) {
    hba1cVal = Number(job.customValues['HbA1c']) || 7.2;
    flag = hba1cVal >= 6.5 ? 'H' : hba1cVal < 4.5 ? 'L' : undefined;
  }

  const hba1cStr = hba1cVal.toFixed(1).padStart(4, '0'); // e.g. "07.2"

  // Fixed-width header block
  const header = `S04${paddedSample}${name} ${age} ${sex}`;
  const timestamp = `${d.getFullYear().toString().slice(-2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

  // Fixed-width values with realistic chromatogram peak data
  const retention = '018253351760.00120.00210.00080.00210.00380.285700.02000.07700.04200.18700.43808.51200.301.000.502.405.';
  const payload = `${header}${timestamp}${retention}${hba1cStr}91.8038.606.4116.42000.00000.00000.00000.00000.00000.00000.00000.00000.00000.00000.00000.00000.00000.00010.00050.00120.00090.00030.00050.00080.00080.00090.00090.00090.00090.00090.00130.00200.00200.00160.00120.00090.00070.00060.00050.00050.00060.00070.00080.00080.00080.00070.00070.00060.00070.00070.00090.00120.00150.00190.00210.00210.00190.00170.00150.00130.00130.00120.00110.00110.00100.00090.00080.00070.00070.00070.00060.00070.00070.00080.00080.00100.00120.00170.00210.00270.00320.00350.00370.00380.00370.00350.00320.00290.00260.00230.00210.00180.00160.00140.00130.00110.00110.00100.00090.00090.00090.00100.00120.00140.00170.00210.00290.00470.00570.00640.00850.01320.01460.01350.01310.01450.01580.01600.01680.03280.11600.26300.27610.18540.10680.05320.03280.02310.01730.01110.00710.00430.00300.00200.00160.00120.00120.00130.00140.00150.00150.00110.00100.00160.00170.00160.00170.00200.00200.00150.00100.00060.00040.00040.00030.00020.00020.00010.00010.00010.00010.00010.00010.00010.00010.00000`;

  const rawText = `${STX}${payload}${ETX}`;

  const results: InstrumentResult[] = [
    { code: 'HbA1c', value: String(hba1cVal), unit: '%', flags: flag ? [flag] : [] },
  ];

  return {
    protocol: 'lifedx-hbpro',
    sampleId: sample,
    rawText,
    scenarioMeta: meta,
    message: {
      sampleId: sample,
      instrumentSerial: job.analyzerSerial || 'HBPRO-7801',
      runAt: d.toISOString(),
      results,
      qc: meta.canonical === 'qc',
      raw: rawText,
      protocol: 'lifedx-hbpro',
    },
    summary: `LifeDx HBPro HPLC: ${meta.label} · HbA1c ${hba1cVal}%`,
  };
}

// ── 2. ASTM E1381 / E1394 Generator ─────────────────────────────────────────
export function generateAstmSimulation(job: SimulationJob, isChemistry = false): GeneratedSimulation {
  const d = job.runAt || new Date();
  const t = formatAstmTimestamp(d);
  const serial = job.analyzerSerial || (isChemistry ? 'AU480-9901' : 'XN550-2026');
  const sample = job.sampleId || '26354';

  const meta = resolveSimulationScenario(job.scenario);
  const isQc = meta.canonical === 'qc';
  let results: InstrumentResult[] = [];

  if (job.codeMaps && job.codeMaps.length > 0) {
    results = job.codeMaps
      .filter((m) => m.isActive !== false && !!m.analyzerCode)
      .map((m) => {
        const sim = getSimulatedRawValue(m, meta.canonical);
        let valStr = String(sim.value);
        if (job.customValues) {
          if (job.customValues[m.analyzerCode] !== undefined) valStr = String(job.customValues[m.analyzerCode]);
          else if (m.testCatalogKey && job.customValues[m.testCatalogKey] !== undefined) valStr = String(job.customValues[m.testCatalogKey]);
        }
        return {
          code: m.analyzerCode,
          value: valStr,
          unit: m.unit || '',
          flags: sim.flag ? [sim.flag] : [],
        };
      });
  } else if (isChemistry) {
    const ch = CHEM_EXAMPLES[meta.canonical] || CHEM_EXAMPLES.example_1_normal;
    results = [
      { code: 'GLU', value: String(ch.glu.val), unit: 'mg/dL', flags: ch.glu.flag ? [ch.glu.flag] : [] },
      { code: 'UREA', value: String(ch.urea.val), unit: 'mg/dL', flags: ch.urea.flag ? [ch.urea.flag] : [] },
      { code: 'CREAT', value: String(ch.creat.val), unit: 'mg/dL', flags: ch.creat.flag ? [ch.creat.flag] : [] },
      { code: 'CHOL', value: String(ch.chol.val), unit: 'mg/dL', flags: ch.chol.flag ? [ch.chol.flag] : [] },
      { code: 'TRIG', value: String(ch.trig.val), unit: 'mg/dL', flags: ch.trig.flag ? [ch.trig.flag] : [] },
      { code: 'SGOT', value: String(ch.ast.val), unit: 'U/L', flags: ch.ast.flag ? [ch.ast.flag] : [] },
      { code: 'SGPT', value: String(ch.alt.val), unit: 'U/L', flags: ch.alt.flag ? [ch.alt.flag] : [] },
      { code: 'BIL_T', value: String(ch.tbil.val), unit: 'mg/dL', flags: ch.tbil.flag ? [ch.tbil.flag] : [] },
      { code: 'UA', value: String(ch.uric.val), unit: 'mg/dL', flags: ch.uric.flag ? [ch.uric.flag] : [] },
      { code: 'TP', value: String(ch.tp.val), unit: 'g/dL', flags: ch.tp.flag ? [ch.tp.flag] : [] },
      { code: 'ALB', value: String(ch.alb.val), unit: 'g/dL', flags: ch.alb.flag ? [ch.alb.flag] : [] },
    ];
  } else {
    const c = CBC_EXAMPLES[meta.canonical] || CBC_EXAMPLES.example_1_normal;
    results = [
      { code: 'WBC', value: String(c.wbc.val), unit: '10^3/uL', flags: c.wbc.flag ? [c.wbc.flag] : [] },
      { code: 'RBC', value: String(c.rbc.val), unit: '10^6/uL', flags: c.rbc.flag ? [c.rbc.flag] : [] },
      { code: 'HGB', value: String(c.hgb.val), unit: 'g/dL', flags: c.hgb.flag ? [c.hgb.flag] : [] },
      { code: 'HCT', value: String(c.pcv.val), unit: '%', flags: c.pcv.flag ? [c.pcv.flag] : [] },
      { code: 'MCV', value: String(c.mcv.val), unit: 'fL', flags: c.mcv.flag ? [c.mcv.flag] : [] },
      { code: 'MCH', value: String(c.mch.val), unit: 'pg', flags: c.mch.flag ? [c.mch.flag] : [] },
      { code: 'MCHC', value: String(c.mchc.val), unit: 'g/dL', flags: c.mchc.flag ? [c.mchc.flag] : [] },
      { code: 'RDW-CV', value: String(c.rdw.val), unit: '%', flags: c.rdw.flag ? [c.rdw.flag] : [] },
      { code: 'PLT', value: String(c.plt.val), unit: '10^3/uL', flags: c.plt.flag ? [c.plt.flag] : [] },
      { code: 'MPV', value: String(c.mpv.val), unit: 'fL', flags: c.mpv.flag ? [c.mpv.flag] : [] },
      { code: 'PDW', value: String(c.pdw.val), unit: 'fL', flags: c.pdw.flag ? [c.pdw.flag] : [] },
      { code: 'NEUT%', value: String(c.neutPct.val), unit: '%', flags: c.neutPct.flag ? [c.neutPct.flag] : [] },
      { code: 'LYMPH%', value: String(c.lymphPct.val), unit: '%', flags: c.lymphPct.flag ? [c.lymphPct.flag] : [] },
      { code: 'MONO%', value: String(c.monoPct.val), unit: '%', flags: c.monoPct.flag ? [c.monoPct.flag] : [] },
      { code: 'EO%', value: String(c.eosPct.val), unit: '%', flags: c.eosPct.flag ? [c.eosPct.flag] : [] },
      { code: 'BASO%', value: String(c.basoPct.val), unit: '%', flags: c.basoPct.flag ? [c.basoPct.flag] : [] },
    ];
  }

  // Override with custom values if supplied
  if (job.customValues) {
    for (const [k, v] of Object.entries(job.customValues)) {
      const idx = results.findIndex((r) => r.code === k);
      if (idx >= 0) results[idx].value = String(v);
      else results.push({ code: k, value: String(v), unit: '' });
    }
  }

  const records: string[] = [
    `H|\\^&|||${isChemistry ? 'SIM-CHEM' : 'SIM-5P'}^1.0^${serial}|||||||${isQc ? 'Q' : 'P'}|LIS2-A2|${t}`,
    isQc ? 'P|1' : `P|1||||${job.patientName || 'Prem Kumar K'}||${job.patientAge || '30'}|${job.patientSex || 'M'}||||||||||||||||||||`,
    `O|1|${sample}||^^^${isChemistry ? 'CHEM' : 'CBC'}|R|${t}|||||${isQc ? 'Q' : 'N'}||||||||||||||F`,
  ];

  results.forEach((r, idx) => {
    records.push(`R|${idx + 1}|^^^${r.code}|${r.value}|${r.unit || ''}||${r.flags?.[0] || 'N'}||F||||${t}`);
  });

  records.push('L|1|N');

  // Build framed ASTM E1381 session stream: ENQ -> frames -> EOT
  let rawFrames = `${ENQ}`;
  records.forEach((rec, idx) => {
    rawFrames += wrapAstmFrame(idx + 1, rec);
  });
  rawFrames += EOT;

  return {
    protocol: 'astm',
    sampleId: sample,
    rawText: rawFrames,
    scenarioMeta: meta,
    message: {
      sampleId: sample,
      instrumentSerial: serial,
      runAt: d.toISOString(),
      results,
      qc: isQc,
      raw: rawFrames,
      protocol: 'astm',
    },
    summary: `ASTM: ${meta.label} (${results.length} parameters) for sample ${sample}`,
  };
}

// ── 3. HL7 v2.3.1 / v2.5 MLLP Generator ────────────────────────────────────
export function generateHl7Simulation(job: SimulationJob): GeneratedSimulation {
  const d = job.runAt || new Date();
  const t = formatHl7Timestamp(d);
  const serial = job.analyzerSerial || 'HL7-MINDRAY-01';
  const sample = job.sampleId || '26354';
  const ctrlId = `MSG${Date.now().toString(36).toUpperCase()}`;

  const meta = resolveSimulationScenario(job.scenario);
  const isQc = meta.canonical === 'qc';
  let results: InstrumentResult[] = [];

  if (job.codeMaps && job.codeMaps.length > 0) {
    results = job.codeMaps
      .filter((m) => m.isActive !== false && !!m.analyzerCode)
      .map((m) => {
        const sim = getSimulatedRawValue(m, meta.canonical);
        let valStr = String(sim.value);
        if (job.customValues) {
          if (job.customValues[m.analyzerCode] !== undefined) valStr = String(job.customValues[m.analyzerCode]);
          else if (m.testCatalogKey && job.customValues[m.testCatalogKey] !== undefined) valStr = String(job.customValues[m.testCatalogKey]);
        }
        return {
          code: m.analyzerCode,
          value: valStr,
          unit: m.unit || '',
          flags: sim.flag ? [sim.flag] : ['N'],
        };
      });
  } else {
    const c = CBC_EXAMPLES[meta.canonical] || CBC_EXAMPLES.example_1_normal;
    results = [
      { code: 'WBC', value: String(c.wbc.val), unit: '10*3/uL', flags: c.wbc.flag ? [c.wbc.flag] : ['N'] },
      { code: 'RBC', value: String(c.rbc.val), unit: '10*6/uL', flags: c.rbc.flag ? [c.rbc.flag] : ['N'] },
      { code: 'HGB', value: String(c.hgb.val), unit: 'g/dL', flags: c.hgb.flag ? [c.hgb.flag] : ['N'] },
      { code: 'HCT', value: String(c.pcv.val), unit: '%', flags: c.pcv.flag ? [c.pcv.flag] : ['N'] },
      { code: 'PLT', value: String(c.plt.val), unit: '10*3/uL', flags: c.plt.flag ? [c.plt.flag] : ['N'] },
      { code: 'NEUT%', value: String(c.neutPct.val), unit: '%', flags: c.neutPct.flag ? [c.neutPct.flag] : ['N'] },
      { code: 'LYMPH%', value: String(c.lymphPct.val), unit: '%', flags: c.lymphPct.flag ? [c.lymphPct.flag] : ['N'] },
    ];
  }

  const segments: string[] = [
    `MSH|^~\\&|SIM-HL7|${serial}|PREFRONTAL|LAB|${t}||ORU^R01|${ctrlId}|P|2.3.1`,
    isQc ? 'PID|1||||^QC_LEVEL_1' : `PID|1||||${job.patientName || 'Prem Kumar K'}^^^^||${job.patientSex || 'M'}`,
    `OBR|1||${sample}|CBC^Complete Blood Count^L|||${t}`,
  ];

  results.forEach((r, idx) => {
    segments.push(`OBX|${idx + 1}|NM|${r.code}^${r.code}^L||${r.value}|${r.unit}||${r.flags?.[0] || 'N'}|||F|||${t}`);
  });

  const hl7Body = segments.join('\r') + '\r';
  const rawText = wrapMllp(hl7Body);

  return {
    protocol: 'hl7',
    sampleId: sample,
    rawText,
    scenarioMeta: meta,
    message: {
      sampleId: sample,
      instrumentSerial: serial,
      runAt: d.toISOString(),
      results,
      qc: isQc,
      raw: rawText,
      protocol: 'hl7',
    },
    summary: `HL7: ${meta.label} (${results.length} parameters) for sample ${sample}`,
  };
}

// ── 4. Sinocare iCARE-2100 (POCT FHIR) Generator ───────────────────────────
export function generateSinocareSimulation(job: SimulationJob): GeneratedSimulation {
  const d = job.runAt || new Date();
  const sample = job.sampleId || '26354';
  const serial = job.analyzerSerial || 'SINO-ICARE-009';

  const meta = resolveSimulationScenario(job.scenario);
  const ex = HBA1C_EXAMPLES[meta.canonical] || HBA1C_EXAMPLES.example_1_normal;
  const hba1c = ex.val;

  const fhirPayload = {
    resourceType: 'Observation',
    id: `obs-${Date.now()}`,
    status: 'final',
    code: {
      coding: [{ system: 'http://loinc.org', code: '4548-4', display: 'Hemoglobin A1c' }],
      text: 'HbA1c',
    },
    subject: {
      extension: [{ url: 'position', valueString: '01' }],
      identifier: { value: sample },
      display: job.patientName || 'Prem Kumar K',
    },
    effectiveDateTime: d.toISOString(),
    valueQuantity: {
      value: hba1c,
      unit: '%',
      system: 'http://unitsofmeasure.org',
      code: '%',
    },
    interpretation: hba1c >= 6.5 ? [{ text: 'High' }] : hba1c < 4.5 ? [{ text: 'Low' }] : [{ text: 'Normal' }],
  };

  const jsonStr = JSON.stringify(fhirPayload);
  const rawText = `[SN-FRAME-START]${jsonStr}[SN-FRAME-END]`;

  return {
    protocol: 'sinocare-fhir',
    sampleId: sample,
    rawText,
    scenarioMeta: meta,
    message: {
      sampleId: sample,
      instrumentSerial: serial,
      runAt: d.toISOString(),
      results: [{ code: 'HbA1c', value: String(hba1c), unit: '%', flags: ex.flag ? [ex.flag] : [] }],
      qc: meta.canonical === 'qc',
      raw: rawText,
      protocol: 'sinocare-fhir',
    },
    summary: `Sinocare iCARE: ${meta.label} · HbA1c ${hba1c}% for sample ${sample}`,
  };
}

// ── 5. Text Template / Plain Ticket Generator ──────────────────────────────
export function generateTextSimulation(job: SimulationJob): GeneratedSimulation {
  const d = job.runAt || new Date();
  const sample = job.sampleId || '26354';
  const serial = job.analyzerSerial || 'TICKET-3P-01';

  const meta = resolveSimulationScenario(job.scenario);
  const c = CBC_EXAMPLES[meta.canonical] || CBC_EXAMPLES.example_1_normal;

  const lines = [
    '========================================',
    '       PREFRONTAL DIAGNOSTICS LAB       ',
    '        3-PART HEMATOLOGY COUNTER       ',
    '========================================',
    `DATE: ${d.toISOString().slice(0, 10)}  TIME: ${d.toTimeString().slice(0, 8)}`,
    `SAMPLE ID: ${sample}`,
    `PATIENT: ${job.patientName || 'PREM KUMAR K'}`,
    `PROFILE: ${meta.label.toUpperCase()}`,
    '----------------------------------------',
    'PARAM       RESULT   UNIT      FLAG',
    '----------------------------------------',
    `WBC         ${String(c.wbc.val).padStart(6)}   10^3/uL   ${c.wbc.flag || ''}`,
    `RBC         ${String(c.rbc.val).padStart(6)}   10^6/uL   ${c.rbc.flag || ''}`,
    `HGB         ${String(c.hgb.val).padStart(6)}   g/dL      ${c.hgb.flag || ''}`,
    `HCT         ${String(c.pcv.val).padStart(6)}   %         ${c.pcv.flag || ''}`,
    `PLT         ${String(c.plt.val).padStart(6)}   10^3/uL   ${c.plt.flag || ''}`,
    `LYM%        ${String(c.lymphPct.val).padStart(6)}   %         ${c.lymphPct.flag || ''}`,
    `GRAN%       ${String(c.neutPct.val).padStart(6)}   %         ${c.neutPct.flag || ''}`,
    '========================================',
    '\f', // Form feed terminator
  ];

  const rawText = lines.join('\r\n');

  const results: InstrumentResult[] = [
    { code: 'WBC', value: String(c.wbc.val), unit: '10^3/uL', flags: c.wbc.flag ? [c.wbc.flag] : [] },
    { code: 'RBC', value: String(c.rbc.val), unit: '10^6/uL', flags: c.rbc.flag ? [c.rbc.flag] : [] },
    { code: 'HGB', value: String(c.hgb.val), unit: 'g/dL', flags: c.hgb.flag ? [c.hgb.flag] : [] },
    { code: 'HCT', value: String(c.pcv.val), unit: '%', flags: c.pcv.flag ? [c.pcv.flag] : [] },
    { code: 'PLT', value: String(c.plt.val), unit: '10^3/uL', flags: c.plt.flag ? [c.plt.flag] : [] },
  ];

  return {
    protocol: 'text',
    sampleId: sample,
    rawText,
    scenarioMeta: meta,
    message: {
      sampleId: sample,
      instrumentSerial: serial,
      runAt: d.toISOString(),
      results,
      raw: rawText,
      protocol: 'text',
    },
    summary: `Ticket 3-Part: ${meta.label} for sample ${sample}`,
  };
}

// ── Master Dispatcher ──────────────────────────────────────────────────────
export function generateAnalyzerSimulation(job: SimulationJob): GeneratedSimulation {
  switch (job.protocol) {
    case 'lifedx-hbpro':
      return generateLifeDxHbProSimulation(job);
    case 'hl7':
      return generateHl7Simulation(job);
    case 'sinocare-fhir':
      return generateSinocareSimulation(job);
    case 'text':
      return generateTextSimulation(job);
    case 'astm':
    case 'auto':
    default:
      return generateAstmSimulation(job, job.tests?.includes('GLU') || false);
  }
}
