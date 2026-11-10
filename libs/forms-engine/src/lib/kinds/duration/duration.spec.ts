import { examplesOf } from '../../testing/examples';
import { f, renderKind, unnamed, untouchable } from '../../testing/render-kind';
import { DurationFill, durationText, pluralUnit } from './duration.fill';

const fever = f('fever', 'duration', {
  label: 'Fever for',
  config: { scale: 'calendar', mode: 'single', defaultUnit: 'days', display: 'chips' },
});
const feverBox = f('fever', 'duration', {
  label: 'Fever for',
  config: { scale: 'calendar', mode: 'single', defaultUnit: 'days' },
});

describe('duration helpers', () => {
  it('text and units', () => {
    expect(durationText(5, null, 'days')).toBe('5 days');
    expect(durationText(1, null, 'weeks')).toBe('1 week');
    expect(durationText(5, 7, 'days')).toBe('5–7 days');
    expect(pluralUnit('day')).toBe('days');
    expect(pluralUnit('Months')).toBe('months');
  });
});

describe('duration fill', () => {
  it.each(examplesOf('duration').map((e) => [e.name, e] as const))(
    'renders the catalogue example "%s"',
    async (_n, ex) => {
      const v = ex.answers[ex.field.key] as Record<string, unknown> | string;
      const r = await renderKind(DurationFill, ex.field, v);
      if (typeof v === 'string') {
        expect(r.el.querySelector('[aria-checked="true"]')?.textContent?.trim().toLowerCase()).toBe(v);
      } else {
        expect(r.el.querySelector('.fe-dur__says')?.textContent?.trim()).toBe(
          durationText(v['amount'] as number, (v['valueTo'] as number) ?? null, v['unit'] as string),
        );
      }
      expect(untouchable(r.el)).toEqual([]);
      expect(unnamed(r.el)).toEqual([]);
    },
  );

  it('a number chip then a unit chip; no keyboard', async () => {
    const r = await renderKind(DurationFill, fever, null);
    expect(r.el.querySelector('input')).toBeNull();
    expect(r.el.querySelector('[role="group"]')?.getAttribute('aria-labelledby')).toBe('lbl');
    await r.click(r.byText('5'));
    expect(r.last()).toEqual({ amount: 5, unit: 'days' });
    await r.click(r.byText('Weeks'));
    expect(r.last()).toEqual({ amount: 5, unit: 'weeks' });
    expect(r.el.querySelector('.fe-dur__says')?.textContent?.trim()).toBe('5 weeks');
    await r.click(r.byText('5'));
    expect(r.last()).toBeUndefined();
  });

  it('a unit picked first is kept for the number (nothing written without a number)', async () => {
    const r = await renderKind(DurationFill, fever, null);
    await r.click(r.byText('Months'));
    expect(r.calls).toEqual([]);
    await r.click(r.byText('3'));
    expect(r.last()).toEqual({ amount: 3, unit: 'months' });
  });

  it('Other opens the in-app number pad', async () => {
    const r = await renderKind(DurationFill, fever, null);
    await r.click(r.byText('Other'));
    await r.click(r.byText('4', 'fe-numpad button'));
    await r.click(r.byText('5', 'fe-numpad button'));
    expect(r.last()).toEqual({ amount: 45, unit: 'days' });
    await r.click(r.byText('Done'));
    expect(r.el.querySelector('fe-numpad')).toBeNull();
    expect(r.el.textContent).toContain('45');
  });

  it('reads the legacy {value, unit} shape', async () => {
    const r = await renderKind(DurationFill, fever, { value: 6, unit: 'month' });
    expect(r.el.querySelector('.fe-dur__says')?.textContent?.trim()).toBe('6 months');
  });

  it('range: From and To rows', async () => {
    const r = await renderKind(DurationFill, { ...fever, config: { mode: 'range', defaultUnit: 'weeks', display: 'chips' } }, null);
    await r.click('[aria-label="From 2"]');
    await r.click('[aria-label="To 3"]');
    expect(r.last()).toEqual({ amount: 2, unit: 'weeks', valueTo: 3 });
    expect(r.el.querySelector('.fe-dur__says')?.textContent?.trim()).toBe('2–3 weeks');
  });

  it('clock scale: minutes / hours (seconds only when asked)', async () => {
    const r = await renderKind(DurationFill, { ...fever, config: { scale: 'clock', defaultUnit: 'minutes', display: 'chips' } }, null);
    expect(r.byText('Minutes')).toBeTruthy();
    expect(r.byText('Hours')).toBeTruthy();
    expect(() => r.byText('Seconds')).toThrow();
    expect(() => r.byText('Days')).toThrow();
    const s = await renderKind(DurationFill, { ...fever, config: { scale: 'clock', defaultUnit: 'seconds', display: 'chips' } }, null);
    await s.click(s.byText('10'));
    expect(s.last()).toEqual({ amount: 10, unit: 'seconds' });
  });

  it('legacy layout by default: a number box and the unit as a dropdown (pf-select, never a native select)', async () => {
    const r = await renderKind(DurationFill, feverBox, null);
    const box = r.el.querySelector('input.fe-durbox__num') as HTMLInputElement;
    expect(box.getAttribute('inputmode')).toBe('numeric');
    expect(r.el.querySelector('.fe-durbox pf-select')).not.toBeNull();
    expect(r.el.querySelector('select')).toBeNull();
    box.value = '3';
    box.dispatchEvent(new Event('input'));
    await r.stable();
    expect(r.last()).toEqual({ amount: 3, unit: 'days' });
    expect(r.el.querySelector('.fe-dur__says')?.textContent?.trim()).toBe('3 days');
    const range = await renderKind(DurationFill, { ...feverBox, config: { mode: 'range' } }, { amount: 2, valueTo: 4, unit: 'weeks' });
    const boxes = [...range.el.querySelectorAll<HTMLInputElement>('input.fe-durbox__num')].map((b) => b.value);
    expect(boxes).toEqual(['2', '4']);
  });

  it('period scale: one tap writes the plain word; again clears', async () => {
    const r = await renderKind(DurationFill, { ...fever, config: { scale: 'period' } }, null);
    expect(r.el.querySelector('[role="radiogroup"]')?.getAttribute('aria-labelledby')).toBe('lbl');
    await r.click(r.byText('Night'));
    expect(r.last()).toBe('night');
    await r.click(r.byText('Night'));
    expect(r.last()).toBeUndefined();
  });

  it('disabled: nothing is written', async () => {
    const r = await renderKind(DurationFill, fever, { amount: 5, unit: 'days' });
    await r.setDisabled(true);
    for (const b of r.buttons()) expect(b.disabled).toBe(true);
    expect(r.calls).toEqual([]);
  });
});
