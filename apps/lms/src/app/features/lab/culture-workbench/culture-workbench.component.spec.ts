import { signal } from '@angular/core';
import { CultureWorkbenchComponent } from './culture-workbench.component';
import { CultureStageView } from '../culture-panel/culture-panel.component';
import { OrderTestComment } from '../../../shared/models/comment.model';

// The bench needs the router/API injected; its pure helpers are exercised
// via prototype.call on hand-built contexts (same approach as kpi-strip spec).
const call = <T,>(fn: (...a: any[]) => T, ctx: any, ...args: any[]): T => fn.call(ctx, ...args);
const P = CultureWorkbenchComponent.prototype as any;

const stage = (key: string, over: Partial<CultureStageView> = {}): CultureStageView =>
  ({ key, label: key, state: 'open', ...over });
const comment = (parameterName: string | null, over: Partial<OrderTestComment> = {}): OrderTestComment =>
  ({ id: Math.random().toString(36).slice(2), orderTestId: 'ot', parameterName, commentType: 'observation',
     body: 'x', authorId: 'a', authorRole: 'tech', initiatedBy: 'tech', isResolved: false,
     createdAt: new Date().toISOString(), ...over });

describe('CultureWorkbenchComponent — notes per stage / component', () => {
  it('paramKey() namespaces a component under its stage', () => {
    // paramKey rides sk() (branch namespacing): root case -> bare stage key.
    expect(call(P.paramKey, { sk: P.sk, selCaseId: () => null }, 'gram', 'pus_cells')).toBe('gram.pus_cells');
  });

  it('commentsFor() splits one flat list into stage-level and per-component threads', () => {
    const list = [comment('gram'), comment('gram.pus_cells'), comment('gram.pus_cells'), comment('growth'), comment(null)];
    const ctx = { _comments: signal(list) };
    expect(call(P.commentsFor, ctx, 'gram')).toHaveLength(1);
    expect(call(P.commentsFor, ctx, 'gram.pus_cells')).toHaveLength(2);
    expect(call(P.commentsFor, ctx, 'growth')).toHaveLength(1);
    expect(call(P.commentsFor, ctx, 'ast')).toHaveLength(0);
  });

  it('toggleNote() opens and closes a thread independently of the others', () => {
    const ctx = { _noteOpen: signal(new Set<string>()) };
    call(P.toggleNote, ctx, 'gram.pus_cells');
    expect(call(P.noteOpen, ctx, 'gram.pus_cells')).toBe(true);
    expect(call(P.noteOpen, ctx, 'gram')).toBe(false);
    call(P.toggleNote, ctx, 'gram.pus_cells');
    expect(call(P.noteOpen, ctx, 'gram.pus_cells')).toBe(false);
  });
});

describe('CultureWorkbenchComponent — case-level incubation timer + holds', () => {
  const now = Date.parse('2026-09-08T12:00:00Z');
  const ctx = (incubateUntil: string | null) =>
    ({ now: () => now, view: () => ({ incubateUntil }) });

  it('incubReadyIn() counts down live, says "now" once elapsed, blank without a timer', () => {
    expect(call(P.incubReadyIn, ctx(new Date(now + (2 * 60 + 15) * 60_000).toISOString()))).toBe('2h 15m');
    expect(call(P.incubReadyIn, ctx(new Date(now + 25 * 60_000).toISOString()))).toBe('25m');
    expect(call(P.incubReadyIn, ctx(new Date(now - 1_000).toISOString()))).toBe('now');
    expect(call(P.incubReadyIn, ctx(null))).toBe('');
  });

  it('incubDone() flips only after the timer elapses', () => {
    expect(call(P.incubDone, ctx(new Date(now + 60_000).toISOString()))).toBe(false);
    expect(call(P.incubDone, ctx(new Date(now - 60_000).toISOString()))).toBe(true);
    expect(call(P.incubDone, ctx(null))).toBe(false);
  });

  it('hold semantics: my pick is mine, another tech\'s pick locks the stage', () => {
    const auth = { auth: { user: () => ({ id: 'me' }) }, isMine: P.isMine };
    const mine = stage('growth', { state: 'picked', holderUserId: 'me' });
    const other = stage('growth', { state: 'picked', holderUserId: 'other' });
    expect(call(P.isMine, auth, mine)).toBe(true);
    expect(call(P.lockedByOther, auth, other)).toBe(true);
    expect(call(P.lockedByOther, auth, mine)).toBe(false);
  });
});
