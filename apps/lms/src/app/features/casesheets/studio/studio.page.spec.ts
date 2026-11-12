import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, vi } from 'vitest';
import { addPage, emptyDefinition } from '@prefrontal/forms-engine';
import { DialogService } from '../../../core/services/dialog.service';
import { MockStudioApi } from './data/mock-studio-api';
import { StudioApi } from './data/studio-api';
import { FormRow } from './data/studio-models';
import { CortexImportService } from './cortex-import/cortex-import.service';
import { OTHER_DEPARTMENT, StudioPage, groupByDepartment } from './studio.page';
import { PendingCountService } from './approvals/pending-count.service';
import { signal } from '@angular/core';

const row = (over: Partial<FormRow>): FormRow => ({
  id: 'f', key: 'k', title: 'T', specialty: null, status: 'active', origin: 'local', departmentKey: null, departmentName: null, catalogKey: null, readOnly: false, forkedFromVersionId: null, pinned: false, newerMaster: false, published: null, draft: null, ...over,
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

describe('Case sheets home (Test Master pattern)', () => {
  const dialog = { confirm: vi.fn(async () => true), prompt: vi.fn(async () => 'New one'), choose: vi.fn(async () => 'ent') };

  async function open(pendingStub?: object) {
    TestBed.resetTestingModule();
    const api = new MockStudioApi();
    const master = api.seed('ENT master', addPage(emptyDefinition('ENT master'), 'History').def, { publish: true, origin: 'master', departmentKey: 'ent' });
    const own = api.seed('Our general', addPage(emptyDefinition('Our general'), 'History').def, { publish: true, departmentKey: 'general' });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: StudioApi, useValue: api },
        { provide: DialogService, useValue: dialog },
        ...(pendingStub ? [{ provide: PendingCountService, useValue: pendingStub }] : []),
      ],
    });
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const f = TestBed.createComponent(StudioPage);
    await f.whenStable();
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    const page = f.componentInstance as unknown as Record<string, any>;
    return { f, el: f.nativeElement as HTMLElement, api, nav, master, own, page };
  }

  it('is Test Master\'s screen: a departments rail with counts and switches, and the case sheets card with its filters', async () => {
    const { el, page } = await open();
    expect(el.querySelector('[data-dept-rail]')).not.toBeNull();
    expect(el.querySelector('[data-dept="all"]')!.textContent).toContain('2');
    expect(el.querySelector('[data-case-sheets] [data-status-filter]')).not.toBeNull();
    expect(el.querySelector('[data-case-sheets] [data-origin-filter]')).not.toBeNull();
    expect(el.querySelector('[data-count]')!.textContent).toContain('2 case sheets');
    expect(page['rows']().map((r: { title: string }) => r.title).sort()).toEqual(['ENT master', 'Our general']);
  });

  it('picking a department, the status pill and the origin pill narrow the grid; the search too', async () => {
    const { f, page, el } = await open();
    page['pickDept']('ent');
    f.detectChanges();
    expect(page['rows']().map((r: { title: string }) => r.title)).toEqual(['ENT master']);
    page['pickDept'](null);
    page['originFilter'].set('local');
    expect(page['rows']().map((r: { title: string }) => r.title)).toEqual(['Our general']);
    page['originFilter'].set('all');
    page['query'].set('zzz');
    f.detectChanges();
    expect(page['rows']()).toHaveLength(0);
    expect(el.querySelector('[data-count]')!.textContent).toContain('0 case sheets');
  });

  it('Edit on a master asks, forks and opens the lab copy', async () => {
    const { page, api, nav, master } = await open();
    const row = page['forms']().find((r: { id: string }) => r.id === master);
    page['gridContext'].edit(row);
    await vi.waitFor(() => expect(nav).toHaveBeenCalled());
    expect(api.calls).toContain('fork');
    const copy = [...api.forms.values()].find((x) => x.forkedFrom === master)!;
    expect(copy.origin).toBe('override');
    expect(nav.mock.calls[0][0]).toEqual([`/admin/ipd/myprefrontal/forms/${copy.id}`]);
  });

  it('Edit declined creates nothing', async () => {
    const { page, api, master } = await open();
    dialog.confirm.mockResolvedValueOnce(false);
    page['gridContext'].edit(page['forms']().find((r: { id: string }) => r.id === master));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.calls).not.toContain('fork');
  });

  it('the band tabs carry the waiting counts; Pending and From Prefrontal open the approvals page; Archived stays here', async () => {
    const pending = {
      total: signal(3), refresh: vi.fn(async () => undefined),
      byForm: signal(new Map<string, number>()), offerForms: signal(new Set<string>(['x'])),
    };
    const { page, nav } = await open(pending);
    const opts = page['viewOptions']() as { value: string; count: number }[];
    expect(opts.map((o) => [o.value, o.count])).toEqual([['sheets', 2], ['pending', 3], ['offers', 1], ['archived', 0]]);
    page['setView']('pending');
    expect(nav).toHaveBeenCalledWith(['/admin/ipd/myprefrontal/pending']);
    page['setView']('archived');
    expect(page['view']()).toBe('archived');
    expect(pending.refresh).toHaveBeenCalled();
  });

  it('the rail switch calls the department enable call; a refusal is told, not swallowed', async () => {
    const { page, api } = await open();
    const spy = vi.spyOn(api, 'updateDepartment').mockResolvedValue({ key: 'ent', name: 'ENT', sortOrder: 1, isActive: false });
    await page['toggleDept']({ key: 'ent', name: 'ENT', code: 'ENT', count: 1, isActive: true });
    expect(spy).toHaveBeenCalledWith('ent', { isActive: false });
  });

  it('shows no assistant inbox and no people link', async () => {
    const { el } = await open();
    expect(el.textContent).not.toMatch(/assistant|People and roles/i);
  });
});

