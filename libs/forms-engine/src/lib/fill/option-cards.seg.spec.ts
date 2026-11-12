import { f, renderKind } from '../testing/render-kind';
import { ChoiceFill } from '../kinds/choice/choice.fill';

const opts = (labels: string[]) => labels.map((l) => ({ key: l.toLowerCase(), label: l, icon: 'x' }));

/** Owner 2026-11-12: Sex Male / Female stacked and huge — a single choice of 2-4 short options is one segmented row. */
describe('option cards: segmented row for short single choices', () => {
  it('2 icon options → segmented, count carried for the grid', async () => {
    const r = await renderKind(ChoiceFill, f('sex', 'choice', { label: 'Sex', options: opts(['Male', 'Female']) }), null);
    const g = r.el.querySelector('.fe-cards') as HTMLElement;
    expect(g.classList.contains('fe-cards--seg')).toBe(true);
    expect(g.style.getPropertyValue('--fe-seg-n')).toBe('2');
  });

  it('descriptions, long labels, 5+ options or follow-ups keep the stacked cards', async () => {
    const withDesc = f('a', 'choice', { label: 'A', options: [{ key: 'm', label: 'Male', icon: 'x', description: 'd' }, { key: 'f', label: 'Female', icon: 'x' }] });
    expect((await renderKind(ChoiceFill, withDesc, null)).el.querySelector('.fe-cards--seg')).toBeNull();
    const long = f('b', 'choice', { label: 'B', options: opts(['A very long option label here', 'Other']) });
    expect((await renderKind(ChoiceFill, long, null)).el.querySelector('.fe-cards--seg')).toBeNull();
    const five = f('c', 'choice', { label: 'C', options: opts(['One', 'Two', 'Three', 'Four', 'Five']) });
    expect((await renderKind(ChoiceFill, five, null)).el.querySelector('.fe-cards--seg')).toBeNull();
  });

  it('picking still works as a radio', async () => {
    const r = await renderKind(ChoiceFill, f('sex', 'choice', { label: 'Sex', options: opts(['Male', 'Female']) }), null);
    await r.click(r.el.querySelector('[data-option="female"]') as HTMLElement);
    expect(r.last()).toBe('female');
  });
});
