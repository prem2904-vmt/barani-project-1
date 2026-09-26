/**
 * Report CONDITIONS that read the result's flag — the vocabulary, the client
 * mirror of the engine's evaluation, and the "which line wins" analysis the
 * Test Master shows.
 *
 * Stored shape (the engine's own conditions JSON, nothing new around it):
 *   { if: { parameter: 'Hb', operator: 'flag', value: 'high_only' }, then: … }
 * mw `ReportLayoutEngineService` evaluates `operator: 'flag'` with
 * `ResultFlaggingService.LevelFor` (the FlagOne rule) + `FlagConditions.Matches`.
 *
 * Levels: Critical low < Low < Normal < High < Critical high. Critical is the
 * MORE SEVERE part of High / Low, so the choices say exactly which part they
 * mean: "High (not critical)", "Critical high", "High or critical high".
 * Legacy single-letter values are read as the STORED flag codes mean them
 * (mw stores a critical as C, never H): H = High (not critical), L = Low
 * (not critical), C = Critical (either side), N = Normal, A = Abnormal.
 *
 * Evaluation order (mw EvaluateConditions): within one block / row the lines
 * are checked top to bottom and the FIRST match wins; `else` is the fallback.
 * Separate blocks are independent — each prints on its own rule.
 *
 * Shared byte-identical by prefrontal-ui and prefrontal-admin-ui.
 */
import {
  FLAG_LEVELS, LEVEL_LABEL, atomsOf, bandLevel, effectiveCriticals, fmtNum,
  type FlagLevel, type InsightBand, type InsightParam, type IssueSeverity,
} from './range-insight';

export const FLAG_OPERATOR = 'flag';

export type FlagCond =
  | 'critical_low' | 'low_only' | 'low_any' | 'normal'
  | 'high_only' | 'high_any' | 'critical_high' | 'critical_any' | 'abnormal';

export interface FlagCondOption {
  value: FlagCond;
  /** Reads after "When the result …" / "Prints only when <param> …". */
  label: string;
  hint: string;
  levels: readonly FlagLevel[];
}

export const FLAG_CONDITIONS: readonly FlagCondOption[] = [
  { value: 'critical_high', label: 'is Critical high', hint: 'Above the critical high limit only.', levels: ['critical_high'] },
  { value: 'high_only', label: 'is High (not critical)', hint: 'Above normal but not past the critical limit.', levels: ['high'] },
  { value: 'high_any', label: 'is High or critical high', hint: 'Anything above normal — includes critical high.', levels: ['high', 'critical_high'] },
  { value: 'normal', label: 'is Normal', hint: 'Inside the normal range.', levels: ['normal'] },
  { value: 'low_any', label: 'is Low or critical low', hint: 'Anything below normal — includes critical low.', levels: ['low', 'critical_low'] },
  { value: 'low_only', label: 'is Low (not critical)', hint: 'Below normal but not past the critical limit.', levels: ['low'] },
  { value: 'critical_low', label: 'is Critical low', hint: 'Below the critical low limit only.', levels: ['critical_low'] },
  { value: 'critical_any', label: 'is Critical (high or low)', hint: 'Past either critical limit.', levels: ['critical_low', 'critical_high'] },
  { value: 'abnormal', label: 'is Abnormal (any flag)', hint: 'Anything that is not normal — low, high or critical.', levels: ['critical_low', 'low', 'high', 'critical_high'] },
];

const ALIASES: Record<string, FlagCond> = { H: 'high_only', L: 'low_only', C: 'critical_any', N: 'normal', A: 'abnormal' };

/** A stored flag-condition value → its canonical meaning (null = unknown). */
export function normalizeFlagCond(v: unknown): FlagCond | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const hit = FLAG_CONDITIONS.find(o => o.value === s.toLowerCase());
  if (hit) return hit.value;
  return ALIASES[s.toUpperCase()] ?? null;
}

/** Plain words for a stored value — legacy codes say what they mean. */
export function flagCondLabel(v: unknown): string {
  const c = normalizeFlagCond(v);
  if (!c) return `has an unknown flag “${String(v ?? '')}”`;
  const opt = FLAG_CONDITIONS.find(o => o.value === c)!;
  const raw = String(v ?? '').trim();
  return raw.length === 1 ? `${opt.label} — stored as flag ${raw.toUpperCase()}` : opt.label;
}

/** Does a result at `level` satisfy the condition? (qualitative results only
 *  ever match Normal / Abnormal.) */
export function flagCondMatches(cond: FlagCond | null, level: FlagLevel | 'abnormal' | null): boolean {
  if (!cond || !level) return false;
  if (level === 'abnormal') return cond === 'abnormal';
  return FLAG_CONDITIONS.find(o => o.value === cond)!.levels.includes(level);
}

// ── Engine mirror (mw EvaluateConditions / PredicateMatches / MatchLeaf) ──

