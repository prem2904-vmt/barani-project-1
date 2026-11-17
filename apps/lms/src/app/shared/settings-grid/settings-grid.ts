import { DestroyRef, Signal, computed, inject, signal } from '@angular/core';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import type { SegmentedOption } from '../primitives/segmented.component';
import { ThemeService } from '../../core/services/theme.service';
import { gridThemeDark, gridThemeLight } from '../../features/admin/tests/tests/grid-theme';
import { injectSettingsHosted } from '../utils/settings-host';

/**
 * Settings list grids — ONE look for every list screen in Settings (owner
 * 2026-11-17: "our AG-Grid style, the same as Test Master, so the design is
 * the same across the app"). Pure helpers + Test Master's own renderers:
 *  - the grid theme (Test Master's, light/dark),
 *  - the status filter segmented (All · Active · Inactive, with counts),
 *  - the Active/Inactive SWITCH cell (inactive rows stay listed, greyed),
 *  - the actions cell (kit .pf-rowact: TEXT on web, ICON on touch; extra
 *    actions are quiet 28px icons, like Test Master's Revert),
 *  - a two-line cell (main + muted sub).
 * Layout classes live in settings-grid.scss (add it to the page's styleUrls).
 */

export type SgStatus = 'all' | 'active' | 'inactive';

/** True inside the Settings shell: the grid card renders BARE (the shell's card + head frame it). */
export function sgBare(): boolean {
  return injectSettingsHosted();
}

/** Test Master's grid theme for the current colour scheme. */
export function sgGridTheme(): Signal<typeof gridThemeLight> {
  const theme = inject(ThemeService);
  return computed(() => (theme.isDark() ? gridThemeDark : gridThemeLight));
}

/** A reactive media query signal, removed with the owner. */
export function sgMedia(query: string): Signal<boolean> {
  const mql = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
  const s = signal(!!mql?.matches);
  if (mql && typeof mql.addEventListener === 'function') {
    const on = (e: MediaQueryListEvent) => s.set(e.matches);
    mql.addEventListener('change', on);
    try { inject(DestroyRef).onDestroy(() => mql.removeEventListener('change', on)); } catch { /* no owner */ }
  }
  return s.asReadonly();
}

/** Narrow widths (Test Master's 900px): side cards become a band-chip sheet. */
export const SG_NARROW_MQ = '(max-width: 900px)';
/** Phones: the grid keeps only its key columns (Test Master's phoneTrim). */
export const SG_PHONE_MQ = '(max-width: 640px)';

/** Test Master's card-header status filter: All · Active · Inactive. */
export function sgStatusOptions(all: number, inactive: number): SegmentedOption<SgStatus>[] {
  return [
    { value: 'all', label: 'All', count: all, iconPath: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'] },
    { value: 'active', label: 'Active', count: all - inactive, iconPath: ['M20 6 9 17l-5-5'] },
    { value: 'inactive', label: 'Inactive', count: inactive, iconPath: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M5.6 5.6l12.8 12.8'] },
  ];
}

/** Keep the rows a status filter asks for. */
export function sgByStatus<T>(rows: readonly T[], status: SgStatus, isActive: (r: T) => boolean): T[] {
  if (status === 'all') return rows.slice();
  return rows.filter((r) => (status === 'active') === isActive(r));
}

/** Grey an inactive row's data (the switch + actions keep full strength). */
export function sgRowOff<T>(isActive: (r: T) => boolean) {
  return (p: { data?: T }): string | undefined => (p.data && !isActive(p.data) ? 'pf-sg-row--off' : undefined);
}

/** Default column behaviour for settings grids (wrap, grow, no column filter menus). */
export const SG_DEFAULT_COLDEF: ColDef = { sortable: true, resizable: true, filter: false, minWidth: 100, flex: 1, wrapText: true, autoHeight: true };

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));

/** A two-line cell: the value + a muted sub line (both escaped). */
export function sgCell(main: string | null | undefined, sub?: string | null, strong = false): HTMLElement {
  const el = document.createElement('div');
  el.className = 'pf-sg-cell';
  el.innerHTML = `<span class="${strong ? 'pf-sg-cell__main' : ''}">${esc(main || '—')}</span>`
    + (sub ? `<span class="pf-sg-cell__sub">${esc(sub)}</span>` : '');
  return el;
}

/** Small neutral chips (departments handled, roles …) in one wrapping cell. */
export function sgChips(items: readonly string[], empty = '—'): HTMLElement {
  const el = document.createElement('div');
  el.className = 'pf-sg-chips';
  if (!items.length) { el.innerHTML = `<span class="pf-sg-cell__sub">${esc(empty)}</span>`; return el; }
  el.innerHTML = items.map((t) => `<span class="pf-sg-chip">${esc(t)}</span>`).join('');
  return el;
}

/** A coloured status word with a dot (green / amber / red / neutral). */
export function sgStatusWord(label: string, tone: string, sub?: string | null): HTMLElement {
  const el = document.createElement('div');
  el.className = 'pf-sg-cell';
  el.innerHTML = `<span class="pf-sg-status" data-tone="${esc(tone)}"><span class="pf-sg-status__dot" aria-hidden="true"></span>${esc(label)}</span>`
    + (sub ? `<span class="pf-sg-cell__sub">${esc(sub)}</span>` : '');
  return el;
}

