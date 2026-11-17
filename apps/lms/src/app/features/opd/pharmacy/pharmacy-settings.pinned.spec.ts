import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { DialogService } from '../../../core/services/dialog.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { PharmacyApi } from './pharmacy.api';
import { PharmacySettingsPage } from './pharmacy-settings.page';
import { PHARMACY_VIEW } from './pharmacy-view';

/** Settings → Pharmacy: `/admin/pharmacy` is the settings, `/admin/pharmacy/drugs` the drug master; the Settings
 *  left panel is the switch, so a pinned view has no in-page tabs. The old page (no route data) keeps both tabs. */
describe('Pharmacy settings in Settings (pinned views)', () => {
  const render = (data: Record<string, unknown>, query: Record<string, string> = {}) => {
    const api = {
      settings: vi.fn(() => of({ batchPick: 'earliest_expiry', walkInBillEditable: true, enforceSchedules: true })),
      saveSettings: vi.fn((s: unknown) => of(s)), drugMaster: vi.fn(() => of([])), suppliers: vi.fn(() => of([])),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PharmacySettingsPage],
      providers: [
        provideRouter([]),
        { provide: PharmacyApi, useValue: api },
        { provide: ApiService, useValue: { get: vi.fn(() => of([])) } },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
        { provide: DialogService, useValue: { confirm: vi.fn(async () => true), prompt: vi.fn(async () => null) } },
        { provide: AuthService, useValue: { user: () => ({ id: 'u1' }) } },
        { provide: TenantStateService, useValue: { tenant: signal({ name: 'Clinic' }) } },
        { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn() } },
        { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => true } },
        { provide: ActivatedRoute, useValue: { snapshot: { data, paramMap: convertToParamMap({}), queryParamMap: convertToParamMap(query) } } },
      ],
    });
    const f = TestBed.createComponent(PharmacySettingsPage);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance as any };
  };
  afterEach(() => TestBed.resetTestingModule());

  it('/admin/pharmacy shows the three real settings and no in-page tabs', () => {
    const { el, c } = render({ [PHARMACY_VIEW]: 'settings' });
    expect(c.tab()).toBe('settings');
    expect(el.querySelector('.pf-seg[role="tablist"]')).toBeNull();
    expect(el.textContent).toContain('Batch picking');
    expect(el.textContent).toContain('Walk-in bills can be edited until paid');
    expect(el.textContent).toContain('Enforce Schedule H / H1 / X');
    expect(el.textContent).toContain('Pharmacy settings');
  });

  it('/admin/pharmacy/drugs opens the drug master directly', () => {
    const { el, c } = render({ [PHARMACY_VIEW]: 'drugs' });
    expect(c.tab()).toBe('drugs');
    expect(el.querySelector('pf-pharmacy-drug-master')).not.toBeNull();
    expect(el.querySelector('.pf-seg[role="tablist"]')).toBeNull();
    expect(el.textContent).toContain('Drug master');
  });

  it('an unpinned page (the old /admin/opd/pharmacy shape) keeps its two tabs and ?tab=drugs', () => {
    const { el, c } = render({}, { tab: 'drugs' });
    expect(c.tab()).toBe('drugs');
    expect(el.querySelector('.pf-seg[role="tablist"]')).not.toBeNull();
  });
});
