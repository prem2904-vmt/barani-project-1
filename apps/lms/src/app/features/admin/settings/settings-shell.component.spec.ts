import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TwoPanelComponent } from '@prefrontal/shared';
import { SettingsShellComponent } from './settings-shell.component';
import { SettingsAccessService } from './settings-access.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { injectSettingsHosted } from '../../../shared/utils/settings-host';
import { SettingsItem } from './settings-map';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';

/** A stand-in page: reports whether the shell hosts it (SETTINGS_HOST). */
@Component({ standalone: true, template: '<span data-testid="page" [attr.data-hosted]="hosted">page</span>' })
class PageStub { readonly hosted = injectSettingsHosted(); }

function setup(opts: { compact?: boolean; hide?: string[] } = {}) {
  (window as any).matchMedia = (q: string) => ({
    matches: !!opts.compact && q.includes('max-width: 767px'),
    addEventListener() {}, removeEventListener() {},
  });
  const hide = new Set(opts.hide ?? []);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'admin', component: PageStub },
        { path: 'admin/reports', component: PageStub },
        {
          path: '', component: SettingsShellComponent,
          children: [
            { path: 'admin/org/numbers', component: PageStub },
            { path: 'admin/billing', component: PageStub },
            { path: 'admin/lab/report-options', component: PageStub },
          ],
        },
      ]),
      { provide: AuthService, useValue: { user: () => ({ tenantName: 'Micro World' }), hasPermission: () => true, hasAnyPermission: () => true } },
      { provide: TenantStateService, useValue: { tenant: () => null } },
      {
        provide: SettingsAccessService,
        useValue: { visibleCategories: (i: SettingsItem) => i.categories.filter((c) => !hide.has(`${i.id}/${c.id}`)) },
      },
    ],
  });
}

async function open(url: string) {
  const h = await RouterTestingHarness.create();
  await h.navigateByUrl(url);
  h.detectChanges();
  await h.fixture.whenStable();
  h.detectChanges();
  return h;
}
const root = (h: RouterTestingHarness) => h.fixture.nativeElement as HTMLElement;
const cats = (e: HTMLElement) => Array.from(e.querySelectorAll('[data-testid^="tp-item-"]')).map((b) => b.getAttribute('data-testid')!.slice(8));
const settle = async (h: RouterTestingHarness) => { await h.fixture.whenStable(); h.detectChanges(); await h.fixture.whenStable(); h.detectChanges(); };

describe('Settings shell — Test Master frame, two cards (wide)', () => {
  beforeEach(() => document.documentElement.classList.add('design-new'));

  it('ONE band (TM): back chevron + search pill "Search <setting>"; side card = THAT setting under a back arrow, then its categories', async () => {
    setup();
    const h = await open('/admin/billing?tab=payments');
    expect(root(h).querySelectorAll('pf-hero-band').length).toBe(1);
    expect(root(h).querySelector<HTMLInputElement>('.pf-hb__input')?.placeholder).toBe('Search Billing and taxes');
    expect(root(h).querySelector('aside.pf-card [data-testid="tp-nav-title"]')?.textContent).toContain('Billing and taxes');
    expect(root(h).querySelector('[data-testid="tp-nav-back"]')).not.toBeNull();
    expect(cats(root(h))).toEqual(['gst', 'invoice', 'payments', 'credit']);
    expect(root(h).querySelector('[data-testid="tp-item-payments"]')?.getAttribute('aria-current')).toBe('true');
    expect(root(h).querySelector('section.pf-card .pf-card__head .pf-tp__title')?.textContent).toContain('Payment rules');
  });

  it('the screen sits in the main card and knows it is hosted', async () => {
    setup();
    const h = await open('/admin/billing?tab=gst');
    const page = root(h).querySelector('[data-testid="page"]')!;
    expect(page.getAttribute('data-hosted')).toBe('true');
    expect(root(h).querySelector('[data-testid="tp-panel"]')?.contains(page)).toBe(true);
  });

  it('a page without ?tab= gets its first category in the URL', async () => {
    setup();
    await open('/admin/billing');
    expect(TestBed.inject(Router).url).toContain('tab=gst');
  });

  it('picking a category opens its ?tab=', async () => {
    setup();
    const h = await open('/admin/billing?tab=gst');
    root(h).querySelector<HTMLButtonElement>('[data-testid="tp-item-credit"]')!.click();
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/admin/billing?tab=credit');
  });

  it('the side card back arrow returns to the overview, on the section this setting belongs to', async () => {
    setup();
    const h = await open('/admin/billing?tab=gst');
    root(h).querySelector<HTMLButtonElement>('[data-testid="tp-nav-back"]')!.click();
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/admin?section=billing');
  });

  it('categories this person cannot open are not listed', async () => {
    setup({ hide: ['org-billing/credit'] });
    const h = await open('/admin/billing?tab=gst');
    expect(cats(root(h))).toEqual(['gst', 'invoice', 'payments']);
  });

  it('the side card slides in (260 ms, off under reduced motion)', async () => {
    setup();
    const h = await open('/admin/billing?tab=gst');
    const scroll = root(h).querySelector('.pf-tp__scroll')!;
    expect(scroll.classList.contains('pf-tp__scroll--a') || scroll.classList.contains('pf-tp__scroll--b')).toBe(true);
    const css = ((TwoPanelComponent as any).ɵcmp.styles as string[]).join('\n');
    expect(css).toContain('260ms');
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.pf-tp__scroll--a/);
  });
});

