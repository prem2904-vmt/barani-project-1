import { ageParts } from './patient-age';
/**
 * Calculated-result engine for profile result entry.
 *
 * A test's `calculation` (TestEntity.Calculation, document-verbatim from the
 * v1.1 master delivery) describes how its value derives from SIBLING results
 * in the same profile — VLDL-C = TG/5, MCHC = Hb×100/HCT, eGFR (CKD-EPI 2021).
 * The engine is a prefill assist: it proposes the computed value live as the
 * dependencies are typed; the tech can always override (analyzers often report
 * these directly), and an unsatisfied validity gate (Friedewald above TG 400,
 * CKD-EPI under 18) yields "not calculable", never a partial number.
 *
 * Inputs are addressed by test CODE ("BIO154") or CODE:Parameter name
 * ("HEM019:Neutrophils"); the host screen resolves refs to numbers via the
 * context callback. Named lab constants (ISI, MNPT, NORMAL_HCT) come from
 * tenant settings (TenantEntity.CalcConstants) with defaults here. AGE
 * (years) and SEX arrive from the patient record.
 */

export interface CalcDef {
  kind: string;
  expr?: string;
  inputs?: string[];
  constants?: string[];
  validWhen?: string;
  unit?: string;
  note?: string;
  params?: Record<string, unknown>;
}

/** Kinds the engine can actually compute — anything else in the formulas file
 *  is documentary (analyzer-derived, assay-specific, clinically excluded). */
const COMPUTABLE = new Set(['expr', 'inr', 'ckdepi2021_cr', 'ckdepi2021_cr_cys', 'rpi', 'r_value']);

/** Defaults for lab constants when the tenant hasn't configured them.
 *  ISI/MNPT are thromboplastin-reagent properties (INR); NORMAL_HCT anchors
 *  the reticulocyte production index. */
export const CALC_CONSTANT_DEFAULTS: Record<string, number> = {
  ISI: 1.0,
  MNPT: 12.0,
  NORMAL_HCT: 45,
};

export interface CalcContext {
  /** Resolve an input ref ("BIO154" or "CODE:Param") to its entered numeric
   *  value; null/undefined = not entered yet (or not numeric). */
  value(ref: string): number | null | undefined;
  /** Named lab constant; fall back to CALC_CONSTANT_DEFAULTS when absent. */
  constant?(name: string): number | null | undefined;
  /** Patient age in years (fractional ok). */
  age?: number | null;
  /** Patient sex — 'F'/'female' truthy female; anything else male for the
   *  sex-branched equations (they define only F/M parameter sets). */
  sex?: string | null;
  /** Upper limit of normal for a sibling test's resolved reference range —
   *  needed only by r_value. */
  uln?(code: string): number | null | undefined;
}

export interface CalcResult {
  /** The computed value, or null when not computable. */
  value: number | null;
  /** Refs that are still missing — drives the "waiting on X" affordance. */
  missing: string[];
  /** validWhen failed (or a special kind's own gate) — show "Not calculable",
   *  per the doc rule that a partial score must never be silently produced. */
  invalid: boolean;
}

export function parseCalc(raw: string | null | undefined): CalcDef | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as CalcDef;
    return d && typeof d.kind === 'string' && COMPUTABLE.has(d.kind) ? d : null;
  } catch {
    return null;
  }
}

/** Round to a sane reporting precision: 2 decimals, trailing zeros trimmed by
 *  the caller's formatter. Ratios keep 2; everything the docs show is ≤2. */
export function roundCalc(v: number): number {
  return Math.round(v * 100) / 100;
}

