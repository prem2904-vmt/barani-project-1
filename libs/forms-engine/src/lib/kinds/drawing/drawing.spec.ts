import { ptr } from '../../canvas/canvas.spec-helpers';
import { CanvasAnswer } from '../../canvas/answer';
import { examplesOf } from '../../testing/examples';
import { f, renderKind, unnamed, untouchable } from '../../testing/render-kind';
import { TestAssetStore } from '../../testing/test-assets';
import { DrawingFill } from './drawing.fill';

const settle = async (r: { stable(): Promise<void> }) => {
  for (let i = 0; i < 4; i++) {
    await new Promise((res) => setTimeout(res));
    await r.stable();
  }
};

describe('drawing fill', () => {
  it.each(examplesOf('drawing').map((e) => [e.name, e] as const))('renders the catalogue example "%s"', async (_n, ex) => {
    const r = await renderKind(DrawingFill, ex.field, ex.answers[ex.field.key] ?? null, { assets: new TestAssetStore() });
    await settle(r);
    expect(r.el.querySelector('fe-canvas')).not.toBeNull();
    expect(untouchable(r.el)).toEqual([]);
    expect(unnamed(r.el)).toEqual([]);
    const a = ex.answers[ex.field.key] as CanvasAnswer;
    expect(r.el.querySelectorAll('path.fe-ink')).toHaveLength(a.strokes?.length ?? 0);
    expect(r.el.querySelectorAll('path.fe-cv__region.is-marked')).toHaveLength(a.regions?.length ?? 0);
  });

  it('a starter picture is drawn from the API with its areas; the sheet takes its size', async () => {
    const r = await renderKind(DrawingFill, f('pain', 'drawing', { config: { template: 'body-front' } }), null, {
      assets: new TestAssetStore(),
    });
    await settle(r);
    expect(r.el.querySelector('image.fe-cv__image')?.getAttribute('href')).toContain('/api/canvas/templates/body-front.svg');
    expect(r.el.querySelectorAll('path.fe-cv__region').length).toBeGreaterThan(10);
    expect(r.el.querySelector('.fe-cv__surface')?.getAttribute('style')).toContain('400 / 900');
  });

  it('drawing writes the API answer (fractions); undo to nothing clears it; redo brings it back', async () => {
    const r = await renderKind(DrawingFill, f('sketch', 'drawing', { config: { canvas: { width: 800, height: 500 } } }));
    await settle(r);
    const s = r.el.querySelector('.fe-cv__surface')!;
    ptr(s, 'pointerdown', 80, 50);
    ptr(s, 'pointermove', 400, 250);
    ptr(s, 'pointerup', 400, 250);
    await r.stable();
    const v = r.last() as CanvasAnswer;
    expect(v.strokes![0].points).toEqual([[0.1, 0.1, 0.5], [0.5, 0.5, 0.5]]);
    expect(v.strokes![0].color).toBe('#111827');
    await r.click('[data-act="undo"]');
    expect(r.last()).toBeUndefined();
    await r.click('[data-act="redo"]');
    expect((r.last() as CanvasAnswer).strokes).toHaveLength(1);
  });

  it('the description is part of the answer and survives drawing', async () => {
    const r = await renderKind(DrawingFill, f('sketch', 'drawing', { config: { showDescription: true } }));
    await settle(r);
    const d = r.el.querySelector<HTMLTextAreaElement>('[data-description]')!;
    d.value = 'Lesion on the hand';
    d.dispatchEvent(new Event('change'));
    await r.stable();
    expect(r.last()).toEqual({ description: 'Lesion on the hand' });
    const s = r.el.querySelector('.fe-cv__surface')!;
    ptr(s, 'pointerdown', 10, 10);
    ptr(s, 'pointerup', 60, 40);
    await r.stable();
    expect((r.last() as CanvasAnswer).description).toBe('Lesion on the hand');
  });

  it('the form decides the tools: no ink, no text, no pins', async () => {
    const r = await renderKind(
      DrawingFill,
      f('x', 'drawing', { config: { template: 'body-front', allowInk: false, allowLabels: false, maxPins: 0 } }),
      null,
      { assets: new TestAssetStore() },
    );
    await settle(r);
    // one tool left (mark areas): no tool picker, just the picture and a plain hint
    expect(r.el.querySelectorAll('.fe-cv__tool[data-tool]')).toHaveLength(0);
    expect(r.el.querySelector('fe-canvas')?.getAttribute('data-tool')).toBe('mark');
    expect(r.el.textContent).toContain('Tap an area on the picture to mark it.');
  });

  it('locked: no toolbar, nothing draws', async () => {
    const r = await renderKind(DrawingFill, f('sketch', 'drawing'));
    await r.setDisabled(true);
    await settle(r);
    expect(r.el.querySelector('.fe-cv__bar')).toBeNull();
    const s = r.el.querySelector('.fe-cv__surface')!;
    ptr(s, 'pointerdown', 10, 10);
    ptr(s, 'pointerup', 60, 40);
    await r.stable();
    expect(r.calls).toEqual([]);
  });
});

describe('drawing fill: legacy cell (G3)', () => {
  const nav = { goTo: () => undefined, pageTitle: (k: string) => k, isLegacy: () => true };
  const diagram = f('diag', 'drawing', { label: 'Anterior Rhinoscopy - Diagram Right', config: {} });
  it('a small dashed Draw box until it is tapped; a legacy cell never shows the big canvas up front', async () => {
    const r = await renderKind(DrawingFill, diagram, null, { wizard: nav, assets: new TestAssetStore() });
    await settle(r);
    expect(r.el.querySelector('fe-canvas')).toBeNull();
    expect(r.el.querySelector('.fe-drawcell__btn')?.textContent).toContain('Draw');
    await r.click('.fe-drawcell__btn');
    await settle(r);
    expect(r.el.querySelector('.fe-drawcell')).toBeNull();
    expect(r.el.querySelector('fe-canvas')).not.toBeNull();
  });
});
