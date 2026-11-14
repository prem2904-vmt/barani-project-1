import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { DialogService } from '../../core/services/dialog.service';
import { SavedFile } from './neuron-bridge';
import { CONFLICT_TITLE, NeuronSaver, copyName } from './neuron-save';
import { OfficeConflictError, OfficeService } from './office.service';
import { ApiError } from '../../shared/models/api-response.model';

const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer as ArrayBuffer;
const file: SavedFile = { name: 'Budget.xlsx', bytes, kind: 'xlsx' };
const dto = (over: Record<string, unknown> = {}) => ({ id: 'f1', name: 'Budget.xlsx', kind: 'sheet', sizeBytes: 4, version: 2, updatedAt: '', updatedByName: null, ...over });

function make(action: string | null = null) {
  const office = { create: vi.fn(async () => dto({ id: 'new', version: 1 })), update: vi.fn(async () => dto({ version: 4 })) };
  const dialog = { actions: vi.fn(async (_req?: unknown) => ({ action: action as string | null, checked: false })) };
  TestBed.configureTestingModule({ providers: [{ provide: OfficeService, useValue: office }, { provide: DialogService, useValue: dialog }] });
  return { saver: TestBed.inject(NeuronSaver), office, dialog };
}

describe('Neuron save: POST when new, PUT with the version when stored', () => {
  it('a new sheet is POSTed under its current name', async () => {
    const { saver, office } = make();
    const out = await saver.store({ id: null, name: 'Untitled sheet.xlsx', version: null }, file);
    expect(office.create).toHaveBeenCalledWith('Untitled sheet.xlsx', bytes);
    expect(office.update).not.toHaveBeenCalled();
    expect(out).toMatchObject({ kind: 'saved', file: { id: 'new' } });
  });

  it('a stored sheet is PUT with its version (the If-Match source)', async () => {
    const { saver, office } = make();
    const out = await saver.store({ id: 'f1', name: 'Budget.xlsx', version: 3 }, file);
    expect(office.update).toHaveBeenCalledWith('f1', 'Budget.xlsx', bytes, 3);
    expect(office.create).not.toHaveBeenCalled();
    expect(out).toMatchObject({ kind: 'saved', file: { version: 4 } });
  });

  it('a server failure comes back as a plain message, never thrown', async () => {
    const { saver, office } = make();
    office.update.mockRejectedValueOnce(new ApiError('Something went wrong on our side. Try again in a moment.', undefined, undefined, undefined, 500));
    const out = await saver.store({ id: 'f1', name: 'Budget.xlsx', version: 3 }, file);
    expect(out).toEqual({ kind: 'failed', message: 'Something went wrong on our side. Try again in a moment.' });
  });
});

describe('Neuron save: the 409 flow never overwrites', () => {
  const cur = { id: 'f1', name: 'Budget.xlsx', version: 3 };

  it('asks with the two choices, and nothing is written until one is picked', async () => {
    const { saver, office, dialog } = make('reload');
    office.update.mockRejectedValueOnce(new OfficeConflictError());
    await saver.store(cur, file);
    const req = dialog.actions.mock.calls[0][0] as { title: string; actions: { label: string }[] };
    expect(req.title).toBe(CONFLICT_TITLE);
    expect(req.actions.map(a => a.label)).toEqual(['Reload their version', 'Save mine as a copy']);
    expect(office.update).toHaveBeenCalledTimes(1); // no retry
  });

  it('"Reload their version" asks the page to reload and writes nothing', async () => {
    const { saver, office } = make('reload');
    office.update.mockRejectedValueOnce(new OfficeConflictError());
    const out = await saver.store(cur, file);
    expect(out).toEqual({ kind: 'reload', file: cur });
    expect(office.create).not.toHaveBeenCalled();
    expect(office.update).toHaveBeenCalledTimes(1);
  });

  it('"Save mine as a copy" POSTs "<name> (copy).xlsx" as a NEW file', async () => {
    const { saver, office } = make('copy');
    office.update.mockRejectedValueOnce(new OfficeConflictError());
    const out = await saver.store(cur, file);
    expect(office.create).toHaveBeenCalledWith('Budget (copy).xlsx', bytes);
    expect(out.kind).toBe('copy');
    expect(office.update).toHaveBeenCalledTimes(1);
  });

  it('closing the dialog keeps the changes unsaved: no write at all', async () => {
    const { saver, office } = make(null);
    office.update.mockRejectedValueOnce(new OfficeConflictError());
    expect(await saver.store(cur, file)).toEqual({ kind: 'kept' });
    expect(office.create).not.toHaveBeenCalled();
  });

  it('a failure while saving the copy is reported, not thrown', async () => {
    const { saver, office } = make('copy');
    office.update.mockRejectedValueOnce(new OfficeConflictError());
    office.create.mockRejectedValueOnce(new ApiError('Request failed'));
    expect(await saver.store(cur, file)).toEqual({ kind: 'failed', message: 'Request failed' });
  });

  it('copy names', () => {
    expect(copyName('Budget.xlsx')).toBe('Budget (copy).xlsx');
    expect(copyName('Budget')).toBe('Budget (copy).xlsx');
    expect(copyName('')).toBe('Sheet (copy).xlsx');
  });
});
