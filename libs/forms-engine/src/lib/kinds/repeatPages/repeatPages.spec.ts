import { TestBed } from '@angular/core/testing';
import { FeDialog } from '../../kit';
import { examplesOf } from '../../testing/examples';
import { f, renderKind, unnamed, untouchable, vi } from '../../testing/render-kind';
import { RepeatPagesFill } from './repeatPages.fill';

const titles: Record<string, string> = { pregnancy: 'Pregnancy', rightEye: 'Right eye', leftEye: 'Left eye' };
const wizard = () => {
  const went: string[] = [];
  return { went, nav: { goTo: (id: string) => went.push(id), pageTitle: (k: string) => titles[k] ?? k } };
};
const preg = f('pregnancies', 'repeatPages', { label: 'Pregnancies', config: { pages: ['pregnancy'], maxCount: 3 } });

describe('repeatPages fill', () => {
  it.each(examplesOf('repeatPages').map((e) => [e.name, e] as const))(
    'renders the catalogue example "%s"',
    async (_n, ex) => {
      const w = wizard();
      const r = await renderKind(RepeatPagesFill, ex.field, ex.answers[ex.field.key], { wizard: w.nav });
      expect(r.el.querySelectorAll('[data-instance]').length).toBe(
        (ex.answers[ex.field.key] as { instances: unknown[] }).instances.length,
      );
      expect(untouchable(r.el)).toEqual([]);
      expect(unnamed(r.el)).toEqual([]);
    },
  );

  it('the stepper adds whole pages; chips jump to them', async () => {
    const w = wizard();
    const r = await renderKind(RepeatPagesFill, preg, null, { wizard: w.nav });
    await r.click('[aria-label="One more Pregnancy"]');
    await r.click('[aria-label="One more Pregnancy"]');
    expect(r.last()).toEqual({
      instances: [
        { page: 'pregnancy', index: 0, values: {} },
        { page: 'pregnancy', index: 1, values: {} },
      ],
    });
    await r.click(r.byText('Pregnancy 2'));
    expect(w.went).toEqual(['pregnancies#pregnancy#1']);
  });

  it('a chip of a page already filled in carries a tick and says so', async () => {
    const v = {
      instances: [
        { page: 'pregnancy', index: 0, values: { outcome: 'live birth' } },
        { page: 'pregnancy', index: 1, values: {} },
      ],
    };
    const r = await renderKind(RepeatPagesFill, preg, v, { wizard: wizard().nav });
    const chips = [...r.el.querySelectorAll<HTMLElement>('[data-instance]')];
    expect(chips.map((c) => c.getAttribute('data-answered'))).toEqual(['true', 'false']);
    expect(chips[0].querySelector('.fe-rp__done')).toBeTruthy();
    expect(chips[0].getAttribute('aria-label')).toBe('Go to Pregnancy 1, has answers');
    expect(chips[1].getAttribute('aria-label')).toBe('Go to Pregnancy 2');
  });

  it('lowering the count asks when that page has answers', async () => {
    const w = wizard();
    const v = { instances: [{ page: 'pregnancy', index: 0, values: { outcome: 'live birth' } }] };
    const r = await renderKind(RepeatPagesFill, preg, v, { wizard: w.nav });
    const confirm = vi.spyOn(TestBed.inject(FeDialog), 'confirm').mockResolvedValue(false);
    await r.click('[aria-label="One fewer Pregnancy"]');
    expect(confirm).toHaveBeenCalled();
    expect(r.calls).toEqual([]);
  });

  it('individual mode: one stepper per page', async () => {
    const w = wizard();
    const eyes = f('eyes', 'repeatPages', {
      label: 'Eyes',
      config: { pages: ['rightEye', 'leftEye'], mode: 'individual' },
    });
    const r = await renderKind(RepeatPagesFill, eyes, null, { wizard: w.nav });
    await r.click('[aria-label="One more Left eye"]');
    expect(r.last()).toEqual({ instances: [{ page: 'leftEye', index: 0, values: {} }] });
    expect(r.el.textContent).toContain('Right eye');
  });
});
