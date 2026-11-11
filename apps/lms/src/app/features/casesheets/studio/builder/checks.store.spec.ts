import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuilderError } from './builder-models';
import { ChecksPanelComponent } from './checks-panel.component';
import { RERUN_DEBOUNCE_MS } from './checks.store';
import { check, checksOf, fakeApi, fakeDialog, openBuilder } from './builder-testing';

afterEach(() => { vi.useRealTimers(); TestBed.resetTestingModule(); });

const SAMPLE = () => checksOf([
  check('a1'),
  check('a2', { title: 'Cough ticked', given: ['Chief complaint: Cough'] }),
  check('c1', { source: 'cortex', title: 'Two together', result: { pass: false, failures: ["'Fever days' did not show"] } }),
  check('p1', { source: 'person', result: null }),
], 10, 9);

async function panel(api = fakeApi(SAMPLE())) {
  const ctx = await openBuilder({ api });
  const f = TestBed.createComponent(ChecksPanelComponent);
  f.detectChanges();
  await ctx.flush();
  f.detectChanges();
  return { ...ctx, f, el: f.nativeElement as HTMLElement };
}

describe('Checks panel', () => {
  it('loads the checks when the form opens and writes the summary line', async () => {
    const { el, api, id } = await panel();
    expect(api.checks).toHaveBeenCalledWith(id);
    expect(el.querySelector('[data-summary]')!.textContent!.trim()).toBe('4 checks · 2 pass · 1 fails · covers 9 of 10 rules');
  });

  it('lists title, Given, Expect, pass/fail with reasons, and the source chip', async () => {
    const { el } = await panel();
    const items = [...el.querySelectorAll('[data-check]')];
    expect(items).toHaveLength(4);
    expect(items[1].querySelector('[data-given]')!.textContent).toContain('Chief complaint: Cough');
    expect(items[1].querySelector('[data-expect]')!.textContent).toContain("'Duration of cough' shows");
    expect(items[0].getAttribute('data-state')).toBe('pass');
    expect(items[2].getAttribute('data-state')).toBe('fail');
    expect(items[2].querySelector('[data-failures]')!.textContent).toContain("'Fever days' did not show");
    expect(items[3].getAttribute('data-state')).toBe('new');
    expect(items.map((i) => i.querySelector('.ck-src')!.textContent!.trim())).toEqual(['Auto', 'Auto', 'Cortex', 'Person']);
  });

  it('Run all asks the server to run and shows the new answer', async () => {
    const { el, api, f, flush } = await panel();
    api.runChecks.mockResolvedValueOnce(checksOf([check('a1')], 1, 1));
    (el.querySelector('[data-act="run-all"]') as HTMLButtonElement).click();
    await flush();
    f.detectChanges();
    expect(api.runChecks).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-summary]')!.textContent!.trim()).toBe('1 check · 1 pass · covers 1 of 1 rule');
  });

  it('"Ask Cortex for more checks" suggests and shows what came back; hidden when Cortex is not available', async () => {
    const { el, api, f, flush } = await panel();
    api.suggestChecks.mockResolvedValueOnce(checksOf([check('a1'), check('n1', { source: 'cortex', title: 'New one' })], 2, 2));
    (el.querySelector('[data-act="suggest"]') as HTMLButtonElement).click();
    await flush();
    f.detectChanges();
    expect(api.suggestChecks).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain('New one');

    TestBed.resetTestingModule();
    const a = fakeApi(SAMPLE());
    const ctx = await openBuilder({ api: a, status: { cortex: false, connector: false, connectorSwitch: false, canChangeSwitch: false } });
    const g = TestBed.createComponent(ChecksPanelComponent);
    g.detectChanges();
    await ctx.flush();
    g.detectChanges();
    expect((g.nativeElement as HTMLElement).querySelector('[data-act="suggest"]')).toBeNull();
  });

  it('auto checks cannot be removed; a Cortex check asks first and is deleted only on yes', async () => {
    const dialog = fakeDialog();
    const api = fakeApi(SAMPLE());
    const ctx = await openBuilder({ api, dialog });
    const f = TestBed.createComponent(ChecksPanelComponent);
    f.detectChanges();
    await ctx.flush();
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-check="a1"] [data-act="remove"]')).toBeNull();

    dialog.confirm.mockResolvedValueOnce(false);
    (el.querySelector('[data-check="c1"] [data-act="remove"]') as HTMLButtonElement).click();
    await ctx.flush();
    expect(dialog.confirm).toHaveBeenCalledTimes(1);
    expect(api.removeCheck).not.toHaveBeenCalled();

    (el.querySelector('[data-check="c1"] [data-act="remove"]') as HTMLButtonElement).click();
    await ctx.flush();
    f.detectChanges();
    expect(api.removeCheck).toHaveBeenCalledWith(ctx.id, 'c1');
    expect(el.querySelector('[data-check="c1"]')).toBeNull();
    expect(ctx.checks.failing()).toBe(0);
    expect(el.querySelector('[data-summary]')!.textContent).toContain('3 checks');
  });

  it('a failed run shows plain words and keeps the old list', async () => {
    const { el, api, f, flush } = await panel();
    api.runChecks.mockRejectedValueOnce(new BuilderError('feature_off', 'Cortex form building is switched off for your lab.', 403));
    (el.querySelector('[data-act="run-all"]') as HTMLButtonElement).click();
    await flush();
    f.detectChanges();
    expect(el.querySelector('[data-error]')!.textContent).toContain('switched off');
    expect(el.querySelectorAll('[data-check]')).toHaveLength(4);
  });
});

describe('Checks re-run after a successful draft save (debounced)', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));

  it('runs once, RERUN_DEBOUNCE_MS after the LAST save', async () => {
    vi.useRealTimers();
    const ctx = await openBuilder({ api: fakeApi(SAMPLE()) });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    ctx.api.runChecks.mockClear();
    vi.spyOn(ctx.session, 'flush').mockResolvedValue();
    ctx.session.savedAt.set('t1');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(RERUN_DEBOUNCE_MS - 200);
    ctx.session.savedAt.set('t2');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(RERUN_DEBOUNCE_MS - 200);
    expect(ctx.api.runChecks).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(ctx.api.runChecks).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the beta is off (no status, no calls)', async () => {
    vi.useRealTimers();
    const ctx = await openBuilder({ flag: false, api: fakeApi(SAMPLE()) });
    expect(ctx.api.status).not.toHaveBeenCalled();
    expect(ctx.api.checks).not.toHaveBeenCalled();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    ctx.session.savedAt.set('t1');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(RERUN_DEBOUNCE_MS + 100);
    expect(ctx.api.runChecks).not.toHaveBeenCalled();
  });
});
