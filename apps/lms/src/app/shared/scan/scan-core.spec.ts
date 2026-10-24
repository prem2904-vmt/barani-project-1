import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import {
  HardwareScanService, SCAN_BURST, SCAN_BURST_EVENT, ScanBurstDetector, ScanInputPrefService,
  normalizeTubeScan, resolveScanInputMode,
} from '@prefrontal/shared';
import { stubMemoryStorage, timedKeyboard } from './hardware-scan.spec-helpers';

describe('normalizeTubeScan — tube QR payload → Sample ID', () => {
  it('takes the part after the last "|" (the tube QR is MRN|SampleID)', () => {
    expect(normalizeTubeScan('MW-26-0012|HAEM260800001')).toBe('HAEM260800001');
    expect(normalizeTubeScan('  MRN1|2610001234 ')).toBe('2610001234');
    expect(normalizeTubeScan('A|B|PF-V1-2026-00012-HEM')).toBe('PF-V1-2026-00012-HEM');
  });

  it('leaves plain barcodes, URLs and non-tube payloads alone (trimmed only)', () => {
    expect(normalizeTubeScan(' HAEM260800001 ')).toBe('HAEM260800001');
    expect(normalizeTubeScan('https://lab.example/o/1234abcd-0000')).toBe('https://lab.example/o/1234abcd-0000');
    expect(normalizeTubeScan('https://x/track/tok|en')).toBe('https://x/track/tok|en');
    expect(normalizeTubeScan('{"hidn":"91-1|2"}')).toBe('{"hidn":"91-1|2"}');
    expect(normalizeTubeScan('<xml a="1|2"/>')).toBe('<xml a="1|2"/>');
    expect(normalizeTubeScan('Jane Doe|HAEM1')).toBe('Jane Doe|HAEM1');
    expect(normalizeTubeScan('MRN|')).toBe('MRN|');
    expect(normalizeTubeScan(null)).toBe('');
    expect(normalizeTubeScan(undefined)).toBe('');
  });
});

describe('ScanBurstDetector — scanner bursts vs people typing', () => {
  const feed = (d: ScanBurstDetector, text: string, gap: number, end: 'Enter' | 'Tab' | null = 'Enter', t0 = 1000) => {
    let t = t0;
    const steps = [];
    for (const ch of text) { t += gap; steps.push(d.feed({ key: ch, at: t })); }
    if (end) { t += gap; steps.push(d.feed({ key: end, at: t })); }
    return steps;
  };

  it('a fast burst (< 35 ms apart, ≥ 4 chars) ending in Enter is a scan', () => {
    const steps = feed(new ScanBurstDetector(), 'HAEM260800001', 5);
    expect(steps[0]).toEqual({ kind: 'start' });
    expect(steps.at(-1)).toEqual({ kind: 'scan', code: 'HAEM260800001', terminator: 'Enter' });
  });

  it('Tab ends a burst too', () => {
    expect(feed(new ScanBurstDetector(), '26100012', 3, 'Tab').at(-1)).toEqual({ kind: 'scan', code: '26100012', terminator: 'Tab' });
  });

  it('normal typing (≥ 35 ms apart) is never a scan', () => {
    expect(feed(new ScanBurstDetector(), 'HAEM260800001', 120).at(-1)).toEqual({ kind: 'none' });
    expect(feed(new ScanBurstDetector(), 'abcd', SCAN_BURST.maxGapMs).at(-1)).toEqual({ kind: 'none' });
  });

  it('fewer than 4 fast characters is not a scan', () => {
    expect(feed(new ScanBurstDetector(), 'abc', 2).at(-1)).toEqual({ kind: 'none' });
  });

  it('one slow gap restarts the burst; the fast tail alone must reach 4', () => {
    const d = new ScanBurstDetector();
    let t = 0;
    for (const ch of '12') { t += 5; d.feed({ key: ch, at: t }); }
    t += 200; expect(d.feed({ key: '3', at: t })).toEqual({ kind: 'start' });
    for (const ch of '456') { t += 5; d.feed({ key: ch, at: t }); }
    t += 5; expect(d.feed({ key: 'Enter', at: t })).toEqual({ kind: 'scan', code: '3456', terminator: 'Enter' });
  });

  it('a late Enter (a person pressing it after a fast burst) is not a scan', () => {
    expect(feed(new ScanBurstDetector(), 'abcd', 5, null).length).toBe(4);
    const d = new ScanBurstDetector();
    feed(d, 'abcd', 5, null, 0);
    expect(d.feed({ key: 'Enter', at: 20 + 500 })).toEqual({ kind: 'none' });
  });

  it('Shift is ignored (scanners press it for capitals); held keys, combos, arrows break the burst', () => {
    const d = new ScanBurstDetector();
    let t = 0;
    for (const k of ['Shift', 'H', 'Shift', 'A', 'E', 'M']) { t += 4; d.feed({ key: k, at: t }); }
    t += 4; expect(d.feed({ key: 'Enter', at: t })).toEqual({ kind: 'scan', code: 'HAEM', terminator: 'Enter' });

    const r = new ScanBurstDetector();
    t = 0;
    for (let i = 0; i < 6; i++) { t += 30; r.feed({ key: '1', at: t, repeat: i > 0 }); }
    t += 30; expect(r.feed({ key: 'Enter', at: t })).toEqual({ kind: 'none' });

    const c = new ScanBurstDetector();
    feed(c, 'abcd', 4, null, 0);
    c.feed({ key: 'v', at: 25, combo: true });
    expect(c.feed({ key: 'Enter', at: 28 })).toEqual({ kind: 'none' });

    const a = new ScanBurstDetector();
    feed(a, 'abcd', 4, null, 0);
    a.feed({ key: 'ArrowLeft', at: 22 });
    expect(a.feed({ key: 'Enter', at: 25 })).toEqual({ kind: 'none' });
  });
});

