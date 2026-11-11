import { provideRouter } from '@angular/router';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { HeroBandComponent } from './hero-band.component';
import { AuthService } from '../../../core/auth/auth.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { UploadsService } from '../../../core/services/uploads.service';
import { injectTenantBrand } from './tenant-brand';

/**
 * pf-hero-band — the ONE band every screen renders. Admin sub-pages
 * ("band pill everywhere") lean on two extensions: a tabs-only pill (no
 * search field, the section switch owns the pill) and a top-left back
 * chevron that replaces the page header's.
 */
@Component({
  standalone: true,
  imports: [HeroBandComponent],
  template: `
    <pf-hero-band [tabsOnly]="tabsOnly()" [back]="back()" [backTo]="backTo()"
                  placeholder="Search things" [value]="q()" (valueChange)="q.set($event)">
      <button band-actions type="button" class="act">Save</button>
      <div band-tools class="tools">tabs</div>
    </pf-hero-band>
  `,
})
class HostComponent {
  tabsOnly = signal(false);
  back = signal(false);
  backTo = signal<string | null>(null);
  q = signal('');
}

function make(showBack = true, user: Record<string, unknown> = { tenantName: 'Micro World' }) {
  const navBack = { showBack: signal(showBack), back: vi.fn(), backTo: vi.fn() };
  TestBed.configureTestingModule({
    imports: [HostComponent],
    providers: [
      { provide: AuthService, useValue: { user: () => user } },
      { provide: TenantStateService, useValue: { tenant: () => null } },
      { provide: NavBackService, useValue: navBack },
      provideRouter([]),
    ],
  });
  const f = TestBed.createComponent(HostComponent);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  return { f, el, host: f.componentInstance, navBack };
}

describe('pf-hero-band — admin band pill', () => {
  it('default: the pill has the search field; actions and tools are projected', () => {
    const { el } = make();
    expect(el.querySelector('.pf-hb__input')).not.toBeNull();
    expect(el.querySelector('.pf-hb__actions .act')?.textContent).toBe('Save');
    expect(el.querySelector('.pf-hb__tools .tools')).not.toBeNull();
    expect(el.querySelector('.pf-hb__search--tabs')).toBeNull();
  });

  it('typing in the pill search emits valueChange', () => {
    const { f, el, host } = make();
    const input = el.querySelector<HTMLInputElement>('.pf-hb__input')!;
    input.value = 'cbc';
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
    expect(host.q()).toBe('cbc');
  });

  it('tabsOnly: no search field, the tools (section tabs) own the pill', () => {
    const { f, el, host } = make();
    host.tabsOnly.set(true);
    f.detectChanges();
    expect(el.querySelector('.pf-hb__input')).toBeNull();
    expect(el.querySelector('.pf-hb__field')).toBeNull();
    expect(el.querySelector('.pf-hb__search--tabs')).not.toBeNull();
    expect(el.querySelector('.pf-hb__tools .tools')).not.toBeNull();
  });

  it('back chevron: hidden by default, shown when asked on a secondary route', () => {
    const { f, el, host } = make();
    expect(el.querySelector('.pf-hb__back')).toBeNull();
    host.back.set(true);
    f.detectChanges();
    expect(el.querySelector('.pf-hb__back')).not.toBeNull();
    expect(el.querySelector('.pf-hb__back svg path')).not.toBeNull();
  });

  it('back chevron never shows on an app root (NavBackService.showBack false)', () => {
    const { f, el, host } = make(false);
    host.back.set(true);
    f.detectChanges();
    expect(el.querySelector('.pf-hb__back')).toBeNull();
  });

  it('back chevron pops history, or goes to backTo when given', () => {
    const { f, el, host, navBack } = make();
    host.back.set(true);
    f.detectChanges();
    el.querySelector<HTMLButtonElement>('.pf-hb__back')!.click();
    expect(navBack.back).toHaveBeenCalledTimes(1);
    host.backTo.set('/lab/settings');
    f.detectChanges();
    el.querySelector<HTMLButtonElement>('.pf-hb__back')!.click();
    expect(navBack.backTo).toHaveBeenCalledWith('/lab/settings');
  });
});

/** Uploads are private: a tenant logo stored as "/uploads/…" 404s as a bare
 *  <img src>. The band shows it through the session (UploadsService blob:
 *  URL); data: logos from the branding wizard pass straight through. */
describe('pf-hero-band — the lab logo goes Home', () => {
  it('the logo + name are one link to "/" (the landing guard picks each person\'s home)', () => {
    const { el } = make(false);
    const a = el.querySelector<HTMLAnchorElement>('a.pf-hb__home')!;
    expect(a).not.toBeNull();
    expect(a.getAttribute('href')).toBe('/');
    expect(a.getAttribute('aria-label')).toBe('Home, Micro World');
    expect(a.querySelector('.pf-hb__avatar')?.textContent?.trim()).toBe('M');
    expect(a.querySelector('.pf-hb__name')?.textContent?.trim()).toBe('Micro World');
  });

  it('the back chevron stays outside the Home link', () => {
    const { el } = make(true);
    expect(el.querySelector('a.pf-hb__home .pf-hb__back')).toBeNull();
  });
});

