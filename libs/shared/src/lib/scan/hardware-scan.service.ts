import { DestroyRef, Injectable, inject } from '@angular/core';
import { ScanBurstDetector } from './scan-burst.js';
import { normalizeTubeScan } from './tube-scan.js';

/** Where a hardware scan landed. `raw` is the code exactly as the scanner
 *  typed it; `target` is the element that had focus when it started (the
 *  body when nothing was focused — iPad hides the soft keyboard while a
 *  Bluetooth scanner is connected, so often nothing is). */
export interface HardwareScanContext {
  raw: string;
  target: Element | null;
}

/** Gets the scanned code (a tube QR `MRN|SampleID` already reduced to the
 *  Sample ID by {@link normalizeTubeScan}). */
export type HardwareScanHandler = (code: string, ctx: HardwareScanContext) => void;

export interface HardwareScanOptions {
  /** Take this scan? (e.g. only when focus is inside an embedded pane, or the
   *  screen is in a scanning state). Default: always. */
  when?: (ctx: HardwareScanContext) => boolean;
}

interface Registration extends HardwareScanOptions {
  id: number;
  handler: HardwareScanHandler;
}

interface FieldSnapshot {
  el: HTMLInputElement | HTMLTextAreaElement;
  value: string;
  start: number | null;
  end: number | null;
}

/** Fired on the field a burst was typed into, after its text is put back. */
export const SCAN_BURST_EVENT = 'pf-scan-burst';

/**
 * ONE document-level capture for hardware barcode scanners, on every screen
 * that accepts a scan (web, Electron, iPad / Android tablet — a scanner is a
 * keyboard everywhere).
 *
 * A window keydown listener in the CAPTURE phase watches every key (it runs
 * before any field, directive or screen handler) and feeds a
 * {@link ScanBurstDetector}. Characters are never blocked or delayed, so
 * people type as before. When a burst completes, the newest registered
 * handler that wants it gets the code and:
 *  - the Enter / Tab is stopped (a highlighted dropdown row, a form submit or
 *    a focus move never reacts to the scanner's terminator);
 *  - the field the scanner typed into gets its previous text back (+ an
 *    `input` event so ngModel / signals follow), and a {@link SCAN_BURST_EVENT}
 *    so a pre-typed sample-ID preset can clear itself.
 * No handler (or none wants it) → nothing is touched; the keys behave exactly
 * as they always did.
 *
 * Handlers stack: an open scanner window registers on top of its screen, so
 * the window gets the scan while it is up.
 */
@Injectable({ providedIn: 'root' })
export class HardwareScanService {
  private readonly detector = new ScanBurstDetector();
  private regs: Registration[] = [];
  private nextId = 1;
  private snap: FieldSnapshot | null = null;
  private startTarget: Element | null = null;
  /** Clock in ms — swappable in specs. */
  clock: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  constructor() {
    if (typeof window === 'undefined') return;
    const onKey = (ev: KeyboardEvent) => this.onKeydown(ev);
    window.addEventListener('keydown', onKey, true);
    try { inject(DestroyRef).onDestroy(() => window.removeEventListener('keydown', onKey, true)); } catch { /* no DI context */ }
  }

  /** Register a scan handler; returns the unregister function. */
  register(handler: HardwareScanHandler, opts: HardwareScanOptions = {}): () => void {
    const id = this.nextId++;
    this.regs.push({ id, handler, when: opts.when });
    return () => { this.regs = this.regs.filter(r => r.id !== id); };
  }

  /** Number of live registrations (specs / diagnostics). */
  get handlerCount(): number { return this.regs.length; }

  private onKeydown(ev: KeyboardEvent): void {
    const step = this.detector.feed({
      key: ev.key ?? '',
      at: this.clock(),
      repeat: ev.repeat,
      combo: ev.ctrlKey || ev.altKey || ev.metaKey,
      composing: ev.isComposing,
    });
    if (step.kind === 'start') { this.capture(ev.target); return; }
    if (step.kind !== 'scan') return;

    const ctx: HardwareScanContext = { raw: step.code, target: this.startTarget ?? (ev.target as Element | null) };
    const reg = this.pick(ctx);
    const snap = this.snap;
    this.snap = null;
    this.startTarget = null;
    if (!reg) return;

    ev.preventDefault();
    ev.stopImmediatePropagation();
    if (snap) this.restore(snap, step.code);
    reg.handler(normalizeTubeScan(step.code), ctx);
  }

  private pick(ctx: HardwareScanContext): Registration | null {
    for (let i = this.regs.length - 1; i >= 0; i--) {
      const r = this.regs[i];
      try { if (!r.when || r.when(ctx)) return r; } catch { /* a broken predicate never eats a scan */ }
    }
    return null;
  }

  /** Remember the focused field's text BEFORE the burst's first character lands. */
  private capture(target: EventTarget | null): void {
    this.startTarget = target instanceof Element ? target : null;
    const el = target as HTMLInputElement | HTMLTextAreaElement | null;
    const tag = (el as Element | null)?.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') { this.snap = null; return; }
    let start: number | null = null;
    let end: number | null = null;
    try { start = el!.selectionStart; end = el!.selectionEnd; } catch { /* number inputs */ }
    this.snap = { el: el!, value: el!.value, start, end };
  }

  /** Put the field back as it was before the scanner typed into it. */
  private restore(s: FieldSnapshot, code: string): void {
    const el = s.el;
    if (el.value !== s.value) {
      el.value = s.value;
      try { if (s.start != null && s.end != null) el.setSelectionRange(s.start, s.end); } catch { /* no selection API */ }
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new CustomEvent(SCAN_BURST_EVENT, { detail: { code } }));
  }
}

/**
 * Route hardware scans on this screen to `handler` for as long as the calling
 * component lives. Call from an injection context (constructor / field init).
 */
export function onHardwareScan(handler: HardwareScanHandler, opts: HardwareScanOptions = {}): () => void {
  const off = inject(HardwareScanService).register(handler, opts);
  inject(DestroyRef).onDestroy(off);
  return off;
}
