import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { OrderCreateComponent } from './order-create.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { AuthService } from '../../../core/auth/auth.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ApiError } from '../../../shared/models/api-response.model';

/**
 * Inventory Phase 1 review fix R1: order-create's two PATCH
 * /api/orders/{id}/tests call sites (confirmPayment's patch branch,
 * submit()'s edit-mode branch) used to call api.patch() directly, so a
 * `stock_warning` 400 had no recovery path — the desk was simply stuck.
 * `patchTestsWithStockGate()` is a twin of the existing
 * `postOrderWithStockGate()` (same dialog, same manage_inventory gate,
 * resend with overrideStockWarning:true); both call sites now go through it.
 *
 * Also covers the "two OK buttons" fix: the non-manager notice used to be
 * `dialog.confirm({ confirmLabel: 'OK', cancelLabel: 'OK' })` (renders two
 * identical buttons) — both gates now use `dialog.alert()` (one button).
 */
const T = (id: string, name: string, price: number, extra: any = {}) => ({ id, name, type: 'individual', price, tatHours: 4, isActive: true, ...extra });
const catalog = () => [T('hb', 'Haemoglobin Concentration', 100)];

function stockWarning(message = 'Short: Haemoglobin needs 1 tube, 0 on hand') {
  return new ApiError(message, 'stock_warning');
}

function make(opts: { hasManageInventory?: boolean } = {}) {
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const api = { get: vi.fn(() => of([])), post: vi.fn(() => of({})), patch: vi.fn(() => of({})) };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  const dialog = { confirm: vi.fn(), alert: vi.fn(() => Promise.resolve()) };
  const auth = { hasPermission: vi.fn(() => opts.hasManageInventory ?? true) };
  const stub = {};
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toasts },
      { provide: DialogService, useValue: dialog },
      { provide: AuthService, useValue: auth },
      { provide: ActivatedRoute, useValue: { queryParamMap: of(new Map()), snapshot: { paramMap: new Map(), queryParamMap: new Map() } } },
      { provide: Router, useValue: { navigate: vi.fn() } },
      { provide: NavBackService, useValue: stub },
      { provide: Location, useValue: stub },
      { provide: BranchLabConfigService, useValue: { billingMode: () => 'front_desk', collectsAtFrontdesk: () => false } },
      { provide: ProcessWorkflowService, useValue: { isEnabled: () => false } },
      { provide: DomSanitizer, useValue: stub },
    ],
  });
  const c = TestBed.runInInjectionContext(() => new OrderCreateComponent()) as any;
  c._tests.set(catalog());
  return { c, api, toasts, dialog, auth };
}

