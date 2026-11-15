import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { OFFICE_MESSAGES, OfficeConflictError, OfficeService, ifMatch, parseEtag } from './office.service';
import { ApiError } from '../../shared/models/api-response.model';

const PK = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9]).buffer as ArrayBuffer;
const dto = { id: 'f1', name: 'Budget.xlsx', kind: 'sheet', sizeBytes: 5, version: 3, updatedAt: '2026-11-14T05:00:00Z', updatedByName: 'Kavya Desk' };

function make() {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  return { svc: TestBed.inject(OfficeService), http: TestBed.inject(HttpTestingController) };
}
const enc = (o: unknown) => new Uint8Array(Array.from(new TextEncoder().encode(JSON.stringify(o)))).buffer as ArrayBuffer;

describe('OfficeService: stored files', () => {
  it('lists sheets (bare array or { success, data })', async () => {
    const { svc, http } = make();
    const p = svc.list('sheet');
    const req = http.expectOne(r => r.url.endsWith('/api/office/files?kind=sheet'));
    expect(req.request.method).toBe('GET');
    req.flush({ success: true, data: [dto] });
    expect(await p).toEqual([dto]);
    const p2 = svc.list();
    http.expectOne(r => r.url.includes('/api/office/files')).flush([dto]);
    expect(await p2).toEqual([dto]);
    http.verify();
  });

  it('POST sends multipart file + name + kind and returns the dto', async () => {
    const { svc, http } = make();
    const p = svc.create('Budget.xlsx', PK);
    const req = http.expectOne(r => r.url.endsWith('/api/office/files'));
    expect(req.request.method).toBe('POST');
    const fd = req.request.body as FormData;
    expect(fd).toBeInstanceOf(FormData);
    expect((fd.get('file') as File).name).toBe('Budget.xlsx');
    expect(fd.get('name')).toBe('Budget.xlsx');
    expect(fd.get('kind')).toBe('sheet');
    req.flush(dto);
    expect((await p).id).toBe('f1');
  });

  it('content() returns the bytes and the quoted ETag as the version', async () => {
    const { svc, http } = make();
    const p = svc.content('f1');
    const req = http.expectOne(r => r.url.endsWith('/api/office/files/f1/content'));
    expect(req.request.responseType).toBe('arraybuffer');
    req.flush(PK, { headers: { ETag: '"7"' } });
    const c = await p;
    expect(c.version).toBe('7');
    expect(c.bytes.byteLength).toBe(5);
    expect(parseEtag('W/"12"')).toBe('12');
    expect(parseEtag(null)).toBe('');
  });

  it('PUT carries If-Match: "<version>" and multipart bytes', async () => {
    const { svc, http } = make();
    const p = svc.update('f1', 'Budget.xlsx', PK, 3);
    const req = http.expectOne(r => r.url.endsWith('/api/office/files/f1/content'));
    expect(req.request.method).toBe('PUT');
    expect(req.request.headers.get('If-Match')).toBe('"3"');
    expect((req.request.body as FormData).get('file')).toBeTruthy();
    req.flush({ ...dto, version: 4 });
    expect((await p).version).toBe(4);
    expect(ifMatch('5')).toBe('"5"');
  });

  it('a 409 on PUT is a conflict (never retried, never forced)', async () => {
    const { svc, http } = make();
    const p = svc.update('f1', 'Budget.xlsx', PK, 3);
    http.expectOne(r => r.url.endsWith('/content')).flush({ success: false, error: 'version_conflict' }, { status: 409, statusText: 'Conflict' });
    await expect(p).rejects.toBeInstanceOf(OfficeConflictError);
    http.expectNone(r => r.method === 'PUT');
  });

  it('a 500 on PUT is a plain ApiError, not a conflict', async () => {
    const { svc, http } = make();
    const p = svc.update('f1', 'Budget.xlsx', PK, 3);
    http.expectOne(r => r.url.endsWith('/content')).flush('boom', { status: 500, statusText: 'Server Error' });
    const e = await p.catch(x => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).not.toBeInstanceOf(OfficeConflictError);
    expect((e as ApiError).message).toBe('Something went wrong on our side. Try again in a moment.');
  });

  it('rename PATCHes { name }; remove DELETEs', async () => {
    const { svc, http } = make();
    const p = svc.rename('f1', 'New.xlsx');
    const r1 = http.expectOne(r => r.url.endsWith('/api/office/files/f1'));
    expect(r1.request.method).toBe('PATCH');
    expect(r1.request.body).toEqual({ name: 'New.xlsx' });
    r1.flush({ ...dto, name: 'New.xlsx' });
    expect((await p).name).toBe('New.xlsx');
    const d = svc.remove('f1');
    const r2 = http.expectOne(r => r.url.endsWith('/api/office/files/f1'));
    expect(r2.request.method).toBe('DELETE');
    r2.flush(null);
    await d;
  });

  it('results workbook: query string, X-Truncated and the file name from Content-Disposition', async () => {
    const { svc, http } = make();
    const p = svc.resultsWorkbook({ testIds: ['b', 'a'], from: '2026-11-01', to: '2026-11-07', branchId: 'b1' });
    const req = http.expectOne(r => r.url.includes('/api/office/results-workbook?testIds=a,b&from=2026-11-01&to=2026-11-07&branchId=b1'));
    req.flush(PK, { headers: { 'X-Truncated': 'true', 'X-Row-Count': '5000', 'Content-Disposition': 'attachment; filename="Glucose.xlsx"' } });
    const r = await p;
    expect(r.truncated).toBe(true);
    expect(r.rowCount).toBe(5000);
    expect(r.fileName).toBe('Glucose.xlsx');
    const p2 = svc.resultsWorkbook({ testIds: ['a'], from: '2026-11-01', to: '2026-11-07' });
    http.expectOne(x => x.url.includes('results-workbook')).flush(PK);
    const r2 = await p2;
    expect(r2.truncated).toBe(false);
    expect(r2.fileName).toBeNull();
    expect(r2.rowCount).toBeNull();
  });

  it('a JSON error body that arrives as bytes keeps the server\'s words', async () => {
    const { svc, http } = make();
    const p = svc.resultsWorkbook({ testIds: ['a'], from: '2026-11-01', to: '2026-11-07' });
    http.expectOne(x => x.url.includes('results-workbook')).flush(enc({ success: false, error: 'too_wide', message: 'Pick a shorter date range.' }), { status: 400, statusText: 'Bad Request' });
    const e = await p.catch(x => x) as ApiError;
    expect(e.message).toBe('Pick a shorter date range.');
    expect(e.code).toBe('too_wide');
  });

  it('every server code from /api/office is worded in plain words, never the raw code', async () => {
    const codes: [string, number][] = [['bad_file', 400], ['bad_kind', 400], ['bad_name', 400], ['if_match_required', 400], ['bad_test_ids', 400], ['bad_range', 400],
      ['range_too_long', 400], ['bad_branch', 400], ['not_found', 404], ['file_missing', 410], ['storage_error', 424], ['storage_unconfigured', 503]];
    for (const [code, status] of codes) {
      TestBed.resetTestingModule();
      const { svc, http } = make();
      const p = svc.list();
      http.expectOne(r => r.url.includes('/api/office/files')).flush({ success: false, error: code, message: 'English from the server' }, { status, statusText: 'x' });
      const e = await p.catch(x => x) as ApiError;
      expect(e.message, code).toBe(OFFICE_MESSAGES[code]);
      expect(e.message).not.toContain('_');
      expect(e.code).toBe(code);
    }
  });

  it('an empty 404 (beta off) and a 403 get the app\'s plain status words', async () => {
    const { svc, http } = make();
    const p = svc.list();
    http.expectOne(r => r.url.includes('/api/office/files')).flush('', { status: 404, statusText: 'Not Found' });
    expect(((await p.catch(x => x)) as ApiError).message).toBe('That could not be found.');
    const p2 = svc.list();
    http.expectOne(r => r.url.includes('/api/office/files')).flush({ success: false, error: 'forbidden' }, { status: 403, statusText: 'Forbidden' });
    expect(((await p2.catch(x => x)) as ApiError).status).toBe(403);
  });

  it('a bare code with no words (server_error) is worded by HTTP status, never shown raw', async () => {
    const { svc, http } = make();
    const p = svc.list();
    http.expectOne(r => r.url.includes('/api/office/files')).flush({ success: false, error: 'server_error' }, { status: 500, statusText: 'x' });
    expect(((await p.catch(x => x)) as ApiError).message).toBe('Something went wrong on our side. Try again in a moment.');
  });
});

