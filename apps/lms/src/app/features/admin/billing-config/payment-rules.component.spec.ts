import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ToastService } from '../../../core/services/toast.service';
import { PaymentRulesCardComponent } from './payment-rules.component';

describe('Payment rules (moved here from Lab settings)', () => {
  const make = (cfg: unknown, allowed = true) => {
    const api = { get: vi.fn(() => of(cfg)), patch: vi.fn(() => of({})) };
    const labCfg = { update: vi.fn() };
    TestBed.configureTestingModule({
      imports: [PaymentRulesCardComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
        { provide: BranchLabConfigService, useValue: labCfg },
        { provide: AuthService, useValue: { hasAnyPermission: () => allowed, hasPermission: () => allowed } },
      ],
    });
    const f = TestBed.createComponent(PaymentRulesCardComponent);
    f.detectChanges();
    return { f, api, labCfg, el: f.nativeElement as HTMLElement, cmp: f.componentInstance };
  };
  afterEach(() => TestBed.resetTestingModule());

  it('reads the branch config: gate stage and the Payments due switch', () => {
    const p = make({ paymentGateStage: 'report', showPaymentsDueTab: false });
    expect(p.api.get).toHaveBeenCalledWith('/api/tenants/branch-lab-config');
    expect(p.el.querySelector('[data-testid="pr-gate"] [aria-checked="true"] .pf-pr__t')!.textContent).toContain('Block at report');
    expect(p.el.querySelector('[data-testid="pr-due"] [role="switch"]')!.getAttribute('aria-checked')).toBe('false');
  });

  it('the old requireBillBeforeCollection flag still reads as "block at dispatch"', () => {
    const p = make({ requireBillBeforeCollection: true });
    expect(p.cmp.paymentGateStage()).toBe('dispatch');
  });

  it('choosing a gate PATCHes the same payload Lab settings sent', () => {
    const p = make({ paymentGateStage: 'none' });
    p.el.querySelectorAll<HTMLButtonElement>('[data-testid="pr-gate"] [role="radio"]')[1].click();
    expect(p.api.patch).toHaveBeenCalledWith('/api/tenants/branch-lab-config', { paymentGateStage: 'dispatch' });
  });

  it('a failed save puts the choice back', () => {
    const p = make({ paymentGateStage: 'none' });
    p.api.patch.mockReturnValueOnce({ subscribe: (o: any) => o.error({ error: { message: 'no' } }) } as any);
    p.cmp.setPaymentGateStage('report');
    expect(p.cmp.paymentGateStage()).toBe('none');
  });

  it('the Payments due switch PATCHes showPaymentsDueTab and refreshes the shared config', () => {
    const p = make({ showPaymentsDueTab: true });
    p.el.querySelector<HTMLButtonElement>('[data-testid="pr-due"] [role="switch"]')!.click();
    expect(p.api.patch).toHaveBeenCalledWith('/api/tenants/branch-lab-config', { showPaymentsDueTab: false });
    expect(p.labCfg.update).toHaveBeenCalled();
  });

  it('hidden for people without billing permission', () => {
    const p = make({}, false);
    expect(p.el.querySelector('[data-testid="pr-gate"]')).toBeNull();
    expect(p.el.querySelector('[data-testid="pr-denied"]')).not.toBeNull();
  });
});
