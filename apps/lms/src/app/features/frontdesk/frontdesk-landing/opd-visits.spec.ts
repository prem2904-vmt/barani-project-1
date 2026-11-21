import { readFileSync } from 'node:fs';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { vi } from 'vitest';
import type { OpdVisitRow } from '../../opd/frontdesk/desk.models';
import { opdVisitRingSteps } from '../../../shared/components/journey-ring/journey-ring';
import { FrontdeskLandingComponent } from './frontdesk-landing.component';
import { opdDueByVisit, opdVisitFlowRow, opdVisitMatches, opdVisitStatus } from './opd-visits';
import { stepOfRow, whoItemOf } from './who-is-where/who-is-where';
import { flowTokenText } from './flow-grid/flow-grid.component';
import { OPD_SHELL_ROUTES } from '../../opd/opd.routes';

/** OPD visits land in the COMMON Frontdesk (owner 2026-11-20) — only while OPD is on; with OPD off, nothing changes. */
const now = Date.parse('2026-11-20T10:00:00Z');
const visit = (extra: Partial<OpdVisitRow> = {}): OpdVisitRow => ({
  id: 'v1', patientId: 'p1', patientName: 'Ms. Meera Iyer', patientMeta: '41/F · AA0101', doctorUserId: 'd1', doctorName: 'Dr. Rao',
  departmentName: 'General', visitNumber: 'OPD-2611-0001', visitDate: '2026-11-20', token: 14, tokenLabel: 'R-14', status: 'waiting',
  isFollowUp: false, charged: 500, billStatus: 'paid', hasLabOrder: false, createdAt: '2026-11-20T09:20:00Z', checkedInAt: '2026-11-20T09:26:00Z',
  vitalsFlagged: false, ...extra,
});

describe('an OPD visit → a work-grid row', () => {
  it('token, patient, Where now, Waiting (since check-in), Payment, the OPD ring and ONE Next', () => {
    const r = opdVisitFlowRow(visit(), now);
    expect(r).toMatchObject({ id: 'opd:v1', kind: 'visit', service: 'opd', name: 'Ms. Meera Iyer', meta: '41/F · AA0101', where: 'Waiting',
      whereSub: 'Dr. Rao · General', waitMin: 34, late: true, pay: 'Paid', status: 'ip' });
    expect(flowTokenText(r)).toBe('R-14');
    expect(r.ring!.map(s => s.state)).toEqual(['done', 'done', 'late', 'todo']);      // Check-in · Vitals · Doctor queue (late) · Consult
    expect(r.next).toEqual({ id: 'opd-open', label: 'Open', aria: 'Open OPD visit R-14' });
    expect(stepOfRow(r)).toBe('Waiting');
    expect(whoItemOf(r)).toMatchObject({ service: 'opd', token: 'R-14', late: true });
  });

  it('status buckets: open → In progress; finished with a balance → Payments due ("Collect"); else Completed', () => {
    expect(opdVisitStatus({ status: 'in_consult' }, 0)).toBe('ip');
    expect(opdVisitStatus({ status: 'completed' }, 300)).toBe('billing');
    expect(opdVisitStatus({ status: 'completed' }, 0)).toBe('done');
    expect(opdVisitStatus({ status: 'no_show' }, 0)).toBe('done');
    const dueRow = opdVisitFlowRow(visit({ status: 'completed' }), now, { due: 300 });
    expect(dueRow).toMatchObject({ status: 'billing', payDue: true, waitMin: null, wait: '—' });
    expect(dueRow.pay).toContain('due');
    expect(dueRow.next!.label).toBe('Collect');
    expect(opdDueByVisit([{ visitId: 'v1', balance: 200 }, { visitId: 'v1', balance: 100 }] as never).get('v1')).toBe(300);
  });

  it('the ring follows the visit status and drops Vitals when the OPD workflow takes none', () => {
    expect(opdVisitRingSteps('booked').map(s => s.state)).toEqual(['now', 'todo', 'todo', 'todo']);
    expect(opdVisitRingSteps('in_consult').map(s => s.state)).toEqual(['done', 'done', 'done', 'now']);
    expect(opdVisitRingSteps('completed').every(s => s.state === 'done')).toBe(true);
    expect(opdVisitRingSteps('cancelled').every(s => s.state === 'todo')).toBe(true);
    expect(opdVisitRingSteps('waiting', { vitals: false }).map(s => s.label)).toEqual(['Check-in', 'Doctor queue', 'Consult']);
  });

  it('the head search finds a visit by name, MRN, token or visit number', () => {
    expect(opdVisitMatches(visit(), 'meera')).toBe(true);
    expect(opdVisitMatches(visit(), 'aa0101')).toBe(true);
    expect(opdVisitMatches(visit(), 'r-14')).toBe(true);
    expect(opdVisitMatches(visit(), 'OPD-2611')).toBe(true);
    expect(opdVisitMatches(visit(), 'arya')).toBe(false);
  });
});

