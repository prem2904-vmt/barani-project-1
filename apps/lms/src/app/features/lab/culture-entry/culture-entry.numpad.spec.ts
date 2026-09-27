import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { CultureEntryComponent } from './culture-entry.component';
import { ApiService } from '../../../core/services/api.service';
import { PlatformService } from '../../../core/services/platform.service';
import { NumpadService } from '../../../shared/components/numpad/numpad.service';
import { AuthService } from '../../../core/auth/auth.service';

/**
 * Culture bench AST × the touch numpad: zone boxes (mm) get a digits-only
 * pad, Next walks the zones down the table (the same boxes Enter walks),
 * the model updates exactly as typing would; a read-only bench has no pad.
 */
function render(opts: { touch: boolean; readonly?: boolean }) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true, writable: true,
    value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  });
  TestBed.configureTestingModule({
    imports: [CultureEntryComponent],
    providers: [
      { provide: ApiService, useValue: { get: () => of([]), post: () => of({}) } },
      { provide: PlatformService, useValue: { isCapacitor: () => false, isNative: () => false } },
      { provide: AuthService, useValue: { user: () => ({ id: 'u1' }), hasPermission: () => false } },
    ],
  });
  TestBed.inject(NumpadService).touch.set(opts.touch);
  const f = TestBed.createComponent(CultureEntryComponent);
  const c = f.componentInstance as any;
  c.embedded = true;
  c.readonly = !!opts.readonly;
  c.value = { organisms: [{ name: 'Escherichia coli', antibiotics: [
    { name: 'Imipenem', zoneSize: null, interpretation: null },
    { name: 'Cefixime', zoneSize: null, interpretation: null },
  ] }] };
  document.body.appendChild(f.nativeElement);
  f.detectChanges();
  const appRef = TestBed.inject(ApplicationRef);
  const tick = () => { f.detectChanges(); appRef.tick(); };
  const el = f.nativeElement as HTMLElement;
  const zones = () => Array.from(el.querySelectorAll<HTMLInputElement>('input.ce-abx__zone'));
  const pad = () => document.body.querySelector('.pf-np') as HTMLElement | null;
  const press = (...keys: string[]) => {
    for (const k of keys) { (pad()!.querySelector(`[data-key="${k}"]`) as HTMLButtonElement).click(); tick(); }
  };
  const tap = (input: HTMLElement) => {
    input.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
    input.focus();
    tick();
  };
  return { f, c, el, zones, pad, press, tap, tick };
}

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  document.body.querySelectorAll('pf-numpad-panel, pf-culture-entry').forEach(n => n.remove());
});

describe('Culture AST — touch numpad on the zone boxes', () => {
  it('desktop: zone boxes stay numeric inputs', () => {
    const { zones } = render({ touch: false });
    expect(zones()[0].type).toBe('number');
    expect(zones()[0].getAttribute('inputmode')).toBe('numeric');
  });

  it('touch: digits-only pad, the zone model updates, Next moves to the next drug', () => {
    const { c, zones, pad, press, tap } = render({ touch: true });
    const [imp, cef] = zones();
    expect(imp.getAttribute('inputmode')).toBe('none');
    tap(imp);
    expect(pad()!.textContent).toContain('Imipenem zone');
    expect(pad()!.textContent).toContain('mm');
    // mm are whole numbers: no decimal / minus / < > keys on this pad.
    for (const k of ['.', '-', '<', '>']) expect(pad()!.querySelector(`[data-key="${k}"]`)).toBeNull();
    press('2', '4');
    expect(c.m().organisms[0].antibiotics[0].zoneSize).toBe(24);
    press('next');
    expect(document.activeElement).toBe(cef);
    expect(pad()).not.toBeNull();
    press('1', '5');
    expect(c.m().organisms[0].antibiotics[1].zoneSize).toBe(15);
  });

  it('read-only bench: no pad', () => {
    const { zones, pad, tap } = render({ touch: true, readonly: true });
    const z = zones()[0];
    if (!z) return;                      // read-only may not render the boxes at all
    expect(z.getAttribute('inputmode')).toBe('numeric');
    tap(z);
    expect(pad()).toBeNull();
  });
});
