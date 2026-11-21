/**
 * Collect screen — the right-side info panel (remaining, priority, fasting, timeline, tests) can be shown / hidden
 * (owner 2026-11-21: on tablets and small screens it crowds the vials). Pure rules only; the component wires signals.
 *
 *  - CLOSED by default on every tier (owner 2026-11-21, revision 2): the head chips carry the critical info.
 *  - desktop (>= 1280px): the toggle opens it DOCKED beside the vials (never a drawer).
 *  - tablet (641–1279px) / phone (<= 640px): the toggle opens it as a right-side DRAWER.
 *  - the choice is remembered per user AND per tier in localStorage (every access in try/catch).
 */
export type InfoTier = 'desktop' | 'tablet' | 'phone';

export const INFO_DOCK_MIN = 1280;
export const INFO_PHONE_MAX = 640;
/** v2: the default changed to closed everywhere, so choices saved under v1 (desktop open by default) are ignored. */
const KEY_PREFIX = 'pf-lms.collect.info.v2';

export function infoTier(width: number): InfoTier {
  if (width >= INFO_DOCK_MIN) return 'desktop';
  return width <= INFO_PHONE_MAX ? 'phone' : 'tablet';
}

/** Desktop docks the panel; smaller tiers overlay it as a drawer. */
export function infoDocked(tier: InfoTier): boolean { return tier === 'desktop'; }
/** Closed by default on every tier (owner 2026-11-21, revision 2). */
export function infoDefaultOpen(_tier: InfoTier): boolean { return false; }

export function infoKey(userId: string | null | undefined, tier: InfoTier): string {
  return `${KEY_PREFIX}.${userId || 'anon'}.${tier}`;
}

type Store = Pick<Storage, 'getItem' | 'setItem'> | null | undefined;

/** Remembered choice for this user + tier, else the tier default. Storage that throws / is missing = the default. */
export function readInfoOpen(store: Store, userId: string | null | undefined, tier: InfoTier): boolean {
  try {
    const v = store?.getItem(infoKey(userId, tier));
    if (v === '1') return true;
    if (v === '0') return false;
  } catch { /* private mode / blocked storage */ }
  return infoDefaultOpen(tier);
}

export function writeInfoOpen(store: Store, userId: string | null | undefined, tier: InfoTier, open: boolean): void {
  try { store?.setItem(infoKey(userId, tier), open ? '1' : '0'); } catch { /* in-memory only */ }
}

// ─── Fasting text ──────────────────────────────────────────────────────
/** One group of a timed series ("OGTT" → 30 min · 60 min · …) or a plain test name (offsets empty). */
export interface FastingGroup { base: string; offsets: string[] }

const OFFSET_RE = /^(.*?)[\s\-–—:,(]*(\d+(?:\.\d+)?)\s*(minutes?|mins?|m|hours?|hrs?|h)\)?\s*$/i;

/**
 * "OGTT – 30 Minutes, OGTT – 60 Minutes, Glucose Fasting" → [{OGTT, [30 min, 60 min]}, {Glucose Fasting, []}].
 * Series offsets are sorted by time and shown in minutes; plain names keep their order after the series.
 */
export function fastingGroups(names: readonly string[]): FastingGroup[] {
  const series = new Map<string, { base: string; mins: Set<number> }>();
  const plain: string[] = [];
  for (const raw of names) {
    const name = (raw ?? '').trim();
    if (!name) continue;
    const m = OFFSET_RE.exec(name);
    const base = m?.[1]?.trim();
    if (!m || !base) { if (!plain.includes(name)) plain.push(name); continue; }
    const n = Number(m[2]);
    const mins = /^h/i.test(m[3]) ? Math.round(n * 60) : Math.round(n);
    const key = base.toLowerCase();
    const s = series.get(key) ?? { base, mins: new Set<number>() };
    s.mins.add(mins);
    series.set(key, s);
  }
  const out: FastingGroup[] = [...series.values()].map(s => ({ base: s.base, offsets: [...s.mins].sort((a, b) => a - b).map(v => `${v} min`) }));
  for (const p of plain) out.push({ base: p, offsets: [] });
  return out;
}

/** Full plain-words line for the chip's hover / tap text. */
export function fastingText(names: readonly string[]): string {
  const g = fastingGroups(names);
  if (!g.length) return '';
  return 'Fasting required: ' + g.map(x => x.offsets.length ? `${x.base} ${x.offsets.join(' · ')}` : x.base).join('; ');
}
