import { readFileSync } from 'node:fs';
import { TestBed } from '@angular/core/testing';
import { JourneyRingComponent } from './journey-ring.component';
import {
  LAB_STEPS_DIRECT, LAB_STEPS_VALIDATED, PipelineLike, RingStep, labRingSteps, ringAria, ringSegments, ringSteps, ringTipLines,
  statusRingSteps, validationApplies,
} from './journey-ring';
import { orderRing } from '../../../features/frontdesk/frontdesk-landing/flow-grid/flow-row';

/** `pf-journey-ring` (owner-approved 2026-11-20): the row's OWN steps, done / now / late / todo, label only when useful. */
const pipe = (...states: PipelineLike['state'][]): PipelineLike[] =>
  ['Billing', 'Sample', 'Dispatch', 'Result', 'Report'].map((label, i) => ({ label, state: states[i] ?? 'pending' }));
const states = (s: readonly RingStep[]) => s.map(x => x.state);

describe('step derivation', () => {
  it('lab WITH validation = 5 steps; WITHOUT = 4 (result and report are one step) — never padded', () => {
    const p = pipe('done', 'done', 'active', 'pending', 'pending');
    expect(labRingSteps(p).map(s => s.label)).toEqual([...LAB_STEPS_VALIDATED]);
    expect(labRingSteps(p, { validation: false }).map(s => s.label)).toEqual([...LAB_STEPS_DIRECT]);
    expect(states(labRingSteps(p))).toEqual(['done', 'done', 'now', 'todo', 'todo']);
    expect(states(labRingSteps(p, { validation: false }))).toEqual(['done', 'done', 'now', 'todo']);
    // Entered, awaiting validation: step 5 is now; direct release: the result step is still current until reported.
    const entered = pipe('done', 'done', 'done', 'done', 'active');
    expect(states(labRingSteps(entered))).toEqual(['done', 'done', 'done', 'done', 'now']);
    expect(states(labRingSteps(entered, { validation: false }))).toEqual(['done', 'done', 'done', 'now']);
    expect(states(labRingSteps(pipe('done', 'done', 'done', 'done', 'done')))).toEqual(Array(5).fill('done'));
  });

  it('validation is read from the row\'s own lines (released at entry on every line = no validation step)', () => {
    expect(validationApplies([])).toBe(true);
    expect(validationApplies([{ status: 'entered', resultedAt: 'a' }])).toBe(true);
    expect(validationApplies([{ status: 'validated', resultedAt: 't1', validatedAt: 't1' }])).toBe(false);
    expect(validationApplies([{ status: 'validated', resultedAt: 't1', validatedAt: 't2' }])).toBe(true);
    const order = (tests: object[], status = 'validated') => ({ status, module: 'lab', samples: [{ status: 'received', tests }] }) as never;
    expect(orderRing(order([{ status: 'validated', resultedAt: 't', validatedAt: 't' }]), false)).toHaveLength(4);
    expect(orderRing(order([{ status: 'validated', resultedAt: 't', validatedAt: 'u' }]), false)).toHaveLength(5);
  });

  it('OPD / IPD / Scan / ER walk their status steps', () => {
    expect(statusRingSteps('opd', 'created').map(s => [s.label, s.state])).toEqual([['Billing', 'now'], ['Consult', 'todo'], ['Done', 'todo']]);
    expect(states(statusRingSteps('opd', 'billed'))).toEqual(['done', 'now', 'todo']);
    expect(states(statusRingSteps('ipd', 'billed', { late: true }))).toEqual(['done', 'late', 'todo']);
    expect(statusRingSteps('ipd', 'billed').map(s => s.label)).toEqual(['Admission', 'Care', 'Discharge']);
    expect(states(statusRingSteps('scan', 'resulted'))).toEqual(['done', 'done', 'now']);
    expect(states(statusRingSteps('er', 'completed'))).toEqual(['done', 'done', 'done']);
    expect(states(statusRingSteps('er', 'cancelled'))).toEqual(['todo', 'todo', 'todo']);
    expect(orderRing({ status: 'billed', module: 'opd', samples: [] } as never, true).map(s => s.state)).toEqual(['done', 'late', 'todo']);
    expect(orderRing({ status: 'billed', module: 'radiology', samples: [] } as never, false).map(s => s.label)).toEqual(['Billing', 'Scan', 'Report']);
  });
});

