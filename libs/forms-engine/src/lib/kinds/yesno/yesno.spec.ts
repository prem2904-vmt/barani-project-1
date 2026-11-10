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
});
