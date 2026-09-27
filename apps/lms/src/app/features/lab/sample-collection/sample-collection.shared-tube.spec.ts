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
 * Shared tubes (owner 2026-09-27): "the tube should be shared". LAB-2609-000131
 * shape: CBC (Haematology) and HbA1c (Biochemistry) come from ONE EDTA draw —
 * the collection screen shows ONE tube with all its tests, prints ONE label
 * naming both departments, and one tap collects every test on it.
 */
const haem = { id: 'd-h', name: 'Haematology', code: 'HEM' };
const bio = { id: 'd-b', name: 'Biochemistry', code: 'BIO' };
const order = {
  id: 'o1', orderNumber: 'LAB-2609-000131', createdAt: '2026-09-27T03:00:00Z',
  patient: { id: 'p1', displayName: 'Mr. Arun Kumar', age: 52, sex: 'Male', mrn: 'MW0131' },
};
const edta = {
  id: 'edta', orderId: 'o1', status: 'pending', barcode: '26209', tubeColor: 'edta', rejectionCount: 0,
  departmentId: 'd-h', department: haem, departments: [haem, bio], createdAt: '2026-09-27T03:00:00Z', order,
  tests: [
    { id: 't1', test: { name: 'Haemoglobin', departmentId: 'd-h' } },
    { id: 't2', test: { name: 'Total Leukocyte Count', departmentId: 'd-h' } },
    { id: 't3', test: { name: 'Glycated Hemoglobin', departmentId: 'd-b' } },
  ],
};
const sst = {
  id: 'sst', orderId: 'o1', status: 'pending', barcode: '26210', tubeColor: 'sst', rejectionCount: 0,
  departmentId: 'd-b', department: bio, departments: [bio], createdAt: '2026-09-27T03:00:00Z', order,
  tests: [{ id: 't4', test: { name: 'Total Cholesterol', departmentId: 'd-b' } }],
};

function render(opts: { standalone?: boolean } = {}) {
  const api = {
    get: vi.fn((url: string) => {
      if (url.includes('pending-collection')) return of([edta, sst]);
      if (url === '/api/orders/o1') return of({ ...order, samples: [edta, sst] });
      return of([]);
    }),
    post: vi.fn(() => of({})),
    patch: vi.fn((url: string) => of({ ...(url.includes('/edta/') ? edta : sst), status: 'collected', collectedAt: '2026-09-27T03:05:00Z' })),
  };
  const printer = { directPrintAvailable: () => true, printLabelData: vi.fn(async () => ({ ok: true })) };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: LiveQueueService, useValue: { on: () => of() } },
      { provide: AuthService, useValue: { hasPermission: () => true, user: () => ({ tenantName: 'Micro World' }) } },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: PrinterService, useValue: printer },
      { provide: PrintConfigService, useValue: { labelOpts: () => ({}) } },
      { provide: BranchLabConfigService, useValue: { standaloneLab: () => !!opts.standalone, ensureLoaded() {}, config: () => null } },
      { provide: DialogService, useValue: { confirm: vi.fn(async () => true) } },
      { provide: ProcessWorkflowService, useValue: { dispatchStepEnabled: () => true, isEnabled: () => true } },
      { provide: ScanService, useValue: { manualEntry: () => false } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: new Map() } } },
      { provide: Router, useValue: { navigate: vi.fn(), navigateByUrl: vi.fn() } },
      { provide: NavBackService, useValue: { showBack: () => false, back() {}, backTo() {} } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }) } },
      { provide: ThemeService, useValue: { isNewDesign: () => true, isDark: () => false } },
    ],
  });
  const f = TestBed.createComponent(SampleCollectionComponent);
  f.detectChanges();
  return { f, c: f.componentInstance as any, api, printer };
}

const tick = () => new Promise(r => setTimeout(r, 0));
const drawerOf = (f: any): HTMLElement =>
  (f.nativeElement.querySelector('.pf-drawer') ?? document.body.querySelector('.pf-drawer')) as HTMLElement;

async function open(f: any, c: any) {
  await tick();
  c._openOrderId.set('o1');
  f.detectChanges();
  await tick();
  f.detectChanges();
}

describe('Sample collection — shared tubes', () => {
  afterEach(() => document.body.querySelectorAll('.pf-drawer').forEach(n => n.remove()));

  it('shows ONE EDTA tube with its Sample ID and every test on it', async () => {
    const { f, c } = render();
    await open(f, c);
    const d = drawerOf(f);
    const tiles = [...d.querySelectorAll('.pf-tube.pf-sc-tile')];
    expect(tiles.length).toBe(2);
    const codes = tiles.map(t => t.querySelector('.pf-tube__code')?.textContent?.replace(/\s+/g, ' ').trim());
    expect(codes).toEqual(expect.arrayContaining(['Sample ID 26209', 'Sample ID 26210']));
    // The "Tests by tube" panel lists the CBC members AND HbA1c under the one EDTA.
    const edtaTests = c.tubeTests(edta).map((t: { name: string }) => t.name);
    expect(edtaTests).toEqual(['Haemoglobin', 'Total Leukocyte Count', 'Glycated Hemoglobin']);
    const panel = d.querySelector('[aria-label="Tests by tube"]')!.textContent!;
    expect(panel).toContain('Glycated Hemoglobin');
    expect(panel).toContain('Haemoglobin');
  });

  it('names every department on the shared tube (standalone labs show the department line)', async () => {
    const { f, c } = render({ standalone: true });
    await open(f, c);
    const depts = [...drawerOf(f).querySelectorAll('.pf-tube__dept')].map(n => n.textContent!.trim());
    expect(depts).toContain('Haematology · Biochemistry');
    expect(depts).toContain('Biochemistry');
  });

  it('one tap collects the shared tube — one call covers CBC and HbA1c', async () => {
    const { f, c, api } = render();
    await open(f, c);
    const tile = [...drawerOf(f).querySelectorAll<HTMLElement>('.pf-tube.pf-sc-tile')]
      .find(t => t.textContent!.includes('26209'))!;
    tile.click();
    await tick();
    const collects = api.patch.mock.calls.map(([u]) => String(u)).filter(u => u.endsWith('/collect'));
    expect(collects).toEqual(['/api/samples/edta/collect']);
  });

  it('prints ONE label per tube; the shared tube label carries both department codes', async () => {
    const { f, c, printer } = render();
    await open(f, c);
    c.printLabels(c.activeGroup());
    await tick(); await tick();
    const labels = printer.printLabelData.mock.calls.map(([d]: any[]) => d);
    expect(labels.map((l: any) => l.code)).toEqual(['26209', '26210']);
    expect(labels[0].deptCode).toBe('HEM/BIO');
    expect(labels[1].deptCode).toBe('BIO');
  });
});