describe('enabled / disabled', () => {
  const proto = FrontdeskLandingComponent.prototype as any;
  const host = (on: boolean) => {
    const h = Object.create(proto);
    const api = { visits: vi.fn(() => of([visit()])), paymentsDue: vi.fn(() => of([])), desk: vi.fn(() => of({ config: { workflow: { vitals: 'desk' } } })),
      board: vi.fn(() => of([{ id: 'd1', name: 'Dr. Rao', waiting: 2, vitals: 0, inConsult: 0, done: 0 }])), proceduresToBook: vi.fn(() => of([{ id: 'pb1' }])) };
    Object.assign(h, {
      opdOn: signal(on), opdApi: api, opdCfgLoaded: false,
      workBounds: signal({ start: new Date(2026, 10, 20).getTime(), end: new Date(2026, 10, 21).getTime(), isToday: true }),
      _opdVisits: signal([]), _opdDues: signal([]), _opdVitals: signal(true), _opdBoard: signal([]), _toBook: signal(null),
    });
    return { h, api };
  };

  it('OPD off: NO OPD request at all', () => {
    const { h, api } = host(false);
    h.loadOpd();
    expect(api.visits).not.toHaveBeenCalled();
    expect(api.paymentsDue).not.toHaveBeenCalled();
    expect(api.desk).not.toHaveBeenCalled();
    expect(api.board).not.toHaveBeenCalled();
    expect(api.proceduresToBook).not.toHaveBeenCalled();
  });

  it('OPD on: the OPD desk\'s own feeds for the chosen day (desk config once)', () => {
    const { h, api } = host(true);
    h.loadOpd();
    h.loadOpd();
    expect(api.visits).toHaveBeenCalledWith({ date: '2026-11-20' });
    expect(api.paymentsDue).toHaveBeenCalledTimes(2);
    expect(api.desk).toHaveBeenCalledTimes(1);
    expect(h._opdVisits().length).toBe(1);
    // The doctors board (Clinic view) and Procedures to book (Bookings pill), moved in from /opd/desk/classic.
    expect(api.board).toHaveBeenCalledTimes(2);
    expect(api.proceduresToBook).toHaveBeenCalledTimes(2);
    expect(h._opdBoard().length).toBe(1);
    expect(h._toBook().length).toBe(1);
  });

  it('the landing: OPD = the shelf\'s own rule; rows join every list, the counts, the chart and the shelf; a row opens the visit', () => {
    const ts = readFileSync('apps/lms/src/app/features/frontdesk/frontdesk-landing/frontdesk-landing.component.ts', 'utf8');
    expect(ts).toContain("readonly opdOn = computed(() => this.serviceShelf.services().some(s => s.id === 'opd'));");
    expect(ts).toMatch(/private readonly _opdAll = computed<FlowRow\[\]>\(\(\) => \{\s*if \(!this\.opdOn\(\)\) return \[\];/);
    expect(ts).toMatch(/private readonly _opdShown = computed<FlowRow\[\]>\(\(\) => \{\s*if \(!this\.svcOn\('opd'\)\) return \[\];/);
    expect(ts).toContain('rows = [...rows, ...this.opdRowsFor(tab).map(r => ({ ...r }))];');
    expect(ts).toContain("for (const r of this._opdAll()) items.push({ service: 'opd', late: r.late });");
    expect(ts).toMatch(/\.\.\.this\._opdAll\(\)\.filter\(r => r\.visit && opdVisitOpen\(r\.visit\)\)\.map\(whoItemOf\)/);
    expect(ts).toContain("if (row.kind === 'visit') { if (row.visit) this.openOpdVisit(row.visit); return; }");
    expect(ts).toContain("openOpdVisit(v: OpdVisitRow): void { void this.router.navigate(['/opd/visit', v.id]); }");
    const h = Object.create(proto);
    const nav = vi.fn();
    Object.assign(h, { router: { navigate: nav } });
    h.flowAct(opdVisitFlowRow(visit(), now), 'opd-open', null);
    expect(nav).toHaveBeenCalledWith(['/opd/visit', 'v1']);
  });
});

describe('the OPD desk route', () => {
  it('/opd/desk redirects to /frontdesk?service=opd behind opdGuard; the old page stays unlinked at /opd/desk/classic', () => {
    const desk = OPD_SHELL_ROUTES.find(r => r.path === 'opd/desk')!;
    expect(desk.loadComponent).toBeUndefined();
    expect((desk.canActivate ?? []).length).toBe(2);
    expect(((desk.canActivate![0]) as { opdGate?: boolean }).opdGate).toBe(true);
    const classic = OPD_SHELL_ROUTES.find(r => r.path === 'opd/desk/classic')!;
    expect(classic.loadComponent).toBeDefined();
    const src = readFileSync('apps/lms/src/app/features/opd/opd.routes.ts', 'utf8');
    expect(src).toContain("inject(Router).createUrlTree(['/frontdesk'], { queryParams: { service: 'opd' } })");
    const ts = readFileSync('apps/lms/src/app/features/frontdesk/frontdesk-landing/frontdesk-landing.component.ts', 'utf8');
    expect(ts).toContain("private readonly _pendingService = signal<string | null>(this.route.snapshot?.queryParamMap?.get('service') ?? null);");
  });
});
