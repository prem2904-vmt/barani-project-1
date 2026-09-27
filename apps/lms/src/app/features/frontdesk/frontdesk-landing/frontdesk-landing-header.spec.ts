import { readFileSync } from 'node:fs';
import { Order } from '../../../shared/models/order.model';
import { Patient } from '../../../shared/models/patient.model';
import { filterOrdersByWorkQuery, orderMatchesWorkQuery, patientMatchesWorkQuery } from './work-search';

/** Frontdesk landing (new design): the band pill is search + cart + scan on
 *  every tab (no outsourced filter bar), the work card's header is ONE row —
 *  search first, then the tab filter — and the counts are plain tabular
 *  numbers, never monospace. */

const DIR = 'apps/lms/src/app/features/frontdesk/frontdesk-landing';
const html = readFileSync(`${DIR}/frontdesk-landing.component.html`, 'utf8');
const scss = readFileSync(`${DIR}/frontdesk-landing.component.scss`, 'utf8');
const cards = readFileSync(`${DIR}/styles/_cards.scss`, 'utf8');
const mobile = readFileSync(`${DIR}/styles/_mobile.scss`, 'utf8');

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

const patient = (o: Partial<Patient> = {}): Patient => ({
  id: 'p1', tenantId: 't', firstName: 'Paravai', fathersName: 'Munusamy', displayName: 'Ms. Paravai Munusamy',
  phone: '9876543210', mrn: 'DEL-2609-000001-3', isMinor: false, abhaVerified: false, ...o,
} as Patient);
const order = (o: Partial<Order> = {}): Order => ({
  id: 'o1', orderNumber: 'LAB-2609-000001', patientId: 'p1', branchId: 'b', priority: 'Normal', source: 'walk_in',
  status: 'collected', collectionType: 'walk_in', createdAt: '2026-09-26T04:00:00Z', patient: patient(),
  samples: [{ id: 's1', orderId: 'o1', departmentId: 'd', status: 'collected', barcode: 'MW-000123', rejectionCount: 0,
    createdAt: '2026-09-26T04:00:00Z', tests: [{ id: 't1', subOrderId: 'x', testId: 'x', name: 'Vitamin D', status: 'pending' }] }],
  ...o,
} as Order);

describe('Frontdesk landing — band pill', () => {
  const band = between(html, '<pf-hero-band', '</pf-hero-band>');

  it('has no outsourced status filter or partner-lab select in the band', () => {
    expect(band).not.toMatch(/<pf-segmented/);
    expect(band).not.toMatch(/<pf-select/);
    expect(band).not.toMatch(/<[^>]*\sband-tools[\s>]/);
    expect(band).not.toMatch(/partner lab/i);
    expect(band).not.toMatch(/rightTab\(\)/); // identical on every tab
  });

  it('keeps just search + cart + scan in the pill', () => {
    const root = parse(band);
    expect(root.querySelector('[band-search] pf-patient-search')).not.toBeNull();
    const inline = root.querySelector('[band-inline]') as HTMLElement;
    expect(inline.querySelector('[aria-label="Create order"]')).not.toBeNull();
    expect(inline.querySelector('[aria-label="Scan QR code"]')).not.toBeNull();
  });
});

describe('Frontdesk landing — work card header', () => {
  const hdr = parse(between(html, '<header class="pf-appt-split__hdr pf-appt-split__hdr--tabs pf-work-hdr"', '</header>'));
  const row = hdr.querySelector('header.pf-work-hdr') as HTMLElement;

  it('is one row: the search first, then the tab filter', () => {
    const kids = [...row.children];
    expect(kids[0].matches('label.pf-work-find')).toBe(true);
    expect(kids[1].matches('.pf-work-hdr__filter')).toBe(true);
    const input = kids[0].querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('type')).toBe('search');
    expect(input.classList).toContain('nd-input');
    expect(kids[0].querySelector('svg')).not.toBeNull(); // icon, no emoji
    const tabs = [...kids[1].querySelectorAll('[role="tab"]')].map(b => b.textContent?.replace(/\s+/g, ' ').trim());
    expect(tabs.map(t => t?.replace(/[{}].*$/, '').trim())).toEqual(['In progress', 'Completed', 'Payments due', 'Outsourced']);
  });

  it('no bespoke outsourced search inside the card body', () => {
    expect(html).not.toMatch(/Search patient, order, sample, test/);
    expect(readFileSync('apps/lms/src/app/features/frontdesk/outsourced/outsourced-list.component.ts', 'utf8'))
      .not.toMatch(/Search patient, order, sample, test/);
  });

  it('phones: the same search stacks full width above the list switcher', () => {
    const wrap = between(html, '<div class="pf-list-wrap">', '<div class="pf-mtabs"');
    expect(wrap).toMatch(/pf-work-find pf-work-find--phone/);
    expect(scss).toMatch(/\.pf-work-find--phone \.pf-work-find__input \{[^}]*min-height: 44px[^}]*font-size: 16px/);
  });

  it('the filter scrolls inside its own container, never overflowing the card', () => {
    expect(scss).toMatch(/\.pf-work-hdr__filter \{[^}]*min-width: 0;[^}]*overflow-x: auto/);
  });

  it('selected tabs / date pills are neutral (no violet) in the new design', () => {
    const block = between(scss, '/* ══ Card-header filters', '/* ══ Work card header');
    expect(block).toMatch(/\.pf-tabs__btn--on[\s\S]*color: var\(--text-primary\)/);
    expect(block).not.toMatch(/#7c3aed|#8749ee|#c4b5fd|139, 92, 246|gradient-primary/i);
  });
});

