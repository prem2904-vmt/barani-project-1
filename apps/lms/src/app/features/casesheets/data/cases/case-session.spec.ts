import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { CASE_CACHE, MemoryCaseCache } from './case-cache';
import { CaseConflict, FinishRefused } from './case-models';
import { CaseSession, SESSION_TIMING, mergePatient, normaliseVisited, patientFromAnswers } from './case-session';
import { CasesApi } from './cases-api';
import { MockCasesApi } from './mock-cases-api';
import { ENT_ANSWERS, ENT_SAMPLE } from '@prefrontal/forms-engine/testing';

const DEBOUNCE = 800;

function setup(cache = new MemoryCaseCache(), api = new MockCasesApi()) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      CaseSession,
      { provide: CasesApi, useValue: api },
      { provide: CASE_CACHE, useValue: cache },
      {
        provide: SESSION_TIMING,
        useValue: { debounceMs: DEBOUNCE, narrativeDebounceMs: 50, backoff: (n: number) => 1000 * 2 ** n },
      },
    ],
  });
  return { session: TestBed.inject(CaseSession), api, cache };
}

const saves = (api: MockCasesApi) =>
  api.calls.filter((c) => c.op === 'saveCase').map((c) => c.args[1] as Record<string, unknown>);
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe('CaseSession (autosave)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  async function opened() {
    const ctx = setup();
    const c = await ctx.api.createCase('form-ent');
    await ctx.session.open(c.id);
    await tick(100);
    return { ...ctx, id: c.id };
  }

  it('opens a sheet with its definition, saved, and loads the narrative', async () => {
    const { session, api } = await opened();
    expect(session.definition()?.title).toBe(ENT_SAMPLE.title);
    expect(session.saveState()).toBe('saved');
    expect(session.saveText()).toBe('Saved');
    expect(api.calls.some((c) => c.op === 'narrative')).toBe(true);
    expect(session.narrativeState()).toBe('idle');
  });

  it('typing is coalesced into ONE patch of only what changed, 800 ms after the last tap', async () => {
    const { session, api } = await opened();
    session.setAnswers({ patientName: 'A' });
    await tick(300);
    session.setAnswers({ patientName: 'As' });
    await tick(300);
    session.setAnswers({ patientName: 'Asha', age: 42 });
    expect(session.saveState()).toBe('pending');
    expect(session.saveText()).toBe('Saving…');
    await tick(DEBOUNCE - 1);
    expect(saves(api)).toHaveLength(0);
    await tick(10);
    expect(saves(api)).toHaveLength(1);
    expect(saves(api)[0]['answers']).toEqual({ patientName: 'Asha', age: 42 });
    expect(saves(api)[0]['patient']).toEqual({ name: 'Asha', age: '42' });
    expect(saves(api)[0]['requestId']).toBeTruthy();
    expect(session.saveState()).toBe('saved');
    expect(session.lastSavedAt()).not.toBeNull();

    session.setAnswers({ age: 43 });
    await tick(DEBOUNCE + 10);
    const second = saves(api)[1];
    expect(second['answers']).toEqual({ age: 43 });
    expect(second['remove']).toEqual(['patientName']);
    expect(second['rowVersion']).toBe(2);
  });

  it('never sends keys the form does not have; visited pages ride along as page keys', async () => {
    const { session, api } = await opened();
    session.setVisited(['patient_info', 'timeline', 'patient_info', 'pregnancy#x#0']);
    session.setAnswers({ patientName: 'Asha', stray: 1 });
    await tick(DEBOUNCE + 10);
    expect(saves(api)[0]['answers']).toEqual({ patientName: 'Asha' });
    expect(saves(api)[0]['visitedPages']).toEqual(['timeline', 'patient_info']);
  });

  it('offline: says so, keeps the same requestId, retries with backoff and at once when back online', async () => {
    const { session, api } = await opened();
    api.offline = true;
    session.setAnswers({ patientName: 'Asha' });
    await tick(DEBOUNCE + 10);
    expect(session.saveState()).toBe('offline');
    expect(session.saveText()).toBe('Offline — saved on this tablet');
    await tick(1000);
    expect(saves(api)).toHaveLength(2);
    expect(saves(api)[1]['requestId']).toBe(saves(api)[0]['requestId']);
    api.offline = false;
    window.dispatchEvent(new Event('online'));
    await tick(10);
    expect(saves(api)).toHaveLength(3);
    expect(saves(api)[2]['requestId']).toBe(saves(api)[0]['requestId']);
    expect(session.saveState()).toBe('saved');
    expect((await api.getCase(session.sheet()!.id)).answers).toEqual({ patientName: 'Asha' });
  });

  it('a 5xx is "can\'t reach" + retry, not a sign-out or a lost answer', async () => {
    const api = new MockCasesApi();
    const { session } = setup(new MemoryCaseCache(), api);
    const c = await api.createCase('form-ent');
    await session.open(c.id);
    const real = api.saveCase.bind(api);
    let fail = 1;
    vi.spyOn(api, 'saveCase').mockImplementation(async (id, body) => {
      if (fail-- > 0) throw new HttpErrorResponse({ status: 500 });
      return real(id, body);
    });
    session.setAnswers({ age: 5 });
    await tick(DEBOUNCE + 10);
    expect(session.saveState()).toBe('error');
    await tick(1000);
    expect(session.saveState()).toBe('saved');
  });

  it('409: stops saving until the doctor picks; "use theirs" takes the other copy', async () => {
    const { session, api, id } = await opened();
    await api.saveCase(id, { rowVersion: 1, requestId: 'other', answers: { patientName: 'From the other tablet' } });
    session.setAnswers({ patientName: 'Mine' });
    await tick(DEBOUNCE + 10);
    expect(session.saveState()).toBe('conflict');
    expect(session.conflict()?.answers).toEqual({ normalSinceUnit: 'months', patientName: 'From the other tablet' });
    session.setAnswers({ patientName: 'Mine again' });
    await tick(DEBOUNCE * 3);
    expect(saves(api).filter((s) => s['requestId'] !== 'other')).toHaveLength(1);
    await expect(session.flush()).rejects.toBeInstanceOf(CaseConflict);

    await session.resolveConflict('theirs');
    expect(session.answers()).toEqual({ normalSinceUnit: 'months', patientName: 'From the other tablet' });
    expect(session.saveState()).toBe('saved');
    expect(session.conflict()).toBeNull();
  });

  it('409 "keep mine": the full local answers go out on top of the server version', async () => {
    const { session, api, id } = await opened();
    await api.saveCase(id, { rowVersion: 1, requestId: 'other', answers: { patientName: 'Theirs', religion: 'x' } });
    session.setAnswers({ patientName: 'Mine', age: 9 });
    await tick(DEBOUNCE + 10);
    expect(session.saveState()).toBe('conflict');
    await session.resolveConflict('mine');
    await tick(10);
    const last = saves(api).at(-1)!;
    expect(last['rowVersion']).toBe(2);
    expect(last['answers']).toEqual({ patientName: 'Mine', age: 9 });
    expect([...(last['remove'] as string[])].sort()).toEqual(['normalSinceUnit', 'religion']); // the default was replaced by "mine" too
    expect(session.saveState()).toBe('saved');
    expect((await api.getCase(id)).answers).toEqual({ patientName: 'Mine', age: 9 });
  });

  it('section edits wait behind a save and carry the new row version; the narrative refreshes', async () => {
    const { session, api } = await opened();
    session.setAnswers({ patientName: 'Asha' });
    const sectionId = 'patient_info';
    const edit = session.editSection(sectionId, 'My own words.');
    await tick(10);
    const ack = await edit;
    const ops = api.calls.map((c) => c.op).filter((o) => o === 'saveCase' || o === 'editSection');
    expect(ops).toEqual(['saveCase', 'editSection']);
    expect(api.calls.find((c) => c.op === 'editSection')!.args[3]).toBe(2);
    expect(ack.rowVersion).toBe(3);
    await tick(100);
    expect(session.narrative()?.sections[0].content).toBe('My own words.');
    await session.clearSection(sectionId);
    await tick(100);
    expect(session.narrative()?.sections[0].edited).toBeNull();
  });

  it('finish: saves first, then finishes; refusals pass through; then the sheet is final', async () => {
    const { session } = await opened();
    session.setAnswers({ age: 3 });
    const refused = await session.finish().catch((e) => e);
    expect(refused).toBeInstanceOf(FinishRefused);
    expect(session.saveState()).toBe('saved');

    session.setAnswers({ ...ENT_ANSWERS });
    const done = await session.finish();
    expect(done.state).toBe('final');
    expect(session.saveState()).toBe('final');
    expect(session.isFinal()).toBe(true);
    session.setAnswers({ age: 1 });
    expect(session.answers()['age']).toBe(42);
  });

  it('a sheet finished elsewhere → "final", nothing more is sent', async () => {
    const { session, api, id } = await opened();
    await api.saveCase(id, { rowVersion: 1, requestId: 'x', answers: ENT_ANSWERS });
    await api.finishCase(id, 2);
    session.setAnswers({ age: 1 });
    await tick(DEBOUNCE + 10);
    expect(session.saveState()).toBe('final');
  });

  it('every change is cached on the device at once; reopening restores answers that never reached the server', async () => {
    const cache = new MemoryCaseCache();
    const api = new MockCasesApi();
    const c = await api.createCase('form-ent');
    const first = setup(cache, api).session;
    await first.open(c.id);
    api.offline = true;
    first.setAnswers({ patientName: 'Typed offline' });
    await tick(DEBOUNCE + 10);
    expect((await cache.getSheet(c.id))?.dirty).toBe(true);
    first.destroy();

    // The tablet restarts while still offline: the sheet opens from the device.
    const second = setup(cache, api).session;
    await second.open(c.id);
    expect(second.fromCache()).toBe(true);
    expect(second.answers()).toEqual({ patientName: 'Typed offline' });
    expect(second.definition()?.title).toBe(ENT_SAMPLE.title);
    second.destroy();

    // Back online: it reopens from the server and sends what was typed.
    api.offline = false;
    const third = setup(cache, api).session;
    await third.open(c.id);
    expect(third.answers()).toEqual({ patientName: 'Typed offline' });
    await tick(10);
    expect((await api.getCase(c.id)).answers).toEqual({ patientName: 'Typed offline' });
    expect((await cache.getSheet(c.id))?.dirty).toBe(false);
  });

  it('cached local answers on an OLD version (another device saved since) open as a conflict', async () => {
    const cache = new MemoryCaseCache();
    const api = new MockCasesApi();
    const c = await api.createCase('form-ent');
    const s1 = setup(cache, api).session;
    await s1.open(c.id);
    api.offline = true;
    s1.setAnswers({ patientName: 'Here' });
    await tick(DEBOUNCE + 10);
    s1.destroy();
    api.offline = false;
    await api.saveCase(c.id, { rowVersion: 1, requestId: 'elsewhere', answers: { patientName: 'There' } });
    const s2 = setup(cache, api).session;
    await s2.open(c.id);
    expect(s2.saveState()).toBe('conflict');
    expect(s2.answers()).toEqual({ patientName: 'Here' });
    expect(s2.conflict()?.answers).toEqual({ normalSinceUnit: 'months', patientName: 'There' });
  });

  it('the narrative says it needs the network when offline', async () => {
    const { session, api } = await opened();
    api.offline = true;
    session.refreshNarrative();
    await tick(10);
    expect(session.narrativeState()).toBe('offline');
  });

  it('a sheet that is not there is a load error, not a crash', async () => {
    const { session } = setup();
    await session.open('missing');
    expect((session.loadError() as HttpErrorResponse).status).toBe(404);
  });
});

