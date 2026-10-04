import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { SelectComponent } from './select.component';

/**
 * `enterAdvances` (owner fix, 2026-10-03): before the native-controls sweep,
 * result entry's dropdown/yes-no parameters were a native `<select>` — Enter
 * bubbled straight to the row's `advanceFrom()`. Converting them to pf-select
 * regressed that: pf-select's own keydown handler always intercepts Enter
 * while closed (to open the panel), so a filled, closed dropdown could never
 * advance — techs typing fast got stuck. `enterAdvances` is opt-in (default
 * off, every existing pf-select is unaffected) and only changes the ONE
 * case that was broken: closed + a real value already selected.
 */
describe('SelectComponent enterAdvances', () => {
  function make(opts: { enterAdvances: boolean; value?: string; open?: boolean }) {
    const fixture = TestBed.createComponent(SelectComponent<string>);
    const c = fixture.componentInstance;
    c.options = [{ value: 'Clear', label: 'Clear' }, { value: 'Turbid', label: 'Turbid' }];
    c.enterAdvances = opts.enterAdvances;
    if (opts.value !== undefined) c.value = opts.value as any;
    fixture.detectChanges(); // resolves the panel's ViewChild before openPanel() needs it
    c.isOpen.set(!!opts.open);
    return c;
  }

  function enterOn(target: HTMLElement = document.createElement('button')): KeyboardEvent {
    const ev = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    Object.defineProperty(ev, 'target', { value: target });
    return ev;
  }

  it('default (off): a closed, filled select still intercepts Enter and opens — every existing select is unchanged', () => {
    const c = make({ enterAdvances: false, value: 'Clear' });
    const ev = enterOn();
    c.onKey(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(c.isOpen()).toBe(true);
  });

  it('enterAdvances + closed + a real value selected: Enter is left alone (never preventDefault/stopPropagation) so it bubbles', () => {
    const c = make({ enterAdvances: true, value: 'Clear' });
    const ev = enterOn();
    const stopSpy = vi.spyOn(ev, 'stopPropagation');
    c.onKey(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(stopSpy).not.toHaveBeenCalled();
    expect(c.isOpen()).toBe(false); // never opened — the keystroke was left for the host
  });

  it('enterAdvances + closed + NO value yet: Enter still opens the panel (nothing to advance past)', () => {
    const c = make({ enterAdvances: true, value: '' });
    const ev = enterOn();
    c.onKey(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(c.isOpen()).toBe(true);
  });

  it('enterAdvances + OPEN: Enter still picks the focused option exactly as before', () => {
    const c = make({ enterAdvances: true, value: '', open: true });
    c.focusedIndex.set(0);
    const emitted: string[] = [];
    c.valueChange.subscribe((v) => emitted.push(v));
    const ev = enterOn();
    c.onKey(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(emitted).toEqual(['Clear']);
  });

  it('enterAdvances + closed + a value that matches NO option (stale/cleared): Enter opens, not bubbles', () => {
    const c = make({ enterAdvances: true, value: 'not-a-real-option' });
    const ev = enterOn();
    c.onKey(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(c.isOpen()).toBe(true);
  });

  it('enterAdvances does not change ArrowDown/ArrowUp/Space-opens-when-closed behaviour', () => {
    const c = make({ enterAdvances: true, value: 'Clear' });
    const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
    Object.defineProperty(ev, 'target', { value: document.createElement('button') });
    c.onKey(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(c.isOpen()).toBe(true);
  });
});
