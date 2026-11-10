import { examplesOf } from '../../testing/examples';
import { f, renderKind, unnamed, untouchable } from '../../testing/render-kind';
import { MULTI_CHIPS_MAX, MultiFill } from './multi.fill';

const triggers = f('trig', 'multi', {
  label: 'Aggravated by',
  options: [
    { key: 'dust', label: 'Dust' },
    { key: 'cold', label: 'Cold weather' },
    { key: 'exercise', label: 'Exercise' },
  ],
});

describe('multi fill', () => {
  it.each(examplesOf('multi').map((e) => [e.name, e] as const))(
    'renders the catalogue example "%s"',
    async (_n, ex) => {
      const r = await renderKind(MultiFill, ex.field, ex.answers[ex.field.key]);
      const on = [...r.el.querySelectorAll('[aria-checked="true"]')].map((b) => b.getAttribute('data-option'));
      expect(on).toEqual(ex.answers[ex.field.key]);
      expect(untouchable(r.el)).toEqual([]);
      expect(unnamed(r.el)).toEqual([]);
    },
  );

  it('toggles chips; keeps the form order; none left → cleared', async () => {
    const r = await renderKind(MultiFill, triggers, null);
    expect(r.el.querySelector('[role="group"]')!.getAttribute('aria-labelledby')).toBe('lbl');
    await r.click(r.byText('Exercise'));
    await r.click(r.byText('Dust'));
    expect(r.last()).toEqual(['dust', 'exercise']);
    await r.click(r.byText('Dust'));
    expect(r.last()).toEqual(['exercise']);
    await r.click(r.byText('Exercise'));
    expect(r.last()).toBeUndefined();
  });

  it('reads a stored key in any case', async () => {
    const r = await renderKind(MultiFill, triggers, ['DUST']);
    expect(r.byText('Dust').getAttribute('aria-checked')).toBe('true');
  });

  it('legacy cards: one full-width card per option, a round tick, follow-ups inside the chosen card', async () => {
    const complaints = f('cc', 'multi', {
      label: 'Chief complaints',
      options: [
        {
          key: 'block',
          label: 'Nasal obstruction',
          description: 'Blocked nose',
          icon: 'wind',
          subFields: [f('blockSide', 'text', { label: 'Which side?' })],
        },
        { key: 'pain', label: 'Pain' },
      ],
    });
    const r = await renderKind(MultiFill, complaints, ['block']);
    const cards = r.el.querySelectorAll('.fe-card');
    expect(cards.length).toBe(2);
    expect(cards[0].classList).toContain('fe-card--on');
    expect(cards[0].querySelector('.fe-card__icon')?.textContent?.trim()).toBe('N'); // never the font-icon word
    expect(cards[0].querySelector('.fe-card__body [data-field="blockSide"]')).not.toBeNull();
    expect(cards[1].querySelector('.fe-card__body')).toBeNull();
    expect(cards[0].querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe('true');
  });

  it('a long dropdown list uses the searchable pf-select; a short one stays chips', async () => {
    const long = f('m', 'multi', {
      label: 'Drugs',
      config: { display: 'dropdown' },
      options: Array.from({ length: MULTI_CHIPS_MAX + 1 }, (_, i) => ({ key: `d${i}`, label: `Drug ${i}` })),
    });
    expect((await renderKind(MultiFill, long, null)).el.querySelector('pf-select')).not.toBeNull();
    const short = { ...triggers, config: { display: 'dropdown' } };
    expect((await renderKind(MultiFill, short, null)).el.querySelector('pf-select')).toBeNull();
  });
});
