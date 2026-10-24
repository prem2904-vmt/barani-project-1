import { TestBed } from '@angular/core/testing';
import { BarcodeScannerModalComponent } from './barcode-scanner-modal.component';
import { HardwareScanService } from '@prefrontal/shared';
import { stubMemoryStorage, timedKeyboard } from '../../scan/hardware-scan.spec-helpers';

/** New-design scanner (owner): BILLING header, readable expected chip,
 *  corner reticle, calm status line, secondary/tertiary footer, phone sheet,
 *  no monospace / green. Behaviour (manual mode, mismatch guard, camera
 *  fallback) must survive the redesign. */

function stubMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true, writable: true,
    value: (q: string) => ({
      matches: false, media: q, onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
    }),
  });
}

let getUserMedia: ReturnType<typeof vi.fn>;

function stubCamera(fail: Error | null) {
  getUserMedia = vi.fn(() => (fail ? Promise.reject(fail) : new Promise(() => { /* never resolves */ })));
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true, writable: true,
    value: { getUserMedia, enumerateDevices: () => Promise.resolve([]) },
  });
}

async function make(opts: { manualOnly?: boolean; expected?: string; cameraFail?: Error | null; stored?: string } = {}) {
  stubMatchMedia();
  stubCamera(opts.cameraFail ?? null);
  const storage = stubMemoryStorage();
  if (opts.stored) storage.setItem('pf.scanInput', opts.stored);
  TestBed.configureTestingModule({ imports: [BarcodeScannerModalComponent] });
  const f = TestBed.createComponent(BarcodeScannerModalComponent);
  f.componentInstance.title = 'Scan vial to claim';
  f.componentInstance.expectedBarcode = opts.expected;
  f.componentInstance.manualOnly = !!opts.manualOnly;
  f.detectChanges();
  await f.whenStable();
  await new Promise(r => setTimeout(r, 0));
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance as any };
}

afterEach(() => { document.body.classList.remove('pf-scanner-open'); vi.unstubAllGlobals(); });

