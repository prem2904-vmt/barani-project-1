import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { PatientIdCardComponent } from './patient-id-card.component';
import {
  ID_CARD_PRINT_ROOT_ID, ID_CARD_PRINT_STYLE_ID, ID_CARD_PAGE_MM, ID_CARD_DESIGN_MM, ID_CARD_MARGIN_MM, idCardScale, idCardPrintCss, prepareIdCardPrint, tubePrintCss,
} from '../../../shared/utils/print-label';

/**
 * OPS-102: the ID card prints through its OWN path - cloned to a root on <body> with its own
 * @page - instead of the tube-label rule (absolute, left/top 0) that a modal ancestor's
 * overflow / transform clipped (QR cut off).
 */
describe('Patient ID card print (OPS-102)', () => {
  afterEach(() => { document.body.innerHTML = ''; document.head.querySelectorAll(`#${ID_CARD_PRINT_STYLE_ID}`).forEach(e => e.remove()); document.body.className = ''; });

  it('clones the card to a root on <body>, adds its @page, and cleans up', () => {
    const modal = document.createElement('div');
    modal.style.cssText = 'overflow:hidden;transform:scale(0.9)';
    const card = document.createElement('div');
    card.className = 'pf-idc__card pf-print-label';
    card.innerHTML = '<p>Test Patient</p><svg></svg>';
    modal.appendChild(card);
    document.body.appendChild(modal);

    const cleanup = prepareIdCardPrint(card);
    const root = document.getElementById(ID_CARD_PRINT_ROOT_ID)!;
    expect(root.parentElement).toBe(document.body);                  // outside the clipping ancestor
    expect(modal.contains(root)).toBe(false);
    expect(root.textContent).toContain('Test Patient');
    expect(root.firstElementChild!.classList.contains('pf-print-label')).toBe(false);   // never the tube-label rule
    expect(document.body.classList.contains('pf-printing-idcard')).toBe(true);
    expect(document.body.classList.contains('pf-printing-label')).toBe(false);
    expect(document.getElementById(ID_CARD_PRINT_STYLE_ID)!.textContent).toContain(`size: ${ID_CARD_PAGE_MM.w}mm ${ID_CARD_PAGE_MM.h}mm`);

    cleanup();
    expect(document.getElementById(ID_CARD_PRINT_ROOT_ID)).toBeNull();
    expect(document.getElementById(ID_CARD_PRINT_STYLE_ID)).toBeNull();
    expect(document.body.classList.contains('pf-printing-idcard')).toBe(false);
  });

  it('prints on the configured paper: @page + scale follow the size; the default is unchanged', () => {
    expect(idCardScale({ w: 92, h: 62 })).toBe(1);
    expect(idCardPrintCss()).toContain('size: 92mm 62mm');
    const a5 = idCardPrintCss({ w: 148, h: 210 });
    expect(a5).toContain('size: 148mm 210mm');
    expect(a5).toContain(`zoom: ${idCardScale({ w: 148, h: 210 })}`);
    expect(idCardScale({ w: 148, h: 210 })).toBeGreaterThan(1.5);
    expect(idCardScale({ w: 86, h: 54 })).toBeLessThan(1);   // CR80 shrinks, never crops
    // the whole card fits inside the paper minus the margins, both ways
    for (const pp of [{ w: 86, h: 54 }, { w: 105, h: 148 }, { w: 210, h: 297 }, { w: 50, h: 30 }]) {
      const k = idCardScale(pp);
      expect(ID_CARD_DESIGN_MM.w * k).toBeLessThanOrEqual(pp.w - 2 * ID_CARD_MARGIN_MM + 0.01);
      expect(ID_CARD_DESIGN_MM.h * k).toBeLessThanOrEqual(pp.h - 2 * ID_CARD_MARGIN_MM + 0.01);
    }
    const card = document.createElement('div'); card.textContent = 'x'; document.body.appendChild(card);
    const cleanup = prepareIdCardPrint(card, { w: 148, h: 210 });
    expect(document.getElementById(ID_CARD_PRINT_STYLE_ID)!.textContent).toContain('size: 148mm 210mm');
    cleanup();
  });

  it('the component prints on the station-configured ID card size', () => {
    try { localStorage.setItem('pf.printConfig', JSON.stringify({ idCardWidthMm: 148, idCardHeightMm: 210 })); } catch { /* ignore */ }
    TestBed.configureTestingModule({});
    const f = TestBed.createComponent(PatientIdCardComponent);
    f.componentRef.setInput('patient', { id: 'p1', firstName: 'Test', lastName: 'Patient', sex: 'F' } as never);
    f.detectChanges();
    const spy = vi.spyOn(window, 'print').mockImplementation(() => {
      expect(document.getElementById(ID_CARD_PRINT_STYLE_ID)!.textContent).toContain('size: 148mm 210mm');
    });
    f.componentInstance.print();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    try { localStorage.removeItem('pf.printConfig'); } catch { /* ignore */ }
  });

  it('its stylesheet keeps the card in flow: no absolute position, no transform, no clip', () => {
    const css = idCardPrintCss();
    expect(css).toContain('position: static !important');
    expect(css).toContain('transform: none !important');
    expect(css).toContain('overflow: visible !important');
    expect(css).not.toMatch(/position:\s*absolute/);
  });

  it('tube-label printing keeps its own page rule, untouched', () => {
    const css = tubePrintCss(50, 25);
    expect(css).toContain('@page { size: 50mm 25mm; margin: 0; }');
    expect(css).not.toContain('pf-idcard');
  });

  it('the component prints through printIdCard: the card is no longer a .pf-print-label', () => {
    TestBed.configureTestingModule({});
    const f = TestBed.createComponent(PatientIdCardComponent);
    f.componentRef.setInput('patient', { id: 'p1', firstName: 'Test', lastName: 'Patient', sex: 'F', mrn: 'MRN-1' } as never);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('.pf-print-label')).toBeNull();
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {
      const root = document.getElementById(ID_CARD_PRINT_ROOT_ID);
      expect(root).not.toBeNull();
      expect(root!.textContent).toContain('PATIENT ID CARD');
    });
    (f.componentInstance as PatientIdCardComponent).print();
    expect(printSpy).toHaveBeenCalledTimes(1);
    printSpy.mockRestore();
  });
});
