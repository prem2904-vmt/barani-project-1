import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { OrderCreateComponent } from './order-create.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { FrontdeskSettingsService } from '../../../core/services/frontdesk-settings.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { AuthService } from '../../../core/auth/auth.service';

/** Rendered Order & Payments: the band carries no New Patient button and the
 *  pill no scan icon or Urgent chip; Urgent is a switch in the billing card
 *  beside Include Trendogram; the Patient tile shows as required. */
function render() {
  // lg+ desktop: the billing card is a persistent column.
  (window as any).matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  TestBed.configureTestingModule({
    imports: [OrderCreateComponent],
    providers: [
      { provide: ApiService, useValue: { get: vi.fn(() => of([])), post: vi.fn(() => of({})), patch: vi.fn(() => of({})) } },
      { provide: ToastService, useValue: { success() {}, error() {}, info() {}, warning() {} } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map(), queryParamMap: new Map([['patientId', 'x']]) } } },
      { provide: Router, useValue: { navigate: vi.fn(() => Promise.resolve(true)), navigateByUrl: vi.fn(() => Promise.resolve(true)) } },
      { provide: NavBackService, useValue: { showBack: () => true, back() {}, backTo() {} } },
      { provide: Location, useValue: {} },
      { provide: FrontdeskSettingsService, useValue: {} },
      { provide: BranchLabConfigService, useValue: { ensureLoaded() {}, billingMode: () => 'front_desk', collectsAtFrontdesk: () => false } },
      { provide: ProcessWorkflowService, useValue: { isEnabled: () => true } },
      { provide: TenantStateService, useValue: { tenant: signal(null) } },
      { provide: AuthService, useValue: { hasPermission: () => true, user: () => ({ tenantName: 'Micro World' }) } },
    ],
  });
  const f = TestBed.createComponent(OrderCreateComponent);
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance as any };
}

describe('Order & Payments — rendered band, pill and billing header', () => {
  it('has no New Patient button in the band and no scan icon in the pill', () => {
    const { el } = render();
    expect(el.querySelector('[aria-label="New patient"]')).toBeNull();
    expect(el.querySelector('[aria-label^="Scan"]')).toBeNull();
    expect(el.querySelector('.pf-us__urgent')).toBeNull();
    expect(el.querySelector('.pf-us__cart')).not.toBeNull();
  });

  it('Urgent is a switch next to Include Trendogram in the billing header', () => {
    const { el, f, c } = render();
    const switches = [...el.querySelectorAll('.pf-oc-bill__head [role="switch"]')].map(b => b.textContent?.trim());
    expect(switches).toEqual(['Urgent', 'Include Trendogram']);
    const urgent = el.querySelector('.pf-oc-bill__head [role="switch"]') as HTMLButtonElement;
    urgent.click();
    f.detectChanges();
    expect(c.priority()).toBe('Urgent');
    expect(urgent.getAttribute('aria-checked')).toBe('true');
    expect(el.querySelector('.pf-oc-urgent-tag')?.textContent).toContain('Urgent');
  });

  it('the Patient tile is marked required until a patient is picked', () => {
    const { el } = render();
    const tile = el.querySelectorAll('.pf-us__tile')[1];
    expect(tile.classList).toContain('pf-us__tile--req');
    expect(tile.textContent).toContain('(required)');
  });

  it('Confirm without a patient shows the inline hint under the band', async () => {
    vi.useFakeTimers();
    const { el, f } = render();
    (el.querySelector('.pf-oc-bill__foot .pf-oc-btn--primary') as HTMLButtonElement).click();
    vi.advanceTimersByTime(5);
    f.detectChanges();
    expect(el.querySelector('.pf-oc-need')?.textContent).toContain('Pick the patient');
    expect(el.querySelectorAll('.pf-us__tile')[1].classList).toContain('pf-us__tile--nudge');
    vi.useRealTimers();
  });
});
