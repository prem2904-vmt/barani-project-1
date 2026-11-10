import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReadAloud, listenScript } from './read-aloud';

describe('PF Listen (read aloud on the device)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads each section title then its words, skipping empty ones', () => {
    expect(
      listenScript([
        { title: 'History', content: 'Blocked nose for 5 months.' },
        { title: 'Empty', content: '  ' },
        { title: '', content: 'Review in a week.' },
      ]),
    ).toEqual(['History. Blocked nose for 5 months.', 'Review in a week.']);
  });

  it('speaks part after part with the browser voice, and stop cancels', () => {
    const spoken: { text: string; onend?: () => void }[] = [];
    const synth = { speak: (u: { text: string; onend?: () => void }) => spoken.push(u), cancel: vi.fn() };
    vi.stubGlobal('speechSynthesis', synth);
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        lang = '';
        rate = 1;
        onend?: () => void;
        onerror?: () => void;
        constructor(public text: string) {}
      },
    );
    const r = TestBed.runInInjectionContext(() => new ReadAloud());
    expect(r.available()).toBe(true);
    r.read(['one', 'two']);
    expect(spoken.map((u) => u.text)).toEqual(['one']);
    expect(r.speaking()).toBe(0);
    spoken[0].onend?.();
    expect(spoken.map((u) => u.text)).toEqual(['one', 'two']);
    expect(r.speaking()).toBe(1);
    r.stop();
    expect(synth.cancel).toHaveBeenCalled();
    expect(r.speaking()).toBeNull();
  });
});
