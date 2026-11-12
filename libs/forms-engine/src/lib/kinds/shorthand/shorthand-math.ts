/**
 * The notation rules of the clinical shorthand presets: TS mirror of the server's `ShorthandMath`
 * (prefrontal-mw `Prefrontal/CaseSheets/Engine/Components/Shorthand/ShorthandMath.cs`). Both are held to the same
 * `docs/vectors/casesheet-pair.json`; a change here is a change there. Pure: no clock, no locale.
 *
 * Clinical notes (check with a clinician before changing a word):
 *  - Visual acuity: Snellen metric (6 m) lines, then CF / HM / PL / NPL; near vision in N (Jaeger) notation.
 *  - Refraction: "sph / cyl x axis"; a lone sphere reads "-2.00 DS", a lone cylinder "-0.50 DC x 20"; steps of 0.25 D.
 *  - Muscle power: Medical Research Council 0-5 scale with the commonly used + and - (no 0+/0-, no 5+).
 *  - Obstetric score: G (pregnancies), P (births), L (living children), A (abortions), D (deaths, optional).
 */

export type ShorthandPreset = 'obstetricScore' | 'menstrual' | 'visualAcuity' | 'refraction' | 'musclePower';

export const SHORTHAND_PRESETS: readonly ShorthandPreset[] = [
  'obstetricScore',
  'menstrual',
  'visualAcuity',
  'refraction',
  'musclePower',
];

/** Snellen distance lines, then counting fingers, hand movements, perception of light, no perception of light. */
export const VA_DISTANCE: readonly string[] = ['6/6', '6/9', '6/12', '6/18', '6/24', '6/36', '6/60', 'CF', 'HM', 'PL', 'NPL'];
/** Near vision, N notation. */
export const VA_NEAR: readonly string[] = ['N6', 'N8', 'N10', 'N12', 'N18', 'N24', 'N36'];

export type ShorthandValue = Record<string, unknown>;

const blank = (v: unknown): boolean => v === null || v === undefined;

/** A JSON number, or a numeric string (the server reads both), else null. */
export function shorthandNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

const str = (v: unknown): string => (blank(v) ? '' : String(v));
const whole = (n: number): string => String(n);
const signed = (n: number): string => (n > 0 ? '+' : '') + n.toFixed(2);

function asBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (['true', 'yes', '1'].includes(t)) return true;
    if (['false', 'no', '0'].includes(t)) return false;
  }
  return null;
}

