import { TestBed } from '@angular/core/testing';
import { FeDialog } from '../../kit';
import { examplesOf } from '../../testing/examples';
import { f, renderKind, unnamed, untouchable, vi } from '../../testing/render-kind';
import { RepeatFill } from './repeat.fill';

const ulcers = f('ulcers', 'repeat', {
  label: 'Ulcers',
  config: { minCount: 0, maxCount: 2, defaultCount: 1, labelPrefix: 'Ulcer' },
  children: [
    f('site', 'text', { label: 'Site' }),
    f('base', 'choice', {
      label: 'Base',
      options: [
        { key: 'clean', label: 'Clean' },
        { key: 'slough', label: 'Slough' },
      ],
    }),
  ],
});

describe('repeat fill', () => {
  it.each(examplesOf('repeat').map((e) => [e.name, e] as const))(
    'renders the catalogue example "%s"',
    async (_n, ex) => {
      const r = await renderKind(RepeatFill, ex.field, ex.answers[ex.field.key]);
      expect(r.el.querySelectorAll('.fe-row').length).toBe((ex.answers[ex.field.key] as unknown[]).length);
      expect(untouchable(r.el)).toEqual([]);
      expect(unnamed(r.el)).toEqual([]);
    },
  );

  it('shows the default number of empty cards without saving them', async () => {
    const r = await renderKind(RepeatFill, ulcers, null);
    expect(r.el.querySelectorAll('.fe-row').length).toBe(1);
    expect(r.el.querySelector('.fe-row__title')!.textContent).toContain('Ulcer 1');
    expect(r.calls).toEqual([]);
  });

  it('answering inside a card writes the row; Add another up to the limit', async () => {
    const r = await renderKind(RepeatFill, ulcers, null);
    await r.click(r.byText('Clean'));
    expect(r.last()).toEqual([{ base: 'clean' }]);
    await r.click(r.byText('Add another'));
    expect(r.last()).toEqual([{ base: 'clean' }, {}]);
    expect(r.el.querySelectorAll('.fe-row').length).toBe(2);
    expect([...r.el.querySelectorAll('button')].some((b) => b.textContent?.includes('Add another'))).toBe(false);
  });

  it('removing a card with answers asks first', async () => {
    const r = await renderKind(RepeatFill, ulcers, [{ site: 'leg' }, {}]);
    const dialog = TestBed.inject(FeDialog);
    const confirm = vi.spyOn(dialog, 'confirm').mockResolvedValue(false);
    await r.click('[aria-label="Remove Ulcer 2"]');
    expect(confirm).not.toHaveBeenCalled();
    expect(r.last()).toEqual([{ site: 'leg' }]);
    await r.click('[aria-label="Remove Ulcer 1"]');
    expect(confirm).toHaveBeenCalled();
    expect(r.last()).toEqual([{ site: 'leg' }]);
    confirm.mockResolvedValue(true);
    await r.click('[aria-label="Remove Ulcer 1"]');
    await r.stable();
    expect(r.last()).toBeUndefined();
  });
});