describe('colour state', () => {
  it('done before the current step, now / late at it, todo after; −1 = all done', () => {
    expect(states(ringSteps(['a', 'b', 'c'], 1))).toEqual(['done', 'now', 'todo']);
    expect(states(ringSteps(['a', 'b', 'c'], 1, { late: true }))).toEqual(['done', 'late', 'todo']);
    expect(states(ringSteps(['a', 'b'], -1, { late: true }))).toEqual(['done', 'done']);
  });

  it('a blocked step (sample not collected) is late even inside the time limit', () => {
    expect(states(labRingSteps(pipe('done', 'stopped', 'pending', 'pending', 'pending')))).toEqual(['done', 'late', 'todo', 'todo', 'todo']);
  });

  it('aria + tooltip words', () => {
    const s = labRingSteps(pipe('done', 'done', 'active'));
    expect(ringAria('lab', s)).toBe('Lab · step 3 of 5 · Dispatch · in progress');
    expect(ringAria('opd', statusRingSteps('opd', 'billed', { late: true }))).toBe('OPD · step 2 of 3 · Consult · late');
    expect(ringAria('lab', ringSteps(['a', 'b'], -1))).toBe('Lab · all 2 steps done');
    expect(ringTipLines(s).map(l => l.word)).toEqual(['done', 'done', 'now', 'next', 'next']);
  });

  it('geometry: one arc per step with gaps; one step = a full circle', () => {
    const g = ringSegments(5);
    expect(g).toHaveLength(5);
    for (let i = 1; i < g.length; i++) expect(g[i].a0).toBeGreaterThan(g[i - 1].a1);   // a gap between neighbours
    expect(ringSegments(4)).toHaveLength(4);
    expect(ringSegments(1)[0].d).toContain('A19 19 0 1 1');
    expect(ringSegments(0)).toEqual([]);
  });
});

describe('<pf-journey-ring>', () => {
  function mount(steps: RingStep[], service: 'lab' | 'opd' = 'lab', showLabel = true) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [JourneyRingComponent] });
    const f = TestBed.createComponent(JourneyRingComponent);
    f.componentRef.setInput('steps', steps);
    f.componentRef.setInput('service', service);
    f.componentRef.setInput('showLabel', showLabel);
    f.detectChanges();
    return f;
  }

  it('role=img + aria-label; a segment per step carrying its state; the service label in the disc', () => {
    const f = mount(statusRingSteps('opd', 'billed', { late: true }), 'opd');
    const el = f.nativeElement as HTMLElement;
    expect(el.getAttribute('role')).toBe('img');
    expect(el.getAttribute('aria-label')).toBe('OPD · step 2 of 3 · Consult · late');
    expect([...el.querySelectorAll('path.pf-jring__seg')].map(p => p.getAttribute('data-state'))).toEqual(['done', 'late', 'todo']);
    expect(el.querySelector('text.pf-jring__lbl')!.textContent!.trim()).toBe('OPD');
    expect(el.getAttribute('data-svc')).toBe('opd');
  });

  it('inner label hidden (blank neutral disc) when it adds nothing', () => {
    const el = mount(labRingSteps(pipe('done', 'active')), 'lab', false).nativeElement as HTMLElement;
    expect(el.querySelector('text.pf-jring__lbl')).toBeNull();
    expect(el.querySelector('circle.pf-jring__disc--blank')).not.toBeNull();
  });

  it('hover card on pointer (never touch), built on <body>, removed on leave / destroy', () => {
    const f = mount(labRingSteps(pipe('done', 'done', 'active')));
    const c = f.componentInstance;
    c.tipOn({ pointerType: 'touch' } as PointerEvent);
    expect(document.querySelector('.pf-jring-tip')).toBeNull();
    c.tipOn({ pointerType: 'mouse' } as PointerEvent);
    const tip = document.querySelector('.pf-jring-tip')!;
    expect(tip.textContent).toContain('Dispatch');
    expect([...tip.querySelectorAll('.pf-jring-tip__row')].map(r => (r as HTMLElement).dataset['state'])).toEqual(['done', 'done', 'now', 'todo', 'todo']);
    c.tipOff();
    expect(document.querySelector('.pf-jring-tip')).toBeNull();
    c.tipOn({ pointerType: 'mouse' } as PointerEvent);
    f.destroy();
    expect(document.querySelector('.pf-jring-tip')).toBeNull();
  });

  it('tokens only, shared (no screen imports), no emoji', () => {
    const ts = readFileSync('apps/lms/src/app/shared/components/journey-ring/journey-ring.component.ts', 'utf8');
    const util = readFileSync('apps/lms/src/app/shared/components/journey-ring/journey-ring.ts', 'utf8');
    expect(ts + util).not.toMatch(/from '\.\.\/\.\.\/\.\.\/features/);
    expect(ts.replace(/var\([^()]*\)/g, '')).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(ts + util).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe('frontdesk flow grid uses the ring', () => {
  it('the ring rides the ONE "Where now" column (design D, 2026-11-21) — no separate Journey column, no Visit for', () => {
    const grid = readFileSync('apps/lms/src/app/features/frontdesk/frontdesk-landing/flow-grid/flow-grid.component.ts', 'utf8');
    expect(grid).toContain("colId: 'where', headerName: 'Where now'");
    expect(grid).not.toContain("colId: 'journey'");
    expect(grid).not.toContain("colId: 'visit'");
    const ts = readFileSync('apps/lms/src/app/features/frontdesk/frontdesk-landing/frontdesk-landing.component.ts', 'utf8');
    expect(ts).toContain("ringLabels: () => this.serviceShelf.multi() && this.serviceShelf.selected() === 'all',");
  });
});
