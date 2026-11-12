import { examplesOf } from '../../testing/examples';
import { f, renderKind, unnamed, untouchable } from '../../testing/render-kind';
import { PlotChartFill } from './plotChart.fill';

const growth = f('growth', 'plotChart', { config: { preset: 'growth', measures: ['weight', 'height'] } });
const audio = f('hearing', 'plotChart', { config: { preset: 'audiogram' } });
const labour = f('labour', 'plotChart', { config: { preset: 'partograph' } });

describe('plotChart fill', () => {
  it.each(examplesOf('plotChart').map((e) => [e.name, e] as const))('renders the catalogue example "%s"', async (_n, ex) => {
    const r = await renderKind(PlotChartFill, ex.field, ex.answers[ex.field.key]);
    expect(untouchable(r.el)).toEqual([]);
    expect(unnamed(r.el)).toEqual([]);
    expect(r.el.querySelector('svg.fe-chart')).not.toBeNull();
  });

  describe('growth', () => {
    it('asks for the sex first; the sex alone is kept but is not yet an answer to plot', async () => {
      const r = await renderKind(PlotChartFill, growth, null);
      expect(r.el.querySelector('svg.fe-chart')).toBeNull();
      expect(r.el.querySelector('[data-hint="growth"]')?.textContent).toContain('Choose boy or girl');
      await r.click('[data-sex="girl"]');
      expect(r.last()).toEqual({ sex: 'girl' });
      await r.click('[data-sex="girl"]'); // tap again to take it back
      expect(r.last()).toBeUndefined();
    });

    it('adds a reading from years, months and the value on the number pad, and says its centile band', async () => {
      const r = await renderKind(PlotChartFill, growth, { sex: 'girl' });
      expect(r.el.querySelector<HTMLButtonElement>('[data-act="add-point"]')!.disabled).toBe(true);
      await r.click('[data-entry="years"]');
      await r.click(r.byText('1', '.fe-pad__key'));
      await r.click('[data-entry="months"]');
      await r.click(r.byText('6', '.fe-pad__key'));
      await r.click('[data-entry="value"]');
      for (const k of ['1', '1', '.', '2']) await r.click(r.byText(k, '.fe-pad__key'));
      expect(r.el.querySelector('[data-entry="value"]')?.textContent).toContain('11.2');
      await r.click('[data-act="add-point"]');
      expect(r.last()).toEqual({ sex: 'girl', points: [{ measure: 'weight', age: 18, value: 11.2 }] });
      expect(r.el.querySelector('svg.fe-chart')).not.toBeNull();
      expect(r.el.querySelector('[data-point="0"]')?.textContent).toContain('18 months: 11.2 kg, 75th-90th centile');
    });

    it('plots each measure on its own chart and removes a reading', async () => {
      const r = await renderKind(PlotChartFill, growth, {
        sex: 'girl',
        points: [{ measure: 'weight', age: 12, value: 9.4 }, { measure: 'height', age: 18, value: 81 }],
      });
      expect(r.el.querySelectorAll('[data-point]')).toHaveLength(1);
      expect(r.el.querySelector('[data-point="0"]')?.textContent).toContain('9.4 kg');
      await r.click('[data-measure="height"]');
      expect(r.el.querySelector('[data-point="0"]')?.textContent).toContain('81 cm');
      await r.click(r.el.querySelector('[data-point="0"] button')!);
      expect(r.last()).toEqual({ sex: 'girl', points: [{ measure: 'weight', age: 12, value: 9.4 }] });
    });

    it('a single-measure chart shows no measure chips', async () => {
      const r = await renderKind(PlotChartFill, f('g', 'plotChart', { config: { preset: 'growth', measures: ['head'] } }), { sex: 'boy' });
      expect(r.el.querySelector('[data-measure]')).toBeNull();
    });
  });

  describe('audiogram', () => {
    const value = {
      right: { air: { '250': 40, '500': 45, '1000': 45, '2000': 50, '4000': 50, '8000': 60 }, bone: { '500': 40, '1000': 40, '2000': 45, '4000': 50 } },
    };

    it('works out the average, grade and type as the thresholds are entered', async () => {
      const r = await renderKind(PlotChartFill, audio, value);
      expect(r.el.querySelector('[data-result="ear"]')?.textContent?.trim()).toBe('Right ear: moderate sensorineural hearing loss (PTA 48 dB)');
      await r.click('[data-ear="left"]');
      expect(r.el.querySelector('[data-result="ear"]')?.textContent).toContain('The average and grade appear');
    });

    it('an empty box starts at 20 dB and then steps by 5; Clear takes it away', async () => {
      const r = await renderKind(PlotChartFill, audio, null);
      await r.click('[data-cell="air-1000"]');
      await r.click('[data-act="more"]');
      expect(r.last()).toEqual({ right: { air: { '1000': 20 } } });
      await r.click('[data-act="more"]');
      await r.click('[data-act="more"]');
      expect(r.last()).toEqual({ right: { air: { '1000': 30 } } });
      await r.click('[data-act="less"]');
      expect(r.last()).toEqual({ right: { air: { '1000': 25 } } });
      await r.click('[data-act="clear-cell"]');
      expect(r.last()).toBeUndefined();
    });

    it('stays inside -10 to 120 dB, and each ear keeps its own thresholds', async () => {
      const r = await renderKind(PlotChartFill, audio, { right: { air: { '500': 120 } } });
      await r.click('[data-cell="air-500"]');
      await r.click('[data-act="more"]');
      expect(r.last()).toEqual({ right: { air: { '500': 120 } } });
      await r.click('[data-ear="left"]');
      await r.click('[data-cell="bone-2000"]');
      await r.click('[data-act="less"]');
      await r.click('[data-act="less"]');
      expect(r.last()).toEqual({ right: { air: { '500': 120 } }, left: { bone: { '2000': 15 } } }); // empty -> 20, then one step down
    });

    it('says when the type cannot be told for lack of bone conduction', async () => {
      const r = await renderKind(PlotChartFill, audio, { right: { air: { '500': 30, '1000': 30, '2000': 35, '4000': 35 } } });
      expect(r.el.querySelector('[data-result="ear"]')?.textContent).toContain('mild hearing loss (PTA 33 dB), type not assessed');
    });
  });

  describe('partograph', () => {
    it('shows where the alert and action lines were crossed', async () => {
      const r = await renderKind(PlotChartFill, labour, { readings: [{ hour: 0, dilatation: 4 }, { hour: 4, dilatation: 5 }, { hour: 8, dilatation: 6 }] });
      const flags = [...r.el.querySelectorAll('.fe-pc__flag')].map((x) => x.textContent?.trim());
      expect(flags).toEqual(['Crossed the alert line at 4 h', 'Crossed the action line at 8 h']);
    });

    it('adds a reading one hour after the last, and a value typed on the pad is kept within its range', async () => {
      const r = await renderKind(PlotChartFill, labour, null);
      await r.click('[data-act="add-reading"]');
      expect(r.last()).toEqual({ readings: [{ hour: 0 }] });
      await r.click('[data-act="add-reading"]');
      expect((r.last() as { readings: { hour: number }[] }).readings.map((x) => x.hour)).toEqual([0, 1]);
      await r.click('[data-cell="1-fhr"]');
      await r.click(r.byText('1', '.fe-pad__key')); // on the way to 140 the pad passes through 1: held at the lowest sensible value
      expect((r.last() as { readings: { fhr: number }[] }).readings[1].fhr).toBe(30);
      await r.click(r.byText('4', '.fe-pad__key'));
      await r.click(r.byText('0', '.fe-pad__key'));
      expect((r.last() as { readings: { fhr: number }[] }).readings[1].fhr).toBe(140);
      await r.click('[data-cell="1-descent"]');
      for (const k of ['9']) await r.click(r.byText(k, '.fe-pad__key'));
      expect((r.last() as { readings: { descent: number }[] }).readings[1].descent).toBe(5);
    });

    it('removes a reading', async () => {
      const r = await renderKind(PlotChartFill, labour, { readings: [{ hour: 0, dilatation: 4 }, { hour: 2, dilatation: 5 }] });
      await r.click('[aria-label="Remove reading 1"]');
      expect(r.last()).toEqual({ readings: [{ hour: 2, dilatation: 5 }] });
    });
  });

  it('a locked control changes nothing', async () => {
    const r = await renderKind(PlotChartFill, audio, null);
    await r.setDisabled(true);
    expect([...r.el.querySelectorAll<HTMLButtonElement>('[data-cell]')].every((b) => b.disabled)).toBe(true);
  });
});
