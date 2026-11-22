import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { OpdDeskApi } from '../../opd/frontdesk/desk-api.service';
import { FdGridColumnsComponent } from './fd-grid-columns.component';
import { FdGridColumnsService } from '../../../core/services/fd-grid-columns.service';
import { defaultFdColumns } from '../../../shared/utils/fd-grid-columns';

/** Settings › Front desk › Work grid columns: load · palette · edits · Save only when changed (snapshot compare). Fake data. */

async function setup(opts: { saved?: unknown; putFails?: boolean; module?: 'lab' | 'opd'; probe?: unknown[] } = {}) {
  const api = {
    get: vi.fn((path: string) => path.startsWith('/api/appointments/work-grid') ? of(opts.saved ?? {}) : of(opts.probe ?? [])),
    put: vi.fn((_path: string, body: unknown) => opts.putFails ? throwError(() => new Error('offline')) : of({ [opts.module ?? 'lab']: body })),
  };
  const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), show: vi.fn(), warning: vi.fn() };
  TestBed.configureTestingModule({
    imports: [FdGridColumnsComponent],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toast },
      { provide: OpdDeskApi, useValue: { visits: vi.fn(() => of(opts.probe ?? [])) } },
      { provide: AuthService, useValue: { user: signal({ id: 'u1', tenantId: 't1', branchId: 'b1', branchName: 'Main', branches: [{ id: 'b1', name: 'Main' }] }), activeBranchId: signal('b1'), hasPermission: () => true } },
    ],
  });
  await TestBed.compileComponents();   // the preview grid sits in an @defer block
  const f = TestBed.createComponent(FdGridColumnsComponent);
  f.componentRef.setInput('module', opts.module ?? 'lab');
  f.detectChanges();
  return { f, c: f.componentInstance, api, toast, el: f.nativeElement as HTMLElement };
}

afterEach(() => TestBed.resetTestingModule());