export interface CondPredicate {
  parameter?: string | null;
  operator?: string | null;
  value?: unknown;
  and?: CondPredicate | null;
  or?: CondPredicate | null;
  has_images?: boolean | null;
}
export interface CondRule {
  if?: CondPredicate | null;
  else?: boolean | null;
  then?: Record<string, unknown> | null;
}

/** What the engine knows about one parameter when it evaluates a rule. */
export interface CondSubject { value: unknown; level: FlagLevel | 'abnormal' | null }
export type CondLookup = (parameter: string) => CondSubject | undefined;

function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const x = Number(v.trim());
    return Number.isFinite(x) ? x : null;
  }
  return null;
}

/** One leaf — numeric compare when both sides are numbers, else text =/!=. */
export function leafMatches(p: CondPredicate, lookup: CondLookup): boolean {
  const name = p.parameter;
  if (name == null) return true;
  const op = p.operator ?? '=';
  const subject = lookup(name);
  if (op === FLAG_OPERATOR) return flagCondMatches(normalizeFlagCond(p.value), subject?.level ?? null);
  const ln = asNumber(subject?.value), rn = asNumber(p.value);
  if (ln != null && rn != null) {
    switch (op) {
      case '<': return ln < rn;
      case '<=': return ln <= rn;
      case '>': return ln > rn;
      case '>=': return ln >= rn;
      case '=': case '==': return Math.abs(ln - rn) < 1e-9;
      case '!=': return Math.abs(ln - rn) >= 1e-9;
      default: return false;
    }
  }
  const ls = String(subject?.value ?? '').toLowerCase(), rs = String(p.value ?? '').toLowerCase();
  if (op === '=' || op === '==') return ls === rs;
  if (op === '!=') return ls !== rs;
  return false;
}

export function predicateMatches(p: CondPredicate, lookup: CondLookup): boolean {
  if (p.has_images != null) return true;
  let leaf = leafMatches(p, lookup);
  if (p.and) leaf = leaf && predicateMatches(p.and, lookup);
  if (p.or) leaf = leaf || predicateMatches(p.or, lookup);
  return leaf;
}

/** Which rule the engine applies: the first `if` that matches, else the
 *  `else` rule, else none. Returns its index in the array (null = none). */
export function evaluateRules(rules: readonly CondRule[] | null | undefined, lookup: CondLookup): number | null {
  if (!rules?.length) return null;
  let fallback: number | null = null;
  for (let k = 0; k < rules.length; k++) {
    const r = rules[k];
    if (!r?.then) continue;
    if (r.else === true) { fallback = k; continue; }
    if (r.if && predicateMatches(r.if, lookup)) return k;
  }
  return fallback;
}

// ── Analysis: reachability, overlap, never-produced flags ───────────────

/** One plain-words line: a numeric compare, "between", or a flag choice. */
export interface CondLine {
  operator: string;
  value?: unknown;
  value2?: unknown;
  /** "except when …": the line holds when the compare does NOT. */
  negate?: boolean;
}

export interface CondIssue {
  severity: IssueSeverity;
  /** 0-based line index. */
  line: number;
  message: string;
}

const OP_WORDS: Record<string, string> = {
  '>': 'is above', '<': 'is below', '>=': 'is at least', '<=': 'is at most',
  '=': 'equals', '==': 'equals', '!=': 'is not', between: 'is between',
};

/** "is above 11" / "is High (not critical)" / "is between 4 and 11". */
export function lineWords(l: CondLine): string {
  if (l.operator === FLAG_OPERATOR) return flagCondLabel(l.value);
  if (l.operator === 'between') return `is between ${String(l.value ?? '…')} and ${String(l.value2 ?? '…')}`;
  return `${OP_WORDS[l.operator] ?? l.operator} ${String(l.value ?? '…')}`;
}

function lineMatch(l: CondLine, v: number, level: FlagLevel | null): boolean {
  return l.negate ? !compareMatch(l, v, level) : compareMatch(l, v, level);
}

function compareMatch(l: CondLine, v: number, level: FlagLevel | null): boolean {
  if (l.operator === FLAG_OPERATOR) return flagCondMatches(normalizeFlagCond(l.value), level);
  if (l.operator === 'between') {
    const a = asNumber(l.value), b = asNumber(l.value2);
    return a != null && b != null && v >= a && v <= b;
  }
  return leafMatches({ parameter: 'x', operator: l.operator, value: l.value }, () => ({ value: v, level }));
}

/** A line that can't be evaluated at all (blocking). */
function lineError(l: CondLine): string | null {
  if (l.operator === FLAG_OPERATOR)
    return normalizeFlagCond(l.value) ? null : `Unknown flag condition “${String(l.value ?? '')}”.`;
  if (l.operator === 'between') {
    const a = asNumber(l.value), b = asNumber(l.value2);
    if (a == null || b == null) return 'Needs two numbers — from and to.';
    if (a > b) return `‘between ${fmtNum(a)} and ${fmtNum(b)}’ can never match — the first value must be the lower one.`;
    return null;
  }
  if (['>', '<', '>=', '<='].includes(l.operator) && asNumber(l.value) == null)
    return `‘${OP_WORDS[l.operator]}’ needs a number.`;
  return null;
}

