/**
 * Outsourcing choice at billing (owner 2026-10-25): for a line the Test
 * Master marks as outsourced, the desk may keep the Test Master's partner,
 * send it to another active partner, or keep it in-house. Only outsourced
 * lines ever get the choice.
 *
 * Wire: the order create / modify request carries
 *   `outsourcing: { "<testId as ordered>": "<partnerId>" | "inhouse" }`
 * (keyed like `specimens`: the leaf, or the bundle it was ordered as). The
 * server accepts it ONLY for outsourced tests (or bundle members) and an
 * active partner of the tenant; each order line answers with
 * `outsourcingOverride` and `effectivePartnerId` (null = in-house).
 *
 * In the cart the pick is a string: '' = the Test Master default (nothing
 * sent), 'inhouse', or a partner id.
 */

export const IN_HOUSE = 'inhouse';

export interface OutsourcingTestRow {
  id: string;
  type?: string | null;
  parameters?: string | null;
  outsourcedVendorId?: string | null;
}

export interface PartnerRow {
  id: string;
  name: string;
  isActive?: boolean | null;
}

export interface OutsourcingOption { value: string; label: string; hint?: string; }

function memberIds(t: OutsourcingTestRow): string[] {
  if (!t.parameters) return [];
  try {
    const parsed = JSON.parse(t.parameters) as { items?: Array<{ testId?: string } | string> };
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    return items
      .map(it => (typeof it === 'string' ? it : it?.testId ?? '').trim())
      .filter(id => id.length > 0);
  } catch {
    return [];
  }
}

/** The Test Master partner(s) of one cart line: the test's own partner, or —
 *  for a profile / package without one — every distinct partner its members
 *  (recursively, cycle-safe) are outsourced to. [] = an in-house line. */
export function lineDefaultPartners(
  t: OutsourcingTestRow | null | undefined,
  byId: (id: string) => OutsourcingTestRow | undefined,
): string[] {
  if (!t) return [];
  if (t.outsourcedVendorId) return [t.outsourcedVendorId];
  const out: string[] = [];
  const seen = new Set<string>([t.id]);
  const walk = (row: OutsourcingTestRow) => {
    for (const id of memberIds(row)) {
      if (seen.has(id)) continue;
      seen.add(id);
      const m = byId(id);
      if (!m) continue;
      if (m.outsourcedVendorId) {
        if (!out.includes(m.outsourcedVendorId)) out.push(m.outsourcedVendorId);
      } else if (m.type === 'profile' || m.type === 'package') {
        walk(m);
      }
    }
  };
  walk(t);
  return out;
}

export function isOutsourcedLine(
  t: OutsourcingTestRow | null | undefined,
  byId: (id: string) => OutsourcingTestRow | undefined,
): boolean {
  return lineDefaultPartners(t, byId).length > 0;
}

function partnerName(id: string, partners: readonly PartnerRow[]): string {
  return partners.find(p => p.id === id)?.name ?? 'Partner lab';
}

/** "<Partner> (default)" / "In-house" / every other ACTIVE partner. */
export function outsourcingOptions(defaults: readonly string[], partners: readonly PartnerRow[]): OutsourcingOption[] {
  const def = defaults.length === 1
    ? `${partnerName(defaults[0], partners)} (default)`
    : 'Test Master partners (default)';
  const opts: OutsourcingOption[] = [
    { value: '', label: def, hint: defaults.length > 1 ? defaults.map(id => partnerName(id, partners)).join(', ') : undefined },
    { value: IN_HOUSE, label: 'In-house', hint: 'Run in our lab' },
  ];
  for (const p of partners) {
    if (p.isActive === false) continue;
    if (defaults.length === 1 && p.id === defaults[0]) continue;
    opts.push({ value: p.id, label: p.name });
  }
  return opts;
}

/** Where the line will go, in plain words: "Outsourced · Thyrocare" / "In-house". */
export function effectiveDestinationLabel(
  pick: string | null | undefined,
  defaults: readonly string[],
  partners: readonly PartnerRow[],
): string {
  const v = (pick ?? '').trim();
  if (v === IN_HOUSE) return 'In-house';
  if (v) return `Outsourced · ${partnerName(v, partners)}`;
  if (defaults.length === 0) return 'In-house';
  return `Outsourced · ${defaults.map(id => partnerName(id, partners)).join(', ')}`;
}

/** The request map: only real overrides, only for lines still in the cart
 *  that ARE outsourced. Null when there is nothing to send (the key is then
 *  left out of the request — an older server never sees it). */
export function outsourcingPayload(
  picks: Readonly<Record<string, string>>,
  selected: readonly string[],
  isOutsourced: (id: string) => boolean,
): Record<string, string> | null {
  const sel = new Set(selected);
  const out: Record<string, string> = {};
  for (const [id, v] of Object.entries(picks)) {
    if (!v || !sel.has(id) || !isOutsourced(id)) continue;
    out[id] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** An existing order's lines → the cart's picks and each item's effective
 *  partner (keyed as ordered: the leaf, or the bundle it came in). */
export function outsourcingFromOrder(o: {
  samples?: Array<{ tests?: Array<{
    testId?: string | null; packageTestId?: string | null; profileTestId?: string | null;
    outsourcingOverride?: string | null; effectivePartnerId?: string | null;
  }> }>;
} | null | undefined): { picks: Record<string, string>; effective: Record<string, string | null> } {
  const picks: Record<string, string> = {};
  const effective: Record<string, string | null> = {};
  for (const s of o?.samples ?? []) for (const t of s.tests ?? []) {
    for (const k of [t.testId, t.packageTestId, t.profileTestId]) {
      if (!k) continue;
      const ov = (t.outsourcingOverride ?? '').trim();
      if (ov && !picks[k]) picks[k] = ov;
      if (t.effectivePartnerId !== undefined && !(k in effective)) effective[k] = t.effectivePartnerId ?? null;
    }
  }
  return { picks, effective };
}
