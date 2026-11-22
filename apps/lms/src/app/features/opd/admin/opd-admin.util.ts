import { GRID_SIZE, GRID_TOUCH_PART } from '../../admin/tests/tests/grid-theme';
import { DestroyRef } from '@angular/core';
import { colorSchemeDark, colorSchemeLight, themeQuartz } from 'ag-grid-community';
import type { OpdDoctorPriceRow, OpdFormListRow, OpdServiceRow } from './opd-admin.api';

/**
 * Small pure helpers shared by the OPD Master screens (Agent A's folder).
 * Grid themes: the SAME params as Test Master (features/admin/tests/tests/
 * grid-theme.ts) — Noto via inherit, 44px rows, violet accent.
 */
export const opdGridLight = themeQuartz.withPart(colorSchemeLight).withPart(GRID_TOUCH_PART).withParams({
  fontFamily: 'inherit', fontSize: 13, ...GRID_SIZE, borderRadius: 12, accentColor: '#7c3aed',
});
export const opdGridDark = themeQuartz.withPart(colorSchemeDark).withPart(GRID_TOUCH_PART).withParams({
  fontFamily: 'inherit', fontSize: 13, ...GRID_SIZE, borderRadius: 12, accentColor: '#a855f7',
});

/** A reactive media query (current match; `on` fires on change until destroy). */
export function mq(query: string, ref: DestroyRef, on: (m: boolean) => void): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  const m = window.matchMedia(query);
  const fn = (e: MediaQueryListEvent) => on(e.matches);
  try { m.addEventListener?.('change', fn); ref.onDestroy(() => m.removeEventListener?.('change', fn)); } catch { /* old engines */ }
  return !!m.matches;
}

/** Per-user remembered flag (collapsed side card …) — never required state. */
export function readFlag(key: string): boolean { try { return localStorage.getItem(key) === '1'; } catch { return false; } }
export function writeFlag(key: string, on: boolean): void { try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* private mode */ } }

/** "₹1,500" — just the price (PF-PATTERN §2). */
export function inr(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: Number.isInteger(v) ? 0 : 2 });
}

/** The price cell of a service: the common price, or the per-doctor range. */
export function priceText(s: Pick<OpdServiceRow, 'priceMode' | 'commonPrice' | 'doctorPrices'>): string {
  if (s.priceMode !== 'per_doctor') return inr(s.commonPrice);
  const p = (s.doctorPrices ?? []).filter((x: OpdDoctorPriceRow) => x.isActive).map((x) => x.price);
  if (!p.length) return 'Set per doctor';
  const lo = Math.min(...p), hi = Math.max(...p);
  return lo === hi ? inr(lo) : `${inr(lo)} – ${inr(hi)}`;
}

/** The follow-up rule in words: "Within 7 days · ₹250" / "Within 7 days · free" / "—". */
export function followUpText(days: number | null | undefined, fee: number | null | undefined): string {
  if (!days) return '—';
  return `Within ${days} ${days === 1 ? 'day' : 'days'} · ${fee ? inr(fee) : 'free'}`;
}

/** A department code from its name ("General Medicine" → "GM", "ENT" → "ENT"), unique among `taken`. */
export function deptCode(name: string, taken: string[]): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  let base = (words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? 'D').slice(0, 4)).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'D';
  base = base.slice(0, 8);
  const set = new Set(taken.map((t) => t.toUpperCase()));
  let c = base, n = 2;
  while (set.has(c)) c = `${base}${n++}`;
  return c;
}

/** Next free service code in a department ("ENT-C03" / "ENT-P02"). */
export function nextServiceCode(dept: string, category: 'consultation' | 'procedure', taken: string[]): string {
  const p = `${dept}-${category === 'procedure' ? 'P' : 'C'}`;
  const set = new Set(taken.map((t) => t.toUpperCase()));
  for (let i = 1; i < 1000; i++) { const c = `${p}${String(i).padStart(2, '0')}`; if (!set.has(c)) return c; }
  return `${p}${Date.now() % 1000}`;
}

export const WEEK_DAYS: { value: string; label: string }[] = [
  { value: 'mon', label: 'Mon' }, { value: 'tue', label: 'Tue' }, { value: 'wed', label: 'Wed' }, { value: 'thu', label: 'Thu' },
  { value: 'fri', label: 'Fri' }, { value: 'sat', label: 'Sat' }, { value: 'sun', label: 'Sun' },
];

/** "Mon–Sat" / "Mon, Wed, Fri" / "—". */
export function daysText(days: string[] | null | undefined): string {
  const idx = (days ?? []).map((d) => WEEK_DAYS.findIndex((w) => w.value === d)).filter((i) => i >= 0).sort((a, b) => a - b);
  if (!idx.length) return '—';
  const contiguous = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  if (contiguous && idx.length >= 3) return `${WEEK_DAYS[idx[0]].label}–${WEEK_DAYS[idx[idx.length - 1]].label}`;
  return idx.map((i) => WEEK_DAYS[i].label).join(', ');
}

/** "v3 · draft changes" / "v2" / "New · draft" for a library row. */
export function libraryVersion(f: Pick<OpdFormListRow, 'publishedVersion' | 'draftVersion'>): string {
  if (!f.publishedVersion) return 'New · draft';
  return f.draftVersion ? `v${f.publishedVersion} · draft changes` : `v${f.publishedVersion}`;
}
