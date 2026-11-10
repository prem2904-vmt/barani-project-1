import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { CasesheetGateService } from '../shared/casesheet-gate.service';
import { IpdHubComponent } from './ipd-hub.component';

function render(opts: { gate: boolean; perms: string[] }) {
  const noop = (): void => undefined;
  (window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
  document.documentElement.classList.add('design-new');
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [IpdHubComponent],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { data: { moduleId: 'ipd' } } } },
      { provide: CasesheetGateService, useValue: { visible: signal(opts.gate) } },
      { provide: AuthService, useValue: { hasPermission: (c: string) => opts.perms.includes(c), user: signal(null) } },
    ],
  });
  const f = TestBed.createComponent(IpdHubComponent);
  f.detectChanges();
  return f.nativeElement as HTMLElement;
}

describe('/admin/ipd hub', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('gate open + casesheet_forms_manage: the MyPrefrontal tile links to the studio, beside the IPD coming-soon tile', () => {
    const el = render({ gate: true, perms: ['casesheet_forms_manage'] });
    const tile = el.querySelector('a[data-tile="MyPrefrontal"]') as HTMLAnchorElement;
    expect(tile).not.toBeNull();
    expect(tile.getAttribute('href')).toBe('/admin/ipd/myprefrontal');
    const soon = el.querySelector('[data-tile="IPD"]')!;
    expect(soon.tagName).not.toBe('A');
    expect(soon.textContent).toContain('Coming soon');
    expect(el.querySelector('pf-module-placeholder')).toBeNull();
  });

  it('gate closed: exactly the old module placeholder, no MyPrefrontal anywhere', () => {
    const el = render({ gate: false, perms: ['casesheet_forms_manage'] });
    expect(el.querySelector('pf-module-placeholder')).not.toBeNull();
    expect(el.querySelector('[data-tile]')).toBeNull();
    expect(el.textContent).not.toContain('MyPrefrontal');
  });

  it('gate open but no casesheet_forms_manage: still the placeholder, no tile', () => {
    const el = render({ gate: true, perms: [] });
    expect(el.querySelector('pf-module-placeholder')).not.toBeNull();
    expect(el.querySelector('[data-tile="MyPrefrontal"]')).toBeNull();
  });
});
