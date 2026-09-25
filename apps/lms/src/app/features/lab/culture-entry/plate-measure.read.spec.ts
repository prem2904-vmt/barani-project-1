import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, of, throwError } from 'rxjs';
import { PlateMeasureComponent } from './plate-measure.component';
import { PlatformService } from '../../../core/services/platform.service';
import { CapacitorService } from '../../../core/services/capacitor.service';
import { ToastService } from '../../../core/services/toast.service';
import { DiskReadApi, DiskReadResult } from './disk-read';

/** Measure & read: the background AI code read (suggestions only), the
 *  manual fallback, "probably" chips, used codes, and Apply as the ONLY
 *  write — nothing reaches the AST table before the technician confirms. */

const PANEL = ['Amoxicillin-Clavulanate', 'Cefixime', 'Ceftazidime', 'Imipenem'];

function setup(read: () => Observable<DiskReadResult>) {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => new Promise(() => { /* */ }) } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect() { /* */ }, drawImage() { /* */ }, fillText() { /* */ },
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,QUJD');
  const api = { read: vi.fn(read), confirm: vi.fn(() => of({})), usage: vi.fn(() => of({ monthTokens: 1_200_000, capTokens: 2_000_000, calls: 14 })) };
  TestBed.configureTestingModule({
    imports: [PlateMeasureComponent],
    providers: [
      { provide: HttpClient, useValue: {} },
      { provide: PlatformService, useValue: { isCapacitor: () => false, getApiUrl: () => '' } },
      { provide: CapacitorService, useValue: { impact: () => Promise.resolve() } },
      { provide: ToastService, useValue: { success() {}, error() {}, info() {}, warning() {} } },
      { provide: DiskReadApi, useValue: api },
    ],
  });
  const f = TestBed.createComponent(PlateMeasureComponent);
  const c = f.componentInstance as any;
  c.antibiotics = PANEL;
  c.orderTestId = 'OT-1';
  c.srI = (drug: string, mm: number) => (mm >= 20 ? 'S' : mm <= 14 ? 'R' : 'I');
  f.detectChanges();
  // A measured plate: 4 disks, disk 4 has a 22 mm zone.
  c.stopCamera();
  c.imageSrc.set('data:image/png;base64,x');
  c.natW.set(720); c.natH.set(1280);
  c.view.set({ x: 0, y: 0, w: 720, h: 1280 });
  c.calPts.set([{ x: 30, y: 668 }, { x: 530, y: 668 }]);
  c.rows.set([1, 2, 3, 4].map(n => ({
    id: n * 10, n, cx: 100 * n, cy: 600, own: { rx: 16, ry: 16, angle: 0 }, ruler: { rx: 16, ry: 16, angle: 0 },
    k: n === 4 ? 22 / 6 : 1, zoneFound: n === 4, code: null, codeSrc: null, aiConf: null, notDisk: false, suggested: null,
  })));
  c.mode.set('measure');
  c.showHint.set(false);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  return { f, c, el, api };
}

const RESULT: DiskReadResult = {
  disks: [
    { n: 1, code: 'AMC 30', confidence: 0.97 },
    { n: 2, code: 'UNKNOWN', confidence: 0, suggestedCode: 'CFM 5' },
    { n: 3, code: 'CAZ 30', confidence: 0.7 },
    { n: 4, code: 'IPM 10', confidence: 0.95 },
  ],
  model: 'gemma-4-26b-a4b-it', latencyMs: 91000,
  usage: { promptTokens: 474, outputTokens: 245, thoughtTokens: 5929, totalTokens: 6648 }, auditId: 'aud-1',
};

afterEach(() => { document.querySelectorAll('pf-plate-measure').forEach(n => n.remove()); vi.restoreAllMocks(); });

