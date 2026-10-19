/**
 * Patient-facing test / value names (owner 2026-09-27).
 *
 * A calculated value (LDL, VLDL, Globulin, Indirect Bilirubin, Anion Gap…)
 * prints on the report exactly like any measured value: NO "Calculated"
 * marker on its name. The shipped catalogue named several of them
 * "LDL Cholesterol (Calculated)" — that suffix is dropped at print time so
 * every tenant's existing clone reads cleanly without a data migration
 * (tenant catalogues are never rewritten on deploy).
 *
 * A lab that wants to say a value is calculated picks "Calculated" as its
 * METHODOLOGY in Test Master; it then prints wherever methodology prints.
 * Internal screens (result entry's Auto / Calculated chip, Test Master) keep
 * the raw name — this is only for report output.
 */
const CALC_MARKER = /\s*[([]\s*(?:calculated|calc\.?)\s*[)\]]/gi;

/** "LDL Cholesterol (Calculated)" → "LDL Cholesterol". Leaves every other
 *  name untouched (Calcium, Procalcitonin…). Never returns '' for a
 *  non-empty name made only of the marker. */
export function reportDisplayName<T extends string | null | undefined>(name: T): T {
  if (!name) return name;
  const out = name.replace(CALC_MARKER, '').replace(/\s{2,}/g, ' ').trim();
  return (out || name) as T;
}
