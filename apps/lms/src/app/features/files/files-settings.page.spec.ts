import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { DialogService } from '../../core/services/dialog.service';
import { ToastService } from '../../core/services/toast.service';
import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { NavPrefsService } from '../../layout/start-menu/nav-prefs.service';
import { FilesAccessService } from './files-access.service';
import { OfficeService } from './office.service';
import { FilesSettingsPage, bytesWords } from './files-settings.page';

@Component({ selector: 'pf-hero-band', standalone: true, template: '<ng-content></ng-content><ng-content select="[band-center]"></ng-content><ng-content select="[band-search]"></ng-content><ng-content select="[band-actions]"></ng-content>' })
class HeroStub { }

const settings = () => ({
  apps: { sheet: { enabled: true, editRoles: ['Lab in-charge'] }, doc: { enabled: true, editRoles: [] }, slides: { enabled: false, editRoles: ['Doctor'] }, pdf: { enabled: true, editRoles: [] }, image: { enabled: true, editRoles: [] } },
  editOnPhones: false, trashDays: 30, patientNames: true, ownTemplates: [], hiddenTemplates: [] as string[],
});
const storage = { totalBytes: 1.2 * 1024 ** 3, byKind: [{ kind: 'sheet', count: 412, bytes: 1 }, { kind: 'doc', count: 1, bytes: 1 }, { kind: 'slides', count: 18, bytes: 1 }, { kind: 'pdf', count: 0, bytes: 0 }, { kind: 'image', count: 3, bytes: 1 }], trashCount: 0, trashBytes: 0 };

function make(o: { full?: boolean; roles?: boolean; fail?: boolean; saveFail?: boolean } = {}) {
  const office = {
    settings: vi.fn(async () => { if (o.fail) throw new Error('x'); return { settings: settings(), access: { full: o.full !== false } }; }),
    saveSettings: vi.fn(async (s: unknown) => { if (o.saveFail) throw new Error('x'); return { settings: s, access: { full: true } }; }),
    storage: vi.fn(async () => storage), list: vi.fn(async () => [{ id: 'f1', name: 'Letterhead.docx', kind: 'doc' }]),
  };
  const roleSave = vi.fn(() => of({}));
  const nav = { ensureDefaults: vi.fn(), roleMap: () => ({ Doctor: { pinned: ['lab', 'files-synapse'], locked: [] } }), saveRoleDefaults: roleSave };
  const dialog = { alert: vi.fn(async () => undefined), choose: vi.fn(async () => 'f1'), prompt: vi.fn(async () => 'Our letter') };
  const toast = { success: vi.fn(), error: vi.fn() };
  TestBed.configureTestingModule({ providers: [
    { provide: OfficeService, useValue: office },
    { provide: FilesAccessService, useValue: { full: signal(o.full !== false), refresh: vi.fn(async () => undefined) } },
    { provide: ApiService, useValue: { get: () => of([{ id: 'r1', name: 'Doctor' }, { id: 'r2', name: 'Lab in-charge' }]) } },
    { provide: AuthService, useValue: { hasPermission: (c: string) => c === 'manage_roles' && o.roles !== false } },
    { provide: DialogService, useValue: dialog }, { provide: ToastService, useValue: toast }, { provide: NavPrefsService, useValue: nav },
  ] });
  TestBed.overrideComponent(FilesSettingsPage, { remove: { imports: [HeroBandComponent] }, add: { imports: [HeroStub], schemas: [NO_ERRORS_SCHEMA] } });
  const fixture = TestBed.createComponent(FilesSettingsPage);
  fixture.detectChanges();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page = fixture.componentInstance as any;
  const el = fixture.nativeElement as HTMLElement;
  const settle = async () => { for (let i = 0; i < 3; i++) { await fixture.whenStable(); await new Promise(r => setTimeout(r, 0)); fixture.detectChanges(); } };
  return { fixture, page, el, office, dialog, toast, nav, roleSave, settle };
}

