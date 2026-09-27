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

/** Owner 2026-09-27, "there is no default": a test that asks for its
 *  specimen starts EMPTY unless its Test–Specimen Mapping marks exactly one
 *  default, and the order cannot be saved or paid until one is chosen. */
const ASK = JSON.stringify({ askSpecimen: true });
const CATALOGUE = [
  { id: 'cs', name: 'Culture & Sensitivity', type: 'individual', price: 500, priceIsDefault: false, isActive: true,
    department: { name: 'Microbiology' }, parameters: JSON.stringify({ microFormat: 'culture_sensitivity' }) },
  { id: 'gram', name: 'Gram Stain', type: 'individual', price: 100, priceIsDefault: false, isActive: true,
    department: { name: 'Microbiology' }, parameters: ASK },
  { id: 'hb', name: 'Haemoglobin', type: 'individual', price: 10, priceIsDefault: false, isActive: true,
    department: { name: 'Haematology' } },
];
const SPECIMENS = [{ name: 'Urine' }, { name: 'Pus' }];
// cs: 14 mapped, all default → none; gram: one default → Urine.
const DEFAULTS: Record<string, string | null> = { cs: null, gram: 'Urine' };

function render() {
  (window as any).matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  const q: Array<[string, string]> = [];
  const get = vi.fn((url: string) => {
    if (url.startsWith('/api/tests/')) return of(CATALOGUE);
    if (url === '/api/microbiology/specimens') return of(SPECIMENS);
    if (url.startsWith('/api/microbiology/test-specimens')) {
      const ids = decodeURIComponent(url.split('testIds=')[1] ?? '').split(',');
      return of(ids.map(id => ({ testId: id, specimens: [], defaultSpecimen: DEFAULTS[id] ?? null, inherited: false })));
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
  return { f, c, post };
}

describe('Order desk — the specimen has no default unless the mapping names one', () => {
  it('a test whose mapping has no single default starts empty; one default is preselected', () => {
    const { f, c } = render();
    c._selected.set(['cs', 'gram', 'hb']);
    f.detectChanges(); TestBed.flushEffects(); f.detectChanges();
    expect(c.specimenOf('cs')).toBe('');
    expect(c.specimenOf('gram')).toBe('Urine');
    expect(c.missingSpecimenIds()).toEqual(['cs']);
  });

  it('saving is blocked with an inline error until the specimen is chosen', () => {
    const { f, c, post } = render();
    c._selected.set(['cs', 'hb']);
    f.detectChanges(); TestBed.flushEffects(); f.detectChanges();

    c.onProceedClick();
    f.detectChanges();
    expect(post).not.toHaveBeenCalledWith('/api/orders/', expect.anything());
    expect(c.specimenError('cs')).toBe(true);
    expect(f.nativeElement.querySelector('[data-spec-id="cs"] .pf-field-error')?.textContent)
      .toContain('Choose the specimen');

    c.setSpecimen('cs', 'Pus');
    expect(c.specimenError('cs')).toBe(false);
    c.onProceedClick();
    expect(post).toHaveBeenCalledWith('/api/orders/', expect.objectContaining({ specimens: { cs: 'Pus' } }));
  });

  it('continue-to-payment is blocked too; a test that does not ask never blocks', () => {
    const { f, c } = render();
    c._selected.set(['hb']);
    f.detectChanges(); TestBed.flushEffects();
    c.continueToPayment();
    expect(c.billPhase()).toBe('pay');

    c.billPhase.set('cart');
    c._selected.set(['hb', 'cs']);
    f.detectChanges(); TestBed.flushEffects();
    c.continueToPayment();
    expect(c.billPhase()).toBe('cart');
  });

  it('a pick the user cleared is not re-preselected', () => {
    const { f, c } = render();
    c._selected.set(['gram']);
    f.detectChanges(); TestBed.flushEffects();
    expect(c.specimenOf('gram')).toBe('Urine');
    c.setSpecimen('gram', '');
    f.detectChanges(); TestBed.flushEffects();
    expect(c.specimenOf('gram')).toBe('');
  });
});
