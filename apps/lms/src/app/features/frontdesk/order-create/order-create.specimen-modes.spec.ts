import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { vi } from 'vitest';
import { OrderCreateComponent } from './order-create.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { AuthService } from '../../../core/auth/auth.service';

/**
 * Specimen modes at the order desk (owner 2026-09-29, the Test Master decides):
 *  - FIXED: no picker; the stamped specimen is shown and its price applies;
 *  - CHOOSE: the picker lists ONLY the test's allowed specimens (codes), a
 *    bundle what every choosing member allows; the chosen specimen's own
 *    price re-prices the line and the subtotal;
 *  - NONE: nothing.
 */
const T = (id: string, name: string, price: number, extra: any = {}) =>
  ({ id, name, type: 'individual', price, priceIsDefault: false, isActive: true, department: { name: 'Microbiology' }, ...extra });
const items = (...ids: string[]) => JSON.stringify({ items: ids.map(testId => ({ testId })) });
const CATALOGUE = [
  T('bc', 'Blood Culture & Sensitivity', 900, { parameters: JSON.stringify({ specimenMode: 'fixed', microFormat: 'culture_sensitivity' }) }),
  T('cs', 'Bacterial C&S', 100, { parameters: JSON.stringify({ specimenMode: 'choose', microFormat: 'culture_sensitivity' }) }),
  T('gram', 'Gram Stain', 50, { parameters: JSON.stringify({ specimenMode: 'choose' }) }),
  T('koh', 'KOH Mount', 60, { parameters: JSON.stringify({ specimenMode: 'none' }) }),
  T('panel', 'Micro panel', 300, { type: 'profile', parameters: items('cs', 'gram') }),
];
const MASTER = [{ code: 'SPEC013', name: 'Urine' }, { code: 'SPEC005', name: 'Sputum' }, { code: 'SPEC026', name: 'Blood' }, { code: 'SPEC001', name: 'Pus' }];
const MAPS: Record<string, any> = {
  bc: { mode: 'fixed', fixedSpecimen: 'SPEC026', basePrice: 900,
    specimens: [{ code: 'SPEC026', name: 'Blood', isDefault: true, container: 'blood_culture', price: 1200 }] },
  cs: { mode: 'choose', basePrice: 100,
    specimens: [{ code: 'SPEC013', name: 'Urine', isDefault: false }, { code: 'SPEC005', name: 'Sputum', isDefault: false, price: 250 }] },
  gram: { mode: 'choose', basePrice: 50,
    specimens: [{ code: 'SPEC005', name: 'Sputum', isDefault: false }, { code: 'SPEC001', name: 'Pus', isDefault: false }] },
};

function render() {
  (window as any).matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  const q: Array<[string, string]> = [];
  const get = vi.fn((url: string) => {
    if (url.startsWith('/api/tests/')) return of(CATALOGUE);
    if (url === '/api/microbiology/specimens') return of(MASTER);
    if (url.startsWith('/api/microbiology/test-specimens')) {
      const ids = decodeURIComponent(url.split('testIds=')[1] ?? '').split(',');
      return of(ids.map(id => ({ testId: id, inherited: false, defaultSpecimen: null, ...(MAPS[id] ?? { mode: 'choose', specimens: [] }) })));
    }
    return of([]);
  });
  const post = vi.fn(() => of({ id: 'o1' }));
  TestBed.configureTestingModule({
    imports: [OrderCreateComponent],
    providers: [
      { provide: ApiService, useValue: { get, post, patch: vi.fn(() => of({})), delete: vi.fn(() => of({})) } },
      { provide: ToastService, useValue: { success() {}, error: vi.fn(), info() {}, warning() {} } },
      { provide: ActivatedRoute, useValue: { queryParamMap: new BehaviorSubject(new Map(q)), snapshot: { paramMap: new Map(), queryParamMap: new Map(q) } } },
      { provide: Router, useValue: { navigate: vi.fn(() => Promise.resolve(true)), navigateByUrl: vi.fn(() => Promise.resolve(true)) } },
      { provide: NavBackService, useValue: { showBack: () => true, back() {}, backTo() {} } },
      { provide: Location, useValue: {} },
      { provide: BranchLabConfigService, useValue: { ensureLoaded() {}, billingMode: () => 'counter', collectsAtFrontdesk: () => false } },
      { provide: ProcessWorkflowService, useValue: { isEnabled: () => true } },
      { provide: TenantStateService, useValue: { tenant: signal(null) } },
      { provide: AuthService, useValue: { hasPermission: () => true, user: () => ({ tenantName: 'Micro World' }) } },
    ],
  });
  const f = TestBed.createComponent(OrderCreateComponent);
  f.detectChanges();
  const c = f.componentInstance as any;
  c._patient.set({ id: 'pA', displayName: 'Mr. Arun' });
  return { f, c, post, get, el: f.nativeElement as HTMLElement };
}

