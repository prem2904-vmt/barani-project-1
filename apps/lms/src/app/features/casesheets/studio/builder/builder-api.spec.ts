import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../../../environments/environment';
import { CaseSheetBuilderApi } from './builder-api';
import { BuilderError, builderWords, failsWords, summaryLine } from './builder-models';

const base = () => environment.apiUrl.replace(/\/+$/, '');
const CHECKS = {
  summary: { total: 2, passed: 1, failed: 1, coverage: { rules: 3, tested: 2 } },
  checks: [
    { id: 'c1', title: 'Cough opens a follow-up', source: 'auto', given: ['Chief complaint: Cough'], expect: ["'Duration of cough' shows"], result: { pass: true, failures: [] }, ranAt: '2026-11-11T10:00:00Z' },
    { id: 'c2', title: 'Two together', source: 'cortex', given: ['A', 'B'], expect: ['C shows'], result: { pass: false, failures: ["'C' did not show"] }, ranAt: null },
  ],
};

describe('CaseSheetBuilderApi', () => {
  let http: HttpTestingController;
  let svc: CaseSheetBuilderApi;
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    svc = TestBed.inject(CaseSheetBuilderApi);
  });
  afterEach(() => http.verify());

  it('GET builder/status maps the four flags', async () => {
    const p = svc.status();
    const r = http.expectOne(`${base()}/api/casesheets/builder/status`);
    expect(r.request.method).toBe('GET');
    r.flush({ cortex: true, connector: false, connectorSwitch: false, canChangeSwitch: true });
    expect(await p).toEqual({ cortex: true, connector: false, connectorSwitch: false, canChangeSwitch: true });
  });

  it('PUT builder/connector sends { enabled }', async () => {
    const p = svc.setConnector(true);
    const r = http.expectOne(`${base()}/api/casesheets/builder/connector`);
    expect(r.request.method).toBe('PUT');
    expect(r.request.body).toEqual({ enabled: true });
    r.flush({});
    await p;
  });

  it('POST forms/{id}/cortex sends message (+ conversationId) and maps steps, formChanged, draftVersion', async () => {
    const p = svc.cortex('f1', 'add cough', 'conv1');
    const r = http.expectOne(`${base()}/api/casesheets/forms/f1/cortex`);
    expect(r.request.method).toBe('POST');
    expect(r.request.body).toEqual({ message: 'add cough', conversationId: 'conv1' });
    r.flush({ conversationId: 'conv1', reply: 'Done.', steps: [{ tool: 'add_question', summary: "Added 'Cough'" }], formChanged: true, draftVersion: 4 });
    expect(await p).toEqual({ conversationId: 'conv1', reply: 'Done.', steps: [{ tool: 'add_question', summary: "Added 'Cough'" }], formChanged: true, draftVersion: 4 });
  });

  it('the first message has no conversationId', async () => {
    const p = svc.cortex('f1', 'hi');
    const r = http.expectOne(`${base()}/api/casesheets/forms/f1/cortex`);
    expect(r.request.body).toEqual({ message: 'hi' });
    r.flush({ conversationId: 'c', reply: 'Hello', steps: [], formChanged: false });
    expect((await p).draftVersion).toBeUndefined();
  });

  it.each([
    [403, 'feature_off', /switched off/],
    [424, 'cortex_unavailable', /isn't set up/],
    [429, 'cap_reached', /limit/],
  ])('%i %s becomes a BuilderError in plain words', async (status, code, words) => {
    const p = svc.cortex('f1', 'x');
    http.expectOne(`${base()}/api/casesheets/forms/f1/cortex`).flush({ code, detail: 'server wording' }, { status, statusText: 'x' });
    const e = await p.catch((x) => x);
    expect(e).toBeInstanceOf(BuilderError);
    expect(e.code).toBe(code);
    expect(e.status).toBe(status);
    expect(e.message).toMatch(words);
    expect(e.message).not.toMatch(/\bAI\b/);
  });

  it('GET checks, POST run, POST suggest and DELETE hit the contract paths and map CheckView', async () => {
    const g = svc.checks('f1');
    http.expectOne((r) => r.method === 'GET' && r.url === `${base()}/api/casesheets/forms/f1/checks`).flush(CHECKS);
    const got = await g;
    expect(got.summary).toEqual({ total: 2, passed: 1, failed: 1, coverage: { rules: 3, tested: 2 } });
    expect(got.checks[1]).toMatchObject({ id: 'c2', source: 'cortex', result: { pass: false, failures: ["'C' did not show"] }, ranAt: null });

    const r = svc.runChecks('f1');
    const rr = http.expectOne(`${base()}/api/casesheets/forms/f1/checks/run`);
    expect(rr.request.method).toBe('POST');
    rr.flush(CHECKS);
    expect((await r).checks).toHaveLength(2);

    const s = svc.suggestChecks('f1');
    const sr = http.expectOne(`${base()}/api/casesheets/forms/f1/checks/suggest`);
    expect(sr.request.method).toBe('POST');
    sr.flush(CHECKS);
    await s;

    const d = svc.removeCheck('f1', 'c2');
    const dr = http.expectOne(`${base()}/api/casesheets/forms/f1/checks/c2`);
    expect(dr.request.method).toBe('DELETE');
    dr.flush(null);
    await d;
  });

  it('a check never run has result null; an unknown source falls back to auto', async () => {
    const p = svc.checks('f1');
    http.expectOne((r) => r.url.endsWith('/checks')).flush({ summary: { total: 1, passed: 0, failed: 0, coverage: { rules: 0, tested: 0 } }, checks: [{ id: 'x', title: 'T', source: '??', given: [], expect: [], result: null, ranAt: null }] });
    const c = (await p).checks[0];
    expect(c.result).toBeNull();
    expect(c.source).toBe('auto');
  });

  it('offline (status 0) passes through and reads as words', async () => {
    const p = svc.checks('f1');
    http.expectOne((r) => r.url.endsWith('/checks')).error(new ProgressEvent('error'));
    const e = await p.catch((x) => x);
    expect(builderWords(e)).toMatch(/Can't reach/);
  });
});

describe('builder words', () => {
  it('summary line and fails words', () => {
    expect(summaryLine({ total: 12, passed: 11, failed: 1, coverage: { rules: 10, tested: 9 } })).toBe('12 checks · 11 pass · 1 fails · covers 9 of 10 rules');
    expect(summaryLine({ total: 1, passed: 1, failed: 0, coverage: { rules: 1, tested: 1 } })).toBe('1 check · 1 pass · covers 1 of 1 rule');
    expect(failsWords(1)).toBe('1 check fails');
    expect(failsWords(3)).toBe('3 checks fail');
  });
});
