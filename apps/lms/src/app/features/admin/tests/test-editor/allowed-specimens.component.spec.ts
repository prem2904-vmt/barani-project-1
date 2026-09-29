import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { AllowedSpecimensComponent, rowsOf, writesOf } from './allowed-specimens.component';
import { ApiService } from '../../../../core/services/api.service';
import { ToastService } from '../../../../core/services/toast.service';

/**
 * The Test Master's "Allowed specimens" grid (owner 2026-09-29): the list a
 * test may be ordered on, each with container / volume / transport /
 * instruction / the single default / a price per specimen, saved as ONE
 * PUT /api/microbiology/test-specimens/{id}.
 */
const MASTER = [
  { code: 'SPEC013', name: 'Urine', container: 'Sterile urine container' },
  { code: 'SPEC005', name: 'Sputum', container: null },
  { code: 'SPEC026', name: 'Blood', container: 'Blood culture bottle' },
];
const MAP = {
  testId: 't1', inherited: true, mode: 'choose', basePrice: 100, defaultSpecimen: 'Urine',
  specimens: [
    { code: 'SPEC013', name: 'Urine', isDefault: true, container: 'urine', volumeMl: 10, instruction: 'Mid-stream', price: null },
    { code: 'SPEC005', name: 'Sputum', isDefault: false, container: 'Sterile wide-mouth container', price: 250 },
  ],
};

function make(opts: { map?: any; putErr?: any; mode?: 'fixed' | 'choose' | 'none' } = {}) {
  const api = {
    get: vi.fn(() => of([opts.map ?? MAP])),
    put: vi.fn(() => (opts.putErr ? throwError(() => opts.putErr) : of({ ...(opts.map ?? MAP), inherited: false }))),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  TestBed.configureTestingModule({
    imports: [AllowedSpecimensComponent],
    providers: [{ provide: ApiService, useValue: api }, { provide: ToastService, useValue: toasts }],
  });
  const f = TestBed.createComponent(AllowedSpecimensComponent);
  f.componentRef.setInput('testId', 't1');
  f.componentRef.setInput('mode', opts.mode ?? 'choose');
  f.componentRef.setInput('master', MASTER);
  f.detectChanges();
  TestBed.flushEffects();
  f.detectChanges();
  return { f, c: f.componentInstance, api, toasts, el: f.nativeElement as HTMLElement };
}

describe('AllowedSpecimensComponent — pure mappers', () => {
  it('server rows → grid rows: only a known container KEY is kept, blank price = base', () => {
    const rows = rowsOf(MAP.specimens as any);
    expect(rows[0]).toEqual({ code: 'SPEC013', name: 'Urine', isDefault: true, container: 'urine', volumeMl: 10, transport: '', instruction: 'Mid-stream', price: '' });
    expect(rows[1].container).toBe('');            // free text from the doc import never overrides the tube
    expect(rows[1].price).toBe(250);
  });

  it('grid rows → the PUT body: blanks become null, prices clamp at 0', () => {
    const w = writesOf([{ code: 'SPEC013', name: 'Urine', isDefault: true, container: '', volumeMl: null, transport: ' ', instruction: 'x', price: -5 }]);
    expect(w).toEqual([{ code: 'SPEC013', isDefault: true, container: null, volumeMl: null, transport: null, instruction: 'x', price: 0 }]);
    expect(writesOf([{ code: 'A', name: 'A', isDefault: false, container: 'edta', volumeMl: 2, transport: '', instruction: '', price: '' }])[0].price).toBeNull();
  });
});

describe('AllowedSpecimensComponent — the grid', () => {
  it('loads the test\'s list, shows the inherited note and the price column (a tenant has a base price)', () => {
    const { c, api, el } = make();
    expect(api.get).toHaveBeenCalledWith('/api/microbiology/test-specimens?testIds=t1');
    expect(c.rows().map(r => r.code)).toEqual(['SPEC013', 'SPEC005']);
    expect(c.inherited()).toBe(true);
    expect(el.textContent).toContain('Read from the Admin Test Master');
    expect(c.showPrice()).toBe(true);
    expect(el.querySelectorAll('tbody tr').length).toBe(2);
    expect(c.dirty()).toBe(false);
  });

  it('the Add picker offers only master specimens not yet allowed; add / remove / the single default', () => {
    const { c } = make();
    expect(c.addOptions().map(o => o.value)).toEqual(['SPEC026']);
    c.add('SPEC026');
    expect(c.rows().map(r => r.code)).toEqual(['SPEC013', 'SPEC005', 'SPEC026']);
    expect(c.addOptions()).toEqual([]);
    c.setDefault('SPEC026', true);
    expect(c.rows().filter(r => r.isDefault).map(r => r.code)).toEqual(['SPEC026']);   // Urine un-defaulted
    c.remove('SPEC005');
    expect(c.rows().map(r => r.code)).toEqual(['SPEC013', 'SPEC026']);
    expect(c.dirty()).toBe(true);
  });

  it('Save PUTs the whole list (container key, price or null) and the saved map replaces the grid', () => {
    const { c, api, toasts } = make();
    c.set('SPEC013', { price: 120, container: 'urine' });
    c.set('SPEC005', { price: '' });
    c.save();
    expect(api.put).toHaveBeenCalledWith('/api/microbiology/test-specimens/t1', {
      specimens: [
        { code: 'SPEC013', isDefault: true, container: 'urine', volumeMl: 10, transport: null, instruction: 'Mid-stream', price: 120 },
        { code: 'SPEC005', isDefault: false, container: null, volumeMl: null, transport: null, instruction: null, price: null },
      ],
    });
    expect(toasts.success).toHaveBeenCalled();
    expect(c.inherited()).toBe(false);
    expect(c.dirty()).toBe(false);
  });

  it('a FIXED test must have exactly one row — Save is refused client-side with the reason', () => {
    const { c, api } = make({ mode: 'fixed' });
    c.save();
    expect(api.put).not.toHaveBeenCalled();
    expect(c.error()).toContain('exactly ONE');
    c.remove('SPEC005');
    c.save();
    expect(api.put).toHaveBeenCalled();
  });

  it('the template tenant (no base price) hides the price column; a server error is shown', () => {
    const { c, el, toasts } = make({ map: { ...MAP, basePrice: null }, putErr: { error: { message: 'Unknown container "x"' } } });
    expect(c.showPrice()).toBe(false);
    expect(el.textContent).not.toContain('Price (₹)');
    c.set('SPEC005', { instruction: 'changed' });
    c.save();
    expect(toasts.error).toHaveBeenCalled();
    expect(c.error()).toBeTruthy();
  });
});
