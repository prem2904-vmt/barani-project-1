import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, vi } from 'vitest';
import { AuthService } from '../../../../core/auth/auth.service';
import { DialogService } from '../../../../core/services/dialog.service';
import { ToastService } from '../../../../core/services/toast.service';
import { CaseSheetApprovalsApi } from './approvals-api';
import { ApprovalError, OfferView, ProposalView, toOffer, toProposal } from './approvals-models';
import { WIRE_OFFER, WIRE_OFFER_FULL, WIRE_PROPOSAL } from './approvals-testing';
import { PendingCountService } from './pending-count.service';
import { StudioPendingPage } from './pending.page';

const P = (over: Record<string, unknown> = {}): ProposalView => toProposal({ ...WIRE_PROPOSAL, ...over });
const O = (over: Record<string, unknown> = {}): OfferView => toOffer({ ...WIRE_OFFER, ...over });
const counts = { pending: 1, stale: 0, failed: 0 };

function fakeApi(o: { items?: ProposalView[]; one?: ProposalView; offers?: OfferView[] } = {}) {
  return {
    list: vi.fn(async (_o?: unknown) => ({ items: o.items ?? [P()], total: (o.items ?? [P()]).length, counts })),
    get: vi.fn(async (_id: string) => o.one ?? P()),
    // every action answers with the whole suggestion, detail included (contract, UI feedback round)
    approve: vi.fn(async (_id: string) => P({ status: 'approved', appliedFormId: 'f1', decidedByName: 'Priya Raman' })),
    reject: vi.fn(async (_id: string, _n?: string) => P({ status: 'rejected' })),
    withdraw: vi.fn(async (_id: string) => P({ status: 'withdrawn' })),
    reReview: vi.fn(async (_id: string) => P({ status: 'pending' })),
    submit: vi.fn(async (_id: string) => P()),
    offers: vi.fn(async () => o.offers ?? [O()]),
    offer: vi.fn(async (id: string) => { if (id !== 'o1') throw new ApprovalError('not_found', 'gone', 404); return toOffer({ ...WIRE_OFFER_FULL, ...(o.offers?.[0] ? { youHaveADraft: o.offers[0].youHaveADraft } : {}) }); }),
    acceptOffer: vi.fn(async (_id: string) => toOffer({ ...WIRE_OFFER_FULL, status: 'accepted' })),
    dismissOffer: vi.fn(async (_id: string) => toOffer({ ...WIRE_OFFER_FULL, status: 'dismissed' })),
  };
}
type Api = ReturnType<typeof fakeApi>;

const fakeDialog = () => ({
  confirm: vi.fn(async (_r?: unknown) => true),
  prompt: vi.fn(async (_r?: unknown): Promise<string | null> => 'Not needed'),
  alert: vi.fn(async () => undefined),
  choose: vi.fn(async () => null),
});

async function open(query: { tab?: string; id?: string; offer?: string } = {}, o: { api?: Api; wide?: boolean; me?: string } = {}) {
  TestBed.resetTestingModule();
  const noop = (): void => undefined;
  (window as unknown as { matchMedia: unknown }).matchMedia = (q: string) => ({ matches: q.includes('min-width') ? (o.wide ?? true) : false, addEventListener: noop, removeEventListener: noop });
  const api = o.api ?? fakeApi();
  const dialog = fakeDialog();
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: CaseSheetApprovalsApi, useValue: api },
      { provide: DialogService, useValue: dialog },
      { provide: ToastService, useValue: toasts },
      { provide: AuthService, useValue: { user: signal({ id: o.me ?? 'someone-else' }), hasPermission: () => true, hasAnyPermission: () => true, waitForAuth: async () => undefined } },
    ],
  });
  const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const f = TestBed.createComponent(StudioPendingPage);
  for (const [k, v] of Object.entries(query)) f.componentRef.setInput(k, v);
  const settle = async () => {
    for (let i = 0; i < 4; i++) { f.detectChanges(); await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); }
    await f.whenStable();
    f.detectChanges();
  };
  await settle();
  const el = f.nativeElement as HTMLElement;
  const q = (sel: string) => el.querySelector(sel) as HTMLElement | null;
  const click = async (sel: string) => { (q(sel) as HTMLButtonElement).click(); await settle(); };
  return { f, el, api, dialog, toasts, nav, settle, q, click, count: TestBed.inject(PendingCountService) };
}

afterEach(() => TestBed.resetTestingModule());

