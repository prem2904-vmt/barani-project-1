import { describe, expect, it } from 'vitest';
import { PF_GLYPH, headerColor } from './case.page';

describe('legacy form header', () => {
  it('uses the page colour only when it is a plain hex colour', () => {
    expect(headerColor('#8B5CF6')).toBe('#8B5CF6');
    expect(headerColor(' #abc ')).toBe('#abc');
    expect(headerColor('red')).toBeNull();
    expect(headerColor('url(x)')).toBeNull();
    expect(headerColor(undefined)).toBeNull();
  });

  it('draws the PF glyph from the two brand paths', () => {
    expect(PF_GLYPH).toHaveLength(2);
    expect(PF_GLYPH[0].startsWith('M0 131.126')).toBe(true);
  });
});
