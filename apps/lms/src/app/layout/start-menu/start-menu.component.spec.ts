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
  template: `<pf-start-menu [layout]="layout()" [open]="open()" homeHref="/frontdesk" [showAccount]="showAccount()"
    (closed)="closes = closes + 1; open.set(false)" (account)="accounts = accounts + 1" />`,
})
class Host {
  prefs = TestBed.inject(NavPrefsService);
  open = signal(true);
  showAccount = signal(true);
  cap = signal(10);
  closes = 0;
  accounts = 0;
  layout = computed(() => computeNavLayout({
    all: ALL, more: MORE, roleDefaults: this.prefs.roleDefaults(), userPins: this.prefs.pinned(), capacity: this.cap(),
  }));
}

function setup(opts: { manageRoles?: boolean; roleMap?: unknown; confirm?: boolean; url?: string; showAccount?: boolean; cap?: number } = {}) {
  const store = new FakeStorage();
  const roleMap = opts.roleMap ?? { roles: {} };
  const api = {
    get: vi.fn((p: string) => of(p.includes('nav-defaults') ? roleMap : [{ id: 'r1', name: 'Receptionist' }, { id: 'r2', name: 'Technician' }])),
    put: vi.fn((_p: string, _b: unknown) => of({})),
  };
  const router = { url: opts.url ?? '/lab', navigateByUrl: vi.fn(() => Promise.resolve(true)), navigate: vi.fn(() => Promise.resolve(true)) };
  const dialog = { confirm: vi.fn(() => Promise.resolve(opts.confirm ?? true)) };
  const toast = { success: vi.fn(), error: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: {
        user: signal({ id: 'u1', tenantId: 't1', roles: ['Receptionist'], displayName: 'Lakshmi Rao', tenantName: 'Micro World' }),
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
  if (opts.showAccount === false) f.componentInstance.showAccount.set(false);
  if (opts.cap !== undefined) f.componentInstance.cap.set(opts.cap);
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, host: f.componentInstance, api, router, dialog, toast, store, prefs: f.componentInstance.prefs };
}
const flush = async (f: { detectChanges(): void; whenStable(): Promise<unknown> }) => { f.detectChanges(); await f.whenStable(); f.detectChanges(); };
const tick = () => new Promise(r => setTimeout(r, 0));
const q = <T extends Element = HTMLElement>(el: HTMLElement, sel: string) => el.querySelector<T & HTMLElement>(sel)!;
const tileLabels = (el: HTMLElement) => Array.from(el.querySelectorAll('.sm-tile .sm-tile__lbl')).map(e => e.textContent!.trim());
const rowLabels = (el: HTMLElement) => Array.from(el.querySelectorAll('.sm-rows .sm-row__lbl')).map(e => e.textContent!.trim());
const editLabels = (el: HTMLElement) => Array.from(el.querySelectorAll('.sm-erow__lbl')).map(e => e.textContent!.trim());
const btn = (el: HTMLElement, re: RegExp) => Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(b => re.test(b.textContent!.trim()) || re.test(b.getAttribute('aria-label') ?? ''))!;
const type = (el: HTMLElement, v: string) => {
  const i = q<HTMLInputElement>(el, '.sm-search__input') as HTMLInputElement;
  i.value = v;
  i.dispatchEvent(new Event('input'));
};
const key = (target: Element | Document, k: string, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
const customize = async (f: Parameters<typeof flush>[0], el: HTMLElement) => {
  q<HTMLButtonElement>(el, '[aria-label="Customize the bar"]').click();
  await flush(f);
};

afterEach(() => TestBed.resetTestingModule());

describe('StartMenuComponent', () => {
  describe('normal view', () => {
    it('shows who is signed in: initials, name and "Lab · Role"', async () => {
      const { f, el } = setup();
      await flush(f);
      expect(q(el, '.sm-avatar').textContent!.trim()).toBe('LR');
      expect(q(el, '.sm-me__name').textContent!.trim()).toBe('Lakshmi Rao');
      expect(q(el, '.sm-me__line').textContent!.trim()).toBe('Micro World · Receptionist');
    });

    it('the pinned screens are tiles in bar order (Home first); the rest are plain rows', async () => {
      const { f, el, prefs } = setup();
      prefs.setPinned(['validate', 'frontdesk']);
      await flush(f);
      expect(tileLabels(el)).toEqual(['Home', 'Validate', 'Frontdesk']);
      expect(rowLabels(el)).toEqual(['Lab', 'Results', 'Lab settings', 'Settings']);
      const titles = Array.from(el.querySelectorAll('.sm-sec__t')).map(e => e.textContent!.trim());
      expect(titles).toEqual(['On your bar', 'More screens']);
    });

    it('has no pin / arrow buttons on tiles or rows, and no always-visible search box', async () => {
      const { f, el } = setup();
      await flush(f);
      expect(el.querySelector('.sm-search__input')).toBeNull();
      expect(el.querySelector('.sm-pin')).toBeNull();
      expect(el.querySelectorAll('.sm-tile button, .sm-row button').length).toBe(0);
      expect(el.querySelector('[aria-label^="Move"], [aria-label^="Pin"], [aria-label^="Unpin"]')).toBeNull();
      const search = q(el, '[aria-label="Find a screen"]');
      expect(search.getAttribute('title')).toBe('Find a screen (/)');
    });

    it('highlights the current screen', async () => {
      const { f, el } = setup({ url: '/lab' });
      await flush(f);
      expect(q(el, '[data-sm-item="lab"]').classList).toContain('sm-tile--on');
      expect(q(el, '[data-sm-item="lab"]').getAttribute('aria-current')).toBe('page');
      expect(q(el, '[data-sm-item="validate"]').classList).not.toContain('sm-tile--on');
    });

    it('a tile and a row navigate and close; Home goes to the landing screen', async () => {
      const { f, el, router, host, prefs } = setup();
      prefs.setPinned(['lab']);
      await flush(f);
      q(el, '.sm-tile[data-sm-item="lab"]').click();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/lab');
      host.open.set(true);
      await flush(f);
      q(el, '.sm-row[data-sm-item="results"]').click();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/results');
      host.open.set(true);
      await flush(f);
      q(el, '[data-sm-item="home"]').click();
      expect(router.navigate).toHaveBeenCalledWith(['/frontdesk']);
      expect(host.closes).toBe(3);
    });

    it('says when pinned screens do not fit on the bar at this width', async () => {
      const { f, el, prefs } = setup({ cap: 2 });
      prefs.setPinned(['frontdesk', 'lab', 'validate']);
      await flush(f);
      expect(tileLabels(el)).toEqual(['Home', 'Frontdesk', 'Lab', 'Validate']);
      expect(q(el, '.sm-note').textContent).toContain('1 screen does not fit');
    });

    it('opts out of the phone auto bottom-sheet rule (it would force width:100% and push the sheet off the right edge)', async () => {
      const { f, el } = setup();
      await flush(f);
      expect(q(el, '.sm-panel').classList).toContain('pf-modal-centered');
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
      q(el, '.sm-panel').dispatchEvent(new Event('pointerdown', { bubbles: true }));
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
  });

  describe('account', () => {
    it('with showAccount the person row is the "Account and status" button', async () => {
      const { f, el, host } = setup();
      await flush(f);
      const me = q<HTMLButtonElement>(el, '[data-sm-account]');
      expect(me.tagName).toBe('BUTTON');
      expect(me.getAttribute('aria-label')).toBe('Account and status, Lakshmi Rao');
      me.click();
      expect(host.accounts).toBe(1);
    });

    it('without showAccount the person row is plain text', async () => {
      const { f, el } = setup({ showAccount: false });
      await flush(f);
      expect(el.querySelector('[data-sm-account]')).toBeNull();
      expect(q(el, '.sm-me__name').textContent!.trim()).toBe('Lakshmi Rao');
    });
  });

  describe('search', () => {
    it('the search button reveals a search line in place of the header; Close goes back', async () => {
      const { f, el } = setup();
      await flush(f);
      q<HTMLButtonElement>(el, '[aria-label="Find a screen"]').click();
      await flush(f);
      expect(el.querySelector('.sm-head')).toBeNull();
      expect(el.querySelector('.sm-search__input')).not.toBeNull();
      expect(el.querySelector('.sm-tiles')).toBeNull();
      q<HTMLButtonElement>(el, '[aria-label="Close search"]').click();
      await flush(f);
      expect(el.querySelector('.sm-search__input')).toBeNull();
      expect(el.querySelector('.sm-tiles')).not.toBeNull();
    });

    it('"/" opens search; Escape goes back to the menu without closing it', async () => {
      const { f, el, host } = setup();
      await flush(f);
      const ev = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
      document.dispatchEvent(ev);
      await flush(f);
      expect(ev.defaultPrevented).toBe(true);
      expect(el.querySelector('.sm-search__input')).not.toBeNull();
      key(document, 'Escape');
      await flush(f);
      expect(host.closes).toBe(0);
      expect(el.querySelector('.sm-search__input')).toBeNull();
    });

    it('just typing opens search with that letter and filters', async () => {
      const { f, el } = setup();
      await flush(f);
      key(document, 'v');
      await flush(f);
      expect((q(el, '.sm-search__input') as HTMLInputElement).value).toBe('v');
      expect(rowLabels(el)).toEqual(['Validate']);
    });

    it('letters typed before the search line takes focus still land in it', async () => {
      const { f, el } = setup();
      await flush(f);
      key(document, 'r');
      key(document, 'e');
      await flush(f);
      expect((q(el, '.sm-search__input') as HTMLInputElement).value).toBe('re');
    });

    it('ignores shortcuts with Ctrl / Cmd', async () => {
      const { f, el } = setup();
      await flush(f);
      key(document, 'k', { metaKey: true });
      await flush(f);
      expect(el.querySelector('.sm-search__input')).toBeNull();
    });

    it('filters and Enter opens the first match', async () => {
      const { f, el, router, host } = setup();
      await flush(f);
      q<HTMLButtonElement>(el, '[aria-label="Find a screen"]').click();
      await flush(f);
      type(el, 'lab');
      await flush(f);
      expect(rowLabels(el)).toEqual(['Lab', 'Lab settings']);
      key(q(el, '.sm-search__input'), 'Enter');
      expect(router.navigateByUrl).toHaveBeenCalledWith('/lab');
      expect(host.closes).toBe(1);
    });

    it('says so when nothing matches, and Enter does nothing', async () => {
      const { f, el, router } = setup();
      await flush(f);
      q<HTMLButtonElement>(el, '[aria-label="Find a screen"]').click();
      await flush(f);
      type(el, 'zzz');
      await flush(f);
      expect(el.querySelector('.sm-empty')).not.toBeNull();
      key(q(el, '.sm-search__input'), 'Enter');
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });
  });

  describe('customize', () => {
    it('the pencil opens Customize: title, capacity, the bar as rows, the rest as chips; Done returns', async () => {
      const { f, el, prefs } = setup({ cap: 6 });
      prefs.setPinned(['frontdesk', 'lab']);
      await flush(f);
      await customize(f, el);
      expect(q(el, '.sm-edit-head__t').textContent!.trim()).toBe('Customize your bar');
      expect(q(el, '.sm-edit-head__s').textContent!.trim()).toBe('Drag to reorder. 6 fit on this screen.');
      expect(editLabels(el)).toEqual(['Frontdesk', 'Lab']);
      const chips = Array.from(el.querySelectorAll('.sm-chip')).map(c => c.textContent!.trim());
      expect(chips).toEqual(['Validate', 'Results', 'Lab settings', 'Settings']);
      const primaries = el.querySelectorAll('.pf-btn--primary');
      expect(primaries.length).toBe(1);
      expect(primaries[0].textContent!.trim()).toBe('Done');
      (primaries[0] as HTMLButtonElement).click();
      await flush(f);
      expect(el.querySelector('.sm-tiles')).not.toBeNull();
    });

    it('"−" takes a screen off the bar (saved for this person in this browser)', async () => {
      const { f, el, prefs, store } = setup();
      await flush(f);
      await customize(f, el);
      q<HTMLButtonElement>(el, '[aria-label="Take Lab off the bar"]').click();
      await flush(f);
      expect(prefs.pinned()).toEqual(['frontdesk', 'validate', 'results', 'admin']);
      expect(JSON.parse(store.data.get('pf.nav.prefs.t1.u1')!).pinned).toEqual(['frontdesk', 'validate', 'results', 'admin']);
      expect(q(el, '[data-sm-add="lab"]')).not.toBeNull();
    });

    it('a chip adds the screen to the end of the bar (menu-only screens too)', async () => {
      const { f, el, prefs } = setup();
      prefs.setPinned(['frontdesk']);
      await flush(f);
      await customize(f, el);
      q<HTMLButtonElement>(el, '[data-sm-add="lab-settings"]').click();
      await flush(f);
      expect(prefs.pinned()).toEqual(['frontdesk', 'lab-settings']);
      expect(editLabels(el)).toEqual(['Frontdesk', 'Lab settings']);
      expect(el.querySelector('[data-sm-add="lab-settings"]')).toBeNull();
    });

    it('a locked screen says "Kept by admin" and has no "−"', async () => {
      const { f, el, prefs } = setup({ roleMap: { roles: { Receptionist: { pinned: ['frontdesk', 'lab'], locked: ['frontdesk'] } } } });
      prefs.ensureDefaults();
      await flush(f);
      await customize(f, el);
      const fd = q(el, '[data-sm-edit="frontdesk"]');
      expect(fd.textContent).toContain('Kept by admin');
      expect(fd.querySelector('.sm-off')).toBeNull();
      expect(q(el, '[data-sm-edit="lab"]').querySelector('.sm-off')).not.toBeNull();
    });

    it('Alt+ArrowUp / Alt+ArrowDown reorder the focused row', async () => {
      const { f, el, prefs } = setup();
      prefs.setPinned(['frontdesk', 'lab', 'validate']);
      await flush(f);
      await customize(f, el);
      key(q(el, '[data-sm-edit="lab"]'), 'ArrowDown', { altKey: true });
      await flush(f);
      expect(prefs.pinned()).toEqual(['frontdesk', 'validate', 'lab']);
      key(q(el, '[data-sm-edit="lab"]'), 'ArrowUp', { altKey: true });
      await flush(f);
      expect(prefs.pinned()).toEqual(['frontdesk', 'lab', 'validate']);
      key(q(el, '[data-sm-edit="frontdesk"]'), 'ArrowUp', { altKey: true }); // already first
      await flush(f);
      expect(prefs.pinned()).toEqual(['frontdesk', 'lab', 'validate']);
      await tick();
    });

    it('nothing moves above an admin-locked screen', async () => {
      const { f, el, prefs } = setup({ roleMap: { roles: { Receptionist: { pinned: ['frontdesk'], locked: ['frontdesk'] } } } });
      prefs.ensureDefaults();
      prefs.setPinned(['lab', 'validate']);
      await flush(f);
      await customize(f, el);
      expect(editLabels(el)).toEqual(['Frontdesk', 'Lab', 'Validate']);
      key(q(el, '[data-sm-edit="lab"]'), 'ArrowUp', { altKey: true });
      await flush(f);
      expect(editLabels(el)).toEqual(['Frontdesk', 'Lab', 'Validate']);
      key(q(el, '[data-sm-edit="frontdesk"]'), 'ArrowDown', { altKey: true });
      await flush(f);
      expect(editLabels(el)).toEqual(['Frontdesk', 'Lab', 'Validate']);
    });

    it('a drop reorders through the same pin list', async () => {
      const { f, el, prefs } = setup();
      prefs.setPinned(['frontdesk', 'lab', 'validate']);
      await flush(f);
      await customize(f, el);
      const cmp = f.debugElement.children[0].componentInstance as unknown as { onDrop(e: { previousIndex: number; currentIndex: number }): void };
      cmp.onDrop({ previousIndex: 2, currentIndex: 0 });
      await flush(f);
      expect(prefs.pinned()).toEqual(['validate', 'frontdesk', 'lab']);
    });

    it('Show icons only toggles the bar to icons only', async () => {
      const { f, el, prefs } = setup();
      await flush(f);
      await customize(f, el);
      expect(q(el, '.sm-foot__lbl').textContent!.trim()).toBe('Show icons only');
      q<HTMLButtonElement>(el, 'pf-toggle button').click();
      expect(prefs.iconsOnly()).toBe(true);
    });

    it('Reset asks, then goes back to the role defaults (and is off when never customised)', async () => {
      const { f, el, prefs, dialog } = setup();
      await flush(f);
      await customize(f, el);
      const resetBtn = () => q<HTMLButtonElement>(el, '[data-sm-reset]') as HTMLButtonElement;
      expect(resetBtn().disabled).toBe(true);
      prefs.setPinned(['lab']);
      await flush(f);
      expect(resetBtn().disabled).toBe(false);
      resetBtn().click();
      await flush(f);
      expect(dialog.confirm).toHaveBeenCalledTimes(1);
      expect(prefs.pinned()).toBeNull();
    });

    it('Reset does nothing when the person says no; the panel steps aside only while asking', async () => {
      let answer!: (v: boolean) => void;
      const { f, el, prefs, dialog } = setup();
      dialog.confirm.mockImplementation(() => new Promise<boolean>(r => { answer = r; }));
      prefs.setPinned(['lab']);
      await flush(f);
      await customize(f, el);
      q<HTMLButtonElement>(el, '[data-sm-reset]').click();
      f.detectChanges();
      expect(q(el, '.sm-panel').classList).toContain('sm-panel--aside');
      answer(false);
      await flush(f);
      expect(q(el, '.sm-panel').classList).not.toContain('sm-panel--aside');
      expect(prefs.pinned()).toEqual(['lab']);
    });
  });

  describe('role defaults', () => {
    it('is only offered with manage_roles', async () => {
      const a = setup({ manageRoles: false });
      await flush(a.f);
      await customize(a.f, a.el);
      expect(a.el.querySelector('[data-sm-roles]')).toBeNull();
      TestBed.resetTestingModule();
      const b = setup({ manageRoles: true });
      await flush(b.f);
      await customize(b.f, b.el);
      expect(b.el.querySelector('[data-sm-roles]')!.textContent).toContain('Role defaults');
    });

    it('pin, lock and order for a role, then Save sends PUT with locked inside pinned; Back returns to Customize', async () => {
      const { f, el, api, toast } = setup({
        manageRoles: true,
        roleMap: { roles: { Technician: { pinned: ['results'], locked: [] } } },
      });
      await flush(f);
      await customize(f, el);
      q<HTMLButtonElement>(el, '[data-sm-roles]').click();
      await flush(f);
      expect(api.get).toHaveBeenCalledWith('/api/roles/');
      const rrow = (id: string) => el.querySelector<HTMLElement>(`[data-role-item="${id}"]`)!;
      rrow('lab').querySelector<HTMLButtonElement>('.sm-pin')!.click();
      await flush(f);
      rrow('frontdesk').querySelector<HTMLButtonElement>('[aria-label^="Lock"]')!.click();
      await flush(f);
      expect(el.textContent).toContain('People can still change their own bar unless a screen is locked');
      btn(el, /Save role defaults/).click();
      await flush(f);
      expect(api.put).toHaveBeenCalledTimes(1);
      const [path, body] = api.put.mock.calls[0] as [string, { roles: Record<string, { pinned: string[]; locked: string[] }> }];
      expect(path).toBe('/api/tenants/nav-defaults');
      expect(body.roles['Receptionist']).toEqual({ pinned: ['lab', 'frontdesk'], locked: ['frontdesk'] });
      expect(body.roles['Technician']).toEqual({ pinned: ['results'], locked: [] });
      for (const r of Object.values(body.roles)) r.locked.forEach(l => expect(r.pinned).toContain(l));
      expect(toast.success).toHaveBeenCalled();
      q<HTMLButtonElement>(el, '[aria-label="Back to Customize"]').click();
      await flush(f);
      expect(el.querySelector('.sm-edit-head')).not.toBeNull();
    });
  });
});
