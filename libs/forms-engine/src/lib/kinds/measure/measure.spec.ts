import { examplesOf } from '../../testing/examples';
import { f, renderKind, unnamed, untouchable } from '../../testing/render-kind';
import { MeasureFill, snap } from './measure.fill';

const weight = f('weight', 'measure', { label: 'Weight', config: { min: 0, max: 200, step: 1, unit: 'kg' } });

describe('measure fill', () => {
  it('snap', () => {
    expect(snap(123.4, 60, 260, 2)).toBe(124);
    expect(snap(-5, 0, 10, 1)).toBe(0);
    expect(snap(37.26, 30, 45, 0.1)).toBe(37.3);
  });

  it.each(examplesOf('measure').map((e) => [e.name, e] as const))(
    'renders the catalogue example "%s"',
    async (_n, ex) => {
      const v = ex.answers[ex.field.key] as { value: number };
      const r = await renderKind(MeasureFill, ex.field, v);
      expect(r.el.querySelector('.fe-numbox__v')?.textContent?.trim()).toBe(String(v.value));
      expect(r.el.querySelector('[role="slider"]')?.getAttribute('aria-valuenow')).toBe(String(v.value));
      expect(untouchable(r.el)).toEqual([]);
      expect(unnamed(r.el)).toEqual([]);
    },
  );

  it('the slider is not a native range input; it has slider semantics and blocks the page swipe', async () => {
    const r = await renderKind(MeasureFill, weight, { value: 70, unit: 'kg' });
    expect(r.el.querySelector('input')).toBeNull();
    const s = r.el.querySelector('[role="slider"]')!;
    expect(s.hasAttribute('data-no-swipe')).toBe(true);
    expect(s.getAttribute('aria-valuemin')).toBe('0');
    expect(s.getAttribute('aria-valuemax')).toBe('200');
    expect(s.getAttribute('aria-valuetext')).toBe('70 kg');
  });

  it('stepper and keyboard arrows move by step within min / max', async () => {
    const bp = f('sys', 'measure', { label: 'Systolic', config: { min: 60, max: 260, step: 2, unit: 'mmHg' } });
    const r = await renderKind(MeasureFill, bp, { value: 258, unit: 'mmHg' });
    await r.click('[aria-label="More Systolic"]');
    expect(r.last()).toEqual({ value: 260, unit: 'mmHg' });
    const s = r.el.querySelector('[role="slider"]') as HTMLElement;
    s.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await r.stable();
    expect(r.last()).toEqual({ value: 258, unit: 'mmHg' });
    s.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    await r.stable();
    expect(r.last()).toEqual({ value: 60, unit: 'mmHg' });
  });

  it('End on the slider goes to the top of the range', async () => {
    const r = await renderKind(MeasureFill, weight, null);
    const s = r.el.querySelector('[role="slider"]') as HTMLElement;
    s.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    await r.stable();
    expect(r.last()).toEqual({ value: 200, unit: 'kg' });
  });

  it('tapping the value opens the number pad', async () => {
    const r = await renderKind(MeasureFill, weight, null);
    await r.click('.fe-numbox');
    await r.click(r.byText('6'));
    await r.click(r.byText('8'));
    expect(r.last()).toEqual({ value: 68, unit: 'kg' });
  });

  it('disabled: nothing is written', async () => {
    const r = await renderKind(MeasureFill, weight, { value: 70, unit: 'kg' });
    await r.setDisabled(true);
    for (const b of r.buttons()) expect(b.disabled).toBe(true);
    const s = r.el.querySelector('[role="slider"]') as HTMLElement;
    s.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    await r.stable();
    expect(r.calls).toEqual([]);
  });
});

describe('measure fill: legacy card row (G5)', () => {
  const nav = { goTo: () => undefined, pageTitle: (k: string) => k, isLegacy: () => true };
  const temp = f('temp', 'measure', { label: 'Temperature', config: { min: 0, max: 45, step: 1, unit: 'degree Celsius' } });

  it('one row: the question, a slider, a number box and the unit; no stepper, no big slider', async () => {
    const r = await renderKind(MeasureFill, temp, null, { wizard: nav });
    expect(r.el.querySelector('.fe-measure--legacy')).not.toBeNull();
    expect(r.el.querySelector('.fe-stepper')).toBeNull();
    expect(r.el.querySelector('[role="slider"]')).toBeNull();
    expect(r.el.querySelector('.fe-measure__q')?.textContent).toContain('Temperature');
    expect(r.el.querySelector('.fe-measure__unit')?.textContent?.trim()).toBe('degree Celsius');
    const num = r.el.querySelector<HTMLInputElement>('.fe-measure__num')!;
    num.value = '37';
    num.dispatchEvent(new Event('input'));
    await r.stable();
    expect(r.last()).toEqual({ value: 37, unit: 'degree Celsius' });
    const range = r.el.querySelector<HTMLInputElement>('.fe-measure__range')!;
    range.value = '12';
    range.dispatchEvent(new Event('input'));
    await r.stable();
    expect(r.last()).toEqual({ value: 12, unit: 'degree Celsius' });
  });
});
