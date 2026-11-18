import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  ORDER_ID_DEFAULT_PREFIX, OrderIdFormatCardComponent, OrderIdModule, cleanOrderPrefix, orderIdPreview, sanitizeOrderPad,
} from './order-id-format-card.component';

function mount(module: OrderIdModule, saved: unknown = null) {
  const api = { get: vi.fn(() => of(saved)), post: vi.fn(() => of({})) };
  const toasts = { success: vi.fn(), error: vi.fn() };
  TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }, { provide: ToastService, useValue: toasts }] });
  const f = TestBed.createComponent(OrderIdFormatCardComponent);
  f.componentRef.setInput('module', module);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  return { f, cmp: f.componentInstance, el, api, toasts };
}
afterEach(() => TestBed.resetTestingModule());

const D = new Date(2026, 10, 18);
const labels = (el: HTMLElement) => Array.from(el.querySelectorAll('.pf-srow__label')).map(l => (l.textContent ?? '').trim());

describe('order-id helpers', () => {
  it('preview joins prefix, date and serial with the separator between every non-empty part (server mirror)', () => {
    expect(orderIdPreview('LAB', 'yymm', '-', 6, 'numeric', 2, D)).toBe('LAB-2611-000001');
    expect(orderIdPreview('VIS', 'yymmdd', '/', 4, 'numeric', 2, D)).toBe('VIS/261118/0001');
    expect(orderIdPreview('PD', 'none', '', 3, 'alpha', 2, D)).toBe('PDAA001');
    expect(orderIdPreview('OPD', 'none', '-', 6, 'numeric', 2, D)).toBe('OPD-000001');
  });
  it('digits clamp (1-10, or 1-6 with letters) and the prefix is letters/digits, upper-case, 16 max', () => {
    expect(sanitizeOrderPad(99, false)).toBe(10);
    expect(sanitizeOrderPad(99, true)).toBe(6);
    expect(sanitizeOrderPad('x', false)).toBe(1);
    expect(cleanOrderPrefix('vis-1 x!')).toBe('VIS1X');
    expect(cleanOrderPrefix('a'.repeat(30))).toHaveLength(16);
    expect(cleanOrderPrefix(null)).toBe('');
  });
  it('default prefixes are the ones the server prints today', () => {
    expect(ORDER_ID_DEFAULT_PREFIX).toEqual({ lab: 'LAB', opd: 'OPD', pharmacy: 'PD' });
  });
});

describe('Lab order ID card', () => {
  it('reads /api/config/order-id?module=lab, has no Custom-format switch, and previews LAB', () => {
    const { el, api, cmp } = mount('lab');
    expect(api.get).toHaveBeenCalledWith('/api/config/order-id?module=lab');
    expect(labels(el)).toEqual(['Prefix', 'Date', 'Separator', 'Digits', 'Letters', 'Preview']);
    expect(cmp.preview()).toMatch(/^LAB-\d{4}-000001$/);
    expect(cmp.dirty()).toBe(false);
  });

  it('saves enabled = true with a blank prefix as null (= LAB), module=lab', () => {
    const { cmp, api, toasts } = mount('lab', { enabled: true, datePrefix: 'ddmmyy', separator: '/', padding: 4, serialMode: 'alpha', letterCount: 3 });
    cmp.save();
    expect(api.post).toHaveBeenCalledWith('/api/config/order-id?module=lab', {
      enabled: true, datePrefix: 'ddmmyy', separator: '/', padding: 4, serialMode: 'alpha', letterCount: 3, prefix: null,
    });
    expect(toasts.success).toHaveBeenCalledWith('Order ID format saved');
  });

  it('a typed prefix is cleaned, shown in the preview, and marks the page dirty until saved / discarded', () => {
    const { cmp, api } = mount('lab', { enabled: true, datePrefix: 'yymm', separator: '-', padding: 6, serialMode: 'numeric', letterCount: 2, prefix: null });
    cmp.prefix.set(cleanOrderPrefix('ab-1'));
    expect(cmp.dirty()).toBe(true);
    expect(cmp.preview()).toMatch(/^AB1-\d{4}-000001$/);
    cmp.discard();
    expect(cmp.prefix()).toBe('');
    expect(cmp.dirty()).toBe(false);
    cmp.prefix.set('AB1');
    cmp.save();
    expect((api.post.mock.calls as any)[0][1]).toEqual(expect.objectContaining({ prefix: 'AB1' }));
    expect(cmp.dirty()).toBe(false);
  });

  it('a failed save keeps the edit and toasts the error', () => {
    const { cmp, api, toasts } = mount('lab');
    api.post.mockReturnValueOnce(throwError(() => ({ error: { message: 'nope' } })) as any);
    cmp.prefix.set('X');
    cmp.save();
    expect(toasts.error).toHaveBeenCalled();
    expect(cmp.dirty()).toBe(true);
    expect(cmp.saving()).toBe(false);
  });
});

describe.each([
  ['opd', 'OPD', 'Visit number', /^OPD-\d{4}-000001$/],
  ['pharmacy', 'PD', 'Dispense number', /^PD-\d{4}-000001$/],
] as const)('%s number card (opt-in)', (module, def, noun, builtIn) => {
  it(`with no saved row: Custom format is OFF, the built-in ${def} number previews, nothing else is shown, not dirty`, () => {
    const { el, api, cmp } = mount(module);
    expect(api.get).toHaveBeenCalledWith(`/api/config/order-id?module=${module}`);
    expect(labels(el)).toEqual(['Custom format', 'Preview']);
    expect(cmp.enabled()).toBe(false);
    expect(cmp.preview()).toMatch(builtIn);
    expect(cmp.dirty()).toBe(false);
  });

  it('switching Custom format on shows the rows (prefix hint names the default) and a Save posts module=' + module, () => {
    const { el, f, cmp, api, toasts } = mount(module);
    cmp.enabled.set(true);
    f.detectChanges();
    expect(labels(el)).toEqual(['Custom format', 'Prefix', 'Date', 'Separator', 'Digits', 'Letters', 'Preview']);
    expect(el.textContent).toContain(`Blank = ${def}`);
    expect(cmp.dirty()).toBe(true);
    // The defaults equal the built-in format, so enabling alone changes no number.
    expect(cmp.preview()).toMatch(builtIn);
    cmp.prefix.set('NEW');
    cmp.save();
    expect(api.post).toHaveBeenCalledWith(`/api/config/order-id?module=${module}`, {
      enabled: true, datePrefix: 'yymm', separator: '-', padding: 6, serialMode: 'numeric', letterCount: 2, prefix: 'NEW',
    });
    expect(toasts.success).toHaveBeenCalledWith(`${noun} format saved`);
  });

  it('a saved custom row loads on, and turning it off saves enabled = false (the fixed format returns)', () => {
    const { cmp, api } = mount(module, { enabled: true, datePrefix: 'yymmdd', separator: '/', padding: 4, serialMode: 'numeric', letterCount: 2, prefix: 'ABC' });
    expect(cmp.enabled()).toBe(true);
    expect(cmp.preview()).toMatch(/^ABC\/\d{6}\/0001$/);
    cmp.enabled.set(false);
    expect(cmp.preview()).toMatch(builtIn);
    cmp.save();
    expect((api.post.mock.calls as any)[0][1]).toEqual(expect.objectContaining({ enabled: false, prefix: 'ABC' }));
  });
});
