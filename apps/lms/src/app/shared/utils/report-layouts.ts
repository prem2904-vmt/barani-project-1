/**
 * Resolve the layouts a report needs — including the PROFILE layouts that are
 * easy to forget.
 *
 * Notes belong to whatever was ORDERED: order a profile and the profile's notes
 * print, not its members'. But a profile is not a row in the snapshot — only
 * its members are, each carrying `packageTestId`. So resolving one layout per
 * `testId` silently omits every profile, and the renderer, finding nothing at
 * `resolvedLayouts[profileId]`, suppresses the member notes (correctly) and
 * then has no profile notes to print in their place. The interpretation
 * section just disappears — no error, no empty state.
 *
 * Report Queue got this right and the other screens didn't, so the same report
 * printed its notes from one screen and not from another. This is the one
 * implementation; call it instead of looping `tests` by hand.
 */
export interface LayoutSnapshotTest {
  testId?: string;
  packageTestId?: string | null;
  /** Nearest enclosing profile (package members) — its layout carries the
   *  notes the report prints for that group. */
  profileTestId?: string | null;
  result?: { values?: Record<string, unknown> } | null;
  /** show=true image urls from the snapshot — resolve the layout with them
   *  so `has_images` predicates + image sections light up. */
  images?: string[] | null;
}

/** The subset of ReportLayoutService this needs — passed in so the helper stays
 *  free of Angular DI and is trivially testable. */
export type PreviewFn = (
  testId: string,
  values: Record<string, unknown>,
  conditions: unknown[],
  patient?: { sex?: string | null; age?: number | null },
) => Promise<unknown>;

/** Snapshot values are the flagged wrapper { value, unit, range, flag };
 *  conditions compare against the SCALAR inside. Unwrap before posting so
 *  "When the result is above 70" can actually match. */
function scalarValues(vals: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(vals)) {
    out[k] = v !== null && typeof v === 'object' && 'value' in (v as Record<string, unknown>)
      ? (v as Record<string, unknown>)['value'] : v;
  }
  return out;
}

/** A failure that depends on WHO is asking (no permission, signed out) or on
 *  the network — not on the test. Rendering past one of these prints a report
 *  that looks different for this viewer than for the next one, so the caller
 *  must stop and show an error instead. A 404 (test deleted) or a broken
 *  layout is the same for everybody and keeps the plain-table fallback. */
export function isAccessFailure(e: unknown): boolean {
  const err = e as { status?: number; code?: string; message?: string; name?: string } | null;
  if (!err) return false;
  if (err.status === 0 || err.status === 401 || err.status === 403) return true;
  if (err.code === 'forbidden' || err.code === 'unauthorized') return true;
  if (err.name === 'TimeoutError') return true;
  const msg = err.message ?? '';
  return /timed out|: 0 Unknown Error/i.test(msg);
}

export async function resolveReportLayouts<T>(
  preview: PreviewFn,
  tests: readonly LayoutSnapshotTest[],
  patient?: { sex?: string | null; age?: number | null },
): Promise<Record<string, T>> {
  const layouts: Record<string, T> = {};

  // Each test's own layout. A failure here is not fatal — that test falls back
  // to the plain table, which is the pre-layout behaviour.
  await Promise.all(
    tests.map(async t => {
      if (!t.testId) return;
      try {
        layouts[t.testId] = await preview(
          t.testId, scalarValues(t.result?.values ?? {}), t.images ?? [], patient,
        ) as T;
      } catch (e) {
        // Permission / network → abort the whole render (see isAccessFailure).
        if (isAccessFailure(e)) throw e;
        /* no layout for this test — plain table */
      }
    }),
  );

  // Then every DISTINCT profile the members came through. Values are empty:
  // a profile has no results of its own, only the notes that qualify its
  // members' results.
  const profileIds = [...new Set(
    tests.flatMap(t => [t.packageTestId, t.profileTestId])
      .filter((id): id is string => !!id),
  )];
  await Promise.all(
    profileIds.map(async id => {
      if (layouts[id]) return;               // already resolved as a test
      try {
        layouts[id] = await preview(id, {}, [], patient) as T;
      } catch (e) {
        if (isAccessFailure(e)) throw e;
        /* profile without notes — nothing extra prints */
      }
    }),
  );

  return layouts;
}
