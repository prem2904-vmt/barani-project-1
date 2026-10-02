import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';
import { BehaviorSubject, of } from 'rxjs';
import { vi } from 'vitest';
import { SampleResultEntryComponent } from './sample-result-entry.component';
import { SelectComponent } from '../../../shared/primitives/select.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { PlatformService } from '../../../core/services/platform.service';
import { AuthService } from '../../../core/auth/auth.service';
import { DialogService } from '../../../core/services/dialog.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { DraftShelfService } from '../../../core/services/draft-shelf.service';

/**
 * Owner fix, 2026-10-03: sample result entry's single-select dropdown now
 * opts into `enterAdvances` (never the multi-select — its panel stays open
 * across picks, so Enter should not advance away mid-pick), paired with a
 * new `(keydown.enter)="onEnterKey($event)"` on its wrapper (previously
 * absent — the select wasn't part of the Enter chain at all).
 */
const PARAMS = JSON.stringify({ parameters: [
  { name: 'appearance', title: 'Appearance', type: 'select', options: ['Clear', 'Turbid'] },
  { name: 'collected_on', title: 'Collected on', type: 'date' },
  { name: 'findings', title: 'Findings', type: 'multiselect', options: ['A', 'B'] },
] });

beforeAll(() => {
  // jsdom's scrollIntoView throws ("not a function") rather than being
  // simply absent — onEnterKey() calls it on every real advance.
  Element.prototype.scrollIntoView = () => {};
});

function sampleFixture(): any {
  return {
    id: 'smp-1', orderId: 'o1', departmentId: 'd1', status: 'received', barcode: '26123', rejectionCount: 0,
    createdAt: '2026-09-25T03:00:00Z',
    department: { id: 'd1', name: 'Biochemistry', code: 'BIO' },
    order: {
      id: 'o1', patientId: 'p1', branchId: 'b1', priority: 'routine', source: 'walkin', status: 'open',
      collectionType: 'walkin', createdAt: '2026-09-25T03:00:00Z', samples: [],
      patient: { id: 'p1', displayName: 'Test Patient', age: 29, sex: 'Male', mrn: 'AA0012' },
    },
    siblings: [],
    tests: [{ id: 'ot1', subOrderId: 'smp-1', testId: 't1', status: 'in_progress', test: { id: 't1', name: 'Urine Routine', parameters: PARAMS } }],
  };
}

async function render() {
  const sample = sampleFixture();
  const api = {
    get: vi.fn((url: string) => {
      if (url.endsWith('/tests')) return of(sample);
      if (url.includes('lab-trends')) return of({ tests: [] });
      return of([]);
    }),
    post: vi.fn(() => of({ sample, submitted: 1, results: [] })),
    patch: vi.fn(() => of({})),
    put: vi.fn(() => of({})),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: HttpClient, useValue: {} },
      { provide: PlatformService, useValue: { getApiUrl: () => '' } },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn() } },
      { provide: AuthService, useValue: { user: () => ({ displayName: 'Admin User', tenantName: 'Micro World' }), hasPermission: () => true } },
      { provide: DialogService, useValue: { confirm: vi.fn(async () => true), prompt: vi.fn() } },
      { provide: DraftShelfService, useValue: { drop: vi.fn() } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }), ensureLoaded() {} } },
      { provide: ActivatedRoute, useValue: { paramMap: new BehaviorSubject(convertToParamMap({ sampleId: 'smp-1' })), queryParamMap: new BehaviorSubject(convertToParamMap({})),
        snapshot: { paramMap: new Map([['sampleId', 'smp-1']]), queryParamMap: new Map() } } },
      { provide: Router, useValue: { url: '/lab/sample/smp-1', navigate: vi.fn(() => Promise.resolve(true)) } },
    ],
  });
  const f = TestBed.createComponent(SampleResultEntryComponent);
  document.body.appendChild(f.nativeElement);
  f.detectChanges();
  await f.whenStable();
  for (let i = 0; i < 3; i++) { await new Promise(r => setTimeout(r, 0)); f.detectChanges(); }
  return { f, el: f.nativeElement as HTMLElement };
}

describe('Sample result entry — select enterAdvances', () => {
  afterEach(() => { document.body.querySelectorAll('pf-sample-result-entry').forEach(n => n.remove()); });

  it('the single select opts in; the multi-select (panel stays open across picks) does not', async () => {
    const { f } = await render();
    const selects = f.debugElement.queryAll(By.directive(SelectComponent));
    expect(selects.length).toBeGreaterThan(0);
    for (const s of selects) {
      const c = s.componentInstance as SelectComponent<unknown>;
      expect(c.enterAdvances).toBe(!c.multiple);
    }
  });

  it('a real Enter on the closed, filled dropdown advances to the next field (date)', async () => {
    const { el } = await render();
    const trigger = el.querySelector<HTMLButtonElement>('[data-sre-param$="appearance"] .pf-dd__trigger')!;
    const key = (k: string) => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    trigger.focus();
    // Open, pick a real option (any index > 0, past the leading blank), close.
    key('Enter');
    key('ArrowDown');
    key('ArrowDown');
    key('Enter');
    expect(document.querySelector('.pf-dd__panel')).toBeNull();
    // Now closed + filled: Enter must advance, not reopen.
    key('Enter');
    expect(document.querySelector('.pf-dd__panel')).toBeNull();
    expect(document.activeElement?.closest('[data-sre-field$="collected_on"]')).not.toBeNull();
  });
});
