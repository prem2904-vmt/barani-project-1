import { describe, expect, it } from 'vitest';
import { MAX_EDGE, MAX_PAGES, PREPARE_WORDS, RateCardPrepareException, fitEdge, planPages, sourceKind } from './rate-card-pages';

const f = (name: string, type: string, size = 1000) => ({ name, type, size });

describe('rate-card-pages — pure decisions', () => {
  it('sourceKind: by declared type, then by extension', () => {
    expect(sourceKind(f('a.pdf', 'application/pdf'))).toBe('pdf');
    expect(sourceKind(f('scan', 'application/pdf'))).toBe('pdf');
    expect(sourceKind(f('RATES.PDF', ''))).toBe('pdf');
    expect(sourceKind(f('p.jpg', 'image/jpeg'))).toBe('image');
    expect(sourceKind(f('IMG_1.HEIC', ''))).toBe('image');
    expect(sourceKind(f('notes.txt', 'text/plain'))).toBeNull();
  });

  it('fitEdge: long edge capped at 1600, never scaled up, aspect kept', () => {
    expect(fitEdge(3200, 1600)).toEqual({ w: 1600, h: 800 });
    expect(fitEdge(1000, 4000)).toEqual({ w: 400, h: MAX_EDGE });
    expect(fitEdge(800, 600)).toEqual({ w: 800, h: 600 });
    expect(fitEdge(0, 0)).toEqual({ w: 1, h: 1 });
  });

  it('planPages: images count one each, a PDF its pages; more than 6 is refused', () => {
    expect(planPages([f('a.jpg', 'image/jpeg'), f('b.png', 'image/png')])).toBe(2);
    expect(planPages([f('x.pdf', 'application/pdf')], () => 4)).toBe(4);
    expect(planPages([f('x.pdf', 'application/pdf'), f('a.jpg', 'image/jpeg')], (i) => (i === 0 ? 5 : 1))).toBe(MAX_PAGES);
    const refuse = (fn: () => unknown, code: string) => {
      try { fn(); } catch (e) { expect(e).toBeInstanceOf(RateCardPrepareException); expect((e as RateCardPrepareException).code).toBe(code); return; }
      throw new Error('expected a refusal');
    };
    refuse(() => planPages([f('x.pdf', 'application/pdf'), f('a.jpg', 'image/jpeg')], () => 6), 'too_many_pages');
    refuse(() => planPages([]), 'nothing');
    refuse(() => planPages([f('n.txt', 'text/plain')]), 'unsupported_type');
    refuse(() => planPages([f('huge.pdf', 'application/pdf', 50 * 1024 * 1024)]), 'too_large');
  });

  it('every refusal has plain words (no jargon, never "AI")', () => {
    for (const w of Object.values(PREPARE_WORDS)) { expect(w.length).toBeGreaterThan(10); expect(w).not.toMatch(/\bAI\b/); }
  });
});
