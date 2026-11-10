import { MOCK_STARTERS, TEMPLATES, mockStarter, mockStarterSvg, templateById } from './starter-art';

const LOWER_CAMEL = /^[a-z][a-zA-Z0-9]*$/;

describe('mock starter pictures', () => {
  it('stand in for every API starter id, in the API shape', () => {
    for (const id of Object.keys(MOCK_STARTERS)) {
      const s = mockStarter(id)!;
      expect(s.regions.length, id).toBeGreaterThan(0);
      for (const r of s.regions) {
        expect(r.id).toMatch(/^[a-z][a-z0-9-]{0,39}$/);
        for (const [x, y] of r.points) expect(x >= 0 && x <= 1 && y >= 0 && y <= 1, `${id}.${r.id}`).toBe(true);
      }
      expect(mockStarterSvg(id)).toContain('<svg');
    }
  });
});

describe('canvas templates', () => {
  it('ships the planned built-in pictures with unique ids', () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['body-front', 'body-back', 'hand', 'foot', 'face', 'ear', 'eye-anterior', 'fundus', 'abdomen', 'teeth']);
  });

  for (const t of TEMPLATES) {
    describe(t.id, () => {
      it('has a name and a positive viewBox', () => {
        expect(t.name.trim().length).toBeGreaterThan(0);
        expect(t.w).toBeGreaterThan(0);
        expect(t.h).toBeGreaterThan(0);
      });

      it('has safe, small art', () => {
        expect(t.art.length).toBeGreaterThan(0);
        expect(t.art.length).toBeLessThan(7000);
        expect(t.art).not.toMatch(/<script/i);
        expect(t.art).not.toMatch(/<svg/i);
        expect(t.art).not.toMatch(/\son[a-z]+\s*=/i);
        expect(t.art).not.toMatch(/style\s*=/i);
        expect(t.art).not.toMatch(/href/i);
        expect(t.art).not.toMatch(/<text/i);
        expect(t.art.replace(/<(path|ellipse|circle|line)\b[^>]*\/>/g, '')).toBe('');
      });

      it('has unique lowerCamel region keys with labels', () => {
        const keys = t.regions.map((r) => r.key);
        expect(keys.length).toBeGreaterThan(0);
        expect(new Set(keys).size).toBe(keys.length);
        for (const r of t.regions) {
          expect(r.key).toMatch(LOWER_CAMEL);
          expect(r.label.trim().length).toBeGreaterThan(0);
        }
      });

      it('keeps every region inside the viewBox', () => {
        for (const r of t.regions) {
          const s = r.shape;
          if (s.type === 'poly') {
            expect(s.points.length).toBeGreaterThanOrEqual(6);
            expect(s.points.length % 2).toBe(0);
            s.points.forEach((v, i) => {
              expect(Number.isInteger(v)).toBe(true);
              expect(v).toBeGreaterThanOrEqual(0);
              expect(v).toBeLessThanOrEqual(i % 2 === 0 ? t.w : t.h);
            });
          } else {
            expect(s.rx).toBeGreaterThan(0);
            expect(s.ry).toBeGreaterThan(0);
            expect(s.cx - s.rx).toBeGreaterThanOrEqual(0);
            expect(s.cx + s.rx).toBeLessThanOrEqual(t.w);
            expect(s.cy - s.ry).toBeGreaterThanOrEqual(0);
            expect(s.cy + s.ry).toBeLessThanOrEqual(t.h);
          }
        }
      });
    });
  }

  it('puts the patient right on the viewer left of the front view and the right of the back view', () => {
    const cx = (id: string, key: string) => {
      const s = templateById(id)!.regions.find((r) => r.key === key)!.shape;
      if (s.type !== 'poly') return s.cx;
      const xs = s.points.filter((_, i) => i % 2 === 0);
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    expect(cx('body-front', 'rightShoulder')).toBeLessThan(200);
    expect(cx('body-front', 'leftShoulder')).toBeGreaterThan(200);
    expect(cx('body-back', 'rightShoulder')).toBeGreaterThan(200);
    expect(cx('body-back', 'leftShoulder')).toBeLessThan(200);
  });

  it('templateById finds a picture and returns null for unknown or empty ids', () => {
    expect(templateById('hand')?.name).toBe('Hand (palm)');
    expect(templateById('nope')).toBeNull();
    expect(templateById('')).toBeNull();
    expect(templateById(null)).toBeNull();
    expect(templateById(undefined)).toBeNull();
  });
});