describe('Frontdesk landing — counts', () => {
  const rules = (css: string, sel: string) =>
    [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m => m[1].includes(sel)).map(m => m[2]);

  it('tab counts are never monospace (Noto Sans, tabular)', () => {
    for (const sel of ['.pf-tabs__count', '.pf-mtab__count']) {
      for (const body of [...rules(scss, sel), ...rules(cards, sel), ...rules(mobile, sel)]) {
        expect(body).not.toMatch(/font-family:[^;]*mono/i);
      }
    }
    expect(rules(cards, '.pf-tabs__count').join('')).toMatch(/font-variant-numeric: tabular-nums/);
    expect(rules(scss, '.pf-tabs__count').join('')).toMatch(/font-family: inherit;[^}]*tabular-nums/);
  });
});

describe('work-search — the header search filters rows', () => {
  const a = order();
  const b = order({ id: 'o2', orderNumber: 'LAB-2609-000002', patient: patient({ id: 'p2', displayName: 'Mr. Arun Kumar', firstName: 'Arun', fathersName: 'Kumar', phone: '9000011111', mrn: 'DEL-2609-000002-1' }),
    samples: [{ id: 's2', orderId: 'o2', departmentId: 'd', status: 'collected', barcode: 'MW-000999', rejectionCount: 0,
      createdAt: '2026-09-26T04:00:00Z', tests: [{ id: 't2', subOrderId: 'x', testId: 'y', name: 'Lipid Profile', status: 'pending' }] }] });

  it('empty query keeps everything', () => {
    expect(filterOrdersByWorkQuery([a, b], '  ')).toEqual([a, b]);
  });
  it('matches patient name, phone, MRN, order, sample ID and test, case-insensitively', () => {
    expect(filterOrdersByWorkQuery([a, b], 'arun')).toEqual([b]);
    expect(filterOrdersByWorkQuery([a, b], '98765')).toEqual([a]);
    expect(filterOrdersByWorkQuery([a, b], '000002-1')).toEqual([b]);
    expect(filterOrdersByWorkQuery([a, b], 'lab-2609-000001')).toEqual([a]);
    expect(filterOrdersByWorkQuery([a, b], 'mw-000999')).toEqual([b]);
    expect(filterOrdersByWorkQuery([a, b], 'VITAMIN')).toEqual([a]);
    expect(orderMatchesWorkQuery(a, 'nothing-like-this')).toBe(false);
  });
  it('drafts match on the patient', () => {
    expect(patientMatchesWorkQuery(patient(), 'paravai')).toBe(true);
    expect(patientMatchesWorkQuery(patient(), 'arun')).toBe(false);
    expect(patientMatchesWorkQuery(undefined, '')).toBe(true);
  });
});

describe('Frontdesk landing — phone band bleed (no top-corner gap)', () => {
  // The global styles.scss phone rule pads every .pf-page by max(12px, safe-area).
  // Stacked under the header's own padding, it left the band 10px short of the
  // screen edge. Contract: the section's gutter is zeroed on phones and the
  // header + body gutter IS --pf-hb-bleed at every breakpoint.
  const phone = (s: string) => {
    const blocks = s.split('@media (max-width: 640px)').slice(1);
    expect(blocks.length).toBeGreaterThan(0);
    return blocks.join('\n');
  };

  it('defines the bleed on .pf-page (shared by header + body) at 1 / 2 / 2.5rem', () => {
    expect(scss).toMatch(/\.pf-page\s*\{\s*--pf-hb-bleed:\s*1rem;/);
    expect(scss).toMatch(/min-width:\s*768px\)\s*\{\s*\.pf-page\s*\{\s*--pf-hb-bleed:\s*2rem;/);
    expect(scss).toMatch(/min-width:\s*1024px\)\s*\{\s*\.pf-page\s*\{\s*--pf-hb-bleed:\s*2\.5rem;/);
    // …and the Tailwind gutters on header + body are exactly those values.
    expect(html).toMatch(/class="pf-page__header px-4 md:px-8 lg:px-10\b/);
    expect(html).toMatch(/class="pf-page__body px-4 md:px-8 lg:px-10\b/);
  });

  it('zeroes the global .pf-page phone gutter so the band reaches the screen edge', () => {
    const block = phone(scss);
    expect(block).toMatch(/\.pf-page\s*\{[^}]*padding-left:\s*0\s*!important/);
    expect(block).toMatch(/\.pf-page\s*\{[^}]*padding-right:\s*0\s*!important/);
    // Landscape notch still respected (the global rule's safe-area max()).
    expect(block).toMatch(/--pf-hb-bleed:\s*max\(1rem,\s*env\(safe-area-inset-left/);
  });

  it('phone header + body side padding equals --pf-hb-bleed (never a fixed px)', () => {
    const block = phone(mobile);
    const rule = between(block, '.pf-page__header,\n  .pf-page__body {', '}');
    expect(rule).toMatch(/padding-left:\s*var\(--pf-hb-bleed\)\s*!important/);
    expect(rule).toMatch(/padding-right:\s*var\(--pf-hb-bleed\)\s*!important/);
    expect(rule).not.toMatch(/padding-(left|right):\s*\d+px/);
  });
});
