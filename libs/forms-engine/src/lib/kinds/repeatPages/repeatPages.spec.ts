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

describe('repeatPages fill: legacy "How many" box (G1)', () => {
  const nav = (legacy: boolean) => ({ goTo: () => undefined, pageTitle: (k: string) => titles[k] ?? k, isLegacy: () => legacy });
  const ulcer = f('ulcer', 'repeatPages', {
    label: 'Ulcer',
    config: { pages: ['pregnancy'], maxCount: 10, minCount: 0, defaultCount: 1, labelPrefix: 'Ulcer' },
  });

  it('a number box "How many Ulcer?" instead of the stepper; no jump chips', async () => {
    const r = await renderKind(RepeatPagesFill, ulcer, null, { wizard: nav(true) });
    expect(r.el.querySelector('.fe-countrow__lbl')?.textContent?.trim()).toBe('How many Ulcer?');
    expect(r.el.querySelector('.fe-stepper')).toBeNull();
    expect(r.el.querySelector('[data-instance]')).toBeNull();
  });

  it('the pages are there from the start: the form default count is written when the sheet opens', async () => {
    const r = await renderKind(RepeatPagesFill, ulcer, null, { wizard: nav(true) });
    await r.stable();
    expect(r.last()).toEqual({ instances: [{ page: 'pregnancy', index: 0, values: {} }] });
  });

  it('typing 5 makes five of each page; typing 0 keeps zero (it does not fall back to the default)', async () => {
    const r = await renderKind(RepeatPagesFill, ulcer, null, { wizard: nav(true) });
    const box = r.el.querySelector<HTMLInputElement>('input[data-count="*"]')!;
    box.value = '5';
    box.dispatchEvent(new Event('input'));
    await r.stable();
    expect((r.last() as { instances: unknown[] }).instances.length).toBe(5);
    box.value = '0';
    box.dispatchEvent(new Event('input'));
    await r.stable();
    expect(r.last()).toEqual({ instances: [] });
  });

  it('a new case sheet keeps the stepper and writes nothing on its own', async () => {
    const r = await renderKind(RepeatPagesFill, ulcer, null, { wizard: nav(false) });
    await r.stable();
    expect(r.el.querySelector('.fe-stepper')).not.toBeNull();
    expect(r.calls.length).toBe(0);
  });

  it('individual mode: one box per page with its own default', async () => {
    const eyes = f('eyes', 'repeatPages', {
      label: 'Eyes',
      config: { pages: ['rightEye', 'leftEye'], mode: 'individual', pageEntries: [{ page: 'rightEye', defaultCount: 1 }, { page: 'leftEye', defaultCount: 0 }] },
    });
    const r = await renderKind(RepeatPagesFill, eyes, null, { wizard: nav(true) });
    await r.stable();
    expect([...r.el.querySelectorAll('.fe-countgrid__lbl')].map((x) => x.textContent?.trim())).toEqual(['Right eye', 'Left eye']);
    expect(r.last()).toEqual({ instances: [{ page: 'rightEye', index: 0, values: {} }] });
  });
});
