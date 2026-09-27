import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { SampleCollectionComponent } from './sample-collection.component';
import { ApiService } from '../../../core/services/api.service';
import { LiveQueueService } from '../../../core/services/live-queue.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { PrinterService } from '../../../core/printer/printer.service';
import { PrintConfigService } from '../../../core/printer/print-config.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { ScanService } from '../../../core/services/scan.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ThemeService } from '../../../core/services/theme.service';

/**
 * Embedded in My Work's COLLECTION companion (collect in the Lab, no
 * dispatch/intake): find patient or scan → pending list → collect in place,
 * with the tube blood-fill still animating and every draw announced to the
 * host so its queue refreshes.
 */
const S = (id: string, status = 'pending') => ({
  id, orderId: 'o1', status, barcode: 'B-' + id, specimenType: 'Serum', tubeColor: 'red',
  tests: [{ test: { name: 'Glucose', sampleType: 'Serum' } }], createdAt: '2026-09-25T00:00:00Z',
  order: { orderNumber: 'LAB-2609-000085', patient: { id: 'p1', displayName: 'Ms. Paravai Munusamy Thirunavukkarasu', age: 44, sex: 'Female', mrn: 'AA0007' } },
});

function render(pending: any[]) {
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: { get: vi.fn((url: string) => of(url.includes('pending-collection') ? pending : [])), post: vi.fn(() => of({})), patch: vi.fn(() => of({ status: 'received' })) } },
      { provide: LiveQueueService, useValue: { on: () => of() } },
      { provide: AuthService, useValue: { hasPermission: () => true, user: () => ({ tenantName: 'Micro World' }) } },
      { provide: ToastService, useValue: { success() {}, error() {}, info() {}, warning() {} } },
      { provide: PrinterService, useValue: {} },
      { provide: PrintConfigService, useValue: {} },
      { provide: BranchLabConfigService, useValue: { standaloneLab: () => false, ensureLoaded() {}, config: () => null } },
      { provide: DialogService, useValue: {} },
      { provide: ProcessWorkflowService, useValue: { dispatchStepEnabled: () => false, isEnabled: () => true } },
      { provide: ScanService, useValue: { manualEntry: () => false } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: new Map() } } },
      { provide: Router, useValue: { navigate: vi.fn(), navigateByUrl: vi.fn() } },
      { provide: NavBackService, useValue: { showBack: () => false, back() {}, backTo() {} } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }) } },
      { provide: ThemeService, useValue: { isNewDesign: () => true, isDark: () => false } },
    ],
  });
  const f = TestBed.createComponent(SampleCollectionComponent);
  const c = f.componentInstance as any;
  c.embedded = true;
  f.detectChanges();
  return { f, c, el: f.nativeElement as HTMLElement };
}

describe('Sample collection — embedded in My Work (Collection companion)', () => {
  afterEach(() => document.body.querySelectorAll('.pf-drawer').forEach(n => n.remove()));

  it('renders the find-patient / scan field + camera and the pending list, no page chrome', async () => {
    const { f, el } = render([S('a'), S('b')]);
    await new Promise(r => setTimeout(r, 0));   // ngOnInit loads the queue
    f.detectChanges();
    expect(el.querySelector('section.pf-sc-embed')).not.toBeNull();
    expect(el.querySelector('section.pf-sc-page')).toBeNull();
    expect(el.querySelector('pf-hero-band')).toBeNull();
    expect(el.querySelector('pf-kpi-strip')).toBeNull();
    expect(el.querySelector('.pf-scan__input')).not.toBeNull();
    expect(el.querySelector('.pf-scan__label')!.textContent).toContain('Find patient or scan');
    expect(el.querySelector('.pf-scan__icon-btn')).not.toBeNull();   // camera rides in the field
    expect(el.querySelectorAll('.pf-sc__card').length).toBe(1);      // one patient
    // Full name, never truncated in the narrow card.
    expect(el.querySelector('.pf-sc__who-name')!.textContent!.trim()).toBe('Ms. Paravai Munusamy Thirunavukkarasu');
    expect(el.querySelector('.pf-sc__who-meta')!.textContent).toContain('AA0007');
  });

  it('embedded styles: one column, names wrap (no ellipsis), status is dot + word', () => {
    const css = ((SampleCollectionComponent as any).ɵcmp.styles as string[]).join('\n');
    expect(css).toMatch(/\.pf-sc-embed[^{]*\.pf-sc__list[^{]*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/\.pf-sc-embed[^{]*\.pf-sc__who-name[^{]*\{[^}]*white-space:\s*normal/);
    expect(css).toMatch(/\.pf-sc__wait[^{,]*::before/);
    expect(css).not.toMatch(/\.pf-sc-embed[^{]*\{[^}]*monospace/);
  });

  it('collects in place: the tube fills with blood and the host is told', async () => {
    const { f, c } = render([S('a')]);
    await new Promise(r => setTimeout(r, 0));
    const told = vi.fn();
    c.sampleCollected.subscribe(told);
    c._openOrderId.set('o1');
    f.detectChanges();
    await new Promise(r => setTimeout(r, 0));
    f.detectChanges();
    const drawer = (f.nativeElement.querySelector('.pf-drawer') ?? document.body.querySelector('.pf-drawer')) as HTMLElement;
    expect(drawer).not.toBeNull();
    const blood = () => drawer.querySelector('.pf-vial__blood') as SVGRectElement;
    const empty = blood().getAttribute('y');
    c.toggleCollected(c.activeGroup().samples[0]);
    f.detectChanges();
    expect(blood().getAttribute('y')).not.toBe(empty);   // the fill rises (CSS transition on y)
    expect(told).toHaveBeenCalled();                      // → My Work refreshes its queue
  });
});