describe('Barcode scanner — new-design shell', () => {
  it('renders the BILLING header: icon chip, SCAN SAMPLE label, calm title, close button', async () => {
    const { el } = await make({ expected: '26123' });
    expect(el.querySelector('.pf-sc__head .pf-card__icon svg')).toBeTruthy();
    expect(el.querySelector('.pf-sc__label')?.textContent?.trim()).toBe('Scan sample');
    expect(el.querySelector('.pf-sc__title')?.textContent?.trim()).toBe('Scan vial to claim');
    expect(el.querySelector('.pf-sc__close')?.getAttribute('aria-label')).toBe('Close');
  });

  it('shows the expected ID as a readable chip', async () => {
    const { el } = await make({ expected: '26123' });
    const chip = el.querySelector('.pf-sc__expect');
    expect(chip?.querySelector('.pf-sc__expect-label')?.textContent?.trim()).toBe('Expected');
    expect(chip?.querySelector('.pf-sc__expect-id')?.textContent?.trim()).toBe('26123');
  });

  it('uses no monospace, no green and no pink dashed frame', () => {
    const css = ((BarcodeScannerModalComponent as any).ɵcmp.styles as string[]).join('\n');
    expect(css).not.toMatch(/font-family:[^;]*mono/i);
    expect(css).not.toMatch(/JetBrains/);
    expect(css).not.toMatch(/#34d399|#10b981|rgba\(52,\s*211,\s*153/i);
    expect(css).not.toMatch(/dashed/);
  });

  it('is the kit phone sheet (pf-sheet) with a handle', async () => {
    const { el } = await make({ expected: '26123' });
    const card = el.querySelector('.pf-sc__card');
    expect(card?.classList.contains('pf-sheet')).toBe(true);
    expect(card?.querySelector('.pf-sheet__handle')).toBeTruthy();
  });

  it('footer is a tertiary "Cancel", never a primary (the Camera · Scanner · Type switch replaced "Enter manually")', async () => {
    const { el } = await make({ expected: '26123' });
    const foot = el.querySelector('.pf-sc__foot')!;
    expect(foot.querySelector('.pf-sc__manual-toggle')).toBeNull();
    expect(foot.querySelector('.pf-sc__cancel')?.classList.contains('pf-btn--tertiary')).toBe(true);
    expect(foot.querySelector('.pf-btn--primary')).toBeNull();
    // No HID placeholder dash before any read arrives.
    expect(el.querySelector('.pf-sc__hid')).toBeNull();
  });
});

describe('Barcode scanner — behaviour survives the redesign', () => {
  it('manual mode skips the camera and lands on the kit input with a single primary Confirm', async () => {
    const { el } = await make({ manualOnly: true, expected: 'LAB26001' });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(el.querySelector('.pf-sc__label')?.textContent?.trim()).toBe('Enter sample');
    expect(el.querySelector('.pf-sc__free-input')).toBeTruthy();
    expect(el.querySelectorAll('.pf-btn--primary').length).toBe(1);
    // The lab default is Type: the switch shows it selected.
    expect(el.querySelector('.pf-sc__mode[aria-checked="true"]')?.getAttribute('data-mode')).toBe('type');
  });

  it('camera unavailable → neutral fallback panel with a secondary "Type the number"', async () => {
    const { el } = await make({ expected: '26123', cameraFail: new Error('Permission denied') });
    const fb = el.querySelector('.pf-sc__fallback')!;
    expect(fb.textContent).toContain('Camera permission denied');
    const btn = fb.querySelector('button.pf-btn--secondary');
    expect(btn?.textContent?.trim()).toBe('Type the number');
  });

  it('a wrong vial shows the red inline mismatch and does not emit', async () => {
    const { f, el, c } = await make({ expected: '26123' });
    const emitted = vi.fn();
    c.matched.subscribe(emitted);
    c.handleScan('26124');
    f.detectChanges();
    const alert = el.querySelector('.pf-sc__mismatch[role="alert"]');
    expect(alert?.textContent).toContain('26124');
    expect(alert?.textContent).toContain("isn't the expected sample");
    expect(alert?.textContent).toContain('26123');
    expect(emitted).not.toHaveBeenCalled();
  });

  it('a handheld read shows as a neutral chip', async () => {
    const { f, el, c } = await make({ expected: '26123' });
    for (const k of '2612') c.onKey(new KeyboardEvent('keydown', { key: k }));
    f.detectChanges();
    expect(el.querySelector('.pf-sc__hid .pf-sc__chip')?.textContent?.trim()).toBe('2612');
  });

  it('a manual match emits straight away (no camera, no hold)', async () => {
    const { c } = await make({ manualOnly: true, expected: 'LAB26001' });
    const emitted = vi.fn();
    c.matched.subscribe(emitted);
    c.manualFree.set('lab26001');
    c.submitManualFree();
    expect(emitted).toHaveBeenCalledWith('LAB26001');
  });

  it('a camera match pops the check, then emits once after the hold', async () => {
    const { f, el, c } = await make({ expected: '26123' });
    vi.useFakeTimers();
    try {
      c.cameraReady.set(true);
      const emitted = vi.fn();
      c.matched.subscribe(emitted);
      c.handleScan('26123');
      c.handleScan('26123'); // repeat frame is ignored
      f.detectChanges();
      expect(el.querySelector('.pf-sc__ok')).toBeTruthy();
      expect(emitted).not.toHaveBeenCalled();
      vi.advanceTimersByTime(BarcodeScannerModalComponent.MATCH_HOLD_MS);
      expect(emitted).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Barcode scanner — Camera · Scanner · Type switch (per device, remembered)', () => {
  const modes = (el: HTMLElement) => Array.from(el.querySelectorAll('.pf-sc__modes .pf-seg__item')).map(b => b.textContent?.trim());
  const selected = (el: HTMLElement) => el.querySelector('.pf-sc__mode[aria-checked="true"]')?.getAttribute('data-mode');

  it('shows the ND segmented switch; default Camera for a scan lab', async () => {
    const { el } = await make({ expected: '26123' });
    expect(el.querySelector('.pf-sc__modes')?.classList.contains('pf-seg')).toBe(true);
    expect(el.querySelector('.pf-sc__modes')?.getAttribute('role')).toBe('radiogroup');
    expect(modes(el)).toEqual(['Camera', 'Scanner', 'Type']);
    expect(selected(el)).toBe('camera');
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    // Icons are stroked SVG, never emoji.
    expect(el.querySelectorAll('.pf-sc__modes svg').length).toBe(3);
  });

  it('Scanner: no camera, a "Ready — scan now" panel; the choice is remembered', async () => {
    const { f, el, c } = await make({ expected: '26123' });
    getUserMedia.mockClear();
    (el.querySelector('.pf-sc__mode[data-mode="scanner"]') as HTMLButtonElement).click();
    await f.whenStable(); f.detectChanges();
    expect(selected(el)).toBe('scanner');
    expect(el.querySelector('.pf-sc__ready')?.textContent).toContain('Ready — scan now');
    expect((el.querySelector('.pf-sc__viewport') as HTMLElement).hidden).toBe(true);
    expect(localStorage.getItem('pf.scanInput')).toBe('scanner');
    expect(c.stream).toBeNull();

    // Next time (any screen), it opens straight on Scanner — no camera at all.
    TestBed.resetTestingModule();
    stubMatchMedia(); stubCamera(null);
    TestBed.configureTestingModule({ imports: [BarcodeScannerModalComponent] });
    const g = TestBed.createComponent(BarcodeScannerModalComponent);
    g.detectChanges(); await g.whenStable(); g.detectChanges();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(g.nativeElement.querySelector('.pf-sc__ready')).toBeTruthy();
  });

  it('a remembered choice beats the lab default (Camera on a manual lab, Type on a scan lab)', async () => {
    let r = await make({ manualOnly: true, stored: 'camera' });
    expect(selected(r.el)).toBe('camera');
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    TestBed.resetTestingModule();
    r = await make({ stored: 'type', expected: 'LAB26001' });
    expect(selected(r.el)).toBe('type');
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(r.el.querySelector('.pf-sc__label')?.textContent?.trim()).toBe('Enter sample');
  });

  it('a hardware-scanner burst is a read in any mode (here: Scanner) and shows as the last read', async () => {
    const { f, el, c } = await make({ expected: '26123', stored: 'scanner' });
    const emitted = vi.fn();
    c.matched.subscribe(emitted);
    timedKeyboard(TestBed.inject(HardwareScanService)).scan('26123');
    f.detectChanges();
    expect(emitted).toHaveBeenCalledWith('26123');
    expect(el.querySelector('.pf-sc__ready .pf-sc__chip')?.textContent?.trim()).toBe('26123');
  });

  it('a tube QR (MRN|SampleID) matches the expected Sample ID — camera, scanner or typed', async () => {
    const { c } = await make({ expected: 'HAEM260800001', stored: 'type' });
    const emitted = vi.fn();
    c.matched.subscribe(emitted);
    c.handleScan('MW-26-0012|HAEM260800001');
    expect(emitted).toHaveBeenCalledWith('HAEM260800001');
  });

  it('the 5-digit PF box accepts a whole scanned PF-… code (and a QR payload)', async () => {
    const { f, el, c } = await make({ expected: 'PF-V1-2026-00012-HEM', stored: 'type' });
    const emitted = vi.fn();
    c.matched.subscribe(emitted);
    const box = el.querySelector('.pf-sc__seg-input') as HTMLInputElement;
    expect(box).toBeTruthy();
    expect(box.getAttribute('maxlength')).toBeNull();
    c.onManualSeqChange('PF-V1-2026-00012-HEM');
    f.detectChanges();
    expect((el.querySelector('.pf-sc__confirm') as HTMLButtonElement).disabled).toBe(false);
    c.submitManual();
    expect(emitted).toHaveBeenCalledWith('PF-V1-2026-00012-HEM');

    emitted.mockClear();
    c.onManualSeqChange('MRN9|PF-V1-2026-00012-HEM');
    c.onKey(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(emitted).toHaveBeenCalledWith('PF-V1-2026-00012-HEM');
  });

  it('the 5-digit sequence still works as before', async () => {
    const { c } = await make({ expected: 'PF-V1-2026-00012-HEM', stored: 'type' });
    const emitted = vi.fn();
    c.matched.subscribe(emitted);
    c.onManualSeqChange('00012');
    c.submitManual();
    expect(emitted).toHaveBeenCalledWith('PF-V1-2026-00012-HEM');
  });

  it('closing the window hands scans back to the screen', async () => {
    const { f } = await make({ expected: '26123', stored: 'scanner' });
    const svc = TestBed.inject(HardwareScanService);
    expect(svc.handlerCount).toBe(1);
    f.destroy();
    expect(svc.handlerCount).toBe(0);
  });
});
