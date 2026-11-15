import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { DialogService } from '../../core/services/dialog.service';
import { SavedFile } from './files-bridge';
import { CONFLICT_TITLE, FilesSaver, copyName } from './files-save';
import { OfficeConflictError, OfficeService } from './office.service';
import { FILES_APPS } from './files-registry';
import { ApiError } from '../../shared/models/api-response.model';

const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer as ArrayBuffer;
const file: SavedFile = { name: 'Budget.xlsx', bytes, kind: 'file' };
const dto = (over: Record<string, unknown> = {}) => ({ id: 'f1', name: 'Budget.xlsx', kind: 'sheet', sizeBytes: 4, version: 2, updatedAt: '', updatedByName: null, ...over });

function make(action: string | null = null) {
  const office = { create: vi.fn(async () => dto({ id: 'new', version: 1 })), update: vi.fn(async () => dto({ version: 4 })) };
  const dialog = { actions: vi.fn(async (_req?: unknown) => ({ action: action as string | null, checked: false })) };
  TestBed.configureTestingModule({ providers: [{ provide: OfficeService, useValue: office }, { provide: DialogService, useValue: dialog }] });
  return { saver: TestBed.inject(FilesSaver), office, dialog };
}

describe('Neuron save: POST when new, PUT with the version when stored', () => {
  it('a new sheet is POSTed under its current name', async () => {
    const { saver, office } = make();
    const out = await saver.store({ id: null, name: 'Untitled sheet.xlsx', version: null }, file, FILES_APPS[0]);
    expect(office.create).toHaveBeenCalledWith('Untitled sheet.xlsx', bytes, 'sheet', { phiSource: undefined, copyOf: undefined });
    expect(office.update).not.toHaveBeenCalled();
    expect(out).toMatchObject({ kind: 'saved', file: { id: 'new' } });
  });

  it('a stored sheet is PUT with its version (the If-Match source)', async () => {
    const { saver, office } = make();
    const out = await saver.store({ id: 'f1', name: 'Budget.xlsx', version: 3 }, file, FILES_APPS[0]);
    expect(office.update).toHaveBeenCalledWith('f1', 'Budget.xlsx', bytes, 3);
    expect(office.create).not.toHaveBeenCalled();
    expect(out).toMatchObject({ kind: 'saved', file: { version: 4 } });
  });

  it('a server failure comes back as a plain message, never thrown', async () => {
    const { saver, office } = make();
    office.update.mockRejectedValueOnce(new ApiError('Something went wrong on our side. Try again in a moment.', undefined, undefined, undefined, 500));
    const out = await saver.store({ id: 'f1', name: 'Budget.xlsx', version: 3 }, file, FILES_APPS[0]);
    expect(out).toEqual({ kind: 'failed', message: 'Something went wrong on our side. Try again in a moment.' });
  });
});

describe('Neuron save: the 409 flow never overwrites', () => {
  const cur = { id: 'f1', name: 'Budget.xlsx', version: 3 };

  it('asks with the two choices, and nothing is written until one is picked', async () => {
    const { saver, office, dialog } = make('reload');
    office.update.mockRejectedValueOnce(new OfficeConflictError());
    await saver.store(cur, file, FILES_APPS[0]);
    const req = dialog.actions.mock.calls[0][0] as { title: string; actions: { label: string }[] };
    expect(req.title).toBe(CONFLICT_TITLE);
    expect(req.actions.map(a => a.label)).toEqual(['Reload their version', 'Save mine as a copy']);
    expect(office.update).toHaveBeenCalledTimes(1); // no retry
  });

  it('"Reload their version" asks the page to reload and writes nothing', async () => {
    const { saver, office } = make('reload');
    office.update.mockRejectedValueOnce(new OfficeConflictError());
    const out = await saver.store(cur, file, FILES_APPS[0]);
    expect(out).toEqual({ kind: 'reload', file: cur });
    expect(office.create).not.toHaveBeenCalled();
    expect(office.update).toHaveBeenCalledTimes(1);
  });

  it('"Save mine as a copy" POSTs "<name> (copy).xlsx" as a NEW file', async () => {
    const { saver, office } = make('copy');
    office.update.mockRejectedValueOnce(new OfficeConflictError());
    const out = await saver.store(cur, file, FILES_APPS[0]);
    expect(office.create).toHaveBeenCalledWith('Budget (copy).xlsx', bytes, 'sheet', { copyOf: 'f1' });   // the copy of a flagged file is flagged by the server
    expect(out.kind).toBe('copy');
    expect(office.update).toHaveBeenCalledTimes(1);
  });

  it('closing the dialog keeps the changes unsaved: no write at all', async () => {
    const { saver, office } = make(null);
    office.update.mockRejectedValueOnce(new OfficeConflictError());
    expect(await saver.store(cur, file, FILES_APPS[0])).toEqual({ kind: 'kept' });
    expect(office.create).not.toHaveBeenCalled();
  });

  it('a failure while saving the copy is reported, not thrown', async () => {
    const { saver, office } = make('copy');
    office.update.mockRejectedValueOnce(new OfficeConflictError());
    office.create.mockRejectedValueOnce(new ApiError('Request failed'));
    expect(await saver.store(cur, file, FILES_APPS[0])).toEqual({ kind: 'failed', message: 'Request failed' });
  });

  it('copy names', () => {
    expect(copyName('Budget.xlsx')).toBe('Budget (copy).xlsx');
    expect(copyName('Budget')).toBe('Budget (copy).xlsx');
    expect(copyName('')).toBe('File (copy).xlsx');
    expect(copyName('Photo.jpg', 'png')).toBe('Photo (copy).jpg');
    expect(copyName('Letter', 'docx')).toBe('Letter (copy).docx');
  });
});

describe('Files save: other apps and the patient-data flag', () => {
  it('a new file of another app is created with ITS kind and extension', async () => {
    const { saver, office } = make();
    await saver.store({ id: null, name: 'Letter', version: null }, { ...file, name: 'Letter' }, FILES_APPS[1]);
    expect(office.create).toHaveBeenCalledWith('Letter.docx', bytes, 'doc', { phiSource: undefined, copyOf: undefined });
  });

  it('the first save of a file Prefrontal filled with results carries the reason, so the server flags it', async () => {
    const { saver, office } = make();
    await saver.store({ id: null, name: 'Results.xlsx', version: null }, file, FILES_APPS[0], 'results');
    expect(office.create).toHaveBeenCalledWith('Results.xlsx', bytes, 'sheet', { phiSource: 'results', copyOf: undefined });
  });

  it('a file made from a stored one (lab template, Save as) names it, so a flagged original flags the copy', async () => {
    const { saver, office } = make();
    await saver.store({ id: null, name: 'Our letter.docx', version: null, copyOf: 'tpl-1' }, file, FILES_APPS[1]);
    expect(office.create).toHaveBeenCalledWith('Our letter.docx', bytes, 'doc', { phiSource: undefined, copyOf: 'tpl-1' });
  });

  it('a saved PUT never sends the flag (it is sticky on the server and set once)', async () => {
    const { saver, office } = make();
    await saver.store({ id: 'f1', name: 'Budget.xlsx', version: 3 }, file, FILES_APPS[0], 'results');
    expect(office.update).toHaveBeenCalledWith('f1', 'Budget.xlsx', bytes, 3);
  });
});
