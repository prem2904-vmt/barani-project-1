import { PhotosValue, parsePhotos, shrinkSize } from '../../canvas/photo';
import { ptr } from '../../canvas/canvas.spec-helpers';
import { examplesOf } from '../../testing/examples';
import { f, renderKind, unnamed, untouchable } from '../../testing/render-kind';
import { TestAssetStore } from '../../testing/test-assets';
import { PhotosFill } from './photos.fill';

const settle = async (r: { stable(): Promise<void> }) => {
  for (let i = 0; i < 6; i++) {
    await new Promise((res) => setTimeout(res));
    await r.stable();
  }
};
const field = f('wound', 'photos', { label: 'Wound photos', config: { maxPhotos: 4 } });

async function addPhoto(r: Awaited<ReturnType<typeof renderKind>>) {
  const input = r.el.querySelector<HTMLInputElement>('[data-photo-input]')!;
  Object.defineProperty(input, 'files', { value: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })], configurable: true });
  input.dispatchEvent(new Event('change'));
  await settle(r);
}

describe('photos fill', () => {
  it.each(examplesOf('photos').map((e) => [e.name, e] as const))('renders the catalogue example "%s"', async (_n, ex) => {
    const v = ex.answers[ex.field.key] as PhotosValue;
    const s = new TestAssetStore(Object.fromEntries(v.photos.map((p) => [p.photo, { width: 1600, height: 1200 }])));
    const r = await renderKind(PhotosFill, ex.field, v, { assets: s });
    await settle(r);
    expect(r.el.querySelectorAll('.fe-photo')).toHaveLength(v.photos.length);
    expect(untouchable(r.el)).toEqual([]);
    expect(unnamed(r.el)).toEqual([]);
  });

  it('a photo is uploaded to the sheet (never base64) and opens for markup; markup and caption kept per photo', async () => {
    const s = new TestAssetStore();
    const r = await renderKind(PhotosFill, field, null, { assets: s });
    await addPhoto(r);
    expect(s.uploads).toEqual([{ kind: 'photo', type: 'image/jpeg' }]);
    const surface = r.el.querySelector('.fe-photo-edit .fe-cv__surface')!;
    ptr(surface, 'pointerdown', 160, 120);
    ptr(surface, 'pointermove', 800, 600);
    ptr(surface, 'pointerup', 800, 600);
    await r.stable();
    const cap = r.el.querySelector<HTMLInputElement>('[data-caption]')!;
    cap.value = 'Day 3';
    cap.dispatchEvent(new Event('change'));
    await r.stable();
    const p = (r.last() as PhotosValue).photos[0];
    expect(p.description).toBe('Day 3');
    expect(p.strokes![0].points).toEqual([[0.1, 0.1, 0.5], [0.5, 0.5, 0.5]]);
    expect(JSON.stringify(r.last())).not.toContain('data:');
    expect(r.el.querySelector('.fe-photo__ink path')).not.toBeNull(); // the thumbnail shows the markup
  });

  it('parsing and the on-device shrink size', () => {
    expect(parsePhotos({ photos: [{ photo: 'a' }, { description: 'x' }] })).toHaveLength(1);
    expect(shrinkSize(4032, 3024)).toEqual({ w: 2048, h: 1536 });
    expect(shrinkSize(800, 600)).toEqual({ w: 800, h: 600 });
  });
});

describe('photos fill: legacy gallery (G3)', () => {
  const nav = { goTo: () => undefined, pageTitle: (k: string) => k, isLegacy: () => true };
  it('label with a 0 / 6 count, Camera and Upload first, then the dashed "No images added yet" box', async () => {
    const r = await renderKind(PhotosFill, f('endo', 'photos', { label: 'Diagnostic nasal endoscopy', config: { maxPhotos: 6 } }), null, { wizard: nav, assets: new TestAssetStore() });
    await settle(r);
    expect(r.el.querySelector('.fe-img__count')?.textContent?.trim()).toBe('0 / 6');
    expect([...r.el.querySelectorAll('.fe-img__act')].map((b) => b.textContent?.trim())).toEqual(['Camera', 'Upload']);
    expect(r.el.querySelector('.fe-img__none-t')?.textContent?.trim()).toBe('No images added yet');
    expect(r.el.textContent).toContain('Use camera or upload to add up to 6 images');
  });
});
