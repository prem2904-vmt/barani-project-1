import { readFileSync } from 'node:fs';

/** Frontdesk landing at tablet widths (641–1023px) stacks the Appointments and
 *  work panes. Regression: the Appointments pane's inline `flex-basis: N%` (the
 *  DESKTOP row split) became a HEIGHT in the column, squeezing the pane below
 *  its content; with `overflow: visible` the "Open calendar" button painted over
 *  the work card's tabs. The split effect also wrote that basis onto the WORK
 *  pane whenever it rendered first (Appointments pane still hidden).
 *  Real-layout check: apps/lms-e2e/src/frontdesk-tablet-stack.rbac.spec.ts. */

const FD = 'apps/lms/src/app/features/frontdesk/frontdesk-landing';
const base = readFileSync(`${FD}/styles/_base.scss`, 'utf8');
const ts = readFileSync(`${FD}/frontdesk-landing.component.ts`, 'utf8');

const tabletBlock = (() => {
  const start = base.indexOf('@media (min-width: 641px) and (max-width: 1023px)');
  expect(start).toBeGreaterThan(-1);
  // The block ends at the first line that is a bare closing brace.
  const end = base.indexOf('\n}', start);
  return base.slice(start, end);
})();

const rule = (selector: string) => {
  const i = tabletBlock.indexOf(selector + ' {');
  expect(i, selector).toBeGreaterThan(-1);
  return tabletBlock.slice(i, tabletBlock.indexOf('}', i));
};

const APPT = '.pf-appt-split > .pf-appt-split__pane:not(.pf-appt-split__pane--work)';

describe('Frontdesk landing — tablet stack', () => {
  it('neutralises the desktop inline flex-basis in the column stack', () => {
    expect(rule('.pf-appt-split > .pf-appt-split__pane')).toMatch(/flex-basis:\s*auto\s*!important/);
  });

  it('Appointments pane sizes to content and scrolls inside its own card', () => {
    const r = rule(`${APPT}.pf-appt-split__pane--expanded`);
    expect(r).toMatch(/flex:\s*0 1 auto/);
    expect(r).toMatch(/min-height:\s*0/);
    expect(r).toMatch(/overflow-y:\s*auto/);
    // The date-filter popover still escapes while open.
    expect(rule(`${APPT}.pf-appt-split__pane--filtering`)).toMatch(/overflow:\s*visible/);
  });

  it('work pane takes the remaining height when expanded', () => {
    expect(rule('.pf-appt-split > .pf-appt-split__pane--work.pf-appt-split__pane--expanded')).toMatch(/flex:\s*1 1 auto/);
  });

  it('Appointments empty state is compact (no 200px floor, does not stretch)', () => {
    const r = rule('.pf-appt-split__pane:not(.pf-appt-split__pane--work).pf-appt-split__pane--expanded > .pf-empty-tile');
    expect(r).toMatch(/flex:\s*none/);
    expect(r).toMatch(/min-height:\s*0/);
  });

  it('the split effect / resize / drag only ever write flex-basis to the Appointments pane', () => {
    const writes = ts.match(/querySelector<HTMLElement>\('[^']*pf-appt-split__pane[^']*'\)/g) ?? [];
    expect(writes.length).toBeGreaterThanOrEqual(3);
    for (const w of writes) expect(w).toContain(':not(.pf-appt-split__pane--work)');
  });
});