describe('Settings → Files', () => {
  it('shows the five apps with on/off and "who can edit", the templates, storage and the device rules', async () => {
    const { el, settle, page } = make();
    await settle();
    // Test Master frame: the side card lists the categories; the main card shows the picked one.
    expect(Array.from(el.querySelectorAll('[data-testid^="tp-item-"]')).map(b => b.getAttribute('data-testid'))).toEqual(
      ['tp-item-apps', 'tp-item-templates', 'tp-item-devices', 'tp-item-patient', 'tp-item-bar']);
    for (const id of ['neuron', 'synapse', 'axon', 'myelin', 'retina']) expect(el.querySelector(`[data-testid="files-app-${id}"]`), id).toBeTruthy();
    page.pickCat('devices'); await settle();
    expect(el.querySelector('[data-testid="files-storage"]')?.textContent).toContain('412 sheets');
    expect(el.querySelector('[data-testid="files-storage"]')?.textContent).toContain('1.2 GB');
    expect(el.querySelector('[data-testid="files-storage"]')?.textContent).toContain('18 slide decks');
    expect(el.querySelector('[data-testid="files-storage"]')?.textContent).toContain('1 document');
    page.pickCat('templates'); await settle();
    expect(el.querySelector('[data-testid="files-templates-settings"]')?.textContent).toContain('Daily results log');
    expect(el.querySelector('[data-testid="files-templates-settings"]')?.textContent).toContain("Letter on the lab's letterhead");
    page.pickCat('devices'); await settle();
    expect(el.textContent).toContain('Off: phones can view and copy only');
    expect(el.textContent).toContain('Kept in Trash, then removed');
    page.pickCat('patient'); await settle();
    expect(el.textContent).toContain('Only for roles allowed to export patient data');
  });

  it('nothing to save until something changes; Save sends the whole change and then reads clean', async () => {
    const { page, el, office, settle, toast } = make();
    await settle();
    const saveBtn = () => el.querySelector<HTMLButtonElement>('[data-testid="files-settings-save"]')!;
    expect(saveBtn().disabled).toBe(true);
    page.setEnabled(page.apps[0], false);
    page.setRoles(page.apps[1], ['Doctor', 'Admin']);
    page.patch({ editOnPhones: true, trashDays: 60, patientNames: false });
    page.setTemplateShown('neuron:qc', false);
    await settle();
    expect(saveBtn().disabled).toBe(false);
    await page.save();
    expect(office.saveSettings).toHaveBeenCalledTimes(1);
    const sent = office.saveSettings.mock.calls[0][0] as ReturnType<typeof settings>;
    expect(sent.apps['sheet'].enabled).toBe(false);
    expect(sent.apps['doc'].editRoles).toEqual(['Doctor', 'Admin']);
    expect(sent).toMatchObject({ editOnPhones: true, trashDays: 60, patientNames: false, hiddenTemplates: ['neuron:qc'] });
    expect(toast.success).toHaveBeenCalledWith('Saved');
    await settle();
    expect(page.dirty()).toBe(false);
  });

  it('a failed save says so in plain words and keeps the draft', async () => {
    const { page, toast, settle } = make({ saveFail: true });
    await settle();
    page.patch({ trashDays: 90 });
    await page.save();
    expect(toast.error).toHaveBeenCalled();
    expect(page.draft().trashDays).toBe(90);
    expect(page.dirty()).toBe(true);
  });

  it('VIEW ONLY: the page reads, the controls are off, Save is off, and the note says why', async () => {
    const { page, el, settle } = make({ full: false });
    await settle();
    expect(el.querySelector('[data-testid="files-settings-viewonly"]')?.textContent).toContain('View only');
    expect(el.querySelector('[data-testid="files-viewonly-chip"]')).toBeTruthy();
    page.patch({ trashDays: 90 });
    await settle();
    expect(el.querySelector<HTMLButtonElement>('[data-testid="files-settings-save"]')!.disabled).toBe(true);
    page.pickCat('templates'); await settle();
    expect(el.querySelector<HTMLButtonElement>('[data-testid="files-add-template"]')!.disabled).toBe(true);
  });

  it('a load failure offers Try again', async () => {
    const { el, settle, office, page } = make({ fail: true });
    await settle();
    expect(el.querySelector('[data-testid="files-settings-error"]')).toBeTruthy();
    office.settings.mockImplementation(async () => ({ settings: settings(), access: { full: true } }));
    await page.load();
    await settle();
    expect(el.querySelector('[data-testid="files-settings-error"]')).toBeNull();
  });

  it('adding the lab\'s own template picks a saved file, names it, and removing works', async () => {
    const { page, settle, dialog } = make();
    await settle();
    await page.addOwn();
    expect(dialog.choose).toHaveBeenCalled();
    expect(page.draft().ownTemplates).toEqual([{ id: '', kind: 'doc', name: 'Our letter', fileId: 'f1' }]);
    page.removeOwn(page.draft().ownTemplates[0]);
    expect(page.draft().ownTemplates).toEqual([]);
  });

  it('the bottom-bar defaults reuse the role defaults: only Files apps are touched, other pins and locks stay', async () => {
    const { page, nav, roleSave, el, settle } = make();
    await settle();
    page.pickCat('bar'); await settle();
    expect(el.querySelector('[data-testid="files-bar-defaults"]')).toBeTruthy();
    page.barRole.set('Doctor');
    expect(page.barApps()).toEqual(['files-synapse']);
    page.setBarApps(['files-synapse', 'files-axon']);
    page.saveBar();
    expect(nav.saveRoleDefaults).toHaveBeenCalledWith({ Doctor: { pinned: ['lab', 'files-synapse', 'files-axon'], locked: [] } });
    expect(roleSave).toHaveBeenCalled();
    page.setBarApps([]);
    page.saveBar();
    expect(nav.saveRoleDefaults).toHaveBeenLastCalledWith({ Doctor: { pinned: ['lab'], locked: [] } });
  });

  it('without manage_roles there is no bar-defaults editor', async () => {
    const { el, settle } = make({ roles: false });
    await settle();
    expect(el.querySelector('[data-testid="tp-item-bar"]')).toBeNull();
    expect(el.querySelector('[data-testid="files-bar-defaults"]')).toBeNull();
  });

  it('bytes read as people say them', () => {
    expect([bytesWords(0), bytesWords(500), bytesWords(2048), bytesWords(5 * 1024 * 1024), bytesWords(1.5 * 1024 ** 3)]).toEqual(['0 KB', '1 KB', '2 KB', '5 MB', '1.5 GB']);
  });
});
