import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NgTemplateOutlet } from '@angular/common';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { PendingChangesPanelComponent } from './pending-changes-panel.component';
import { BusyDirective } from '../../../../shared/directives/busy.directive';
import { TmProposalsService } from '../../../../core/services/tm-proposals.service';
import { ThemeService } from '../../../../core/services/theme.service';
import { ToastService } from '../../../../core/services/toast.service';
import { DialogService } from '../../../../core/services/dialog.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { ApiError } from '../../../../shared/models/api-response.model';
import type { TmProposal } from '../../../../shared/models/tm-proposal.model';

/**
 * Test Master → Pending (beta assistant). One change at a time: a row opens
 * ONE change in the review card; Approve / Reject act on that one. There is no
 * checkbox, no select-all and no approve-all anywhere (owner rule). Clinical
 * changes need the SOP tick (DialogService); a changed-since-suggested row
 * must be re-reviewed first; a failed apply says why. AG-Grid and pf-select
 * stay unknown elements so the panel's own template is what renders.
 */
const P = (over: Partial<TmProposal> = {}): TmProposal => ({
  id: 'price1', kind: 'price', status: 'pending', targetTestId: 't1', targetLabel: 'CBC (HEM001)', summary: 'Price ₹250 → ₹300',
  clinicalFields: [], confidence: 96, source: 'pf_sense', sourceModel: 'gemini:gemini-2.5-flash', clientId: null, reason: 'Rate card line 3',
  proposedBy: 'Lakshmi Admin', isMine: false, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 864e5).toISOString(),
  payload: { testId: 't1', price: 300 }, before: { price: 250, taxSlab: 0, notPriced: false }, current: { price: 250 }, changedSinceProposed: false,
  ...over,
});
const CLINICAL = P({ id: 'clin1', kind: 'test_update', targetLabel: 'Glucose (BIO001)', summary: 'Edit: Unit', clinicalFields: ['unit'],
  payload: { unit: 'mmol/L' }, before: { unit: 'mg/dL' }, current: { unit: 'mg/dL' } });
const STALE = P({ id: 'stale1', status: 'stale', targetLabel: 'Urea (BIO004)', before: { price: 120 }, current: { price: 95 }, payload: { testId: 't4', price: 140 }, changedSinceProposed: true });
const FAILED = P({ id: 'fail1', kind: 'test_update', status: 'failed', error: 'family_via_profile', targetLabel: 'Urine (CLI001)', summary: 'Edit: Result setup',
  clinicalFields: ['parametersJson'], payload: { parametersJson: '{"parameters":[{"name":"Cast","type":"family"}]}' }, before: { parametersJson: '{"parameters":[]}' } });
const MINE = P({ id: 'mine1', isMine: true, targetLabel: 'LFT (BIO010)' });

