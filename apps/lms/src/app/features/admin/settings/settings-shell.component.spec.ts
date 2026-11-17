import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { vi } from 'vitest';
import { TwoPanelComponent } from '@prefrontal/shared';
import { SettingsShellComponent } from './settings-shell.component';
import { SettingsAccessService } from './settings-access.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { injectSettingsHosted } from '../../../shared/utils/settings-host';
import { SettingsItem } from './settings-map';

/** A stand-in page: reports whether the shell hosts it (SETTINGS_HOST). */
@Component({ standalone: true, template: '<span data-testid="page" [attr.data-hosted]="hosted">page</span>' })
class PageStub { readonly hosted = injectSettingsHosted(); }

function setup(opts: { compact?: boolean; hide?: string[] } = {}) {
  (window as any).matchMedia = (q: string) => ({
    matches: !!opts.compact && q.includes('max-width: 767px'),
    addEventListener() {}, removeEventListener() {},
  });
  try { localStorage.removeItem('pf.settings.rail'); } catch { /* */ }
  const hide = new Set(opts.hide ?? []);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'admin', component: PageStub },
        {
          path: '', component: SettingsShellComponent,
          children: [
            { path: 'admin/org/numbers', component: PageStub },
            { path: 'admin/reports', component: PageStub },
            { path: 'admin/tests', component: PageStub },
            { path: 'admin/lab/outsourcing', component: PageStub },
            { path: 'admin/referral-labs', component: PageStub },
            { path: 'admin/partner-prices', component: PageStub },
            { path: 'admin/branches', component: PageStub },
          ],
        },
      ]),
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

describe('Settings shell — inside a setting (wide)', () => {
  beforeEach(() => document.documentElement.classList.add('design-new'));

  it('the left panel carries THAT setting: its name under a back arrow, then its categories — no section headings', async () => {
    setup();
    const h = await open('/admin/org/numbers?tab=order');
    expect(root(h).querySelector('[data-testid="tp-nav-title"]')?.textContent).toContain('Patient and order numbers');
    expect(root(h).querySelector('[data-testid="tp-nav-back"]')).not.toBeNull();
    expect(cats(root(h))).toEqual(['patient', 'order']);
    expect(root(h).querySelector('.pf-tp__heading')).toBeNull();
    expect(root(h).querySelector('[data-testid="tp-item-order"]')?.getAttribute('aria-current')).toBe('true');
  });

  it('the screen fills the right side and knows it is hosted (hides its own tab strip)', async () => {
    setup();
    const h = await open('/admin/org/numbers?tab=patient');
    const page = root(h).querySelector('[data-testid="page"]')!;
    expect(page.getAttribute('data-hosted')).toBe('true');
    expect(root(h).querySelector('[data-testid="tp-panel"]')?.contains(page)).toBe(true);
  });

  it('a page without ?tab= gets its first category in the URL', async () => {
    setup();
    const h = await open('/admin/org/numbers');
    expect(TestBed.inject(Router).url).toContain('tab=patient');
  });

  it('a setting whose own path only forwards hops to its first category', async () => {
    setup();
    const h = await open('/admin/lab/outsourcing');
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/admin/referral-labs');
    expect(cats(root(h))).toEqual(['referral-labs', 'partner-prices']);
    expect(root(h).querySelector('[data-testid="tp-item-referral-labs"]')?.getAttribute('aria-current')).toBe('true');
  });

  it('picking a category opens its screen / tab; a category on another path navigates there', async () => {
    setup();
    const h = await open('/admin/reports?tab=letterhead');
    root(h).querySelector<HTMLButtonElement>('[data-testid="tp-item-footer"]')!.click();
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/admin/reports?tab=footer');
    TestBed.resetTestingModule(); setup();
    const h2 = await open('/admin/referral-labs');
    root(h2).querySelector<HTMLButtonElement>('[data-testid="tp-item-partner-prices"]')!.click();
    await settle(h2);
    expect(TestBed.inject(Router).url).toBe('/admin/partner-prices');
  });

  it('switching category clears the sibling categories\' query (Tests ▸ Prices drops ?type=)', async () => {
    setup();
    const h = await open('/admin/tests?type=profile');
    expect(root(h).querySelector('[data-testid="tp-item-profile"]')?.getAttribute('aria-current')).toBe('true');
    root(h).querySelector<HTMLButtonElement>('[data-testid="tp-item-option-groups"]')!.click();
    await settle(h);
    const url = TestBed.inject(Router).url;
    expect(url).toContain('view=option-groups');
    expect(url).not.toContain('type=');
  });

  it('the back arrow returns to the overview, on the section this setting belongs to', async () => {
    setup();
    const h = await open('/admin/referral-labs');
    root(h).querySelector<HTMLButtonElement>('[data-testid="tp-nav-back"]')!.click();
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/admin?section=lab');
  });

  it('categories this person cannot open are not listed', async () => {
    setup({ hide: ['lab-outsourcing/partner-prices'] });
    const h = await open('/admin/referral-labs');
    expect(cats(root(h))).toEqual(['referral-labs']);
  });

  it('the left panel slides in (260 ms, off under reduced motion) when a setting opens and when another is entered', async () => {
    setup();
    const h = await open('/admin/org/numbers?tab=patient');
    const scroll = () => root(h).querySelector('.pf-tp__scroll')!;
    expect(scroll().classList.contains('pf-tp__scroll--a') || scroll().classList.contains('pf-tp__scroll--b')).toBe(true);
    const first = scroll().classList.contains('pf-tp__scroll--a');
    await TestBed.inject(Router).navigateByUrl('/admin/reports?tab=letterhead');
    await settle(h);
    expect(scroll().classList.contains('pf-tp__scroll--a')).toBe(!first);
    const css = ((TwoPanelComponent as any).ɵcmp.styles as string[]).join('\n');
    expect(css).toContain('260ms');
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.pf-tp__scroll--a/);
  });

  it('the left panel shrinks to a thin rail and remembers it', async () => {
    setup();
    const h = await open('/admin/org/numbers?tab=patient');
    expect(root(h).querySelector('.pf-tp--rail')).toBeNull();
    root(h).querySelector<HTMLButtonElement>('[data-testid="tp-rail-toggle"]')!.click();
    h.detectChanges();
    expect(root(h).querySelector('.pf-tp--rail')).not.toBeNull();
    expect(localStorage.getItem('pf.settings.rail')).toBe('1');
    root(h).querySelector<HTMLButtonElement>('[data-testid="tp-rail-toggle"]')!.click();
    h.detectChanges();
    expect(root(h).querySelector('.pf-tp--rail')).toBeNull();
  });
});

