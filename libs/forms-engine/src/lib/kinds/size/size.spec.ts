import { examplesOf } from '../../testing/examples';
import { f, renderKind, unnamed, untouchable } from '../../testing/render-kind';
import { SizeFill, boxName } from './size.fill';

const swelling = f('swelling', 'size', { label: 'Swelling', config: { boxCount: 2, defaultUnit: 'cm' } });

describe('size fill', () => {
  it.each(examplesOf('size').map((e) => [e.name, e] as const))('renders the catalogue example "%s"', async (_n, ex) => {
    const v = ex.answers[ex.field.key] as { dimensions: number[] };
    const r = await renderKind(SizeFill, ex.field, v);
    const shown = [...r.el.querySelectorAll('.fe-numbox__v')].map((x) => x.textContent?.trim());
    expect(shown).toEqual(v.dimensions.map(String));
    expect(untouchable(r.el)).toEqual([]);
    expect(unnamed(r.el)).toEqual([]);
  });

  it('box names', () => {
    expect(boxName(0, 2)).toBe('Length');
    expect(boxName(2, 3)).toBe('Depth');
    expect(boxName(3, 5)).toBe('Size 4');
  });

  it('each box opens the pad for THAT box', async () => {
    const r = await renderKind(SizeFill, swelling, null);
    expect(r.el.querySelector('[role="group"]')?.getAttribute('aria-labelledby')).toBe('lbl');
    expect(r.el.textContent).toContain('×');
    const [len, wid] = [...r.el.querySelectorAll<HTMLButtonElement>('.fe-numbox')];
    await r.click(len);
    await r.click(r.byText('2'));
    expect(r.last()).toEqual({ dimensions: [2, null], unit: 'cm' });
    await r.click(r.byText('Done'));
    await r.click(wid);
    expect(wid.getAttribute('aria-expanded')).toBe('true');
    await r.click(r.byText('3'));
    expect(r.last()).toEqual({ dimensions: [2, 3], unit: 'cm' });
  });

  it('unit chips; all boxes empty → no value', async () => {
    const r = await renderKind(SizeFill, swelling, { dimensions: [2, null], unit: 'cm' });
    await r.click(r.byText('mm'));
    expect(r.last()).toEqual({ dimensions: [2, null], unit: 'mm' });
    await r.click(r.el.querySelectorAll<HTMLButtonElement>('.fe-numbox')[0]);
    await r.click('[aria-label="Delete last digit"]');
    expect(r.last()).toBeUndefined();
  });

  it('boxCount is clamped to 1..5', async () => {
    const r = await renderKind(SizeFill, { ...swelling, config: { boxCount: 9 } }, null);
    expect(r.el.querySelectorAll('.fe-numbox').length).toBe(5);
  });

  it('disabled: nothing is written', async () => {
    const r = await renderKind(SizeFill, swelling, { dimensions: [2, 3], unit: 'cm' });
    await r.setDisabled(true);
    for (const b of r.buttons()) expect(b.disabled).toBe(true);
    expect(r.calls).toEqual([]);
  });
});
