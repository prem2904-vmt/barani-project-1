/**
 * Vitals rules (Agent B) — PURE mirror of Services/Opd/Frontdesk/OpdVitalsRules.cs
 * (same bounds, same bands, same fixtures in vitals-rules.spec.ts and
 * FrontdeskRulesTests.cs). BMI is DERIVED from weight + height, never stored.
 */
import type { VitalFlag, VitalsInput } from '../frontdesk/desk.models';

export type VitalKey = 'bpSys' | 'bpDia' | 'pulse' | 'spo2' | 'tempF' | 'respRate' | 'weightKg' | 'heightCm' | 'grbs' | 'painScore';

export interface VitalFieldDef { key: VitalKey; label: string; unit: string; min: number; max: number; decimals: boolean; }

export const VITAL_FIELDS: VitalFieldDef[] = [
  { key: 'bpSys', label: 'BP systolic', unit: 'mmHg', min: 50, max: 300, decimals: false },
  { key: 'bpDia', label: 'BP diastolic', unit: 'mmHg', min: 20, max: 200, decimals: false },
  { key: 'pulse', label: 'Pulse', unit: '/min', min: 20, max: 250, decimals: false },
  { key: 'tempF', label: 'Temperature', unit: '°F', min: 90, max: 110, decimals: true },
  { key: 'spo2', label: 'SpO₂', unit: '%', min: 50, max: 100, decimals: false },
  { key: 'respRate', label: 'Respiratory rate', unit: '/min', min: 4, max: 80, decimals: false },
  { key: 'weightKg', label: 'Weight', unit: 'kg', min: 0.3, max: 400, decimals: true },
  { key: 'heightCm', label: 'Height', unit: 'cm', min: 20, max: 250, decimals: true },
  { key: 'grbs', label: 'GRBS', unit: 'mg/dL', min: 10, max: 1000, decimals: false },
  { key: 'painScore', label: 'Pain score', unit: '/10', min: 0, max: 10, decimals: false },
];

export function bmi(weightKg?: number | null, heightCm?: number | null): number | null {
  if (!weightKg || !heightCm || weightKg <= 0 || heightCm <= 0) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

export function bmiBand(v: number | null): string | null {
  if (v == null) return null;
  if (v < 18.5) return 'Underweight';
  if (v < 25) return 'Normal';
  if (v < 30) return 'Overweight';
  return 'Obese';
}

/** Field errors keyed by field (empty = valid). Mirrors OpdVitalsRules.Validate. */
export function validateVitals(v: VitalsInput): Partial<Record<VitalKey | 'form', string>> {
  const e: Partial<Record<VitalKey | 'form', string>> = {};
  for (const f of VITAL_FIELDS) {
    const x = v[f.key];
    if (x == null) continue;
    if (!Number.isFinite(x) || x < f.min || x > f.max) e[f.key] = `${f.label} must be ${f.min}–${f.max}.`;
  }
  if ((v.bpSys == null) !== (v.bpDia == null)) e[v.bpSys == null ? 'bpSys' : 'bpDia'] ??= 'Enter both BP numbers.';
  if (v.bpSys != null && v.bpDia != null && v.bpDia >= v.bpSys && !e.bpDia) e.bpDia = 'Diastolic must be lower than systolic.';
  const any = VITAL_FIELDS.some(f => v[f.key] != null) || !!v.note?.trim();
  if (!any) e.form = 'Enter at least one reading.';
  return e;
}

export function vitalFlags(v: VitalsInput): VitalFlag[] {
  const f: VitalFlag[] = [];
  if (v.bpSys != null && v.bpDia != null) {
    if (v.bpSys >= 140 || v.bpDia >= 90) f.push({ key: 'bp', level: 'high', label: 'BP high' });
    else if (v.bpSys < 90 || v.bpDia < 60) f.push({ key: 'bp', level: 'low', label: 'BP low' });
  }
  if (v.pulse != null) { if (v.pulse > 100) f.push({ key: 'pulse', level: 'high', label: 'Pulse high' }); else if (v.pulse < 50) f.push({ key: 'pulse', level: 'low', label: 'Pulse low' }); }
  if (v.spo2 != null && v.spo2 < 94) f.push({ key: 'spo2', level: 'low', label: 'SpO₂ low' });
  if (v.tempF != null) { if (v.tempF >= 100.4) f.push({ key: 'tempF', level: 'high', label: 'Fever' }); else if (v.tempF < 95) f.push({ key: 'tempF', level: 'low', label: 'Temperature low' }); }
  if (v.respRate != null) { if (v.respRate > 24) f.push({ key: 'respRate', level: 'high', label: 'Breathing fast' }); else if (v.respRate < 10) f.push({ key: 'respRate', level: 'low', label: 'Breathing slow' }); }
  if (v.grbs != null) { if (v.grbs >= 200) f.push({ key: 'grbs', level: 'high', label: 'Sugar high' }); else if (v.grbs < 70) f.push({ key: 'grbs', level: 'low', label: 'Sugar low' }); }
  return f;
}

/** Parses one typed reading: digits (+ one dot for decimal fields). Blank → null. */
export function parseReading(raw: string, decimals: boolean): number | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  const ok = decimals ? /^\d{1,4}(\.\d{0,2})?$/.test(t) : /^\d{1,4}$/.test(t);
  return ok ? parseFloat(t) : NaN;
}

/** "BP 128/82 · SpO₂ 98%" — the one-line summary rows show. */
export function vitalsSummary(v: VitalsInput | null | undefined): string | null {
  if (!v) return null;
  const bits: string[] = [];
  if (v.bpSys != null && v.bpDia != null) bits.push(`BP ${v.bpSys}/${v.bpDia}`);
  if (v.spo2 != null) bits.push(`SpO₂ ${v.spo2}%`);
  if (!bits.length && v.pulse != null) bits.push(`Pulse ${v.pulse}`);
  return bits.length ? bits.join(' · ') : null;
}
