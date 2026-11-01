import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Owner's design rule (2026-11-01): the AI connector screen has NO inner scroll — "we never use a scroll on
 * that part". jsdom can't lay a page out, so this guards the SOURCE: the page's inline template + styles may
 * not put `overflow: auto | scroll` (or a capped height) on any container, and must undo the kit's
 * `.pf-card__body { overflow-y: auto }` so a card body never becomes a scroll box. Long content goes into the
 * main card's tabs instead (real-layout proof: screenshots at 1440×900 / 1280×720 / 390×844).
 */
const DIR = resolve(process.cwd(), 'apps/lms/src/app/features/ai-connector');
const PAGE = readFileSync(resolve(DIR, 'ai-connectors-settings.page.ts'), 'utf8');

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
}

/** The inline `template:` and `styles:` blocks of the @Component. */
function section(name: 'template' | 'styles'): string {
  const start = PAGE.indexOf(`${name}: `);
  expect(start).toBeGreaterThan(-1);
  const end = name === 'template' ? PAGE.indexOf('styles: [', start) : PAGE.indexOf('export class', start);
  return stripComments(PAGE.slice(start, end));
}

const SCROLL = /overflow(-x|-y)?\s*:\s*(auto|scroll|overlay)/i;
const CAPPED = /max-height\s*:\s*(?!none)[^;]+/i;

describe('AI connector page — no inner scroll (owner design rule)', () => {
  it('the guard itself catches a scroll box and ignores comments', () => {
    expect(SCROLL.test('.x { overflow-y: auto; }')).toBe(true);
    expect(SCROLL.test('.x { overflow: scroll }')).toBe(true);
    expect(SCROLL.test('style="overflow:auto"')).toBe(true);
    expect(SCROLL.test('.x { overflow: visible; }')).toBe(false);
    expect(SCROLL.test(stripComments('/* overflow: auto */'))).toBe(false);
  });

  it('styles: no overflow auto/scroll and no capped heights on any container', () => {
    const css = section('styles');
    expect(css).not.toMatch(SCROLL);
    expect(css).not.toMatch(CAPPED);
  });

  it('template: no inline scroll styles or scroll utility classes', () => {
    const html = section('template');
    expect(html).not.toMatch(SCROLL);
    expect(html).not.toMatch(/\boverflow-(y-|x-)?(auto|scroll)\b/);   // Tailwind utilities
    expect(html).not.toMatch(/\bmax-h-/);
  });

  it('undoes the kit card body scroll (.pf-card__body is overflow-y:auto in the kit)', () => {
    expect(section('styles')).toMatch(/\.pf-aic \.pf-card__body\s*\{\s*overflow:\s*visible;\s*\}/);
  });

  it('long content lives in tabs, not one long wall: Settings / What apps see / Your apps', () => {
    const html = section('template');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tabpanel"');
    for (const t of ["@case ('settings')", "@case ('can')", "@case ('apps')"]) expect(html).toContain(t);
  });
});
