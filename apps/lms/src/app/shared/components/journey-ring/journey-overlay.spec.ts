import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { JourneyOverlayService } from './journey-overlay.service';
import { JourneyRingComponent } from './journey-ring.component';
import { JOURNEY_FLIP_MS } from './journey-overlay.component';
import { JourneyDetail, detailLine, detailStepOf, detailTat } from './journey-detail';
import { labRingSteps, PipelineLike } from './journey-ring';
import { flowJourneyDetail } from '../../../features/frontdesk/frontdesk-landing/flow-grid/flow-journey';
import type { FlowRow } from '../../../features/frontdesk/frontdesk-landing/flow-grid/flow-row';

/** Tap-to-expand journey view (owner-approved 2026-11-20): open / close (✕ · Esc · backdrop), focus return, the
 *  timeline from the step model, the reduced-motion path, and the Frontdesk row → detail mapping. */
const detail = (extra: Partial<JourneyDetail> = {}): JourneyDetail => ({
  service: 'lab', showLabel: true, name: 'Nithin Ragav Gopalakrishnan', meta: '34/F · AA0004', token: '#4', visit: 'Walk-in · 9:40 AM',
  lateMin: 41, inClinicMin: 41, usualMin: null,
  steps: [
    { label: 'Billing', state: 'done', at: '9:40 AM', by: null },
    { label: 'Sample', state: 'late', at: '9:40 AM', minutes: 41, note: '₹450.00 due — payment not taken yet.' },
    { label: 'Dispatch', state: 'todo' }, { label: 'Result entry', state: 'todo' }, { label: 'Validation', state: 'todo' },
  ],
  ...extra,
});

function setReducedMotion(on: boolean) {
  window.matchMedia = ((q: string) => ({ matches: on && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as never;
}

function openRing(d: JourneyDetail) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [JourneyRingComponent] });
  const f = TestBed.createComponent(JourneyRingComponent);
  f.componentRef.setInput('steps', d.steps.map(s => ({ label: s.label, state: s.state })));
  f.componentRef.setInput('detail', d);
  f.detectChanges();
  document.body.appendChild(f.nativeElement);
  const btn = (f.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.pf-jring__btn')!;
  return { f, btn, svc: TestBed.inject(JourneyOverlayService) };
}
const overlay = () => document.querySelector<HTMLElement>('pf-journey-overlay');

describe('journey view — open / close / focus', () => {
  beforeEach(() => { vi.useFakeTimers(); setReducedMotion(false); });
  afterEach(() => { vi.useRealTimers(); document.querySelectorAll('pf-journey-overlay, pf-journey-ring').forEach(e => e.remove()); });

  it('the ring is a ≥44px button "… Open journey"; a tap opens an aria-modal dialog with the patient, chips and timeline', () => {
    const { btn } = openRing(detail());
    expect(btn.getAttribute('aria-label')).toBe('Lab · step 2 of 5 · Sample · late. Open journey');
    btn.click();
    vi.advanceTimersByTime(20);
    const o = overlay()!;
    const dlg = o.querySelector('[role="dialog"]')!;
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(o.querySelector('#pf-jov-name')!.textContent).toContain('Nithin Ragav Gopalakrishnan');
    expect(o.querySelector('.pf-jov__chip--late')!.textContent).toContain('Late · 41m');
    expect(o.querySelector('.pf-jov__pt')!.textContent).toContain('Journey · Step 2 of 5');
    expect([...o.querySelectorAll('.pf-jov__step')].map(li => li.getAttribute('data-state'))).toEqual(['done', 'late', 'todo', 'todo', 'todo']);
    expect(o.querySelector('.pf-jov__note--late')!.textContent).toContain('₹450.00 due');
    expect(o.querySelectorAll('.pf-jov__step[data-state="todo"] .pf-jov__m')[0].textContent).toContain('Not started');
    // No usual time in the data: time in clinic only, no bar.
    expect(o.querySelector('.pf-jov__tat')!.textContent).toContain('Time in clinic');
    expect(o.querySelector('.pf-jov__bar')).toBeNull();
    expect(document.activeElement?.classList.contains('pf-jov__close')).toBe(true);     // focus moved in
  });

  it.each([
    ['✕', () => overlay()!.querySelector<HTMLButtonElement>('.pf-jov__close')!.click()],
    ['Esc', () => overlay()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))],
    ['backdrop', () => overlay()!.querySelector<HTMLElement>('[data-testid="journey-scrim"]')!.click()],
  ])('%s closes (after the fly-back) and focus returns to the ring', (_w, act) => {
    const { btn, svc } = openRing(detail());
    btn.click();
    vi.advanceTimersByTime(20);
    act();
    expect(overlay()).not.toBeNull();             // still flying back
    vi.advanceTimersByTime(JOURNEY_FLIP_MS + 10);
    expect(overlay()).toBeNull();
    expect(svc.isOpen).toBe(false);
    expect(document.activeElement).toBe(btn);
  });

  it('the row\'s own action: the view closes first, then the host handler runs', () => {
    const run = vi.fn();
    const { btn } = openRing(detail({ action: { label: 'Pay now', run } }));
    btn.click();
    vi.advanceTimersByTime(20);
    overlay()!.querySelector<HTMLButtonElement>('.pf-jov__act')!.click();
    expect(overlay()).toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reduced motion: no flight (fade only, shorter close)', () => {
    setReducedMotion(true);
    const { btn } = openRing(detail());
    btn.click();
    vi.advanceTimersByTime(20);
    const o = overlay()!;
    expect(o.classList.contains('pf-jov--still')).toBe(true);
    expect((o.querySelector('.pf-jov__big') as HTMLElement).style.transform).toBe('');
    o.querySelector<HTMLButtonElement>('.pf-jov__close')!.click();
    vi.advanceTimersByTime(200);
    expect(overlay()).toBeNull();
  });
});

