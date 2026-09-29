import { Appointment } from '../../../shared/models/appointment.model';
import { patientDisplayName } from '../../../shared/models/patient.model';
import { phoneMatches } from '../../../shared/utils/indian-phone';

/**
 * Appointments calendar — NEW DESIGN helpers + styles (ND-PATTERN §21).
 * Everything is scoped under `.pf-apc`, which only renders in the new
 * design, so the classic calendar is untouched.
 */

/** One hour on the ND time grid: a half-hour slot is tall enough for a
 *  neutral card with the FULL name, the meta line and the status word. */
export const ND_HOUR = 128;

export type ApptTone = 'green' | 'amber' | 'red' | 'violet' | 'neutral';

/** List status = a dot + a coloured word (the Frontdesk rows' language). */
export function apptStatusTone(status: string): ApptTone {
  switch (status) {
    case 'completed': return 'green';
    case 'checked_in':
    case 'in_progress': return 'amber';
    case 'cancelled':
    case 'no_show': return 'red';
    case 'skipped': return 'neutral';
    default: return 'violet';          // booked
  }
}
export function apptStatusWord(status: string): string {
  const w: Record<string, string> = {
    booked: 'Booked', checked_in: 'Checked in', in_progress: 'In progress', completed: 'Completed',
    cancelled: 'Cancelled', no_show: 'No-show', skipped: 'Skipped',
  };
  return w[status] ?? (status ? status[0].toUpperCase() + status.slice(1).replace(/_/g, ' ') : 'Booked');
}
export function apptTypeWord(type: string): string {
  const w: Record<string, string> = {
    appointment: 'Appointment', walkin: 'Walk-in', followup: 'Follow-up', urgent: 'Urgent', emergency: 'Emergency',
  };
  return w[type] ?? (type ? type[0].toUpperCase() + type.slice(1) : 'Appointment');
}

/** The pill's search: case-insensitive name / MRN substring, or the phone —
 *  a full number matches on its last 10 digits whatever the format, a
 *  partial one (3+ digits) as a substring (indian-phone.ts). */
export function matchesAppointment(a: Appointment, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const p = a.patient;
  if (!p) return false;
  if (patientDisplayName(p).toLowerCase().includes(q)) return true;
  if ((p.mrn ?? '').toLowerCase().includes(q)) return true;
  return phoneMatches(p.phone, q);
}

export interface NdPlaced { appt: Appointment; top: number; left: number; width: number; }

/** Place a day's appointments on the ND grid: top in px from the start
 *  time; appointments sharing a start split the column side by side. */
export function placeLanes(list: Appointment[], start: (a: Appointment) => Date | null): NdPlaced[] {
  const groups = new Map<number, Appointment[]>();
  for (const a of list) {
    const d = start(a);
    const m = d ? d.getHours() * 60 + d.getMinutes() : 0;
    const g = groups.get(m) ?? [];
    g.push(a);
    groups.set(m, g);
  }
  const out: NdPlaced[] = [];
  for (const [m, g] of groups) {
    const w = 100 / g.length;
    g.forEach((a, i) => out.push({ appt: a, top: (m / 60) * ND_HOUR, left: i * w, width: w }));
  }
  return out;
}

