import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SamplePresetDirective } from './sample-preset.directive';
import { SampleSearchPresetService } from '../../core/services/sample-search-preset.service';

@Component({
  standalone: true,
  imports: [SamplePresetDirective],
  template: `<input [pfSamplePreset]="on" (input)="value = $any($event.target).value" (keydown.enter)="entered = entered + 1" />`,
})
class Host { on = true; value = ''; entered = 0; }

describe('pfSamplePreset — pre-typed sample-ID head', () => {
  let preset: string | null = '2609';
  function render(on = true) {
    TestBed.configureTestingModule({
      providers: [{ provide: SampleSearchPresetService, useValue: { ensure: () => {}, current: () => preset } }],
    });
    const f = TestBed.createComponent(Host);
    f.componentInstance.on = on;
    f.detectChanges();
    return { f, host: f.componentInstance, input: f.nativeElement.querySelector('input') as HTMLInputElement };
  }
  const key = (el: HTMLElement, k: string) => {
    const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev;
  };

  beforeEach(() => { preset = '2609'; });

  it('focus on an empty field types the preset, caret at the end', () => {
    const { host, input } = render();
    input.dispatchEvent(new Event('focus'));
    expect(input.value).toBe('2609');
    expect(host.value).toBe('2609');                 // the screen saw an input event
    expect(input.selectionStart).toBe(4);
    expect(input.selectionEnd).toBe(4);
  });

  it('never overwrites what is already typed', () => {
    const { input } = render();
    input.value = 'HEM26001';
    input.dispatchEvent(new Event('focus'));
    expect(input.value).toBe('HEM26001');
  });

  it('one Backspace clears the whole preset (and PF Keys sees it handled)', () => {
    const { host, input } = render();
    input.dispatchEvent(new Event('focus'));
    const ev = key(input, 'Backspace');
    expect(ev.defaultPrevented).toBe(true);
    expect(input.value).toBe('');
    expect(host.value).toBe('');
  });

  it('after the tail is typed, Backspace is ordinary', () => {
    const { input } = render();
    input.dispatchEvent(new Event('focus'));
    input.value = '26090012';
    const ev = key(input, 'Backspace');
    expect(ev.defaultPrevented).toBe(false);
  });

  it('a letter first replaces the preset (searching a name instead)', () => {
    const { input } = render();
    input.dispatchEvent(new Event('focus'));
    const ev = key(input, 'r');
    expect(ev.defaultPrevented).toBe(false);
    expect(input.value).toBe('');
  });

  it('Enter with only the preset does not submit a lookup', () => {
    const { host, input } = render();
    input.dispatchEvent(new Event('focus'));
    key(input, 'Enter');
    expect(host.entered).toBe(0);
    input.value = '26090007';
    key(input, 'Enter');
    expect(host.entered).toBe(1);
  });

  it('leaving with only the preset clears it again', () => {
    const { host, input } = render();
    input.dispatchEvent(new Event('focus'));
    input.dispatchEvent(new Event('blur'));
    expect(input.value).toBe('');
    expect(host.value).toBe('');
  });

  it('the preset is computed at focus time (rolls to the new month)', () => {
    const { input } = render();
    input.dispatchEvent(new Event('focus'));
    input.dispatchEvent(new Event('blur'));
    preset = '2610';
    input.dispatchEvent(new Event('focus'));
    expect(input.value).toBe('2610');
  });

  it('off (input false, or the lab turned it off) → nothing typed', () => {
    const { input } = render(false);
    input.dispatchEvent(new Event('focus'));
    expect(input.value).toBe('');
    TestBed.resetTestingModule();
    preset = null;
    const r = render(true);
    r.input.dispatchEvent(new Event('focus'));
    expect(r.input.value).toBe('');
  });
});
