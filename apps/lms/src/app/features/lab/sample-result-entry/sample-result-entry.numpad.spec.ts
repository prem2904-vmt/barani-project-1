import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { vi } from 'vitest';
import { SampleResultEntryComponent } from './sample-result-entry.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { PlatformService } from '../../../core/services/platform.service';
import { AuthService } from '../../../core/auth/auth.service';
import { DialogService } from '../../../core/services/dialog.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { DraftShelfService } from '../../../core/services/draft-shelf.service';
import { NumpadService } from '../../../shared/components/numpad/numpad.service';

/**
 * Sample result entry × the touch numpad: numeric results get the pad (keys
 * replay through allowOnlyNumbers), the live flag follows each key, Next
 * walks DOWN the tube's list (display order) skipping the calculated VLDL,
 * opens the Appearance dropdown in between, and the last field's Done lands on
 * Submit. Desktop keeps the plain decimal field.
 */
const num = (title: string, min: number, max: number, unit: string) => JSON.stringify({
  parameters: [{ name: 'result', title, type: 'numeric', unit, referenceRanges: [{ min, max }] }],
});
function test(id: string, code: string, name: string, parameters: string, extra: Record<string, unknown> = {}) {
  return {
    id, subOrderId: 'smp-1', testId: `t-${id}`, name, status: 'in_progress',
    test: { id: `t-${id}`, name, testCode: code, parameters, ...extra },
  };
}

function sampleFixture(): any {
  return {
    id: 'smp-1', orderId: 'o1', departmentId: 'd1', status: 'received', barcode: '26123', rejectionCount: 0,
    createdAt: '2026-09-25T03:00:00Z',
    department: { id: 'd1', name: 'Biochemistry', code: 'BIO' },
    order: {
      id: 'o1', patientId: 'p1', branchId: 'b1', priority: 'routine', source: 'walkin', status: 'open',
      collectionType: 'walkin', createdAt: '2026-09-25T03:00:00Z', samples: [],
      patient: { id: 'p1', displayName: 'Demo Patient', age: 40, sex: 'Male', mrn: 'AA0001' },
    },
    siblings: [],
    tests: [
      test('ot1', 'CHOL', 'Cholesterol', num('Cholesterol', 0, 200, 'mg/dL')),
      test('ot2', 'TG', 'Triglycerides', num('Triglycerides', 0, 150, 'mg/dL')),
      test('ot3', 'VLDL', 'VLDL Cholesterol', num('VLDL Cholesterol', 0, 30, 'mg/dL'),
        { calculation: JSON.stringify({ kind: 'expr', expr: 'TG/5', inputs: ['TG'] }) }),
      test('ot4', 'APP', 'Whole Serum Appearance', JSON.stringify({
        parameters: [{ name: 'result', title: 'Whole Serum Appearance', type: 'select', options: ['Clear', 'Turbid'] }],
      })),
      test('ot5', 'ZN', 'Zinc', num('Zinc', 60, 120, 'µg/dL')),
    ],
  };
}

async function render(opts: { touch: boolean; view?: boolean }) {
  const sample = sampleFixture();
  const api = {
    get: vi.fn((url: string) => {
      if (url.endsWith('/tests')) return of(sample);
      if (url.includes('lab-trends')) return of({ tests: [] });
      return of([]);
    }),
    post: vi.fn(() => of({})), patch: vi.fn(() => of({})), put: vi.fn(() => of({})),
  };
  const query = convertToParamMap(opts.view ? { view: '1' } : {});
  const route = {
    paramMap: new BehaviorSubject(convertToParamMap({ sampleId: 'smp-1' })),
    queryParamMap: new BehaviorSubject(query),
    snapshot: { paramMap: new Map([['sampleId', 'smp-1']]), queryParamMap: new Map(opts.view ? [['view', '1']] : []) },
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: HttpClient, useValue: {} },
      { provide: PlatformService, useValue: { getApiUrl: () => '', isCapacitor: () => false } },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn() } },
      { provide: AuthService, useValue: { user: () => ({ displayName: 'Admin User', registrationId: 'R1', tenantName: 'Demo Lab' }), hasPermission: () => true } },
      { provide: DialogService, useValue: { confirm: vi.fn(async () => false), prompt: vi.fn() } },
      { provide: DraftShelfService, useValue: { drop: vi.fn() } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Demo Lab' }), ensureLoaded() {} } },
      { provide: ActivatedRoute, useValue: route },
      { provide: Router, useValue: { url: '/lab/sample/smp-1', navigate: vi.fn(() => Promise.resolve(true)) } },
    ],
  });
  const svc = TestBed.inject(NumpadService);
  svc.touch.set(opts.touch);
  const f = TestBed.createComponent(SampleResultEntryComponent);
  document.body.appendChild(f.nativeElement);
  f.detectChanges();
  await f.whenStable();
  await new Promise(r => setTimeout(r, 0));
  f.detectChanges();
  const appRef = TestBed.inject(ApplicationRef);
  const el = f.nativeElement as HTMLElement;
  const tick = () => { f.detectChanges(); appRef.tick(); };
  const field = (id: string) => el.querySelector(`input[data-sre-field="${id}::result"]`) as HTMLInputElement;
  const pad = () => document.body.querySelector('.pf-np') as HTMLElement | null;
  const press = (...keys: string[]) => {
    for (const k of keys) { (pad()!.querySelector(`[data-key="${k}"]`) as HTMLButtonElement).click(); tick(); }
  };
  const tap = (input: HTMLElement) => {
    input.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
    input.focus();
    tick();
  };
  return { f, el, c: f.componentInstance as any, svc, tick, field, pad, press, tap };
}