describe('Measure & read — the ONE background AI call', () => {
  it('sends ONE mosaic with the panel as candidate codes; rows show "Reading…" while it runs', () => {
    const pending = new Subject<DiskReadResult>();
    const { f, c, el, api } = setup(() => pending);
    c.startAiRead();
    f.detectChanges();
    expect(api.read).toHaveBeenCalledTimes(1);
    const req = (api.read.mock.calls[0] as unknown[])[0] as any;
    expect(req.orderTestId).toBe('OT-1');
    expect(req.image).toBe('QUJD');                         // base64, no data: prefix
    expect(req.tiles).toEqual([1, 2, 3, 4]);
    expect(req.candidates).toEqual(expect.arrayContaining(['AMC 30', 'CFM 5', 'CAZ 30', 'IPM 10']));
    expect(req.candidates).not.toContain('VA 30');
    expect(c.ai()).toBe('pending');
    expect(el.querySelectorAll('.pm-codesel--pending').length).toBe(4);
    expect(el.querySelector('.pm-codesel .pf-dd__value')?.textContent?.trim()).toBe('Reading…');
    // The technician keeps working meanwhile: editing a zone is fine.
    c.setMm(10, '12');
    expect(c.mmOf(c.rows()[0])).toBe(12);
  });

  it('a slow read says "Still reading…" after 15 s; the client gives up at 60 s', () => {
    vi.useFakeTimers();
    try {
      const pending = new Subject<DiskReadResult>();
      const { f, c, el } = setup(() => pending);
      c.startAiRead();
      vi.advanceTimersByTime(14_000);
      f.detectChanges();
      expect(el.querySelector('.pm-status')?.textContent).toContain('Reading disk codes');
      vi.advanceTimersByTime(2_000);
      f.detectChanges();
      expect(el.querySelector('.pm-status')?.textContent).toContain('Still reading');
      expect(DiskReadApi.TIMEOUT_MS).toBe(60_000);
    } finally { vi.useRealTimers(); }
  });

  it('API absent (404) → "Codes: pick manually", unknown chips, no crash', () => {
    const { f, c, el } = setup(() => throwError(() => ({ status: 404, error: {} })));
    c.startAiRead();
    f.detectChanges();
    expect(c.ai()).toBe('failed');
    expect(el.querySelector('.pm-note--manual')?.textContent?.trim()).toBe('AI reading isn’t available — pick each disk’s code');
    expect(el.querySelector('.pm-status')).toBeNull();
    expect(el.querySelector('.pm-codesel .pf-dd__value')?.textContent?.trim()).toBe('Unknown — tap to pick');
    expect(el.querySelectorAll('.pm-codesel--pending').length).toBe(0);
  });

  it('AI result → codes fill in as suggestions (AI tag), S/I/R from the breakpoints', () => {
    const { f, c, el } = setup(() => of(RESULT));
    c.startAiRead();
    f.detectChanges();
    const codes = c.rows().map((r: any) => r.code);
    expect(codes).toEqual(['AMC 30', null, 'CAZ 30', 'IPM 10']);
    expect(el.querySelectorAll('.pm-ai').length).toBe(3);
    expect(c.sirOf(c.rows()[3])).toBe('S');                 // IPM 10 at 22 mm
    expect(el.querySelector('.pm-drow[data-n="4"] .pm-sir')?.textContent?.trim()).toBe('S');
    expect(el.querySelector('.pm-usage')?.textContent).toContain('AI reads this month: 1.2M / 2M tokens');
  });

  it('"Probably CFM 5 — confirm": a neutral one-tap chip, never applied by itself', () => {
    const { f, c, el } = setup(() => of(RESULT));
    c.startAiRead();
    f.detectChanges();
    const sug = el.querySelector<HTMLButtonElement>('.pm-drow[data-n="2"] .pm-sug')!;
    expect(sug.textContent).toContain('Probably');
    expect(sug.textContent).toContain('CFM 5');
    expect(c.rows()[1].code).toBeNull();
    sug.click();
    f.detectChanges();
    expect(c.rows()[1]).toMatchObject({ code: 'CFM 5', codeSrc: 'tech' });
  });

  it('a code picked for one disk is marked as used in the others\' lists (and moves)', () => {
    const { c } = setup(() => of(RESULT));
    c.startAiRead();
    const other = c.codeOptions().get(20).find((o: any) => o.value === 'AMC 30');
    expect(other.hint).toContain('on disk 1');
    c.pickCode(20, 'AMC 30');
    expect(c.rows()[0].code).toBeNull();
    expect(c.rows()[1].code).toBe('AMC 30');
  });

  it('Apply writes ONLY after the technician confirms — then codes + mm go to the rows by drug', async () => {
    const { f, c, el, api } = setup(() => of(RESULT));
    const emitted: any[] = [];
    c.applied.subscribe((e: any) => emitted.push(e));
    c.startAiRead();
    f.detectChanges();
    expect(emitted.length).toBe(0);                         // AI answer ≠ a write
    c.pickCode(20, 'CFM 5');
    expect(emitted.length).toBe(0);
    el.querySelector<HTMLButtonElement>('.pm-controls .nd-btn--primary')!.click();   // Review
    f.detectChanges();
    expect(c.mode()).toBe('review');
    const prim = el.querySelectorAll('.pm-controls .nd-btn--primary');
    expect(prim.length).toBe(1);
    expect(prim[0].textContent?.trim()).toBe('Apply to table');
    expect(emitted.length).toBe(0);
    await c.apply();
    expect(emitted.length).toBe(1);
    const m = emitted[0].measurements.sort((a: any, b: any) => a.index - b.index);
    expect(m).toEqual([{ index: 0, zoneMm: 6 }, { index: 1, zoneMm: 6 }, { index: 2, zoneMm: 6 }, { index: 3, zoneMm: 22 }]);
    expect(emitted[0].session.zones[3]).toMatchObject({ code: 'IPM 10', abName: 'Imipenem', mm: 22, n: 4 });
    expect(api.confirm).toHaveBeenCalledWith('aud-1', [
      { n: 1, code: 'AMC 30' }, { n: 2, code: 'CFM 5' }, { n: 3, code: 'CAZ 30' }, { n: 4, code: 'IPM 10' },
    ]);
  });

  it('Review: every disk keeps the code picker; picking there updates the line and enables Apply', () => {
    const { f, c, el } = setup(() => throwError(() => ({ status: 404 })));
    c.startAiRead();
    c.goReview();
    f.detectChanges();
    expect(el.querySelector('.pm-note--manual')?.textContent).toContain('AI reading isn’t available');
    const pickers = el.querySelectorAll('.pm-drow pf-select.pm-codesel');
    expect(pickers.length).toBe(4);                          // not a static "No code" chip
    expect(el.querySelector('.pm-drow[data-n="1"] .pf-dd__value')?.textContent?.trim()).toBe('Unknown — tap to pick');
    expect(el.querySelector('.pm-drow[data-n="1"] .pm-drow__drug')?.textContent?.trim()).toBe('Not applied — pick a code');
    const apply = () => el.querySelector<HTMLButtonElement>('.pm-controls .nd-btn--primary')!;
    expect(apply().textContent?.trim()).toBe('Apply to table');
    expect(apply().disabled).toBe(true);
    expect(el.querySelector('.pm-controls .pm-hinttext')?.textContent).toContain('0 zones go to the AST table');
    // Pick on Review (the same panel list, used codes marked).
    c.pickCode(40, 'IPM 10');
    f.detectChanges();
    expect(c.mode()).toBe('review');
    expect(el.querySelector('.pm-drow[data-n="4"] .pf-dd__value')?.textContent?.trim()).toBe('IPM 10');
    expect(el.querySelector('.pm-drow[data-n="4"] .pm-drow__drug')?.textContent?.trim()).toBe('Imipenem');
    expect(el.querySelector('.pm-controls .pm-hinttext')?.textContent).toContain('1 zone goes to the AST table');
    expect(apply().disabled).toBe(false);
    expect(c.codeOptions().get(10).find((o: any) => o.value === 'IPM 10').hint).toContain('on disk 4');
  });

  it('the AI cap gets its own hint', () => {
    const { f, c, el } = setup(() => throwError(() => ({ status: 429, error: { error: 'ai_cap_reached', message: 'cap' } })));
    c.startAiRead();
    f.detectChanges();
    expect(el.querySelector('.pm-note--manual')?.textContent).toContain('AI limit reached this month');
  });

  it('disks without a code are left out of Apply (and the review says so)', async () => {
    const { f, c } = setup(() => throwError(() => ({ status: 404 })));
    const emitted: any[] = [];
    c.applied.subscribe((e: any) => emitted.push(e));
    c.startAiRead();
    c.pickCode(40, 'IPM 10');
    c.goReview();
    f.detectChanges();
    expect(c.reviewLine()).toContain('3 without a code are left out');
    await c.apply();
    expect(emitted[0].measurements).toEqual([{ index: 3, zoneMm: 22 }]);
  });
});