describe('ScanInputPrefService — per-device choice, remembered', () => {
  beforeEach(() => { stubMemoryStorage(); TestBed.resetTestingModule(); });
  afterEach(() => vi.unstubAllGlobals());

  it('nothing stored → the lab default (manual tenant → Type, else Camera)', () => {
    expect(resolveScanInputMode(null, false)).toBe('camera');
    expect(resolveScanInputMode(null, true)).toBe('type');
    expect(resolveScanInputMode('nonsense' as never, true)).toBe('type');
    expect(TestBed.inject(ScanInputPrefService).modeFor(true)).toBe('type');
  });

  it('a choice wins over the lab default and survives a reload', () => {
    TestBed.inject(ScanInputPrefService).set('scanner');
    expect(localStorage.getItem('pf.scanInput')).toBe('scanner');
    TestBed.resetTestingModule();
    const again = TestBed.inject(ScanInputPrefService);
    expect(again.stored()).toBe('scanner');
    expect(again.modeFor(false)).toBe('scanner');
    expect(again.modeFor(true)).toBe('scanner');
  });

  it('blocked storage never throws (falls back to the lab default)', () => {
    const blocked = () => { throw new Error('blocked'); };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked });
    const p = TestBed.inject(ScanInputPrefService);
    expect(p.modeFor(false)).toBe('camera');
    expect(() => p.set('type')).not.toThrow();
    expect(p.modeFor(false)).toBe('type');
  });
});

