/**
 * Pure helpers for how Collect presents OUTSOURCED tubes. An outsourced test
 * gets its own tube (never the in-house one), tagged "Outsourced · <partner>"
 * with the neutral chip. When a test's outsourcing changes AFTER its tube was
 * drawn, the backend never moves it silently — it lists the line as a needed
 * split, and the collector creates a separate tube (new label) for it.
 * Kept out of the component so the wording/parsing is unit-testable.
 */

/** A line whose destination changed after its tube was drawn
 *  (GET /api/samples/outsource-splits). */
export interface OutsourceSplit {
  orderId: string;
  orderNumber?: string | null;
  patientName?: string | null;
  sampleId: string;
  barcode?: string | null;
  sampleStatus: string;
  tubeColor?: string | null;
  orderTestId: string;
  testId: string;
  testName: string;
  /** Destination of the tube it sits in now (null = in-house). */
  fromVendorId?: string | null;
  /** Where Test Master now sends it (null = in-house). */
  toVendorId?: string | null;
}

export interface OutsourcedTubeLike {
  outsourcedVendorId?: string | null;
  metadata?: string | null;
}

/** Referral-lab id → display name. */
export type PartnerNames = Readonly<Record<string, string>>;

export function partnerName(id: string | null | undefined, names: PartnerNames): string | null {
  if (!id) return null;
  return names[id]?.trim() || null;
}

/** "Outsourced · Apollo" for an outsourced tube, null for an in-house one. */
export function outsourcedTag(s: OutsourcedTubeLike, names: PartnerNames): string | null {
  if (!s.outsourcedVendorId) return null;
  const n = partnerName(s.outsourcedVendorId, names);
  return n ? `Outsourced · ${n}` : 'Outsourced';
}

/** Barcode of the drawn tube this tube was split from (metadata.splitFrom),
 *  or null. Tolerant of missing / malformed metadata. */
export function splitFromOf(s: OutsourcedTubeLike): string | null {
  if (!s.metadata) return null;
  try {
    const m = JSON.parse(s.metadata) as { splitFrom?: unknown };
    return typeof m?.splitFrom === 'string' && m.splitFrom.trim() ? m.splitFrom.trim() : null;
  } catch {
    return null;
  }
}

/** The collector's instruction for a needed split. */
export function splitPrompt(x: OutsourceSplit, names: PartnerNames): string {
  const dest = x.toVendorId
    ? `outsourced · ${partnerName(x.toVendorId, names) ?? 'partner lab'}`
    : 'in-house';
  return `Draw/split a separate tube for ${x.testName} (${dest})`;
}

/** Needed splits grouped by order, in first-seen order. */
export function splitsByOrder(list: readonly OutsourceSplit[]): Map<string, OutsourceSplit[]> {
  const m = new Map<string, OutsourceSplit[]>();
  for (const x of list) {
    const arr = m.get(x.orderId);
    if (arr) arr.push(x); else m.set(x.orderId, [x]);
  }
  return m;
}
