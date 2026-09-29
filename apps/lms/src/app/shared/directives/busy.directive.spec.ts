import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BusyDirective } from './busy.directive';
import { BUSY_MIN_SHOW_MS, BUSY_SHOW_AFTER_MS } from '../utils/busy';
import { TouchButtonComponent } from '../primitives/touch-button.component';

@Component({
  standalone: true,
  imports: [BusyDirective, TouchButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="nat" [pfBusy]="busy()" pfBusyLabel="Saving…" (click)="clicks = clicks + 1">Save</button>
    <pf-touch-btn [busy]="busy()" (pressed)="presses = presses + 1">Go</pf-touch-btn>
  `,
})
class HostComponent {
  readonly busy = signal(false);
  clicks = 0;
  presses = 0;
}

describe('[pfBusy] + pf-touch-btn[busy] (loading feedback)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const nat = el.querySelector('button.nat') as HTMLButtonElement;
    const touch = el.querySelector('pf-touch-btn button') as HTMLButtonElement;
    const set = (v: boolean) => { fixture.componentInstance.busy.set(v); fixture.detectChanges(); };
    return { fixture, el, nat, touch, set };
  }

  it('idle: no busy attributes, clicks go through', () => {
    const { fixture, nat } = setup();
    expect(nat.getAttribute('aria-busy')).toBeNull();
    expect(nat.classList.contains('pf-is-busy')).toBe(false);
    nat.click();
    expect(fixture.componentInstance.clicks).toBe(1);
  });

  it('INSTANT: aria-busy + class the same change detection the flag turns on', () => {
    const { nat, set } = setup();
    set(true);
    expect(nat.getAttribute('aria-busy')).toBe('true');
    expect(nat.getAttribute('aria-disabled')).toBe('true');
    expect(nat.classList.contains('pf-is-busy')).toBe(true);
  });

  it('swallows repeat presses while busy (no double submit)', () => {
    const { fixture, nat, set } = setup();
    set(true);
    nat.click();
    nat.click();
    expect(fixture.componentInstance.clicks).toBe(0);
    set(false);
    nat.click();
    expect(fixture.componentInstance.clicks).toBe(1);
  });

  it('dots appear only after the 150ms threshold, with the SR label', () => {
    const { fixture, nat, set } = setup();
    set(true);
    vi.advanceTimersByTime(BUSY_SHOW_AFTER_MS - 1);
    fixture.detectChanges();
    expect(nat.querySelector('pf-busy')).toBeNull();
    vi.advanceTimersByTime(1);
    fixture.detectChanges();
    const dots = nat.querySelector('pf-busy');
    expect(dots).not.toBeNull();
    expect(dots!.textContent).toContain('Saving…');
    expect(nat.classList.contains('pf-is-busy--shown')).toBe(true);
  });

  it('a fast request never shows dots', () => {
    const { fixture, nat, set } = setup();
    set(true);
    vi.advanceTimersByTime(80);
    set(false);
    vi.advanceTimersByTime(1000);
    fixture.detectChanges();
    expect(nat.querySelector('pf-busy')).toBeNull();
  });

  it('dots are held for the minimum, then removed', () => {
    const { fixture, nat, set } = setup();
    set(true);
    vi.advanceTimersByTime(BUSY_SHOW_AFTER_MS);
    fixture.detectChanges();
    set(false);
    expect(nat.querySelector('pf-busy')).not.toBeNull();
    vi.advanceTimersByTime(BUSY_MIN_SHOW_MS);
    fixture.detectChanges();
    expect(nat.querySelector('pf-busy')).toBeNull();
    expect(nat.getAttribute('aria-busy')).toBeNull();
  });

  it('pf-touch-btn[busy]: disabled + aria-busy at once, no press emitted, dots after the threshold', () => {
    const { fixture, touch, set } = setup();
    set(true);
    expect(touch.disabled).toBe(true);
    expect(touch.getAttribute('aria-busy')).toBe('true');
    touch.click();
    expect(fixture.componentInstance.presses).toBe(0);
    expect(touch.querySelector('pf-busy')).toBeNull();
    vi.advanceTimersByTime(BUSY_SHOW_AFTER_MS);
    fixture.detectChanges();
    expect(touch.querySelector('pf-busy')).not.toBeNull();
    set(false);
    vi.advanceTimersByTime(BUSY_MIN_SHOW_MS);
    fixture.detectChanges();
    expect(touch.disabled).toBe(false);
    touch.click();
    expect(fixture.componentInstance.presses).toBe(1);
  });
});
