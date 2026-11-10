import { CaseConflict, CaseFinal, FinishRefused } from './case-models';
import { MockCasesApi } from './mock-cases-api';
import { ENT_ANSWERS } from '@prefrontal/forms-engine/testing';

describe('MockCasesApi (the server rules, in memory)', () => {
  it('lists the ENT sample as a published form', async () => {
    const api = new MockCasesApi();
    const forms = await api.listForms();
    expect(forms.map((f) => f.title)).toEqual(['Nose History Taking - Complete']);
    expect((await api.publishedForm(forms[0].id)).definition.pages.length).toBeGreaterThan(3);
  });

  it('every write bumps the row version; a stale one is a 409 with the current copy; a retried requestId is not', async () => {
    const api = new MockCasesApi();
    const c = await api.createCase('form-ent');
    expect(c.rowVersion).toBe(1);
    const a = await api.saveCase(c.id, { rowVersion: 1, requestId: 'r1', answers: { patientName: 'Asha' } });
    expect(a.rowVersion).toBe(2);
    expect(
      (await api.saveCase(c.id, { rowVersion: 1, requestId: 'r1', answers: { patientName: 'Asha' } })).rowVersion,
    ).toBe(2);
    const e = await api.saveCase(c.id, { rowVersion: 1, requestId: 'r2', answers: { age: 3 } }).catch((x) => x);
    expect(e).toBeInstanceOf(CaseConflict);
    // a new sheet starts with the form's default answers (the ENT form's "normal since" unit)
    expect((e as CaseConflict).current?.answers).toEqual({ normalSinceUnit: 'months', patientName: 'Asha' });
    await api.saveCase(c.id, { rowVersion: 2, requestId: 'r3', remove: ['patientName'], answers: { age: 3 } });
    expect((await api.getCase(c.id)).answers).toEqual({ normalSinceUnit: 'months', age: 3 });
  });

  it('refuses keys the form does not have', async () => {
    const api = new MockCasesApi();
    const c = await api.createCase('form-ent');
    const e = await api.saveCase(c.id, { rowVersion: 1, requestId: 'r', answers: { nope: 1 } }).catch((x) => x);
    expect(e.status).toBe(400);
  });

  it('Finish refuses with what is missing, then freezes; finished sheets are read-only; amend reuses an open draft', async () => {
    const api = new MockCasesApi();
    const c = await api.createCase('form-ent');
    const r = await api.finishCase(c.id, 1).catch((x) => x);
    expect(r).toBeInstanceOf(FinishRefused);
    expect((r as FinishRefused).missing[0]).toEqual({
      page: 'patient',
      pageTitle: 'Patient',
      field: 'patient.name',
      label: 'Patient name',
    });

    await api.saveCase(c.id, { rowVersion: 1, requestId: 'r', answers: ENT_ANSWERS });
    const done = await api.finishCase(c.id, 2);
    expect(done.state).toBe('final');
    expect(done.hasPdf).toBe(true);
    expect(done.patient.name).toBe('Rajesh Kumar');
    expect(await api.saveCase(c.id, { rowVersion: done.rowVersion, requestId: 'x' }).catch((x) => x)).toBeInstanceOf(
      CaseFinal,
    );

    const am = await api.amendCase(c.id);
    expect(am.state).toBe('draft');
    expect(am.amendedFromId).toBe(c.id);
    expect(am.answers).toEqual(done.answers);
    expect((await api.amendCase(c.id)).id).toBe(am.id);
  });

  it('narrative edits are kept apart and go stale when the answers change', async () => {
    const api = new MockCasesApi();
    const c = await api.createCase('form-ent');
    await api.saveCase(c.id, { rowVersion: 1, requestId: 'a', answers: { patientName: 'Asha' } });
    const first = (await api.narrative(c.id)).sections[0];
    expect(first.content).toBe('Patient Name: Asha.');
    await api.editSection(c.id, first.id, 'My words.', 2);
    let s = (await api.narrative(c.id)).sections[0];
    expect(s).toMatchObject({
      edited: 'My words.',
      stale: false,
      content: 'My words.',
      generated: 'Patient Name: Asha.',
    });
    await api.saveCase(c.id, { rowVersion: 3, requestId: 'b', answers: { age: 42 } });
    s = (await api.narrative(c.id)).sections[0];
    expect(s.stale).toBe(true);
    await api.clearSection(c.id, first.id, 4);
    expect((await api.narrative(c.id)).sections[0].edited).toBeNull();
  });

  it('offline: every call fails like a dropped connection', async () => {
    const api = new MockCasesApi();
    api.offline = true;
    const e = await api.listForms().catch((x) => x);
    expect(e.status).toBe(0);
  });
});