describe('Settings shell — ONE page of group cards (few short categories)', () => {
  beforeEach(() => document.documentElement.classList.add('design-new'));

  it('no side card and no wrapper card: the page fills the width under the band', async () => {
    setup();
    const h = await open('/admin/org/numbers?tab=order');
    expect(root(h).querySelector('[data-testid="tp-nav"]')).toBeNull();
    const main = root(h).querySelector('[data-testid="settings-main"]')!;
    expect(main.querySelector('[data-testid="page"]')?.getAttribute('data-hosted')).toBe('true');
    expect(main.closest('section.pf-card')).toBeNull();
    expect(root(h).querySelector<HTMLInputElement>('.pf-hb__input')?.placeholder).toBe('Search Patient and order numbers');
  });

  it('a setting that also has a full-screen page shows the page switch in the band (Report design · Report options)', async () => {
    setup();
    const h = await open('/admin/lab/report-options');
    await settle(h);
    const sw = root(h).querySelector('pf-hero-band [data-testid="settings-siblings"]');
    expect(sw).not.toBeNull();
    expect(Array.from(sw!.querySelectorAll('[role="radio"]')).map((b) => b.textContent?.trim())).toEqual(['Report design', 'Report options']);
  });

  it('the band back chevron on a deep link climbs to the Settings section', async () => {
    setup();
    const h = await open('/admin/org/numbers');
    root(h).querySelector<HTMLButtonElement>('.pf-hb__back')!.click();
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/admin?section=numbers');
  });
});

describe('Settings shell — phone: categories list, then drill in', () => {
  beforeEach(() => document.documentElement.classList.add('design-new'));

  it('opening a two-card setting shows the category list first, no screen, no hop', async () => {
    setup({ compact: true });
    const h = await open('/admin/billing');
    expect(root(h).querySelector('.pf-tp--compact')).not.toBeNull();
    expect(root(h).querySelector('.pf-tp--detail')).toBeNull();
    expect(cats(root(h))).toEqual(['gst', 'invoice', 'payments', 'credit']);
    expect(TestBed.inject(Router).url).toBe('/admin/billing');
  });

  it('a tap drills into the screen with a back chevron; the chevron returns to the list', async () => {
    setup({ compact: true });
    const h = await open('/admin/billing');
    root(h).querySelector<HTMLButtonElement>('[data-testid="tp-item-payments"]')!.click();
    await settle(h);
    expect(root(h).querySelector('.pf-tp--detail')).not.toBeNull();
    expect(TestBed.inject(Router).url).toContain('tab=payments');
    root(h).querySelector<HTMLButtonElement>('[data-testid="tp-back"]')!.click();
    h.detectChanges();
    expect(root(h).querySelector('.pf-tp--detail')).toBeNull();
  });

  it('swipe / hardware back (NavBackService) climbs one level: screen → categories', async () => {
    setup({ compact: true });
    const h = await open('/admin/billing');
    root(h).querySelector<HTMLButtonElement>('[data-testid="tp-item-gst"]')!.click();
    await settle(h);
    TestBed.inject(NavBackService).back();
    await settle(h);
    expect(root(h).querySelector('.pf-tp--detail')).toBeNull();
  });

  it('a deep link that names a category opens the screen directly', async () => {
    setup({ compact: true });
    const h = await open('/admin/billing?tab=credit');
    expect(root(h).querySelector('.pf-tp--detail')).not.toBeNull();
  });

  it('a one-page setting shows its page directly', async () => {
    setup({ compact: true });
    const h = await open('/admin/org/numbers');
    expect(root(h).querySelector('[data-testid="settings-main"] [data-testid="page"]')).not.toBeNull();
  });
});