function settle(f: any) { f.detectChanges(); TestBed.flushEffects(); f.detectChanges(); TestBed.flushEffects(); f.detectChanges(); }

describe('Order desk — specimen modes', () => {
  it('a FIXED test shows its stamped specimen, no picker, and bills at that specimen\'s own price', () => {
    const { f, c, el, post } = render();
    c._selected.set(['bc']);
    settle(f);
    expect(c.fixedSpecimenName(CATALOGUE[0])).toBe('Blood');
    expect(el.querySelector('[data-spec-id="bc"]')).toBeNull();          // no picker
    expect(el.textContent).toContain('Specimen · Blood');
    expect(c.missingSpecimenIds()).toEqual([]);                            // never required
    expect(c.priceOf(CATALOGUE[0])).toBe(1200);
    expect(c.subtotal()).toBe(1200);
    c.onProceedClick();
    // Nothing chosen is sent for a fixed test — the server stamps it.
    expect(post).toHaveBeenCalledWith('/api/orders/', expect.objectContaining({ specimens: null }));
  });

  it('a CHOOSE test offers ONLY its allowed specimens (codes) and re-prices on a specimen with its own price', () => {
    const { f, c } = render();
    c._selected.set(['cs']);
    settle(f);
    expect(c.specimenOptsFor('cs').map((o: any) => o.value)).toEqual(['SPEC013', 'SPEC005']);   // not Blood, not Pus
    expect(c.specimenOptsFor('cs').find((o: any) => o.value === 'SPEC005').hint).toContain('250');
    expect(c.priceOf(CATALOGUE[1])).toBe(100);
    c.setSpecimen('cs', 'SPEC005');
    expect(c.priceOf(CATALOGUE[1])).toBe(250);
    expect(c.subtotal()).toBe(250);
    c.setSpecimen('cs', 'SPEC013');
    expect(c.priceOf(CATALOGUE[1])).toBe(100);
    expect(c.specimenLabel('cs')).toBe('Urine');
  });

  it('a bundle offers what EVERY choosing member allows; a NONE test shows nothing', () => {
    const { f, c, el } = render();
    c._selected.set(['panel', 'koh']);
    settle(f);
    expect(c.specimenOptsFor('panel').map((o: any) => o.value)).toEqual(['SPEC005']);   // cs ∩ gram = Sputum
    expect(c.asksSpecimen(CATALOGUE[3])).toBe(false);
    expect(el.querySelector('[data-spec-id="koh"]')).toBeNull();
    expect(c.priceOf(CATALOGUE[4])).toBe(300);                                          // one bundle price
    c.setSpecimen('panel', 'SPEC005');
    expect(c.priceOf(CATALOGUE[4])).toBe(300);
  });

  it('an existing order line keeps its stored CODE (name for older lines)', () => {
    const { f, c } = render();
    c._selected.set(['cs']);
    settle(f);
    c.hydrateSpecimensFrom({ samples: [{ tests: [{ testId: 'cs', specimen: 'Sputum', specimenCode: 'SPEC005' }, { testId: 'gram', specimen: 'Pus' }] }] });
    expect(c.specimenOf('cs')).toBe('SPEC005');
    expect(c.specimenOf('gram')).toBe('Pus');
    expect(c.specimenLabel('gram')).toBe('Pus');
  });
});