// jsdom has no layout: the screen's own Enter / after-select code scrolls.
beforeAll(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  document.body.querySelectorAll('pf-numpad-panel, pf-sample-result-entry').forEach(n => n.remove());
});

describe('Sample result entry — touch numpad', () => {
  it('desktop: numeric results stay plain decimal fields (no pad)', async () => {
    const { field, pad } = await render({ touch: false });
    const chol = field('ot1');
    expect(chol.getAttribute('inputmode')).toBe('decimal');
    // A mouse click (desktop): nothing switches, no pad.
    chol.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', bubbles: true }));
    chol.focus();
    expect(chol.getAttribute('inputmode')).toBe('decimal');
    expect(pad()).toBeNull();
  });

  it('touch: the pad types through allowOnlyNumbers and the live flag follows the keys', async () => {
    const { c, field, pad, press, tap } = await render({ touch: true });
    const chol = field('ot1');
    expect(chol.getAttribute('inputmode')).toBe('none');
    tap(chol);
    expect(pad()!.textContent).toContain('Cholesterol');
    expect(pad()!.textContent).toContain('mg/dL');
    press('2', '4', '0');
    expect(c.getValue('ot1', 'result')).toBe('240');
    // Same verdict as the row chip: above 200 → High.
    expect(pad()!.querySelector('.pf-np__flag')!.textContent).toContain('High');
    // Today's validator refuses < and > in a numeric result — shown, dimmed.
    expect(pad()!.querySelector('[data-key="<"]')!.getAttribute('aria-disabled')).toBe('true');
    press('<');
    expect(c.getValue('ot1', 'result')).toBe('240');
  });

  it('Next goes down the list: skips the calculated VLDL, opens the dropdown, continues after the choice, Done → Submit', async () => {
    const { el, c, field, pad, press, tap, tick } = await render({ touch: true });
    expect(field('ot3').hasAttribute('data-numpad-skip')).toBe(true);

    tap(field('ot1'));
    press('1', '8', '0', 'next');
    expect(document.activeElement).toBe(field('ot2'));
    press('1', '0', '0', 'next');
    // VLDL (TG/5, calculated) is skipped → the Appearance dropdown opens.
    const trigger = el.querySelector('[data-sre-param="ot4::result"] .pf-dd__trigger') as HTMLElement;
    expect(document.activeElement).toBe(trigger);
    expect(c.getValue('ot3', 'result')).toBe('20');     // the formula filled it
    await new Promise(r => setTimeout(r));
    tick();
    expect(pad()).toBeNull();

    // The screen's own after-choice advance focuses Zinc → the pad returns.
    c.onSelectChange('ot4', 'result', 'Clear');
    tick();
    expect(document.activeElement).toBe(field('ot5'));
    expect(pad()).not.toBeNull();
    const next = pad()!.querySelector('[data-key="next"]')!;
    expect(next.textContent).toContain('Done');
    press('9', '0', 'next');
    expect(c.getValue('ot5', 'result')).toBe('90');
    expect((document.activeElement as HTMLElement).classList).toContain('pf-sre-submit');
  });

  it('read-only view: no pad on the (untouchable) fields', async () => {
    const { c, field, pad, tap } = await render({ touch: true, view: true });
    expect(c.viewOnly()).toBe(true);
    const chol = field('ot1');
    expect(chol.getAttribute('inputmode')).toBe('decimal');
    tap(chol);
    expect(pad()).toBeNull();
  });
});