describe('OfficeService: Files shell calls', () => {
  it('lists every kind, or one, or the Trash', async () => {
    const { svc, http } = make();
    const a = svc.list(); http.expectOne(r => r.url.endsWith('/api/office/files')).flush([dto]); await a;
    const b = svc.list('doc'); http.expectOne(r => r.url.endsWith('/api/office/files?kind=doc')).flush([]); await b;
    const c = svc.list(undefined, true); http.expectOne(r => r.url.endsWith('/api/office/files?trash=true')).flush([]); await c;
    http.verify();
  });

  it('create sends the kind, the reason the file holds patient data and what it is a copy of', async () => {
    const { svc, http } = make();
    const p = svc.create('Results.xlsx', PK, 'sheet', { phiSource: 'results', copyOf: 'f9' });
    const req = http.expectOne(r => r.url.endsWith('/api/office/files'));
    const fd = req.request.body as FormData;
    expect(fd.get('phiSource')).toBe('results');
    expect(fd.get('copyOf')).toBe('f9');
    req.flush(dto);
    await p;
  });

  it('restore, phi, copy and device-export hit their endpoints', async () => {
    const { svc, http } = make();
    const r = svc.restore('f1'); const q = http.expectOne(x => x.url.endsWith('/api/office/files/f1/restore')); expect(q.request.method).toBe('POST'); q.flush(dto); await r;
    const m = svc.markPhi('f1', 'patient', 'Patient picked'); const q2 = http.expectOne(x => x.url.endsWith('/api/office/files/f1/phi'));
    expect(q2.request.body).toEqual({ source: 'patient', detail: 'Patient picked' }); q2.flush(dto); await m;
    const c = svc.copy('f1', 'Copy'); const q3 = http.expectOne(x => x.url.endsWith('/api/office/files/f1/copy')); expect(q3.request.body).toEqual({ name: 'Copy' }); q3.flush(dto); await c;
    const d = svc.deviceExport('f1', 'electron'); const q4 = http.expectOne(x => x.url.endsWith('/api/office/files/f1/device-export')); expect(q4.request.body).toEqual({ client: 'electron' }); q4.flush({ success: true, data: { allowed: true } }); await d;
    http.verify();
  });

  it('a refused device export keeps the server\'s plain words', async () => {
    const { svc, http } = make();
    const p = svc.deviceExport('f1', 'web');
    http.expectOne(x => x.url.endsWith('/device-export')).flush({ success: false, error: 'phi_export_denied', message: 'x' }, { status: 403, statusText: 'Forbidden' });
    await expect(p).rejects.toMatchObject({ code: 'phi_export_denied', message: "This file contains patient data, and your role can't save it to this device." });
  });

  it('a view-only lab\'s change is worded plainly', async () => {
    const { svc, http } = make();
    const p = svc.remove('f1');
    http.expectOne(x => x.method === 'DELETE').flush({ success: false, error: 'module_readonly', message: 'x' }, { status: 403, statusText: 'Forbidden' });
    await expect(p).rejects.toMatchObject({ message: 'Files are view only for your organization.' });
  });

  it('settings and storage unwrap the envelope', async () => {
    const { svc, http } = make();
    const a = svc.settings(); http.expectOne(x => x.url.endsWith('/api/office/settings')).flush({ success: true, data: { settings: { trashDays: 30 }, access: { full: true } } });
    expect((await a).access.full).toBe(true);
    const b = svc.saveSettings({ trashDays: 7 }); const q = http.expectOne(x => x.url.endsWith('/api/office/settings')); expect(q.request.method).toBe('PUT'); q.flush({ success: true, data: { settings: { trashDays: 7 }, access: {} } }); await b;
    const c = svc.storage(); http.expectOne(x => x.url.endsWith('/api/office/storage')).flush({ success: true, data: { totalBytes: 5, byKind: [], trashCount: 0, trashBytes: 0 } });
    expect((await c).totalBytes).toBe(5);
  });
});