/** 2026-10-20 → 20/10/2026 (the calendar date as written); anything else comes back as it is. */
export function isoDisplay(v: unknown): string {
  const s = str(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

/** The words a value writes for a preset ('' when there is nothing to say). `lmp` false leaves the last period out. */
export function writeShorthand(preset: string, o: ShorthandValue, lmp = true): string {
  switch (preset) {
    case 'obstetricScore': {
      const parts: string[] = [];
      for (const [key, letter] of [['g', 'G'], ['p', 'P'], ['l', 'L'], ['a', 'A'], ['d', 'D']] as const) {
        const n = shorthandNumber(o[key]);
        if (n !== null) parts.push(letter + whole(n));
      }
      return parts.join(' ');
    }
    case 'menstrual': {
      const flow = shorthandNumber(o['flowDays']);
      const cycle = shorthandNumber(o['cycleDays']);
      const parts: string[] = [];
      if (flow !== null && cycle !== null) parts.push(`${whole(flow)}/${whole(cycle)} days`);
      else if (cycle !== null) parts.push(`cycle ${whole(cycle)} days`);
      else if (flow !== null) parts.push(`flow ${whole(flow)} days`);
      const reg = str(o['regularity']);
      if (reg === 'regular' || reg === 'irregular') parts.push(reg);
      if (lmp && str(o['lmp']).trim() !== '') parts.push('LMP ' + isoDisplay(o['lmp']));
      return parts.join(', ');
    }
    case 'visualAcuity': {
      const dist = str(o['distance']);
      const ph = str(o['pinhole']);
      const near = str(o['near']);
      const first = dist !== '' ? dist + (ph !== '' ? ` (PH ${ph})` : '') : ph !== '' ? `PH ${ph}` : '';
      const parts = [first, near].filter((s) => s !== '');
      if (parts.length > 0 && asBool(o['glasses']) === true) parts.push('with glasses');
      return parts.join(', ');
    }
    case 'refraction': {
      const sph = shorthandNumber(o['sph']);
      const cyl = shorthandNumber(o['cyl']);
      const axis = shorthandNumber(o['axis']);
      const add = shorthandNumber(o['add']);
      const hasCyl = cyl !== null && cyl !== 0;
      const axisText = axis !== null ? ' x ' + whole(axis) : '';
      const sphere = (s: number) => (s === 0 ? 'plano' : signed(s));
      let text: string;
      if (sph !== null && hasCyl) text = `${sphere(sph)} / ${signed(cyl)}${axisText}`;
      else if (sph !== null) text = sph === 0 ? 'plano' : sphere(sph) + ' DS';
      else if (hasCyl) text = `${signed(cyl)} DC${axisText}`;
      else text = '';
      if (add !== null && add !== 0) text = (text === '' ? '' : text + ', ') + 'add ' + signed(add);
      return text;
    }
    case 'musclePower': {
      const g = shorthandNumber(o['grade']);
      if (g === null) return '';
      const s = str(o['sign']);
      return `${whole(g)}${s === '+' || s === '-' ? s : ''}/5`;
    }
    default:
      return '';
  }
}

/** Gentle checks that WARN and never block: 'p>g', 'a>g', 'p+a>g'. */
export function obstetricWarnings(o: ShorthandValue): string[] {
  const g = shorthandNumber(o['g']);
  const p = shorthandNumber(o['p']);
  const a = shorthandNumber(o['a']);
  const w: string[] = [];
  if (g !== null && p !== null && p > g) w.push('p>g');
  if (g !== null && a !== null && a > g) w.push('a>g');
  if (g !== null && p !== null && a !== null && p <= g && a <= g && p + a > g) w.push('p+a>g');
  return w;
}

/** Plain words for a warning code (what the doctor reads under the boxes). */
export const OBSTETRIC_WARNING_WORDS: Record<string, string> = {
  'p>g': 'More births (P) than pregnancies (G). Check the numbers.',
  'a>g': 'More abortions (A) than pregnancies (G). Check the numbers.',
  'p+a>g': 'Births (P) and abortions (A) together are more than pregnancies (G). Check the numbers.',
};

const isStep = (d: number, step: number): boolean => Math.abs(d / step - Math.round(d / step)) < 1e-9;

/** A problem with a stored value (null = fine): the server refuses these on save. */
export function shorthandProblem(preset: string, o: ShorthandValue): string | null {
  const int = (key: string, label: string, min: number, max: number): string | null => {
    const v = o[key];
    if (blank(v)) return null;
    const n = shorthandNumber(v);
    return n === null || n !== Math.floor(n) || n < min || n > max ? `${label} must be a whole number from ${min} to ${max}.` : null;
  };
  const step = (key: string, label: string, min: number, max: number): string | null => {
    const v = o[key];
    if (blank(v)) return null;
    const n = shorthandNumber(v);
    return n === null || n < min || n > max || !isStep(n, 0.25)
      ? `${label} must be from ${signed(min)} to ${signed(max)} in steps of 0.25.`
      : null;
  };
  const oneOf = (key: string, label: string, list: readonly string[]): string | null =>
    !blank(o[key]) && !list.includes(str(o[key])) ? `${label} must be one of ${list.join(', ')}.` : null;
  const first = (...xs: (string | null)[]) => xs.find((x) => x !== null) ?? null;

  switch (preset) {
    case 'obstetricScore':
      return first(int('g', 'G', 0, 30), int('p', 'P', 0, 30), int('l', 'L', 0, 30), int('a', 'A', 0, 30), int('d', 'D', 0, 30));
    case 'menstrual': {
      const iso = str(o['lmp']);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(Date.parse(iso + 'T00:00:00Z'));
      return first(
        int('flowDays', 'Flow days', 0, 30),
        int('cycleDays', 'Cycle days', 0, 365),
        oneOf('regularity', 'Regularity', ['regular', 'irregular']),
        iso !== '' && !date ? 'LMP must be a date.' : null,
      );
    }
    case 'visualAcuity':
      return first(oneOf('distance', 'Distance vision', VA_DISTANCE), oneOf('pinhole', 'Pinhole vision', VA_DISTANCE), oneOf('near', 'Near vision', VA_NEAR));
    case 'refraction':
      return first(step('sph', 'Sphere', -20, 20), step('cyl', 'Cylinder', -10, 10), int('axis', 'Axis', 0, 180), step('add', 'Add', 0, 4));
    case 'musclePower': {
      const grade = int('grade', 'Power', 0, 5);
      if (grade) return grade;
      const sign = str(o['sign']);
      const g = shorthandNumber(o['grade']);
      if (sign !== '' && sign !== '+' && sign !== '-') return 'The sign is + or -.';
      if (sign !== '' && (g === null || g === 0 || (g === 5 && sign === '+'))) return 'That power cannot carry that sign.';
      return null;
    }
    default:
      return null;
  }
}

/** Round to the nearest quarter (typed refraction values land on the 0.25 steps the server accepts). */
export function nearestQuarter(n: number): number {
  return Math.round(n * 4) / 4;
}

/** The preset a field uses (the server's default when none is set). */
export function presetOf(config: Record<string, unknown> | undefined): ShorthandPreset {
  const p = config?.['preset'];
  return typeof p === 'string' && (SHORTHAND_PRESETS as readonly string[]).includes(p) ? (p as ShorthandPreset) : 'obstetricScore';
}
