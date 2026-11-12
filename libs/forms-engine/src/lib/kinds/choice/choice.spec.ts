import { examplesOf } from '../../testing/examples';
import { f, renderKind, unnamed, untouchable } from '../../testing/render-kind';
import { CHOICE_BUTTONS_MAX, ChoiceFill } from './choice.fill';

const side = f('side', 'choice', {
  label: 'Side',
  options: [
    { key: 'left', label: 'Left' },
    { key: 'right', label: 'Right' },
    { key: 'both', label: 'Both' },
  ],
});

describe('choice fill', () => {
  it.each(examplesOf('choice').map((e) => [e.name, e] as const))(
    'renders the catalogue example "%s"',
    async (_n, ex) => {
      const r = await renderKind(ChoiceFill, ex.field, ex.answers[ex.field.key]);
      if (ex.field.config?.['display'] === 'dropdown') {
        // legacy select: the searchable pf-select shows the chosen label
        const label = ex.field.options!.find((o) => o.key === ex.answers[ex.field.key])!.label;
        expect(r.el.querySelector('pf-select')?.textContent).toContain(label);
      } else {
        const on = r.el.querySelector('[aria-checked="true"]');
        expect(on?.getAttribute('data-option')).toBe(ex.answers[ex.field.key]);
      }
      expect(untouchable(r.el)).toEqual([]);
      expect(unnamed(r.el)).toEqual([]);
    },
  );

  it('is a radiogroup named by the field label', async () => {
    const r = await renderKind(ChoiceFill, side, null);
    const g = r.el.querySelector('[role="radiogroup"]')!;
    expect(g.getAttribute('aria-labelledby')).toBe('lbl');
    expect(g.querySelectorAll('[role="radio"]').length).toBe(3);
  });

  it('tap picks, tap again clears', async () => {
    const r = await renderKind(ChoiceFill, side, null);
    await r.click(r.byText('Left'));
    expect(r.last()).toBe('left');
    expect(r.byText('Left').getAttribute('aria-checked')).toBe('true');
    await r.click(r.byText('Right'));
    expect(r.last()).toBe('right');
    await r.click(r.byText('Right'));
    expect(r.last()).toBeUndefined();
  });

  it('matches a stored value case-insensitively', async () => {
    const r = await renderKind(ChoiceFill, side, 'LEFT');
    expect(r.byText('Left').getAttribute('aria-checked')).toBe('true');
  });

  it('legacy layouts: buttons share a row (buttonSelect); list is an equal grid of 2, or 3 when it divides (radio)', async () => {
    expect((await renderKind(ChoiceFill, side, null)).el.querySelector('.fe-chips--row')).not.toBeNull();
    const three = await renderKind(ChoiceFill, { ...side, config: { display: 'list' } }, null);
    expect(three.el.querySelector('.fe-chips--grid.fe-chips--grid3')).not.toBeNull();
    const two = { ...side, options: side.options!.slice(0, 2), config: { display: 'list' } };
    const r2 = await renderKind(ChoiceFill, two, null);
    expect(r2.el.querySelector('.fe-chips--grid')).not.toBeNull();
    expect(r2.el.querySelector('.fe-chips--grid3')).toBeNull();
  });

  it('a dropdown is the searchable pf-select even when short (legacy select)', async () => {
    const r = await renderKind(ChoiceFill, { ...side, config: { display: 'dropdown' } }, null);
    expect(r.el.querySelector('pf-select')).not.toBeNull();
  });

  it('options with icons are full-width cards with a round tick; descriptions alone stay buttons and are not printed (legacy buttonSelect)', async () => {
    const plain = f('seen', 'choice', {
      label: 'Seen at',
      options: [
        { key: 'opd', label: 'OPD', description: 'Walk-in or booked visit' },
        { key: 'ward', label: 'Ward' },
      ],
    });
    const b = await renderKind(ChoiceFill, plain, 'opd');
    expect(b.el.querySelector('.fe-card')).toBeNull();
    expect(b.el.querySelector('.fe-chip__desc')).toBeNull();
    const seen = f('seen', 'choice', {
      label: 'Seen at',
      options: [
        { key: 'opd', label: 'OPD', description: 'Walk-in or booked visit', icon: 'clinic' },
        { key: 'ward', label: 'Ward' },
      ],
    });
    const r = await renderKind(ChoiceFill, seen, 'opd');
    const card = r.el.querySelector('.fe-card.fe-card--on [data-option="opd"]')!;
    expect(card.getAttribute('role')).toBe('radio');
    expect(card.getAttribute('aria-checked')).toBe('true');
    expect(r.el.querySelector('.fe-card__desc')?.textContent).toBe('Walk-in or booked visit');
  });

  it('a dropdown says "Select an option" (legacy select)', async () => {
    const r = await renderKind(
      ChoiceFill,
      f('side', 'choice', { label: 'Side', config: { display: 'dropdown' }, options: [{ key: 'l', label: 'Left' }, { key: 'r', label: 'Right' }] }),
      null,
    );
    expect(r.el.textContent).toContain('Select an option');
  });

  it(`more than ${CHOICE_BUTTONS_MAX} options → the searchable pf-select, never a native select`, async () => {
    const many = f('town', 'choice', {
      label: 'Town',
      options: Array.from({ length: CHOICE_BUTTONS_MAX + 1 }, (_, i) => ({ key: `t${i}`, label: `Town ${i}` })),
    });
    const r = await renderKind(ChoiceFill, many, null);
    expect(r.el.querySelector('pf-select')).not.toBeNull();
    expect(r.el.querySelector('select')).toBeNull();
  });
});
