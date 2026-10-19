import { mergeDescriptionsOntoLatest, mergeStructureOntoLatest, type LooseSection } from './layout-section-merge';

/**
 * Owner bug 2026-09-27 ("the desc are not coming in preview"): the print order
 * and the Description column each saved their own stale copy of the ONE layout,
 * so the last save erased the other's edits — the Diabetes Profile's Sentence
 * was stored with a blank template although the editor still showed the text.
 */
describe('layout-section-merge — two editors, one stored layout', () => {
  const sentence = (template: string): LooseSection =>
    ({ id: 's-sent', type: 'paragraph', order: 2, template, conditions: [] });
  const grid = (rows: unknown[], id = 'g1'): LooseSection => ({ id, type: 'grid', order: 1, rows });
  const desc = (name: string, text: string) => ({ id: 'r-' + name, row_merge: false, parameter_name: name, cells: { description: text } });

  describe('Description save', () => {
    it("keeps the Sentence text typed on the print order after the Description editor loaded", () => {
      // Description editor loaded when the Sentence was still blank …
      const local = [grid([desc('hb', 'Low in anaemia')]), sentence('')];
      // … the print order has since saved the typed text.
      const latest = [grid([]), sentence('Kindly correlate clinically.')];
      const merged = mergeDescriptionsOntoLatest(latest, local, ['hb']);
      expect(merged.find(s => s.type === 'paragraph')!['template']).toBe('Kindly correlate clinically.');
      expect((merged[0].rows as any[]).map(r => r.cells.description)).toEqual(['Low in anaemia']);
    });

    it('replaces only the touched values; other stored rows survive', () => {
      const latest = [grid([desc('hb', 'old'), desc('wbc', 'kept')])];
      const local = [grid([desc('hb', 'new')])];
      const rows = mergeDescriptionsOntoLatest(latest, local, ['hb'])[0].rows as any[];
      expect(rows.map(r => [r.parameter_name, r.cells.description])).toEqual([['hb', 'new'], ['wbc', 'kept']]);
    });

    it('removes a touched value that has no local row any more', () => {
      const latest = [grid([desc('hb', 'x'), desc('wbc', 'y')])];
      const rows = mergeDescriptionsOntoLatest(latest, [grid([desc('wbc', 'y')])], ['hb'])[0].rows as any[];
      expect(rows.map(r => r.parameter_name)).toEqual(['wbc']);
    });

    it('no stored grid yet → the results table is created FIRST, before the Sentence', () => {
      const merged = mergeDescriptionsOntoLatest([sentence('Text')], [grid([desc('hb', 'x')], 'gl')], ['hb']);
      expect(merged.map(s => s.type)).toEqual(['grid', 'paragraph']);
      expect(merged[1]['template']).toBe('Text');
    });
  });

  describe('Print-order save', () => {
    it('keeps the description rows the Description column stored after the print order loaded', () => {
      const structure = [grid([]), sentence('Typed now')];
      const latest = [grid([desc('hb', 'Low in anaemia')]), sentence('')];
      const merged = mergeStructureOntoLatest(latest, structure);
      expect(merged.map(s => s.type)).toEqual(['grid', 'paragraph']);
      expect((merged[0].rows as any[])[0].cells.description).toBe('Low in anaemia');
      expect(merged[1]['template']).toBe('Typed now');
    });

    it('matches a grid by id, else takes the first stored grid (materialised ids differ)', () => {
      const merged = mergeStructureOntoLatest([grid([desc('hb', 'x')], 'server')], [grid([], 'local')]);
      expect(merged).toHaveLength(1);
      expect(merged[0].id).toBe('local');
      expect((merged[0].rows as any[])[0].parameter_name).toBe('hb');
    });

    it('a stored grid the print order never saw leads the report instead of being dropped', () => {
      const merged = mergeStructureOntoLatest([grid([desc('hb', 'x')])], [sentence('Only a sentence here')]);
      expect(merged.map(s => s.type)).toEqual(['grid', 'paragraph']);
    });
  });
});