export function evaluateCalc(def: CalcDef, ctx: CalcContext): CalcResult {
  const missing: string[] = [];
  const lookup = (name: string): number | null => {
    // Identifier resolution order: patient vars, lab constants, input refs.
    if (name === 'AGE') {
      if (ctx.age == null) { missing.push('AGE'); return null; }
      return ctx.age;
    }
    if (def.constants?.includes(name)) {
      const c = ctx.constant?.(name) ?? CALC_CONSTANT_DEFAULTS[name];
      if (c == null) { missing.push(name); return null; }
      return c;
    }
    const v = ctx.value(name);
    if (v == null || !Number.isFinite(v)) { missing.push(name); return null; }
    return v;
  };

  // Validity gate first — an invalid state must win over a computed number.
  if (def.validWhen) {
    const gate = evalExpr(def.validWhen, lookup);
    if (missing.length > 0) return { value: null, missing: dedupe(missing), invalid: false };
    if (gate == null || gate === 0) return { value: null, missing: [], invalid: true };
  }

  let value: number | null = null;
  switch (def.kind) {
    case 'expr':
    case 'inr':
      value = def.expr ? evalExpr(def.expr, lookup) : null;
      break;
    case 'ckdepi2021_cr':
      value = ckdEpi2021Cr(def, ctx, missing);
      break;
    case 'ckdepi2021_cr_cys':
      value = ckdEpi2021CrCys(def, ctx, missing);
      break;
    case 'rpi':
      value = rpi(def, ctx, missing);
      break;
    case 'r_value':
      value = rValue(def, ctx, missing);
      break;
    default:
      return { value: null, missing: [], invalid: false };
  }

  if (missing.length > 0) return { value: null, missing: dedupe(missing), invalid: false };
  if (value == null || !Number.isFinite(value)) return { value: null, missing: [], invalid: true };
  return { value: roundCalc(value), missing: [], invalid: false };
}

function dedupe(a: string[]): string[] { return [...new Set(a)]; }

function isFemale(sex: string | null | undefined): boolean {
  const s = (sex ?? '').trim().toLowerCase();
  return s === 'f' || s === 'female';
}

/** CKD-EPI 2021 creatinine equation — constants document-verbatim (the doc
 *  spells out K/Alpha/SexFactor per sex; no race coefficient). */
function ckdEpi2021Cr(def: CalcDef, ctx: CalcContext, missing: string[]): number | null {
  const crRef = def.inputs?.[0];
  if (!crRef) return null;
  const scr = ctx.value(crRef);
  if (scr == null || !Number.isFinite(scr)) { missing.push(crRef); return null; }
  if (ctx.age == null) { missing.push('AGE'); return null; }
  const f = isFemale(ctx.sex);
  const K = f ? 0.7 : 0.9;
  const alpha = f ? -0.241 : -0.302;
  const sexFactor = f ? 1.012 : 1.0;
  return 142
    * Math.pow(Math.min(scr / K, 1), alpha)
    * Math.pow(Math.max(scr / K, 1), -1.2)
    * Math.pow(0.9938, ctx.age)
    * sexFactor;
}

/** CKD-EPI 2021 creatinine–cystatin C. The doc names the equation without
 *  reprinting its constants; these are the published 2021 combined-equation
 *  coefficients (NEJM 2021, race-free). */
function ckdEpi2021CrCys(def: CalcDef, ctx: CalcContext, missing: string[]): number | null {
  const crRef = def.inputs?.[0];
  const cysRef = def.inputs?.[1];
  if (!crRef || !cysRef) return null;
  const scr = ctx.value(crRef);
  const scys = ctx.value(cysRef);
  if (scr == null || !Number.isFinite(scr)) missing.push(crRef);
  if (scys == null || !Number.isFinite(scys)) missing.push(cysRef);
  if (ctx.age == null) missing.push('AGE');
  if (missing.length > 0) return null;
  const f = isFemale(ctx.sex);
  const K = f ? 0.7 : 0.9;
  const alpha = f ? -0.219 : -0.144;
  const sexFactor = f ? 0.963 : 1.0;
  return 135
    * Math.pow(Math.min(scr! / K, 1), alpha)
    * Math.pow(Math.max(scr! / K, 1), -0.544)
    * Math.pow(Math.min(scys! / 0.8, 1), -0.323)
    * Math.pow(Math.max(scys! / 0.8, 1), -0.778)
    * Math.pow(0.9961, ctx.age!)
    * sexFactor;
}

