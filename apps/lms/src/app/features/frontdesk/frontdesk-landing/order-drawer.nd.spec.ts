import { readFileSync } from 'node:fs';
import { drawerAgeSex, drawerName, drawerSampleProgress, orderStatusState } from './order-drawer';

/** Frontdesk ORDER drawer (ND): Noto only (no monospace), violet + neutral
 *  palette (no green / amber), the FULL name (no ellipsis), a sticky footer
 *  that is always visible, every action kept, at most one primary. */

const DIR = 'apps/lms/src/app/features/frontdesk/frontdesk-landing';
const html = readFileSync(`${DIR}/frontdesk-landing.component.html`, 'utf8');
const css = readFileSync(`${DIR}/styles/_drawers-modals.scss`, 'utf8').replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, ''); // comments would glue onto selectors

const between = (s: string, from: string, to: string) => {
  const a = s.indexOf(from);
  const b = s.indexOf(to, a);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return s.slice(a, b + to.length);
};
const parse = (fragment: string) => {
  const doc = new DOMParser().parseFromString(`<div id="root">${fragment}</div>`, 'text/html');
  return doc.getElementById('root') as HTMLElement;
};
/** Every rule body whose selector mentions one of the drawer's classes. */
const drawerRules = () =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(m => /\.pf-(drawer|vtl|prelim)/.test(m[1]))
    .map(m => ({ sel: m[1].trim(), body: m[2] }));
const rule = (sel: string) =>
  drawerRules().filter(r => r.sel.split(',').map(x => x.trim()).includes(sel)).map(r => r.body).join('\n');

const drawer = between(html, '<aside class="pf-drawer pf-od"', '</aside>');
const root = parse(drawer);