export const APPOINTMENTS_CALENDAR_ND_STYLES = `
  /* ── Pill: search field + the view switch + date navigation ── */
  .pf-apc-search { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 10px; height: 100%; cursor: text; }
  .pf-apc-search__glass { flex: none; color: var(--text-tertiary); }
  .pf-apc-search__input {
    flex: 1 1 auto; min-width: 0; height: 40px; border: 0; outline: 0; background: transparent;
    font: inherit; font-size: 15px; color: var(--text-primary);
  }
  .pf-apc-search__input::placeholder { color: var(--text-muted); }
  .pf-apc-search__clear {
    flex: none; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px;
    border: 0; border-radius: 8px; background: transparent; color: var(--text-tertiary); cursor: pointer;
  }
  .pf-apc-search__clear:hover { background: var(--nd-chip-bg); color: var(--text-primary); }
  .pf-apc-tools { display: flex; align-items: center; gap: 10px; flex: none; }
  .pf-apc-views .nd-seg__item { height: 32px; min-width: 64px; font-size: 13px; }
  .pf-apc-views .nd-seg__item:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 1px; }
  .pf-apc-nav { position: relative; display: inline-flex; align-items: center; gap: 2px; }
  .pf-apc-nav__btn, .pf-apc-nav__today {
    display: inline-flex; align-items: center; justify-content: center; height: 34px; min-width: 34px;
    border: 0; border-radius: 8px; background: transparent; color: var(--text-secondary);
    font: inherit; font-size: 13px; font-weight: 500; cursor: pointer;
    transition: background var(--nd-dur-fast) ease, color var(--nd-dur-fast) ease;
  }
  .pf-apc-nav__today { padding: 0 10px; border: 1px solid var(--nd-line); margin: 0 2px; }
  .pf-apc-nav__btn:hover, .pf-apc-nav__today:hover { background: var(--nd-chip-bg); color: var(--text-primary); }
  .pf-apc-nav__btn:focus-visible, .pf-apc-nav__today:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 1px; }
  .pf-apc-jump__native { position: absolute; right: 0; bottom: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; border: 0; padding: 0; }

  /* ── Body: CALENDAR (main) + DAY (the right companion, 400px) ── */
  .pf-apc-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; padding-bottom: 12px; }
  .pf-apc-panels {
    flex: 1 1 auto; min-height: 0;
    display: grid; grid-template-columns: minmax(0, 1fr) 400px; grid-template-rows: minmax(0, 1fr); gap: 16px;
    transition: grid-template-columns var(--nd-dur) var(--nd-spring);
  }
  .pf-apc-panels--collapsed { grid-template-columns: minmax(0, 1fr) 52px; }
  @media (max-width: 1280px) { .pf-apc-panels { grid-template-columns: minmax(0, 1fr) 360px; } .pf-apc-panels--collapsed { grid-template-columns: minmax(0, 1fr) 52px; } }
  .pf-apc-panels--narrow, .pf-apc-panels--narrow.pf-apc-panels--collapsed { grid-template-columns: minmax(0, 1fr); }
  .pf-apc-main, .pf-apc-side, .pf-apc-strip { min-height: 0; }
  .pf-apc-side, .pf-apc-strip { animation: pf-apc-side-in var(--nd-dur) var(--nd-spring) both; }
  @keyframes pf-apc-side-in { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: none; } }
  .pf-apc-range { font-size: 13px; font-weight: 500; color: var(--text-primary); font-variant-numeric: tabular-nums; }
  .pf-apc-count { font-size: 12.5px; font-weight: 500; color: var(--text-tertiary); white-space: nowrap; }
  .pf-apc-collapse { width: 32px !important; height: 32px; min-height: 32px; }
  .pf-apc-canvas { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }

  /* Collapsed DAY: a slim strip on the RIGHT edge, one expand target. */
  .pf-apc-strip__btn {
    flex: 1 1 auto; width: 100%; display: flex; flex-direction: column; align-items: center; gap: 12px;
    padding: 10px 0 14px; border: 0; background: transparent; cursor: pointer; color: var(--text-secondary); font: inherit;
  }
  .pf-apc-strip__btn:hover .pf-apc-strip__expand { border-color: var(--nd-sel-border); color: var(--text-primary); }
  .pf-apc-strip__btn:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: -2px; }
  .pf-apc-strip__expand { width: 32px !important; height: 32px; min-height: 32px; pointer-events: none; }
  .pf-apc-strip__label { writing-mode: vertical-rl; font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-secondary); }
  .pf-apc-strip__n { font-size: 12px; font-weight: 500; color: var(--text-tertiary); }

  /* ── Day / Week grid: one scroller; day headers + the hour rail stick ── */
  .pf-apc-time {
    --rail: 60px;
    flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; position: relative;
    display: grid; grid-template-columns: var(--rail) repeat(var(--cols, 7), minmax(0, 1fr));
    grid-template-rows: auto calc(var(--hour) * 24);
  }
  .pf-apc-time__corner, .pf-apc-dayhdr { position: sticky; top: 0; z-index: 4; background: var(--nd-card-bg); border-bottom: 1px solid var(--nd-line); }
  .pf-apc-time__corner { left: 0; z-index: 5; }
  .pf-apc-dayhdr {
    display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 4px;
    border: 0; border-left: 1px solid var(--nd-line); border-bottom: 1px solid var(--nd-line);
    font: inherit; color: var(--text-secondary); cursor: pointer;
  }
  .pf-apc-dayhdr:hover .pf-apc-dayhdr__n { background: var(--nd-chip-bg); }
  .pf-apc-dayhdr:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: -2px; }
  .pf-apc-dayhdr__dow { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; color: var(--text-tertiary); }
  .pf-apc-dayhdr__n {
    display: inline-flex; align-items: center; justify-content: center; min-width: 30px; height: 30px; padding: 0 4px;
    border-radius: 999px; font-size: 15px; font-weight: 600; color: var(--text-primary);
  }
  /* Today, subtly: violet text on a light violet disc — never a gradient. */
  .pf-apc-dayhdr--today .pf-apc-dayhdr__dow { color: var(--violet-text, #7c3aed); }
  .pf-apc-dayhdr--today .pf-apc-dayhdr__n { color: var(--violet-text, #7c3aed); background: color-mix(in srgb, var(--color-primary, #7c3aed) 12%, transparent); }
  .pf-apc-dayhdr--past .pf-apc-dayhdr__n { color: var(--text-tertiary); }
  .pf-apc-rail { position: sticky; left: 0; z-index: 3; background: var(--nd-card-bg); border-right: 1px solid var(--nd-line); }
  .pf-apc-rail__h { position: absolute; right: 8px; transform: translateY(-50%); font-size: 11px; color: var(--text-tertiary); }
  .pf-apc-rail__h:first-child { transform: none; top: 4px !important; }
  .pf-apc-col { position: relative; border-left: 1px solid var(--nd-line); }
  .pf-apc-col--today { background: color-mix(in srgb, var(--color-primary, #7c3aed) 3%, transparent); }
  .pf-apc-slot {
    position: absolute; left: 0; right: 0; height: calc(var(--hour) / 2); padding: 0 8px;
    display: flex; align-items: flex-start; justify-content: flex-end;
    border: 0; border-top: 1px solid var(--nd-line); background: transparent; cursor: pointer; font: inherit;
  }
  .pf-apc-slot--half { border-top-style: dashed; border-top-color: color-mix(in srgb, var(--nd-line) 70%, transparent); }
  .pf-apc-slot__hint { margin-top: 6px; font-size: 11.5px; font-weight: 500; color: var(--text-tertiary); opacity: 0; transition: opacity var(--nd-dur-fast) ease; }
  .pf-apc-slot:hover { background: var(--nd-chip-bg); }
  .pf-apc-slot:hover .pf-apc-slot__hint, .pf-apc-slot:focus-visible .pf-apc-slot__hint { opacity: 1; }
  .pf-apc-slot:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: -2px; }
  .pf-apc-slot[aria-disabled='true'] { cursor: not-allowed; background: color-mix(in srgb, var(--text-primary) 2.5%, transparent); }
  .pf-apc-slot[aria-disabled='true']:hover { background: color-mix(in srgb, var(--text-primary) 2.5%, transparent); }
  .pf-apc-slot[aria-disabled='true'] .pf-apc-slot__hint { display: none; }

  /* The appointment card: neutral, the FULL name, a quiet meta, the status. */
  .pf-apc-ev {
    position: absolute; z-index: 2; box-sizing: border-box; min-height: calc(var(--hour) / 2 - 4px);
    margin-top: 2px; padding: 6px 8px 7px;
    display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left;
    border-radius: 8px; border: 1px solid var(--nd-line); background: var(--nd-card-bg); box-shadow: var(--nd-shadow-sm);
    font: inherit; color: var(--text-primary); cursor: pointer;
    transition: border-color var(--nd-dur-fast) ease, box-shadow var(--nd-dur-fast) ease;
  }
  .pf-apc-ev:hover { z-index: 3; border-color: var(--nd-sel-border); }
  .pf-apc-ev:focus-visible { z-index: 3; outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 1px; }
  .pf-apc-ev[aria-pressed='true'] { z-index: 3; border-color: var(--color-violet-600, #7c3aed); background: color-mix(in srgb, var(--color-primary, #7c3aed) 7%, var(--nd-card-bg)); }
  .pf-apc-ev__name { font-size: 13px; font-weight: 600; line-height: 1.3; overflow-wrap: break-word; max-width: 100%; }
  .pf-apc-ev__meta { font-size: 11.5px; line-height: 1.35; color: var(--text-tertiary); overflow-wrap: break-word; max-width: 100%; }
  /* Week + a shared start: the lane is narrow — the FULL name (wrapping by
     word) and the status dot; the meta and the word ride in the label /
     tooltip and the DAY list. */
  .pf-apc-ev--tight { padding: 5px 6px; }
  .pf-apc-ev--tight .pf-apc-ev__meta, .pf-apc-ev--tight .pf-apc-status__w { display: none; }
  .pf-apc-ev--tight .pf-apc-ev__name { font-size: 12px; }
  .pf-apc-ev .pf-apc-status { font-size: 11.5px; }

  /* Now: a thin violet line + time chip on today's column. */
  .pf-apc-now { position: absolute; left: 0; right: 0; z-index: 2; height: 0; border-top: 1.5px solid var(--color-violet-600, #7c3aed); pointer-events: none; }
  .pf-apc-now::before { content: ''; position: absolute; left: -4px; top: -4.5px; width: 7px; height: 7px; border-radius: 999px; background: var(--color-violet-600, #7c3aed); }
  .pf-apc-now__t {
    position: absolute; right: 4px; top: -10px; padding: 1px 6px; border-radius: 6px;
    background: var(--nd-card-bg); border: 1px solid color-mix(in srgb, var(--color-primary, #7c3aed) 40%, transparent);
    font-size: 10.5px; font-weight: 600; color: var(--violet-text, #7c3aed);
  }

  /* ── Month ── */
  .pf-apc-month { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
  .pf-apc-month__dows { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border-bottom: 1px solid var(--nd-line); }
  .pf-apc-month__dows span { padding: 8px 10px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); }
  .pf-apc-month__grid { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); grid-auto-rows: minmax(92px, 1fr); }
  .pf-apc-mcell {
    display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 8px; min-width: 0;
    border-right: 1px solid var(--nd-line); border-bottom: 1px solid var(--nd-line); cursor: pointer;
    transition: background var(--nd-dur-fast) ease;
  }
  .pf-apc-mcell:nth-child(7n) { border-right: 0; }
  .pf-apc-mcell:hover { background: var(--nd-chip-bg); }
  .pf-apc-mcell:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: -2px; }
  .pf-apc-mcell__n {
    display: inline-flex; align-items: center; justify-content: center; min-width: 26px; height: 26px; padding: 0 4px;
    border-radius: 999px; font-size: 13px; font-weight: 600; color: var(--text-primary);
  }
  .pf-apc-mcell--out .pf-apc-mcell__n { color: var(--text-muted); font-weight: 500; }
  .pf-apc-mcell--past { background: color-mix(in srgb, var(--text-primary) 2%, transparent); cursor: not-allowed; }
  .pf-apc-mcell--past .pf-apc-mcell__n { color: var(--text-tertiary); }
  .pf-apc-mcell--today .pf-apc-mcell__n { color: var(--violet-text, #7c3aed); background: color-mix(in srgb, var(--color-primary, #7c3aed) 12%, transparent); }
  .pf-apc-mcell__chip { height: 28px; max-width: 100%; }
  .pf-apc-mcell__chip .nd-num { font-weight: 600; color: var(--text-primary); }

  /* ── DAY card: week strip + one row per appointment ── */
  .pf-apc-strip7 { flex: none; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; padding: 10px 14px; border-bottom: 1px solid var(--nd-line); }
  .pf-apc-strip7__day {
    display: flex; flex-direction: column; align-items: center; gap: 2px; min-height: 48px; padding: 6px 0;
    border-radius: 10px; border: 1px solid transparent; background: transparent; font: inherit; color: var(--text-secondary); cursor: pointer;
  }
  .pf-apc-strip7__day:hover { background: var(--nd-chip-bg); }
  .pf-apc-strip7__day:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 1px; }
  .pf-apc-strip7__day[aria-pressed='true'] { background: var(--nd-sel-bg); border-color: var(--nd-sel-border); color: var(--text-primary); }
  .pf-apc-strip7__dow { font-size: 10.5px; font-weight: 600; letter-spacing: 0.06em; color: var(--text-tertiary); }
  .pf-apc-strip7__n { font-size: 14px; font-weight: 600; color: var(--text-primary); }
  .pf-apc-strip7__day--past .pf-apc-strip7__n { color: var(--text-tertiary); }
  .pf-apc-strip7__day--today .pf-apc-strip7__dow, .pf-apc-strip7__day--today .pf-apc-strip7__n { color: var(--violet-text, #7c3aed); }
  .pf-apc-list { gap: 8px; }
  .pf-apc-row {
    display: flex; align-items: center; gap: 12px; width: 100%; min-height: 60px; padding: 10px 12px; box-sizing: border-box;
    border-radius: var(--nd-radius-sm); border: 1px solid var(--nd-line); background: var(--nd-card-bg);
    font: inherit; color: inherit; text-align: left; cursor: pointer;
    transition: border-color var(--nd-dur-fast) ease, background var(--nd-dur-fast) ease;
    animation: nd-fade-scale var(--nd-dur) var(--nd-spring) both; animation-delay: calc(var(--i, 0) * 18ms);
  }
  .pf-apc-row:hover { border-color: var(--nd-sel-border); }
  .pf-apc-row:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
  .pf-apc-row__who { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .pf-apc-row__name { font-size: 14px; font-weight: 600; line-height: 1.3; color: var(--text-primary); overflow-wrap: anywhere; }
  .pf-apc-row__meta { font-size: 12.5px; line-height: 1.4; color: var(--text-secondary); }
  .pf-apc-empty { flex: 1 1 auto; }

  /* Status = a 7px dot + a coloured word; no chip, border or background. */
  .pf-apc-status {
    --pf-tone: var(--violet-text, #7c3aed);
    flex: none; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
    font-size: 12.5px; font-weight: 500; line-height: 16px;
    color: color-mix(in srgb, var(--pf-tone) 70%, var(--text-primary));
  }
  .pf-apc-status[data-tone='green'] { --pf-tone: var(--green-text); }
  .pf-apc-status[data-tone='amber'] { --pf-tone: var(--amber-text); }
  .pf-apc-status[data-tone='red'] { --pf-tone: var(--red-text); }
  .pf-apc-status[data-tone='neutral'] { --pf-tone: var(--text-tertiary); }
  .pf-apc-status__dot { flex: none; width: 7px; height: 7px; border-radius: 999px; background: var(--pf-tone); }

  /* ── Detail (side card / sheet) ── */
  .pf-apc-dbody { gap: 14px; }
  .pf-apc-subject { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding-bottom: 12px; border-bottom: 1px solid var(--nd-line); }
  .pf-apc-subject__name { margin: 0; font-size: 17px; font-weight: 600; line-height: 1.3; color: var(--text-primary); overflow-wrap: anywhere; }
  .pf-apc-subject__meta { margin: 0; font-size: 13px; color: var(--text-secondary); }
  .pf-apc-facts { margin: 0; display: flex; flex-direction: column; gap: 10px; }
  .pf-apc-facts > div { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 10px; }
  .pf-apc-facts dt { font-size: 12px; color: var(--text-tertiary); }
  .pf-apc-facts dd { margin: 0; font-size: 13px; font-weight: 500; color: var(--text-primary); overflow-wrap: anywhere; white-space: pre-line; }
  .pf-apc-resched { display: flex; flex-direction: column; gap: 14px; }
  .pf-apc-resched pf-nd-date { display: block; }
  .pf-apc-acts .nd-btn { height: 40px; min-height: 40px; }
  /* Step → step: Reschedule slides in from the right, Back from the left. */
  .pf-apc-step--fwd { animation: pf-apc-slide-fwd var(--nd-dur) var(--nd-spring) both; }
  .pf-apc-step--back { animation: pf-apc-slide-back var(--nd-dur) var(--nd-spring) both; }
  @keyframes pf-apc-slide-fwd { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: none; } }
  @keyframes pf-apc-slide-back { from { opacity: 0; transform: translateX(-24px); } to { opacity: 1; transform: none; } }

  /* ≤900px (tablet): the detail is a side sheet from the right edge. */
  @media (min-width: 641px) and (max-width: 900px) {
    .pf-apc-scrim { display: block; position: fixed; top: 0; left: 0; right: 0; bottom: var(--nd-nav-h); z-index: 79; background: rgba(0, 0, 0, 0.35); }
    .pf-apc-sheet {
      position: fixed; top: 12px; right: 12px; bottom: calc(var(--nd-nav-h) + 12px); z-index: 80; width: min(420px, calc(100vw - 24px));
      animation: pf-apc-side-in var(--nd-dur-sheet) var(--nd-spring) both;
    }
  }

  /* ── Phones (≤640px): day list first, 44px targets, 16px inputs ── */
  @media (max-width: 640px) {
    .pf-apc-search__input { font-size: 16px; }
    /* Two calm rows under the search: the switch, then ‹ Today › · jump. */
    .pf-apc-tools { flex: 1 1 100%; width: 100%; min-width: 0; flex-wrap: wrap; gap: 6px; }
    .pf-apc-views { flex: 1 1 100%; }
    .pf-apc-views .nd-seg__item { flex: 1 1 0; min-width: 0; height: 40px; }
    .pf-apc-nav { flex: 1 1 100%; justify-content: space-between; gap: 6px; }
    .pf-apc-nav__today { flex: 1 1 auto; }
    .pf-apc-nav__btn, .pf-apc-nav__today, .pf-apc-search__clear { height: 44px; min-width: 44px; }
    .pf-apc-dayhdr { height: auto !important; min-height: 58px; }
    .pf-apc-body { padding-bottom: 8px; }
    .pf-apc-strip7 { padding: 8px 10px; gap: 2px; }
    .pf-apc-strip7__day { min-height: 52px; }
    .pf-apc-range { font-size: 12.5px; }
    .pf-apc-time { --rail: 44px; grid-template-columns: var(--rail) repeat(var(--cols, 7), minmax(150px, 1fr)); }
    .pf-apc-rail__h { right: 4px; font-size: 10.5px; }
    .pf-apc-month__grid { grid-auto-rows: minmax(64px, 1fr); }
    .pf-apc-mcell { padding: 4px; gap: 4px; }
    .pf-apc-mcell__word { display: none; }
    .pf-apc-mcell__chip { height: 26px; padding: 0 8px; }
    .pf-apc-collapse, .pf-apc-acts .nd-btn { width: auto; min-height: 44px; height: 44px; }
    .pf-apc-collapse { width: 44px !important; }
    .pf-apc-foot .nd-btn { height: 48px; min-height: 48px; font-size: 15px; }
    .pf-apc-sheet { border-radius: 20px 20px 0 0; }
  }
  @media (pointer: coarse) {
    .pf-apc-row { min-height: 64px; }
    .pf-apc-strip7__day { min-height: 52px; }
    .pf-apc-ev { min-height: 44px; }
    .pf-apc-mcell__chip { min-height: 32px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .pf-apc-side, .pf-apc-strip, .pf-apc-row, .pf-apc-step--fwd, .pf-apc-step--back, .pf-apc-sheet { animation: none !important; }
    .pf-apc-panels, .pf-apc-slot__hint, .pf-apc-ev, .pf-apc-row, .pf-apc-mcell, .pf-apc-nav__btn, .pf-apc-nav__today { transition: none !important; }
  }
`;
