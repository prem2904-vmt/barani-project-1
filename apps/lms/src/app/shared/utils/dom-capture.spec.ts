import { describe, expect, it } from 'vitest';
import { backdropBlurPx, fileStem, isVisibleColor, px } from './dom-capture';

describe('dom-capture helpers', () => {
  describe('isVisibleColor', () => {
    it('treats fully transparent rgba as invisible', () => {
      expect(isVisibleColor('rgba(0, 0, 0, 0)')).toBe(false);
      expect(isVisibleColor('transparent')).toBe(false);
      expect(isVisibleColor('none')).toBe(false);
      expect(isVisibleColor(null)).toBe(false);
      expect(isVisibleColor(undefined)).toBe(false);
    });

    it('treats any alpha > 0 as visible', () => {
      expect(isVisibleColor('rgba(20, 20, 28, 0.72)')).toBe(true);
      expect(isVisibleColor('rgb(124, 58, 237)')).toBe(true);
      expect(isVisibleColor('rgba(255, 255, 255, 0.03)')).toBe(true);
    });

    it('assumes named/hex colors are visible', () => {
      expect(isVisibleColor('#a855f7')).toBe(true);
      expect(isVisibleColor('rebeccapurple')).toBe(true);
    });
  });

  describe('px', () => {
    it('parses pixel strings', () => {
      expect(px('12px')).toBe(12);
      expect(px('0.5px')).toBe(0.5);
      expect(px('-4px')).toBe(-4);
    });

    it('returns 0 for unparsable input', () => {
      expect(px('normal')).toBe(0);
      expect(px('')).toBe(0);
      expect(px(null)).toBe(0);
      expect(px(undefined)).toBe(0);
    });
  });

  describe('backdropBlurPx', () => {
    it('extracts the blur radius from a backdrop-filter', () => {
      expect(backdropBlurPx('blur(10px)')).toBe(10);
      expect(backdropBlurPx('saturate(1.2) blur(24.5px)')).toBe(24.5);
    });

    it('returns 0 when there is no blur', () => {
      expect(backdropBlurPx('none')).toBe(0);
      expect(backdropBlurPx('')).toBe(0);
      expect(backdropBlurPx(undefined)).toBe(0);
    });
  });

  describe('fileStem', () => {
    it('slugs the route and appends breakpoint + width', () => {
      expect(fileStem('lab/my-work', 'Laptop', 1280)).toBe('lab-my-work-laptop1280');
      expect(fileStem('admin/tests', 'Phone', 390)).toBe('admin-tests-phone390');
    });

    it('falls back to home for an empty route and strips edge separators', () => {
      expect(fileStem('', 'Wide', 1920)).toBe('home-wide1920');
      expect(fileStem('/reports/', 'Tablet', 768)).toBe('reports-tablet768');
    });
  });
});