describe('Pending changes — the list', () => {
  it('lists open suggestions: title, kind, who / which app, when, the first plain-words line and the status', async () => {
    const { el, api } = await open();
    expect(api.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'open' }));
    const row = el.querySelector('[data-proposal="p1"]')!;
    expect(row.textContent).toContain('ENT case sheet');
    expect(row.textContent).toContain('Change');
    expect(row.textContent).toContain('Claude (connected app), for Priya Raman');
    expect(row.textContent).toContain("Added the question 'Cough'");
    expect(row.textContent).toContain('1 more');
    expect(row.textContent).toContain('Waiting for approval');
  });

  it('a stale and a failed row say so (amber / red dot), never only a colour', async () => {
    const { el } = await open({}, { api: fakeApi({ items: [P({ id: 'a', status: 'stale' }), P({ id: 'b', status: 'failed', error: 'form_has_errors' })] }) });
    expect(el.querySelector('[data-proposal="a"] .pf-sdot')!.getAttribute('data-tone')).toBe('warn');
    expect(el.querySelector('[data-proposal="a"]')!.textContent).toContain('Changed since — look again');
    expect(el.querySelector('[data-proposal="b"] .pf-sdot')!.getAttribute('data-tone')).toBe('bad');
    expect(el.querySelector('[data-proposal="b"]')!.textContent).toContain('Couldn’t be published');
  });

  it('opening a row goes to that ONE suggestion; there is no select-all / approve-all anywhere', async () => {
    const { el, nav, click } = await open();
    expect(el.querySelectorAll('input[type="checkbox"]').length).toBe(0);
    expect(el.textContent).not.toMatch(/approve all|select all/i);
    await click('[data-proposal="p1"] button');
    expect(nav).toHaveBeenCalledWith(['/admin/ipd/myprefrontal/pending'], { queryParams: { id: 'p1' } });
  });

  it('empty: says nothing is waiting', async () => {
    const { q } = await open({}, { api: fakeApi({ items: [] }) });
    expect(q('[data-empty="suggested"]')!.textContent).toContain('Nothing waiting for approval');
  });

  it('a load error says so and offers Try again', async () => {
    const api = fakeApi();
    api.list.mockRejectedValue(new ApprovalError('x', 'Can’t load the suggestions right now.', 500));
    const { el } = await open({}, { api });
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('Can’t load');
  });

  it('the From Prefrontal tab lists the updates (version, your basis, draft warning)', async () => {
    const { el, api } = await open({ tab: 'prefrontal' }, { api: fakeApi({ offers: [O({ youHaveADraft: true })] }) });
    expect(api.offers).toHaveBeenCalled();
    const row = el.querySelector('[data-offer="o1"]')!;
    expect(row.textContent).toContain('General medicine');
    expect(row.textContent).toContain('Version 5');
    expect(row.textContent).toContain('Your copy started from version 3');
    expect(row.textContent).toContain('You have a draft open');
  });

  it('the tab counts and the band show what is waiting (suggestions + updates)', async () => {
    const { el } = await open();
    expect(el.querySelector('[data-waiting]')!.textContent).toContain('2 waiting for approval');
  });
});