/** The kit switch (.pf-toggle, violet ON — Test Master's department switch) in a grid cell. */
export function sgSwitch(active: boolean, name: string, onToggle: () => void, disabled = false): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pf-sg-switchcell';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pf-toggle pf-sg-switch';
  btn.setAttribute('role', 'switch');
  btn.setAttribute('aria-checked', String(active));
  btn.title = active ? 'Deactivate' : 'Activate';
  btn.setAttribute('aria-label', (active ? 'Deactivate ' : 'Activate ') + name);
  btn.disabled = disabled;
  btn.innerHTML = '<span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>';
  btn.addEventListener('click', (e) => { e.stopPropagation(); onToggle(); });
  wrap.appendChild(btn);
  return wrap;
}

export interface SgAction {
  /** Visible on web ("Edit"), kept for AT on touch. */
  label: string;
  /** aria-label / tooltip ("Edit Apollo"). */
  aria: string;
  /** SVG inner markup (stroked paths). */
  path: string;
  run: () => void;
  /** A quiet 28px icon even on web (secondary actions, like Revert). */
  icon?: boolean;
  danger?: boolean;
}

export const SG_ICON = {
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  open: '<path d="m9 18 6-6-6-6"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  power: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><path d="M12 2v10"/>',
  restore: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/>',
  more: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
};

/** Test Master's actions cell: kit row actions, TEXT on web / ICON on touch. */
export function sgActions(web: boolean, actions: readonly SgAction[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pf-sg-acts';
  for (const a of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pf-rowact' + (!web || a.icon ? ' pf-rowact--icon' : '') + (web && a.icon ? ' pf-sg-rowact-sm' : '') + (a.danger ? ' pf-sg-rowact-danger' : '');
    b.title = a.aria;
    b.setAttribute('aria-label', a.aria);
    b.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
      + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + a.path + '</svg>';
    const t = document.createElement('span');
    t.className = 'pf-rowact__t';
    t.textContent = a.label;
    b.appendChild(t);
    b.addEventListener('click', (e) => { e.stopPropagation(); a.run(); });
    wrap.appendChild(b);
  }
  return wrap;
}

/** The actions column width that fits its content (Test Master's rule):
 *  `texts` = the labels shown as TEXT on web, `icons` = quiet 28px icons.
 *  On touch every action is a 44px icon. */
export function sgActionsCol<T>(web: boolean, texts: readonly string[], icons: number,
  render: (p: ICellRendererParams<T>) => HTMLElement, pinned = true): ColDef<T> {
  const textPx = texts.reduce((n, t) => n + 26 + Math.ceil(t.length * 7), 0);
  const gaps = Math.max(0, texts.length + icons - 1) * 4;
  const w = web ? 14 + textPx + icons * 28 + gaps : 14 + (texts.length + icons) * 48;
  return {
    headerName: '', colId: 'actions', cellRenderer: render, cellClass: 'pf-sg-acts-cell',
    editable: false, sortable: false, filter: false, resizable: false, suppressSizeToFit: true,
    width: w, minWidth: w, maxWidth: w, flex: 0, wrapText: false, autoHeight: false,
    ...(pinned ? { pinned: 'right' as const } : {}),
  };
}

/** A neutral status pill: Active (violet dot) / Inactive (muted). */
export function sgActivePill(active: boolean): HTMLElement {
  const el = document.createElement('span');
  el.className = 'pf-sg-pill' + (active ? ' pf-sg-pill--on' : '');
  el.textContent = active ? 'Active' : 'Inactive';
  return el;
}

/** Status column as a pill (sorted Active first). */
export function sgPillCol<T>(isActive: (r: T) => boolean): ColDef<T> {
  return {
    headerName: 'Status', colId: 'status', width: 104, minWidth: 96, maxWidth: 120, flex: 0, wrapText: false, autoHeight: false,
    valueGetter: (p) => (p.data && isActive(p.data) ? 'Active' : 'Inactive'),
    cellRenderer: (p: ICellRendererParams<T>) => (p.data ? sgActivePill(isActive(p.data)) : document.createElement('span')),
  };
}

/** "₹1,500" (2 decimals only when there are paise). */
export function sgInr(n: number | null | undefined, decimals = 2): string {
  const v = Number(n ?? 0);
  return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** The status column (Test Master's): the switch, sorted by Active/Inactive. */
export function sgStatusCol<T>(isActive: (r: T) => boolean, name: (r: T) => string, toggle: (r: T) => void): ColDef<T> {
  return {
    headerName: 'Status', colId: 'status', minWidth: 95, maxWidth: 110, width: 100, flex: 0, editable: false,
    wrapText: false, autoHeight: false,
    valueGetter: (p) => (p.data && isActive(p.data) ? 'Active' : 'Inactive'),
    cellRenderer: (p: ICellRendererParams<T>) => (p.data ? sgSwitch(isActive(p.data), name(p.data), () => toggle(p.data!)) : document.createElement('span')),
  };
}
