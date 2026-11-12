import { examplesOf } from '../../testing/examples';
import { f, renderKind, unnamed, untouchable } from '../../testing/render-kind';
import { addDays, approxBirth, display, fromDate, isBirthDate, parseIso, spoken, toIso } from './date-math';
import { DateFill } from './date.fill';

const today = () => fromDate(new Date());
const dob = f('onset', 'date', { label: 'Date of onset', config: { allowFuture: false, quickChips: true } });
const birth = f('dob', 'date', { label: 'Date of birth', config: { allowFuture: false, quickChips: true } });

describe('date math (local calendar, no timezone drift)', () => {
  it('parses dates and ISO date-times as written', () => {
    expect(parseIso('1982-03-09')).toEqual({ y: 1982, m: 3, d: 9 });
    expect(parseIso('2024-01-15T00:00:00Z')).toEqual({ y: 2024, m: 1, d: 15 });
    expect(parseIso('2024-02-30')).toBeNull();
    expect(parseIso(42)).toBeNull();
  });
  it('formats', () => {
    expect(toIso({ y: 1982, m: 3, d: 9 })).toBe('1982-03-09');
    expect(display({ y: 1982, m: 3, d: 9 })).toBe('09/03/1982');
    expect(spoken({ y: 1982, m: 3, d: 9 })).toBe('9 March 1982');
    expect(addDays({ y: 2024, m: 3, d: 1 }, -1)).toEqual({ y: 2024, m: 2, d: 29 });
  });
});

