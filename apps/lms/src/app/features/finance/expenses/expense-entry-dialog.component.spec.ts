import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ExpenseEntryDialogComponent } from './expense-entry-dialog.component';
import { ExpenseService } from '../../../core/services/expense.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ExpenseEntry } from '../../../shared/models/expense.model';
import { ApiError } from '../../../shared/models/api-response.model';
import { BusyDirective } from '../../../shared/directives/busy.directive';

/**
 * Add / edit expense — the phone-first quick add: amount, date (never before
 * the closed-through day), item, category (expenses only), mode, paid to,
 * notes, bills ("Take photo" = rear camera, "Attach files" = several images /
 * PDFs). Save creates the entry THEN uploads the picked bills; one primary;
 * Delete (edit mode) confirms through DialogService.
 */
const saved = (over: Partial<ExpenseEntry> = {}): ExpenseEntry => ({
  id: 'e1', date: '2026-09-30', kind: 'expense', description: 'Toner', categoryId: 'c1', categoryName: 'Stationery', amount: 120.5,
  paymentMode: 'upi', paidTo: null, notes: null, branchName: 'Salem', createdBy: 'me', createdByName: 'Me', createdAt: '2026-09-30T05:00:00Z',
  canEdit: true, attachments: [], ...over,
});

describe('ExpenseEntryDialogComponent', () => {
  let svc: Record<string, ReturnType<typeof vi.fn>>;
  let dialogs: { confirm: ReturnType<typeof vi.fn> };

  async function render(inputs: Record<string, unknown> = {}) {
    svc = {
      create: vi.fn(() => of(saved())),
      update: vi.fn(() => of(saved())),
      remove: vi.fn(() => of(undefined)),
      attach: vi.fn(async () => []),
      removeAttachment: vi.fn(() => of(undefined)),
      createCategory: vi.fn((name: string) => of({ id: 'c9', name, isDefault: false, isActive: true, sortOrder: 9 })),
    };
    dialogs = { confirm: vi.fn(async () => true) };
    TestBed.configureTestingModule({
      imports: [ExpenseEntryDialogComponent],
      providers: [
        { provide: ExpenseService, useValue: svc },
        { provide: DialogService, useValue: dialogs },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      ],
    });
    TestBed.overrideComponent(ExpenseEntryDialogComponent, { set: { imports: [BusyDirective], schemas: [CUSTOM_ELEMENTS_SCHEMA] } });
    const f = TestBed.createComponent(ExpenseEntryDialogComponent);
    f.componentRef.setInput('today', '2026-09-30');
    f.componentRef.setInput('categories', [
      { id: 'c1', name: 'Stationery', isDefault: true, isActive: true, sortOrder: 1 },
      { id: 'c2', name: 'Old', isDefault: false, isActive: false, sortOrder: 2 },
    ]);
    for (const [k, v] of Object.entries(inputs)) f.componentRef.setInput(k, v);
    const c = f.componentInstance as any;
    c.init();
    f.detectChanges();
    return { f, c, el: document.body as HTMLElement };
  }

  afterEach(() => { TestBed.resetTestingModule(); document.body.innerHTML = ''; });

  it('offers the camera and multi-file pickers, one primary, no native select / date', async () => {
    const { el } = await render();
    const inputs = [...el.querySelectorAll('.pf-xd input[type="file"]')] as HTMLInputElement[];
    expect(inputs.length).toBe(2);
    expect(inputs[0].getAttribute('capture')).toBe('environment');
    expect(inputs[0].accept).toBe('image/*');
    expect(inputs[1].multiple).toBe(true);
    expect(inputs[1].accept).toContain('application/pdf');
    expect(el.querySelectorAll('.pf-xd .pf-btn--primary').length).toBe(1);
    expect(el.querySelectorAll('.pf-xd select, .pf-xd datalist, .pf-xd input[type="date"]').length).toBe(0);
    expect((el.querySelector('#pf-xd-amount') as HTMLInputElement).getAttribute('inputmode')).toBe('decimal');
  });

  it('Save needs amount, item, date and (for an expense) a category; cash-in needs no category', async () => {
    const { f, c, el } = await render();
    expect(c.canSave()).toBe(false);
    c.amountText.set('120.50'); c.description.set('Toner');
    expect(c.canSave()).toBe(false);
    c.categoryId.set('c1');
    expect(c.canSave()).toBe(true);
    c.amountText.set('1.005');
    expect(c.canSave()).toBe(false);
    c.amountText.set('500'); c.kind.set('cash_in'); c.categoryId.set('');
    f.detectChanges();
    expect(c.canSave()).toBe(true);
    expect(el.querySelector('#pf-xd-cat')).toBeNull();
    // A switched-off category isn't offered for a new entry.
    expect(c.categoryOptions().map((o: any) => o.value)).toEqual(['c1']);
    // Dates on/before the closed-through day are out of range.
    f.componentRef.setInput('closedThrough', '2026-09-28');
    expect(c.minDate()).toBe('2026-09-29');
  });

  it('creates the entry, then uploads the picked bills, then tells the host', async () => {
    const { c } = await render();
    const changed = vi.fn(); const closed = vi.fn();
    c.changed.subscribe(changed); c.closed.subscribe(closed);
    c.amountText.set('₹1,250'); c.description.set(' Toner '); c.categoryId.set('c1'); c.mode.set('upi'); c.paidTo.set('Ravi');
    const file = new File(['x'], 'bill.jpg', { type: 'image/jpeg' });
    (URL as any).createObjectURL = vi.fn(() => 'blob:preview');
    (URL as any).revokeObjectURL = vi.fn();
    c.onFiles({ target: { files: [file], value: '' } } as any);
    expect(c.pending().length).toBe(1);
    await c.save();
    expect(svc['create']).toHaveBeenCalledWith({
      date: '2026-09-30', kind: 'expense', description: 'Toner', categoryId: 'c1', amount: 1250, paymentMode: 'upi', paidTo: 'Ravi', notes: null,
    });
    expect(svc['attach']).toHaveBeenCalledWith('e1', [file]);
    expect(changed).toHaveBeenCalled();
    expect(closed).toHaveBeenCalled();
  });

  it('refuses a non-bill file type and keeps a server error on the form', async () => {
    const { c } = await render();
    c.onFiles({ target: { files: [new File(['x'], 'a.exe', { type: 'application/x-msdownload' })], value: '' } } as any);
    expect(c.pending().length).toBe(0);
    svc['create'].mockReturnValueOnce(throwError(() => new ApiError('The books are closed through 29 Sep 2026.', 'day_closed')));
    c.amountText.set('10'); c.description.set('x'); c.categoryId.set('c1');
    await c.save();
    expect(c.error()).toContain('closed');
  });

  it('edit mode: seeds the form, updates, Delete confirms first', async () => {
    const { c, el } = await render({ entry: saved({ amount: 99, paidTo: 'Shop' }) });
    expect(c.amountText()).toBe('99');
    expect(c.paidTo()).toBe('Shop');
    expect(el.querySelector('.pf-xd .pf-btn--danger')?.textContent).toContain('Delete');
    c.amountText.set('100');
    await c.save();
    expect(svc['update']).toHaveBeenCalledWith('e1', expect.objectContaining({ amount: 100 }));
    await c.remove();
    expect(dialogs.confirm).toHaveBeenCalled();
    expect(svc['remove']).toHaveBeenCalledWith('e1');
  });

  it('an admin can create a category inline from the picker', async () => {
    const { c } = await render({ isAdmin: true });
    await c.pickCategory('Generator diesel');
    expect(svc['createCategory']).toHaveBeenCalledWith('Generator diesel');
    expect(c.categoryId()).toBe('c9');
  });
});
