import { examplesOf } from '../../testing/examples';
import { f, renderKind, unnamed, untouchable } from '../../testing/render-kind';
import { ShorthandFill } from './shorthand.fill';
import { writeShorthand } from './shorthand-math';

const field = (preset: string, extra: Record<string, unknown> = {}) =>
  f('sh', 'shorthand', { label: 'Shorthand', config: { preset, ...extra } });

describe('shorthand fill', () => {
  it.each(examplesOf('shorthand').map((e) => [e.name, e] as const))(
    'renders the catalogue example "%s" and shows what it will write',
    async (_n, ex) => {
      const value = ex.answers[ex.field.key] as Record<string, unknown>;
      const r = await renderKind(ShorthandFill, ex.field, value);
      expect(r.el.querySelector('[data-says]')?.textContent).toContain(writeShorthand(String(ex.field.config?.['preset']), value));
      expect(untouchable(r.el)).toEqual([]);
      expect(unnamed(r.el)).toEqual([]);
    },
  );

  describe('obstetric score', () => {
    it('has G P L A boxes; the first tap writes 0, the next 1', async () => {
      const r = await renderKind(ShorthandFill, field('obstetricScore'), null);
      expect([...r.el.querySelectorAll('[data-box]')].map((b) => b.getAttribute('data-box'))).toEqual(['g', 'p', 'l', 'a']);
      await r.click('[aria-label="More G"]');
      expect(r.last()).toEqual({ g: 0 });
      await r.click('[aria-label="More G"]');
      expect(r.last()).toEqual({ g: 1 });
      await r.click('[aria-label="More P"]');
      expect(r.last()).toEqual({ g: 1, p: 0 });
    });

    it('the D box only shows when the case sheet asks for deaths', async () => {
      const r = await renderKind(ShorthandFill, field('obstetricScore', { deaths: true }), null);
      expect(r.el.querySelector('[data-box="d"]')).not.toBeNull();
    });

    it('typing on the number pad writes the number; Clear leaves no answer', async () => {
      const r = await renderKind(ShorthandFill, field('obstetricScore'), null);
      await r.click('[data-box="g"] .fe-numbox');
      await r.click(r.byText('3'));
      expect(r.last()).toEqual({ g: 3 });
      await r.click(r.byText('Clear'));
      expect(r.last()).toBeUndefined();
    });

    it('warns (never blocks) when births are more than pregnancies', async () => {
      const r = await renderKind(ShorthandFill, field('obstetricScore'), { g: 1, p: 2 });
      expect(r.el.querySelector('[data-warning="p>g"]')?.textContent).toContain('More births');
      for (const b of r.buttons()) expect(b.disabled).toBe(false);
      await r.click('[aria-label="More A"]');
      expect(r.last()).toEqual({ g: 1, p: 2, a: 0 });
    });

    it('writes the notation under the boxes', async () => {
      const r = await renderKind(ShorthandFill, field('obstetricScore'), { g: 3, p: 2, l: 2, a: 0 });
      expect(r.el.querySelector('[data-says]')?.textContent).toContain('G3 P2 L2 A0');
    });
  });

  describe('periods', () => {
    it('bleeding and cycle start at 5 and 28; regular / irregular toggles', async () => {
      const r = await renderKind(ShorthandFill, field('menstrual'), null);
      await r.click('[aria-label="More Bleeding"]');
      await r.click('[aria-label="More Cycle"]');
      expect(r.last()).toEqual({ flowDays: 5, cycleDays: 28 });
      await r.click('[data-option="regular"]');
      expect(r.last()).toEqual({ flowDays: 5, cycleDays: 28, regularity: 'regular' });
      await r.click('[data-option="regular"]');
      expect(r.last()).toEqual({ flowDays: 5, cycleDays: 28 });
      expect(r.el.querySelector('[data-says]')?.textContent).toContain('5/28 days');
    });

    it('the last period is asked unless the case sheet turns it off', async () => {
      expect((await renderKind(ShorthandFill, field('menstrual'), null)).el.querySelector('[data-box="lmp"]')).not.toBeNull();
      expect((await renderKind(ShorthandFill, field('menstrual', { lmp: false }), null)).el.querySelector('[data-box="lmp"]')).toBeNull();
    });
  });

  describe('vision', () => {
    it('picks a distance line, taps again to clear, and keeps near vision apart', async () => {
      const r = await renderKind(ShorthandFill, field('visualAcuity'), null);
      await r.click('[data-box="distance"] [data-option="6/9"]');
      expect(r.last()).toEqual({ distance: '6/9' });
      await r.click('[data-box="near"] [data-option="N6"]');
      expect(r.last()).toEqual({ distance: '6/9', near: 'N6' });
      await r.click('[data-box="distance"] [data-option="6/9"]');
      expect(r.last()).toEqual({ near: 'N6' });
      expect(r.el.querySelector('[data-says]')?.textContent).toContain('N6');
    });

    it('offers CF, HM, PL and NPL after the Snellen lines', async () => {
      const r = await renderKind(ShorthandFill, field('visualAcuity'), null);
      const options = [...r.el.querySelectorAll('[data-box="distance"] [data-option]')].map((b) => b.getAttribute('data-option'));
      expect(options).toEqual(['6/6', '6/9', '6/12', '6/18', '6/24', '6/36', '6/60', 'CF', 'HM', 'PL', 'NPL']);
    });

    it('"With glasses" is a switch', async () => {
      const r = await renderKind(ShorthandFill, field('visualAcuity'), { distance: '6/12' });
      const sw = r.el.querySelector('[data-box="glasses"] [role="switch"]') as HTMLElement;
      expect(sw.getAttribute('aria-checked')).toBe('false');
      await r.click(sw);
      expect(r.last()).toEqual({ distance: '6/12', glasses: true });
      expect(r.el.querySelector('[data-says]')?.textContent).toContain('6/12, with glasses');
      await r.click(r.el.querySelector('[data-box="glasses"] [role="switch"]')!);
      expect(r.last()).toEqual({ distance: '6/12' });
    });

    it('the case sheet can drop near, pinhole and glasses', async () => {
      const r = await renderKind(ShorthandFill, field('visualAcuity', { near: false, pinhole: false, glasses: false }), null);
      for (const b of ['near', 'pinhole', 'glasses']) expect(r.el.querySelector(`[data-box="${b}"]`), b).toBeNull();
    });
  });

  describe('glasses power', () => {
    it('steps in quarters from plano; the sign chips make it minus', async () => {
      const r = await renderKind(ShorthandFill, field('refraction'), null);
      await r.click('[aria-label="More Sphere"]');
      expect(r.last()).toEqual({ sph: 0 });
      await r.click('[aria-label="Less Sphere"]');
      expect(r.last()).toEqual({ sph: -0.25 });
      await r.click('[aria-label="Less Sphere"]');
      expect(r.last()).toEqual({ sph: -0.5 });
      await r.click('[aria-label="Plus, Sphere"]');
      expect(r.last()).toEqual({ sph: 0.5 });
    });

    it('a typed value is written once it sits on a quarter, and Done rounds the rest', async () => {
      const r = await renderKind(ShorthandFill, field('refraction'), null);
      await r.click('[aria-label="Minus, Cylinder"]');
      await r.click('[data-box="cyl"] .fe-numbox');
      await r.click(r.byText('1'));
      expect(r.last()).toEqual({ cyl: -1 });
      await r.click('[aria-label="decimal point"]');
      await r.click(r.byText('1'));
      expect(r.last()).toEqual({ cyl: -1 }); // 1.1 is off the step: nothing new is written
      await r.click(r.byText('Done'));
      expect(r.last()).toEqual({ cyl: -1 }); // rounded to the nearest quarter
      await r.setValue({ cyl: -1 });
      expect(r.el.querySelector('[data-says]')?.textContent).toContain('-1.00 DC');
    });

    it('axis starts at 90 and stays within 0 to 180', async () => {
      const r = await renderKind(ShorthandFill, field('refraction'), null);
      await r.click('[aria-label="More Axis"]');
      expect(r.last()).toEqual({ axis: 90 });
      await r.setValue({ axis: 180 });
      expect((r.el.querySelector('[aria-label="More Axis"]') as HTMLButtonElement).disabled).toBe(true);
    });

    it('the reading add is asked unless switched off', async () => {
      expect((await renderKind(ShorthandFill, field('refraction'), null)).el.querySelector('[data-box="add"]')).not.toBeNull();
      expect((await renderKind(ShorthandFill, field('refraction', { add: false }), null)).el.querySelector('[data-box="add"]')).toBeNull();
    });

    it('writes the full notation under the boxes', async () => {
      const r = await renderKind(ShorthandFill, field('refraction'), { sph: -1.25, cyl: -0.5, axis: 180 });
      expect(r.el.querySelector('[data-says]')?.textContent).toContain('-1.25 / -0.50 x 180');
      expect(r.el.querySelector('[data-box="sph"] .fe-numbox__v')?.textContent?.trim()).toBe('-1.25');
    });
  });

  describe('muscle power', () => {
    it('picks a grade and a sign; a grade that cannot carry the sign drops it', async () => {
      const r = await renderKind(ShorthandFill, field('musclePower'), null);
      await r.click('[data-box="grade"] [data-option="4"]');
      expect(r.last()).toEqual({ grade: 4 });
      await r.click('[data-box="sign"] [data-option="+"]');
      expect(r.last()).toEqual({ grade: 4, sign: '+' });
      expect(r.el.querySelector('[data-says]')?.textContent).toContain('4+/5');
      await r.click('[data-box="grade"] [data-option="5"]');
      expect(r.last()).toEqual({ grade: 5 });
    });

    it('no sign on 0, no plus on 5, none before a grade is picked', async () => {
      const r = await renderKind(ShorthandFill, field('musclePower'), null);
      const off = (s: string) => (r.el.querySelector(`[data-box="sign"] [data-option="${s}"]`) as HTMLButtonElement).disabled;
      expect([off('+'), off('-')]).toEqual([true, true]);
      await r.click('[data-box="grade"] [data-option="5"]');
      expect([off('+'), off('-')]).toEqual([true, false]);
      await r.click('[data-box="grade"] [data-option="0"]');
      expect([off('+'), off('-')]).toEqual([true, true]);
    });

    it('tapping the chosen grade again clears the answer', async () => {
      const r = await renderKind(ShorthandFill, field('musclePower'), { grade: 3, sign: '-' });
      await r.click('[data-box="grade"] [data-option="3"]');
      expect(r.last()).toBeUndefined();
    });
  });

  it('disabled: every box is locked and nothing is written', async () => {
    const r = await renderKind(ShorthandFill, field('obstetricScore'), { g: 2 });
    await r.setDisabled(true);
    for (const b of r.buttons()) expect(b.disabled).toBe(true);
    expect(r.calls).toEqual([]);
  });
});
