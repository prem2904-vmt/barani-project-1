import { readFileSync } from 'node:fs';
import { signal } from '@angular/core';
import { Order } from '../../../shared/models/order.model';
import { FrontdeskLandingComponent } from './frontdesk-landing.component';
import { canBulkDispatch, createWorkSelection } from './work-selection';

/** Frontdesk WORK LIST rows + multi-select (ND "List rows & multi-select"):
 *  no department chips, no monospace, the FULL name, a neutral status chip
 *  (no amber / green words), an accessible checkbox, a selection bar whose
 *  count always equals the highlighted rows, at most one primary. */

const DIR = 'apps/lms/src/app/features/frontdesk/frontdesk-landing';
const html = readFileSync(`${DIR}/frontdesk-landing.component.html`, 'utf8');
const css = readFileSync(`${DIR}/styles/_work-rows.scss`, 'utf8').replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const kit = readFileSync('apps/lms/src/app/shared/styles/_nd-kit.scss', 'utf8');

const between = (s: string, from: string, to: string) => {
  const a = s.indexOf(from);
  const b = s.indexOf(to, a);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return s.slice(a, b);
};
const parse = (fragment: string) => {
  const doc = new DOMParser().parseFromString(`<div id="root">${fragment}</div>`, 'text/html');
  return doc.getElementById('root') as HTMLElement;
};
const rules = () => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] }));
const rule = (sel: string) =>
  rules().filter(r => r.sel.split(',').map(x => x.trim()).includes(sel)).map(r => r.body).join('\n');

// The whole right-card list region: selection bar → In progress → Completed → Payments due.
const work = between(html, '<!-- WORK LIST ROWS', '</section>');
const root = parse(work);
const rows = () => [...root.querySelectorAll<HTMLElement>('.pf-wrow')];

type Row = Pick<Order, 'id' | 'paymentHold' | 'samples'>;
const row = (id: string, ...statuses: string[]): Row =>
  ({ id, paymentHold: false, samples: statuses.map((status, i) => ({ id: `${id}-${i}`, status })) } as unknown as Row);