/** The values each line compares against (so they become cut points). */
function lineThresholds(l: CondLine): number[] {
  if (l.operator === FLAG_OPERATOR) return [];
  return [asNumber(l.value), asNumber(l.value2)].filter((x): x is number => x != null);
}

interface Atom { band: number; v: number; level: FlagLevel | null }

function atomsFor(param: InsightParam, lines: readonly CondLine[]): Atom[] {
  const bands: Array<InsightBand | null> = param.referenceRanges?.length ? param.referenceRanges : [null];
  const extra = lines.flatMap(lineThresholds);
  const out: Atom[] = [];
  bands.forEach((b, bi) => {
    const crit = effectiveCriticals(b, param);
    const pts = [...new Set([crit.low, b?.min, b?.max, crit.high, ...extra]
      .filter((x): x is number => typeof x === 'number' && Number.isFinite(x)))].sort((x, y) => x - y);
    for (const a of atomsOf(pts)) out.push({ band: bi, v: a.v, level: bandLevel(b, a.v, param) });
  });
  return out;
}

function levelsWords(levels: ReadonlySet<FlagLevel | null>): string {
  const named = FLAG_LEVELS.filter(l => levels.has(l)).map(l => LEVEL_LABEL[l]);
  if (named.length === 0) return 'some results';
  if (named.length === 1) return `${named[0]} results`;
  return `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]} results`;
}

/**
 * Check a set of lines against the parameter's ranges.
 * `first-match` = one ladder (a row's description lines): the first matching
 * line wins, so later lines can be shadowed. `independent` = separate blocks,
 * each printing on its own rule: overlaps mean BOTH print.
 */
export function analyzeLines(
  lines: readonly CondLine[],
  param: InsightParam | null | undefined,
  mode: 'first-match' | 'independent',
): CondIssue[] {
  const out: CondIssue[] = [];
  const broken = lines.map(lineError);
  broken.forEach((m, i) => { if (m) out.push({ severity: 'error', line: i, message: m }); });
  if (!param) return out;
  const atoms = atomsFor(param, lines);
  const ok = lines.map((_, i) => !broken[i]);
  const hits = lines.map((l, i) => atoms.map(a => ok[i] && lineMatch(l, a.v, a.level)));
  const winner = atoms.map((_, k) => lines.findIndex((_, i) => hits[i][k]));

  lines.forEach((l, i) => {
    if (!ok[i]) return;
    if (!hits[i].some(Boolean)) {
      if (l.operator === FLAG_OPERATOR && !l.negate) {
        const c = FLAG_CONDITIONS.find(o => o.value === normalizeFlagCond(l.value))!;
        const words = c.levels.map(x => LEVEL_LABEL[x]).join(' or ');
        out.push({ severity: 'warning', line: i, message: `Never used — these ranges never produce ${words}.` });
      } else {
        out.push({ severity: 'warning', line: i, message: 'Never used — no result can match it.' });
      }
      return;
    }
    if (mode === 'first-match') {
      const wins = winner.some(w => w === i);
      if (!wins) {
        const by = [...new Set(atoms.map((_, k) => (hits[i][k] ? winner[k] : -1)).filter(w => w >= 0 && w < i))];
        out.push({
          severity: 'warning', line: i,
          message: `Never used — ${by.length === 1 ? `line ${by[0] + 1} already catches` : `lines ${by.map(b => b + 1).join(' and ')} already catch`} every such result. Move this line above ${by.length === 1 ? 'it' : 'them'}.`,
        });
        return;
      }
      for (let j = 0; j < i; j++) {
        if (!ok[j]) continue;
        const shared = atoms.filter((_, k) => hits[i][k] && hits[j][k] && winner[k] === j);
        if (shared.length === 0) continue;
        out.push({
          severity: 'warning', line: i,
          message: `Overlaps line ${j + 1} for ${levelsWords(new Set(shared.map(a => a.level)))} — line ${j + 1} wins there (first match).`,
        });
        break;
      }
    } else {
      for (let j = 0; j < i; j++) {
        if (!ok[j]) continue;
        const shared = atoms.filter((_, k) => hits[i][k] && hits[j][k]);
        if (shared.length === 0) continue;
        out.push({
          severity: 'warning', line: i,
          message: `Prints together with block ${j + 1} for ${levelsWords(new Set(shared.map(a => a.level)))}.`,
        });
        break;
      }
    }
  });
  return out;
}

/** The levels a line can ever match against these ranges (for the hint
 *  under a condition: "Prints for High and Critical high results"). */
export function lineReach(l: CondLine, param: InsightParam | null | undefined): Set<FlagLevel | null> {
  if (!param || lineError(l)) return new Set();
  return new Set(atomsFor(param, [l]).filter(a => lineMatch(l, a.v, a.level)).map(a => a.level));
}

export { levelsWords as reachWords };
