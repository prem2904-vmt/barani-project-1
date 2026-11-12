import { examplesOf } from '../../testing/examples';
import { f, renderKind, unnamed, untouchable } from '../../testing/render-kind';
import { YesnoFill } from './yesno.fill';

describe('yesno fill', () => {
  it.each(examplesOf('yesno').map((e) => [e.name, e] as const))(
    'renders the catalogue example "%s"',
    async (_n, ex) => {
      const r = await renderKind(YesnoFill, ex.field, ex.answers[ex.field.key]);
      expect(r.el.querySelector('[aria-checked="true"]')).not.toBeNull();
      expect(untouchable(r.el)).toEqual([]);
      expect(unnamed(r.el)).toEqual([]);
    },
  );

  it('two big buttons; one tap answers; tap again clears', async () => {
    const r = await renderKind(YesnoFill, f('fever', 'yesno', { label: 'Fever' }), null);
    expect(r.el.querySelectorAll('[role="radio"]').length).toBe(2);
    await r.click(r.byText('Yes'));
    expect(r.last()).toBe('yes');
    await r.click(r.byText('No'));
    expect(r.last()).toBe('no');
    await r.click(r.byText('No'));
    expect(r.last()).toBeUndefined();
  });

  it('Not applicable when the form allows it; option labels are used', async () => {
    const r = await renderKind(
      YesnoFill,
      f('alt', 'yesno', {
        label: 'Alternates?',
        config: { allowNa: true },
        options: [
          { key: 'yes', label: 'Yes, alternates' },
          { key: 'no', label: 'No' },
        ],
      }),
      'NA',
    );
    expect(r.byText('Not applicable').getAttribute('aria-checked')).toBe('true');
    expect(r.byText('Yes, alternates')).toBeTruthy();
  });

  it('G6: a tick box is ONE small switch with the question beside it, no box or card (legacy checkbox)', async () => {
    const r = await renderKind(YesnoFill, f('pulses', 'yesno', { label: 'All peripheral pulses felt', config: { display: 'check' } }), null);
    expect(r.el.querySelector('.fe-switch--sm')).not.toBeNull();
    expect(r.el.querySelector('.fe-checkrow__box')).toBeNull();
    expect(r.el.textContent).toContain('All peripheral pulses felt');
    expect(r.el.textContent).not.toContain('Option 1');
  });

  it('tick box and switch store true / false', async () => {
    const chk = await renderKind(
      YesnoFill,
      f('smoker', 'yesno', { label: 'Smoker', config: { display: 'check' } }),
      null,
    );
    const box = chk.el.querySelector('[role="checkbox"]')!;
    expect(box.getAttribute('aria-checked')).toBe('false');
    await chk.click(box);
    expect(chk.last()).toBe(true);
    expect(box.getAttribute('aria-checked')).toBe('true');
    await chk.click(box);
    expect(chk.last()).toBe(false);

    const sw = await renderKind(YesnoFill, f('s', 'yesno', { label: 'Allergic', config: { display: 'switch' } }), true);
    expect(sw.el.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('true');
    await sw.click('[role="switch"]');
    expect(sw.last()).toBe(false);
    expect(untouchable(sw.el)).toEqual([]);
  });

  it('legacy yesNoNa shows the question\'s own words and tones Yes green / No red', async () => {
    const taken = f('bp', 'yesno', {
      label: 'BP',
      options: [
        { key: 'taken', label: 'Taken' },
        { key: 'not_taken', label: 'Not taken' },
      ],
    });
    const r = await renderKind(YesnoFill, taken, null);
    expect(r.el.querySelectorAll('[role="radio"]').length).toBe(2);
    await r.click(r.byText('Not taken'));
    expect(r.last()).toBe('not_taken');
    const yn = await renderKind(YesnoFill, f('x', 'yesno', { label: 'X', options: [{ key: 'yes', label: 'Yes' }, { key: 'no', label: 'No' }] }), 'no');
    expect(yn.el.querySelector('[data-option="yes"]')!.getAttribute('data-tone')).toBe('yes');
    expect(yn.el.querySelector('[data-option="no"]')!.getAttribute('data-tone')).toBe('no');
    expect(yn.el.querySelectorAll('[role="radio"]').length).toBe(2);
  });

  it('a legacy toggle is a three-position slider: option A, a dash that clears, option B', async () => {
    const t = f('hearing', 'yesno', {
      label: 'Hearing',
      config: { display: 'switch', labelFallback: true },
      options: [
        { key: 'impaired', label: 'Impaired' },
        { key: 'normal', label: 'Normal' },
      ],
    });
    const r = await renderKind(YesnoFill, t, null);
    expect(r.el.querySelector('.fe-tslider--center')).not.toBeNull();
    expect(r.el.querySelectorAll('.fe-tslider__opt').length).toBe(3);
    await r.click(r.byText('Normal'));
    expect(r.last()).toBe('normal');
    const on = await renderKind(YesnoFill, t, 'impaired');
    expect(on.el.querySelector('.fe-tslider--left')).not.toBeNull();
    await on.click('.fe-tslider__none');
    expect(on.last()).toBeUndefined();
  });
});
