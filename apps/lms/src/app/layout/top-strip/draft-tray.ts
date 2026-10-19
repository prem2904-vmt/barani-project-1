import type { DraftChip } from '../../core/services/draft-shelf.service';
import type { PfAction } from '../../shared/components/actions-menu/actions-menu.component';

/**
 * Draft tray (bottom bar) — the pure rules behind the "resume" chips.
 *
 * Owner (2026-10-02): "this UI as a pill is not nice … sample number is
 * enough". A chip shows ONLY its label (lab: the sample number; front desk:
 * the patient — its only identifier); the secondary text (patient name /
 * test count) and the time live in the tooltip, the accessible name and the
 * overflow menu.
 */

/** How many chips fit before the "+N" chip, by viewport width. The shelf
 *  only renders on the docked bar at ≥768px (CSS); the work-area tabs share
 *  the bar, so the cap grows with the room the bar actually has. */
export function draftCap(viewportWidth: number): number {
  if (viewportWidth >= 1536) return 6;
  if (viewportWidth >= 1280) return 5;
  if (viewportWidth >= 1024) return 4;
  return 3;
}

/** The chips shown inline and how many go behind "+N". By the width rule
 *  there is never a "+1" chip hiding exactly one draft (it would take the
 *  same room — that draft shows inline). A MEASURED cap (`measured`: the
 *  chips really overflowed at cap + 1) is exact, so "+1" is allowed there. */
export function draftSplit<T>(items: readonly T[], cap: number, measured = false): { shown: T[]; more: number } {
  // A measured cap may reach 0: no room for even one chip → the tray
  // collapses to its count ("Drafts 8 ^"), every draft in the menu.
  const c = Math.max(measured ? 0 : 1, cap);
  if (items.length <= (measured ? c : c + 1)) return { shown: items.slice(), more: 0 };
  return { shown: items.slice(0, c), more: items.length - c };
}

/** "just now" / "4 min ago" / "2 h ago" / "yesterday" / "3 d ago" — no
 *  time = empty (the lab draft rows carry none). */
export function draftAgo(at: number | string | null | undefined, now: number = Date.now()): string {
  if (at === null || at === undefined || at === '') return '';
  const t = typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} d ago`;
}

/** Secondary line: patient / test count, then the time when known. */
export function draftDetail(chip: DraftChip, now: number = Date.now()): string {
  return [chip.sub, draftAgo(chip.at, now)].filter(Boolean).join(' · ');
}

/** Tooltip AND accessible name: "Resume result for 26123 · Mr. Sathish Kumar"
 *  ("Open now — …" for the draft on stage). Carries the patient name, which
 *  the chip itself no longer prints. */
export function draftTitle(chip: DraftChip, on: boolean, now: number = Date.now()): string {
  const detail = draftDetail(chip, now);
  const what = chip.label + (detail ? ' · ' + detail : '');
  return on ? `Open now — ${what}` : `${chip.verb ?? 'Resume draft'} ${what}`;
}

/** The overflow "+N" menu (pf-actions-menu rows): EVERY draft, in shelf
 *  order — label as the row title, patient · time as its hint, the on-stage
 *  draft marked current. */
export function draftMenuActions(items: readonly DraftChip[], activeId: string | null, now: number = Date.now()): PfAction[] {
  return items.map(d => ({
    id: d.id,
    label: d.label,
    icon: 'edit' as const,
    hint: (d.id === activeId ? 'Open now' + (d.sub || d.at ? ' · ' : '') : '') + draftDetail(d, now) || undefined,
    current: d.id === activeId,
  }));
}
