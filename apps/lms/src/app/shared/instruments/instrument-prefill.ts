/**
 * Analyzer → result-entry PREFILL, as pure logic (no Angular): which field
 * each analyzer value lands in, what may be written without ever touching a
 * value the technician typed, and what to show beside a field.
 *
 * Rules (instrument-contract v1; ENGINEERING-RULES §4 + §7.6):
 *  - A value is a PREFILL only: never submitted, never validated here.
 *  - It fills a field only when that field is EMPTY, or still holds exactly
 *    what the previous prefill put there (a run switch re-fills those).
 *  - A field the tech typed into is never overwritten.
 *  - Switching runs clears fields the old run filled (still untouched) that
 *    the new run does not carry.
 *  - Target = the order line (orderTestId) + parameterName; null
 *    parameterName = the line's first / only parameter.
 */
import type { MappedValue, RunDto } from './instrument.models';

/** One order line on screen and the parameters it can take a value in. */
export interface PrefillLine {
  orderTestId: string;
  params: ReadonlyArray<{ name: string; title?: string | null }>;
}

/** What the selected run says for one field. */
export interface AppliedValue {
  orderTestId: string;
  paramName: string;
  value: string;
  rawValue: string | null;
  unit: string | null;
  rawUnit: string | null;
  flags: string[];
  analyzerCode: string;
  instrumentName: string;
  /** runAt ?? receivedAt (ISO). */
  at: string | null;
  messageId: string;
  /** Instruments:LoincAutoMatch ingest fallback (no code-map row) rather
   *  than a real code map — the field-side hint stays subtle but says so. */
  autoMatched: boolean;
}
export type AppliedMap = Record<string, AppliedValue>;

export interface PrefillWrite { orderTestId: string; paramName: string; value: string }

export function prefillKey(orderTestId: string, paramName: string): string {
  return `${orderTestId}::${paramName}`;
}

/** A real entered value (mirrors submit-all `isFilled`). */
export function isFilledValue(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.some((x) => String(x ?? '').trim() !== '');
  return String(v).trim() !== '';
}

const same = (a: unknown, b: string) => String(a ?? '').trim() === String(b ?? '').trim();

/** The parameter a mapped value goes into on this line (null = no match). */
export function targetParam(v: Pick<MappedValue, 'parameterName'>, line: PrefillLine): string | null {
  if (!line.params.length) return null;
  const want = (v.parameterName ?? '').trim();
  if (!want) return line.params[0].name;
  const exact = line.params.find((p) => p.name === want);
  if (exact) return exact.name;
  const lc = want.toLowerCase();
  const loose = line.params.find((p) => p.name.toLowerCase() === lc || (p.title ?? '').trim().toLowerCase() === lc);
  return loose ? loose.name : null;
}

/** Every field the run would fill on these lines (last value wins per field). */
export function valuesForRun(run: RunDto | null | undefined, lines: readonly PrefillLine[]): AppliedMap {
  const out: AppliedMap = {};
  if (!run) return out;
  const byId = new Map(lines.map((l) => [l.orderTestId, l]));
  for (const v of run.values ?? []) {
    if (!v?.orderTestId) continue;
    const line = byId.get(v.orderTestId);
    if (!line) continue;
    const param = targetParam(v, line);
    if (!param) continue;
    const value = String(v.value ?? '').trim();
    if (!value) continue;
    out[prefillKey(v.orderTestId, param)] = {
      orderTestId: v.orderTestId, paramName: param, value,
      rawValue: v.rawValue ?? null, unit: v.unit ?? null, rawUnit: v.rawUnit ?? null,
      flags: (v.flags ?? []).filter((f) => !!f && String(f).trim() !== ''),
      analyzerCode: v.analyzerCode ?? '', instrumentName: run.instrumentName ?? 'Analyzer',
      at: run.runAt ?? run.receivedAt ?? null, messageId: run.messageId,
      autoMatched: !!v.autoMatched,
    };
  }
  return out;
}

export interface PrefillPlan {
  /** Field writes to apply ('' = clear a field the previous run filled). */
  writes: PrefillWrite[];
  /** The selected run's values (drives the badges). */
  applied: AppliedMap;
  /** Fields the run carries that the tech had typed — left alone. */
  kept: string[];
}

