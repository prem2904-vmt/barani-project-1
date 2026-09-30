import { readFileSync } from 'node:fs';
import { signal } from '@angular/core';
import { Order } from '../../../shared/models/order.model';
import { FrontdeskLandingComponent } from './frontdesk-landing.component';
import { canBulkDispatch, createWorkSelection, workRowTone } from './work-selection';

/** Frontdesk WORK LIST rows + multi-select (ND "List rows & multi-select"):
 *  no department chips, no monospace, the FULL name, the status as a dot +
 *  coloured word (no chip), an accessible ROUND checkbox, a selection bar whose
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

  it('status is a dot + coloured word — no chip, border or background (owner)', () => {
    for (const r of rows()) {
      const st = r.querySelector('.pf-wrow__status')!;
      expect(st.classList).not.toContain('nd-chip');
      expect(st.classList).not.toContain('nd-chip--static');
      expect(st.getAttribute('data-tone') ?? st.getAttribute('[attr.data-tone]')).toBeTruthy();
      expect(st.querySelector('.pf-wrow__dot')).not.toBeNull();
    }
    expect(work).not.toMatch(/pf-statusword|orderTone\(|pf-completed-chip|text-amber/);
    const status = rule('.pf-wrow__status');
    expect(status).toMatch(/background: none/);
    expect(status).toMatch(/border: 0/);
    expect(status).toMatch(/padding: 0/);
    expect(status).toMatch(/font-weight: 500/);
    expect(status).toMatch(/font-size: 12\.5px/);
    const dot = rule('.pf-wrow__dot');
    expect(dot).toMatch(/width: 6px/);
    expect(dot).toMatch(/background: var\(--pf-tone\)/);
  });

  it('status colours are the app accent TOKENS (both themes), never hex', () => {
    expect(rule(".pf-wrow__status[data-tone='green']")).toMatch(/var\(--green-text\)/);
    expect(rule(".pf-wrow__status[data-tone='blue']")).toMatch(/var\(--blue-text\)/);
    expect(rule(".pf-wrow__status[data-tone='red']")).toMatch(/var\(--red-text\)/);
    expect(rule('.pf-wrow__status')).toMatch(/--pf-tone: var\(--amber-text\)/);
    for (const r of rules().filter(x => /pf-wrow__(status|dot)/.test(x.sel))) expect(r.body, r.sel).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('the order drawer keeps its own neutral chip (not the row status)', () => {
    expect(html).toMatch(/nd-chip nd-chip--static pf-drawer__status/);
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

  it('the checkbox is ROUND: a 20px circle (border-radius 50%), 44px hit area on touch', () => {
    const box = kit.match(/\.nd-check__box \{([^}]*)\}/)![1];
    expect(box).toMatch(/width: 20px; height: 20px; border-radius: 50%;/);
    expect(kit.match(/\.nd-check \{([^}]*)\}/)![1]).toMatch(/border-radius: 50%/);
    expect(kit).toMatch(/pointer: coarse\) \{ \.nd-check \{ width: 44px; height: 44px;/);
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

describe('work row status tone (owner mapping)', () => {
  it('Billed / completed = green, Dispatched = blue, in-lab / collected / partial = amber, stop = red', () => {
    expect(workRowTone('billed')).toBe('green');
    expect(workRowTone('delivered')).toBe('green');
    expect(workRowTone('validated')).toBe('green');
    expect(workRowTone('collected', 'Dispatched')).toBe('blue');
    expect(workRowTone('dispatched')).toBe('blue');
    expect(workRowTone('collected', 'In Lab')).toBe('amber');
    expect(workRowTone('sample_collected', 'Sample Collected')).toBe('amber');
    expect(workRowTone('partially_validated', 'Partially Ready')).toBe('amber');
    expect(workRowTone('created', 'Created')).toBe('amber');
    expect(workRowTone('cancelled')).toBe('red');
    expect(workRowTone('rejected')).toBe('red');
    expect(workRowTone('billed', 'Series in progress', true)).toBe('violet');
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
      _rightTab: signal<'ip' | 'done' | 'billing' | 'out' | null>('ip'),
      applyRightTab: proto['applyRightTab'],
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

describe('Work rows — status stacked above the action (owner: compact right column)', () => {
  it('status and action share ONE right column: status on top, action below', () => {
    const css = readFileSync('apps/lms/src/app/features/frontdesk/frontdesk-landing/styles/_work-rows.scss', 'utf8');
    expect(css).toMatch(/grid-template-areas: 'body status' 'body acts';/);
    expect(css).toMatch(/grid-template-areas: 'check body status' 'check body acts';/);
    expect(css).toMatch(/\.pf-wrow__acts:empty \{ display: none; \}/);
    expect(css).toMatch(/:has\(\.pf-wrow__acts:empty\) \.pf-wrow__status \{ grid-row: 1 \/ span 2;/);
  });
});

describe('Work rows — tinted surface in both themes (owner: "too white")', () => {
  it('rows use the theme glass fill + border and a soft shadow, not the plain card white', () => {
    const css = readFileSync('apps/lms/src/app/features/frontdesk/frontdesk-landing/styles/_work-rows.scss', 'utf8');
    const row = css.slice(css.indexOf('.pf-wrow {'), css.indexOf('}', css.indexOf('.pf-wrow {')));
    expect(row).toMatch(/background: var\(--glass-bg\)/);
    expect(row).toMatch(/border: 1px solid var\(--glass-border\)/);
    expect(row).toMatch(/box-shadow:/);
  });
});

describe('Work rows — phone layout (owner: touch-optimised)', () => {
  it('narrow rows never span the status over the name, and the phone search is full width', () => {
    const css = readFileSync('apps/lms/src/app/features/frontdesk/frontdesk-landing/styles/_work-rows.scss', 'utf8');
    const narrow = css.slice(css.indexOf('@container (max-width: 520px)'));
    expect(narrow).toMatch(/\.pf-wrow:has\(\.pf-wrow__acts:empty\) \.pf-wrow__status \{\s*grid-row: auto;/);
    expect(narrow).toMatch(/min-height: 44px/);
    const host = readFileSync('apps/lms/src/app/features/frontdesk/frontdesk-landing/frontdesk-landing.component.scss', 'utf8');
    const phone = host.slice(host.indexOf('.pf-work-find--phone {', host.indexOf('@media (max-width: 640px)')));
    expect(phone).toMatch(/max-width: none/);
  });
});
