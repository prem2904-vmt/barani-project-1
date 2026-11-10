import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CaseConflict, CaseFinal, FinishRefused, VoiceUnavailable } from './case-models';
import { HttpCasesApi } from './http-cases-api';
import { environment } from '../../../../../environments/environment';

const B = environment.apiUrl.replace(/\/+$/, '');

const wireSheet = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  state: 'draft',
  formId: 'f1',
  formTitle: 'ENT',
  formVersionId: 'v1',
  formVersionNo: 1,
  patient: { name: 'Asha', age: '42', sex: null, ref: null },
  answers: { side: 'left' },
  visitedPages: null,
  rowVersion: 3,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:01:00Z',
  finalisedAt: null,
  amendedFromId: null,
  hasPdf: false,
  source: 'human',
  ...over,
});

const problem = (status: number, body: Record<string, unknown>) => ({
  status,
  statusText: 'x',
  headers: { 'content-type': 'application/problem+json' },
});

describe('HttpCasesApi', () => {
  let api: HttpCasesApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), HttpCasesApi] });
    api = TestBed.inject(HttpCasesApi);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('reads every page of forms (a practice can have more than the API’s 100 per page)', async () => {
    const p = api.listForms();
    const row = (i: number) => ({ id: `f${i}`, key: `k${i}`, title: `Form ${i}`, specialty: 'ENT', published: { id: `v${i}`, versionNo: 1, publishedAt: 'x' } });
    const first = http.expectOne((r) => r.url === `${B}/api/casesheets/forms` && r.params.get('page') === '1');
    expect(first.request.params.get('pageSize')).toBe('100');
    first.flush({ total: 130, page: 1, pageSize: 100, items: Array.from({ length: 100 }, (_, i) => row(i)) });
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    const second = http.expectOne((r) => r.url === `${B}/api/casesheets/forms` && r.params.get('page') === '2');
    second.flush({ total: 130, page: 2, pageSize: 100, items: Array.from({ length: 30 }, (_, i) => row(100 + i)) });
    const all = await p;
    expect(all).toHaveLength(130);
    expect(all[129].title).toBe('Form 129');
  });

  it('lists published forms only', async () => {
    const p = api.listForms();
    const req = http.expectOne((r) => r.url === `${B}/api/casesheets/forms`);
    req.flush({
      items: [
        {
          id: 'f1',
          key: 'ent',
          title: 'ENT',
          specialty: 'ENT',
          published: { id: 'v1', versionNo: 2, publishedAt: 'x' },
        },
        { id: 'f2', key: 'draft', title: 'Draft only', specialty: null, published: null },
      ],
    });
    expect(await p).toEqual([
      {
        id: 'f1',
        key: 'ent',
        title: 'ENT',
        specialty: 'ENT',
        departmentKey: null,
        publishedVersionId: 'v1',
        versionNo: 2,
        publishedAt: 'x',
        pinned: false,
      },
    ]);
  });

  it('formVersion: the live one when it matches; else the version endpoint; a 403 falls back to the live one', async () => {
    const def = { pages: [] };
    const a = api.formVersion('f1', 'v1');
    http.expectOne(`${B}/api/casesheets/forms/f1/published`).flush({ id: 'v1', formId: 'f1', versionNo: 1, definition: def });
    expect(await a).toEqual(def);

    const b = api.formVersion('f1', 'old');
    http.expectOne(`${B}/api/casesheets/forms/f1/published`).flush({ id: 'v2', formId: 'f1', versionNo: 2, definition: def });
    await new Promise((r) => setTimeout(r, 0));
    http
      .expectOne(`${B}/api/casesheets/forms/f1/versions/old`)
      .flush({ code: 'forbidden' }, { status: 403, statusText: 'Forbidden' });
    expect(await b).toEqual(def);
  });

  it('maps a sheet, a list item and the narrative', async () => {
    const g = api.getCase('c1');
    http.expectOne(`${B}/api/casesheets/sheets/c1`).flush(wireSheet());
    const s = await g;
    expect(s.visitedPages).toEqual([]);
    expect(s.patient).toEqual({ name: 'Asha', age: '42', sex: null, ref: null });
    expect(s.rowVersion).toBe(3);

    const l = api.listCases({ state: 'draft', search: ' asha ', page: 2, pageSize: 10 });
    const req = http.expectOne((r) => r.url === `${B}/api/casesheets/sheets`);
    expect(req.request.params.get('state')).toBe('draft');
    expect(req.request.params.get('q')).toBe('asha');
    expect(req.request.params.get('page')).toBe('2');
    req.flush({
      items: [{ id: 'c1', state: 'final', formTitle: 'ENT', patientName: 'Asha', lastPage: 'p2', hasPdf: true }],
      page: 2,
      pageSize: 10,
      total: 11,
    });
    const page = await l;
    expect(page.total).toBe(11);
    expect(page.items[0]).toMatchObject({
      id: 'c1',
      state: 'final',
      patientName: 'Asha',
      lastPage: 'p2',
      hasPdf: true,
    });

    const n = api.narrative('c1');
    http.expectOne(`${B}/api/casesheets/sheets/c1/narrative`).flush({
      state: 'draft',
      rowVersion: 3,
      frozen: false,
      patientName: 'Asha',
      sections: [
        { id: 'b', key: 'b', title: 'B', order: 2, generated: 'g2', edited: 'mine', stale: true, content: 'mine' },
        { id: 'a', key: 'a', title: 'A', order: 1, generated: 'g1', edited: null, stale: false, content: 'g1' },
      ],
      warnings: [],
    });
    const nv = await n;
    expect(nv.sections.map((x) => x.id)).toEqual(['a', 'b']);
    expect(nv.sections[1]).toMatchObject({ edited: 'mine', stale: true, content: 'mine' });
    expect(nv.tables).toEqual([]);

    // Phase 5: grid tables under a section and at the top level (a section that wrote no words)
    const n2 = api.narrative('c1');
    const t = {
      fieldKey: 'teeth', label: 'Dental chart', order: 2, rowHeader: 'Tooth', headerGroups: [{ label: 'Findings', span: 1 }],
      columns: ['Status'], rows: [{ label: '18', labelSpan: 1, cells: [{ text: 'Caries', colSpan: 1 }] }],
    };
    http.expectOne(`${B}/api/casesheets/sheets/c1/narrative`).flush({
      state: 'draft', rowVersion: 4, sections: [{ id: 'a', key: 'a', title: 'A', order: 1, content: 'x', tables: [{ ...t, order: null }] }],
      tables: [t], warnings: [],
    });
    const nv2 = await n2;
    expect(nv2.sections[0].tables?.[0]).toMatchObject({ fieldKey: 'teeth', order: null, columns: ['Status'] });
    expect(nv2.tables?.[0]).toMatchObject({ fieldKey: 'teeth', order: 2, headerGroups: [{ label: 'Findings', span: 1 }] });
  });

  it('autosave is a PATCH with the body as given', async () => {
    const p = api.saveCase('c1', { rowVersion: 3, requestId: 'r1', answers: { side: 'right' }, remove: ['x'] });
    const req = http.expectOne(`${B}/api/casesheets/sheets/c1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ rowVersion: 3, requestId: 'r1', answers: { side: 'right' }, remove: ['x'] });
    req.flush({ id: 'c1', state: 'draft', rowVersion: 4, updatedAt: 't' });
    expect((await p).rowVersion).toBe(4);
  });

  it('section edit is a PUT; dropping it is a DELETE with ?rowVersion', async () => {
    const e = api.editSection('c1', 'hpi', 'my words', 4);
    const r1 = http.expectOne(`${B}/api/casesheets/sheets/c1/narrative/sections/hpi`);
    expect(r1.request.method).toBe('PUT');
    expect(r1.request.body).toEqual({ rowVersion: 4, text: 'my words' });
    r1.flush({ id: 'c1', state: 'draft', rowVersion: 5, updatedAt: 't' });
    await e;
    const c = api.clearSection('c1', 'hpi', 5);
    const r2 = http.expectOne((r) => r.url === `${B}/api/casesheets/sheets/c1/narrative/sections/hpi`);
    expect(r2.request.method).toBe('DELETE');
    expect(r2.request.params.get('rowVersion')).toBe('5');
    r2.flush({ id: 'c1', state: 'draft', rowVersion: 6, updatedAt: 't' });
    expect((await c).rowVersion).toBe(6);
  });

  it('409 version_conflict → CaseConflict with the server copy', async () => {
    const p = api.saveCase('c1', { rowVersion: 1, requestId: 'r' });
    http
      .expectOne(`${B}/api/casesheets/sheets/c1`)
      .flush({ code: 'version_conflict', current: wireSheet({ rowVersion: 9 }) }, problem(409, {}));
    const e = await p.catch((x) => x);
    expect(e).toBeInstanceOf(CaseConflict);
    expect((e as CaseConflict).current?.rowVersion).toBe(9);
  });

  it('409 sheet_final → CaseFinal; 422 incomplete → FinishRefused; 501 → VoiceUnavailable; others pass through', async () => {
    const a = api.saveCase('c1', { rowVersion: 1, requestId: 'r' });
    http.expectOne(`${B}/api/casesheets/sheets/c1`).flush({ code: 'sheet_final' }, problem(409, {}));
    expect(await a.catch((x) => x)).toBeInstanceOf(CaseFinal);

    const f = api.finishCase('c1', 3);
    const fr = http.expectOne(`${B}/api/casesheets/sheets/c1/finish`);
    expect(fr.request.body).toEqual({ rowVersion: 3 });
    fr.flush(
      {
        code: 'incomplete',
        missing: [{ page: 'patient', pageTitle: 'Patient', field: 'patient.name', label: 'Patient name' }],
      },
      problem(422, {}),
    );
    const fe = await f.catch((x) => x);
    expect(fe).toBeInstanceOf(FinishRefused);
    expect((fe as FinishRefused).missing[0].label).toBe('Patient name');

    const v = api.transcribe(new Blob(['x'], { type: 'audio/wav' }), { label: 'Notes' });
    http
      .expectOne((r) => r.url === `${B}/api/casesheets/voice/transcribe`)
      .flush({ code: 'voice_not_configured' }, problem(501, {}));
    expect(await v.catch((x) => x)).toBeInstanceOf(VoiceUnavailable);

    const o = api.getCase('c1');
    http.expectOne(`${B}/api/casesheets/sheets/c1`).flush({ code: 'not_found' }, problem(404, {}));
    const oe = await o.catch((x) => x);
    expect(oe).toBeInstanceOf(HttpErrorResponse);
    expect((oe as HttpErrorResponse).status).toBe(404);
  });

  it('voice: raw audio body with its type, label and duration in the query', async () => {
    const blob = new Blob(['RIFF'], { type: 'audio/wav' });
    const p = api.transcribe(blob, { label: 'Notes', specialty: 'ENT', durationMs: 1234.4 });
    const req = http.expectOne((r) => r.url === `${B}/api/casesheets/voice/transcribe`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBe(blob);
    expect(req.request.headers.get('Content-Type')).toBe('audio/wav');
    expect(req.request.params.get('label')).toBe('Notes');
    expect(req.request.params.get('specialty')).toBe('ENT');
    expect(req.request.params.get('durationMs')).toBe('1234');
    req.flush({ text: ' worse at night ' });
    expect(await p).toBe('worse at night');
  });

  it('voice config: GET /api/casesheets/voice → {enabled, maxSeconds}', async () => {
    const p = api.voiceConfig();
    http.expectOne(`${B}/api/casesheets/voice`).flush({ enabled: true, maxSeconds: 45 });
    expect(await p).toEqual({ enabled: true, maxSeconds: 45 });
  });

  it('practice settings: nulls ↔ empty strings, file links made absolute, pictures as raw bodies', async () => {
    const g = api.getPractice();
    http.expectOne(`${B}/api/casesheets/practice-settings`).flush({
      practiceName: null,
      doctorName: 'Dr Meera',
      enabled: true,
      logo: { url: '/api/casesheets/files/a?exp=1&sig=s', width: 10, height: 5 },
      signature: null,
    });
    const s = await g;
    expect(s.practiceName).toBe('');
    expect(s.logo?.url).toBe(`${B}/api/casesheets/files/a?exp=1&sig=s`);

    const put = api.savePractice({ ...s, practiceName: '  ', phone: '+91 1' });
    const pr = http.expectOne(`${B}/api/casesheets/practice-settings`);
    expect(pr.request.method).toBe('PUT');
    expect(pr.request.body).toMatchObject({
      practiceName: null,
      doctorName: 'Dr Meera',
      phone: '+91 1',
      enabled: true,
    });
    expect('logo' in pr.request.body).toBe(false);
    pr.flush({ doctorName: 'Dr Meera', enabled: true });
    await put;

    const png = new Blob(['x'], { type: 'image/png' });
    const up = api.uploadPracticeImage('signature', png);
    const ur = http.expectOne(`${B}/api/casesheets/practice-settings/signature`);
    expect(ur.request.method).toBe('PUT');
    expect(ur.request.body).toBe(png);
    expect(ur.request.headers.get('Content-Type')).toBe('image/png');
    ur.flush({ signature: { url: '/api/casesheets/files/s?exp=1&sig=s' } });
    expect((await up).signature?.url).toBe(`${B}/api/casesheets/files/s?exp=1&sig=s`);

    const rm = api.removePracticeImage('logo');
    http.expectOne(`${B}/api/casesheets/practice-settings/logo`).flush(null, { status: 204, statusText: 'No Content' });
    await new Promise((r) => setTimeout(r, 0));
    http.expectOne(`${B}/api/casesheets/practice-settings`).flush({ logo: null });
    expect((await rm).logo).toBeNull();
  });

  it('pdf as a blob; pdf-link made absolute; narrative preview mapped', async () => {
    const p = api.casePdf('c1');
    const pr = http.expectOne(`${B}/api/casesheets/sheets/c1/pdf`);
    expect(pr.request.responseType).toBe('blob');
    pr.flush(new Blob(['%PDF'], { type: 'application/pdf' }));
    expect((await p).type).toBe('application/pdf');

    const l = api.pdfLink('c1');
    http.expectOne(`${B}/api/casesheets/sheets/c1/pdf-link`).flush({ url: '/api/casesheets/files/p?exp=1&sig=s', expiresAt: 'x' });
    expect((await l).url).toBe(`${B}/api/casesheets/files/p?exp=1&sig=s`);

    const n = api.narrativePreview('v1', { a: 1 }, ['p1']);
    const nr = http.expectOne(`${B}/api/casesheets/narrative/preview`);
    expect(nr.request.body).toEqual({ formVersionId: 'v1', answers: { a: 1 }, visitedPages: ['p1'] });
    nr.flush({ sections: [{ key: 'hpi', title: 'HPI', order: 1, content: 'Text.' }], warnings: [] });
    expect((await n).sections[0]).toEqual({
      id: 'hpi',
      key: 'hpi',
      title: 'HPI',
      order: 1,
      generated: 'Text.',
      edited: null,
      stale: false,
      content: 'Text.',
      own: false,
      formTitle: null,
      tables: [],
    });
  });

  it('create sends formId + patient; amend and delete hit their endpoints', async () => {
    const c = api.createCase('f1', { name: 'Asha' });
    const cr = http.expectOne(`${B}/api/casesheets/sheets`);
    expect(cr.request.method).toBe('POST');
    expect(cr.request.body).toEqual({ formId: 'f1', patient: { name: 'Asha' } });
    cr.flush(wireSheet());
    expect((await c).id).toBe('c1');

    const a = api.amendCase('c1');
    http.expectOne(`${B}/api/casesheets/sheets/c1/amend`).flush(wireSheet({ id: 'c2', amendedFromId: 'c1' }));
    expect((await a).amendedFromId).toBe('c1');

    const d = api.deleteCase('c1');
    const dr = http.expectOne(`${B}/api/casesheets/sheets/c1`);
    expect(dr.request.method).toBe('DELETE');
    dr.flush(null, { status: 204, statusText: 'No Content' });
    await d;
  });

  // ---------------- Prefrontal additions (departments, the LMS patient link) ----------------

  it('forms carry the master department (key + name); departments come in their order, inactive ones dropped', async () => {
    const p = api.listForms();
    http.expectOne((r) => r.url === `${B}/api/casesheets/forms`).flush({
      items: [{ id: 'f1', key: 'ent', title: 'ENT', specialty: null, departmentKey: 'ent', departmentName: 'ENT clinic', published: { id: 'v1' } }],
    });
    expect((await p)[0]).toMatchObject({ specialty: 'ENT clinic', departmentKey: 'ent' });

    const d = api.listDepartments();
    http.expectOne(`${B}/api/casesheets/departments`).flush({
      items: [
        { key: 'ortho', name: 'Orthopaedics', sortOrder: 2 },
        { key: 'ent', name: 'ENT', sortOrder: 1 },
        { key: 'old', name: 'Old', sortOrder: 0, isActive: false },
      ],
    });
    expect(await d).toEqual([
      { key: 'ent', name: 'ENT', sortOrder: 1 },
      { key: 'ortho', name: 'Orthopaedics', sortOrder: 2 },
    ]);
  });

  it('a lab sheet starts from the LMS patient (patientId + context) and lists filter by patient', async () => {
    const c = api.createCase('f1', { name: 'Asha', age: '42 years', sex: 'F', ref: 'MRN-1' }, { patientId: 'p1' });
    const req = http.expectOne(`${B}/api/casesheets/sheets`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      formId: 'f1',
      patient: { name: 'Asha', age: '42 years', sex: 'F', ref: 'MRN-1' },
      patientId: 'p1',
      contextKind: 'patient',
      contextId: null,
    });
    req.flush(wireSheet({ patientId: 'p1' }));
    expect((await c).patientId).toBe('p1');

    const pub = api.createCase('f1');
    const r2 = http.expectOne(`${B}/api/casesheets/sheets`);
    expect(r2.request.body).toEqual({ formId: 'f1', patient: null });
    r2.flush(wireSheet());
    expect((await pub).patientId).toBeNull();

    const l = api.listCases({ patientId: 'p1', pageSize: 5 });
    const r3 = http.expectOne((r) => r.url === `${B}/api/casesheets/sheets`);
    expect(r3.request.params.get('patientId')).toBe('p1');
    r3.flush({ items: [{ id: 'c1', patientId: 'p1' }], total: 1 });
    expect((await l).items[0].patientId).toBe('p1');
  });
});
