import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SamplePresetDirective } from './sample-preset.directive';
import { SampleSearchPresetService } from '../../core/services/sample-search-preset.service';
import { HardwareScanService } from '@prefrontal/shared';

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

  describe('hardware scanner — the preset never corrupts a scanned all-digit ID', () => {
    /** Types like a keyboard: keydown, then (unless prevented) the char lands. */
    function typeAt(input: HTMLInputElement, text: string, gap: number, clock: { t: number }, end = true) {
      for (const ch of text) {
        clock.t += gap;
        const ev = key(input, ch);
        if (!ev.defaultPrevented) { input.value += ch; input.dispatchEvent(new Event('input', { bubbles: true })); }
      }
      if (end) { clock.t += gap; key(input, 'Enter'); }
    }
    let clock: { t: number };
    beforeEach(() => {
      clock = { t: 5000 };
      vi.spyOn(performance, 'now').mockImplementation(() => clock.t);
    });
    afterEach(() => vi.restoreAllMocks());

    it('a scanner burst routed as a scan: the field ends empty, the screen gets the bare code', () => {
      const { host, input } = render();
      const svc = TestBed.inject(HardwareScanService);
      svc.clock = () => clock.t;
      const got = vi.fn();
      svc.register(got);
      input.dispatchEvent(new Event('focus'));
      expect(input.value).toBe('2609');
      typeAt(input, '260900123', 4, clock);
      expect(got).toHaveBeenCalledWith('260900123', expect.anything());
      expect(input.value).toBe('');
      expect(host.value).toBe('');
      expect(host.entered).toBe(0);
    });

    it('scanner-fast keys with no scan handler: the preset is stripped, the field holds only the scan', () => {
      const { host, input } = render();
      input.dispatchEvent(new Event('focus'));
      typeAt(input, '260900123', 4, clock, false);
      expect(input.value).toBe('260900123');
      expect(host.value).toBe('260900123');
    });

    it('a person typing the tail keeps the preset (unchanged behaviour)', () => {
      const { input } = render();
      input.dispatchEvent(new Event('focus'));
      typeAt(input, '0012', 150, clock, false);
      expect(input.value).toBe('26090012');
    });
  });
});
