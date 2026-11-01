import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Bottom-nav clearance: anything pinned to the viewport bottom clears the app
 * nav from the shell's MEASURED footprint (--pf-nav-h, safe area included;
 * nav-insets.ts) — never a guessed offset (owner bug 2026-11-01: at 1440×900
 * the Validate bar sat at bottom:1rem, UNDER the docked bottom bar, so
 * Validate / Reject could not be clicked).
 */
const APP = resolve(process.cwd(), 'apps/lms/src/app');
const read = (p: string) => readFileSync(resolve(APP, p), 'utf8');
const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Innermost `selector { body }` blocks (no nested braces); `sel` is the
 *  selector's last line (an inline `styles: [\`` prefix is dropped). */
function blocks(src: string): Array<{ sel: string; body: string }> {
  const out: Array<{ sel: string; body: string }> = [];
  for (const m of noComments(src).matchAll(/([^{};]*)\{([^{}]*)\}/g)) {
    out.push({ sel: m[1].trim().split('\n').pop()!.trim(), body: m[2] });
  }
  return out;
}
const bottomOf = (body: string) => body.match(/(?<![-\w])bottom:\s*([^;}]+)/)?.[1].trim() ?? null;

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|scss)$/.test(name) && !name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/** Offsets that come from the shell's nav measurement / tokens. */
const NAV_AWARE = /--pf-nav-h|--pf-botbar-h|--pf-nav-clear|--pf-keys-h/;
/** The docked bottom bar (.pf-chrome under nav-bottom) paints at z-index 40;
 *  a fixed element below that is hidden by it wherever they overlap. */
const DOCKED_BAR_Z = 40;

describe('Validate verdict bar clears the bottom nav', () => {
  const src = read('features/pathologist/validate-result/validate-result.component.ts');
  const bars = blocks(src).filter(b => /(^|[\s,])\.pf-stickybar$/.test(b.sel) && bottomOf(b.body));

  it('floats above the measured nav and right of an iPad rail', () => {
    expect(bars.length).toBe(1);
    expect(bars[0].body).toMatch(/position:\s*fixed/);
    expect(bottomOf(bars[0].body)).toMatch(/^calc\(var\(--pf-nav-h, 0px\) \+ 16px\)$/);
    expect(bars[0].body).toMatch(/left:\s*var\(--pf-nav-left, 0px\)/);
  });

  it('no breakpoint puts it back on a guessed offset (the old desktop bottom:1rem)', () => {
    expect(noComments(src)).not.toMatch(/\.pf-stickybar\s*\{[^}]*bottom:\s*1rem/);
    expect(noComments(src)).not.toMatch(/desktop-only\s*\{\s*\.pf-stickybar/);
  });
});

describe('Shell banners clear the bottom nav', () => {
  it('update + bridge-nearby banners sit above --pf-nav-h (never on the docked bar)', () => {
    for (const [p, sel] of [
      ['shared/components/update-banner/update-banner.component.ts', '.pf-update-banner'],
      ['shared/components/bridge-nearby-banner/bridge-nearby-banner.component.ts', '.pf-bnb'],
    ] as const) {
      const b = blocks(read(p)).find(x => x.sel === sel && /position:\s*fixed/.test(x.body));
      expect(b, p).toBeDefined();
      expect(bottomOf(b!.body), p).toMatch(/var\(--pf-nav-h, 0px\) \+ 16px/);
    }
  });

  it('nothing reads the non-existent --nd-nav-h', () => {
    const hits = files(APP).filter(f => /--nd-nav-h/.test(noComments(readFileSync(f, 'utf8'))));
    expect(hits.map(f => relative(APP, f))).toEqual([]);
  });
});

describe('Guard: fixed bottom bars below the docked bar use the nav measurement', () => {
  // Reviewed exceptions — offset clears every nav (pill 72–90px, docked bar
  // 57px + safe area) and the element is not an action bar.
  const ALLOWED = new Set([
    'features/frontdesk/frontdesk-landing/styles/_widgets.scss .pf-staff-fab',
  ]);

  it('every position:fixed element with a non-zero bottom and z-index < 40 clears the nav by --pf-nav-h', () => {
    const bad: string[] = [];
    for (const f of files(APP)) {
      for (const b of blocks(readFileSync(f, 'utf8'))) {
        if (!/position:\s*fixed/.test(b.body)) continue;
        const bottom = bottomOf(b.body);
        if (!bottom || /^0(px)?(\s*!important)?$/.test(bottom) || bottom.startsWith('calc(-1')) continue;
        const z = Number(b.body.match(/z-index:\s*(\d+)/)?.[1] ?? 0);
        if (z >= DOCKED_BAR_Z || NAV_AWARE.test(bottom)) continue;
        const key = `${relative(APP, f)} ${b.sel}`;
        if (!ALLOWED.has(key)) bad.push(`${key} → bottom: ${bottom} (z ${z})`);
      }
    }
    expect(bad).toEqual([]);
  });
});
