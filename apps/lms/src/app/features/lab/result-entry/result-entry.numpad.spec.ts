import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ResultEntryComponent } from './result-entry.component';
import { ApiService } from '../../../core/services/api.service';
import { ScanService } from '../../../core/services/scan.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { AuthService } from '../../../core/auth/auth.service';
import { NumpadService } from '../../../shared/components/numpad/numpad.service';

/**
 * Per-test result entry × the touch numpad: numeric parameters (grid) get
 * the pad, keys replay through allowOnlyNumbers, the live flag follows,
 * Next walks the parameters down the list (the dropdown in between gets
 * focus), Done lands on Submit; the rail's second keypad steps aside on
 * touch. Desktop: untouched.
 */
const PARAMS = JSON.stringify({
  parameters: [
    { name: 'hb', title: 'Haemoglobin', type: 'numeric', unit: 'g/dL', referenceRanges: [{ min: 13, max: 17 }] },
    { name: 'appearance', title: 'Appearance', type: 'select', options: ['Clear', 'Turbid'] },
    { name: 'wbc', title: 'WBC', type: 'numeric', unit: '10^3/µL', referenceRanges: [{ min: 4, max: 11 }] },
  ],
});

async function render(opts: { touch: boolean }) {
  const ot = {
    id: 'ot1', subOrderId: 's1', testId: 't1', status: 'in_progress',
    subOrder: { barcode: '26123', order: { patient: { id: 'p1', displayName: 'Demo Patient', sex: 'M', age: 40 } } },
    test: { id: 't1', name: 'Blood Picture', parameters: PARAMS },
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
  TestBed.inject(NumpadService).touch.set(opts.touch);
  try { localStorage.setItem('pf-result-view', 'grid'); } catch { /* no storage */ }
  const f = TestBed.createComponent(ResultEntryComponent);
  document.body.appendChild(f.nativeElement);
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
  const appRef = TestBed.inject(ApplicationRef);
  const el = f.nativeElement as HTMLElement;
  const tick = () => { f.detectChanges(); appRef.tick(); };
  const field = (name: string) => el.querySelector(`input[data-param="${name}"]`) as HTMLInputElement;
  const pad = () => document.body.querySelector('.pf-np') as HTMLElement | null;
  const press = (...keys: string[]) => {
    for (const k of keys) { (pad()!.querySelector(`[data-key="${k}"]`) as HTMLButtonElement).click(); tick(); }
  };
  const tap = (input: HTMLElement) => {
    input.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
    input.focus();
    tick();
  };
  return { f, el, c: f.componentInstance as any, tick, field, pad, press, tap };
}

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  document.body.querySelectorAll('pf-numpad-panel, pf-result-entry').forEach(n => n.remove());
});

describe('Result entry — touch numpad', () => {
  it('desktop: the grid numeric field is unchanged (type=number, decimal keyboard, rail keypad kept)', async () => {
    const { el, field, pad, tap } = await render({ touch: false });
    const hb = field('hb');
    expect(hb.type).toBe('number');
    expect(hb.getAttribute('inputmode')).toBe('decimal');
    tap(hb);
    expect(pad()).toBeNull();
    expect(el.querySelector('.pf-rail__padhint')).toBeNull();
  });

  it('touch: keys go through allowOnlyNumbers; value + flag update live', async () => {
    const { c, field, pad, press, tap } = await render({ touch: true });
    const hb = field('hb');
    expect(hb.getAttribute('inputmode')).toBe('none');
    expect(hb.type).toBe('text');            // "1." survives while typing
    tap(hb);
    expect(pad()!.textContent).toContain('Haemoglobin');
    press('1', '.');
    expect(hb.value).toBe('1.');
    press('8');
    expect(c.valueOf('hb')).toBe('1.8');
    expect(pad()!.querySelector('.pf-np__flag')!.getAttribute('data-tone')).toBe('low');
    press('backspace', 'backspace', '9');
    expect(c.valueOf('hb')).toBe('19');
    expect(pad()!.querySelector('.pf-np__flag')!.getAttribute('data-tone')).toBe('high');
    press('<');                              // today's validator refuses it
    expect(c.valueOf('hb')).toBe('19');
  });

  it('Next: Haemoglobin → the Appearance dropdown → WBC (Done) → Submit', async () => {
    const { el, c, field, pad, press, tap, tick } = await render({ touch: true });
    tap(field('hb'));
    press('1', '5');
    expect(pad()!.querySelector('[data-key="next"]')!.textContent).toContain('Next');
    press('next');
    expect(document.activeElement).toBe(el.querySelector('[data-param="appearance"]'));
    await new Promise(r => setTimeout(r));
    tick();
    expect(pad()).toBeNull();
    c.setValue('appearance', 'Clear');
    tick();

    tap(field('wbc'));
    expect(pad()!.querySelector('[data-key="next"]')!.textContent).toContain('Done');
    press('7', 'next');
    expect(c.valueOf('wbc')).toBe('7');
    expect((document.activeElement as HTMLElement).classList).toContain('pf-head__btn--primary');
  });

  it('touch: the rail keypad steps aside for the field-side numpad', async () => {
    const { el } = await render({ touch: true });
    expect(el.querySelector('.pf-rail pf-num-pad')).toBeNull();
    expect(el.querySelector('.pf-rail__padhint')).not.toBeNull();
  });
});