describe('pf-hero-band — tenant logo', () => {
  function withLogo(logoUrl: string, src = vi.fn(() => 'blob:tenant-logo')) {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        { provide: AuthService, useValue: { user: () => ({ tenantName: 'Micro World' }) } },
        { provide: TenantStateService, useValue: { tenant: () => ({ name: 'Micro World', logoUrl, brandingMode: 'both' }) } },
        { provide: NavBackService, useValue: { showBack: signal(false), back: vi.fn(), backTo: vi.fn() } },
        { provide: UploadsService, useValue: { src } },
        provideRouter([]),
      ],
    });
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    return { el: f.nativeElement as HTMLElement, src };
  }

  it('a private "/uploads/…" logo renders from the session blob, never the bare path', () => {
    const { el, src } = withLogo('/uploads/0b8f5f4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b/logo.png');
    expect(src).toHaveBeenCalledWith('/uploads/0b8f5f4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b/logo.png');
    expect(el.querySelector<HTMLImageElement>('.pf-hb__logo')?.getAttribute('src')).toBe('blob:tenant-logo');
  });

  it('while the logo loads the initial disc shows (no broken image)', () => {
    const { el } = withLogo('/uploads/0b8f5f4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b/logo.png', vi.fn(() => ''));
    expect(el.querySelector('.pf-hb__logo')).toBeNull();
    expect(el.querySelector('.pf-hb__avatar')?.textContent?.trim()).toBe('M');
  });

  it('a data: logo (branding wizard) renders as is, without the uploads service', () => {
    const { el, src } = withLogo('data:image/png;base64,AA==');
    expect(src).not.toHaveBeenCalled();
    expect(el.querySelector<HTMLImageElement>('.pf-hb__logo')?.getAttribute('src')).toBe('data:image/png;base64,AA==');
  });
});

describe('pf-hero-band — personal case-sheet space', () => {
  it('shows the doctor, never the internal "Personal space …" name', () => {
    const { el } = make(true, { tenantName: 'Personal space cc2ee7f1', tenantKind: 'personal', displayName: 'Dr Meera Raghavan' });
    expect(el.querySelector('.pf-hb__name')?.textContent?.trim()).toBe('Dr Meera Raghavan');
    expect(el.textContent).not.toContain('Personal space');
  });

  it('falls back to "My case sheets" when there is no name', () => {
    const { el } = make(true, { tenantName: 'Personal space cc2ee7f1', tenantKind: 'personal' });
    expect(el.querySelector('.pf-hb__name')?.textContent?.trim()).toBe('My case sheets');
  });

  it('a lab keeps its own name', () => {
    const { el } = make(true, { tenantName: 'Micro World', tenantKind: 'lab', displayName: 'Dr X' });
    expect(el.querySelector('.pf-hb__name')?.textContent?.trim()).toBe('Micro World');
  });
});

/** A screen may wrap the lab's mark in its own button (the case sheet: tap = Departments, hold = a voice note): the band
 *  projects [band-brand] in place of its plain logo / disc, keeps the name, and the mark comes from the ONE resolution. */
@Component({
  standalone: true,
  imports: [HeroBandComponent],
  template: `
    <pf-hero-band [customBrand]="true">
      <button band-brand type="button" class="mine">{{ brand.initial() }}</button>
    </pf-hero-band>
  `,
})
class BrandHostComponent {
  readonly brand = injectTenantBrand();
}

describe('pf-hero-band — customBrand', () => {
  it('renders the projected brand instead of the logo / disc, with the same name and initial', () => {
    TestBed.configureTestingModule({
      imports: [BrandHostComponent],
      providers: [
        { provide: AuthService, useValue: { user: () => ({ tenantName: 'Sunrise Diagnostics' }) } },
        { provide: TenantStateService, useValue: { tenant: () => ({ name: 'Sunrise Diagnostics', logoUrl: null, brandingMode: 'both' }) } },
        { provide: NavBackService, useValue: { showBack: signal(false), back: vi.fn(), backTo: vi.fn() } },
      ],
    });
    const f = TestBed.createComponent(BrandHostComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('.pf-hb__tenant .mine')?.textContent?.trim()).toBe('S');
    expect(el.querySelector('.pf-hb__avatar')).toBeNull();
    expect(el.querySelector('.pf-hb__logo')).toBeNull();
    expect(el.querySelector('.pf-hb__name')?.textContent?.trim()).toBe('Sunrise Diagnostics');
  });

  it('the shared resolution gives the uploaded logo when branding shows it, nothing when the mode is name-only', () => {
    const at = (brandingMode: string) => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          { provide: AuthService, useValue: { user: () => ({ tenantName: 'Sunrise Diagnostics' }) } },
          { provide: TenantStateService, useValue: { tenant: () => ({ name: 'Sunrise Diagnostics', logoUrl: 'data:image/png;base64,AA==', brandingMode }) } },
        ],
      });
      return TestBed.runInInjectionContext(() => injectTenantBrand());
    };
    const both = at('both');
    expect(both.showLogo() && both.logo()).toBe('data:image/png;base64,AA==');
    const name = at('name');
    expect(name.showLogo()).toBe(false);
    expect(name.initial()).toBe('S');
  });
});
