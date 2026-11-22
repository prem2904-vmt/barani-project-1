import { MODULE_CATALOG, ModuleId } from '../modules/module-catalog';

/**
 * Frontdesk "Services" shelf (bottom bar) — the pure rules (owner 2026-11-19; the selection UX will be refined, so
 * everything about it lives here + ServiceShelfService + ServicesShelfComponent and nowhere else).
 *
 * A SERVICE is a care line the front desk handles: Lab, OPD, IPD, Scan (radiology), ER (emergency). Which ones a user
 * has comes ONLY from the existing gates — the tenant's module entitlement, the user's permissions and the beta gates
 * (OPD = OpdGateService.visible(), i.e. `pf.opd()` or an explicit entitlement). A module the catalog still marks
 * "coming soon" has no front-desk work, so it is never offered. One service (a lab-only tenant) = no shelf at all.
 */
export type ServiceId = 'lab' | 'opd' | 'ipd' | 'scan' | 'er';
/** 'all' = no service filter. */
export type ServiceFilter = ServiceId | 'all';

export interface ServiceDef {
  id: ServiceId;
  /** Chip text and the row tag (LAB / OPD …). */
  label: string;
  /** The catalog module behind it. */
  module: ModuleId;
}

/** Display order of the shelf (and of the row tags). */
export const SERVICES: readonly ServiceDef[] = [
  { id: 'lab', label: 'Lab', module: 'lab' },
  { id: 'opd', label: 'OPD', module: 'opd' },
  { id: 'ipd', label: 'IPD', module: 'ipd' },
  { id: 'scan', label: 'Scan', module: 'radiology' },
  { id: 'er', label: 'ER', module: 'emergency' },
];

/** What the gates answer for the current user (all already resolved by their own services). */
export interface ServiceGateInputs {
  /** TenantEntitlementsService.moduleOn(id) — OPD routes through the OPD gate there. */
  moduleOn: (id: ModuleId) => boolean;
  /** OpdGateService.visible() — the OPD beta gate (never decided here). */
  opdVisible: boolean;
  /** The user can open the OPD desk (OPD_AREAS 'desk' permissions). */
  opdDesk: boolean;
  /** Catalog status per module ('live' | 'coming_soon'); defaults to MODULE_CATALOG. */
  statusOf?: (id: ModuleId) => 'live' | 'coming_soon' | undefined;
}

const catalogStatus = (id: ModuleId) => MODULE_CATALOG.find(m => m.id === id)?.status;

/** The services this user has, in shelf order. Lab is the front desk's own line (module switch only); OPD needs
 *  BOTH the OPD gate and desk permission; anything else needs its module ON and built ('live'). */
export function availableServices(g: ServiceGateInputs): ServiceDef[] {
  const status = g.statusOf ?? catalogStatus;
  return SERVICES.filter(s => {
    if (s.id === 'lab') return g.moduleOn('lab');
    if (s.id === 'opd') return g.opdVisible && g.opdDesk;
    return status(s.module) === 'live' && g.moduleOn(s.module);
  });
}

/** The shelf only exists for 2+ services (a lab-only user sees exactly today's bar). */
export function showServiceShelf(services: readonly ServiceDef[]): boolean {
  return services.length >= 2;
}

/** A remembered choice that is no longer granted (or never was) falls back to All. */
export function effectiveService(saved: string | null | undefined, services: readonly ServiceDef[]): ServiceFilter {
  if (!saved || saved === 'all') return 'all';
  return services.some(s => s.id === saved) ? saved as ServiceId : 'all';
}

/** The service an ORDER belongs to: its owning module (Order.module — lab / opd / ipd …), lab when unset. */
export function serviceOfModule(module: string | null | undefined): ServiceId {
  const m = (module ?? '').trim().toLowerCase();
  if (!m || m === 'lab') return 'lab';
  if (m === 'opd') return 'opd';
  if (m === 'ipd') return 'ipd';
  if (m === 'radiology' || m === 'scan') return 'scan';
  if (m === 'emergency' || m === 'er') return 'er';
  return 'lab';
}

/** Does an item of `service` pass the filter? */
export function inService(filter: ServiceFilter, service: ServiceId): boolean {
  return filter === 'all' || filter === service;
}

/** Counts + "late" flags per service, published by the Frontdesk landing for the shelf. */
export interface ServiceTally {
  total: number;
  late: boolean;
  by: Partial<Record<ServiceId, { n: number; late: boolean }>>;
}

export const EMPTY_TALLY: ServiceTally = { total: 0, late: false, by: {} };

/** Tally items by service (each item counted once). */
export function tallyServices<T>(items: readonly T[], serviceOf: (t: T) => ServiceId, isLate: (t: T) => boolean): ServiceTally {
  const by: ServiceTally['by'] = {};
  let late = false;
  for (const it of items) {
    const s = serviceOf(it);
    const l = isLate(it);
    const cur = by[s] ?? { n: 0, late: false };
    by[s] = { n: cur.n + 1, late: cur.late || l };
    late = late || l;
  }
  return { total: items.length, late, by };
}

/** One shelf chip. */
export interface ServiceChip {
  id: ServiceFilter;
  label: string;
  n: number;
  late: boolean;
  selected: boolean;
}

/** The chips: All first, then each granted service. */
export function serviceChips(services: readonly ServiceDef[], tally: ServiceTally, selected: ServiceFilter): ServiceChip[] {
  return [
    { id: 'all' as ServiceFilter, label: 'All', n: tally.total, late: tally.late, selected: selected === 'all' },
    ...services.map(s => ({
      id: s.id as ServiceFilter, label: s.label, n: tally.by[s.id]?.n ?? 0, late: !!tally.by[s.id]?.late, selected: selected === s.id,
    })),
  ];
}