function render(opts: { list?: TmProposal[]; byId?: Record<string, TmProposal>; perms?: string[] | null; narrow?: boolean; } = {}) {
  const list = opts.list ?? [P(), CLINICAL, STALE, FAILED, MINE];
  const byId = { ...Object.fromEntries(list.map(p => [p.id, p])), ...(opts.byId ?? {}) };
  const svc = {
    list: vi.fn(() => of({ items: list, total: list.length, openCount: list.length })),
    openCount: vi.fn(() => of(list.length)),
    get: vi.fn((id: string) => of(byId[id])),
    approve: vi.fn((id: string) => of({ ...byId[id], status: 'approved' })),
    reject: vi.fn((id: string) => of({ ...byId[id], status: 'rejected' })),
    withdraw: vi.fn((id: string) => of({ ...byId[id], status: 'withdrawn' })),
    reReview: vi.fn((id: string) => of({ ...byId[id], status: 'pending' })),
  };
  const dialog = {
    actions: vi.fn(async (_req?: unknown): Promise<{ action: string | null; checked: boolean }> => ({ action: null, checked: false })),
    prompt: vi.fn(async (_req?: unknown): Promise<string | null> => null),
    confirm: vi.fn(async (_req?: unknown): Promise<boolean> => false),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  const perms = opts.perms === undefined ? ['*'] : opts.perms;
  const auth = perms === null ? null : { hasPermission: (c: string) => perms.includes('*') || perms.includes(c), user: () => ({ id: 'u1' }) };
  TestBed.configureTestingModule({
    imports: [PendingChangesPanelComponent],
    providers: [
      { provide: TmProposalsService, useValue: svc },
      { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => true } },
      { provide: ToastService, useValue: toasts },
      { provide: DialogService, useValue: dialog },
      ...(auth ? [{ provide: AuthService, useValue: auth }] : []),
    ],
  });
  TestBed.overrideComponent(PendingChangesPanelComponent, {
    set: { imports: [NgTemplateOutlet, BusyDirective], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
  });
  const f = TestBed.createComponent(PendingChangesPanelComponent);
  if (opts.narrow) f.componentRef.setInput('narrow', true);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const c = f.componentInstance;
  const pick = (id: string) => { c.open(id, true); f.detectChanges(); };
  const q = (sel: string) => el.querySelector<HTMLElement>(sel);
  return { f, el, c, svc, dialog, toasts, pick, q };
}
const flush = () => new Promise(r => setTimeout(r, 0));

describe('PendingChangesPanelComponent', () => {
  it('lists every open change and opens the newest one — no checkbox, no select-all, no approve-all anywhere', () => {
    const { el, c, svc, q } = render();
    expect(svc.list).toHaveBeenCalledWith('review');
    expect(c.items().length).toBe(5);
    expect(q('[data-tmp-detail]')).not.toBeNull();
    const text = el.textContent ?? '';
    expect(text).not.toMatch(/approve all|reject all|accept all|select all|dismiss all/i);
    expect(el.querySelector('input[type="checkbox"], [role="checkbox"]')).toBeNull();
    // The grid has no selection column / multi-select.
    const grid = el.querySelector('ag-grid-angular')!;
    expect(grid.getAttribute('rowselection')).toBeNull();
    expect(c.cols().some(col => (col as { checkboxSelection?: unknown }).checkboxSelection || (col as { headerCheckboxSelection?: unknown }).headerCheckboxSelection)).toBe(false);
    // Only one Approve button exists (on the one open change).
    expect(el.querySelectorAll('[data-tmp-approve]').length).toBe(1);
    // The service itself has no bulk method.
    expect(Object.keys(svc).filter(k => /all|bulk|many/i.test(k))).toEqual([]);
  });

  it('price change: Field | Current | Proposed, source Cortex (Gemini), Approve sends confirmClinical=false with no dialog', async () => {
    const { el, svc, dialog, toasts, pick, q } = render();
    pick('price1');
    expect([...el.querySelectorAll('.pf-tmp__diff thead th')].map(t => t.textContent!.trim())).toEqual(['Field', 'Current', 'Proposed']);
    expect(q('.pf-tmp__diff tbody .pf-tmp__cur')!.textContent).toBe('₹250');
    expect(q('.pf-tmp__diff tbody .pf-tmp__new')!.textContent).toBe('₹300');
    expect(q('[data-tmp-source]')!.textContent).toBe('Cortex (Gemini)');
    expect(q('[data-tmp-confidence]')!.textContent).toBe('Confidence 96');
    q('[data-tmp-approve]')!.click();
    await flush();
    expect(dialog.actions).not.toHaveBeenCalled();
    expect(svc.approve).toHaveBeenCalledWith('price1', false);
    expect(toasts.success).toHaveBeenCalledWith('Approved: CBC (HEM001)');
    expect(svc.list).toHaveBeenCalledTimes(2);   // refreshed after the action
  });

  it('clinical change: Approve opens the SOP checkbox dialog; Cancel approves nothing; ticked → confirmClinical=true', async () => {
    const t = render();
    t.pick('clin1');
    expect(t.q('[data-tmp-clinical]')).not.toBeNull();
    t.q('[data-tmp-approve]')!.click();
    await flush();
    expect(t.dialog.actions).toHaveBeenCalledTimes(1);
    const req = (t.dialog.actions.mock.calls[0] as unknown[])[0] as { checkbox: { label: string }; actions: { requiresCheck?: boolean }[]; items: string[] };
    expect(req.checkbox.label).toBe('I checked these values against the lab’s SOP');
    expect(req.actions[0].requiresCheck).toBe(true);
    expect(req.items).toEqual(['Unit: mg/dL → mmol/L']);
    expect(t.svc.approve).not.toHaveBeenCalled();

    t.dialog.actions.mockResolvedValueOnce({ action: 'approve', checked: true } as never);
    t.q('[data-tmp-approve]')!.click();
    await flush();
    expect(t.svc.approve).toHaveBeenCalledWith('clin1', true);
  });

  it('server says clinical confirm is still required: the words are shown, nothing is retried silently', async () => {
    const t = render();
    t.svc.approve.mockReturnValueOnce(throwError(() => new ApiError('These values affect results. Confirm you checked them: unit', 'clinical_confirm_required')));
    t.pick('price1');
    t.q('[data-tmp-approve]')!.click();
    await flush();
    expect(t.toasts.error).toHaveBeenCalledWith('These values affect results. Confirm you checked them: unit');
    expect(t.svc.approve).toHaveBeenCalledTimes(1);
  });

  it('stale: Current now | At proposal | Proposed, no Approve — Re-review first', async () => {
    const t = render();
    t.pick('stale1');
    expect(t.q('[data-tmp-stale]')!.textContent).toMatch(/Changed since suggested/);
    expect([...t.el.querySelectorAll('.pf-tmp__diff thead th')].map(x => x.textContent!.trim())).toEqual(['Field', 'Current now', 'At proposal', 'Proposed']);
    expect(t.q('.pf-tmp__cur')!.textContent).toBe('₹95');
    expect(t.q('.pf-tmp__at')!.textContent).toBe('₹120');
    expect(t.q('[data-tmp-approve]')).toBeNull();
    t.q('[data-tmp-rereview]')!.click();
    await flush();
    expect(t.svc.reReview).toHaveBeenCalledWith('stale1');
    expect(t.svc.approve).not.toHaveBeenCalled();
  });

  it('approve answered changed_since_proposed: a warning, the change is read again', async () => {
    const t = render();
    t.svc.approve.mockReturnValueOnce(throwError(() => new ApiError('This test changed after the suggestion was made. Re-review it first.', 'changed_since_proposed')));
    t.pick('price1');
    const gets = t.svc.get.mock.calls.length;
    t.q('[data-tmp-approve]')!.click();
    await flush();
    expect(t.toasts.warning).toHaveBeenCalled();
    expect(t.svc.get.mock.calls.length).toBeGreaterThan(gets);
  });

  it('failed: the reason in words, Re-review or Reject (no Approve)', () => {
    const t = render();
    t.pick('fail1');
    expect(t.q('[data-tmp-failed]')!.textContent).toMatch(/Could not apply/);
    expect(t.q('[data-tmp-failed]')!.textContent).toMatch(/option family can only be used inside a profile/);
    expect(t.q('[data-tmp-approve]')).toBeNull();
    expect(t.q('[data-tmp-rereview]')).not.toBeNull();
    expect(t.q('[data-tmp-reject]')).not.toBeNull();
  });

  it('reject asks for an optional note (DialogService) and sends it; Keep it sends nothing', async () => {
    const t = render();
    t.pick('price1');
    t.q('[data-tmp-reject]')!.click();
    await flush();
    expect(t.svc.reject).not.toHaveBeenCalled();
    t.dialog.prompt.mockResolvedValueOnce('Old rate card' as never);
    t.q('[data-tmp-reject]')!.click();
    await flush();
    expect(t.svc.reject).toHaveBeenCalledWith('price1', 'Old rate card');
  });

  it('withdraw only on my own suggestion; both names shown when someone else asked', async () => {
    const t = render();
    t.pick('price1');
    expect(t.q('[data-tmp-withdraw]')).toBeNull();
    expect(t.q('[data-tmp-people]')!.textContent).toBe('Asked by Lakshmi Admin');
    t.pick('mine1');
    expect(t.q('[data-tmp-people]')!.textContent).toBe('Asked by Lakshmi Admin (you)');
    t.dialog.confirm.mockResolvedValueOnce(true as never);
    t.q('[data-tmp-withdraw]')!.click();
    await flush();
    expect(t.svc.withdraw).toHaveBeenCalledWith('mine1');
  });

  it('outside assistant: named with its client through the AI connector; a guess is labelled', () => {
    const outside = P({ id: 'out1', source: 'connector', sourceModel: null, clientId: 'claude-desktop', confidence: 70, matchedBy: 'model' });
    const t = render({ list: [outside] });
    t.pick('out1');
    expect(t.q('[data-tmp-source]')!.textContent).toBe('Outside assistant through the AI connector · claude-desktop');
    expect(t.q('[data-tmp-confidence]')!.textContent).toBe('The assistant guessed this match (confidence 70)');
  });

  it('permissions: a pricing-only role gets no actions on a test edit (the server never lists one either)', () => {
    const t = render({ perms: ['manage_test_pricing'] });
    t.pick('clin1');
    expect(t.q('[data-tmp-actions]')).toBeNull();
    t.pick('price1');
    expect(t.q('[data-tmp-approve]')).not.toBeNull();
  });

  it('closed rows (approved / rejected) show no actions; the status filter reloads the list', () => {
    const done = P({ id: 'done1', status: 'rejected', resolvedBy: 'Asha Rao', resolutionNote: 'Old card' });
    const t = render({ list: [done] });
    t.pick('done1');
    expect(t.q('[data-tmp-actions]')).toBeNull();
    expect(t.q('[data-tmp-people]')!.textContent).toBe('Asked by Lakshmi Admin · Rejected by Asha Rao');
    t.c.setFilter('rejected');
    expect(t.svc.list).toHaveBeenLastCalledWith('rejected');
  });

  it('band search narrows the list; nothing matches → a plain empty state', () => {
    const t = render();
    t.f.componentRef.setInput('query', 'urea');
    t.f.detectChanges();
    expect(t.c.shown().map(p => p.id)).toEqual(['stale1']);
    t.f.componentRef.setInput('query', 'ferritin');
    t.f.detectChanges();
    expect(t.q('[data-tmp-empty]')!.textContent).toMatch(/Nothing matches "ferritin"/);
  });

  it('phone: a tap opens the review as a sheet; the dialog is asked with the sheet closed and it comes back on Cancel', async () => {
    const t = render({ narrow: true });
    expect(t.q('.pf-tmp__side--sheet')).toBeNull();
    t.pick('clin1');
    expect(t.q('.pf-tmp__side--sheet')).not.toBeNull();
    let sheetDuringDialog: boolean | null = null;
    t.dialog.actions.mockImplementationOnce((async () => { sheetDuringDialog = t.c.sheetOpen(); return { action: null, checked: false }; }) as never);
    t.q('[data-tmp-approve]')!.click();
    await flush();
    expect(sheetDuringDialog).toBe(false);
    expect(t.c.sheetOpen()).toBe(true);
  });

  it('emits the open count after every load (the band badge)', () => {
    const t = render();
    const seen: number[] = [];
    t.c.countChange.subscribe(n => seen.push(n));
    t.c.reload();
    expect(seen).toEqual([5]);
  });

  it('copy never says "AI" except "AI connector"', () => {
    const t = render({ list: [P({ source: 'connector', clientId: 'x' }), CLINICAL] });
    for (const id of ['price1', 'clin1']) {
      t.pick(id);
      expect((t.el.textContent ?? '').replace(/AI connector/g, '')).not.toMatch(/\bAI\b/);
      expect(t.el.textContent).not.toMatch(/PF Sense/);
    }
  });
});