/** Reticulocyte production index: corrected RET% ÷ maturation factor, the
 *  factor stepped by patient HCT per the doc's band table (≤15% → the band's
 *  lower bound 2.5). inputs = [RET%, HCT, correctedRET (optional, recomputed)]. */
function rpi(def: CalcDef, ctx: CalcContext, missing: string[]): number | null {
  const retRef = def.inputs?.[0];
  const hctRef = def.inputs?.[1];
  if (!retRef || !hctRef) return null;
  const ret = ctx.value(retRef);
  const hct = ctx.value(hctRef);
  if (ret == null || !Number.isFinite(ret)) missing.push(retRef);
  if (hct == null || !Number.isFinite(hct)) missing.push(hctRef);
  const normal = ctx.constant?.('NORMAL_HCT') ?? CALC_CONSTANT_DEFAULTS['NORMAL_HCT'];
  if (missing.length > 0) return null;
  const corrected = ret! * hct! / normal;
  const factor = hct! >= 36 ? 1 : hct! >= 26 ? 1.5 : hct! >= 16 ? 2 : 2.5;
  return corrected / factor;
}

/** AASLD R-value: (ALT/ALT_ULN) ÷ (ALP/ALP_ULN), ULNs resolved dynamically
 *  from each test's reference configuration (doc: stays correct when the lab
 *  changes analyzer-specific limits). inputs = [ALT code, ALP code]. */
function rValue(def: CalcDef, ctx: CalcContext, missing: string[]): number | null {
  const altRef = def.inputs?.[0];
  const alpRef = def.inputs?.[1];
  if (!altRef || !alpRef) return null;
  const alt = ctx.value(altRef);
  const alp = ctx.value(alpRef);
  if (alt == null || !Number.isFinite(alt)) missing.push(altRef);
  if (alp == null || !Number.isFinite(alp)) missing.push(alpRef);
  const altUln = ctx.uln?.(altRef);
  const alpUln = ctx.uln?.(alpRef);
  if (altUln == null) missing.push(`${altRef} ULN`);
  if (alpUln == null) missing.push(`${alpRef} ULN`);
  if (missing.length > 0) return null;
  if (alpUln === 0 || alp === 0) return null;
  return (alt! / altUln!) / (alp! / alpUln!);
}

// ── Expression evaluator ────────────────────────────────────────────────
// Grammar (recursive descent, no eval()):
//   compare := sum (('<='|'>='|'<'|'>'|'=='|'!=') sum)?
//   sum     := term (('+'|'-') term)*
//   term    := unary (('*'|'/') unary)*
//   unary   := '-' unary | atom
//   atom    := number | ident | ident '(' compare (',' compare)* ')' | '(' compare ')'
// Identifiers: test codes (BIO154), CODE:Param handled upstream (refs with a
// colon never appear inside expr text — exprs use bare codes; the ctx maps
// them), constants (ISI), AGE. Functions: min, max, pow.
// Comparisons return 1/0 so validWhen shares the same grammar.

type Lookup = (name: string) => number | null;

