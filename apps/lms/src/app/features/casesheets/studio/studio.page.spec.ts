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

describe('Case sheets home', () => {
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

  it('the band links to Pending changes with the waiting count; rows show a suggested change / an update from Prefrontal', async () => {
    TestBed.resetTestingModule();
    const api = new MockStudioApi();
    const own = api.seed('Our general', addPage(emptyDefinition('Our general'), 'History').def, { publish: true, departmentKey: 'general' });
    const pending = {
      total: signal(3), refresh: vi.fn(async () => undefined),
      byForm: signal(new Map([[own, 2]])), offerForms: signal(new Set([own])),
    };
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: StudioApi, useValue: api }, { provide: DialogService, useValue: dialog }, { provide: PendingCountService, useValue: pending }] });
    const f = TestBed.createComponent(StudioPage);
    await f.whenStable(); f.detectChanges(); await f.whenStable(); f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const btn = el.querySelector('[data-act="pending"]') as HTMLAnchorElement;
    expect(btn.getAttribute('href')).toBe('/admin/ipd/myprefrontal/pending');
    expect(btn.querySelector('[data-pending-badge]')!.textContent).toContain('3');
    expect(el.querySelector('[data-pending-chip]')!.textContent).toContain('3 waiting for approval');
    expect(el.querySelector('[data-tag="suggested"]')!.textContent).toContain('2 suggested changes');
    expect(el.querySelector('[data-tag="update"]')!.textContent).toContain('Update from Prefrontal');
    expect(pending.refresh).toHaveBeenCalled();
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
    expect(el.querySelector('[data-act="cortex-import"]')!.textContent).toContain('Start from a paper case sheet');
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

describe('Case sheets home: band actions on a phone', () => {
  it('every band action keeps its words in .sh-actions__lbl (icon-only at ≤640px, the words stay as its accessible name)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const dir = resolve(process.cwd(), 'apps/lms/src/app/features/casesheets/studio');
    const html = readFileSync(resolve(dir, 'studio.page.html'), 'utf8');
    const band = html.slice(html.indexOf('band-actions'), html.indexOf('</pf-hero-band>'));
    for (const words of ['Start from a paper case sheet', 'Bring in an old case sheet', 'New case sheet']) {
      expect(band).toContain(`<span class="sh-actions__lbl">${words}</span>`);
    }
    const scss = readFileSync(resolve(dir, 'studio.page.scss'), 'utf8');
    expect(scss).toMatch(/@media \(max-width: 640px\)[\s\S]*\.sh-actions__lbl \{[\s\S]*clip-path: inset\(50%\)/);
  });
});
