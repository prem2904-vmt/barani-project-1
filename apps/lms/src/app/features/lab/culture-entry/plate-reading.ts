import { AstRow, PlateMeasurement, PlateMeasureSession } from '../../../shared/models/culture.model';

/**
 * The PLATE READING — the AST plate measured BEFORE any organism exists
 * (SME flow): every disk the technician confirmed → its antibiotic (from the
 * lab's whole antibiotic master) → zone mm, plus the photo, the ring session
 * and the PF Sense audit id. Held at CASE level on the AST stage
 * (`plateJson` in the case's StagesJson), so it survives reloads. When the
 * organism is picked, the AST table is built from it: ONLY the antibiotics
 * that were on the plate, zones filled, S / I / R from that organism's
 * breakpoints.
 */
export interface PlateReadingDisk { n: number; code: string | null; drug: string; mm: number; }
export interface PlateReading {
  v: 1;
  measuredAt: string;
  imageUrl: string | null;
  auditId: string | null;
  session: PlateMeasureSession;
  /** Coded disks only, one per drug, in disk-number order. */
  disks: PlateReadingDisk[];
}

/** Build the reading from what the Measure modal applied. `antibiotics` is
 *  the list the modal indexed into (the antibiotic master). */
export function readingFromMeasure(
  e: { measurements: PlateMeasurement[]; imageUrl: string | null; session: PlateMeasureSession; auditId?: string | null },
  antibiotics: string[], now: Date = new Date(),
): PlateReading {
  const byDrug = new Map<string, PlateReadingDisk>();
  for (const m of e.measurements) {
    const drug = antibiotics[m.index];
    if (!drug || byDrug.has(drug)) continue;
    const z = e.session.zones.find(zz => zz.abName === drug);
    byDrug.set(drug, { n: z?.n ?? byDrug.size + 1, code: z?.code ?? null, drug, mm: m.zoneMm });
  }
  return {
    v: 1, measuredAt: now.toISOString(), imageUrl: e.imageUrl ?? null, auditId: e.auditId ?? null,
    session: e.session, disks: [...byDrug.values()].sort((a, b) => a.n - b.n),
  };
}

/** The AST rows a reading gives an organism: only the populated disks. */
export function plateRows(r: PlateReading | null | undefined): AstRow[] {
  return (r?.disks ?? []).map(d => ({ name: d.drug, zoneSize: d.mm, interpretation: '' as const }));
}

/** Parse the stored JSON (null on anything unexpected). */
export function parsePlate(json: string | null | undefined): PlateReading | null {
  if (!json) return null;
  try {
    const r = JSON.parse(json) as PlateReading;
    return r && Array.isArray(r.disks) && r.session ? r : null;
  } catch { return null; }
}

/** The AST stage's `plateJson` from a culture-case response (root, or the
 *  subculture branch `caseId`). */
export function plateJsonFromCase(caseView: unknown, caseId: string | null | undefined): string | null {
  const c = caseView as { id?: string; stages?: { key?: string; plateJson?: string | null }[]; subCultures?: unknown[] } | null;
  if (!c) return null;
  const branch = caseId
    ? (c.subCultures ?? []).find(s => (s as { id?: string }).id === caseId) as typeof c | undefined
    : c;
  return (branch?.stages ?? []).find(s => s.key === 'ast')?.plateJson ?? null;
}