export function evalExpr(src: string, lookup: Lookup): number | null {
  const toks = tokenize(src);
  if (!toks) return null;
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];

  function atom(): number | null {
    const t = next();
    if (t == null) return null;
    if (t.k === 'num') return t.v as number;
    if (t.k === '(') {
      const v = compare();
      if (peek()?.k !== ')') return null;
      next();
      return v;
    }
    if (t.k === '-') {
      const v = atom();
      return v == null ? null : -v;
    }
    if (t.k === 'id') {
      const name = t.v as string;
      if (peek()?.k === '(') {
        next();
        const args: number[] = [];
        if (peek()?.k !== ')') {
          for (;;) {
            const a = compare();
            if (a == null) return null;
            args.push(a);
            if (peek()?.k === ',') { next(); continue; }
            break;
          }
        }
        if (peek()?.k !== ')') return null;
        next();
        const fn = name.toLowerCase();
        if (fn === 'min' && args.length >= 2) return Math.min(...args);
        if (fn === 'max' && args.length >= 2) return Math.max(...args);
        if (fn === 'pow' && args.length === 2) return Math.pow(args[0], args[1]);
        return null;
      }
      return lookup(name);
    }
    return null;
  }

  function term(): number | null {
    let v = atom();
    while (v != null && (peek()?.k === '*' || peek()?.k === '/')) {
      const op = next()!.k;
      const r = atom();
      if (r == null) return null;
      if (op === '/') {
        if (r === 0) return null;
        v = v / r;
      } else v = v * r;
    }
    return v;
  }

  function sum(): number | null {
    let v = term();
    while (v != null && (peek()?.k === '+' || peek()?.k === '-')) {
      const op = next()!.k;
      const r = term();
      if (r == null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  function compare(): number | null {
    const l = sum();
    const t = peek();
    if (l == null || t == null) return l;
    if (t.k === '<=' || t.k === '>=' || t.k === '<' || t.k === '>' || t.k === '==' || t.k === '!=') {
      next();
      const r = sum();
      if (r == null) return null;
      switch (t.k) {
        case '<=': return l <= r ? 1 : 0;
        case '>=': return l >= r ? 1 : 0;
        case '<': return l < r ? 1 : 0;
        case '>': return l > r ? 1 : 0;
        case '==': return l === r ? 1 : 0;
        default: return l !== r ? 1 : 0;
      }
    }
    return l;
  }

  const out = compare();
  return i === toks.length ? out : null;
}

interface Tok { k: string; v?: number | string }

function tokenize(src: string): Tok[] | null {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const n = Number(src.slice(i, j));
      if (!Number.isFinite(n)) return null;
      toks.push({ k: 'num', v: n });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      // Identifiers may carry a :Param suffix (spaces allowed inside the
      // param name up to the next operator) — "HEM019:Neutrophils %".
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      if (src[j] === ':') {
        j++;
        while (j < src.length && !/[+\-*/(),<>=!]/.test(src[j])) j++;
        toks.push({ k: 'id', v: src.slice(i, j).trim() });
      } else {
        toks.push({ k: 'id', v: src.slice(i, j) });
      }
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '==' || two === '!=') {
      toks.push({ k: two });
      i += 2;
      continue;
    }
    if ('+-*/(),<>'.includes(c)) {
      toks.push({ k: c });
      i++;
      continue;
    }
    return null;
  }
  return toks;
}

/** Static check for an admin-authored expression: does it parse, and which
 *  identifiers does it reference? Powers the formula composer's live
 *  validation — unknown refs are the composer's job to flag (it knows the
 *  sibling codes), grammar errors are ours. The dry-run assigns a distinct
 *  prime to each identifier so legitimate formulas can't false-negative on
 *  a coincidental division by zero (e.g. `A / (B - C)` with all-equal
 *  stand-in values). */
export function lintExpr(src: string): { ok: boolean; refs: string[] } {
  const toks = tokenize(src);
  if (!toks) return { ok: false, refs: [] };
  const FNS = new Set(['min', 'max', 'pow']);
  const refs: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.k !== 'id') continue;
    const name = String(t.v);
    if (FNS.has(name.toLowerCase()) && toks[i + 1]?.k === '(') continue;
    if (!refs.includes(name)) refs.push(name);
  }
  const primes = [3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53];
  const stand = new Map(refs.map((r, i) => [r, primes[i % primes.length]]));
  const ok = evalExpr(src, (n) => stand.get(n) ?? null) != null;
  return { ok, refs };
}

/** Fractional years from a date of birth (days / 365.25, calendar dates) —
 *  delegates to the ONE patient-age helper. Null when absent/invalid. */
export function ageYearsFromDob(dob: string | null | undefined, now: Date = new Date()): number | null {
  return ageParts(dob, now)?.fractionalYears ?? null;
}
