/**
 * "Ask for the specimen" — which tests make the order desk pick WHICH
 * specimen was sent (urine vs pus vs CSF …).
 *
 * Bacterial Culture & Sensitivity always did (its `microFormat:
 * 'culture_sensitivity'` marker); the owner asked for EVERY microbiology test
 * to ask the same way (2026-09-27). The per-test switch is the Parameters
 * wrapper flag `askSpecimen: true` — the same home as `microFormat`,
 * `attachments` and `printPicker` — turned on for micro tests in the Test
 * Master. The chosen specimen is stored on the ordered test and printed on
 * the report (the server snapshot prefers it over the Test Master default).
 */

/** Wrapper key of the switch. */
export const ASK_SPECIMEN_KEY = 'askSpecimen';

type WithParameters = { parameters?: string | null; type?: string | null };

function wrapperOf(parameters: string | null | undefined): Record<string, unknown> | null {
  if (!parameters) return null;
  try {
    const w = JSON.parse(parameters);
    return w && typeof w === 'object' && !Array.isArray(w) ? w as Record<string, unknown> : null;
  } catch { return null; }
}

/** Does THIS test's own Test Master row ask for a specimen? Culture &
 *  Sensitivity always does; any other test when its switch is on. */
export function ownAsksSpecimen(parameters: string | null | undefined): boolean {
  const w = wrapperOf(parameters);
  if (!w) return false;
  return w[ASK_SPECIMEN_KEY] === true || w['microFormat'] === 'culture_sensitivity';
}

/**
 * Does ordering `t` ask for a specimen? An individual test: its own switch.
 * A bundle (profile / package): when any member it carries asks — one pick
 * then applies to every member ordered through it (the server keys the
 * choice by the bundle, exactly as it does for a culture ordered in a panel).
 * `memberById` resolves a member id to its catalogue row; members it can't
 * resolve don't ask.
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

/** Parameters JSON with the switch set (`on`) or removed — every other
 *  wrapper key is kept verbatim. Unreadable JSON starts from `{}`. */
export function withAskSpecimen(parameters: string | null | undefined, on: boolean): string {
  const w = wrapperOf(parameters) ?? {};
  if (on) w[ASK_SPECIMEN_KEY] = true;
  else delete w[ASK_SPECIMEN_KEY];
  return JSON.stringify(w);
}

// ── The CHOSEN specimen downstream (tubes, labels, result entry) ──────────

/** The desk's choice on one ordered line, trimmed; '' / missing → null. */
export function chosenSpecimen(t: { specimen?: string | null } | null | undefined): string | null {
  const v = (t?.specimen ?? '').trim();
  return v ? v : null;
}

/**
 * The specimen a TUBE holds: the first line's chosen specimen, else its
 * Test Master specimen. Tubes group by the chosen specimen server-side
 * (one sterile pot per chosen specimen), so every line in a pot agrees.
 */
export function tubeSpecimen(
  s: { tests?: Array<{ specimen?: string | null; test?: { sampleType?: string | null } | null }> | null } | null | undefined,
): string | null {
  const tests = s?.tests ?? [];
  for (const t of tests) { const c = chosenSpecimen(t); if (c) return c; }
  const own = (tests[0]?.test?.sampleType ?? '').trim();
  return own ? own : null;
}

/** Only the desk's CHOSEN specimen of a tube (no Test Master fallback) —
 *  what the printed label names. */
export function tubeChosenSpecimen(
  s: { tests?: Array<{ specimen?: string | null }> | null } | null | undefined,
): string | null {
  for (const t of s?.tests ?? []) { const c = chosenSpecimen(t); if (c) return c; }
  return null;
}

/**
 * The default to PRESELECT at the desk for one cart line (owner 2026-09-27:
 * "there is no default"): the test's single mapped default, else nothing.
 * A bundle preselects only when every asking member names the SAME single
 * default. `defaults` = test id → default name (null = none / several).
 */
export function deskDefaultSpecimen(
  t: { id: string; parameters?: string | null },
  defaults: Record<string, string | null | undefined>,
  memberById?: (id: string) => ({ id: string; parameters?: string | null } | undefined),
): string | null {
  if (ownAsksSpecimen(t.parameters)) return defaults[t.id] ?? null;
  const items = wrapperOf(t.parameters)?.['items'];
  if (!Array.isArray(items) || !memberById) return null;
  const picks = items
    .map(i => { const id = (i as { testId?: unknown })?.testId; return typeof id === 'string' ? memberById(id) : undefined; })
    .filter((m): m is { id: string; parameters?: string | null } => !!m && ownAsksSpecimen(m.parameters))
    .map(m => defaults[m.id] ?? null);
  if (picks.length === 0 || picks.some(p => !p)) return null;
  return picks.every(p => p === picks[0]) ? picks[0] : null;
}

/** The ids whose mapping the desk must read for `t`: itself when it asks,
 *  plus its asking members when it is a bundle. */
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
