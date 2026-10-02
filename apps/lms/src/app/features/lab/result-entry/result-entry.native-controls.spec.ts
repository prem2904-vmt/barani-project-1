import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ResultEntryComponent } from './result-entry.component';
import { SelectComponent } from '../../../shared/primitives/select.component';
import { ApiService } from '../../../core/services/api.service';
import { ScanService } from '../../../core/services/scan.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { AuthService } from '../../../core/auth/auth.service';

/**
 * Per-test result entry (both the GRID/table view and the phone CARD view):
 * dropdown/radio/yesno parameters used a native `<select>`; date/time/
 * datetime used native inputs. Both views now use `pf-select` / `pf-nd-date`
 * / `pf-nd-time` / `pf-nd-datetime` — same `setValue`/`valueOf` contract.
 */
const PARAMS = JSON.stringify({
  parameters: [
    { name: 'appearance', title: 'Appearance', type: 'select', options: ['Clear', 'Turbid'] },
    { name: 'collected_on', title: 'Collected on', type: 'date' },
  ],
});

async function render(view: 'grid' | 'cards') {
  try { localStorage.setItem('pf-result-view', view); } catch { /* no-op */ }
  const ot = {
    id: 'ot1', subOrderId: 's1', testId: 't1', status: 'in_progress',
    subOrder: { barcode: '26123', order: { patient: { id: 'p1', displayName: 'Demo Patient', sex: 'M', age: 40 } } },
    test: { id: 't1', name: 'Urine Routine', parameters: PARAMS },
  };
  const api = {
    get: vi.fn((url: string) => (url === '/api/results/ot1' ? of(ot) : of([]))),
    post: vi.fn(() => of({})), put: vi.fn(() => of({})), patch: vi.fn(() => of({})),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ScanService, useValue: { manualEntry: () => true } },
      { provide: DialogService, useValue: { confirm: vi.fn(async () => false), prompt: vi.fn() } },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn() } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Demo Lab' }), ensureLoaded() {} } },
      { provide: AuthService, useValue: { user: () => ({ displayName: 'Admin User' }), hasPermission: () => true } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'ot1' }), queryParamMap: convertToParamMap({}) }, paramMap: of(convertToParamMap({ id: 'ot1' })), queryParamMap: of(convertToParamMap({})) } },
      { provide: Router, useValue: { url: '/lab/result/ot1', navigate: vi.fn(() => Promise.resolve(true)), getCurrentNavigation: () => null } },
    ],
  });
  const f = TestBed.createComponent(ResultEntryComponent);
  document.body.appendChild(f.nativeElement);
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
  TestBed.inject(ApplicationRef).tick();
  return { f, c: f.componentInstance as any, el: f.nativeElement as HTMLElement };
}

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  document.body.querySelectorAll('pf-result-entry').forEach(n => n.remove());
});

describe.each([['grid' as const], ['cards' as const]])('Result entry %s view — no native select/date', (view) => {
  it('renders pf-select for the dropdown param, never a native select', async () => {
    const { el } = await render(view);
    expect(el.querySelector('select')).toBeNull();
    expect(el.querySelector('pf-select')).not.toBeNull();
  });

  it('renders pf-nd-date for the date param, never a visible native date input', async () => {
    const { el } = await render(view);
    expect(el.querySelector('input[type="date"]:not([aria-hidden="true"])')).toBeNull();
    expect(el.querySelector('pf-nd-date')).not.toBeNull();
  });

  it('typing a date sets it as plain ISO yyyy-MM-dd via setValue', async () => {
    const { el, c } = await render(view);
    const txt = el.querySelector<HTMLInputElement>('pf-nd-date input[type="text"]')!;
    txt.value = '26092026';
    txt.dispatchEvent(new Event('input'));
    expect(c.valueOf('collected_on')).toBe('2026-09-26');
  });

  it('the dropdown opts into enterAdvances (a filled, closed select lets Enter bubble to advanceFrom)', async () => {
    const { f } = await render(view);
    const selects = f.debugElement.queryAll(By.directive(SelectComponent));
    expect(selects.length).toBeGreaterThan(0);
    for (const s of selects) expect((s.componentInstance as SelectComponent<unknown>).enterAdvances).toBe(true);
  });

  it('the date box is the kit pf-nd-date scoped host class only — no leftover .pf-rg__input/.pf-param__input double box', async () => {
    const { el } = await render(view);
    const dateHost = el.querySelector('pf-nd-date')!;
    expect(dateHost.classList.contains('pf-rg__input')).toBe(false);
    expect(dateHost.classList.contains('pf-param__input')).toBe(false);
  });
});
