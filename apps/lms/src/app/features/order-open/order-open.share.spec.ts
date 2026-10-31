import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { OrderOpenComponent } from './order-open.component';
import { PatientOpenComponent, patientProfilePath } from '../patient-open/patient-open.component';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { ProcessWorkflowService } from '../../core/services/process-workflow.service';

/** Share to Messages deep links: /o/:id opens the ORDER itself for a shared
 *  card (?view=detail) while the printed order QR keeps scan-to-collect;
 *  /p/:id lands on the profile route the user can actually open. */
const flush = () => new Promise(r => setTimeout(r, 0));

function setup(o: { perms: string[]; query?: Record<string, string>; id?: string; component: 'order' | 'patient' }) {
  const router = {
    navigate: vi.fn(async () => true), navigateByUrl: vi.fn(async () => true),
    createUrlTree: vi.fn((cmds: unknown[], extras: { queryParams?: unknown }) => ({ cmds, qp: extras?.queryParams })),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: Router, useValue: router },
      { provide: ActivatedRoute, useValue: { snapshot: {
        paramMap: convertToParamMap({ id: o.id ?? 'x1' }), queryParamMap: convertToParamMap(o.query ?? {}), queryParams: o.query ?? {},
      } } },
      { provide: ApiService, useValue: { get: vi.fn(() => of({ id: 'o1', patientId: 'p1' })) } },
      { provide: AuthService, useValue: { hasPermission: (p: string) => o.perms.includes(p), hasAnyPermission: (ps: string[]) => ps.some(p => o.perms.includes(p)) } },
      { provide: ProcessWorkflowService, useValue: { ensureLoaded: async () => undefined, isEnabled: () => true } },
    ],
  });
  if (o.component === 'order') TestBed.createComponent(OrderOpenComponent); else TestBed.createComponent(PatientOpenComponent);
  return { router };
}
afterEach(() => TestBed.resetTestingModule());

describe('deep links — /o/:id and /p/:id', () => {
  it('the printed order QR (bare /o/:id) still opens the collection drawer for a collector', async () => {
    const { router } = setup({ component: 'order', id: 'o1', perms: ['collect_sample'] });
    await flush(); await flush();
    expect(router.navigate).toHaveBeenCalledWith(['/lab/collect'], { queryParams: { orderId: 'o1', from: '/' } });
  });

  it('a shared order card (?view=detail) opens the ORDER itself — even for a collector', async () => {
    const { router } = setup({ component: 'order', id: 'o1', perms: ['collect_sample', 'register_patient'], query: { view: 'detail' } });
    await flush(); await flush();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(router.createUrlTree).toHaveBeenCalledWith(['/frontdesk/patients/p1'], { queryParams: { order: 'o1' } });
  });

  it('a lab tech / pathologist (view_patient only) lands on the read-only /patients/:id', async () => {
    const { router } = setup({ component: 'order', id: 'o1', perms: ['view_patient'], query: { view: 'detail' } });
    await flush(); await flush();
    expect(router.createUrlTree).toHaveBeenCalledWith(['/patients/p1'], { queryParams: { order: 'o1' } });
  });

  it('/p/:id picks the profile path by permission and keeps the query', () => {
    expect(patientProfilePath('p1', ps => ps.includes('create_order'))).toBe('/frontdesk/patients/p1');
    expect(patientProfilePath('p1', () => false)).toBe('/patients/p1');
    const { router } = setup({ component: 'patient', id: 'p1', perms: ['view_patient'], query: { order: 'o9' } });
    expect(router.createUrlTree).toHaveBeenCalledWith(['/patients/p1'], { queryParams: { order: 'o9' } });
  });
});
