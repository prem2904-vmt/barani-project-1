/**
 * The specimen of an ordered test — the TS twin of the server's
 * `SpecimenRules` (owner 2026-09-29: "nothing hard-coded, the Test Master
 * decides").
 *
 * ONE setting per test, the Parameters-wrapper key `specimenMode`:
 *   - `fixed`  — exactly one allowed specimen; no picker anywhere, the
 *                server stamps it on order creation (Blood Culture → Blood);
 *   - `choose` — the desk picks from the test's ALLOWED specimens (+ an
 *                optional default); the server rejects anything off the list;
 *   - `none`   — no specimen.
 * Rows never migrated resolve the LEGACY flags: `askSpecimen: true` or
 * Culture & Sensitivity (`microFormat: 'culture_sensitivity'`) = choose.
 *
 * The chosen specimen is stored on the ordered test as a master CODE + name,
 * sets its tube (the allowed row's container) and may carry its own price.
 * The admin console keeps a byte-identical copy of this file.
 */

export type SpecimenMode = 'fixed' | 'choose' | 'none';

/** Wrapper key of the one setting. */
export const SPECIMEN_MODE_KEY = 'specimenMode';
/** The LEGACY wrapper flag (read only, never written). */
export const ASK_SPECIMEN_KEY = 'askSpecimen';

export const SPECIMEN_MODE_OPTIONS: ReadonlyArray<{ value: SpecimenMode; label: string; hint: string }> = [
  { value: 'choose', label: 'Choose from list', hint: 'The desk picks one of the allowed specimens' },
  { value: 'fixed', label: 'Fixed', hint: 'Always the one allowed specimen — no picker' },
  { value: 'none', label: 'Not needed', hint: 'No specimen on the order' },
];

type WithParameters = { parameters?: string | null; type?: string | null };

/** One allowed specimen of a test as `GET /api/microbiology/test-specimens` serves it. */
export interface AllowedSpecimen {
  code: string;
  name: string;
  isDefault: boolean;
  /** Container KEY (tube-colors.ts) when the row names one; free text otherwise. */
  container?: string | null;
  volumeMl?: number | null;
  transport?: string | null;
  instruction?: string | null;
  rejectIf?: string | null;
  /** This specimen's own price at the asked scope; null / absent = the base price. */
  price?: number | null;
}

/** One test's allowed specimens (`GET /api/microbiology/test-specimens?testIds=`). */
export interface TestSpecimenMap {
  testId: string;
  specimens: AllowedSpecimen[];
  /** NAME of the single default (null = none / several). */
  defaultSpecimen?: string | null;
  inherited?: boolean;
  mode?: SpecimenMode | string | null;
  /** Mode fixed: the stamped specimen's CODE. */
  fixedSpecimen?: string | null;
  basePrice?: number | null;
}

function wrapperOf(parameters: string | null | undefined): Record<string, unknown> | null {
  if (!parameters) return null;
  try {
    const w = JSON.parse(parameters);
    return w && typeof w === 'object' && !Array.isArray(w) ? w as Record<string, unknown> : null;
  } catch { return null; }
}

/** Parse a mode string ('fixed' | 'choose' | 'none', any case); null otherwise. */
export function parseSpecimenMode(s: unknown): SpecimenMode | null {
  const v = typeof s === 'string' ? s.trim().toLowerCase() : '';
  return v === 'fixed' || v === 'choose' || v === 'none' ? v : null;
}

/** The test's specimen mode: the explicit setting, else the legacy flags. */
export function specimenModeOf(parameters: string | null | undefined): SpecimenMode {
  const w = wrapperOf(parameters);
  if (!w) return 'none';
  const explicit = parseSpecimenMode(w[SPECIMEN_MODE_KEY]);
  if (explicit) return explicit;
  return w[ASK_SPECIMEN_KEY] === true || w['microFormat'] === 'culture_sensitivity' ? 'choose' : 'none';
}

/** Does THIS test's own row make the DESK pick its specimen? (= choose) */
export function ownAsksSpecimen(parameters: string | null | undefined): boolean {
  return specimenModeOf(parameters) === 'choose';
}

/** Does the ordered line carry a specimen at all (fixed or choose)? */
export function hasSpecimen(parameters: string | null | undefined): boolean {
  return specimenModeOf(parameters) !== 'none';
}

/**
 * Does ordering `t` ask the desk for a specimen? An individual test: its own
 * mode is choose. A bundle (profile / package): when any member it carries
 * chooses — one pick then applies to every choosing member ordered through
 * it (the server keys the choice by the bundle). `memberById` resolves a
 * member id to its catalogue row; members it can't resolve don't ask.
 */
export function asksSpecimen(t: WithParameters, memberById?: (id: string) => WithParameters | undefined): boolean {
  if (ownAsksSpecimen(t.parameters)) return true;
  if (!memberById) return false;
  const items = wrapperOf(t.parameters)?.['items'];
  if (!Array.isArray(items)) return false;
  return items.some(i => {
    const id = (i as { testId?: unknown })?.testId;
    const m = typeof id === 'string' ? memberById(id) : undefined;
    return !!m && ownAsksSpecimen(m.parameters);
  });
}

/** Parameters JSON with the mode set — the legacy `askSpecimen` flag is
 *  dropped (one setting); every other wrapper key is kept verbatim.
 *  Unreadable JSON starts from `{}`. */
export function withSpecimenMode(parameters: string | null | undefined, mode: SpecimenMode): string {
  const w = wrapperOf(parameters) ?? {};
  w[SPECIMEN_MODE_KEY] = mode;
  delete w[ASK_SPECIMEN_KEY];
  return JSON.stringify(w);
}