describe('Settings shell — phone: categories list, then drill in', () => {
  beforeEach(() => document.documentElement.classList.add('design-new'));

  it('opening a setting from its tile shows the category list first, with the back arrow, no screen', async () => {
    setup({ compact: true });
    const h = await open('/admin/org/numbers');
    expect(root(h).querySelector('.pf-tp--compact')).not.toBeNull();
    expect(root(h).querySelector('.pf-tp--detail')).toBeNull();
    expect(cats(root(h))).toEqual(['patient', 'order']);
    expect(root(h).querySelector('[data-testid="tp-nav-back"]')).not.toBeNull();
    expect(TestBed.inject(Router).url).toBe('/admin/org/numbers'); // no hop on a phone
  });

  it('a tap drills into the screen with a back chevron; the chevron returns to the list', async () => {
    setup({ compact: true });
    const h = await open('/admin/org/numbers');
    root(h).querySelector<HTMLButtonElement>('[data-testid="tp-item-order"]')!.click();
    await settle(h);
    expect(root(h).querySelector('.pf-tp--detail')).not.toBeNull();
    expect(TestBed.inject(Router).url).toContain('tab=order');
    root(h).querySelector<HTMLButtonElement>('[data-testid="tp-back"]')!.click();
    h.detectChanges();
    expect(root(h).querySelector('.pf-tp--detail')).toBeNull();
  });

  it('swipe / hardware back (NavBackService) climbs one level: screen → categories', async () => {
    setup({ compact: true });
    const h = await open('/admin/org/numbers');
    root(h).querySelector<HTMLButtonElement>('[data-testid="tp-item-patient"]')!.click();
    await settle(h);
    const nb = TestBed.inject(NavBackService);
    nb.back();
    await settle(h);
    expect(root(h).querySelector('.pf-tp--detail')).toBeNull();
  });

  it('a deep link that names a category (a search hit) opens the screen directly', async () => {
    setup({ compact: true });
    const h = await open('/admin/org/numbers?tab=order');
    expect(root(h).querySelector('.pf-tp--detail')).not.toBeNull();
  });

  it('a setting with ONE category skips the list', async () => {
    setup({ compact: true });
    const h = await open('/admin/branches');
    expect(root(h).querySelector('.pf-tp--detail')).not.toBeNull();
  });

  it('from the category list, the back arrow leaves for the overview section', async () => {
    setup({ compact: true });
    const h = await open('/admin/org/numbers');
    root(h).querySelector<HTMLButtonElement>('[data-testid="tp-nav-back"]')!.click();
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/admin?section=numbers');
  });
});