describe('patchTestsWithStockGate — the PATCH twin of postOrderWithStockGate', () => {
  it('manager override: resends the SAME body + overrideStockWarning:true, returns the override response', async () => {
    const { c, api, dialog } = make({ hasManageInventory: true });
    api.patch
      .mockReturnValueOnce(throwError(() => stockWarning()))
      .mockReturnValueOnce(of({ order: { id: 'o1' }, bill: null }));
    dialog.confirm.mockResolvedValue(true);

    const result = await c.patchTestsWithStockGate('o1', { testIds: ['hb'], reason: 'reception edit' });

    expect(result).toEqual({ order: { id: 'o1' }, bill: null });
    expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Stock warning', confirmLabel: 'Save anyway' }));
    expect(api.patch).toHaveBeenCalledTimes(2);
    expect(api.patch).toHaveBeenNthCalledWith(2, '/api/orders/o1/tests', { testIds: ['hb'], reason: 'reception edit', overrideStockWarning: true });
  });

  it('non-manager: a single-button alert (never confirm/OK-OK), and the error rethrows with no resend', async () => {
    const { c, api, dialog } = make({ hasManageInventory: false });
    api.patch.mockReturnValueOnce(throwError(() => stockWarning('Short: Haemoglobin')));

    await expect(c.patchTestsWithStockGate('o1', { testIds: ['hb'] })).rejects.toThrow('Short: Haemoglobin');

    expect(dialog.alert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Stock warning' }));
    expect(dialog.confirm).not.toHaveBeenCalled();
    expect(api.patch).toHaveBeenCalledTimes(1);
  });

  it('manager declines the override: rethrows, never resends', async () => {
    const { c, api, dialog } = make({ hasManageInventory: true });
    api.patch.mockReturnValueOnce(throwError(() => stockWarning()));
    dialog.confirm.mockResolvedValue(false);

    await expect(c.patchTestsWithStockGate('o1', { testIds: ['hb'] })).rejects.toBeTruthy();
    expect(api.patch).toHaveBeenCalledTimes(1);
  });

  it('a non-stock_warning error passes straight through — no dialog shown at all', async () => {
    const { c, api, dialog } = make();
    api.patch.mockReturnValueOnce(throwError(() => new ApiError('Order not found', 'not_found')));

    await expect(c.patchTestsWithStockGate('o1', {})).rejects.toThrow('Order not found');
    expect(dialog.alert).not.toHaveBeenCalled();
    expect(dialog.confirm).not.toHaveBeenCalled();
  });
});

describe('postOrderWithStockGate — non-manager notice is a single button, not confirm(OK/OK)', () => {
  it('uses dialog.alert(), never dialog.confirm(), for the non-manager notice', async () => {
    const { c, api, dialog } = make({ hasManageInventory: false });
    api.post.mockReturnValueOnce(throwError(() => stockWarning()));

    await expect(c.postOrderWithStockGate({ patientId: 'p1' })).rejects.toBeTruthy();

    expect(dialog.alert).toHaveBeenCalledTimes(1);
    expect(dialog.confirm).not.toHaveBeenCalled();
  });
});

describe('order-create PATCH call sites are wired through patchTestsWithStockGate', () => {
  it('submit() in edit mode calls patchTestsWithStockGate(editId, …), not a bare api.patch', async () => {
    const { c, toasts } = make();
    const spy = vi.spyOn(c, 'patchTestsWithStockGate').mockResolvedValue({ order: {}, bill: null });

    c.editOrderId.set('order-42');
    c._patient.set({ id: 'p1' });
    c._selected.set(['hb']);

    c.submit();
    await Promise.resolve(); // flush the async IIFE's first microtask
    await Promise.resolve();

    expect(spy).toHaveBeenCalledWith('order-42', expect.objectContaining({ testIds: ['hb'], reason: 'reception edit' }));
    expect(toasts.success).toHaveBeenCalledWith('Order updated — reconcile payment');
  });

  it('submit() in edit mode surfaces a declined/rethrown stock_warning via surfaceMutationError, not an unhandled rejection', async () => {
    const { c, toasts } = make();
    vi.spyOn(c, 'patchTestsWithStockGate').mockRejectedValue(stockWarning('Short: Haemoglobin'));

    c.editOrderId.set('order-42');
    c._patient.set({ id: 'p1' });
    c._selected.set(['hb']);

    c.submit();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(toasts.error).toHaveBeenCalledWith('Short: Haemoglobin');
    expect(c._saving()).toBe(false);
  });

  it('confirmPayment (create→patch retry branch) calls patchTestsWithStockGate(plan.orderId, …), not a bare api.patch', async () => {
    const { c, api } = make();
    const spy = vi.spyOn(c, 'patchTestsWithStockGate').mockResolvedValue({});
    api.post.mockReturnValue(of({ id: 'bill-1', totalDiscount: 0, balance: 0, totalPaid: 0, status: 'draft', orderId: 'order-9' }));

    c._patient.set({ id: 'p1' });
    c._selected.set(['hb']);
    // A pending order for the SAME patient but a DIFFERENT cart key -> planConfirmOrder returns 'patch'.
    (c as any).pendingOrder = { id: 'order-9', patientId: 'p1', key: JSON.stringify([[], []]) };

    await c.confirmPayment({ mode: 'cash' });

    expect(spy).toHaveBeenCalledWith('order-9', expect.objectContaining({ testIds: ['hb'], reason: 'reception edit' }));
  });
});
