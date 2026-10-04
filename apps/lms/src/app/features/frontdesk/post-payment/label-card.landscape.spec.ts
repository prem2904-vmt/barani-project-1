import { TestBed } from '@angular/core/testing';
import JsBarcode from 'jsbarcode';
import { LabelCardComponent } from './label-card.component';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { PrintConfigService } from '../../../core/printer/print-config.service';
import { prepareTubePrint, TUBE_PRINT_ROOT_ID, TUBE_PRINT_STYLE_ID } from '../../../shared/utils/print-label';

const sample = (extra: any = {}) => ({
  id: 's1', orderId: 'o1', departmentId: 'd1', status: 'pending', barcode: '26220', rejectionCount: 0,
  createdAt: '2026-09-25T00:00:00Z', tests: [], department: { name: 'Biochemistry', code: 'BIO' }, tubeColor: 'sst', ...extra,
});

function render(opts: { mode?: 'barcode' | 'qr' | 'datamatrix'; w?: number; h?: number; name?: string } = {}) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: BranchLabConfigService, useValue: { ensureLoaded() {}, config: () => ({ labelCodeMode: opts.mode ?? 'barcode' }) } }],
  });
  TestBed.inject(PrintConfigService).setLabelSize(opts.w ?? 50, opts.h ?? 25);
  const f = TestBed.createComponent(LabelCardComponent);
  f.componentInstance.sample = sample() as any;
  f.componentInstance.patient = { displayName: opts.name ?? 'Mr. Kesavan L', mrn: 'AA0008', age: 29, sex: 'male' } as any;
  f.componentInstance.printing = true;
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance };
}

describe('Printed tube label — landscape', () => {
  afterEach(() => { try { localStorage.removeItem('pf.printConfig'); } catch { /* */ } });

  it('is drawn at the station label size (mm), text block then code block side by side', () => {
    const { el } = render({ w: 50, h: 25 });
    const tl = el.querySelector('.pf-tl') as HTMLElement;
    expect(tl.style.width).toBe('50mm');
    expect(tl.style.height).toBe('25mm');
    expect(tl.dataset['wMm']).toBe('50');
    expect(tl.dataset['hMm']).toBe('25');
    const kids = [...tl.children].map(k => k.className);
    expect(kids[0]).toContain('pf-tl__text');
    expect(kids[1]).toContain('pf-tl__code');
    // Nothing stacked under the code: the dept + sample number live in the text block.
    const text = tl.querySelector('.pf-tl__text')!;
    expect(text.querySelector('.pf-lc__pname')!.textContent).toContain('Mr. Kesavan L');
    expect(text.querySelector('.pf-lc__pname')!.textContent).toContain('29M');
    expect(text.querySelector('.pf-lc__demo')!.textContent).toContain('MRN AA0008');
    expect(text.querySelector('.pf-lc__deptcode')!.textContent).toContain('BIO');
    expect(text.querySelector('.pf-lc__sid')!.textContent).toContain('26220');
    expect(tl.querySelector('.pf-tl__code .pf-lc__deptcode')).toBeNull();
  });

  it('38 × 25 mm stock is respected too', () => {
    const { el } = render({ w: 38, h: 25 });
    const tl = el.querySelector('.pf-tl') as HTMLElement;
    expect(tl.style.width).toBe('38mm');
    expect(tl.style.height).toBe('25mm');
  });

  it('the barcode encodes exactly the sample number (unchanged payload)', () => {
    const { el, c } = render({ mode: 'barcode' });
    expect(c.barcode).toBe('26220');
    const ref = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(ref, '26220', { format: 'CODE128', displayValue: false, margin: 0, height: 100, width: 1, background: '#ffffff', lineColor: '#000000' });
    const bars = (s: Element) => [...s.querySelectorAll('rect')].map(r => `${r.getAttribute('x')}:${r.getAttribute('width')}`).join(',');
    const svg = el.querySelector('.pf-lc__bar')!;
    expect(bars(svg)).toBe(bars(ref));
    // Stretched uniformly to the bar box.
    expect(svg.getAttribute('preserveAspectRatio')).toBe('none');
    expect(svg.getAttribute('viewBox')).toBe('0 0 79 100');
  });

  it('the QR still carries MRN|sample number', () => {
    const { c } = render({ mode: 'qr' });
    expect(c.qrValue).toBe('AA0008|26220');
  });

  it('a long name is never truncated (full text, wraps instead of clipping)', () => {
    const long = 'Ms. Paravai Munusamy Venkataraghavan Subramaniam';
    const { el } = render({ w: 38, h: 25, name: long });
    const p = el.querySelector('.pf-lc__pname') as HTMLElement;
    expect(p.textContent).toContain(long);
    expect(p.textContent).not.toContain('…');
    expect(parseFloat(p.style.fontSize)).toBeLessThan(3);
  });

  it('printing puts each label on its own exact-size page with @page size + margin 0', () => {
    const { el } = render({ w: 50, h: 25 });
    const labels = [el.querySelector('.pf-tl') as HTMLElement, el.querySelector('.pf-tl') as HTMLElement];
    const cleanup = prepareTubePrint(labels);
    const root = document.getElementById(TUBE_PRINT_ROOT_ID)!;
    expect(root.querySelectorAll('.pf-tl-page').length).toBe(2);
    expect(root.querySelector('.pf-tl-page .pf-tl .pf-lc__sid')!.textContent).toContain('26220');
    const css = document.getElementById(TUBE_PRINT_STYLE_ID)!.textContent!;
    expect(css).toContain('@page { size: 50mm 25mm; margin: 0; }');
    expect(css).toContain('break-after: page');
    expect(document.body.classList.contains('pf-printing-tubes')).toBe(true);
    cleanup();
    expect(document.getElementById(TUBE_PRINT_ROOT_ID)).toBeNull();
    expect(document.getElementById(TUBE_PRINT_STYLE_ID)).toBeNull();
    expect(document.body.classList.contains('pf-printing-tubes')).toBe(false);
  });
});
