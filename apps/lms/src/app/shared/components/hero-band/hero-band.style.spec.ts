import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Hero band surface (new design). Owner: in DARK the band should read like
 * the docked navbar — near-black at the screen edge easing to the brand's
 * pinkish shade (the fuchsia end of the primary gradient, owner 2026-09-27)
 * toward the content — never the old horizontal sweep. Light
 * stays exactly as it was.
 */
const global = readFileSync(resolve(process.cwd(), 'apps/lms/src/styles.scss'), 'utf8');
const band = readFileSync(resolve(process.cwd(), 'apps/lms/src/app/shared/components/hero-band/hero-band.component.ts'), 'utf8');

const PINK = /#ec4899|#db2777|#f472b6|236,\s*72,\s*153|162,\s*25,\s*110|175,\s*34,\s*201|173,\s*75,\s*201|125,\s*28,\s*182|--pink|gradient-primary/i;
const block = (re: RegExp) => global.match(re)![0];

describe('Hero band — dark surface', () => {
  const dark = block(/:root\.dark\.design-new \{\s*\/\*[^]*?--pf-band-bg:[\s\S]*?\n\}/);
  const darkNavbar = block(/:root\.dark\.design-new \{\s*--pf-navbar-bg:[\s\S]*?\n\}/);

  it('the band sweep is VERTICAL (to bottom / 180deg), not the old 90deg sweep', () => {
    expect(dark).toMatch(/--pf-band-sweep:\s*linear-gradient\((180deg|to bottom)/);
    expect(dark).not.toMatch(/90deg/);
  });

  it('carries no magenta / pink stop', () => {
    expect(dark).not.toMatch(PINK);
  });

  it('runs dark at the top edge into the violet shade at the bottom — the navbar mirrored', () => {
    expect(dark).toMatch(/--pf-band-sweep:\s*linear-gradient\(180deg,\s*var\(--pf-dark-shade-base\) 0%,[\s\S]*?var\(--pf-dark-shade\) 100%\)/);
    expect(darkNavbar).toMatch(/--pf-navbar-wash:\s*linear-gradient\(180deg,\s*var\(--pf-navbar-shade\) 0%,[\s\S]*?var\(--pf-dark-shade-base\) 100%\)/);
    // Owner: band = brand pink, navbar = its own violet.
    expect(darkNavbar).toMatch(/--pf-navbar-shade:\s*rgba\(92, 64, 160,/);
    expect(dark).toMatch(/--pf-band-bg:\s*var\(--pf-dark-surface\)/);
    expect(darkNavbar).toMatch(/--pf-navbar-bg:\s*var\(--pf-dark-surface\)/);
  });

  it('the shared shade is the brand fuchsia (#c026d3 family) and the base is the page dark base (#0a0a15)', () => {
    expect(dark).toMatch(/--pf-dark-shade:\s*rgba\(168, 42, 184,/);
    expect(dark).toMatch(/--pf-dark-shade-base:\s*rgba\(10, 10, 21,/);
    expect(global).toMatch(/--bg-primary:\s*#0a0a15/);
  });

  it('keeps the subtle bottom hairline in dark', () => {
    expect(dark).toMatch(/--pf-band-edge:\s*rgba\(/);
    expect(band).toMatch(/:host-context\(\.dark\) \.pf-hb__band[\s\S]*?border-bottom:\s*1px solid var\(--pf-band-edge\)/);
  });
});

describe('Dark glow — band bottom edge, paired faintly on the navbar top edge', () => {
  const dark = block(/:root\.dark\.design-new \{\s*\/\*[^]*?--pf-band-bg:[\s\S]*?\n\}/);
  const darkNavbar = block(/:root\.dark\.design-new \{\s*--pf-navbar-bg:[\s\S]*?\n\}/);
  const shell = readFileSync(resolve(process.cwd(), 'apps/lms/src/app/layout/shell/shell.component.ts'), 'utf8');
  const glow = (css: string, name: string) => {
    const m = css.match(new RegExp(`--${name}:\\s*0 (-?\\d+)px (\\d+)px (-?\\d+)px rgba\\((?:192, 38, 211|92, 64, 160), (0\\.\\d+)\\);`));
    expect(m).not.toBeNull();
    return { y: +m![1], blur: +m![2], alpha: +m![4] };
  };

  it('the band glow is a feathered brand-pink bloom BELOW the edge at low alpha (0.18–0.28)', () => {
    const g = glow(dark, 'pf-band-glow');
    expect(g.y).toBeGreaterThan(0);
    expect(g.blur).toBeGreaterThanOrEqual(24);
    expect(g.alpha).toBeGreaterThanOrEqual(0.18);
    expect(g.alpha).toBeLessThanOrEqual(0.28);
    expect(dark).not.toMatch(PINK);
  });

  it('is a box-shadow on the band in dark only — paints under the pill, never hit-tests', () => {
    expect(band).toMatch(/:host-context\(\[data-theme='dark'\]\) \.pf-hb__band \{[^}]*box-shadow:\s*var\(--pf-band-glow, none\)/);
    // Not in the base (light) band rule.
    const base = band.match(/\n\s*\.pf-hb__band \{[^}]*\}/)![0];
    expect(base).not.toMatch(/box-shadow/);
  });

  it('the navbar top-edge glow rises UP and stays subtler than the band', () => {
    const b = glow(dark, 'pf-band-glow');
    const n = glow(darkNavbar, 'pf-navbar-glow');
    expect(n.y).toBeLessThan(0);
    expect(n.alpha).toBeLessThan(b.alpha);
    expect(shell).toMatch(/:host-context\(\.dark\.design-new\.nav-bottom\) \.pf-chrome \{[^}]*box-shadow:\s*var\(--pf-navbar-glow, none\)/);
  });
});

describe('Hero band — light surface is unchanged', () => {
  const light = block(/:root\.design-new \{\s*--pf-band-bg: #ffffff;[\s\S]*?\n\}/);

  it('keeps the white base and the mild horizontal violet wash', () => {
    expect(light).toMatch(/--pf-band-bg: #ffffff;/);
    expect(light).toContain(`--pf-band-sweep: linear-gradient(90deg,
    rgba(125, 28, 182, 0.18) 0%, rgba(173, 75, 201, 0.18) 37%,
    rgba(175, 34, 201, 0.18) 68%, rgba(162, 25, 110, 0.18) 100%);`);
    expect(light).toMatch(/--pf-band-edge: rgba\(124, 58, 237, 0\.10\);/);
    expect(light).toMatch(/--pf-band-bg-glass: rgba\(255, 255, 255, 0\.72\);/);
    expect(light).not.toMatch(/--pf-dark-shade|--pf-band-glow/);
  });

  it('the band component still paints from --pf-band-*', () => {
    expect(band).toMatch(/background-color:\s*var\(--pf-band-bg, #ffffff\)/);
    expect(band).toMatch(/background-image:\s*var\(--pf-band-fade\), var\(--pf-band-sweep\)/);
  });
});
