import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../../../environments/environment';
import { CaseSheetApprovalsApi } from './approvals-api';
import {
  ApprovalError, approvalWords, failedWords, groupChanges, kindLabel, openTotal, sourceLine, statusTone, toOffer, toPage, toProposal, waitingWords,
} from './approvals-models';
import { changedKeys } from './sheet-render.component';
import { WIRE_OFFER_FULL, WIRE_PROPOSAL } from './approvals-testing';

const base = () => environment.apiUrl.replace(/\/+$/, '');

describe('approvals: wire → models + plain words', () => {
  it('a ProposalView maps every field; the summary becomes one line per change; detail keeps the before / after', () => {
    const p = toProposal(WIRE_PROPOSAL);
    expect(p.summary).toEqual(["Added the question 'Cough'", "Changed what 'Fever' says"]);
    expect(p.source).toBe('connector');
    expect(p.detail!.current!.versionNo).toBe(3);
    expect(p.detail!.proposed.pages[0].fields).toHaveLength(2);
    expect(p.detail!.headline).toBe('1 field added, 1 sentence changed');
    expect(p.detail!.changes).toHaveLength(3);
    expect(p.detail!.problems[0].severity).toBe('warning');
    expect(p.detail!.checks.summary.failed).toBe(1);
    expect(p.detail!.canApprove).toBe(true);
  });

  it('a list row (no detail) and nulls omitted by the server are safe; an unknown status reads as pending', () => {
    const p = toProposal({ id: 'p2', kind: 'create', status: 'odd', title: '', summary: '', source: 'cortex' });
    expect(p.detail).toBeNull();
    expect(p.status).toBe('pending');
    expect(p.kind).toBe('create');
    expect(p.title).toBe('Untitled case sheet');
    expect(p.formId).toBeNull();
  });

  it('a page carries the badge counts; a create has no current (before) side', () => {
    const page = toPage({ items: [WIRE_PROPOSAL, { ...WIRE_PROPOSAL, id: 'p3', kind: 'create', detail: { ...WIRE_PROPOSAL.detail, current: null, changeSummary: null, changes: null } }], total: 7, counts: { pending: 4, stale: 2, failed: 1 } });
    expect(page.total).toBe(7);
    expect(page.counts).toEqual({ pending: 4, stale: 2, failed: 1 });
    expect(page.items[1].detail!.current).toBeNull();
    expect(page.items[1].detail!.changes).toEqual([]);
    expect(openTotal(page.counts)).toBe(7);
    expect(openTotal(page.counts, 2)).toBe(9);
    expect(openTotal(null)).toBe(0);
  });

  it('an OfferView maps the master version, the draft flag and the differences', () => {
    const o = toOffer({ id: 'o1', catalogKey: 'ent', formId: 'f9', title: 'ENT', masterVersionId: 'mv', masterVersionNo: 5, masterPublishedAt: '2026-11-10T00:00:00Z', yourBasisVersionNo: 3, status: 'pending', createdAt: 'x', youHaveADraft: true, changeSummary: { headline: '2 fields changed' }, changes: [{ type: 'field_changed', words: 'Changed Cough' }] });
    expect(o.masterVersionNo).toBe(5);
    expect(o.yourBasisVersionNo).toBe(3);
    expect(o.youHaveADraft).toBe(true);
    expect(o.headline).toBe('2 fields changed');
    expect(o.changes[0].words).toBe('Changed Cough');
  });

  it('words: who suggested it, kind, status tone (red only for failed), why it failed', () => {
    const p = toProposal(WIRE_PROPOSAL);
    expect(sourceLine(p)).toBe('Claude (connected app), for Priya Raman');
    expect(sourceLine({ ...p, source: 'cortex' })).toBe('Cortex, for Priya Raman');
    expect(sourceLine({ ...p, appName: null, proposedByName: null })).toBe('A connected app (connected app)');
    expect(kindLabel(p)).toBe('Change');
    expect(kindLabel({ kind: 'edit', sharedMaster: true })).toBe('Change to a Prefrontal case sheet');
    expect(kindLabel({ kind: 'create', sharedMaster: false })).toBe('New case sheet');
    expect(statusTone('failed')).toBe('bad');
    expect(statusTone('stale')).toBe('warn');
    expect(statusTone('pending')).toBe('');
    expect(failedWords({ error: 'form_has_errors' })).toMatch(/problems/);
    expect(failedWords({ error: null })).toMatch(/Look again/);
    expect(waitingWords(1)).toBe('1 waiting for approval');
    expect(waitingWords(3)).toBe('3 waiting for approval');
  });

  it('changes group by page ("Whole case sheet" for the rest); keys to mark per side', () => {
    const p = toProposal(WIRE_PROPOSAL);
    expect(groupChanges(p.detail!.changes).map((g) => [g.title, g.changes.length])).toEqual([['History', 2], ['Whole case sheet', 1]]);
    expect([...changedKeys(p.detail!.changes, 'after')].sort()).toEqual(['cough', 'fever']);
    expect([...changedKeys(p.detail!.changes, 'before')]).toEqual(['fever']);
    expect([...changedKeys([{ type: 'field_removed', fieldKey: 'old' }], 'before')]).toEqual(['old']);
    expect([...changedKeys([{ type: 'field_removed', fieldKey: 'old' }], 'after')]).toEqual([]);
  });

  it('no visible "form" or "AI" in any word the screens use', () => {
    const all = JSON.stringify([waitingWords(2), sourceLine(toProposal(WIRE_PROPOSAL)), failedWords({ error: 'x' })]);
    expect(all).not.toMatch(/\bforms?\b/i);
    expect(all).not.toMatch(/\bAI\b/);
  });
});

