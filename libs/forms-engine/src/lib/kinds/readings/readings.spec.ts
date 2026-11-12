import { examplesOf } from '../../testing/examples';
import { f, renderKind, unnamed, untouchable, vi } from '../../testing/render-kind';
import { ReadingsFill, columnsOf, shiftStamp, stamp, stampLabel } from './readings.fill';
import { columnKey } from './readings.studio';

const vitals = f('vitals', 'readings', {
  config: {
    columns: [
      { key: 'pulse', label: 'Pulse', unit: 'bpm', min: 30, max: 220 },
      { key: 'temp', label: 'Temperature', unit: '°F', min: 93, max: 108, step: 0.1 },
    ],
  },
});

describe('readings fill', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 12, 9, 5));
  });
  afterEach(() => vi.useRealTimers());

  it.each(examplesOf('readings').map((e) => [e.name, e] as const))('renders the catalogue example "%s"', async (_n, ex) => {
    const r = await renderKind(ReadingsFill, ex.field, ex.answers[ex.field.key]);
    expect(untouchable(r.el)).toEqual([]);
    expect(unnamed(r.el)).toEqual([]);
    expect(r.el.querySelectorAll('[data-row]').length).toBeGreaterThan(0);
  });

  it('a first reading is stamped with the time now', async () => {
    const r = await renderKind(ReadingsFill, vitals, null);
    expect(r.el.querySelector('[data-row]')).toBeNull();
    await r.click('[data-act="add"]');
    expect(r.last()).toEqual({ rows: [{ time: '2026-11-12T09:05', values: {} }] });
    expect(r.el.querySelector('[data-act="time"]')?.textContent?.trim()).toBe('09:05');
  });

  it('a value is typed on the pad, with decimals only where the column steps by a fraction', async () => {
    const r = await renderKind(ReadingsFill, vitals, { rows: [{ time: '2026-11-12T08:00', values: {} }] });
    await r.click('[data-cell="0-pulse"]');
    expect(r.el.querySelector('[aria-label="Delete last digit"]')).not.toBeNull();
    expect(r.el.querySelector('[aria-label="decimal point"]')).toBeNull();
    for (const k of ['9', '6']) await r.click(r.byText(k, '.fe-pad__key'));
    expect(r.last()).toEqual({ rows: [{ time: '2026-11-12T08:00', values: { pulse: 96 } }] });
    await r.click('[data-cell="0-temp"]');
    expect(r.el.querySelector('[aria-label="decimal point"]')).not.toBeNull();
    for (const k of ['1', '0', '1', '.', '2']) await r.click(r.byText(k, '.fe-pad__key'));
    expect(r.last()).toEqual({ rows: [{ time: '2026-11-12T08:00', values: { pulse: 96, temp: 101.2 } }] });
  });

  it('never holds a value below the column\'s lowest on the way to a longer number', async () => {
    const r = await renderKind(ReadingsFill, vitals, { rows: [{ time: '2026-11-12T08:00', values: {} }] });
    await r.click('[data-cell="0-pulse"]');
    await r.click(r.byText('7', '.fe-pad__key'));
    expect((r.last() as { rows: { values: { pulse: number } }[] }).rows[0].values.pulse).toBe(30);
    await r.click(r.byText('2', '.fe-pad__key'));
    expect((r.last() as { rows: { values: { pulse: number } }[] }).rows[0].values.pulse).toBe(72);
  });

  it('the time moves by 15 minutes, an hour or a day, and the rows go back in time order when the editor closes', async () => {
    const r = await renderKind(ReadingsFill, vitals, { rows: [{ time: '2026-11-12T08:00', values: { pulse: 80 } }, { time: '2026-11-12T10:00', values: { pulse: 90 } }] });
    await r.click('[data-row="0"] [data-act="time"]');
    await r.click('[data-shift="60"]');
    await r.click('[data-shift="60"]');
    await r.click('[data-shift="15"]');
    expect((r.last() as { rows: { time: string }[] }).rows.map((x) => x.time)).toEqual(['2026-11-12T10:15', '2026-11-12T10:00']);
    await r.click('[data-row="0"] [data-act="time"]'); // close: sorted
    expect((r.last() as { rows: { time: string }[] }).rows.map((x) => x.time)).toEqual(['2026-11-12T10:00', '2026-11-12T10:15']);
  });

  it('shows the date for a reading that is not from today', async () => {
    const r = await renderKind(ReadingsFill, vitals, { rows: [{ time: '2026-11-11T22:30', values: { pulse: 70 } }] });
    expect(r.el.querySelector('[data-act="time"]')?.textContent?.trim()).toBe('11 Nov 22:30');
  });

  it('removing a reading with values asks first; an empty one goes at once', async () => {
    let asked = 0;
    const dialog = { confirm: async () => (asked++, true) };
    const r = await renderKind(ReadingsFill, vitals, { rows: [{ time: '2026-11-12T08:00', values: { pulse: 80 } }, { time: '2026-11-12T09:00', values: {} }] }, { dialog });
    await r.click('[data-row="1"] .fe-iconbtn');
    expect(asked).toBe(0);
    expect(r.last()).toEqual({ rows: [{ time: '2026-11-12T08:00', values: { pulse: 80 } }] });
    await r.click('[data-row="0"] .fe-iconbtn');
    expect(asked).toBe(1);
    expect(r.last()).toBeUndefined();
  });

  it('a locked control changes nothing', async () => {
    const r = await renderKind(ReadingsFill, vitals, { rows: [{ time: '2026-11-12T08:00', values: {} }] });
    await r.setDisabled(true);
    expect(r.el.querySelector<HTMLButtonElement>('[data-act="add"]')!.disabled).toBe(true);
    expect(r.el.querySelector<HTMLButtonElement>('[data-cell="0-pulse"]')!.disabled).toBe(true);
  });
});

describe('readings helpers', () => {
  it('moves a stamp across midnight and month ends', () => {
    expect(shiftStamp('2026-11-12T23:45', 30)).toBe('2026-11-13T00:15');
    expect(shiftStamp('2026-11-30T23:00', 120)).toBe('2026-12-01T01:00');
    expect(shiftStamp('2026-11-12T00:10', -15)).toBe('2026-11-11T23:55');
    expect(stamp(new Date(2026, 0, 2, 3, 4))).toBe('2026-01-02T03:04');
    expect(stampLabel('2026-11-12T08:05', '2026-11-12')).toBe('08:05');
  });

  it('reads the columns a question defines, ignoring broken ones', () => {
    const c = columnsOf({ columns: [{ key: 'a', label: 'A', role: 'intake', step: 0.5 }, { key: 3 }, { label: 'x' }] });
    expect(c).toEqual([{ key: 'a', label: 'A', unit: '', min: undefined, max: undefined, step: 0.5, role: 'intake' }]);
  });

  it('makes column keys from words, never twice', () => {
    expect(columnKey('Urine output', [])).toBe('urineOutput');
    expect(columnKey('Urine output', ['urineOutput'])).toBe('urineOutput2');
    expect(columnKey('24 h', [])).toBe('reading24H');
  });
});
