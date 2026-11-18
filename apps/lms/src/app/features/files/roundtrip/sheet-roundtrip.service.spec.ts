import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SheetRoundtripService } from './sheet-roundtrip.service';
import { PRICES_DATASET_ID, PricesSheetDataset } from './prices-dataset';
import { datasetBook } from './sheet-roundtrip';
import { buildBook } from './xlsx-book';
import { OfficeService } from '../office.service';
import { SheetEditorService } from '../../neuron/sheet-editor.service';
import { FilesAccessService } from '../files-access.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { PRICE_BULK_PATH } from '../../../shared/utils/test-pricing';

const list = [
  { id: 't1', testCode: 'HEM001', name: 'CBC', price: 250, department: { id: 'd1', name: 'Haematology', code: 'H' } },
  { id: 't2', testCode: 'BIO010', name: 'Glucose', price: 120, isOffered: false, department: { id: 'd2', name: 'Biochemistry', code: 'B' } },
];

function setup(opts: { perms?: boolean; confirm?: boolean; patchErr?: unknown; canWrite?: boolean; available?: boolean } = {}) {
  const api = {
    get: vi.fn((url: string) => of(url.startsWith('/api/tests') ? list : [])),
    patch: vi.fn(() => (opts.patchErr ? throwError(() => opts.patchErr) : of({}))),
  };
  const office = { create: vi.fn(async (name: string) => ({ id: 'f1', name })) };
  const sheets = { open: vi.fn(async () => true), available: vi.fn(() => opts.available ?? true) };
  const files = { canWrite: vi.fn(() => opts.canWrite ?? true) };
  const dialog = { confirm: vi.fn(async () => opts.confirm ?? true), alert: vi.fn(async () => undefined) };
  const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  const auth = { hasAnyPermission: vi.fn(() => opts.perms ?? true), activeBranchId: () => 'b1', user: () => ({ tenantName: 'Micro World' }) };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api }, { provide: OfficeService, useValue: office }, { provide: SheetEditorService, useValue: sheets },
      { provide: FilesAccessService, useValue: files }, { provide: DialogService, useValue: dialog }, { provide: ToastService, useValue: toast },
      { provide: AuthService, useValue: auth },
      { provide: TenantStateService, useValue: { tenant: signal({ branchIsolationEnabled: true }), ensureLoaded: vi.fn() } },
    ],
  });
  return { svc: TestBed.inject(SheetRoundtripService), ds: TestBed.inject(PricesSheetDataset), api, office, sheets, files, dialog, toast, auth };
}

/** The sheet as the person left it: CBC 250 → 300, Glucose switched on. */
async function editedBook(ds: PricesSheetDataset, scope: string): Promise<ArrayBuffer> {
  const { rows } = await ds.load(scope);
  const edited = rows.map(r => (r.code === 'HEM001' ? { ...r, price: 300 } : { ...r, offered: true }));
  return datasetBook(ds, scope, { rows: edited });
}

