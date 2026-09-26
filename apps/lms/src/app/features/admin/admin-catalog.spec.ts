import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import {
  ADMIN_CATEGORIES, ADMIN_SETTINGS, AdminAccess, adminParentFor, canSee, expandWord, hubPages, searchAdmin, visibleCategories,
} from './admin-catalog';
import { AdminAccessService, AdminDirectoryComponent, AdminSearchResultsComponent } from './admin-directory.component';

const all: AdminAccess = { hasAnyPermission: () => true, moduleEnabled: () => true };
const only = (perms: string[], modulesOff: string[] = []): AdminAccess => ({
  hasAnyPermission: (codes) => codes.some((c) => perms.includes(c)),
  moduleEnabled: (k) => !modulesOff.includes(k),
});

describe('Admin catalogue — search (pages AND single settings, plain words + synonyms)', () => {
  for (const word of ['barcode', 'QR', 'scan']) {
    it(`"${word}" → Lab settings › How staff find a sample (first), deep-linked`, () => {
      const hits = searchAdmin(word, all);
      const first = hits[0];
      expect(first.kind).toBe('setting');
      if (first.kind !== 'setting') return;
      expect(first.setting.label).toBe('How staff find a sample');
      expect(first.page.href).toBe('/admin/lab-settings');
      expect(first.setting.id).toBe('scan-mode'); // the #fragment the result links to
    });
  }

  it('synonyms: "doctor" finds "Doctor must check every result"; "tax" finds GST', () => {
    expect(searchAdmin('doctor', all).some((h) => h.kind === 'setting' && h.setting.id === 'require-validation')).toBe(true);
    expect(searchAdmin('tax', all).some((h) => h.kind === 'setting' && h.setting.id === 'gst')).toBe(true);
    expect(expandWord('qr')).toEqual(expect.arrayContaining(['barcode', 'scan']));
  });

  it('finds pages too, and every word must match (AND)', () => {
    const hits = searchAdmin('users', all);
    expect(hits.some((h) => h.kind === 'page' && h.page.href === '/admin/users')).toBe(true);
    expect(searchAdmin('zzzz', all)).toEqual([]);
    expect(searchAdmin('   ', all)).toEqual([]);
    expect(searchAdmin('bill number', all)[0]).toMatchObject({ kind: 'setting', setting: { id: 'invoice-number' } });
  });

  it('never returns a page or setting the user can\'t open', () => {
    const labTech = only(['enter_result']);
    expect(searchAdmin('scan', labTech)).toEqual([]);
    const tenantOnly = only(['manage_tenant']);
    const hits = searchAdmin('gst', tenantOnly);
    expect(hits.length).toBeGreaterThan(0);
    expect(searchAdmin('barcode', tenantOnly).some((h) => h.page.id === 'lab-settings')).toBe(false);
  });

  it('every indexed setting points at a real page', () => {
    const pageIds = new Set(ADMIN_CATEGORIES.flatMap((c) => c.pages.map((p) => p.id)));
    for (const s of ADMIN_SETTINGS) expect(pageIds.has(s.page), s.id).toBe(true);
    const ids = ADMIN_SETTINGS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('Admin catalogue — permission hiding', () => {
  it('pages mirror their guards; empty categories drop out', () => {
    const cats = visibleCategories(only(['manage_users']));
    const ids = cats.map((c) => c.id);
    expect(ids).toContain('people');
    expect(ids).not.toContain('finance');
    expect(cats.find((c) => c.id === 'people')!.pages.map((p) => p.id)).toEqual(['users']); // no audit perm
  });

  it('a switched-off module hides its pages', () => {
    const cats = visibleCategories(only(['manage_inventory', 'manage_users'], ['inventory']));
    expect(cats.map((c) => c.id)).not.toContain('inventory');
    expect(canSee({ module: 'inventory' }, all)).toBe(true);
  });

  it('the Lab hub also lists referral labs + referring doctors (alsoIn), each page once on the home', () => {
    expect(hubPages('lab', all).map((p) => p.id)).toEqual(expect.arrayContaining(['referral-labs', 'referring-network']));
    const homeIds = visibleCategories(all).flatMap((c) => c.pages.map((p) => p.id));
    expect(new Set(homeIds).size).toBe(homeIds.length);
  });

  it('back chevron parent: an admin page returns to its Admin-home category', () => {
    expect(adminParentFor('/admin/lab-settings')).toBe('/admin?cat=lab');
    expect(adminParentFor('/admin/billing#gst')).toBe('/admin?cat=finance');
    expect(adminParentFor('/setup')).toBe('/admin?cat=org');
    expect(adminParentFor('/admin/users/42/edit')).toBeNull();
  });
});

describe('Admin directory + results (rendered)', () => {
  function setup(access: AdminAccess) {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AdminAccessService, useValue: { ...access, ensureLoaded: vi.fn() } }],
    });
  }

  it('every visible page is ONE link on the directory; hidden categories render nothing', () => {
    setup(only(['manage_tenant']));
    const f = TestBed.createComponent(AdminDirectoryComponent);
    f.componentRef.setInput('categories', visibleCategories(only(['manage_tenant'])));
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const hrefs = Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/admin/billing');
    expect(hrefs).toContain('/admin/organization');
    expect(hrefs).not.toContain('/admin/users');
    expect(el.querySelector('#cat-people')).toBeNull();
  });

  it('a setting hit links to its page with the anchor as the fragment', async () => {
    setup(all);
    const f = TestBed.createComponent(AdminSearchResultsComponent);
    f.componentRef.setInput('hits', searchAdmin('qr', all));
    f.componentRef.setInput('query', 'qr');
    f.detectChanges();
    const first = (f.nativeElement as HTMLElement).querySelector('a')!;
    expect(first.getAttribute('href')).toBe('/admin/lab-settings#scan-mode');
    expect(first.textContent).toContain('How staff find a sample');
    expect(first.textContent).toContain('Lab settings › Samples');
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    first.click();
    expect(String(nav.mock.calls[0][0])).toBe('/admin/lab-settings#scan-mode');
  });
});
