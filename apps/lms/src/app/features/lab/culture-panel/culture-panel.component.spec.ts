import { CulturePanelComponent, CultureCaseView, CultureStageView } from './culture-panel.component';

// The panel needs ApiService/AuthService/Router injected, so the pure
// per-card helpers are exercised via prototype.call on a hand-built context
// (same approach as kpi-strip.component.spec.ts).
const call = <T,>(fn: (...a: any[]) => T, ctx: any, ...args: any[]): T => fn.call(ctx, ...args);

const stage = (key: string, over: Partial<CultureStageView> = {}): CultureStageView =>
  ({ key, label: key.toUpperCase(), state: 'open', ...over });
const kase = (stages: CultureStageView[]): CultureCaseView =>
  ({ orderTestId: 'ot-1', caseState: 'in_progress', createdAt: new Date().toISOString(), stages } as CultureCaseView);

describe('CulturePanelComponent — one-tap card', () => {
  it('open() navigates straight to the bench for the case (no stage picking step)', () => {
    const navigate = vi.fn();
    call(CulturePanelComponent.prototype.open, { router: { navigate } }, kase([stage('gram')]));
    expect(navigate).toHaveBeenCalledWith(['/lab/culture', 'ot-1']);
  });

  it('heldBy() names the holder of the picked stage, or "You" when it is mine', () => {
    const ctx = { auth: { user: () => ({ id: 'me' }) }, isMine: CulturePanelComponent.prototype.isMine };
    expect(call(CulturePanelComponent.prototype.heldBy, ctx, kase([stage('gram')]))).toBeNull();
    expect(call(CulturePanelComponent.prototype.heldBy, ctx,
      kase([stage('gram', { state: 'picked', holderUserId: 'me' })]))).toBe('You');
    expect(call(CulturePanelComponent.prototype.heldBy, ctx,
      kase([stage('gram', { state: 'picked', holderUserId: 'x', holderName: 'Dawn' })]))).toBe('Dawn');
  });
});

describe('CulturePanelComponent — incubation countdown on the card', () => {
  const now = Date.parse('2026-09-08T12:00:00Z');
  const ctx = { now: () => now };

  it('finds the stage whose clock is still running and ignores elapsed clocks', () => {
    const resting = stage('growth', { incubateUntil: new Date(now + 5 * 3_600_000).toISOString() });
    const elapsed = stage('identification', { incubateUntil: new Date(now - 60_000).toISOString() });
    expect(call(CulturePanelComponent.prototype.incubatingStage, ctx, kase([elapsed, resting]))).toBe(resting);
    expect(call(CulturePanelComponent.prototype.incubatingStage, ctx, kase([elapsed]))).toBeNull();
    expect(call(CulturePanelComponent.prototype.incubatingStage, ctx, kase([stage('gram')]))).toBeNull();
  });

  it('readyIn() formats the remaining time as h/m and "now" once elapsed', () => {
    expect(call(CulturePanelComponent.prototype.readyIn, ctx,
      stage('growth', { incubateUntil: new Date(now + (5 * 60 + 7) * 60_000).toISOString() }))).toBe('5h 7m');
    expect(call(CulturePanelComponent.prototype.readyIn, ctx,
      stage('growth', { incubateUntil: new Date(now + 42 * 60_000).toISOString() }))).toBe('42m');
    expect(call(CulturePanelComponent.prototype.readyIn, ctx,
      stage('growth', { incubateUntil: new Date(now - 1).toISOString() }))).toBe('now');
    expect(call(CulturePanelComponent.prototype.readyIn, ctx, stage('growth'))).toBe('');
  });
});
