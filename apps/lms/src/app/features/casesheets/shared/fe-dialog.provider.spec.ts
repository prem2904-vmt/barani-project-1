import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FeDialog, FeDialogApi } from '@prefrontal/forms-engine/providers';
import { appConfig } from '../../../app.config';
import { DialogService } from '../../../core/services/dialog.service';

/** The forms engine's dialog is the LMS DialogService (no second dialog, never window.confirm). */
describe('FeDialog provider', () => {
  it('the LMS DialogService satisfies the engine\'s dialog contract (type-level + methods)', () => {
    const svc: FeDialogApi = TestBed.inject(DialogService);
    for (const m of ['prompt', 'confirm', 'alert', 'actions'] as const) expect(typeof svc[m]).toBe('function');
  });

  it('app.config provides FeDialog with the same DialogService instance', () => {
    const p = appConfig.providers.find(x => (x as { provide?: unknown })?.provide === FeDialog) as { useExisting?: unknown } | undefined;
    expect(p?.useExisting).toBe(DialogService);
    const inj = createEnvironmentInjector([p as never], TestBed.inject(EnvironmentInjector));
    expect(inj.get(FeDialog)).toBe(inj.get(DialogService));
  });

  it('unprovided, the engine\'s fallback answers "no" to everything (never deletes answers)', async () => {
    TestBed.resetTestingModule();
    const d = TestBed.inject(FeDialog);
    expect(await d.confirm({ title: 'Remove?' })).toBe(false);
    expect(await d.prompt({ title: 'Label' })).toBeNull();
    expect(await d.actions({ title: 'x', actions: [] })).toEqual({ action: null, checked: false });
  });
});
