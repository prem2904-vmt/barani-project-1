import { examplesOf } from '../../testing/examples';
import { f, renderKind, unnamed, untouchable } from '../../testing/render-kind';
import { NumberFill } from './number.fill';

describe('number fill', () => {
  it.each(examplesOf('number').map((e) => [e.name, e] as const))(
    'renders the catalogue example "%s"',
    async (_n, ex) => {
      const r = await renderKind(NumberFill, ex.field, ex.answers[ex.field.key]);
      // legacy layout: a plain number box
      expect((r.el.querySelector('input.fe-numline__input') as HTMLInputElement)?.value).toBe(String(ex.answers[ex.field.key]));
      expect(untouchable(r.el)).toEqual([]);
      expect(unnamed(r.el)).toEqual([]);
    },
  );

  it('steppers move by step within min / max', async () => {
    const r = await renderKind(NumberFill, f('age', 'number', { label: 'Age', config: { min: 0, max: 2, display: 'stepper' } }), 1);
    await r.click('[aria-label="More Age"]');
    expect(r.last()).toBe(2);
    expect((r.el.querySelector('[aria-label="More Age"]') as HTMLButtonElement).disabled).toBe(true);
    await r.click('[aria-label="Less Age"]');
    await r.click('[aria-label="Less Age"]');
    expect(r.last()).toBe(0);
  });

  it('an empty value starts from min', async () => {
    const r = await renderKind(NumberFill, f('n', 'number', { label: 'Count', config: { min: 5, display: 'stepper' } }), null);
    await r.click('[aria-label="More Count"]');
    expect(r.last()).toBe(5);
  });

  it('the value box opens the in-app number pad (no system keyboard): type, delete, done', async () => {
    const r = await renderKind(NumberFill, f('hr', 'number', { label: 'Heart rate', config: { unit: 'bpm', display: 'stepper' } }), null);
    expect(r.el.querySelector('input')).toBeNull();
    const box = r.el.querySelector('.fe-numbox') as HTMLButtonElement;
    expect(box.getAttribute('aria-expanded')).toBe('false');
    await r.click(box);
    expect(box.getAttribute('aria-expanded')).toBe('true');
    await r.click(r.byText('7'));
    await r.click(r.byText('2'));
    expect(r.last()).toBe(72);
    await r.click('[aria-label="Delete last digit"]');
    expect(r.last()).toBe(7);
    expect(r.el.textContent).toContain('bpm');
    await r.click(r.byText('Done'));
    expect(r.el.querySelector('fe-numpad')).toBeNull();
  });

  it('decimals only when the step has them', async () => {
    const whole = await renderKind(NumberFill, f('a', 'number', { label: 'A', config: { display: 'stepper' } }), null);
    await whole.click('.fe-numbox');
    expect(whole.el.querySelector('[aria-label="decimal point"]')).toBeNull();
    const dec = await renderKind(NumberFill, f('t', 'number', { label: 'Temp', config: { step: 0.1, display: 'stepper' } }), null);
    await dec.click('.fe-numbox');
    await dec.click(dec.byText('3'));
    await dec.click('[aria-label="decimal point"]');
    await dec.click(dec.byText('5'));
    expect(dec.last()).toBe(3.5);
  });

  it('legacy layout by default: a plain box with the number keyboard and the unit after it', async () => {
    const r = await renderKind(NumberFill, f('hr', 'number', { label: 'Heart rate', config: { unit: 'bpm' } }), null);
    const box = r.el.querySelector('input.fe-numline__input') as HTMLInputElement;
    expect(box.getAttribute('inputmode')).toBe('numeric');
    expect(box.placeholder).toBe('Enter heart rate');
    expect(r.el.querySelector('.fe-stepper')).toBeNull();
    expect(r.el.textContent).toContain('bpm');
    box.value = '72';
    box.dispatchEvent(new Event('input'));
    await r.stable();
    expect(r.last()).toBe(72);
    const dec = await renderKind(NumberFill, f('t', 'number', { label: 'Temp', config: { step: 0.1 } }), null);
    expect(dec.el.querySelector('input')!.getAttribute('inputmode')).toBe('decimal');
  });

  it('says plainly when a value is out of range', async () => {
    const r = await renderKind(NumberFill, f('age', 'number', { label: 'Age', config: { max: 120 } }), 150);
    expect(r.el.textContent).toContain('The highest is 120.');
  });

  it('disabled: nothing is written', async () => {
    const r = await renderKind(NumberFill, f('a', 'number', { label: 'A', config: { display: 'stepper' } }), 1);
    await r.setDisabled(true);
    for (const b of r.buttons()) expect(b.disabled).toBe(true);
    expect(r.calls).toEqual([]);
  });
});
