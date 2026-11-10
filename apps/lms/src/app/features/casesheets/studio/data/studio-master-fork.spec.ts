import { HttpClient, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { addPage, emptyDefinition } from '@prefrontal/forms-engine';
import { HttpStudioApi } from './http-studio-api';
import { MockStudioApi } from './mock-studio-api';
import { StudioApi } from './studio-api';
import { StudioSession } from './studio-session';

describe('masters and forks (mock rules)', () => {
  const def = () => addPage(emptyDefinition('ENT'), 'History').def;

  it('fork copies the master\'s published definition into the lab\'s own form with an open draft; the master never changes; a second Edit returns the same copy', async () => {
    const api = new MockStudioApi();
    const m = api.seed('ENT', def(), { publish: true, origin: 'master', departmentKey: 'ent' });
    const first = await api.fork(m);
    const copy = api.forms.get(first.id)!;
    expect(copy.origin).toBe('override');
    expect(copy.key).toBe(api.forms.get(m)!.key);
    expect(first.version.state).toBe('draft');
    expect(api.forms.get(m)!.versions).toHaveLength(1);
    const again = await api.fork(m);
    expect(again.id).toBe(first.id);
    expect(api.forms.size).toBe(2);
  });

  it('only a published master can be forked', async () => {
    const api = new MockStudioApi();
    const m = api.seed('ENT', def(), { origin: 'master' });
    await expect(api.fork(m)).rejects.toMatchObject({ code: 'not_published' });
    const local = api.seed('Mine', def(), { publish: true });
    await expect(api.fork(local)).rejects.toMatchObject({ code: 'not_master' });
  });

  it('a master opens read-only in the session: edits are ignored and no draft is started', async () => {
    TestBed.configureTestingModule({ providers: [StudioSession, { provide: StudioApi, useValue: new MockStudioApi() }] });
    const api = TestBed.inject(StudioApi) as MockStudioApi;
    const m = api.seed('ENT', def(), { publish: true, origin: 'master' });
    const s = TestBed.inject(StudioSession);
    await s.load(m);
    expect(s.readOnly()).toBe(true);
    const before = s.definition();
    s.apply(addPage(before!, 'More').def);
    expect(s.definition()).toBe(before);
    expect(s.canUndo()).toBe(false);
    expect(api.calls).not.toContain('startDraft');
    TestBed.resetTestingModule();
  });
});

describe('HttpStudioApi: the master / department contract', () => {
  function setup() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    return { api: TestBed.inject(HttpStudioApi), http: TestBed.inject(HttpTestingController), client: TestBed.inject(HttpClient) };
  }

  it('the root StudioApi is the HTTP one', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    expect(TestBed.inject(StudioApi)).toBeInstanceOf(HttpStudioApi);
  });

  it('reads origin, department and newerMaster from the list', async () => {
    const { api, http } = setup();
    const p = api.listForms('all');
    const req = http.expectOne((r) => r.url.endsWith('/api/casesheets/forms'));
    req.flush({ total: 3, items: [
      { id: 'a', key: 'ent', title: 'ENT', origin: 'master', departmentKey: 'ent', status: 'active' },
      { id: 'b', key: 'ent', title: 'ENT', origin: 'override', departmentKey: 'ent', newerMaster: true, status: 'active' },
      { id: 'c', key: 'x', title: 'X', specialty: 'ent', status: 'active' },
    ] });
    const rows = await p;
    expect(rows.map((r) => r.origin)).toEqual(['master', 'override', 'local']);
    expect(rows[1].newerMaster).toBe(true);
    expect(rows[2].departmentKey).toBe('ent'); // falls back to specialty
  });

  it('departments(): active ones, ordered', async () => {
    const { api, http } = setup();
    const p = api.departments();
    http.expectOne((r) => r.url.endsWith('/api/casesheets/departments')).flush([
      { key: 'b', name: 'B', sortOrder: 2, isActive: true }, { key: 'a', name: 'A', sortOrder: 1, isActive: true }, { key: 'z', name: 'Z', sortOrder: 0, isActive: false },
    ]);
    expect((await p).map((d) => d.key)).toEqual(['a', 'b']);
  });

  it('fork(): POST forms/{id}/fork', async () => {
    const { api, http } = setup();
    const p = api.fork('m1');
    const req = http.expectOne((r) => r.url.endsWith('/api/casesheets/forms/m1/fork'));
    expect(req.request.method).toBe('POST');
    req.flush({ id: 'c1', version: { id: 'v1', formId: 'c1', versionNo: 1, state: 'draft', rowVersion: 1 } });
    const r = await p;
    expect(r.id).toBe('c1');
    expect(r.version.state).toBe('draft');
  });
});
