/**
 * New appointment — NEW DESIGN helpers + styles (PF-PATTERN §21: one page,
 * no tabs, keyboard-first). Everything is scoped under `.pf-bka`, which only
 * renders in the new design, so the classic booking page is untouched.
 */

import { addDays, addMonths, endOfWeek, format, isSameMonth, parse, startOfMonth, startOfWeek } from 'date-fns';

export type SlotPeriod = 'morning' | 'afternoon' | 'evening' | 'night';

/** One day in the Date card's month grid. */
export interface MonthCell {
  iso: string;
  n: number;
  /** Belongs to the previous / next month (muted). */
  outside: boolean;
  today: boolean;
  /** Before today: not bookable (the page's min date is today). */
  past: boolean;
  /** "Monday 28 September 2026". */
  label: string;
}

/** Weekday column heads (the grid starts on Monday, like the calendar). */
export const MONTH_DOWS: ReadonlyArray<{ s: string; long: string }> = [
  { s: 'M', long: 'Monday' }, { s: 'T', long: 'Tuesday' }, { s: 'W', long: 'Wednesday' },
  { s: 'T', long: 'Thursday' }, { s: 'F', long: 'Friday' }, { s: 'S', long: 'Saturday' }, { s: 'S', long: 'Sunday' },
];

/** Always six Monday-first weeks (a stable 7 x 6 grid, no height jumps). */
export function monthGrid(month: Date, todayIso: string): MonthCell[][] {
  const first = startOfMonth(month);
  const start = startOfWeek(first, { weekStartsOn: 1 });
  const weeks: MonthCell[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: MonthCell[] = [];
    for (let d = 0; d < 7; d++) {
      const day = addDays(start, w * 7 + d);
      const iso = format(day, 'yyyy-MM-dd');
      row.push({ iso, n: day.getDate(), outside: !isSameMonth(day, first), today: iso === todayIso,
                 past: iso < todayIso, label: format(day, 'EEEE d MMMM yyyy') });
    }
    weeks.push(row);
  }
  return weeks;
}

/** Where a grid key moves the focused day (null = not a move key).
 *  Arrows ±1 / ±7, Home / End = start / end of the week, PageUp / PageDown
 *  = the same day a month earlier / later. */
export function calendarMove(iso: string, key: string): string | null {
  const d = parse(iso, 'yyyy-MM-dd', new Date());
  const to = (x: Date) => format(x, 'yyyy-MM-dd');
  switch (key) {
    case 'ArrowLeft': return to(addDays(d, -1));
    case 'ArrowRight': return to(addDays(d, 1));
    case 'ArrowUp': return to(addDays(d, -7));
    case 'ArrowDown': return to(addDays(d, 7));
    case 'Home': return to(startOfWeek(d, { weekStartsOn: 1 }));
    case 'End': return to(endOfWeek(d, { weekStartsOn: 1 }));
    case 'PageUp': return to(addMonths(d, -1));
    case 'PageDown': return to(addMonths(d, 1));
    default: return null;
  }
}

/** The slot chip that owns the grid's single Tab stop: the picked time when
 *  it is shown, else the first available slot, else the first slot. */
export function rovingIndex(list: ReadonlyArray<{ time: string; available: boolean }>, selected: string): number {
  if (!list.length) return -1;
  const sel = list.findIndex(s => s.time === selected);
  if (sel >= 0) return sel;
  const free = list.findIndex(s => s.available);
  return free >= 0 ? free : 0;
}

/** What to focus inside a `[data-nav]` stop: the stop itself when it is a
 *  field / button, else its roving item (tabindex 0) or first real field. */
function focusableIn(el: HTMLElement): HTMLElement | null {
  if (el.matches('input, textarea, button')) return (el as HTMLInputElement).disabled ? null : el;
  return el.querySelector<HTMLElement>(
    '[tabindex="0"], input:not([type="date"]):not([tabindex="-1"]), textarea, button:not([disabled]):not([tabindex="-1"])');
}

/** Enter = next field: the first focusable stop at or after `from`. */
export function nextFocus(stops: HTMLElement[], from: number): HTMLElement | null {
  for (let k = Math.max(0, from); k < stops.length; k++) {
    const f = focusableIn(stops[k]);
    if (f) return f;
  }
  return null;
}