describe('journey view — words from the step model', () => {
  it('step k of n, the timeline lines, the time bar', () => {
    const p = (...st: PipelineLike['state'][]) => ['Billing', 'Sample', 'Dispatch', 'Result', 'Report'].map((label, i) => ({ label, state: st[i] ?? 'pending' })) as PipelineLike[];
    expect(detailStepOf(labRingSteps(p('done', 'done', 'active')))).toEqual({ k: 3, n: 5 });
    expect(detailStepOf(labRingSteps(p('done', 'done', 'done', 'done', 'done')))).toEqual({ k: 5, n: 5 });
    expect(detailLine({ label: 'Sample', state: 'done', at: '9:52 AM', minutes: 12, by: 'Ravi' })).toEqual({ time: '9:52 AM · 12m', sub: 'Ravi' });
    expect(detailLine({ label: 'Dispatch', state: 'todo' })).toEqual({ time: '', sub: 'Not started' });
    expect(detailLine({ label: 'Billing', state: 'done' })).toEqual({ time: '', sub: '' });   // nothing known: just the name
    expect(detailTat(41, 30)).toEqual({ pct: 100, over: true });
    expect(detailTat(12, 30)).toEqual({ pct: 40, over: false });
    expect(detailTat(12, null)).toBeNull();
  });

  it('a Frontdesk row → the view: timings from the order\'s own timestamps, the late reason from its dues / wait', () => {
    const t = (h: number, m: number) => new Date(2026, 10, 20, h, m).toISOString();
    const row = {
      id: 'o4', kind: 'order', service: 'lab', name: 'Nithin', meta: '34/F · AA0004', late: true, waitMin: 41, due: 450, where: 'Billed', whereSub: '0/1 collected',
      order: { id: 'o4', status: 'sample_collected', source: 'walkin', dailyNo: 4, createdAt: t(9, 40),
        samples: [{ status: 'collected', collectedAt: t(9, 52), tests: [{ status: 'pending' }] }] },
      ring: [{ label: 'Billing', state: 'done' }, { label: 'Sample', state: 'done' }, { label: 'Dispatch', state: 'late' }, { label: 'Result entry', state: 'todo' }, { label: 'Validation', state: 'todo' }],
    } as unknown as FlowRow;
    const d = flowJourneyDetail(row, new Date(2026, 10, 20, 10, 33).getTime(), { showLabel: false });
    expect(d.token).toBe('#4');
    expect(d.visit).toMatch(/^Walk-in · 9:40 AM$/);
    expect(d.steps[0].at).toBe('9:40 AM');
    expect(d.steps[1]).toMatchObject({ at: '9:52 AM', minutes: 12 });
    expect(d.steps[2]).toMatchObject({ state: 'late', at: '9:52 AM', minutes: 41, note: 'Waiting 41m — over the 30-minute limit.' });
    expect(d.steps[3].at).toBeUndefined();
    expect(d.inClinicMin).toBe(53);
    expect(d.usualMin).toBeNull();
    expect(d.lateMin).toBe(41);
    const billing = flowJourneyDetail({ ...row, ring: [{ label: 'Billing', state: 'late' }, { label: 'Sample', state: 'todo' }] } as FlowRow, Date.now(), { showLabel: true });
    expect(billing.steps[0].note).toContain('due — payment not taken yet.');
  });
});
