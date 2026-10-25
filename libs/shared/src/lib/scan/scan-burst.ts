/**
 * Hardware barcode scanner (keyboard wedge) burst detection — pure, no DOM.
 *
 * A USB / Bluetooth scanner is a HID keyboard: it "types" the whole code in a
 * few milliseconds and finishes with Enter (some models: Tab). A person can't
 * type four or more characters with every gap under ~35 ms, so:
 *
 *   a SCAN = ≥ {@link SCAN_BURST.minLength} printable keys, each one less than
 *   {@link SCAN_BURST.maxGapMs} after the previous, then Enter / Tab within
 *   {@link SCAN_BURST.maxTerminatorGapMs}.
 *
 * The detector only OBSERVES keys — it never decides to block a character, so
 * normal typing is never swallowed or delayed. Only the terminator of a
 * completed burst is reported, and the caller decides what to do with it.
 *
 * Shift / CapsLock are ignored (scanners press Shift for capitals); a held key
 * (auto-repeat), any other non-printable key, a modifier combo or an IME
 * composition breaks the burst.
 */
export const SCAN_BURST = {
  /** Two scanner keystrokes are closer than this (ms). */
  maxGapMs: 35,
  /** Shortest code treated as a scan. */
  minLength: 4,
  /** Enter / Tab must follow the last character within this (ms). */
  maxTerminatorGapMs: 100,
} as const;

export interface ScanKey {
  key: string;
  /** Event time in ms (any monotonic clock). */
  at: number;
  repeat?: boolean;
  /** Ctrl / Alt / Meta held. */
  combo?: boolean;
  composing?: boolean;
}

/** `start`: this key may begin a burst (snapshot the field NOW, before the
 *  character lands). `scan`: a terminator completed a burst. */
export type ScanStep =
  | { kind: 'none' }
  | { kind: 'start' }
  | { kind: 'char' }
  | { kind: 'scan'; code: string; terminator: 'Enter' | 'Tab' };

const PASSIVE_KEYS = new Set(['Shift', 'CapsLock']);

export class ScanBurstDetector {
  private buf = '';
  private last = Number.NEGATIVE_INFINITY;

  constructor(private readonly opts: { maxGapMs: number; minLength: number; maxTerminatorGapMs: number } = SCAN_BURST) {}

  reset(): void {
    this.buf = '';
    this.last = Number.NEGATIVE_INFINITY;
  }

  /** The characters of the burst in progress (for a live preview). */
  get pending(): string { return this.buf; }

  feed(k: ScanKey): ScanStep {
    if (PASSIVE_KEYS.has(k.key)) return { kind: 'none' };
    if (k.combo || k.composing || k.repeat) { this.reset(); return { kind: 'none' }; }

    if (k.key === 'Enter' || k.key === 'Tab') {
      const ok = this.buf.length >= this.opts.minLength && k.at - this.last <= this.opts.maxTerminatorGapMs;
      const code = this.buf;
      this.reset();
      return ok ? { kind: 'scan', code, terminator: k.key } : { kind: 'none' };
    }

    if (k.key.length === 1) {
      if (this.buf === '' || k.at - this.last >= this.opts.maxGapMs) {
        this.buf = k.key;
        this.last = k.at;
        return { kind: 'start' };
      }
      this.buf += k.key;
      this.last = k.at;
      return { kind: 'char' };
    }

    // Arrows, Backspace, Escape, 'Unidentified' (soft keyboards) … — not a scan.
    this.reset();
    return { kind: 'none' };
  }
}