describe('date fill', () => {
  it.each(examplesOf('date').map((e) => [e.name, e] as const))('renders the catalogue example "%s"', async (_n, ex) => {
    const r = await renderKind(DateFill, ex.field, ex.answers[ex.field.key]);
    expect(r.el.querySelector('.fe-date__value')?.textContent?.trim()).toBe(
      display(parseIso(ex.answers[ex.field.key])!),
    );
    expect(untouchable(r.el)).toEqual([]);
    expect(unnamed(r.el)).toEqual([]);
  });

  it('is a group named by the label; no native date input', async () => {
    const r = await renderKind(DateFill, dob, null);
    expect(r.el.querySelector('[role="group"]')?.getAttribute('aria-labelledby')).toBe('lbl');
    expect(r.el.querySelector('input')).toBeNull();
  });

  it('quick chips write the local date; tapping again clears', async () => {
    const r = await renderKind(DateFill, dob, null);
    await r.click(r.byText('Today'));
    expect(r.last()).toBe(toIso(today()));
    expect(r.byText('Today').getAttribute('aria-pressed')).toBe('true');
    await r.click(r.byText('Yesterday'));
    expect(r.last()).toBe(toIso(addDays(today(), -1)));
    await r.click(r.byText('1 week ago'));
    expect(r.last()).toBe(toIso(addDays(today(), -7)));
    await r.click(r.byText('1 week ago'));
    expect(r.last()).toBeUndefined();
  });

  it('quickChips false hides the chips', async () => {
    const r = await renderKind(DateFill, { ...dob, config: { quickChips: false } }, null);
    expect(() => r.byText('Today')).toThrow();
    expect(r.byText('Pick a date')).toBeTruthy();
  });

  it('Clear clears', async () => {
    const r = await renderKind(DateFill, dob, '1982-03-09');
    await r.click(r.byText('Clear'));
    expect(r.last()).toBeUndefined();
  });

  it('the inline calendar opens on the chosen month; a day tap writes it and closes', async () => {
    const r = await renderKind(DateFill, dob, '1982-03-09');
    await r.click('[data-pick]');
    const nine = r.el.querySelector('[aria-label="9 March 1982"]') as HTMLButtonElement;
    expect(nine.getAttribute('aria-pressed')).toBe('true');
    expect(r.el.querySelectorAll('.fe-cal__day').length).toBe(31);
    expect(r.el.querySelectorAll('.fe-cal pf-select').length).toBe(2);
    await r.click('[aria-label="Previous month"]');
    await r.click('[aria-label="14 February 1982"]');
    expect(r.last()).toBe('1982-02-14');
    expect(r.el.querySelector('.fe-cal')).toBeNull();
  });

  it('no future dates unless allowed: future days and Next month are disabled', async () => {
    const t = today();
    const r = await renderKind(DateFill, dob, null);
    await r.click('[data-pick]');
    expect((r.el.querySelector('[aria-label="Next month"]') as HTMLButtonElement).disabled).toBe(true);
    const todayBtn = r.el.querySelector('[aria-current="date"]') as HTMLButtonElement;
    expect(todayBtn.getAttribute('aria-label')).toBe(spoken(t) + ', today');
    const tomorrow = addDays(t, 1);
    if (tomorrow.m === t.m) {
      expect((r.el.querySelector(`[aria-label="${spoken(tomorrow)}"]`) as HTMLButtonElement).disabled).toBe(true);
    }
    const free = await renderKind(DateFill, { ...dob, config: { allowFuture: true } }, null);
    await free.click('[data-pick]');
    expect((free.el.querySelector('[aria-label="Next month"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('disabled: nothing is written', async () => {
    const r = await renderKind(DateFill, dob, '1982-03-09');
    await r.setDisabled(true);
    for (const b of r.buttons()) expect(b.disabled).toBe(true);
    expect(r.calls).toEqual([]);
  });

  it('a date of birth is read from the field (dob / birth / born), or an explicit purpose', () => {
    expect(isBirthDate('dob', 'Date of birth')).toBe(true);
    expect(isBirthDate('patientDob', 'DOB')).toBe(true);
    expect(isBirthDate('x', 'Year born')).toBe(true);
    expect(isBirthDate('onset', 'Date of onset')).toBe(false);
    expect(isBirthDate('lmp', 'Last menstrual period')).toBe(false);
    expect(isBirthDate('onset', 'Onset', 'birth')).toBe(true);
    expect(isBirthDate('dob', 'Date of birth', 'event')).toBe(false);
  });
});

describe('date of birth: year first, no recent-day chips', () => {
  it('shows no Today / Yesterday chips and no calendar button', async () => {
    const r = await renderKind(DateFill, birth, null);
    expect(() => r.byText('Today')).toThrow();
    expect(r.el.querySelector('[data-pick]')).toBeNull();
    expect(r.el.querySelector('[data-dob="year"]')?.textContent).toContain('Tap to enter');
  });

  it('year on the pad → month chip → day writes the date', async () => {
    const r = await renderKind(DateFill, birth, null);
    await r.click('[data-dob="year"]');
    for (const k of ['1', '9', '8', '2']) await r.click(r.byText(k, 'fe-numpad button'));
    expect(r.calls).toEqual([]);
    expect(r.el.querySelector('fe-numpad')).toBeNull(); // four digits close the pad
    await r.click('[aria-label="March"]');
    await r.click('[aria-label="9 March 1982"]');
    expect(r.last()).toBe('1982-03-09');
    expect(r.el.querySelector('.fe-date__value')?.textContent?.trim()).toBe('09/03/1982');
  });

  it('a year out of range says so plainly', async () => {
    const r = await renderKind(DateFill, birth, null);
    await r.click('[data-dob="year"]');
    for (const k of ['3', '0', '0', '0']) await r.click(r.byText(k, 'fe-numpad button'));
    expect(r.el.textContent).toContain('Use a year between');
    expect(r.el.querySelector('[aria-label="March"]')).toBeNull();
  });

  it('only the age known → an approximate date of birth', async () => {
    const r = await renderKind(DateFill, birth, null);
    await r.click(r.byText('Only know the age?'));
    await r.click(r.byText('4', 'fe-numpad button'));
    await r.click(r.byText('2', 'fe-numpad button'));
    await r.click(r.byText('Done'));
    expect(r.last()).toBe(toIso(approxBirth(today(), 42)));
  });

  it('a saved date shows with Change / Clear', async () => {
    const r = await renderKind(DateFill, birth, '1982-03-09');
    expect(r.byText('Change')).toBeTruthy();
    await r.click(r.byText('Change'));
    expect(r.el.querySelector('[aria-label="March"]')?.getAttribute('aria-checked')).toBe('true');
    expect(untouchable(r.el)).toEqual([]);
    expect(unnamed(r.el)).toEqual([]);
  });
});

describe('date fill: legacy box (G8)', () => {
  const nav = { goTo: () => undefined, pageTitle: (k: string) => k, isLegacy: () => true };
  const lmp = f('lmp', 'date', { label: 'LMP', config: { allowFuture: true, quickChips: true } });

  it('a text box with a calendar icon instead of the quick chips; the month calendar opens under it', async () => {
    const r = await renderKind(DateFill, lmp, null, { wizard: nav });
    expect(r.el.querySelector('.fe-datebox')).not.toBeNull();
    expect(r.el.textContent).not.toContain('Yesterday');
    expect(r.el.textContent).not.toContain('Pick a date');
    expect(r.el.querySelector('.fe-cal')).toBeNull();
    await r.click('.fe-datebox__in');
    expect(r.el.querySelector('.fe-cal')).not.toBeNull();
  });

  it('typing dd/mm/yyyy writes the date; half a date or an impossible one writes nothing; a future date is fine here', async () => {
    const r = await renderKind(DateFill, lmp, null, { wizard: nav });
    const box = r.el.querySelector<HTMLInputElement>('.fe-datebox__in')!;
    box.value = '10/01/20';
    box.dispatchEvent(new Event('input'));
    await r.stable();
    expect(r.last()).toBeUndefined();
    box.value = '31/02/2025';
    box.dispatchEvent(new Event('input'));
    await r.stable();
    expect(r.last()).toBeUndefined();
    box.value = '10/01/2031';
    box.dispatchEvent(new Event('input'));
    await r.stable();
    expect(r.last()).toBe('2031-01-10');
  });

  it('a new case sheet keeps the quick chips', async () => {
    const r = await renderKind(DateFill, lmp);
    expect(r.el.textContent).toContain('Yesterday');
  });
});
