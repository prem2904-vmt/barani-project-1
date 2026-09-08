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
    expect(call(P.paramKey, {}, 'gram', 'pus_cells')).toBe('gram.pus_cells');
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

describe('CultureWorkbenchComponent — inoculate & incubate control', () => {
  const now = Date.parse('2026-09-08T12:00:00Z');
  const base = {
    now: () => now,
    incubationStages: new Set(['growth', 'identification', 'ast']),
    requiresIncubation: P.requiresIncubation,
    incubating: P.incubating,
    isMine: P.isMine,
    lockedByOther: P.lockedByOther,
    auth: { user: () => ({ id: 'me' }) },
  };
  // incubateTarget is a computed created in the constructor; evaluate its
  // body through a fresh instance-free replica of the same rule.
  const target = (stages: CultureStageView[]) =>
    stages.find(s => s.state !== 'done' && !call(base.lockedByOther, base, s)
      && base.incubationStages.has(s.key) && !call(base.incubating, base, s)) ?? null;

  it('offers the next incubation stage even while I hold it (the regression: it vanished once picked)', () => {
    const growth = stage('growth', { state: 'picked', holderUserId: 'me' });
    expect(target([stage('gram', { state: 'picked', holderUserId: 'me' }), growth])).toBe(growth);
  });

  it('never offers a stage another tech holds, a done stage, or a plate already resting', () => {
    const held = stage('growth', { state: 'picked', holderUserId: 'other' });
    const done = stage('identification', { state: 'done' });
    const resting = stage('ast', { incubateUntil: new Date(now + 3_600_000).toISOString() });
    expect(target([held, done, resting])).toBeNull();
  });

  it('incubateReadyIn() shows the live countdown for the header pill and the card', () => {
    const s = stage('growth', { incubateUntil: new Date(now + (2 * 60 + 15) * 60_000).toISOString() });
    expect(call(P.incubateReadyIn, base, s)).toBe('2h 15m');
    expect(call(P.incubating, base, s)).toBe(true);
  });
});