// ── The CHOSEN specimen downstream (tubes, labels, result entry) ──────────

/** The line's specimen NAME, trimmed; '' / missing → null. */
export function chosenSpecimen(t: { specimen?: string | null } | null | undefined): string | null {
  const v = (t?.specimen ?? '').trim();
  return v ? v : null;
}

/**
 * The specimen a TUBE holds: the first line's specimen, else its Test
 * Master specimen. Tubes group by the line's specimen server-side (one
 * sterile pot per specimen), so every line in a pot agrees.
 */
export function tubeSpecimen(
  s: { tests?: Array<{ specimen?: string | null; test?: { sampleType?: string | null } | null }> | null } | null | undefined,
): string | null {
  const tests = s?.tests ?? [];
  for (const t of tests) { const c = chosenSpecimen(t); if (c) return c; }
  const own = (tests[0]?.test?.sampleType ?? '').trim();
  return own ? own : null;
}

/** Only the line's own specimen of a tube (no Test Master fallback) —
 *  what the printed label names. */
export function tubeChosenSpecimen(
  s: { tests?: Array<{ specimen?: string | null }> | null } | null | undefined,
): string | null {
  for (const t of s?.tests ?? []) { const c = chosenSpecimen(t); if (c) return c; }
  return null;
}

// ── The desk: allowed lists, defaults, prices ────────────────────────────

/** The ids whose allowed list the desk must read for `t`: itself when it
 *  chooses, plus its choosing members when it is a bundle. */
export function specimenLookupIds(
  t: { id: string; parameters?: string | null },
  memberById?: (id: string) => ({ id: string; parameters?: string | null } | undefined),
): string[] {
  if (ownAsksSpecimen(t.parameters)) return [t.id];
  const items = wrapperOf(t.parameters)?.['items'];
  if (!Array.isArray(items) || !memberById) return [];
  return items
    .map(i => { const id = (i as { testId?: unknown })?.testId; return typeof id === 'string' ? memberById(id) : undefined; })
    .filter((m): m is { id: string; parameters?: string | null } => !!m && ownAsksSpecimen(m.parameters))
    .map(m => m.id);
}

/**
 * The specimens the desk may pick for one cart line: the test's allowed
 * list; for a bundle the specimens EVERY choosing member allows (one pick
 * applies to all of them). An empty allowed list means the whole Specimen
 * master (the server validates against it the same way). `maps` = test id →
 * its map (a missing map = not loaded yet → nothing to offer).
 */
export function allowedSpecimensFor(
  t: { id: string; parameters?: string | null },
  maps: Record<string, TestSpecimenMap | undefined>,
  master: AllowedSpecimen[],
  memberById?: (id: string) => ({ id: string; parameters?: string | null } | undefined),
): AllowedSpecimen[] {
  const ids = specimenLookupIds(t, memberById);
  if (ids.length === 0) return [];
  const lists = ids.map(id => maps[id]).map(m => (m ? (m.specimens.length ? m.specimens : master) : null));
  if (lists.some(l => l === null)) return [];
  let out = lists[0] as AllowedSpecimen[];
  for (const l of lists.slice(1) as AllowedSpecimen[][]) {
    const codes = new Set(l.map(s => s.code.toUpperCase()));
    out = out.filter(s => codes.has(s.code.toUpperCase()));
  }
  return out;
}

/**
 * The CODE to preselect for one cart line (owner 2026-09-27: "there is no
 * default"): the test's single default; a bundle preselects only when every
 * choosing member names the SAME single default. Null = start empty.
 */
export function deskDefaultCode(
  t: { id: string; parameters?: string | null },
  maps: Record<string, TestSpecimenMap | undefined>,
  memberById?: (id: string) => ({ id: string; parameters?: string | null } | undefined),
): string | null {
  const ids = specimenLookupIds(t, memberById);
  if (ids.length === 0) return null;
  const picks = ids.map(id => {
    const m = maps[id];
    if (!m) return undefined;                                  // still loading
    const d = m.specimens.filter(s => s.isDefault);
    return d.length === 1 ? d[0].code.toUpperCase() : null;
  });
  if (picks.some(p => p === undefined || p === null)) return null;
  return picks.every(p => p === picks[0]) ? (picks[0] as string) : null;
}

/** The allowed row a stored value names (code first, then name; any case). */
export function findAllowed(rows: AllowedSpecimen[], codeOrName: string | null | undefined): AllowedSpecimen | null {
  const v = (codeOrName ?? '').trim().toLowerCase();
  if (!v) return null;
  return rows.find(r => r.code.toLowerCase() === v) ?? rows.find(r => r.name.toLowerCase() === v) ?? null;
}

/** Mode fixed: the one specimen the server stamps (the single default, else
 *  the only row); null when the mapping cannot name exactly one. */
export function fixedSpecimenOf(m: TestSpecimenMap | null | undefined): AllowedSpecimen | null {
  const rows = m?.specimens ?? [];
  const d = rows.filter(r => r.isDefault);
  if (d.length === 1) return d[0];
  return rows.length === 1 ? rows[0] : null;
}

/** The price a cart line bills at: the chosen specimen's own price when it
 *  has one, else the test's price. */
export function specimenLinePrice(basePrice: number, chosen: AllowedSpecimen | null | undefined): number {
  const p = chosen?.price;
  return p != null && Number.isFinite(Number(p)) ? Number(p) : basePrice;
}

/** The message the culture bench shows when the server blocks a change by price. */
export const PRICE_DIFFERS_MESSAGE = 'Price differs: ask the front desk to modify the order';