describe('Frontdesk work rows — anatomy', () => {
  it('has no department code chips (BIO / MIC / MOL) or their dots in any tab', () => {
    expect(work).not.toMatch(/pf-card__dept|pf-card__dot|deptPillLabel|department\?\.code/);
    expect(rows().length).toBe(4); // draft, in progress, completed, payments due
  });

  it('uses no monospace (template or row styles)', () => {
    expect(work).not.toMatch(/font-mono|JetBrains|monospace/);
    for (const r of rules()) expect(r.body, r.sel).not.toMatch(/font-family:[^;]*mono/i);
  });

  it('shows the FULL name (drawerName), never formatPatient / an ellipsis', () => {
    for (const r of rows()) {
      expect(r.querySelector('.pf-wrow__name')!.textContent).toMatch(/drawerName\(/);
    }
    expect(work).not.toMatch(/formatPatient\(/);
    expect(work).not.toMatch(/class="[^"]*(truncate|line-clamp)/);
    const name = rule('.pf-wrow__name');
    expect(name).toMatch(/white-space: normal/);
    expect(name).not.toMatch(/text-overflow: ellipsis|white-space: nowrap/);
  });

  it('meta is one quiet tabular line with no "|" joins', () => {
    for (const r of rows()) {
      const meta = r.querySelector('.pf-wrow__meta')!;
      expect(meta.classList).toContain('nd-num');
      const literal = meta.textContent!.replace(/\{\{[\s\S]*?\}\}|@if \([^)]*\)/g, '');
      expect(literal).not.toMatch(/\|/);
    }
    expect(rule('.pf-wrow__mi + .pf-wrow__mi::before')).toMatch(/content: '·'/);
  });

  it('status is the neutral ND chip with a state dot — no amber / green words', () => {
    for (const r of rows()) {
      const chip = r.querySelector('.pf-wrow__status')!;
      expect(chip.classList).toContain('nd-chip');
      expect(chip.classList).toContain('nd-chip--static');
      expect(chip.querySelector('.pf-wrow__dot')).not.toBeNull();
    }
    expect(work).not.toMatch(/pf-statusword|data-tone|orderTone\(|pf-completed-chip|text-amber/);
    const off = /amber|green|emerald|lime|#65a30d|#d4ae05|#facc15|#a3e635|#10b981|#f59e0b/i;
    for (const r of rules().filter(x => /pf-wrow__(status|dot)/.test(x.sel))) expect(r.body, r.sel).not.toMatch(off);
    expect(rule(".pf-wrow__status[data-state='idle'] .pf-wrow__dot")).toMatch(/background: transparent/);
  });

  it('row actions are the kit secondary .nd-rowact (text on web, icon + label on touch)', () => {
    const acts = [...root.querySelectorAll<HTMLElement>('.pf-wrow__acts > button, .pf-wrow__acts .pf-share-wrapper > button')];
    expect(acts.length).toBeGreaterThan(5);
    for (const b of acts) {
      expect(b.classList).toContain('nd-rowact');
      expect(b.getAttribute('[class.nd-rowact--icon]')).toBe('!webPointer()');
      expect(b.getAttribute('aria-label')).toBeTruthy();
      expect(b.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      expect(b.querySelector('.nd-rowact__t')).not.toBeNull();
    }
    expect(work).not.toMatch(/pf-ghostbtn/);
    expect(rule('.pf-wrow__acts')).toMatch(/justify-content: flex-end/);
  });
});

describe('Frontdesk work rows — selection', () => {
  const ip = () => root.querySelector<HTMLElement>('ul[data-list="ip"] .pf-wrow')!;

  it('the checkbox is an accessible ND checkbox: role, aria-checked, "Select <name>"', () => {
    const cb = ip().querySelector<HTMLElement>('button.nd-check')!;
    expect(cb.getAttribute('role')).toBe('checkbox');
    expect(cb.getAttribute('type')).toBe('button'); // Space / Enter toggle natively
    expect(cb.getAttribute('[attr.aria-checked]')).toBe('workSel.isSelected(o.id)');
    expect(cb.getAttribute('[attr.aria-label]')).toBe("'Select ' + drawerName(o.patient)");
    expect(kit).toMatch(/\.nd-check\[aria-checked='true'\] \.nd-check__box \{ background: var\(--color-violet-600/);
    expect(kit).toMatch(/\.nd-check:focus-visible \.nd-check__box \{ outline: 2px solid/);
  });

  it('highlight, checkbox and bar count all read the SAME model (the count bug)', () => {
    expect(ip().getAttribute('[class.pf-wrow--sel]')).toBe('workSel.isSelected(o.id)');
    const bar = root.querySelector('.pf-selbar')!;
    expect(bar.querySelector('.pf-selbar__count')!.textContent).toMatch(/workSel\.count\(\) \}\} selected/);
    // The old split: rows tinted from the raw selectedIds() set, bar counted dispatchableSelected().
    expect(work).not.toMatch(/selectedIds\(\)|dispatchableSelected|toggleSelect\(/);
  });

  it('checkboxes only on the In progress list, only on rows that can take the bulk actions', () => {
    const boxes = [...root.querySelectorAll('.nd-check')];
    expect(boxes).toHaveLength(1);
    expect(boxes[0].closest('ul')!.getAttribute('data-list')).toBe('ip');
    expect(work).toMatch(/@if \(workSel\.isSelectable\(o\.id\)\)/);
    expect(root.querySelector('ul[data-list="done"] .nd-check, ul[data-list="due"] .nd-check')).toBeNull();
  });

  it('selected tint is a subtle violet + 1px violet border, no gradient', () => {
    const sel = rule('.pf-wrow.pf-wrow--sel');
    expect(sel).toMatch(/color-mix\(in srgb, var\(--color-violet-600, #7c3aed\) 7%/);
    expect(sel).toMatch(/border-color: var\(--color-violet-600/);
    expect(css).not.toMatch(/gradient/);
  });

  it('the bar has at most ONE primary, "N selected" in plain Noto, and a labelled ×', () => {
    const bar = root.querySelector('.pf-selbar')!;
    expect(bar.querySelectorAll('.nd-btn--primary')).toHaveLength(1);
    expect(bar.querySelector('.nd-btn--primary')!.textContent).toMatch(/Bundle as package · QR/);
    const mark = [...bar.querySelectorAll('.nd-btn')].find(b => /Mark dispatched/.test(b.textContent!))!;
    expect(mark.classList).toContain('nd-btn--secondary');
    expect(bar.querySelector('.pf-selbar__x')!.getAttribute('aria-label')).toBe('Clear selection');
    const count = rule('.pf-selbar__count');
    expect(count).not.toMatch(/uppercase|letter-spacing/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[^@]*\.pf-selbar \{ animation: none/);
  });
});

describe('work-selection model', () => {
  it('REGRESSION: count always equals the highlighted rows (ineligible ticks are ignored)', () => {
    const list = signal<Row[]>([row('a', 'collected'), row('b', 'received'), row('c', 'pending')]);
    const sel = createWorkSelection(list);
    for (const id of ['a', 'b', 'c']) sel.toggle(id);
    const highlighted = list().filter(o => sel.isSelected(o.id)).length;
    expect(sel.count()).toBe(1);
    expect(highlighted).toBe(sel.count());
  });

  it('a row leaving the list stops counting AND stops being highlighted', () => {
    const list = signal<Row[]>([row('a', 'collected'), row('b', 'collected'), row('c', 'collected')]);
    const sel = createWorkSelection(list);
    sel.selectAll();
    expect(sel.count()).toBe(3);
    list.set([row('a', 'collected'), row('c', 'collected')]);
    expect(sel.count()).toBe(2);
    expect(sel.isSelected('b')).toBe(false);
    expect(sel.ids()).toEqual(['a', 'c']);
  });

  it('shift-click selects a range of eligible rows; clear empties it', () => {
    const list = signal<Row[]>([row('a', 'collected'), row('x', 'pending'), row('b', 'collected'), row('c', 'collected')]);
    const sel = createWorkSelection(list);
    sel.toggle('a');
    sel.toggle('c', true);
    expect(sel.ids()).toEqual(['a', 'b', 'c']);
    expect(sel.allSelected()).toBe(true);
    sel.clear();
    expect(sel.count()).toBe(0);
  });

  it('payment-held orders and orders with nothing collected are not selectable', () => {
    expect(canBulkDispatch(row('a', 'collected'))).toBe(true);
    expect(canBulkDispatch({ ...row('a', 'collected'), paymentHold: true } as Row)).toBe(false);
    expect(canBulkDispatch(row('a', 'pending', 'received'))).toBe(false);
  });
});

describe('Frontdesk selection clears on Esc, tab switch and search change', () => {
  const proto = FrontdeskLandingComponent.prototype as unknown as Record<string, (...a: unknown[]) => void>;
  const harness = () => {
    const list = signal<Row[]>([row('a', 'collected'), row('b', 'collected')]);
    const workSel = createWorkSelection(list);
    workSel.selectAll();
    const none = () => null;
    return {
      workSel,
      _rightTab: signal<'ip' | 'done' | 'billing' | 'out'>('ip'),
      workQuery: signal(''),
      refreshDrafts: () => undefined,
      selectedOrder: none, activePackage: none, selectedHc: none, selectedBill: none,
    };
  };

  it('Esc clears (when no drawer is open)', () => {
    const h = harness();
    proto['onEscClearSelection'].call(h);
    expect(h.workSel.count()).toBe(0);
  });

  it('Esc leaves the selection alone while a drawer is open (Esc closes the drawer)', () => {
    const h = { ...harness(), selectedOrder: () => ({ id: 'a' }) };
    proto['onEscClearSelection'].call(h);
    expect(h.workSel.count()).toBe(2);
  });

  it('switching tabs clears', () => {
    const h = harness();
    proto['setRightTab'].call(h, 'done');
    expect(h.workSel.count()).toBe(0);
  });

  it('changing the search clears', () => {
    const h = harness();
    proto['setWorkQuery'].call(h, 'sasi');
    expect(h.workSel.count()).toBe(0);
    expect(h.workQuery()).toBe('sasi');
  });
});
