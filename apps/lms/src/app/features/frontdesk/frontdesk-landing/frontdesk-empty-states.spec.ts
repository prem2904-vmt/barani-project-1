import { readFileSync } from 'node:fs';

/** Frontdesk empty states follow the ND pattern (owner: "still in old icon,
 *  fix it"): the kit's .nd-empty — violet icon tile with a STROKED 1.8 SVG,
 *  a title, a one-line body and, when there is one, a SECONDARY action. No
 *  amber / orange / green tints, no filled glyphs, no coloured pills. */

const FD = 'apps/lms/src/app/features/frontdesk';
const html = readFileSync(`${FD}/frontdesk-landing/frontdesk-landing.component.html`, 'utf8');
const cards = readFileSync(`${FD}/frontdesk-landing/styles/_cards.scss`, 'utf8');
const mobile = readFileSync(`${FD}/frontdesk-landing/styles/_mobile.scss`, 'utf8');
const kit = readFileSync('apps/lms/src/app/shared/styles/_nd-kit.scss', 'utf8');
const outsourced = readFileSync(`${FD}/outsourced/outsourced-list.component.ts`, 'utf8');
const postPay = readFileSync(`${FD}/post-payment/post-payment.component.html`, 'utf8');
const postPayScss = readFileSync(`${FD}/post-payment/post-payment.component.scss`, 'utf8');

const AMBER = /amber|245,\s*158,\s*11|217,\s*119,\s*6|#f59e0b|#d97706|#fcd34d|#b45309|orange|#f97316|16,\s*185,\s*129|5,\s*150,\s*105|#10b981|#059669|#6ee7b7|emerald|green-text/i;

const parse = (fragment: string) => {
  const doc = new DOMParser().parseFromString(`<div id="root">${fragment}</div>`, 'text/html');
  return doc.getElementById('root') as HTMLElement;
};
const root = parse(html);
const tiles = () => [...root.querySelectorAll<HTMLElement>('[data-empty]')];

describe('Frontdesk landing — ND empty states', () => {
  it('every tab empty state is the kit\'s nd-empty (appointments, home, in progress, completed, payments due)', () => {
    expect(tiles().map(t => t.dataset['empty']).sort()).toEqual(['all', 'appt', 'done', 'due', 'home', 'ip']);
    for (const t of tiles()) {
      expect(t.classList).toContain('nd-empty');
      expect(t.querySelector('.nd-empty__icon svg')).not.toBeNull();
      expect(t.querySelector('.nd-empty__title')?.textContent?.trim()).toBeTruthy();
      expect(t.getAttribute('style')).toBeNull();
      expect(t.querySelector('[style]')).toBeNull();
    }
  });

  it('icons are stroked SVG at 1.8 — no fills, no emoji', () => {
    for (const t of tiles()) {
      const svg = t.querySelector('.nd-empty__icon svg')!;
      expect(svg.getAttribute('fill')).toBe('none');
      expect(svg.getAttribute('stroke-width')).toBe('1.8');
      expect(svg.querySelector('[fill]:not([fill="none"])')).toBeNull();
      expect(t.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('"All caught up" uses a clipboard icon (not a tube) and a one-line body', () => {
    const ip = root.querySelector('[data-empty="ip"]')!;
    expect(ip.querySelector('.nd-empty__title')?.textContent?.trim()).toBe('All caught up');
    expect(ip.querySelector('.nd-empty__body')?.textContent?.trim()).toBe('No orders in progress for this range.');
    expect(ip.querySelector('rect[width="8"][height="4"]')).not.toBeNull(); // clipboard clip
  });

  it('actions are the ND SECONDARY button — the band keeps the one primary', () => {
    const actions = tiles().flatMap(t => [...t.querySelectorAll('a, button')]);
    expect(actions.length).toBe(2); // Open calendar, New patient
    for (const a of actions) {
      expect(a.classList).toContain('nd-btn');
      expect(a.classList).toContain('nd-btn--secondary');
      expect(a.classList).not.toContain('nd-btn--primary');
    }
  });

  it('no amber / orange / green in the empty markup or its styles; old hue modifiers gone', () => {
    for (const t of tiles()) expect(t.outerHTML).not.toMatch(AMBER);
    const rule = cards.slice(cards.indexOf('.pf-empty-tile {'), cards.indexOf('.pf-cards {'));
    expect(rule).not.toMatch(AMBER);
    expect(cards + mobile + html).not.toMatch(/pf-empty-tile(__|--)/);
  });

  it('queue drawers use the compact ND empty state, not bare text', () => {
    expect(html).not.toMatch(/<p class="pf-empty">/);
    expect(root.querySelectorAll('.nd-empty.nd-empty--compact').length).toBe(2);
  });
});

describe('Frontdesk landing — phone list tabs', () => {
  it('icons are the stroked 1.8 set; In progress is a clipboard, not the old tube glyph', () => {
    const tabs = [...root.querySelectorAll<HTMLElement>('.pf-mtabs .pf-mtab')];
    expect(tabs.length).toBeGreaterThan(4);
    for (const t of tabs) expect(t.querySelector('svg')?.getAttribute('stroke-width')).toBe('1.8');
    expect(html).not.toMatch(/M9 4h6l1 4-4 5-4-5z/);
    const ip = tabs.find(t => t.getAttribute('aria-label') === 'In progress')!;
    expect(ip.querySelector('rect[width="8"][height="4"]')).not.toBeNull();
  });
});

describe('ND kit — empty state', () => {
  it('defines nd-empty in the kit, violet-only', () => {
    const block = kit.slice(kit.indexOf('/* ── Empty state'), kit.indexOf('/* ── Neutral selected states'));
    expect(block).toMatch(/\.nd-empty \{/);
    expect(block).toMatch(/\.nd-empty__icon \{[^}]*--color-primary/);
    expect(block).not.toMatch(AMBER);
  });
});

describe('Frontdesk — other empty / success marks', () => {
  it('outsourced list empty state is nd-empty', () => {
    const r = parse(outsourced.slice(outsourced.indexOf('template: `') + 11, outsourced.indexOf('`,\n  styles')));
    const e = r.querySelector('[data-empty="out"]')!;
    expect(e.classList).toContain('nd-empty');
    expect(e.querySelector('.nd-empty__icon svg')?.getAttribute('stroke-width')).toBe('1.8');
  });

  it('post-payment paid mark is the violet tile — no green disc or pulsing ring', () => {
    expect(postPay).toMatch(/pf-pp-pay__check nd-empty__icon/);
    expect(postPay).not.toMatch(/pf-pp-pay__ring|#10b981/);
    expect(postPayScss).not.toMatch(/pf-pp-pay__ring|linear-gradient\(135deg, #10b981/);
  });
});
