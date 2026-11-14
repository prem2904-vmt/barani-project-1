import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Phones: a hero band that sits DIRECTLY in `.pf-page` (report view, sample result entry) must not bleed.
 * The kit zeroes `.pf-page` side padding at ≤640px and puts the gutter on `.pf-page__header` / `__body`; a band
 * outside a header kept `--pf-hb-bleed: 1rem` and its `margin: 0 -1rem` pushed it 16px past both screen edges
 * (the primary action ended at 392px on a 390px phone — the phone form-factor screens run, 2026-11-13).
 */
const kit = readFileSync(resolve(process.cwd(), 'libs/shared/src/lib/styles/_pf-kit.scss'), 'utf8');
const band = readFileSync(resolve(process.cwd(), 'apps/lms/src/app/shared/components/hero-band/hero-band.component.ts'), 'utf8');

describe('hero band bleed on a phone', () => {
  it('the band bleeds by --pf-hb-bleed (what the fix neutralises)', () => {
    expect(band).toMatch(/\.pf-hb \{ margin: 0 calc\(-1 \* var\(--pf-hb-bleed, 0px\)\) 12px; \}/);
  });

  it('the phone page has no side padding, so a band directly in .pf-page gets no bleed', () => {
    const phone = kit.split('@media (max-width: 640px)').slice(1).join('@media (max-width: 640px)');
    expect(phone).toMatch(/\.pf-page \{[^}]*padding-left: 0 !important;/);
    expect(phone).toMatch(/\.pf-page > pf-hero-band \{\s*--pf-hb-bleed: 0px;\s*\}/);
  });

  it('only on phones: tablets / desktop keep their bleed', () => {
    const before = kit.slice(0, kit.indexOf('.pf-page > pf-hero-band'));
    const lastMedia = before.lastIndexOf('@media');
    expect(before.slice(lastMedia)).toMatch(/^@media \(max-width: 640px\)/);
  });
});
