import { readFileSync } from 'node:fs';

/** Owner 2026-09-28: backspace belongs on the RIGHT (iPad convention). */
describe('PF Keys — backspace sits on the right', () => {
  const src = readFileSync('apps/lms/src/app/shared/components/numpad/pf-keys-panel.component.ts', 'utf8');

  it('QWERTY: backspace ends the top row (after P), not the bottom row', () => {
    expect(src).toMatch(/@if \(r === 0\) \{[\s\S]*?backKey[\s\S]*?\}/);
    const bottom = src.slice(src.indexOf('pf-k__row pf-k__row--bottom'), src.indexOf("@case ('code')"));
    expect(bottom).not.toContain('backKey');
    expect(src).toContain('grid-template-columns: repeat(22, minmax(0, 1fr))');
  });

  it('code / number pads: backspace is the right-most key of the top row', () => {
    expect(src).toMatch(/\.pf-k__at-back\s*\{ grid-column: -2 \/ span 1; grid-row: 1; \}/);
    expect(src).toMatch(/\.pf-k__at-hide\s*\{ grid-column: -3 \/ span 1; grid-row: 1; \}/);
  });
});
