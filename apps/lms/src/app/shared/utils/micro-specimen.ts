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