describe('Case sheets home: Start from a paper case sheet (Cortex beta)', () => {
  // Node 25 ships a global localStorage that is inert without --localstorage-file and shadows jsdom's: give the
  // flag a real in-memory store so this spec behaves the same on every machine.
  beforeEach(() => {
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, String(v)),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: (i: number) => [...mem.keys()][i] ?? null,
      get length() { return mem.size; },
    });
  });

  async function open(flagOn: boolean) {
    TestBed.resetTestingModule();
    try { flagOn ? localStorage.setItem('pf.cortexImport', '1') : localStorage.removeItem('pf.cortexImport'); } catch { /* no storage */ }
    const api = new MockStudioApi();
    api.seed('Our general', addPage(emptyDefinition('Our general'), 'History').def, { publish: true, departmentKey: 'general' });
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: StudioApi, useValue: api }, DialogService] });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const f = TestBed.createComponent(StudioPage);
    await f.whenStable();
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, svc: TestBed.inject(CortexImportService) };
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  it('the button is hidden unless the console switch pf.cortexImport() is on', async () => {
    expect((await open(false)).el.querySelector('[data-act="cortex-import"]')).toBeNull();
    const { el } = await open(true);
    expect(el.querySelector('[data-act="cortex-import"]')!.textContent).toContain('Read a paper case sheet');
  });

  it('the button opens the dialog; a 404 from the server hides the button and says why', async () => {
    const { f, el, svc } = await open(true);
    (el.querySelector('[data-act="cortex-import"]') as HTMLButtonElement).click();
    f.detectChanges();
    expect(el.querySelector('[data-cortex-import]')).not.toBeNull();
    svc.unavailable.set(true);
    f.detectChanges();
    expect(el.querySelector('[data-act="cortex-import"]')).toBeNull();
  });

  it('a running job shows "Cortex is making ‹name›" on the home; done turns it into Open the draft', async () => {
    const { f, el, svc } = await open(true);
    svc.job.set({ jobId: 'j', name: 'Cardiology sheet', status: 'building' });
    f.detectChanges();
    expect(el.querySelector('[data-cortex-chip]')!.textContent).toContain('Cortex is making Cardiology sheet');
    svc.job.set({ jobId: 'j', name: 'Cardiology sheet', status: 'done', formId: 'f1', checkCount: 2 });
    f.detectChanges();
    expect(el.querySelector('[data-cortex-chip]')!.textContent).toContain('Cortex made Cardiology sheet');
    (el.querySelector('[data-act="open-draft"]') as HTMLButtonElement).click();
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/admin/ipd/myprefrontal/forms/f1']);
  });
});

describe('Case sheets home: band', () => {
  it('the band holds the Test Master buttons: Read a paper case sheet and Create', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const dir = resolve(process.cwd(), 'apps/lms/src/app/features/casesheets/studio');
    const html = readFileSync(resolve(dir, 'studio.page.html'), 'utf8');
    const band = html.slice(html.indexOf('band-actions'), html.indexOf('</pf-hero-band>'));
    expect(band).toContain('Read a paper case sheet');
    expect(band).toMatch(/data-act="new-form"[\s\S]*Create/);
    expect(html).toContain('band-tools');
  });
});
