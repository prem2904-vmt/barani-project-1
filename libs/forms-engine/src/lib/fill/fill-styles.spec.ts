import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TOUCH_CLASSES } from '../testing/render-kind';

/**
 * Source proof of the 48px rule for the fill controls: every class the
 * controls use for a button declares a min-height of var(--pf-touch) (48px)
 * or more. The browser proof is the Playwright "every tap target is at
 * least 48px" check on the filler.
 */
const ROOT = process.cwd();
const FILL =
  readFileSync(resolve(ROOT, 'libs/forms-engine/src/lib/fill/_fill.scss'), 'utf8') +
  readFileSync(resolve(ROOT, 'libs/forms-engine/src/lib/canvas/_canvas.scss'), 'utf8') +
  readFileSync(resolve(ROOT, 'libs/forms-engine/src/lib/kinds/grid/_grid.scss'), 'utf8');
// Prepare's apps/prepare/src/styles/_touch.scss, ported by WP5 to the case-sheets styles folder (scoped to html.cs-touch).
const TOUCH = readFileSync(resolve(ROOT, 'apps/lms/src/app/features/casesheets/styles/_touch.scss'), 'utf8');

function minHeightOf(css: string, cls: string): string[] {
  const out: string[] = [];
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = rule[1].split(',').map((s) => s.trim());
    if (!sels.some((s) => new RegExp(`(^|\\s)\\.${cls.replace(/[-_]/g, (c) => '\\' + c)}$`).test(s) || s === `.${cls}`))
      continue;
    for (const d of rule[2].matchAll(/min-height:\s*([^;]+);/g)) out.push(d[1].trim());
  }
  return out;
}

describe('fill controls: touch targets', () => {
  it.each(TOUCH_CLASSES.filter((c) => c.startsWith('fe-')))('.%s is at least 48px tall', (cls) => {
    const hs = minHeightOf(FILL, cls);
    expect(hs.length, cls).toBeGreaterThan(0);
    for (const h of hs) {
      const px = h.match(/^(\d+)px$/);
      expect(h === 'var(--pf-touch)' || (px && Number(px[1]) >= 48), `${cls}: ${h}`).toBeTruthy();
    }
  });

  it('kit classes used by the controls are raised in _touch.scss', () => {
    expect(TOUCH).toMatch(/\.pf-btn \{[^}]*min-height:\s*var\(--pf-touch\)/);
    expect(TOUCH).toMatch(/pf-select \.pf-dd \.pf-dd__trigger \{[^}]*min-height:\s*var\(--pf-touch\)/);
    expect(TOUCH).toMatch(/button\.pf-touch \{[^}]*min-height:\s*var\(--pf-touch\)/);
  });

  it('text inputs are 16px (iOS never zooms) and never scroll inside', () => {
    expect(FILL).toMatch(/\.fe-text__input \{[^}]*font-size:\s*16px/);
    expect(FILL).not.toMatch(/overflow(-x|-y)?\s*:\s*(auto|scroll)/);
  });
});

describe('fill controls: the one-row yes/no card does not leak into follow-up fields', () => {
  it('its head rule reaches only its own head (child combinators), never the heads of nested follow-ups', () => {
    expect(FILL).not.toMatch(/\.fe-field--ynrow \.fe-field__head\b/);
    expect(FILL).toMatch(/\.fe-field--ynrow > \.fe-field__row > \.fe-field__head \{[^}]*flex:\s*1 1 180px/);
  });
});

