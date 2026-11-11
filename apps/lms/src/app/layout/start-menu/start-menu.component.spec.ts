import { Component, computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { ApiService } from '../../core/services/api.service';
import { DialogService } from '../../core/services/dialog.service';
import { ToastService } from '../../core/services/toast.service';
import { NavItem } from '../nav-items';
import { NAV_PREFS_STORAGE, NavPrefsService } from './nav-prefs.service';
import { computeNavLayout } from './nav-pins';
import { StartMenuComponent } from './start-menu.component';

const item = (id: string, label: string, href = `/${id}`): NavItem => ({ id, label, href, iconPath: ['M0 0'] });
const ALL = [item('frontdesk', 'Frontdesk'), item('lab', 'Lab'), item('validate', 'Validate'), item('results', 'Results'), item('admin', 'Settings')];
const MORE = [item('lab-settings', 'Lab settings', '/lab/settings')];

class FakeStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

@Component({
  standalone: true,
  imports: [StartMenuComponent],
  template: `<pf-start-menu [layout]="layout()" [open]="open()" homeHref="/frontdesk" [showAccount]="true"
    (closed)="closes = closes + 1; open.set(false)" (account)="accounts = accounts + 1" />`,
})
class Host {
  prefs = TestBed.inject(NavPrefsService);
  open = signal(true);
  closes = 0;
  accounts = 0;
  layout = computed(() => computeNavLayout({
    all: ALL, more: MORE, roleDefaults: this.prefs.roleDefaults(), userPins: this.prefs.pinned(), capacity: 10,
  }));
}

function setup(opts: { manageRoles?: boolean; roleMap?: unknown; confirm?: boolean } = {}) {
  const store = new FakeStorage();
  const roleMap = opts.roleMap ?? { roles: {} };
  const api = {
    get: vi.fn((p: string) => of(p.includes('nav-defaults') ? roleMap : [{ id: 'r1', name: 'Receptionist' }, { id: 'r2', name: 'Technician' }])),
    put: vi.fn((_p: string, _b: unknown) => of({})),
  };
  const router = { navigateByUrl: vi.fn(() => Promise.resolve(true)), navigate: vi.fn(() => Promise.resolve(true)) };
  const dialog = { confirm: vi.fn(() => Promise.resolve(opts.confirm ?? true)) };
  const toast = { success: vi.fn(), error: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: {
        user: signal({ id: 'u1', tenantId: 't1', roles: ['Receptionist'] }),
        hasPermission: (c: string) => c === 'manage_roles' && !!opts.manageRoles,
      } },
      { provide: ApiService, useValue: api },
      { provide: Router, useValue: router },
      { provide: DialogService, useValue: dialog },
      { provide: ToastService, useValue: toast },
      { provide: NAV_PREFS_STORAGE, useValue: () => store as unknown as Storage },
    ],
  });
  const f = TestBed.createComponent(Host);
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, host: f.componentInstance, api, router, dialog, toast, store, prefs: f.componentInstance.prefs };
}
const flush = async (f: { detectChanges(): void; whenStable(): Promise<unknown> }) => { f.detectChanges(); await f.whenStable(); f.detectChanges(); };
const row = (el: HTMLElement, id: string) => el.querySelector<HTMLElement>(`[data-sm-item="${id}"]`)!;
const labels = (el: HTMLElement) => Array.from(el.querySelectorAll('.sm-row__lbl')).map(e => e.textContent!.trim());
const type = (el: HTMLElement, v: string) => {
  const i = el.querySelector<HTMLInputElement>('.sm-search__input')!;
  i.value = v;
  i.dispatchEvent(new Event('input'));
};
const key = (target: Element | Document, k: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

afterEach(() => TestBed.resetTestingModule());

describe('StartMenuComponent', () => {
  it('lists Home and every screen the person may open, grouped', async () => {
    const { f, el } = setup();
    await flush(f);
    expect(labels(el)).toContain('Home');
    // nothing configured = today's bar, so every work screen starts pinned; the menu-only one sits under More
    const titles = Array.from(el.querySelectorAll('.sm-sec__t')).map(e => e.textContent!.trim());
    expect(titles).toEqual(['Pinned', 'More']);
    expect(labels(el)).toEqual(['Home', 'Frontdesk', 'Lab', 'Validate', 'Results', 'Settings', 'Lab settings']);
  });

  it('Home goes to the landing screen and closes', async () => {
    const { f, el, router, host } = setup();
    await flush(f);
    row(el, 'home').querySelector<HTMLButtonElement>('.sm-row__open')!.click();
    expect(router.navigate).toHaveBeenCalledWith(['/frontdesk']);
    expect(host.closes).toBe(1);
  });

  it('typing filters and Enter opens the first match', async () => {
    const { f, el, router, host } = setup();
    await flush(f);
    type(el, 'valid');
    await flush(f);
    expect(labels(el)).toEqual(['Validate']);
    key(el.querySelector('.sm-search__input')!, 'Enter');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/validate');
    expect(host.closes).toBe(1);
  });

  it('says so when nothing matches, and Enter does nothing', async () => {
    const { f, el, router } = setup();
    await flush(f);
    type(el, 'zzz');
    await flush(f);
    expect(el.querySelector('.sm-empty')).not.toBeNull();
    key(el.querySelector('.sm-search__input')!, 'Enter');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('opts out of the phone auto bottom-sheet rule (it would force width:100% and push the sheet off the right edge)', async () => {
    const { f, el } = setup();
    await flush(f);
    expect(el.querySelector('.sm-panel')!.classList).toContain('pf-modal-centered');
  });

  it('Escape closes', async () => {
    const { f, host } = setup();
    await flush(f);
    key(document, 'Escape');
    expect(host.closes).toBe(1);
  });

  it('a press outside closes; a press inside or on the PF logo does not', async () => {
    const { f, el, host } = setup();
    await flush(f);
    el.querySelector('.sm-panel')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(host.closes).toBe(0);
    const logo = document.createElement('button');
    logo.setAttribute('data-start-trigger', '');
    document.body.appendChild(logo);
    logo.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(host.closes).toBe(0);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(host.closes).toBe(1);
    logo.remove();
  });

  it('unpin then pin a screen: saved for this person in this browser', async () => {
    const { f, el, prefs, store } = setup();
    await flush(f);
    row(el, 'lab').querySelector<HTMLButtonElement>('.sm-pin')!.click();
    await flush(f);
    expect(prefs.pinned()).toEqual(['frontdesk', 'validate', 'results', 'admin']);
    expect(JSON.parse(store.data.get('pf.nav.prefs.t1.u1')!).pinned).toEqual(['frontdesk', 'validate', 'results', 'admin']);
    // now in Work, offered with a Pin button
    const pin = row(el, 'lab').querySelector<HTMLButtonElement>('.sm-pin')!;
    expect(pin.getAttribute('aria-pressed')).toBe('false');
    pin.click();
    await flush(f);
    expect(prefs.pinned()).toEqual(['frontdesk', 'validate', 'results', 'admin', 'lab']);
    expect(row(el, 'lab').querySelector('.sm-pin')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('a menu-only screen can be pinned', async () => {
    const { f, el, prefs } = setup();
    await flush(f);
    row(el, 'lab-settings').querySelector<HTMLButtonElement>('.sm-pin')!.click();
    expect(prefs.pinned()).toContain('lab-settings');
  });

  it('a locked screen shows a lock and has no unpin button', async () => {
    const { f, el, prefs } = setup({ roleMap: { roles: { Receptionist: { pinned: ['frontdesk', 'lab'], locked: ['frontdesk'] } } } });
    prefs.ensureDefaults();
    await flush(f);
    const fd = row(el, 'frontdesk');
    expect(fd.querySelector('.sm-lock')).not.toBeNull();
    expect(fd.querySelector('.sm-pin')).toBeNull();
    expect(row(el, 'lab').querySelector('.sm-pin')).not.toBeNull();
  });

  it('reorders pinned screens with the move buttons', async () => {
    const { f, el, prefs } = setup();
    await flush(f);
    row(el, 'lab').querySelectorAll<HTMLButtonElement>('.sm-ico')[1].click(); // move down
    await flush(f);
    expect(prefs.pinned()!.slice(0, 3)).toEqual(['frontdesk', 'validate', 'lab']);
  });

  it('Icons only toggles the bar to icons only', async () => {
    const { f, el, prefs } = setup();
    await flush(f);
    const sw = el.querySelector<HTMLButtonElement>('pf-toggle button')!;
    sw.click();
    expect(prefs.iconsOnly()).toBe(true);
  });

  it('Reset asks, then goes back to the role defaults (and is off when never customised)', async () => {
    const { f, el, prefs, dialog } = setup();
    await flush(f);
    const resetBtn = () => Array.from(el.querySelectorAll<HTMLButtonElement>('.sm-foot button')).find(b => /Reset/.test(b.textContent!))!;
    expect(resetBtn().disabled).toBe(true);
    prefs.setPinned(['lab']);
    await flush(f);
    expect(resetBtn().disabled).toBe(false);
    resetBtn().click();
    await flush(f);
    expect(dialog.confirm).toHaveBeenCalledTimes(1);
    expect(prefs.pinned()).toBeNull();
  });

  it('Reset does nothing when the person says no', async () => {
    const { f, el, prefs } = setup({ confirm: false });
    prefs.setPinned(['lab']);
    await flush(f);
    Array.from(el.querySelectorAll<HTMLButtonElement>('.sm-foot button')).find(b => /Reset/.test(b.textContent!))!.click();
    await flush(f);
    expect(prefs.pinned()).toEqual(['lab']);
  });

  it('Account and status asks the shell to open the account menu', async () => {
    const { f, el, host } = setup();
    await flush(f);
    Array.from(el.querySelectorAll<HTMLButtonElement>('.sm-foot button')).find(b => /Account/.test(b.textContent!))!.click();
    expect(host.accounts).toBe(1);
  });

  describe('role defaults', () => {
    it('is only offered with manage_roles', async () => {
      const a = setup({ manageRoles: false });
      await flush(a.f);
      expect(a.el.textContent).not.toContain('Role defaults');
      TestBed.resetTestingModule();
      const b = setup({ manageRoles: true });
      await flush(b.f);
      expect(b.el.textContent).toContain('Role defaults');
    });

    it('pin, lock and order for a role, then Save sends PUT with locked inside pinned', async () => {
      const { f, el, api, toast } = setup({
        manageRoles: true,
        roleMap: { roles: { Technician: { pinned: ['results'], locked: [] } } },
      });
      await flush(f);
      Array.from(el.querySelectorAll<HTMLButtonElement>('.sm-foot button')).find(b => /Role defaults/.test(b.textContent!))!.click();
      await flush(f);
      expect(api.get).toHaveBeenCalledWith('/api/roles/');
      // first role loaded is picked (Receptionist): pin Lab, lock Frontdesk (locking pins it)
      const rrow = (id: string) => el.querySelector<HTMLElement>(`[data-role-item="${id}"]`)!;
      rrow('lab').querySelector<HTMLButtonElement>('.sm-pin')!.click();
      await flush(f);
      rrow('frontdesk').querySelector<HTMLButtonElement>('[aria-label^="Lock"]')!.click();
      await flush(f);
      expect(el.textContent).toContain('People can still change their own bar unless a screen is locked');
      Array.from(el.querySelectorAll<HTMLButtonElement>('.sm-foot button')).find(b => /Save/.test(b.textContent!))!.click();
      await flush(f);
      expect(api.put).toHaveBeenCalledTimes(1);
      const [path, body] = api.put.mock.calls[0] as [string, { roles: Record<string, { pinned: string[]; locked: string[] }> }];
      expect(path).toBe('/api/tenants/nav-defaults');
      expect(body.roles['Receptionist']).toEqual({ pinned: ['lab', 'frontdesk'], locked: ['frontdesk'] });
      expect(body.roles['Technician']).toEqual({ pinned: ['results'], locked: [] });
      for (const r of Object.values(body.roles)) r.locked.forEach(l => expect(r.pinned).toContain(l));
      expect(toast.success).toHaveBeenCalled();
    });
  });
});