describe('CaseSheetApprovalsApi', () => {
  let http: HttpTestingController;
  let svc: CaseSheetApprovalsApi;
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    svc = TestBed.inject(CaseSheetApprovalsApi);
  });
  afterEach(() => http.verify());

  it('GET proposals: status=open by default, take capped at 100', async () => {
    const p = svc.list({ take: 500 });
    const r = http.expectOne((q) => q.url === `${base()}/api/casesheets/proposals`);
    expect(r.request.params.get('status')).toBe('open');
    expect(r.request.params.get('take')).toBe('100');
    expect(r.request.params.has('mine')).toBe(false);
    r.flush({ items: [WIRE_PROPOSAL], total: 1, counts: { pending: 1, stale: 0, failed: 0 } });
    expect((await p).items[0].id).toBe('p1');
  });

  it('GET one, approve (no body), reject {note} (trimmed, max 500), withdraw, re-review, submit — one id each', async () => {
    const one = svc.get('p 1');
    http.expectOne(`${base()}/api/casesheets/proposals/p%201`).flush(WIRE_PROPOSAL);
    expect((await one).detail).not.toBeNull();

    const a = svc.approve('p1');
    const ra = http.expectOne(`${base()}/api/casesheets/proposals/p1/approve`);
    expect(ra.request.method).toBe('POST');
    ra.flush({ ...WIRE_PROPOSAL, status: 'approved', detail: null, appliedFormId: 'f1', appliedVersionId: 'v4' });
    expect((await a).appliedVersionId).toBe('v4');

    const rj = svc.reject('p1', '  ' + 'x'.repeat(600) + '  ');
    const rr = http.expectOne(`${base()}/api/casesheets/proposals/p1/reject`);
    expect((rr.request.body as { note: string }).note).toHaveLength(500);
    rr.flush({ ...WIRE_PROPOSAL, status: 'rejected' });
    await rj;

    const rj2 = svc.reject('p1', '   ');
    const rr2 = http.expectOne(`${base()}/api/casesheets/proposals/p1/reject`);
    expect(rr2.request.body).toEqual({});
    rr2.flush({ ...WIRE_PROPOSAL, status: 'rejected' });
    await rj2;

    for (const [call, path] of [[() => svc.withdraw('p1'), 'withdraw'], [() => svc.reReview('p1'), 're-review'], [() => svc.submit('p1'), 'submit']] as const) {
      const pr = call();
      const req = http.expectOne(`${base()}/api/casesheets/proposals/p1/${path}`);
      expect(req.request.method).toBe('POST');
      req.flush(WIRE_PROPOSAL);
      await pr;
    }
  });

  it('master offers: list, accept, dismiss', async () => {
    const l = svc.offers();
    http.expectOne(`${base()}/api/casesheets/master-offers`).flush({ items: [{ id: 'o1', title: 'ENT', formId: 'f', masterVersionNo: 2 }] });
    expect((await l)[0].masterVersionNo).toBe(2);
    const a = svc.acceptOffer('o1');
    http.expectOne(`${base()}/api/casesheets/master-offers/o1/accept`).flush({ id: 'o1', status: 'accepted' });
    expect((await a).status).toBe('accepted');
    const d = svc.dismissOffer('o1');
    http.expectOne(`${base()}/api/casesheets/master-offers/o1/dismiss`).flush({ id: 'o1', status: 'dismissed' });
    expect((await d).status).toBe('dismissed');
  });

  it('GET master-offers/{id} maps both definitions; the list keeps detail null', async () => {
    const one = svc.offer('o 1');
    http.expectOne(`${base()}/api/casesheets/master-offers/o%201`).flush(WIRE_OFFER_FULL);
    const o = await one;
    expect(o.detail!.yours!.versionNo).toBe(3);
    expect(o.detail!.master!.definition!.pages[0].fields).toHaveLength(2);
    const l = svc.offers();
    http.expectOne(`${base()}/api/casesheets/master-offers`).flush({ items: [{ ...WIRE_OFFER_FULL, detail: null }] });
    expect((await l)[0].detail).toBeNull();
    const a = svc.acceptOffer('o1');
    http.expectOne(`${base()}/api/casesheets/master-offers/o1/accept`).flush({ ...WIRE_OFFER_FULL, status: 'accepted' });
    expect((await a).detail!.master!.versionNo).toBe(5);
  });

  it('a proposal action answers with the whole suggestion, detail included', async () => {
    const p = svc.reReview('p1');
    http.expectOne(`${base()}/api/casesheets/proposals/p1/re-review`).flush({ ...WIRE_PROPOSAL, status: 'pending' });
    const r = await p;
    expect(r.detail!.current!.versionNo).toBe(3);
    expect(r.detail!.changes.length).toBeGreaterThan(0);
  });

  it.each([
    [409, 'changed_since_proposed', /changed after the suggestion/],
    [409, 'draft_open', /draft that is still being edited/],
    [422, 'form_has_errors', /problems/],
    [409, 'not_pending', /already dealt with/],
  ])('%i %s becomes an ApprovalError in our plain words', async (status, code, words) => {
    const p = svc.approve('p1');
    http.expectOne(`${base()}/api/casesheets/proposals/p1/approve`).flush({ status, code, title: 't', detail: 'server words' }, { status, statusText: 'x' });
    const e = await p.catch((x) => x);
    expect(e).toBeInstanceOf(ApprovalError);
    expect(e.code).toBe(code);
    expect(approvalWords(e)).toMatch(words);
    expect(approvalWords(e)).not.toContain(code);
  });

  it('an unknown code uses the server detail; offline says so', async () => {
    const p = svc.approve('p1');
    http.expectOne(`${base()}/api/casesheets/proposals/p1/approve`).flush({ code: 'brand_new', detail: 'Something specific.' }, { status: 409, statusText: 'x' });
    expect(approvalWords(await p.catch((x) => x))).toBe('Something specific.');
    expect(approvalWords({ status: 0 })).toMatch(/Can’t reach/);
  });

  it('there is NO bulk method (one suggestion at a time, like the server)', () => {
    const names = Object.getOwnPropertyNames(CaseSheetApprovalsApi.prototype);
    expect(names.filter((n) => /All|Bulk|Many|Batch|^(all|bulk|many|batch)/.test(n))).toEqual([]);
  });
});
