import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PaneSplitterComponent } from './pane-splitter.component';
import { clampSideWidth, keyedSideWidth, readSideWidth, splitterRange, writeSideWidth } from './pane-splitter';

/** Shared two-panel splitter (owner 2026-11-19; Frontdesk first). */
const KEY = 'pf-lms.test.side-w.u1';

describe('pane splitter — the width rules', () => {
  it('clamps to at least 300px and at most 45% of the row', () => {
    expect(splitterRange(1000)).toEqual({ min: 300, max: 450 });
    expect(clampSideWidth(120, 1000)).toBe(300);
    expect(clampSideWidth(380, 1000)).toBe(380);
    expect(clampSideWidth(900, 1000)).toBe(450);
    // A row too narrow for the minimum never yields max < min.
    expect(splitterRange(500)).toEqual({ min: 300, max: 300 });
    expect(clampSideWidth(Number.NaN, 1000)).toBe(300);
  });

  it('arrow keys move 16px (Shift ×4), End jumps to the widest; Home is the reset (not a width)', () => {
    expect(keyedSideWidth('ArrowRight', false, 340, 1200)).toBe(356);
    expect(keyedSideWidth('ArrowLeft', false, 340, 1200)).toBe(324);
    expect(keyedSideWidth('ArrowRight', true, 340, 1200)).toBe(404);
    expect(keyedSideWidth('ArrowLeft', true, 320, 1200)).toBe(300);
    expect(keyedSideWidth('End', false, 340, 1200)).toBe(540);
    expect(keyedSideWidth('Home', false, 340, 1200)).toBeNull();
    expect(keyedSideWidth('a', false, 340, 1200)).toBeNull();
  });

  it('persists in localStorage, wrapped in try/catch (blocked storage never throws)', () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    writeSideWidth(KEY, 412.4, store);
    expect(mem.get(KEY)).toBe('412');
    expect(readSideWidth(KEY, store)).toBe(412);
    writeSideWidth(KEY, null, store);
    expect(readSideWidth(KEY, store)).toBeNull();
    mem.set(KEY, 'junk');
    expect(readSideWidth(KEY, store)).toBeNull();
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('x'); } };
    expect(readSideWidth(KEY, broken)).toBeNull();
    expect(() => writeSideWidth(KEY, 400, broken)).not.toThrow();
  });
});

@Component({
  standalone: true,
  imports: [PaneSplitterComponent],
  template: `<div class="row" style="display:flex;width:1200px">
    <section class="side" style="flex:0 0 clamp(300px, var(--pf-side-w, 340px), 45%)"></section>
    <pf-pane-splitter storageKey="${KEY}" label="Resize panels" />
    <section class="main" style="flex:1 1 0"></section>
  </div>`,
})
class HostCmp {}

describe('pf-pane-splitter', () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
    TestBed.configureTestingModule({ imports: [HostCmp] });
  });

  const mount = () => {
    const f = TestBed.createComponent(HostCmp);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const row = el.querySelector('.row') as HTMLElement;
    const sep = el.querySelector('pf-pane-splitter') as HTMLElement;
    const side = el.querySelector('.side') as HTMLElement;
    // jsdom has no layout: give the row / side card real-looking boxes.
    row.getBoundingClientRect = () => ({ width: 1200, left: 0, right: 1200, top: 0, bottom: 600, height: 600, x: 0, y: 0, toJSON() { return {}; } }) as DOMRect;
    side.getBoundingClientRect = () => {
      const v = parseFloat(row.style.getPropertyValue('--pf-side-w')) || 340;
      return ({ width: v, left: 0, right: v, top: 0, bottom: 600, height: 600, x: 0, y: 0, toJSON() { return {}; } }) as DOMRect;
    };
    return { f, row, sep };
  };

  it('is a focusable vertical separator with aria-valuenow / min / max', () => {
    const { f, sep } = mount();
    const cmp = f.debugElement.children[0].children[1].componentInstance as PaneSplitterComponent;
    cmp.measure(); f.detectChanges();
    expect(sep.getAttribute('role')).toBe('separator');
    expect(sep.getAttribute('aria-orientation')).toBe('vertical');
    expect(sep.getAttribute('tabindex')).toBe('0');
    expect(sep.getAttribute('aria-label')).toBe('Resize panels');
    expect(sep.getAttribute('aria-valuenow')).toBe('340');
    expect(sep.getAttribute('aria-valuemin')).toBe('300');
    expect(sep.getAttribute('aria-valuemax')).toBe('540');
  });

  it('← / → move the divider and save the width per key; Home resets to the default --pf-side-w', () => {
    const { f, row, sep } = mount();
    sep.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    f.detectChanges();
    expect(row.style.getPropertyValue('--pf-side-w')).toBe('356px');
    expect(localStorage.getItem(KEY)).toBe('356');
    expect(sep.getAttribute('aria-valuenow')).toBe('356');
    sep.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }));
    expect(row.style.getPropertyValue('--pf-side-w')).toBe('300px');   // clamped at the minimum
    sep.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(row.style.getPropertyValue('--pf-side-w')).toBe('');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('a drag sets the width live, clamps it at 45% and saves it on release; double-click resets', () => {
    const { f, row, sep } = mount();
    const pe = (type: string, x: number) => {
      const e = new MouseEvent(type, { clientX: x, bubbles: true, button: 0 }) as MouseEvent & { pointerId: number };
      Object.defineProperty(e, 'pointerId', { value: 1 });
      return e;
    };
    sep.setPointerCapture = () => undefined;
    sep.hasPointerCapture = () => true;
    sep.releasePointerCapture = () => undefined;
    sep.dispatchEvent(pe('pointerdown', 340));
    sep.dispatchEvent(pe('pointermove', 400));
    expect(row.style.getPropertyValue('--pf-side-w')).toBe('400px');
    expect(localStorage.getItem(KEY)).toBeNull();                       // not saved mid-drag
    sep.dispatchEvent(pe('pointermove', 2000));
    expect(row.style.getPropertyValue('--pf-side-w')).toBe('540px');    // 45% of 1200
    sep.dispatchEvent(pe('pointerup', 2000));
    f.detectChanges();
    expect(localStorage.getItem(KEY)).toBe('540');
    sep.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(row.style.getPropertyValue('--pf-side-w')).toBe('');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('applies the saved width on init — before the first paint, no jump', () => {
    localStorage.setItem(KEY, '420');
    const { row } = mount();
    expect(row.style.getPropertyValue('--pf-side-w')).toBe('420px');
  });
});