describe('Frontdesk order drawer — fonts and colours', () => {
  it('uses no monospace anywhere (meta line, labels, sub-lines)', () => {
    for (const r of drawerRules()) expect(r.body, r.sel).not.toMatch(/font-family:[^;]*mono/i);
    expect(drawer).not.toMatch(/font-mono|JetBrains/);
  });

  it('has no green, amber / orange or cyan tokens', () => {
    const off = /green|amber|emerald|cyan|teal|mint|#f59e0b|#5c9e86|245,\s*158,\s*11|16,\s*185,\s*129|34,\s*211,\s*238/i;
    for (const r of drawerRules()) expect(r.body, r.sel).not.toMatch(off);
    expect(drawer).not.toMatch(/tone="amber"|orderTone\(/); // status is the neutral ND chip
  });

  it('the status is a neutral ND chip with a state dot', () => {
    const chip = root.querySelector('.pf-drawer__hdr-actions .pf-chip.pf-chip--static.pf-drawer__status');
    expect(chip).not.toBeNull();
    expect(chip!.querySelector('.pf-drawer__status-dot')).not.toBeNull();
  });

  it('timeline: violet done / violet ring current / neutral pending, pulse off under reduced motion', () => {
    expect(rule(".pf-vtl__row[data-state='done'] .pf-vtl__node")).toMatch(/--color-violet-600/);
    expect(rule(".pf-vtl__row[data-state='active'] .pf-vtl__node")).toMatch(/border: 2px solid var\(--color-violet-600/);
    expect(rule('.pf-vtl__node')).toMatch(/width: var\(--pf-vtl-marker\)/);
    expect(css).toMatch(/--pf-vtl-marker: 24px/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[^@]*\.pf-vtl__row\[data-state='active'\] \.pf-vtl__node \{\s*animation: none/);
    expect(rule('.pf-vtl__status')).toMatch(/color: var\(--text-tertiary\)/);
  });
});

describe('Frontdesk order drawer — header', () => {
  it('shows the FULL name (drawerName), never formatPatient / an ellipsis', () => {
    const name = root.querySelector('.pf-drawer__hdr-name')!;
    expect(name.textContent).toMatch(/drawerName\(so\.patient\)/);
    expect(drawer).not.toMatch(/formatPatient\(/);
    expect(drawer).not.toMatch(/class="[^"]*(truncate|ellipsis|line-clamp)/);
    const body = rule('.pf-drawer__hdr-name');
    expect(body).not.toMatch(/text-overflow: ellipsis|white-space: nowrap/);
    expect(body).toMatch(/white-space: normal/);
  });

  // PR #70 (2026-09-28): MRN + Order # left the header meta line; age/sex stays.
  it('age/sex ride the quiet meta line (no "|" separators)', () => {
    const meta = root.querySelector('.pf-drawer__hdr-meta.pf-num')!;
    expect(meta.textContent).toMatch(/drawerAgeSex/);
    const literal = meta.textContent!.replace(/\{\{[\s\S]*?\}\}|@if \([^)]*\)/g, '');
    expect(literal).not.toMatch(/\|/); // no "Name | 22/M | MRN" joins
  });

  it('avatar · text · status + close sit on one grid; no gradient hairline', () => {
    expect(rule('.pf-drawer__hdr')).toMatch(/grid-template-columns: auto minmax\(0, 1fr\) auto/);
    expect(css).not.toMatch(/\.pf-drawer__hdr::after/);
    expect(rule('.pf-drawer__hdr')).toMatch(/border-bottom: 1px solid var\(--pf-line\)/);
  });

  it('empty doctor stays a muted em dash', () => {
    const dd = [...root.querySelectorAll('.pf-drawer__meta dd')];
    expect(dd).toHaveLength(4);
    expect(dd[3].getAttribute('[class.pf-drawer__none]')).toBe('!so.refDoctorName');
    expect(rule('.pf-drawer__meta dd.pf-drawer__none')).toMatch(/color: var\(--text-muted\)/);
  });
});

describe('Frontdesk order drawer — footer actions', () => {
  const footer = root.querySelector('footer.pf-drawer__actions') as HTMLElement;
  const buttons = [...footer.querySelectorAll('button')];

  it('is the drawer\'s own sticky footer, clear of the docked navbar, with safe-area padding', () => {
    expect(footer.parentElement!.matches('aside.pf-drawer')).toBe(true);
    expect(footer.previousElementSibling!.classList).toContain('pf-drawer__body');
    const f = rule('.pf-drawer__actions');
    expect(f).toMatch(/position: sticky/);
    expect(f).toMatch(/flex-shrink: 0/);
    expect(f).toMatch(/env\(safe-area-inset-bottom/);
    expect(rule('.pf-drawer')).toMatch(/bottom: var\(--pf-nav-h/);
    expect(rule('.pf-drawer__body')).toMatch(/min-height: 0/);
  });

  it('keeps every action and its handler', () => {
    const acts = buttons.map(b => [b.getAttribute('aria-label'), b.getAttribute('(click)')]);
    expect(acts).toEqual([
      ['Patient profile', 'openPatientProfile(so)'],
      ['Repeat order', 'repeatOrder(so)'],
      ['View invoice', 'viewInvoice(so)'],
      ['Modify order', 'modifyOrder(so)'],
      ['Download report', 'downloadReport(so)'],
      ['Reprint labels', 'reprintLabels(so)'],
      ['Cancel order', 'openCancel(so)'],
    ]);
    // Each has a visible text label (web) and an icon (touch).
    for (const b of buttons) {
      expect(b.querySelector('.pf-drawer__act-t')?.textContent?.trim()).toBeTruthy();
      expect(b.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it('shows icons with labels on web and icons only on touch', () => {
    expect(footer.getAttribute('[class.pf-drawer__actions--touch]')).toBe('!webPointer()');
    expect(rule('.pf-drawer__actions .pf-drawer__act > svg')).toMatch(/display: block/);
    expect(rule('.pf-drawer__actions--touch .pf-drawer__act-t')).toMatch(/clip: rect/);
    expect(rule('.pf-drawer__actions--touch .pf-drawer__act')).toMatch(/min-height: 44px/);
  });

  it('keeps the sample count visible and reveals IDs/status from an accessible accordion', () => {
    expect(drawer).toMatch(/step\.label === 'Sample'/);
    expect(drawer).toMatch(/class="pf-vtl__sample-toggle"/);
    expect(drawer).toMatch(/\[attr\.aria-expanded\]="sampleIdsOpen\(\)"/);
    expect(drawer).toMatch(/sampleSummary\(so\)/);
    expect(drawer).toMatch(/sample\.barcode \|\| sample\.id/);
    expect(drawer).toMatch(/sampleProgress\(sample\)/);
    expect(rule('.pf-vtl__samples')).toMatch(/grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    expect(rule('.pf-vtl__samples')).toMatch(/max-height: 130px/);
    expect(rule('.pf-vtl__sample-toggle')).toMatch(/display: inline-flex/);
    expect(rule('.pf-vtl__sample-toggle')).toMatch(/justify-content: flex-start/);
    expect(drawer).toMatch(/toggleSampleIds\(\)/);
  });

  it('at most one primary; cancel is danger-secondary, not a filled red circle', () => {
    expect(footer.querySelectorAll('.pf-btn--primary').length).toBeLessThanOrEqual(1);
    const cancel = buttons.find(b => b.getAttribute('aria-label') === 'Cancel order')!;
    expect(cancel.classList).toContain('pf-btn--danger');
    expect(cancel.classList).not.toContain('pf-btn--primary');
    for (const b of buttons.filter(x => x !== cancel)) expect(b.classList).toContain('pf-btn--secondary');
    expect(drawer).not.toMatch(/pf-actbtn/);
  });
});

describe('order-drawer helpers', () => {
  it('drawerName is the full display name', () => {
    const p = { firstName: 'Sasi', fathersName: 'Kumar', displayName: 'Master Sasi Kumar Ramanathan' };
    expect(drawerName(p)).toBe('Master Sasi Kumar Ramanathan');
    expect(drawerName({ firstName: 'Sasi', fathersName: 'Kumar', displayName: '' })).toBe('Sasi Kumar');
    expect(drawerName(null)).toBe('Patient');
  });

  it('drawerAgeSex is "22/M", blank when both are unknown', () => {
    expect(drawerAgeSex({ firstName: 'a', fathersName: 'b', displayName: 'x', age: 22, sex: 'male' })).toBe('22/M');
    expect(drawerAgeSex({ firstName: 'a', fathersName: 'b', displayName: 'x', sex: 'Female' })).toBe('—/F');
    expect(drawerAgeSex({ firstName: 'a', fathersName: 'b', displayName: 'x' })).toBe('');
    expect(drawerAgeSex(undefined)).toBe('');
  });

  it('orderStatusState maps statuses to the chip dot', () => {
    expect(orderStatusState({ status: 'received' })).toBe('active');
    expect(orderStatusState({ status: 'validated' })).toBe('done');
    expect(orderStatusState({ status: 'created' })).toBe('idle');
    expect(orderStatusState({ status: 'cancelled' })).toBe('stopped');
  });

  it('sample progress distinguishes pending, drawn, and rejected tubes', () => {
    expect(drawerSampleProgress({ status: 'pending' })).toBe('pending');
    expect(drawerSampleProgress({ status: 'collected' })).toBe('collected');
    expect(drawerSampleProgress({ status: 'rejected' })).toBe('not-collected');
  });
});

describe('Order drawer — top space, Cancel order, full-width rows (owner 2026-09-26)', () => {
  it('uses :host-context, never :root (Angular scopes :root so it never matches)', () => {
    expect(css).not.toMatch(/:root/);
    expect(rule(':host-context(.nav-bottom) .pf-drawer')).toMatch(/top:\s*12px/);
  });

  it('labels the destructive action "Cancel order"', () => {
    expect(html).toMatch(/<span class="pf-drawer__act-t">Cancel order<\/span>/);
  });

  it('web actions wrap in rows that stretch to fill the width; touch icons stay 44px', () => {
    expect(rule('.pf-drawer__actions')).toMatch(/display:\s*flex/);
    expect(rule('.pf-drawer__actions')).toMatch(/flex-wrap:\s*wrap/);
    expect(rule('.pf-drawer__actions .pf-drawer__act')).toMatch(/flex:\s*1 1/);
    expect(rule('.pf-drawer__actions--touch .pf-drawer__act')).toMatch(/flex:\s*none/);
  });
});
