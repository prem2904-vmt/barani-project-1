import { examplesOf } from '../../testing/examples';
import { f, renderKind, unnamed, untouchable } from '../../testing/render-kind';
import { ToothChartFill } from './toothChart.fill';
import { DEFAULT_CONDITIONS, isValidTooth, lowerRow, mergeMarks, surfaceWord, toothName, upperRow } from './teeth';

const field = (dentition = 'adult') => f('teeth', 'toothChart', { label: 'Teeth', config: { dentition, conditions: DEFAULT_CONDITIONS } });

describe('FDI numbering', () => {
  it('validates, names and words surfaces', () => {
    expect(isValidTooth('18')).toBe(true);
    expect(isValidTooth('55')).toBe(true);
    expect(isValidTooth('19')).toBe(false);
    expect(isValidTooth('56')).toBe(false);
    expect(toothName('36')).toBe('lower left first molar');
    expect(toothName('85')).toBe('baby lower right second molar');
    expect(surfaceWord('11', 'O')).toBe('incisal');
    expect(surfaceWord('36', 'L')).toBe('lingual');
    expect(surfaceWord('16', 'L')).toBe('palatal');
    expect(upperRow(false).length + lowerRow(false).length).toBe(32);
    expect(upperRow(true).length + lowerRow(true).length).toBe(20);
  });
  it('merges repeated marks and orders teeth and surfaces', () => {
    expect(
      mergeMarks([
        { tooth: '46', condition: 'missing' },
        { tooth: '36', condition: 'caries', surfaces: ['D'] },
        { tooth: '36', condition: 'caries', surfaces: ['O'] },
        { tooth: '19', condition: 'caries' },
      ]),
    ).toEqual([
      { tooth: '36', condition: 'caries', surfaces: ['O', 'D'] },
      { tooth: '46', condition: 'missing', surfaces: [] },
    ]);
  });
});

describe('toothChart fill', () => {
  it.each(examplesOf('toothChart').map((e) => [e.name, e] as const))('renders the catalogue example "%s"', async (_n, ex) => {
    const r = await renderKind(ToothChartFill, ex.field, ex.answers[ex.field.key]);
    expect(untouchable(r.el)).toEqual([]);
    expect(unnamed(r.el)).toEqual([]);
  });

  it('draws 32 adult teeth, 20 child teeth, and both (one set at a time) when mixed', async () => {
    expect((await renderKind(ToothChartFill, field('adult'))).el.querySelectorAll('[data-tooth]')).toHaveLength(32);
    expect((await renderKind(ToothChartFill, field('child'))).el.querySelectorAll('[data-tooth]')).toHaveLength(20);
    const r = await renderKind(ToothChartFill, field('mixed'));
    expect(r.el.querySelectorAll('[data-tooth]')).toHaveLength(32);
    await r.click('[data-set="baby"]');
    expect(r.el.querySelectorAll('[data-tooth]')).toHaveLength(20);
  });

  it('each quadrant lists its teeth from the outside to the middle on the left, middle to outside on the right', async () => {
    const r = await renderKind(ToothChartFill, field());
    const codes = (q: string) => [...r.el.querySelectorAll(`[data-quad="${q}"] [data-tooth]`)].map((b) => b.getAttribute('data-tooth'));
    expect(codes('q1')).toEqual(['18', '17', '16', '15', '14', '13', '12', '11']);
    expect(codes('q2')).toEqual(['21', '22', '23', '24', '25', '26', '27', '28']);
    expect(codes('q4')).toEqual(['48', '47', '46', '45', '44', '43', '42', '41']);
    expect(codes('q3')).toEqual(['31', '32', '33', '34', '35', '36', '37', '38']);
  });

  it('tap a tooth, then a condition; surfaces appear for conditions that have them', async () => {
    const r = await renderKind(ToothChartFill, field());
    await r.click('[data-tooth="36"]');
    expect(r.el.querySelector('[data-panel]')?.textContent).toContain('Tooth 36 · lower left first molar');
    await r.click('[data-panel] [data-cond="caries"]');
    expect(r.last()).toEqual({ marks: [{ tooth: '36', condition: 'caries' }] });
    await r.click('[data-panel] [data-surface="O"]');
    await r.click('[data-panel] [data-surface="D"]');
    expect(r.last()).toEqual({ marks: [{ tooth: '36', condition: 'caries', surfaces: ['O', 'D'] }] });
    expect(r.el.querySelector('[data-tooth="36"]')?.getAttribute('aria-label')).toContain('caries (occlusal, distal)');
    // a second condition on the same tooth
    await r.click('[data-panel] [data-cond="missing"]');
    expect((r.last() as { marks: unknown[] }).marks).toHaveLength(2);
    expect(r.el.querySelector('[data-panel] [data-surface]')).toBeNull(); // missing has no surfaces
    // tapping the active condition again takes it off
    await r.click('[data-panel] [data-cond="missing"]');
    expect((r.last() as { marks: unknown[] }).marks).toEqual([{ tooth: '36', condition: 'caries', surfaces: ['O', 'D'] }]);
  });

  it('the surface cross is drawn like the tooth: the upper-left tooth has mesial on the left', async () => {
    const r = await renderKind(ToothChartFill, field());
    await r.click('[data-tooth="26"]');
    await r.click('[data-panel] [data-cond="caries"]');
    const at = (pos: string) => r.el.querySelector(`[data-panel] [data-pos="${pos}"]`)?.getAttribute('data-surface');
    expect([at('top'), at('left'), at('right'), at('bottom')]).toEqual(['B', 'M', 'D', 'L']);
    await r.click('[data-tooth="26"]');
    await r.click('[data-tooth="46"]');
    await r.click('[data-panel] [data-cond="caries"]');
    expect([at('top'), at('left'), at('right'), at('bottom')]).toEqual(['L', 'D', 'M', 'B']);
  });

  it('"Clear this tooth" removes its marks and a marked tooth in the list opens it again', async () => {
    const r = await renderKind(ToothChartFill, field(), { marks: [{ tooth: '16', condition: 'rootCanal' }, { tooth: '46', condition: 'missing' }] });
    await r.click('[data-marked]');
    expect(r.el.querySelector('[data-panel]')?.textContent).toContain('Tooth 16');
    await r.click('[data-act="clear-tooth"]');
    expect(r.last()).toEqual({ marks: [{ tooth: '46', condition: 'missing' }] });
  });

  it('a note is kept; nothing marked and no note is no answer', async () => {
    const r = await renderKind(ToothChartFill, field(), { marks: [{ tooth: '16', condition: 'crown' }] });
    const note = r.el.querySelector<HTMLInputElement>('[data-note]')!;
    note.value = 'Anxious';
    note.dispatchEvent(new Event('change', { bubbles: true }));
    await r.stable();
    expect(r.last()).toEqual({ marks: [{ tooth: '16', condition: 'crown' }], note: 'Anxious' });
    const r2 = await renderKind(ToothChartFill, field(), { marks: [{ tooth: '16', condition: 'crown' }] });
    await r2.click('[data-tooth="16"]');
    await r2.click('[data-panel] [data-cond="crown"]');
    expect(r2.last()).toBeUndefined();
  });

  it('read-only: teeth cannot be changed, marked teeth can still be looked at', async () => {
    const r = await renderKind(ToothChartFill, field(), { marks: [{ tooth: '16', condition: 'crown' }] });
    await r.setDisabled(true);
    expect(r.el.querySelector<HTMLButtonElement>('[data-tooth="11"]')!.disabled).toBe(true);
    expect(r.el.querySelector<HTMLButtonElement>('[data-tooth="16"]')!.disabled).toBe(false);
  });
});