/**
 * The prefill plan for `run` given what is on screen now.
 * @param current   the field's current value (orderTestId, paramName) → value
 * @param previous  what the previously applied run put in (for run switching)
 */
export function planPrefill(args: {
  run: RunDto | null | undefined;
  lines: readonly PrefillLine[];
  current: (orderTestId: string, paramName: string) => unknown;
  previous?: AppliedMap | null;
}): PrefillPlan {
  const prev = args.previous ?? {};
  const next = valuesForRun(args.run, args.lines);
  const writes: PrefillWrite[] = [];
  const kept: string[] = [];
  const untouched = (key: string, cur: unknown) => !isFilledValue(cur) || (!!prev[key] && same(cur, prev[key].value));

  for (const [key, v] of Object.entries(next)) {
    const cur = args.current(v.orderTestId, v.paramName);
    if (same(cur, v.value)) continue;                 // already there
    if (untouched(key, cur)) writes.push({ orderTestId: v.orderTestId, paramName: v.paramName, value: v.value });
    else kept.push(key);
  }
  for (const [key, p] of Object.entries(prev)) {
    if (next[key]) continue;
    const cur = args.current(p.orderTestId, p.paramName);
    if (isFilledValue(cur) && same(cur, p.value)) writes.push({ orderTestId: p.orderTestId, paramName: p.paramName, value: '' });
  }
  return { writes, applied: next, kept };
}

/** The default run: newest first → the first one. */
export function defaultRun(runs: readonly RunDto[] | null | undefined): RunDto | null {
  return runs && runs.length ? runs[0] : null;
}

export interface AnalyzerBadge {
  /** 'from' = the field shows the analyzer's value; 'edited' = the tech's value differs. */
  kind: 'from' | 'edited';
  label: string;
  title: string;
  flags: string[];
  /** Prefilled by the Instruments:LoincAutoMatch ingest fallback (no code-map
   *  row yet) rather than a real code map — subtle hint, same badge shape. */
  autoMatched: boolean;
}

/**
 * The badge beside a field.
 * @param fmtTime ISO → "10:42 am" in the lab's IST day (caller's helper).
 */
export function analyzerBadge(
  applied: AppliedMap,
  orderTestId: string,
  paramName: string,
  currentValue: unknown,
  fmtTime: (iso: string | null) => string,
): AnalyzerBadge | null {
  const a = applied[prefillKey(orderTestId, paramName)];
  if (!a) return null;
  const when = fmtTime(a.at);
  const src = when ? `${a.instrumentName} · ${when}` : a.instrumentName;
  const raw = a.rawValue && a.rawValue !== a.value ? ` (sent ${a.rawValue}${a.rawUnit ? ' ' + a.rawUnit : ''})` : '';
  const autoNote = a.autoMatched ? ' — auto-matched by LOINC, confirm in Code mapping' : '';
  if (same(currentValue, a.value)) {
    return {
      kind: 'from', label: `From ${src}`, title: `${a.analyzerCode} from ${src}${raw} — check it before you submit${autoNote}`,
      flags: a.flags, autoMatched: a.autoMatched,
    };
  }
  if (!isFilledValue(currentValue)) return null;
  return {
    kind: 'edited', label: `Analyzer ${a.value}`,
    title: `${src} sent ${a.value}${a.unit ? ' ' + a.unit : ''}${raw} — the value here was typed${autoNote}`,
    flags: a.flags, autoMatched: a.autoMatched,
  };
}

/** Options for the "Run" picker: newest = "Run: latest". */
export function runOptions(runs: readonly RunDto[], fmtTime: (iso: string | null) => string): { value: string; label: string }[] {
  return runs.map((r, i) => {
    const when = fmtTime(r.runAt ?? r.receivedAt ?? null);
    const tail = [r.instrumentName, when].filter(Boolean).join(' · ');
    return { value: r.messageId, label: i === 0 ? `Run: latest${tail ? ' · ' + tail : ''}` : `Run: ${tail || r.messageId}` };
  });
}
