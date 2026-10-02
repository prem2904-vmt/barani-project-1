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

/**
 * Full Enter-advance chain, real DOM events (bubbling, same mechanism a
 * live browser uses) — guards the owner's reported regression: before the
 * native-controls sweep, result entry's dropdown/yes-no used a native
 * `<select>`, where Enter bubbled straight to `advanceFrom()`. Converting
 * them to pf-select regressed that (pf-select's own keydown handler always
 * intercepted Enter while closed). `enterAdvances` fixes exactly this:
 * numeric -> dropdown -> yes/no -> date -> time -> (wraps), including the
 * two previously-broken hops (select -> yes/no, yes/no -> next row).
 */
const PARAMS = JSON.stringify({
  parameters: [
    { name: 'hb', title: 'Haemoglobin', type: 'numeric', unit: 'g/dL' },
    { name: 'appearance', title: 'Appearance', type: 'select', options: ['Clear', 'Turbid'] },
    { name: 'nitrites', title: 'Nitrites present', type: 'yesno' },
    { name: 'collected_on', title: 'Collected on', type: 'date' },
    { name: 'collection_time', title: 'Collection time', type: 'time' },
  ],
});

async function render() {
  try { localStorage.setItem('pf-result-view', 'grid'); } catch { /* no-op */ }
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

/** A real, bubbling Enter keydown dispatched on the currently-focused
 *  element — the same mechanism a live browser uses (not a direct method
 *  call), so pf-select's own host listener and the row wrapper's
 *  `(keydown.enter)` both see it exactly as they would in the app. */
function pressEnter() {
  const el = document.activeElement as HTMLElement;
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

function onParam(name: string): boolean {
  return document.activeElement?.closest(`[data-param="${name}"]`) != null;
}

beforeAll(() => {
  // jsdom's scrollIntoView throws ("not a function") rather than being
  // simply absent in this environment — always stub it (focusParam() calls
  // it on every real advance).
  Element.prototype.scrollIntoView = () => {};
  // jsdom has no CSS.escape() global at all — focusParam() uses it to build
  // the `[data-param="…"]` selector. Every param name here is plain
  // alphanumeric/underscore, so an identity shim is enough.
  if (typeof (globalThis as any).CSS === 'undefined') (globalThis as any).CSS = {};
  if (typeof (globalThis as any).CSS.escape !== 'function') (globalThis as any).CSS.escape = (s: string) => s;
});
afterEach(() => {
  document.body.querySelectorAll('pf-result-entry').forEach(n => n.remove());
});

describe('Result entry grid — full Enter-advance chain (real DOM events)', () => {
  it('numeric -> dropdown -> yes/no -> date -> time, including the two previously-broken hops', async () => {
    const { f, el, c } = await render();

    const hb = el.querySelector<HTMLInputElement>('input.pf-rg__input--num[data-param="hb"]')!;
    hb.focus();
    hb.value = '14.5';
    hb.dispatchEvent(new Event('input'));
    pressEnter();
    expect(onParam('appearance')).toBe(true);

    // Dropdown: Enter opens (combobox model), Down+Enter picks, closing the
    // panel — dispatch every step on the SAME captured trigger reference
    // (never re-read document.activeElement mid-sequence; opening a panel
    // must not silently move DOM focus elsewhere).
    let trigger = document.activeElement as HTMLElement;
    const key = (k: string) => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    key('Enter');
    expect(document.querySelector('.pf-dd__panel')).not.toBeNull();
    key('ArrowDown');
    key('Enter'); // picks — the panel closes, but the trigger's displayed
    f.detectChanges(); // label comes from the PARENT's [value] binding, fed
    // back from setValue(); it needs one more render to show the pick.
    const picked = document.querySelector('[data-param="appearance"] .pf-dd__value')?.textContent?.trim();
    expect(picked).not.toBe('— Choose —');

    // THE REGRESSION: a further Enter on the closed, FILLED dropdown must
    // advance — never reopen the same panel.
    key('Enter');
    expect(document.querySelector('.pf-dd__panel')).toBeNull();
    expect(onParam('nitrites')).toBe(true);

    // Yes/No is also a grid pf-select — same open/pick/advance sequence.
    trigger = document.activeElement as HTMLElement;
    const key2 = (k: string) => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    key2('Enter');
    key2('ArrowDown');
    key2('Enter');
    f.detectChanges();
    key2('Enter'); // THE OTHER REGRESSION: yes/no -> next row.
    expect(onParam('collected_on')).toBe(true);
    expect(document.activeElement!.classList.contains('pf-ndd__in')).toBe(true);

    // Kit date/time: typing + Enter is a single keystroke (never swallowed).
    (document.activeElement as HTMLInputElement).value = '26092026';
    document.activeElement!.dispatchEvent(new Event('input'));
    pressEnter();
    expect(onParam('collection_time')).toBe(true);
    expect(document.activeElement!.classList.contains('pf-ndt__in')).toBe(true);

    expect(c.valueOf('hb')).toBe('14.5');
  });
});
