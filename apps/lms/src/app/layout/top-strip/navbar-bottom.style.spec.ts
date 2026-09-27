import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Docked BOTTOM navbar (new design, `:root.nav-bottom`) — owner's iPad
 * review: the bar was too tall, the selected work area was an off-centre
 * pinkish disc, and the dark bar swept horizontally through magenta.
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const scss = read('apps/lms/src/app/layout/top-strip/top-strip.component.scss');
const shell = read('apps/lms/src/app/layout/shell/shell.component.ts');
const global = read('apps/lms/src/styles.scss');

/** The trailing navbar block of the top-strip stylesheet. */
const navbarBlock = scss.slice(scss.indexOf('Docked BOTTOM navbar: height + selected indicator'));
const PINK = /#ec4899|#db2777|#f472b6|236,\s*72,\s*153|162,\s*25,\s*110|175,\s*34,\s*201|--pink|gradient-primary/i;

describe('Docked bottom navbar — height', () => {
  it('one content-height token, within 52–60px, and the bar is pinned to it', () => {
    const m = global.match(/--pf-navbar-h:\s*(\d+)px/);
    expect(m).not.toBeNull();
    const h = Number(m![1]);
    expect(h).toBeGreaterThanOrEqual(52);
    expect(h).toBeLessThanOrEqual(60);
    // 44px tap targets must fit inside it.
    expect(h).toBeGreaterThanOrEqual(44);
    expect(navbarBlock).toMatch(/\.pf-topstrip-bar \{[^}]*height:\s*var\(--pf-navbar-h/);
    expect(navbarBlock).toMatch(/\.pf-topstrip-bar \{[^}]*padding-top:\s*0/);
  });

  it('total bar height = content + hairline + the reserved home-indicator inset, used by the shell', () => {
    expect(global).toMatch(
      /--pf-botbar-h:\s*calc\(var\(--pf-navbar-h\) \+ 1px \+ var\(--pf-home-inset\)\)/,
    );
    expect(shell).toMatch(/padding-block:\s*calc\(var\(--pf-home-inset\) \/ 2\);/);
    expect(shell).not.toMatch(/padding-bottom:\s*70px/);
  });
});

describe('Docked bottom navbar — selected indicator', () => {
  it('is a ::before pill centred on the link (same centre as the icon)', () => {
    expect(navbarBlock).toMatch(/\.pf-topnav-link \{[^}]*position:\s*relative[^}]*justify-content:\s*center/);
    const base = navbarBlock.match(/\.pf-topnav-link::before \{([^}]*)\}/)![1];
    expect(base).toMatch(/position:\s*absolute/);
    expect(base).toMatch(/top:\s*50%/);
    expect(base).toMatch(/transform:\s*translateY\(-50%\)/);
    // Icon-only widths: the pill is centred on BOTH axes of a square link.
    expect(navbarBlock).toMatch(
      /@media \(max-width: 1279px\)[\s\S]*\.pf-topnav-link::before \{[^}]*left:\s*50%[^}]*transform:\s*translate\(-50%, -50%\)/,
    );
    expect(scss).toMatch(/\.pf-topnav-link \{\s*flex: 0 0 44px;\s*width: 44px; height: 44px;[^}]*padding: 0;/);
  });

  it('the link box itself stays transparent; the pill is neutral, never pink/magenta', () => {
    expect(navbarBlock).toMatch(/\.pf-topnav-link--on \{[^}]*background:\s*transparent[^}]*box-shadow:\s*none/);
    const onRules = [...navbarBlock.matchAll(/pf-topnav-link--on[^{]*\{([^}]*)\}/g)].map((m) => m[1]).join('\n');
    expect(onRules).not.toMatch(PINK);
    expect(onRules).not.toMatch(/rgba\(\s*(124, 58, 237|139, 92, 246|168, 85, 247)/);
    // Dark twin exists (through :host-context — a :root.dark selector is mangled).
    expect(navbarBlock).toMatch(/:host-context\(\.dark\.design-new\.nav-bottom\) \.pf-topnav-link--on::before/);
  });
});

describe('Docked bottom navbar — surface', () => {
  const darkNavbar = global.match(/:root\.dark\.design-new \{\s*--pf-navbar-bg:[\s\S]*?\n\}/)![0];

  it('dark bar is a VERTICAL gradient with no pink sweep', () => {
    expect(darkNavbar).toMatch(/--pf-navbar-wash:\s*linear-gradient\((180deg|to bottom)/);
    expect(darkNavbar).not.toMatch(/90deg/);
    expect(darkNavbar).not.toMatch(PINK);
  });

  it('the shell paints the bar from --pf-navbar-*, so the hero band keeps its own --pf-band-*', () => {
    expect(shell).toMatch(/background-color:\s*var\(--pf-navbar-bg-glass\)/);
    expect(shell).toMatch(/background-image:\s*var\(--pf-navbar-wash\)/);
    expect(shell).toMatch(/border-top-color:\s*var\(--pf-navbar-edge\)/);
    expect(shell).not.toMatch(/background-image:\s*var\(--pf-band-fade-up\), var\(--pf-band-sweep\)/);
  });
});

describe('Docked bottom navbar — one optical scale on iPad + phone (owner 2026-09-28)', () => {
  const compact = scss.slice(scss.indexOf('@media (max-width: 1279px)'));
  const px = (re: RegExp) => Number((compact.match(re) ?? [])[1]);

  it('icons 22 · pf logo 26 tall · avatar 30 — the anchors stay close to the icon size', () => {
    const icon = px(/\.pf-topnav-link svg \{ width: (\d+)px; height: \d+px; \}/);
    const logo = px(/\.pf-brand-glyph \{ width: auto; height: (\d+)px; \}/);
    const avatar = px(/\.pf-avatar-circle \{ width: (\d+)px; height: \d+px;/);
    const glyphAvatar = px(/\.pf-avatar-glyph \{\s*height: (\d+)px; width: auto;/);
    expect([icon, logo, avatar, glyphAvatar]).toEqual([22, 26, 30, 26]);
    // Nothing more than ~1.4x the icon — the logo no longer towers over the row.
    for (const v of [logo, avatar, glyphAvatar]) expect(v / icon).toBeLessThanOrEqual(1.4);
  });

  it('tap targets stay 44px', () => {
    expect(compact).toMatch(/\.pf-topnav-link \{\s*flex: 0 0 44px;\s*width: 44px; height: 44px;/);
    expect(scss).toMatch(/\.pf-avatar-btn \{\s*flex-shrink: 0; min-width: 44px; min-height: 44px;/);
  });
});
