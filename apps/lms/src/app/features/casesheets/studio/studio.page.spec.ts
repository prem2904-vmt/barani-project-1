import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { addPage, emptyDefinition } from '@prefrontal/forms-engine';
import { DialogService } from '../../../core/services/dialog.service';
import { MockStudioApi } from './data/mock-studio-api';
import { StudioApi } from './data/studio-api';
import { FormRow } from './data/studio-models';
import { OTHER_DEPARTMENT, StudioPage, groupByDepartment } from './studio.page';

const row = (over: Partial<FormRow>): FormRow => ({
  id: 'f', key: 'k', title: 'T', specialty: null, status: 'active', origin: 'local', departmentKey: null, newerMaster: false, published: null, draft: null, ...over,
});

describe('groupByDepartment', () => {
  const depts = [{ key: 'ent', name: 'ENT', sortOrder: 1 }, { key: 'general', name: 'General medicine', sortOrder: 2 }];

  it('groups by the master department, in the department order, "Other" last, empty departments left out', () => {
    const g = groupByDepartment([
      row({ id: '1', title: 'Throat', departmentKey: 'ent' }),
      row({ id: '2', title: 'Mystery', departmentKey: 'nope' }),
      row({ id: '3', title: 'Ear', departmentKey: 'ENT', origin: 'master' }),
      row({ id: '4', title: 'No department' }),
    ], [...depts]);
    expect(g.map((x) => x.key)).toEqual(['ent', OTHER_DEPARTMENT]);
    expect(g[0].forms.map((f) => f.title)).toEqual(['Ear', 'Throat']);
    expect(g[1].forms.map((f) => f.title)).toEqual(['Mystery', 'No department']);
  });

  it('with no departments loaded everything is under Other', () => {
    const g = groupByDepartment([row({ id: '1', departmentKey: 'ent' })], []);
    expect(g).toHaveLength(1);
    expect(g[0].name).toBe('Other');
  });
});

describe('MyPrefrontal home', () => {
  const dialog = { confirm: vi.fn(async () => true), prompt: vi.fn(async () => 'New one'), choose: vi.fn(async () => 'ent') };

  async function open() {
    TestBed.resetTestingModule();
    const api = new MockStudioApi();
    const master = api.seed('ENT master', addPage(emptyDefinition('ENT master'), 'History').def, { publish: true, origin: 'master', departmentKey: 'ent' });
    api.seed('Our general', addPage(emptyDefinition('Our general'), 'History').def, { publish: true, departmentKey: 'general' });
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: StudioApi, useValue: api }, { provide: DialogService, useValue: dialog }] });
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const f = TestBed.createComponent(StudioPage);
    await f.whenStable();
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, api, nav, master };
  }

  it('groups forms by department; a master is read-only (Edit, no menu), the lab\'s own form has the menu', async () => {
    const { el } = await open();
    expect([...el.querySelectorAll('[data-dept]')].map((d) => d.getAttribute('data-dept'))).toEqual(['ent', 'general']);
    const master = el.querySelector('[data-origin="master"]')!;
    expect(master.querySelector('[data-tag="master"]')).not.toBeNull();
    expect(master.querySelector('[data-act="fork"]')).not.toBeNull();
    expect(master.querySelector('.st-more')).toBeNull();
    const own = el.querySelector('[data-origin="local"]')!;
    expect(own.querySelector('[data-act="fork"]')).toBeNull();
    expect(own.querySelector('.st-more')).not.toBeNull();
  });

  it('Edit on a master asks, forks and opens the lab copy', async () => {
    const { el, api, nav, master } = await open();
    (el.querySelector('[data-act="fork"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(nav).toHaveBeenCalled());
    expect(api.calls).toContain('fork');
    const copy = [...api.forms.values()].find((x) => x.forkedFrom === master)!;
    expect(copy.origin).toBe('override');
    expect(nav.mock.calls[0][0]).toEqual([`/admin/ipd/myprefrontal/forms/${copy.id}`]);
  });

  it('Edit declined creates nothing', async () => {
    const { el, api } = await open();
    dialog.confirm.mockResolvedValueOnce(false);
    (el.querySelector('[data-act="fork"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(api.calls).not.toContain('fork');
  });

  it('shows no assistant inbox and no people link', async () => {
    const { el } = await open();
    expect(el.textContent).not.toMatch(/assistant|People and roles/i);
  });
});