describe('Pending changes — one suggestion', () => {
  it('shows the before / after with the real forms engine, the change list, problems and the checks (failures warn in red)', async () => {
    const { el } = await open({ id: 'p1' });
    const before = el.querySelector('[data-side="before"]')!;
    const after = el.querySelector('[data-side="after"]')!;
    expect(before.querySelectorAll('fe-field')).toHaveLength(1);
    expect(after.querySelectorAll('fe-field')).toHaveLength(2);
    expect(before.textContent).toContain('version 3');
    // the questions the change touches are marked on each side
    expect(after.querySelector('[data-changed="after"] [data-field="cough"]')).not.toBeNull();
    expect(before.querySelector('[data-changed="before"] [data-field="fever"]')).not.toBeNull();
    expect(el.querySelector('[data-headline]')!.textContent).toContain('1 field added, 1 sentence changed');
    expect(el.textContent).toContain("Changed what 'Fever' says");
    expect(el.textContent).toContain('Has fever.');
    expect(el.querySelector('[data-problem="warning"]')!.textContent).toContain('Cough has no sentence yet');
    expect(el.querySelector('[data-checks]')!.textContent).toContain('1 of 2 pass');
    expect(el.querySelector('[data-check-fail]')!.textContent).toContain('Cough opens Duration');
    expect(el.querySelector('[data-check-warn]')!.textContent).toContain('you can still approve');
    // ONE primary: Approve
    expect(el.querySelectorAll('.pf-btn--primary')).toHaveLength(1);
    expect(el.querySelector('[data-act="approve"]')!.classList).toContain('pf-btn--primary');
  });

  it('a new case sheet (create) has only the suggested side', async () => {
    const one = P({ kind: 'create', formId: null, detail: { ...WIRE_PROPOSAL.detail, current: null, changes: null, changeSummary: null } });
    const { el } = await open({ id: 'p1' }, { api: fakeApi({ one }) });
    expect(el.querySelector('[data-side="before"]')).toBeNull();
    expect(el.querySelector('[data-side="after"]')!.textContent).toContain('The new case sheet');
    expect(el.textContent).toContain('New case sheet');
  });

  it('Approve asks first and the confirm says it PUBLISHES straight away (and lists the failing checks); then publishes', async () => {
    const { api, dialog, toasts, click } = await open({ id: 'p1' });
    await click('[data-act="approve"]');
    const req = dialog.confirm.mock.calls[0][0] as { title: string; message: string; items?: string[]; question?: string; confirmLabel: string };
    expect(req.title).toBe('Approve and publish?');
    expect(req.message).toContain('publishes the suggestion straight away');
    expect(req.items).toEqual(['Check fails: Cough opens Duration']);
    expect(req.question).toContain('you can still approve');
    expect(req.confirmLabel).toBe('Approve and publish');
    expect(api.approve).toHaveBeenCalledWith('p1');
    expect(toasts.success).toHaveBeenCalledWith('Published “ENT case sheet”');
    expect(api.get).toHaveBeenCalledTimes(1); // the approve answer carries the detail: no second read
  });

  it('after approving, the screen shows the answer it got back (approved, link to the case sheet)', async () => {
    const { el, click } = await open({ id: 'p1' });
    await click('[data-act="approve"]');
    expect(el.querySelector('[data-banner="approved"]')!.textContent).toContain('Approved by Priya Raman');
    expect(el.querySelector('[data-act="approve"]')).toBeNull();
    expect(el.querySelector('[data-side="after"]')).not.toBeNull(); // the before / after stays: the detail came back too
  });

  it('an older server that leaves the detail out: read it again', async () => {
    const api = fakeApi();
    api.approve.mockResolvedValueOnce(P({ status: 'approved', detail: null }));
    const { click } = await open({ id: 'p1' }, { api });
    await click('[data-act="approve"]');
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('cancelling the confirm publishes nothing', async () => {
    const { api, dialog, click } = await open({ id: 'p1' });
    dialog.confirm.mockResolvedValueOnce(false);
    await click('[data-act="approve"]');
    expect(api.approve).not.toHaveBeenCalled();
  });

  it('a shared master: the confirm says it makes the lab’s own copy', async () => {
    const { dialog, click } = await open({ id: 'p1' }, { api: fakeApi({ one: P({ sharedMaster: true }) }) });
    await click('[data-act="approve"]');
    expect((dialog.confirm.mock.calls[0][0] as { message: string }).message).toContain('your lab’s own copy of Prefrontal’s');
  });

  it('409 changed_since_proposed: says so beside the buttons, reloads, and the row is now stale with Look again', async () => {
    const api = fakeApi();
    api.approve.mockRejectedValueOnce(new ApprovalError('changed_since_proposed', 'This case sheet changed after the suggestion was made, so it was not published. Look again to compare it with today’s version.', 409));
    api.get.mockResolvedValueOnce(P()).mockResolvedValueOnce(P({ status: 'stale' }));
    const { el, click } = await open({ id: 'p1' }, { api });
    await click('[data-act="approve"]');
    expect(el.querySelector('[data-action-error]')!.textContent).toContain('changed after the suggestion');
    expect(el.querySelector('[data-banner="stale"]')).not.toBeNull();
    expect(el.querySelector('[data-act="look-again"]')).not.toBeNull();
    expect(el.querySelector('[data-act="approve"]')).toBeNull();
  });

  it('stale: no Approve; Look again re-reviews and the suggestion is back to pending', async () => {
    const api = fakeApi({ one: P({ status: 'stale', detail: { ...WIRE_PROPOSAL.detail, canApprove: false } }) });
    const { el, click, toasts } = await open({ id: 'p1' }, { api });
    expect(el.querySelector('[data-banner="stale"]')!.textContent).toContain('Look again');
    expect(el.querySelector('[data-act="approve"]')).toBeNull();
    expect(el.querySelector('[data-act="look-again"]')!.classList).toContain('pf-btn--primary');
    await click('[data-act="look-again"]');
    expect(api.reReview).toHaveBeenCalledWith('p1');
    expect(toasts.success).toHaveBeenCalledWith('Now compared with today’s version');
    expect(el.querySelector('[data-act="approve"]')).not.toBeNull();
  });

  it('failed: says why in plain words (red), offers Look again and Reject', async () => {
    const { el } = await open({ id: 'p1' }, { api: fakeApi({ one: P({ status: 'failed', error: 'form_has_errors', detail: { ...WIRE_PROPOSAL.detail, canApprove: false } }) }) });
    const b = el.querySelector('[data-banner="failed"]')!;
    expect(b.getAttribute('role')).toBe('alert');
    expect(b.textContent).toContain('problems that stop it being published');
    expect(el.querySelector('[data-act="look-again"]')).not.toBeNull();
    expect(el.querySelector('[data-act="reject"]')).not.toBeNull();
  });

  it('a suggestion with blocking problems: Approve is off and says why', async () => {
    const one = P({ detail: { ...WIRE_PROPOSAL.detail, canApprove: false, problems: [{ severity: 'error', summary: 'Page History has no questions' }] } });
    const { el } = await open({ id: 'p1' }, { api: fakeApi({ one }) });
    expect((el.querySelector('[data-act="approve"]') as HTMLButtonElement).disabled).toBe(true);
    expect(el.querySelector('[data-problem="error"]')!.textContent).toContain('Page History has no questions');
  });

  it('Reject asks (danger) with an optional note, sends it, and shows the rejected state', async () => {
    const api = fakeApi();
    const { el, dialog, click } = await open({ id: 'p1' }, { api });
    api.reject.mockResolvedValueOnce(P({ status: 'rejected', note: 'Not needed', decidedByName: 'Dr Anand' }));
    await click('[data-act="reject"]');
    expect(dialog.prompt).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger', confirmLabel: 'Reject' }));
    expect(api.reject).toHaveBeenCalledWith('p1', 'Not needed');
    expect(el.querySelector('[data-banner="rejected"]')!.textContent).toContain('Not needed');
    expect(el.querySelector('[data-act="approve"]')).toBeNull();
  });

  it('Reject cancelled sends nothing', async () => {
    const { api, dialog, click } = await open({ id: 'p1' });
    dialog.prompt.mockResolvedValueOnce(null);
    await click('[data-act="reject"]');
    expect(api.reject).not.toHaveBeenCalled();
  });

  it('approved: no buttons, a link to the case sheet', async () => {
    const { el } = await open({ id: 'p1' }, { api: fakeApi({ one: P({ status: 'approved', appliedFormId: 'f1', decidedByName: 'Dr Anand' }) }) });
    expect(el.querySelector('[data-banner="approved"]')!.textContent).toContain('Approved by Dr Anand');
    expect(el.querySelector('[data-act="approve"]')).toBeNull();
    expect(el.querySelector('[data-act="reject"]')).toBeNull();
  });

  it('the proposer can take it back; anyone else does not see that', async () => {
    const mine = await open({ id: 'p1' }, { me: 'u1' });
    expect(mine.el.querySelector('[data-act="withdraw"]')).not.toBeNull();
    await mine.click('[data-act="withdraw"]');
    expect(mine.api.withdraw).toHaveBeenCalledWith('p1');
    const other = await open({ id: 'p1' });
    expect(other.el.querySelector('[data-act="withdraw"]')).toBeNull();
  });

  it('phones: one card at a time (Review first, then Before and after)', async () => {
    const { el, f, settle } = await open({ id: 'p1' }, { wide: false });
    expect(el.querySelector('.pd-review')).not.toBeNull();
    expect(el.querySelector('.pd-compare')).toBeNull();
    (f.componentInstance as unknown as { pane: { set(v: string): void } }).pane.set('compare');
    await settle();
    expect(el.querySelector('.pd-review')).toBeNull();
    expect(el.querySelector('[data-side="after"]')).not.toBeNull();
  });
});

describe('Pending changes — From Prefrontal', () => {
  it('draws your copy next to Prefrontal’s version with the real forms engine (GET master-offers/{id})', async () => {
    const { el, api } = await open({ tab: 'prefrontal', offer: 'o1' });
    expect(api.offer).toHaveBeenCalledWith('o1');
    const yours = el.querySelector('[data-side="yours"]')!;
    const master = el.querySelector('[data-side="master"]')!;
    expect(yours.textContent).toContain('version 3');
    expect(master.textContent).toContain('version 5');
    expect(yours.querySelectorAll('fe-field')).toHaveLength(1);
    expect(master.querySelectorAll('fe-field')).toHaveLength(2);
    expect(master.querySelector('[data-changed="after"] [data-field="smoke"]')).not.toBeNull();
  });

  it('without the detail (older server) the differences still show and say why there is no side by side', async () => {
    const api = fakeApi();
    api.offer.mockResolvedValueOnce(O());
    const { el } = await open({ tab: 'prefrontal', offer: 'o1' }, { api });
    expect(el.querySelector('[data-no-detail]')).not.toBeNull();
    expect(el.textContent).toContain("Added the question 'Smoking'");
  });

  it('shows the differences and the two choices (one primary: Take Prefrontal’s version)', async () => {
    const { el } = await open({ tab: 'prefrontal', offer: 'o1' });
    expect(el.querySelector('[data-headline]')!.textContent).toContain('1 field added');
    expect(el.textContent).toContain("Added the question 'Smoking'");
    expect(el.querySelector('[data-act="take"]')!.classList).toContain('pf-btn--primary');
    expect(el.querySelector('[data-act="keep-mine"]')!.classList).toContain('pf-btn--secondary');
  });

  it('Take Prefrontal’s version asks, accepts, and shows it done', async () => {
    const { el, api, dialog, click } = await open({ tab: 'prefrontal', offer: 'o1' });
    api.offers.mockResolvedValueOnce([]);
    await click('[data-act="take"]');
    expect((dialog.confirm.mock.calls[0][0] as { message: string }).message).toContain('publishes Prefrontal’s version 5 straight away');
    expect(api.acceptOffer).toHaveBeenCalledWith('o1');
    expect(el.querySelector('[data-banner="accepted"]')).not.toBeNull();
    expect(el.querySelector('[data-act="take"]')).toBeNull();
  });

  it('Keep mine asks, dismisses, and says this version won’t come back', async () => {
    const { el, api, click } = await open({ tab: 'prefrontal', offer: 'o1' });
    api.offers.mockResolvedValueOnce([]);
    await click('[data-act="keep-mine"]');
    expect(api.dismissOffer).toHaveBeenCalledWith('o1');
    expect(el.querySelector('[data-banner="dismissed"]')!.textContent).toContain('won’t be offered again');
  });

  it('409 draft_open: plain words + a way to the copy; the offer stays', async () => {
    const api = fakeApi();
    api.acceptOffer.mockRejectedValueOnce(new ApprovalError('draft_open', 'Your copy has a draft that is still being edited. Publish or discard that draft first, then take Prefrontal’s version.', 409));
    const { el, click } = await open({ tab: 'prefrontal', offer: 'o1' }, { api });
    await click('[data-act="take"]');
    const err = el.querySelector('[data-action-error]')!;
    expect(err.textContent).toContain('Publish or discard that draft first');
    expect(err.textContent).toContain('Open your copy');
    expect(el.querySelector('[data-act="take"]')).not.toBeNull();
  });

  it('the copy has a draft open: warned before choosing', async () => {
    const { el } = await open({ tab: 'prefrontal', offer: 'o1' }, { api: fakeApi({ offers: [O({ youHaveADraft: true })] }) });
    expect(el.querySelector('[data-banner="draft"]')!.textContent).toContain('Publish or discard it first');
  });

  it('an update that is no longer waiting says so', async () => {
    const { el } = await open({ tab: 'prefrontal', offer: 'gone' });
    expect(el.querySelector('[data-empty="offer"]')).not.toBeNull();
  });
});

describe('PendingCountService', () => {
  it('counts suggestions + updates for the badges; per case sheet; a refusal shows no badge', async () => {
    TestBed.resetTestingModule();
    const api = fakeApi({ items: [P({ id: 'a', formId: 'f1' }), P({ id: 'b', formId: 'f1' }), P({ id: 'c', formId: null, kind: 'create' }), P({ id: 'd', status: 'building', formId: 'f2' })] });
    TestBed.configureTestingModule({ providers: [{ provide: CaseSheetApprovalsApi, useValue: api }] });
    const svc = TestBed.inject(PendingCountService);
    await svc.refresh();
    expect(svc.waiting()).toBe(1);
    expect(svc.total()).toBe(2);
    expect(svc.byForm().get('f1')).toBe(2);
    expect(svc.byForm().has('f2')).toBe(false); // a building one isn't waiting for anybody yet
    expect(svc.offerForms().has('f-own')).toBe(true);

    TestBed.resetTestingModule();
    const broken = fakeApi();
    broken.list.mockRejectedValue(new Error('404'));
    broken.offers.mockRejectedValue(new Error('404'));
    TestBed.configureTestingModule({ providers: [{ provide: CaseSheetApprovalsApi, useValue: broken }] });
    const s2 = TestBed.inject(PendingCountService);
    await s2.refresh();
    expect(s2.total()).toBe(0);
  });
});
