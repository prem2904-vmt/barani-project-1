import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { addField, addPage, emptyDefinition, provideFormsEngine, setLabel } from '@prefrontal/forms-engine';
import { AuthService } from '../../../../core/auth/auth.service';
import { DialogService } from '../../../../core/services/dialog.service';
import { MockStudioApi } from '../data/mock-studio-api';
import { StudioApi } from '../data/studio-api';
import { CaseSheetBuilderApi } from '../builder/builder-api';
import { CORTEX_BUILDER_ON } from '../builder/builder-status.service';
import { check, checksOf, fakeApi, fakeDialog } from '../builder/builder-testing';
import { StudioEditorPage } from './editor.page';

const settle = async (f: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
};

async function mount(opts: { flag: boolean; checks?: ReturnType<typeof checksOf>; cortex?: boolean }) {
  TestBed.resetTestingModule();
  const studio = new MockStudioApi();
  const api = fakeApi(opts.checks ?? checksOf([check('a')]));
  api.status.mockResolvedValue({ cortex: opts.cortex ?? true, connector: false, connectorSwitch: false, canChangeSwitch: false });
  const dialog = fakeDialog();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]), provideFormsEngine(),
      { provide: StudioApi, useValue: studio }, { provide: DialogService, useValue: dialog },
      { provide: CaseSheetBuilderApi, useValue: api }, { provide: CORTEX_BUILDER_ON, useValue: () => opts.flag },
      { provide: AuthService, useValue: { hasPermission: () => true, user: () => null } },
    ],
  });
  let def = addPage(emptyDefinition('ENT'), 'History').def;
  const q = addField(def, { pageKey: 'history' }, 'yesno');
  def = setLabel(q.def, q.key, 'Pain');
  const id = studio.seed('ENT', def);
  const f = TestBed.createComponent(StudioEditorPage);
  f.componentRef.setInput('id', id);
  const el = f.nativeElement as HTMLElement;
  await vi.waitFor(async () => { await settle(f); expect(el.querySelector('[data-act="publish"]')).not.toBeNull(); });
  await settle(f);
  return { f, el, api, dialog, studio, id };
}

afterEach(() => TestBed.resetTestingModule());

describe('Studio editor: Cortex + Checks (dev beta)', () => {
  it('flag off: no Cortex / Checks buttons, no drawer, and the builder is never called', async () => {
    const { el, api } = await mount({ flag: false });
    expect(el.querySelector('[data-act="cortex"]')).toBeNull();
    expect(el.querySelector('[data-act="checks"]')).toBeNull();
    expect(el.querySelector('[data-act="checks-fail"]')).toBeNull();
    expect(api.status).not.toHaveBeenCalled();
    expect(api.checks).not.toHaveBeenCalled();
  });

  it('flag on + server available: Cortex and Checks buttons sit in the band and open ONE drawer (tabs), "What it writes" untouched', async () => {
    const { f, el } = await mount({ flag: true });
    const cortex = el.querySelector('[data-act="cortex"]') as HTMLButtonElement;
    expect(cortex).not.toBeNull();
    expect(el.querySelector('[data-builder-drawer]')).toBeNull();
    cortex.click();
    await settle(f);
    expect(el.querySelector('[data-builder-drawer]')).not.toBeNull();
    expect(el.querySelector('st-cortex-chat [data-draft-banner]')!.textContent).toContain('Cortex only suggests. Nothing changes until someone approves it in Pending changes.');
    (el.querySelector('[data-act="checks"]') as HTMLButtonElement).click();
    await settle(f);
    expect(el.querySelector('st-checks-panel')).not.toBeNull();
    expect(el.querySelector('st-cortex-chat')).toBeNull();
    (el.querySelector('[data-act="close-builder"]') as HTMLButtonElement).click();
    await settle(f);
    expect(el.querySelector('[data-builder-drawer]')).toBeNull();
  });

  it('the server says no Cortex chat: only Checks shows', async () => {
    const { el } = await mount({ flag: true, cortex: false });
    expect(el.querySelector('[data-act="cortex"]')).toBeNull();
    expect(el.querySelector('[data-act="checks"]')).not.toBeNull();
  });

  it('a failing check WARNS: red "1 check fails" beside Publish, Publish stays enabled, the confirm names it, and publishing goes ahead', async () => {
    const failing = checksOf([check('a'), check('b', { result: { pass: false, failures: ['x'] } })]);
    const { f, el, dialog, studio, id } = await mount({ flag: true, checks: failing });
    const chip = el.querySelector('[data-act="checks-fail"]') as HTMLElement;
    expect(chip.textContent).toContain('1 check fails');
    expect(chip.classList.contains('ed-failchip')).toBe(true);
    const publish = el.querySelector('[data-act="publish"]') as HTMLButtonElement;
    expect(publish.disabled).toBe(false);
    publish.click();
    await vi.waitFor(() => expect(dialog.confirm).toHaveBeenCalled());
    const req = dialog.confirm.mock.calls[0][0] as { message: string };
    expect(req.message).toContain('1 check fails');
    expect(req.message).toContain('You can still publish');
    // yes → it publishes anyway (nothing blocks)
    await vi.waitFor(async () => { await settle(f); expect(el.querySelector('[data-published]'), el.textContent ?? '').not.toBeNull(); });
    void studio;
    void id;
  });

  it('with every check passing there is no red note and the confirm is the normal one', async () => {
    const { el, dialog } = await mount({ flag: true, checks: checksOf([check('a')]) });
    expect(el.querySelector('[data-act="checks-fail"]')).toBeNull();
    (el.querySelector('[data-act="publish"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(dialog.confirm).toHaveBeenCalled());
    expect((dialog.confirm.mock.calls[0][0] as { message: string }).message).not.toContain('check');
  });

  it('the fail chip opens the Checks tab', async () => {
    const failing = checksOf([check('b', { result: { pass: false, failures: ['x'] } })]);
    const { f, el } = await mount({ flag: true, checks: failing });
    (el.querySelector('[data-act="checks-fail"]') as HTMLButtonElement).click();
    await settle(f);
    expect(el.querySelector('st-checks-panel')).not.toBeNull();
  });
});