describe('Work grid columns — load', () => {
  it('nothing saved: the catalogue defaults, nothing to save, Reset off', async () => {
    const { c, api } = await setup();
    expect(api.get).toHaveBeenCalledWith('/api/appointments/work-grid');
    expect(c.order()).toEqual(defaultFdColumns('lab'));
    expect(c.staffMayHide()).toBe(true);
    expect(c.dirty()).toBe(false);
    expect(c.canReset()).toBe(false);
  });
  it('saved list is merged (unknown ids dropped, locked put back)', async () => {
    const { c } = await setup({ saved: { lab: { columns: ['priority', 'nope', 'samples'], staffMayHide: false } } });
    expect(c.order()).toEqual(['token', 'patient', 'where', 'priority', 'samples', 'waiting', 'next']);
    expect(c.staffMayHide()).toBe(false);
    expect(c.dirty()).toBe(false);
    expect(c.canReset()).toBe(true);
  });
  it('a failed read keeps the defaults (the page still works)', async () => {
    TestBed.resetTestingModule();
    const api = { get: vi.fn(() => throwError(() => new Error('403'))), put: vi.fn() };
    TestBed.configureTestingModule({
      imports: [FdGridColumnsComponent],
      providers: [{ provide: ApiService, useValue: api }, { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
        { provide: OpdDeskApi, useValue: { visits: () => of([]) } },
        { provide: AuthService, useValue: { user: signal({ id: 'u1', tenantId: 't1' }), activeBranchId: signal(null) } }],
    });
    await TestBed.compileComponents();
    const f = TestBed.createComponent(FdGridColumnsComponent);
    f.componentRef.setInput('module', 'lab');
    f.detectChanges();
    expect(f.componentInstance.order()).toEqual(defaultFdColumns('lab'));
    expect(f.componentInstance.loading()).toBe(false);
  });
});

describe('Work grid columns — palette', () => {
  it('lists what can be added with a + each; needs-data columns are greyed, without +', async () => {
    const { el } = await setup();
    const ids = Array.from(el.querySelectorAll('[data-fd-item]')).map(e => e.getAttribute('data-fd-item'));
    expect(ids).toEqual(['priority', 'refdoc', 'visit', 'orderid', 'branch']);
    const soon = el.querySelector('[data-fd-soon="due"]')!;
    expect(soon.getAttribute('aria-disabled')).toBe('true');
    expect(soon.querySelector('button')).toBeNull();
    expect(el.querySelector('[data-testid="fdgc-pcount"]')!.textContent).toContain('5 to add');
  });
  it('a needs-data column becomes available when today\'s feed carries its data', async () => {
    const { el, c } = await setup({ module: 'opd', probe: [{ id: 'v1', room: 'Room 2' }] });
    expect(c.ready().has('room')).toBe(true);
    expect(el.querySelector('[data-fd-item="room"]')).not.toBeNull();
    expect(el.querySelector('[data-fd-soon="appt"]')).not.toBeNull();
  });
  it('+ adds before Next; Enter on a focused item does too', async () => {
    const { f, el, c } = await setup();
    (el.querySelector('[data-fd-add="priority"]') as HTMLButtonElement).click();
    f.detectChanges();
    expect(c.order().slice(-3)).toEqual(['priority', 'waiting', 'next']);
    const item = el.querySelector('[data-fd-item="refdoc"]') as HTMLElement;
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    f.detectChanges();
    expect(c.order().slice(-4)).toEqual(['priority', 'refdoc', 'waiting', 'next']);
    expect(el.querySelector('[data-fd-item="refdoc"]')).toBeNull();
  });
  it('a needs-data column cannot be added', async () => {
    const { c } = await setup();
    c.add('due');
    expect(c.order()).not.toContain('due');
  });
});

describe('Work grid columns — Save only when something changed', () => {
  it('an edit put back disables Save again (snapshot compare, never a touched flag)', async () => {
    const { c } = await setup();
    c.add('priority');
    expect(c.dirty()).toBe(true);
    c.remove('priority');
    expect(c.dirty()).toBe(false);
    c.staffMayHide.set(false);
    expect(c.dirty()).toBe(true);
    c.staffMayHide.set(true);
    expect(c.dirty()).toBe(false);
  });
  it('locked columns cannot be removed', async () => {
    const { c } = await setup();
    c.remove('token'); c.remove('next'); c.remove('waiting');
    expect(c.order()).toEqual(defaultFdColumns('lab'));
    expect(c.dirty()).toBe(false);
  });
  it('Save PUTs this module\'s list and re-takes the snapshot', async () => {
    const { c, api, toast } = await setup();
    c.add('priority');
    c.staffMayHide.set(false);
    await c.saveChanges();
    expect(api.put).toHaveBeenCalledWith('/api/appointments/work-grid/lab', { columns: [...defaultFdColumns('lab').slice(0, -2), 'priority', 'waiting', 'next'], staffMayHide: false });
    expect(c.dirty()).toBe(false);
    expect(toast.success).toHaveBeenCalled();
    // The Frontdesk (same session) sees it at once.
    expect(TestBed.inject(FdGridColumnsService).configFor('lab').columns).toContain('priority');
  });
  it('a server without the endpoint yet (404): defaults load, Save says so plainly and stays on', async () => {
    TestBed.resetTestingModule();
    const nf = Object.assign(new Error('Not found'), { status: 404 });
    const api = { get: vi.fn(() => throwError(() => nf)), put: vi.fn(() => throwError(() => nf)) };
    const toast = { success: vi.fn(), error: vi.fn() };
    TestBed.configureTestingModule({
      imports: [FdGridColumnsComponent],
      providers: [{ provide: ApiService, useValue: api }, { provide: ToastService, useValue: toast },
        { provide: OpdDeskApi, useValue: { visits: () => of([]) } },
        { provide: AuthService, useValue: { user: signal({ id: 'u1', tenantId: 't1' }), activeBranchId: signal(null) } }],
    });
    await TestBed.compileComponents();
    const f = TestBed.createComponent(FdGridColumnsComponent);
    f.componentRef.setInput('module', 'lab');
    f.detectChanges();
    const c = f.componentInstance;
    expect(c.order()).toEqual(defaultFdColumns('lab'));
    c.add('priority');
    expect(await c.saveChanges()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/not available on this server yet/));
    expect(c.dirty()).toBe(true);
  });
  it('a failed save keeps Save enabled', async () => {
    const { c, toast } = await setup({ putFails: true });
    c.add('priority');
    expect(await c.saveChanges()).toBe(false);
    expect(c.dirty()).toBe(true);
    expect(toast.error).toHaveBeenCalled();
  });
  it('Reset to default restores the catalogue (Save keeps it); Discard goes back to what is saved', async () => {
    const { c } = await setup({ saved: { lab: { columns: ['priority'], staffMayHide: true } } });
    c.reset();
    expect(c.order()).toEqual(defaultFdColumns('lab'));
    expect(c.dirty()).toBe(true);
    expect(c.canReset()).toBe(false);
    c.discard();
    expect(c.order()).toEqual(['token', 'patient', 'where', 'priority', 'waiting', 'next']);
    expect(c.dirty()).toBe(false);
  });
  it('Alt+← / Alt+→ on a focused header moves one step; Delete removes', async () => {
    const { c } = await setup();
    const ev = (key: string, altKey = true) => new KeyboardEvent('keydown', { key, altKey });
    c.ctx.columnEdit!.key(ev('ArrowLeft'), 'payment');
    expect(c.order()).toEqual(['token', 'patient', 'where', 'payment', 'samples', 'waiting', 'next']);
    c.ctx.columnEdit!.key(ev('ArrowLeft'), 'payment');     // already first after the locked ones
    expect(c.order()[3]).toBe('payment');
    c.ctx.columnEdit!.key(ev('Delete', false), 'payment');
    expect(c.order()).not.toContain('payment');
    c.ctx.columnEdit!.key(ev('Delete', false), 'waiting');      // fixed before Next: stays
    expect(c.order()).toContain('waiting');
  });
});