describe('SheetRoundtripService', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('Open in Neuron: builds the sheet, stores it in Files WITHOUT a patient-data flag, opens it in Neuron', async () => {
    const t = setup();
    expect(await t.svc.openInNeuron(PRICES_DATASET_ID, 'b1', 'Alwarpet', 'Test Master')).toBe(true);
    expect(t.api.get).toHaveBeenCalledWith('/api/tests/?branchId=b1&view=summary');
    const [name, bytes, kind, extra] = t.office.create.mock.calls[0] as unknown as [string, ArrayBuffer, string, unknown];
    expect(name).toMatch(/^Prices – Alwarpet – \d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(kind).toBe('sheet');
    expect(extra).toBeUndefined();              // no phiSource: price sheets are never patient data
    expect(new Uint8Array(bytes).slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]));
    expect(t.sheets.open).toHaveBeenCalledWith({ app: 'neuron', source: 'Test Master', fileId: 'f1' });
  });

  it('Open in Neuron is offered only with Files, Neuron write and the pricing permission', () => {
    expect(setup().svc.canOpen(PRICES_DATASET_ID)).toBe(true);
    expect(setup({ perms: false }).svc.canOpen(PRICES_DATASET_ID)).toBe(false);
    expect(setup({ canWrite: false }).svc.canOpen(PRICES_DATASET_ID)).toBe(false);
    expect(setup({ available: false }).svc.canOpen(PRICES_DATASET_ID)).toBe(false);
    expect(setup().svc.canOpen('nope')).toBe(false);
  });

  it('Send: review lists old → new, Apply PATCHes the grid batch endpoint with the file branch, then toasts', async () => {
    const t = setup();
    const bytes = await editedBook(t.ds, 'b2');
    expect(await t.svc.send({ dataset: PRICES_DATASET_ID, scope: 'b2', version: '1' }, bytes)).toBe(true);
    const req = (t.dialog.confirm.mock.calls[0] as unknown[])[0] as unknown as { message: string; items: string[]; confirmLabel: string };
    expect(req.message.split('. ')[0]).toBe('1 price changes · 1 test switched on');
    expect(req.items).toEqual(['Glucose (BIO010): Offered No → Yes', 'CBC (HEM001): Price (₹) ₹250 → ₹300']);
    expect(req.confirmLabel).toBe('Apply');
    expect(t.api.patch).toHaveBeenCalledWith(PRICE_BULK_PATH, { updates: [{ testId: 't2', isOffered: true }, { testId: 't1', price: 300 }], branchId: 'b2' });
    expect(t.toast.success).toHaveBeenCalledWith('Saved 2 changes in Prefrontal');
    expect(t.svc.applied()[PRICES_DATASET_ID]).toBe(1);
  });

  it('Cancel in the review applies nothing', async () => {
    const t = setup({ confirm: false });
    expect(await t.svc.send({ dataset: PRICES_DATASET_ID, scope: 'b2', version: '1' }, await editedBook(t.ds, 'b2'))).toBe(false);
    expect(t.api.patch).not.toHaveBeenCalled();
  });

  it('without the pricing permission nothing is read or applied', async () => {
    const t = setup({ perms: false });
    expect(await t.svc.send({ dataset: PRICES_DATASET_ID, scope: 'b2', version: '1' }, await editedBook(t.ds, 'b2'))).toBe(false);
    expect(t.dialog.confirm).not.toHaveBeenCalled();
    expect(t.api.patch).not.toHaveBeenCalled();
    expect(t.toast.error).toHaveBeenCalled();
  });

  it('only bad rows: an alert (no Apply), nothing is written', async () => {
    const t = setup();
    const bytes = buildBook({ sheetName: 'Prices', columns: ['Code', 'Test', 'Department', 'Type', 'Offered', 'Price (₹)'].map(h => ({ header: h, editable: true })),
      rows: [['HEM001', 'CBC', '', '', 'Yes', 'free'], ['NOPE', 'x', '', '', 'Yes', 5]], lists: [], marker: { dataset: PRICES_DATASET_ID, scope: '' } });
    expect(await t.svc.send({ dataset: PRICES_DATASET_ID, scope: '', version: '1' }, bytes)).toBe(false);
    const req = (t.dialog.alert.mock.calls[0] as unknown[])[0] as unknown as { message: string; items: string[] };
    expect(req.message).toContain('2 rows ignored');
    expect(req.items).toEqual(['Ignored · row 2 · CBC (HEM001): Price (₹) is not a number ("free")', 'Ignored · row 3 · NOPE: Code not found']);
    expect(t.api.patch).not.toHaveBeenCalled();
  });

  it('a server refusal is shown and nothing is counted as applied', async () => {
    const t = setup({ patchErr: { status: 403, error: { message: 'You do not have permission' } } });
    expect(await t.svc.send({ dataset: PRICES_DATASET_ID, scope: '', version: '1' }, await editedBook(t.ds, ''))).toBe(false);
    expect(t.api.get).toHaveBeenCalledWith('/api/tests/?view=summary');
    expect(t.api.patch).toHaveBeenCalledWith(PRICE_BULK_PATH, { updates: [{ testId: 't2', isOffered: true }, { testId: 't1', price: 300 }] });
    expect(t.toast.error).toHaveBeenCalled();
    expect(t.svc.applied()[PRICES_DATASET_ID]).toBeUndefined();
  });
});
