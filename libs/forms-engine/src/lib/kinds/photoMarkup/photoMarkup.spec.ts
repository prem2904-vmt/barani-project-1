import { CanvasAnswer } from '../../canvas/answer';
import { ptr } from '../../canvas/canvas.spec-helpers';
import { examplesOf } from '../../testing/examples';
import { f, renderKind, unnamed, untouchable } from '../../testing/render-kind';
import { TestAssetStore } from '../../testing/test-assets';
import { PhotoMarkupFill } from './photoMarkup.fill';

const settle = async (r: { stable(): Promise<void> }) => {
  for (let i = 0; i < 6; i++) {
    await new Promise((res) => setTimeout(res));
    await r.stable();
  }
};

describe('photoMarkup fill', () => {
  it.each(examplesOf('photoMarkup').map((e) => [e.name, e] as const))('renders the catalogue example "%s"', async (_n, ex) => {
    const a = ex.answers[ex.field.key] as CanvasAnswer;
    const r = await renderKind(PhotoMarkupFill, ex.field, a, { assets: new TestAssetStore({ [a.photo!]: { width: 1600, height: 1200 } }) });
    await settle(r);
    expect(r.el.querySelector('image.fe-cv__image')?.getAttribute('href')).toBe(`https://files.test/${a.photo}`);
    expect(r.el.querySelectorAll('path.fe-ink')).toHaveLength(a.strokes?.length ?? 0);
    expect(untouchable(r.el)).toEqual([]);
    expect(unnamed(r.el)).toEqual([]);
  });

  it('no photo yet: camera / library as the form allows; the upload goes to the sheet and becomes value.photo', async () => {
    const s = new TestAssetStore();
    const r = await renderKind(PhotoMarkupFill, f('rash', 'photoMarkup', { config: { photoSource: 'camera' } }), null, { assets: s });
    await settle(r);
    expect(r.el.querySelector('[data-act="camera"]')).not.toBeNull();
    expect(r.el.querySelector('[data-act="library"]')).toBeNull();
    const input = r.el.querySelector<HTMLInputElement>('[data-camera-input]')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })], configurable: true });
    input.dispatchEvent(new Event('change'));
    await settle(r);
    expect(s.uploads).toEqual([{ kind: 'photo', type: 'image/jpeg' }]);
    const v = r.last() as CanvasAnswer;
    expect(v.photo).toMatch(/^0{8}-/);
    expect(JSON.stringify(v)).not.toContain('data:');
    // mark it up
    const surf = r.el.querySelector('.fe-cv__surface')!;
    ptr(surf, 'pointerdown', 100, 100);
    ptr(surf, 'pointermove', 400, 300);
    ptr(surf, 'pointerup', 400, 300);
    await r.stable();
    expect((r.last() as CanvasAnswer).photo).toBe(v.photo);
    expect((r.last() as CanvasAnswer).strokes).toHaveLength(1);
  });

  it('outside an open sheet (Studio preview): says photos are added on a case sheet', async () => {
    const s = new TestAssetStore();
    s.photosAllowed = false;
    const r = await renderKind(PhotoMarkupFill, f('rash', 'photoMarkup'), null, { assets: s });
    await settle(r);
    expect(r.el.textContent).toContain('Photos can be added on an open case sheet');
    expect(r.el.querySelector('[data-act="camera"]')).toBeNull();
  });
});
