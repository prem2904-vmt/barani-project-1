import { TestBed } from '@angular/core/testing';
import { HardwareScanService } from '@prefrontal/shared';

/**
 * Timed keyboard for hardware-scanner specs. Drives HardwareScanService's
 * clock, dispatches real keydown events (they pass the window capture
 * listener exactly like a scanner / a person), and plays the browser's
 * default action (insert the character into a focused input) unless the
 * keydown was prevented.
 */
export function timedKeyboard(svc: HardwareScanService = TestBed.inject(HardwareScanService)) {
  let t = 10_000;
  svc.clock = () => t;
  const isField = (el: Element): el is HTMLInputElement | HTMLTextAreaElement =>
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;

  /** Type `text` with `gapMs` between keys, then the terminator (null = none).
   *  Returns the terminator's keydown event (check `defaultPrevented`). */
  function type(text: string, gapMs: number, opts: { target?: Element; terminator?: 'Enter' | 'Tab' | null; terminatorGapMs?: number } = {}): KeyboardEvent | null {
    const target = opts.target ?? document.body;
    for (const ch of text) {
      t += gapMs;
      const ev = new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true });
      const ok = target.dispatchEvent(ev);
      if (ok && isField(target)) {
        target.value += ch;
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    if (opts.terminator === null) return null;
    t += opts.terminatorGapMs ?? gapMs;
    const end = new KeyboardEvent('keydown', { key: opts.terminator ?? 'Enter', bubbles: true, cancelable: true });
    target.dispatchEvent(end);
    return end;
  }

  /** A scanner: 4 ms between keys, then Enter. */
  const scan = (code: string, target?: Element, terminator: 'Enter' | 'Tab' = 'Enter') => type(code, 4, { target, terminator });
  /** A person: 120 ms between keys, then Enter. */
  const human = (text: string, target?: Element, terminator: 'Enter' | 'Tab' | null = 'Enter') => type(text, 120, { target, terminator });
  const wait = (ms: number) => { t += ms; };

  return { type, scan, human, wait };
}

/** In-memory localStorage (the runner's own may be missing). Call in beforeEach;
 *  `vi.unstubAllGlobals()` (or the next stub) replaces it. */
export function stubMemoryStorage(): Storage {
  const m = new Map<string, string>();
  const s = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; },
  } as Storage;
  vi.stubGlobal('localStorage', s);
  return s;
}
