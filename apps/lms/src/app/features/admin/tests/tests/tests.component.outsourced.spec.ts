import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { TestsComponent } from './tests.component';
import { BusyDirective } from '../../../../shared/directives/busy.directive';
import { ApiService } from '../../../../core/services/api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { ThemeService } from '../../../../core/services/theme.service';
import { DialogService } from '../../../../core/services/dialog.service';
import { TestPricingService } from '../../../../core/services/test-pricing.service';
import { AuthService } from '../../../../core/auth/auth.service';

/**
 * OPS-112: Test Master grid - an "Outsourced to" column (partner NAME, from the
 * referral labs) and an "Outsourced only" filter, alongside the status filter.
 * A profile / package counts through its members (same rule as the order line).
 */
const items = (...ids: string[]) => JSON.stringify({ items: ids.map(testId => ({ testId })) });
const test = (over: any = {}) => ({
  id: 't1', name: 'Haemoglobin', type: 'individual', isActive: true, testCode: 'HEM012',
  price: 150, department: { id: 'd1', name: 'Haematology' }, ...over,
});
const TESTS = [
  test(),
  test({ id: 't2', name: 'Vitamin D', testCode: 'BIO020', outsourcedVendorId: 'v1' }),
  test({ id: 't3', name: 'Cortisol', testCode: 'BIO021', outsourcedVendorId: 'v2' }),
  test({ id: 'p1', name: 'Bone Panel', type: 'profile', testCode: 'PRO001', parameters: items('t2') }),
  test({ id: 'p2', name: 'Basic Panel', type: 'profile', testCode: 'PRO002', parameters: items('t1') }),
];
const LABS = [{ id: 'v1', name: 'Metro Labs', isActive: true }, { id: 'v2', name: 'Quest Partner', isActive: false }];

function render(type: 'individual' | 'profile' | 'package') {
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const api = {
    get: vi.fn((url: string) => of(url.startsWith('/api/tests') ? TESTS
      : url.startsWith('/api/referral-labs') ? LABS : [])),
    patch: vi.fn(() => of({})), post: vi.fn(() => of({})),
  };
  TestBed.configureTestingModule({
    imports: [TestsComponent],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: TestPricingService, useValue: { save: vi.fn(() => of({})), ensureLoaded: vi.fn(), isolationOn: () => false, priceFor: () => null } },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => true } },
      { provide: DialogService, useValue: { confirm: vi.fn(async () => false) } },
      { provide: AuthService, useValue: { user: () => ({ id: 'u1' }) } },
      { provide: Router, useValue: { navigate: vi.fn() } },
      { provide: ActivatedRoute, useValue: { queryParams: of({ type }) } },
    ],
  });
  TestBed.overrideComponent(TestsComponent, {
    set: { imports: [FormsModule, NgTemplateOutlet, BusyDirective], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
  });
  const f = TestBed.createComponent(TestsComponent);
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance as any, api };
}

const rootIds = (c: any) => c.rowData().filter((r: any) => (r._level ?? 0) === 0).map((r: any) => r.id);

describe('Test Master grid - outsourced column + filter (OPS-112)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('loads the referral labs and shows the partner NAME, empty for an in-house test', () => {
    const { c, api } = render('individual');
    expect(api.get).toHaveBeenCalledWith('/api/referral-labs?includeInactive=true');
    const rows = Object.fromEntries(TESTS.map(t => [t.id, c.partnerLabel(t)]));
    expect(rows['t1']).toBe('');
    expect(rows['t2']).toBe('Metro Labs');
    expect(rows['t3']).toBe('Quest Partner');           // a retired partner keeps its name
    expect(c.partnerLabel({ id: 'x', type: 'individual', outsourcedVendorId: 'gone' })).toBe('Partner lab');
    const col = c.colDefs().find((d: any) => d.colId === 'outsourced');
    expect(col.headerName).toBe('Outsourced to');
    expect(col.valueGetter({ data: TESTS[1] })).toBe('Metro Labs');
  });

  it('"Outsourced only" keeps just the partner-bound tests; All sources lists everything', () => {
    const { c } = render('individual');
    expect(rootIds(c).sort()).toEqual(['t1', 't2', 't3']);
    expect(c.outsourcingOptions().find((o: any) => o.value === 'outsourced').count).toBe(2);
    c.outsourcedOnly.set(true);
    expect(rootIds(c).sort()).toEqual(['t2', 't3']);
    c.outsourcedOnly.set(false);
    expect(rootIds(c).length).toBe(3);
  });

  it('a profile is outsourced through its members; the filter applies to the tree too', () => {
    const { c } = render('profile');
    expect(c.partnerLabel(TESTS[3])).toBe('Metro Labs');
    c.outsourcedOnly.set(true);
    expect(rootIds(c)).toEqual(['p1']);
    c.outsourcedOnly.set(false);
    expect(rootIds(c)).toEqual(['p1', 'p2']);
  });

  it('the filter and the column are real controls (segmented, no native select) in the header', () => {
    const { f, el } = render('individual');
    f.detectChanges();
    expect(el.querySelector('[data-outsourcing-filter]')).not.toBeNull();
    expect(el.querySelector('select')).toBeNull();
  });
});