export const BOOK_APPOINTMENT_ND_STYLES = `
  /* The page fills the shell (the frontdesk outlet nests it): only the
     body — and at ≥1200px only the card bodies — scroll. */
  :host:has(> .pf-bka) { height: 100%; }
  /* ── Pill = the context bar: date · slot · patient ── */
  .pf-bka-ctx.pf-ctx { gap: 8px; }
  .pf-bka-ctx__none { font-size: 13px; font-weight: 400; color: var(--text-tertiary); }
  .pf-bka-ctx__patient { flex-wrap: wrap; gap: 2px 10px; margin-left: 4px; }
  .pf-bka-ctx__pmeta { font-size: 12.5px; font-weight: 400; color: var(--text-secondary); }

  /* ── Body: three card columns (patient + date · slot · details) ── */
  .pf-bka-body { display: flex; flex-direction: column; gap: 12px; }
  .pf-bka-alert {
    flex: none; display: flex; align-items: center; gap: 8px; margin: 0; padding: 10px 14px;
    border-radius: var(--pf-radius-sm); border: 1px solid color-mix(in srgb, var(--red-text, #dc2626) 45%, transparent);
    background: color-mix(in srgb, var(--red-text, #dc2626) 6%, var(--pf-card-bg));
    font-size: 13px; font-weight: 500; color: var(--red-text, #dc2626);
  }
  .pf-bka-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
  .pf-bka-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; min-height: 0; }
  .pf-bka-card { min-width: 0; }
  .pf-bka-card .pf-card__body { gap: 12px; }
  /* Let the shared patient search results float over the neighboring cards. */
  .pf-bka-patient:focus-within { position: relative; z-index: 20; overflow: visible; }
  .pf-bka-patient:focus-within .pf-card__body { overflow: visible; }
  .pf-bka-req, .pf-bka-opt { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; color: var(--text-tertiary); }
  @media (min-width: 768px) {
    .pf-bka-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .pf-bka-details { grid-column: 1 / -1; }
    /* Patient + Date beside Time slot: the Date card grows to the row's
       height and its month grid stretches (no empty space). */
    .pf-bka-grid > .pf-bka-col { align-self: stretch; }
    .pf-bka-date { flex: 1 1 auto; }
  }
  /* ≥1200px: three columns side by side FILLING the body; only card bodies
     scroll (no page scroll), like registration. */
  @media (min-width: 1200px) {
    .pf-bka-body { overflow: hidden; }
    .pf-bka-grid { flex: 1 1 auto; min-height: 0; grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr) minmax(0, 1fr); align-items: stretch; grid-template-rows: minmax(0, 1fr); }
    .pf-bka-details { grid-column: auto; }
    .pf-bka-col { min-height: 0; }
    .pf-bka-patient { flex: none; max-height: 60%; }
    .pf-bka-date { flex: 1 1 auto; }
    .pf-bka-slots, .pf-bka-details { min-height: 0; }
  }

  /* Field with a leading search icon. */
  .pf-bka-inputwrap { position: relative; display: block; }
  .pf-bka-inputwrap__icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary); pointer-events: none; }
  .pf-bka-inputwrap .pf-input { padding-left: 36px; }
  .pf-bka-err { margin: 0; font-size: 12px; color: var(--red-text, #dc2626); }
  .pf-bka-note { margin: 0; padding: 6px 2px; font-size: 13px; color: var(--text-tertiary); list-style: none; }

  /* ── Patient: results one per row; the picked patient as a kit row ── */
  .pf-bka-psearch { position: relative; }
  .pf-bka-results { margin: 4px 0 0; padding: 4px; list-style: none; display: flex; flex-direction: column; gap: 2px;
    border-radius: var(--pf-radius-sm); border: 1px solid var(--pf-line); background: var(--pf-card-bg); box-shadow: var(--pf-shadow-sm);
    max-height: 280px; overflow-y: auto; }
  .pf-bka-results--float { animation: pf-fade-scale var(--pf-dur-fast) var(--pf-spring) both; }
  .pf-bka-tests { position: relative; }
  .pf-bka-result {
    width: 100%; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-height: 48px; padding: 8px 10px;
    border: 0; border-radius: 8px; background: transparent; font: inherit; color: var(--text-primary); text-align: left; cursor: pointer;
  }
  .pf-bka-result[aria-selected='true'] { background: var(--pf-sel-bg); }
  .pf-bka-result__name { font-size: 14px; font-weight: 500; line-height: 1.3; overflow-wrap: anywhere; }
  .pf-bka-result__meta { font-size: 12px; color: var(--text-tertiary); }
  .pf-bka-result--test { flex-direction: row; align-items: center; gap: 10px; min-height: 44px; }
  .pf-bka-result--test .pf-bka-result__name { flex: 1 1 auto; min-width: 0; font-size: 13px; }
  .pf-bka-result__short { color: var(--text-tertiary); font-weight: 400; }
  .pf-bka-result__check { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px;
    border-radius: 999px; border: 1.5px solid var(--pf-sel-border); color: #fff; }
  .pf-bka-result[aria-checked='true'] .pf-bka-result__check { background: var(--color-violet-600, #7c3aed); border-color: var(--color-violet-600, #7c3aed); }
  .pf-bka-result__code { flex: none; min-width: 56px; font-size: 12px; color: var(--text-secondary); }
  .pf-bka-result__price { flex: none; font-size: 13px; color: var(--text-primary); }
  .pf-bka-picked { gap: 12px; }
  .pf-bka-picked__who { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .pf-bka-picked__name { font-size: 15px; font-weight: 600; line-height: 1.3; color: var(--text-primary); overflow-wrap: anywhere; }
  .pf-bka-picked__meta { font-size: 12.5px; color: var(--text-secondary); }
  .pf-bka-change { height: 36px; min-height: 36px; }

  /* ── Date: typed kit date + a full month grid that fills the card ── */
  .pf-bka-date pf-date { display: block; }
  .pf-bka-date .pf-card__body { min-height: 0; }
  .pf-bka-cal { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 6px; }
  .pf-bka-cal__head { flex: none; display: flex; align-items: center; gap: 4px; }
  .pf-bka-cal__title { flex: 1 1 auto; min-width: 0; text-align: center; font-size: 14px; font-weight: 600; color: var(--text-primary); }
  .pf-bka-cal__nav {
    flex: none; display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px;
    border: 0; border-radius: 8px; background: transparent; color: var(--text-secondary); cursor: pointer;
    transition: background var(--pf-dur-fast) ease, color var(--pf-dur-fast) ease;
  }
  .pf-bka-cal__nav:hover:not(:disabled) { background: var(--pf-chip-bg); color: var(--text-primary); }
  .pf-bka-cal__nav:disabled { opacity: 0.35; cursor: default; }
  .pf-bka-cal__nav:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 1px; }
  .pf-bka-cal__grid { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 4px; overflow: hidden; }
  .pf-bka-cal__row { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
  .pf-bka-cal__dow { padding: 2px 0 4px; text-align: center; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; color: var(--text-tertiary); }
  .pf-bka-cal__weeks { flex: 1 1 auto; min-height: 0; display: grid; grid-template-rows: repeat(6, minmax(40px, 1fr)); gap: 4px; }
  .pf-bka-cal__weeks--next { animation: pf-bka-cal-next var(--pf-dur, 220ms) var(--pf-spring, ease) both; }
  .pf-bka-cal__weeks--prev { animation: pf-bka-cal-prev var(--pf-dur, 220ms) var(--pf-spring, ease) both; }
  @keyframes pf-bka-cal-next { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: none; } }
  @keyframes pf-bka-cal-prev { from { opacity: 0; transform: translateX(-14px); } to { opacity: 1; transform: none; } }
  .pf-bka-cal__day {
    position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
    min-width: 0; min-height: 40px; height: 100%; padding: 0;
    border-radius: 10px; border: 1px solid transparent; background: transparent;
    font: inherit; color: var(--text-primary); cursor: pointer;
    transition: border-color var(--pf-dur-fast) ease, background var(--pf-dur-fast) ease;
  }
  .pf-bka-cal__n {
    display: inline-flex; align-items: center; justify-content: center; min-width: 30px; height: 30px; padding: 0 4px;
    border-radius: 999px; font-size: 14px; font-weight: 500; font-variant-numeric: tabular-nums;
  }
  .pf-bka-cal__day:hover:not([aria-disabled='true']) { border-color: var(--pf-line); background: var(--pf-chip-bg); }
  .pf-bka-cal__day:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 1px; }
  .pf-bka-cal__day--out { color: var(--text-muted, var(--text-tertiary)); }
  .pf-bka-cal__day--out .pf-bka-cal__n { font-weight: 400; }
  .pf-bka-cal__day[aria-disabled='true'] { cursor: not-allowed; color: var(--text-muted, var(--text-tertiary)); }
  .pf-bka-cal__day[aria-disabled='true'] .pf-bka-cal__n { font-weight: 400; opacity: 0.7; }
  /* Today: a subtle violet disc (like the calendar's today). */
  .pf-bka-cal__day--today .pf-bka-cal__n {
    color: var(--violet-text, #7c3aed); font-weight: 600;
    background: color-mix(in srgb, var(--color-primary, #7c3aed) 12%, transparent);
  }
  /* Selected: the neutral raised chip with a violet border (= the picked slot). */
  .pf-bka-cal__day[aria-selected='true'] {
    border-color: var(--color-violet-600, #7c3aed); background: color-mix(in srgb, var(--color-primary, #7c3aed) 8%, var(--pf-card-bg));
    box-shadow: var(--pf-shadow-sm); color: var(--text-primary);
  }
  .pf-bka-cal__day[aria-selected='true'] .pf-bka-cal__n { font-weight: 600; }

  /* ── Slots: neutral chips — available / taken / selected ── */
  .pf-bka-periods { display: flex; width: 100%; }
  .pf-bka-periods .pf-seg__item { flex: 1 1 0; min-width: 0; height: 34px; font-size: 12.5px; white-space: nowrap; }
  .pf-bka-periods__n { margin-left: 4px; font-weight: 500; color: var(--text-tertiary); }
  .pf-bka-chips {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 8px; padding: 2px;
    border-radius: var(--pf-radius-sm);
  }
  .pf-bka-chips--error { outline: 1px solid var(--red-border, #ef4444); outline-offset: 4px; }
  .pf-bka-chip {
    position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px;
    min-height: 44px; padding: 4px 6px; border-radius: 10px; border: 1px solid var(--pf-line); background: var(--pf-card-bg);
    font: inherit; color: var(--text-primary); cursor: pointer;
    transition: border-color var(--pf-dur-fast) ease, background var(--pf-dur-fast) ease;
  }
  .pf-bka-chip:hover:not([aria-disabled='true']) { border-color: var(--pf-sel-border); background: var(--pf-chip-bg); }
  .pf-bka-chip:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
  .pf-bka-chip__t { font-size: 14px; font-weight: 500; }
  .pf-bka-chip[aria-checked='true'] {
    border-color: var(--color-violet-600, #7c3aed); background: color-mix(in srgb, var(--color-primary, #7c3aed) 8%, var(--pf-card-bg));
    animation: pf-pop 230ms var(--pf-spring-bounce) both;
  }
  .pf-bka-chip[aria-checked='true'] .pf-bka-chip__t { font-weight: 600; }
  .pf-bka-chip__ok { position: absolute; top: 4px; right: 5px; color: var(--violet-text, #7c3aed); }
  .pf-bka-chip[aria-disabled='true'] { cursor: not-allowed; border-style: dashed; background: var(--pf-chip-bg); color: var(--text-tertiary); }
  .pf-bka-chip[aria-disabled='true'] .pf-bka-chip__t { text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--text-tertiary) 60%, transparent); }
  .pf-bka-chip__full { font-size: 10.5px; font-weight: 500; color: var(--text-tertiary); }
  .pf-bka-legend { margin: 2px 0 0; display: flex; align-items: center; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--text-tertiary); }
  .pf-bka-legend__k { display: inline-block; width: 14px; height: 14px; margin-right: -8px; border-radius: 4px; border: 1px solid var(--pf-line); background: var(--pf-card-bg); vertical-align: -2px; }
  .pf-bka-legend__k--sel { border-color: var(--color-violet-600, #7c3aed); background: color-mix(in srgb, var(--color-primary, #7c3aed) 12%, var(--pf-card-bg)); }
  .pf-bka-legend__k--full { border-style: dashed; background: var(--pf-chip-bg); }

  /* ── Details: tests · collection · notes ── */
  .pf-bka-dbody { gap: 16px; }
  .pf-bka-picked-tests { margin: 4px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; border-top: 1px solid var(--pf-line); }
  .pf-bka-ptest { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 4px 0; border-bottom: 1px solid var(--pf-line); }
  .pf-bka-ptest__name { flex: 1 1 auto; min-width: 0; font-size: 13px; font-weight: 500; color: var(--text-primary); overflow-wrap: anywhere; }
  .pf-bka-ptest__price { flex: none; font-size: 13px; color: var(--text-primary); }
  .pf-bka-ptest__x { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border: 0; border-radius: 8px;
    background: transparent; color: var(--text-tertiary); cursor: pointer; }
  .pf-bka-ptest__x:hover { background: var(--pf-chip-bg); color: var(--text-primary); }
  .pf-bka-ptest--total { border-bottom: 0; }
  .pf-bka-ptest--total .pf-bka-ptest__name { color: var(--text-secondary); }
  .pf-bka-ptest--total .pf-bka-ptest__price { font-weight: 600; margin-right: 42px; }
  .pf-bka-coll { display: flex; width: 100%; }
  .pf-bka-coll .pf-seg__item { flex: 1 1 0; min-width: 0; height: 36px; font-size: 13px; }
  .pf-bka-coll .pf-seg__item:focus-visible, .pf-bka-periods .pf-seg__item:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 1px; }
  .pf-bka-home { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; animation: pf-fade-scale var(--pf-dur) var(--pf-spring) both; }
  .pf-bka-span { grid-column: 1 / -1; }
  .pf-bka-home .pf-field__lbl { display: inline-flex; align-items: center; gap: 6px; }
  .pf-bka-notes { min-height: 76px; }

  /* ── Phones: one column under the pinned band; the primary docks at the
     bottom, full width, above the navbar. 2-column slot chips, 44px / 16px. */
  .pf-bka-bar .pf-bka-book { flex: 1 1 auto; }
  @media (max-width: 640px) {
    .pf-bka-body { padding-bottom: calc(96px + var(--pf-nav-h, 0px)) !important; }
    .pf-bka-cancel__t { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .pf-bka-cancel { width: 44px; height: 44px; padding: 0; justify-content: center; }
    .pf-bka-bar { flex-direction: column; align-items: stretch; gap: 8px; padding: 10px; }
    .pf-bka-bar .pf-bottombar__info { font-size: 12.5px; font-weight: 500; color: var(--text-secondary); text-align: center; }
    .pf-bka-bar .pf-bka-book { width: 100%; height: 48px; min-height: 48px; font-size: 15px; }
    .pf-bka-chips { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .pf-bka-chip { min-height: 48px; }
    .pf-bka-periods .pf-seg__item, .pf-bka-coll .pf-seg__item { height: 44px; }
    .pf-bka-periods { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .pf-bka-home { grid-template-columns: minmax(0, 1fr); }
    /* Phones: a compact square-cell month, 44px targets. */
    .pf-bka-cal__weeks { flex: none; grid-template-rows: none; grid-auto-rows: 44px; gap: 2px; }
    .pf-bka-cal__row { gap: 2px; }
    .pf-bka-cal__day { min-height: 44px; }
    .pf-bka-cal__nav { width: 44px; height: 44px; }
    .pf-bka-change, .pf-bka-ptest__x { min-height: 44px; height: 44px; }
    .pf-bka-ptest__x { width: 44px; }
    .pf-bka-ptest--total .pf-bka-ptest__price { margin-right: 54px; }
    .pf-bka-notes { font-size: 16px; }
  }
  @media (pointer: coarse) {
    .pf-bka-chip, .pf-bka-result { min-height: 48px; }
    .pf-bka-ptest__x { width: 44px; height: 44px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .pf-bka-chip, .pf-bka-results--float, .pf-bka-home, .pf-bka-cal__day, .pf-bka-cal__nav, .pf-bka-cal__weeks { animation: none !important; transition: none !important; }
  }
`;