describe('patient block and visited pages', () => {
  it('name, age and sex come from the answers (sex by option label)', () => {
    expect(patientFromAnswers(ENT_SAMPLE, ENT_ANSWERS)).toEqual({ name: 'Rajesh Kumar', age: '42', sex: 'Male' });
    expect(patientFromAnswers(ENT_SAMPLE, {})).toEqual({ name: null, age: null, sex: null });
    expect(
      patientFromAnswers(
        { pages: [{ key: 'p', title: 'P', fields: [{ key: 'note', kind: 'text', label: 'Note' }] }] },
        { note: 'x' },
      ),
    ).toEqual({});
  });

  it('a sheet linked to a patient keeps its snapshot while the form\'s name / age / sex are empty (WP11)', () => {
    const base = { name: 'Lakshmanan Pillai', age: '58 years', sex: 'Male', ref: 'PSC-1' };
    const empty = patientFromAnswers(ENT_SAMPLE, {});
    expect(mergePatient(base, empty, {}, true)).toEqual(base);
    // a typed answer still wins, field by field
    expect(mergePatient(base, { ...empty, name: 'L. Pillai' }, {}, true)).toEqual({ ...base, name: 'L. Pillai' });
    // unlinked (Prepare): the answers own the fields, even when cleared
    expect(mergePatient(base, empty, {}, false)).toEqual({ name: null, age: null, sex: null, ref: 'PSC-1' });
  });

  it('visited keeps the last visit of each page, current page last', () => {
    expect(normaliseVisited(['a', 'b', 'a', '', 'c', 'b'])).toEqual(['a', 'c', 'b']);
  });
});
