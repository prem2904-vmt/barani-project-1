import { examplesOf } from '../../testing/examples';
import { f, renderKind, unnamed, untouchable } from '../../testing/render-kind';
import { BmiFill, bmiOf } from './bmi.fill';

const body = f('bmi', 'bmi', { label: 'Height and weight', config: { heightUnit: 'm', weightUnit: 'kg' } });

describe('bmi fill', () => {
  it('bmiOf converts units', () => {
    expect(bmiOf(1.7, 'm', 70, 'kg')).toBe(24.2);
    expect(bmiOf(170, 'cm', 70, 'kg')).toBe(24.2);
    expect(bmiOf(170, 'cm', 70000, 'g')).toBe(24.2);
    expect(bmiOf(67, 'in', 154, 'lb')).toBe(24.1);
    expect(bmiOf(null, 'm', 70, 'kg')).toBeNull();
    expect(bmiOf(0, 'm', 70, 'kg')).toBeNull();
  });

  it.each(examplesOf('bmi').map((e) => [e.name, e] as const))('renders the catalogue example "%s"', async (_n, ex) => {
    const v = ex.answers[ex.field.key] as { height: number; weight: number };
    const r = await renderKind(BmiFill, ex.field, v);
    const shown = [...r.el.querySelectorAll('.fe-numbox__v')].map((x) => x.textContent?.trim());
    expect(shown).toEqual([String(v.height), String(v.weight)]);
    expect(r.el.querySelector('.fe-bmi__figure')?.textContent?.trim()).toBe('24.2');
    expect(untouchable(r.el)).toEqual([]);
    expect(unnamed(r.el)).toEqual([]);
  });

  it('no BMI until both are there; then live', async () => {
    const r = await renderKind(BmiFill, body, null);
    expect(r.el.querySelector('[role="group"]')?.getAttribute('aria-labelledby')).toBe('lbl');
    expect(r.el.querySelector('.fe-bmi__figure')).toBeNull();
    const [h, w] = [...r.el.querySelectorAll<HTMLButtonElement>('.fe-numbox')];
    await r.click(h);
    await r.click(r.byText('1'));
    await r.click('[aria-label="decimal point"]');
    await r.click(r.byText('7'));
    expect(r.last()).toEqual({ height: 1.7, heightUnit: 'm', weight: null, weightUnit: 'kg' });
    expect(r.el.querySelector('.fe-bmi__figure')).toBeNull();
    await r.click(r.byText('Done'));
    await r.click(w);
    await r.click(r.byText('7'));
    await r.click(r.byText('0'));
    expect(r.last()).toEqual({ height: 1.7, heightUnit: 'm', weight: 70, weightUnit: 'kg' });
    expect(r.el.querySelector('.fe-bmi__figure')?.textContent?.trim()).toBe('24.2');
  });

  it('unit chips change the unit and the BMI follows', async () => {
    const r = await renderKind(BmiFill, body, { height: 170, heightUnit: 'm', weight: 70, weightUnit: 'kg' });
    await r.click(r.byText('cm'));
    expect(r.last()).toEqual({ height: 170, heightUnit: 'cm', weight: 70, weightUnit: 'kg' });
    expect(r.el.querySelector('.fe-bmi__figure')?.textContent?.trim()).toBe('24.2');
  });

  it('labels come from the config', async () => {
    const r = await renderKind(
      BmiFill,
      { ...body, config: { labels: { height: 'Ht', weight: 'Wt', bmi: 'Body mass index' } } },
      { height: 1.7, heightUnit: 'm', weight: 70, weightUnit: 'kg' },
    );
    expect(r.el.textContent).toContain('Ht');
    expect(r.el.textContent).toContain('Body mass index');
  });

  it('disabled: nothing is written', async () => {
    const r = await renderKind(BmiFill, body, { height: 1.7, heightUnit: 'm', weight: 70, weightUnit: 'kg' });
    await r.setDisabled(true);
    for (const b of r.buttons()) expect(b.disabled).toBe(true);
    expect(r.calls).toEqual([]);
  });
});

describe('bmi fill: legacy layout (G4)', () => {
  const nav = { goTo: () => undefined, pageTitle: (k: string) => k, isLegacy: () => true };

  it('Height, Weight and the worked-out BMI sit on one row; plain number boxes with the unit beside them', async () => {
    const r = await renderKind(BmiFill, body, null, { wizard: nav });
    expect(r.el.querySelector('.fe-bmi--legacy')).not.toBeNull();
    expect(r.el.querySelector('.fe-numbox')).toBeNull();
    expect(r.el.querySelector('.fe-chip')).toBeNull();
    expect([...r.el.querySelectorAll('.fe-bmi__unit')].map((x) => x.textContent?.trim())).toEqual(['m', 'kg']);
    expect(r.el.querySelector('.fe-bmi__figure')?.textContent?.trim()).toBe('—');
    const [h, w] = [...r.el.querySelectorAll<HTMLInputElement>('.fe-bmi__in')];
    h.value = '5';
    h.dispatchEvent(new Event('input'));
    await r.stable();
    w.value = '5';
    w.dispatchEvent(new Event('input'));
    await r.stable();
    expect(r.last()).toEqual({ height: 5, heightUnit: 'm', weight: 5, weightUnit: 'kg' });
    expect(r.el.querySelector('.fe-bmi__figure')?.textContent?.trim()).toBe('0.2');
    expect(r.el.querySelector('.fe-bmi__cat')?.textContent?.trim()).toBe('Underweight');
  });

  it('letters never land in the boxes', async () => {
    const r = await renderKind(BmiFill, body, null, { wizard: nav });
    const h = r.el.querySelector<HTMLInputElement>('.fe-bmi__in')!;
    h.value = 'abc';
    h.dispatchEvent(new Event('input'));
    await r.stable();
    expect(h.value).toBe('');
  });
});