describe('HardwareScanService — one document-level capture', () => {
  let svc: HardwareScanService;
  let kb: ReturnType<typeof timedKeyboard>;
  let input: HTMLInputElement;

  beforeEach(() => {
    TestBed.resetTestingModule();
    svc = TestBed.inject(HardwareScanService);
    kb = timedKeyboard(svc);
    input = document.createElement('input');
    document.body.appendChild(input);
  });
  afterEach(() => { input.remove(); TestBed.resetTestingModule(); });

  it('a burst with nothing focused reaches the handler (iPad: no soft keyboard)', () => {
    const got = vi.fn();
    svc.register(got);
    const end = kb.scan('HAEM260800001');
    expect(got).toHaveBeenCalledWith('HAEM260800001', expect.objectContaining({ raw: 'HAEM260800001' }));
    expect(end!.defaultPrevented).toBe(true);
  });

  it('a tube QR burst arrives as the Sample ID; ctx.raw keeps the payload', () => {
    const got = vi.fn();
    svc.register(got);
    kb.scan('MW-26-1|HAEM260800001');
    expect(got).toHaveBeenCalledWith('HAEM260800001', expect.objectContaining({ raw: 'MW-26-1|HAEM260800001' }));
  });

  it('a burst into a focused field: the field gets its text back, its Enter handler never fires', () => {
    const enter = vi.fn();
    const seen: string[] = [];
    input.addEventListener('keydown', e => { if (e.key === 'Enter') enter(); });
    input.addEventListener('input', () => seen.push(input.value));
    const burst = vi.fn();
    input.addEventListener(SCAN_BURST_EVENT, burst);
    input.value = 'ab';
    const got = vi.fn();
    svc.register(got);
    kb.scan('26100012', input);
    expect(got).toHaveBeenCalledWith('26100012', expect.objectContaining({ target: input }));
    expect(input.value).toBe('ab');
    expect(seen.at(-1)).toBe('ab');
    expect(enter).not.toHaveBeenCalled();
    expect(burst).toHaveBeenCalledTimes(1);
  });

  it('people typing is never swallowed or changed: characters land, Enter reaches the field', () => {
    const enter = vi.fn();
    input.addEventListener('keydown', e => { if (e.key === 'Enter') enter(); });
    const got = vi.fn();
    svc.register(got);
    const end = kb.human('HAEM260800001', input);
    expect(input.value).toBe('HAEM260800001');
    expect(got).not.toHaveBeenCalled();
    expect(end!.defaultPrevented).toBe(false);
    expect(enter).toHaveBeenCalledTimes(1);
  });

  it('no handler registered → a burst behaves exactly as plain keys (nothing stopped or restored)', () => {
    const enter = vi.fn();
    input.addEventListener('keydown', e => { if (e.key === 'Enter') enter(); });
    const end = kb.scan('26100012', input);
    expect(input.value).toBe('26100012');
    expect(end!.defaultPrevented).toBe(false);
    expect(enter).toHaveBeenCalledTimes(1);
  });

  it('a Tab-terminated burst does not move focus (Tab is stopped)', () => {
    svc.register(() => {});
    expect(kb.scan('26100012', input, 'Tab')!.defaultPrevented).toBe(true);
  });

  it('newest handler wins (an open scanner window over its screen); unregister restores the screen', () => {
    const screen = vi.fn();
    const modal = vi.fn();
    svc.register(screen);
    const off = svc.register(modal);
    kb.scan('AAAA1');
    expect(modal).toHaveBeenCalledWith('AAAA1', expect.anything());
    expect(screen).not.toHaveBeenCalled();
    off();
    kb.wait(500);
    kb.scan('BBBB2');
    expect(screen).toHaveBeenCalledWith('BBBB2', expect.anything());
  });

  it('`when` lets a handler pass a scan down the stack', () => {
    const lower = vi.fn();
    const upper = vi.fn();
    svc.register(lower);
    svc.register(upper, { when: ctx => ctx.target === input });
    kb.scan('CCCC3');
    expect(upper).not.toHaveBeenCalled();
    expect(lower).toHaveBeenCalledTimes(1);
    kb.wait(500);
    kb.scan('DDDD4', input);
    expect(upper).toHaveBeenCalledWith('DDDD4', expect.anything());
  });

  it('a human typing then a scan into the same field restores the human text only', () => {
    svc.register(() => {});
    kb.human('LAB', input, null);
    kb.wait(400);
    kb.scan('26100012', input);
    expect(input.value).toBe('LAB');
  });
});

describe('One home for hardware-scanner capture (single source)', () => {
  const app = resolve(process.cwd(), 'apps/lms/src/app');
  const read = (rel: string) => readFileSync(resolve(app, rel), 'utf8');

  it('every scan screen routes through onHardwareScan (no private HID buffers)', () => {
    for (const rel of [
      'features/lab/sample-collection/sample-collection.component.ts',
      'features/lab/receive-samples/receive-samples.component.ts',
      'features/lab/my-work/my-work.component.ts',
      'features/billing-counter/billing-counter.component.ts',
      'features/stores/stores.component.ts',
    ]) {
      const src = read(rel);
      expect(src, rel).toContain('onHardwareScan(');
      expect(src, rel).not.toMatch(/hidBuffer|onDocKey/);
    }
  });

  it('tube-QR screens reduce MRN|SampleID through normalizeTubeScan', () => {
    for (const rel of [
      'features/lab/sample-collection/sample-collection.component.ts',
      'features/lab/receive-samples/receive-samples.component.ts',
      'features/lab/my-work/my-work.component.ts',
      'features/lab/result-entry/result-entry.component.ts',
      'features/lab/analyzer-results/analyzer-results.component.ts',
      'features/billing-counter/billing-counter.component.ts',
      'layout/shell/shell.component.ts',
    ]) expect(read(rel), rel).toContain('normalizeTubeScan(');
  });
});
