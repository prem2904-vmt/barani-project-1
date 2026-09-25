import { TestBed } from '@angular/core/testing';
import { BarcodeScannerModalComponent } from './barcode-scanner-modal.component';

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

async function make(opts: { manualOnly?: boolean; expected?: string; cameraFail?: Error | null } = {}) {
  stubMatchMedia();
  stubCamera(opts.cameraFail ?? null);
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

afterEach(() => { document.body.classList.remove('pf-scanner-open'); });

describe('Barcode scanner — new-design shell', () => {
  it('renders the BILLING header: icon chip, SCAN SAMPLE label, calm title, close button', async () => {
    const { el } = await make({ expected: '26123' });
    expect(el.querySelector('.pf-sc__head .nd-card__icon svg')).toBeTruthy();
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

  it('is the kit phone sheet (nd-sheet) with a handle', async () => {
    const { el } = await make({ expected: '26123' });
    const card = el.querySelector('.pf-sc__card');
    expect(card?.classList.contains('nd-sheet')).toBe(true);
    expect(card?.querySelector('.nd-sheet__handle')).toBeTruthy();
  });

  it('footer is secondary "Enter manually" + tertiary "Cancel", never a primary', async () => {
    const { el } = await make({ expected: '26123' });
    const foot = el.querySelector('.pf-sc__foot')!;
    const toggle = foot.querySelector('.pf-sc__manual-toggle')!;
    expect(toggle.classList.contains('nd-btn--secondary')).toBe(true);
    expect(toggle.textContent?.trim()).toBe('Enter manually');
    expect(foot.querySelector('.pf-sc__cancel')?.classList.contains('nd-btn--tertiary')).toBe(true);
    expect(foot.querySelector('.nd-btn--primary')).toBeNull();
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
    expect(el.querySelectorAll('.nd-btn--primary').length).toBe(1);
    // Manual-only tenants have no "Use camera" toggle.
    expect(el.querySelector('.pf-sc__manual-toggle')).toBeNull();
  });

  it('camera unavailable → neutral fallback panel with a secondary Enter manually', async () => {
    const { el } = await make({ expected: '26123', cameraFail: new Error('Permission denied') });
    const fb = el.querySelector('.pf-sc__fallback')!;
    expect(fb.textContent).toContain('Camera permission denied');
    const btn = fb.querySelector('button.nd-btn--secondary');
    expect(btn?.textContent?.trim()).toBe('Enter manually');
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
