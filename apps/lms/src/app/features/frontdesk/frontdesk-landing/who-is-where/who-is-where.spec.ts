import { readFileSync } from 'node:fs';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { TenantEntitlementsService } from '../../../../core/services/tenant-entitlements.service';
import { OpdGateService } from '../../../opd/shared/opd-gate.service';
import { ServiceShelfService } from '../../../../core/services/service-shelf.service';
import { SERVICES, serviceChips, type ServiceDef } from '../../../../core/services/service-shelf';
import type { FlowRow } from '../flow-grid/flow-row';
import { FrontdeskLandingComponent } from '../frontdesk-landing.component';
import { WhoIsWhereComponent } from './who-is-where.component';
import {
  OTHER_STEP, SUN, WhoItem, apptOverdueMin, apptStartMs, apptTabAria, arcPath, buildWhoTree, centreOf, describeSlice,
  effectiveSideTab, layoutSunburst, sideTabOptions, sliceOn, stepOfRow, sunDiameter, whoItemOf,
} from './who-is-where';

/**
 * Frontdesk side card "Who is where" (owner-approved 2026-11-20): sunburst geometry + counts, the step derivation,
 * ONE service filter (chart ⇄ chips ⇄ bottom-bar shelf ⇄ appointment list), single-service = no chart tab, the
 * overdue dot.
 */
const LAB_OPD: ServiceDef[] = SERVICES.filter(s => s.id === 'lab' || s.id === 'opd');
const it_ = (service: WhoItem['service'], step: string, late = false, waitMin: number | null = 5, token = '#1', name = 'Ms. Arya Stark'): WhoItem =>
  ({ service, step, late, waitMin, token, name });

describe('step derivation (the flow grid\'s "Where now")', () => {
  const row = (where: string, kind: FlowRow['kind'] = 'order') => ({ kind, where });
  it('the head word of Where now; drafts read Draft; nothing → Other', () => {
    expect(stepOfRow(row('Billed'))).toBe('Billed');
    expect(stepOfRow(row('In Lab'))).toBe('In Lab');
    expect(stepOfRow(row('Not collected — Patient refused'))).toBe('Not collected');
    expect(stepOfRow(row('2 of 3 not collected — Vein'))).toBe('Not collected');
    expect(stepOfRow(row('At partner lab', 'synthetic'))).toBe('At partner lab');
    expect(stepOfRow(row('Draft', 'draft'))).toBe('Draft');
    expect(stepOfRow(row('anything', 'draft'))).toBe('Draft');
    expect(stepOfRow(row(''))).toBe(OTHER_STEP);
    expect(stepOfRow(row('   '))).toBe(OTHER_STEP);
  });

  it('a flow row → a chart item (service, step, late, wait, token, name)', () => {
    const r = { kind: 'order', where: 'Billed', service: 'opd', late: true, waitMin: 41, name: 'Mr. Gopal T', order: { dailyNo: 14 } } as unknown as FlowRow;
    expect(whoItemOf(r)).toEqual({ service: 'opd', step: 'Billed', late: true, waitMin: 41, token: '#14', name: 'Mr. Gopal T' });
    expect(whoItemOf({ ...r, kind: 'draft', order: null } as unknown as FlowRow).token).toBe('');
  });
});

describe('tree + counts', () => {
  const items = [
    it_('lab', 'Billed'), it_('lab', 'Billed', true, 41), it_('lab', 'In Lab'), it_('lab', OTHER_STEP),
    it_('opd', 'Billed', true, 34), it_('ipd', 'Admitted'),          // IPD not granted → dropped
  ];
  const tree = buildWhoTree(items, LAB_OPD);

  it('every granted service in shelf order; steps by count, "Other" last; late counted', () => {
    expect(tree.map(s => [s.id, s.n, s.late])).toEqual([['lab', 4, 1], ['opd', 1, 1]]);
    expect(tree[0].steps.map(s => [s.step, s.n, s.late])).toEqual([['Billed', 2, 1], ['In Lab', 1, 0], [OTHER_STEP, 1, 0]]);
    expect(buildWhoTree([], LAB_OPD).map(s => s.n)).toEqual([0, 0]);
  });

  it('centre: "N in the clinic", or the filter\'s name + its count', () => {
    expect(centreOf(tree, 'all', null)).toEqual({ n: 5, label: 'in the clinic', filtered: false });
    expect(centreOf(tree, 'lab', null)).toEqual({ n: 4, label: 'Lab', filtered: true });
    expect(centreOf(tree, 'lab', 'Billed')).toEqual({ n: 2, label: 'Billed', filtered: true });
  });

  it('the description card: title, count, late + longest wait, tokens, what a click does', () => {
    const c = describeSlice(tree, 'lab', 'Billed', { service: 'all', step: null })!;
    expect(c.title).toBe('Lab › Billed');
    expect(c.n).toBe(2);
    expect(c.lines[0]).toBe('1 late · longest wait 41m');
    expect(c.lines[1]).toBe('#1 Arya · #1 Arya');
    expect(c.action).toBe('Click to show only these');
    const svc = describeSlice(tree, 'lab', null, { service: 'lab', step: null })!;
    expect(svc.lines[1]).toBe('Billed 2 · In Lab 1 · Other 1');
    expect(svc.action).toBe('Click again for everyone');
    expect(describeSlice(tree, 'opd', 'Nope', { service: 'all', step: null })).toBeNull();
  });
});

describe('sunburst geometry', () => {
  const tree = buildWhoTree([it_('lab', 'Billed'), it_('lab', 'Billed'), it_('lab', 'In Lab'), it_('opd', 'Billed')], LAB_OPD);
  const slices = layoutSunburst(tree);

  it('inner ring = services, outer = steps; angles are each share of ALL rows and close the circle', () => {
    const inner = slices.filter(s => s.ring === 'service');
    const outer = slices.filter(s => s.ring === 'step');
    expect(inner.map(s => [s.service, s.n])).toEqual([['lab', 3], ['opd', 1]]);
    expect(outer.map(s => [s.service, s.step, s.n])).toEqual([['lab', 'Billed', 2], ['lab', 'In Lab', 1], ['opd', 'Billed', 1]]);
    // Late rows of a step: their own soft-rose part of the same step.
    const lateTree = buildWhoTree([it_('lab', 'Billed'), it_('lab', 'Billed', true), it_('lab', 'Billed', true)], LAB_OPD);
    const parts = layoutSunburst(lateTree).filter(s => s.ring === 'step');
    expect(parts.map(s => [s.step, s.n, s.late])).toEqual([['Billed', 1, 0], ['Billed', 2, 2]]);
    expect(parts[1].a0).toBeCloseTo(parts[0].a1);
    expect(inner[0].a0).toBe(0);
    expect(inner[0].a1).toBeCloseTo(Math.PI * 1.5);
    expect(inner[1].a1).toBeCloseTo(Math.PI * 2);
    // A service's steps span exactly its own wedge.
    expect(outer[0].a0).toBe(inner[0].a0);
    expect(outer[1].a1).toBeCloseTo(inner[0].a1);
    expect(new Set(slices.map(s => s.key)).size).toBe(slices.length);
  });

  it('paths: annular sectors on the two rings; a full turn is two halves; empty = no slices', () => {
    expect(slices[0].d.startsWith(`M${SUN.c} ${SUN.c - SUN.inner[1]}`)).toBe(true);     // 12 o'clock, outer edge
    expect(slices[0].d).toContain(`A${SUN.inner[1]} ${SUN.inner[1]} 0 1 1`);           // 270° → large arc
    const full = arcPath(10, 20, 0, 2 * Math.PI);
    expect(full.match(/M/g)?.length).toBe(2);
    expect(full).not.toContain('NaN');
    expect(layoutSunburst(buildWhoTree([], LAB_OPD))).toEqual([]);
  });

  it('labels only where the slice is wide enough; the label sits mid-ring', () => {
    const many = layoutSunburst(buildWhoTree([...Array.from({ length: 40 }, () => it_('lab', 'Billed')), it_('opd', 'Billed')], LAB_OPD));
    const opd = many.find(s => s.ring === 'service' && s.service === 'opd')!;
    expect(opd.label).toBeNull();
    const lab = many.find(s => s.ring === 'service' && s.service === 'lab')!;
    const r = Math.hypot(lab.label!.x - SUN.c, lab.label!.y - SUN.c);
    expect(r).toBeCloseTo((SUN.inner[0] + SUN.inner[1]) / 2, 0);
  });

  it('a full-turn slice (one service / one step) carries no number — the centre says it', () => {
    const one = layoutSunburst(buildWhoTree([it_('lab', 'Billed')], LAB_OPD));
    expect(one.map(s => s.label)).toEqual([null, null]);
    const two = layoutSunburst(buildWhoTree([it_('lab', 'Billed'), it_('lab', 'In Lab')], LAB_OPD));
    expect(two.find(s => s.ring === 'service')!.label).toBeNull();          // the service still spans the circle
    expect(two.filter(s => s.ring === 'step').every(s => s.label !== null)).toBe(true);
  });

  it('the diameter fits the panel: min(w − 32, h − below − 32, 360), never under 200', () => {
    expect(sunDiameter(316, 900, 120)).toBe(284);       // width-bound (340px side card)
    expect(sunDiameter(600, 400, 120)).toBe(248);       // height-bound
    expect(sunDiameter(900, 900, 100)).toBe(360);       // capped
    expect(sunDiameter(200, 200, 150)).toBe(200);       // floor
    expect(sunDiameter(0, 0, 0)).toBe(240);             // not measured yet
  });

  it('a filter lights its service (+ step) and greys the rest', () => {
    const lab = { service: 'lab' as const, step: null }, labBilled = { service: 'lab' as const, step: 'Billed' };
    const opdBilled = { service: 'opd' as const, step: 'Billed' }, labInLab = { service: 'lab' as const, step: 'In Lab' };
    expect(sliceOn(opdBilled, 'all', null)).toBe(true);
    expect(sliceOn(lab, 'lab', null)).toBe(true);
    expect(sliceOn(opdBilled, 'lab', null)).toBe(false);
    expect(sliceOn(labBilled, 'lab', 'Billed')).toBe(true);
    expect(sliceOn(labInLab, 'lab', 'Billed')).toBe(false);
    expect(sliceOn(lab, 'lab', 'Billed')).toBe(true);                  // its service slice stays lit
  });
});

describe('appointments: overdue + the tab dot', () => {
  const at = (iso: string, slot?: string, status = 'booked') => ({ status, appointmentDate: iso, slotTime: slot });
  const now = new Date(2026, 10, 20, 12, 3).getTime();

  it('a booked slot in the past is overdue by its minutes; checked-in / future / no-time-today never', () => {
    expect(apptStartMs(at(new Date(2026, 10, 20).toISOString(), '11:45'))).toBe(new Date(2026, 10, 20, 11, 45).getTime());
    expect(apptOverdueMin(at(new Date(2026, 10, 20).toISOString(), '11:45'), now)).toBe(18);
    expect(apptOverdueMin(at(new Date(2026, 10, 20).toISOString(), '11:45', 'checked_in'), now)).toBeNull();
    expect(apptOverdueMin(at(new Date(2026, 10, 20).toISOString(), '12:30'), now)).toBeNull();
    expect(apptOverdueMin(at(new Date(2026, 10, 20).toISOString()), now)).toBeNull();          // no slot: due all day
    expect(apptOverdueMin(at(new Date(2026, 10, 20, 11, 0).toISOString()), now)).toBe(63);     // a date-time
    expect(apptOverdueMin(at('not a date', '10:00'), now)).toBeNull();
  });

  it('the Appointments tab: count, a rose dot only when overdue, and an aria-label that says so', () => {
    expect(apptTabAria(7, 1)).toBe('Appointments, 7, 1 overdue');
    expect(apptTabAria(7, 0)).toBe('Appointments, 7');
    const t = sideTabOptions({ who: true, appt: true, home: true, apptN: 7, overdue: 1, homeN: 2 });
    expect(t.map(o => [o.value, o.label, o.count])).toEqual([['who', 'Who is where', undefined], ['appt', 'Appointments', 7], ['home', 'Home', 2]]);
    expect(t[1].alert).toBe(true);
    expect(t[1].aria).toBe('Appointments, 7, 1 overdue');
    expect(sideTabOptions({ who: true, appt: true, home: false, apptN: 3, overdue: 0, homeN: 0 })[1].alert).toBe(false);
  });

  it('pf-segmented renders the dot and the aria override (additive options)', () => {
    const seg = readFileSync('libs/shared/src/lib/primitives/segmented.component.ts', 'utf8');
    expect(seg).toContain('[attr.aria-label]="opt.aria || opt.label"');
    expect(seg).toContain('@if (opt.alert) { <span class="seg-alert" aria-hidden="true"></span> }');
  });
});

describe('single-service tenants: no chart, no "Who is where" tab', () => {
  it('tabs are exactly today\'s Appointments | Home collection', () => {
    const t = sideTabOptions({ who: false, appt: true, home: true, apptN: 2, overdue: 0, homeN: 1 });
    expect(t.map(o => [o.value, o.label])).toEqual([['appt', 'Appointments'], ['home', 'Home collection']]);
  });

  it('a remembered "Who is where" falls back to Appointments (Home when appointments are off)', () => {
    expect(effectiveSideTab('who', { who: false, appt: true, home: true })).toBe('appt');
    expect(effectiveSideTab('who', { who: false, appt: false, home: true })).toBe('home');
    expect(effectiveSideTab('who', { who: true, appt: true, home: true })).toBe('who');
    expect(effectiveSideTab('home', { who: false, appt: true, home: true })).toBe('home');
  });

  it('the chart tab needs 2+ services (the shelf\'s own rule), the new design and side-by-side cards', () => {
    const ts = readFileSync('apps/lms/src/app/features/frontdesk/frontdesk-landing/frontdesk-landing.component.ts', 'utf8');
    expect(ts).toContain('readonly whoTabOn = computed(() => this.theme.isNewDesign() && this.wide() && this.serviceShelf.multi());');
    const html = readFileSync('apps/lms/src/app/features/frontdesk/frontdesk-landing/frontdesk-landing.component.html', 'utf8');
    expect(html).toMatch(/@if \(leftTab\(\) === 'who'\) \{\s*<div class="fd-who-body">\s*<pf-fd-who-is-where/);
    // "+ New" opens the EXISTING book-appointment flow, for every tenant.
    expect(html).toMatch(/data-testid="fd-new-appt"\s*\(click\)="bookAppointment\(\)"/);
    // The card head: icon + the panel's name + count; the switch is its own full-width row under it.
    expect(html).toMatch(/<span class="fd-side-title" data-testid="fd-side-title">\s*<span class="pf-card__icon" aria-hidden="true">[\s\S]{0,700}<span class="pf-card__label">Visits<\/span>/);
    expect(html).toMatch(/<div class="fd-side-switch">\s*<pf-segmented class="pf-tabs fd-side-tabs"/);
  });
});

/* ── ONE filter: chart ⇄ chips ⇄ bottom-bar shelf ⇄ the side card lists ─────────────────────────────────────── */

function shelfService(opd = true): ServiceShelfService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: Router, useValue: { url: '/frontdesk', events: new Subject() } },
      { provide: AuthService, useValue: { user: signal({ id: 'u-chart' }), hasAnyPermission: () => true } },
      { provide: TenantEntitlementsService, useValue: { modules: signal([]), moduleOn: (id: string) => id === 'lab' } },
      { provide: OpdGateService, useValue: { visible: signal(opd) } },
    ],
  });
  try { localStorage.removeItem('pf-lms.frontdesk.service.u-chart'); } catch { /* ignore */ }
  return TestBed.inject(ServiceShelfService);
}

describe('one filter state (ServiceShelfService)', () => {
  it('a chart pick IS the shelf pick: the shelf chip, the step and the remembered choice all follow', () => {
    const s = shelfService();
    expect(s.multi()).toBe(true);
    s.pick('lab', 'Billed');
    expect(s.selected()).toBe('lab');
    expect(s.step()).toBe('Billed');
    expect(serviceChips(s.services(), { total: 0, late: false, by: {} }, s.selected()).find(c => c.selected)?.id).toBe('lab');
    expect(localStorage.getItem('pf-lms.frontdesk.service.u-chart')).toBe('lab');
    // The same pick again = everyone (the chart's "click again for everyone").
    s.pick('lab', 'Billed');
    expect(s.selected()).toBe('all');
    expect(s.step()).toBeNull();
    // A service slice while a step is on narrows back to the whole service, it does not clear.
    s.pick('lab', 'Billed');
    s.pick('lab', null);
    expect([s.selected(), s.step()]).toEqual(['lab', null]);
  });

  it('the shelf radio clears the chart\'s step; the centre (All) clears everything', () => {
    const s = shelfService();
    s.pick('lab', 'Billed');
    s.select('opd');
    expect([s.selected(), s.step()]).toEqual(['opd', null]);
    s.pick('lab', 'Billed');
    s.pick('all');
    expect([s.selected(), s.step()]).toEqual(['all', null]);
  });

  it('a lab-only user: no multi, never filtered (the chart / chips don\'t exist)', () => {
    const s = shelfService(false);
    expect(s.multi()).toBe(false);
    s.pick('opd', 'Billed');
    expect(s.selected()).toBe('all');
    expect(s.step()).toBeNull();
  });

  it('the landing reads the SAME store for the grid, the side lists and the filter chip', () => {
    const s = shelfService();
    const h = Object.create(FrontdeskLandingComponent.prototype as object) as any;
    h.serviceShelf = s;
    h.workSel = { clear: vi.fn() };
    h.pickService({ service: 'opd', step: null });
    expect(h.svcOn('lab')).toBe(false);          // → appointments / home collection (Lab bookings) empty out
    expect(h.svcOn('opd')).toBe(true);
    expect(h.svcPass({ module: 'opd' })).toBe(true);
    expect(h.svcPass({ module: null })).toBe(false);
    expect(h.workSel.clear).toHaveBeenCalled();
    h.pickService({ service: 'lab', step: null });
    expect(h.svcOn('lab')).toBe(true);
    h.clearServiceFilter();                      // the "Lab ✕" chip
    expect(s.selected()).toBe('all');
    const ts = readFileSync('apps/lms/src/app/features/frontdesk/frontdesk-landing/frontdesk-landing.component.ts', 'utf8');
    // The step narrows the grid with the very function the chart counts with.
    expect(ts).toMatch(/const step = this\.svcStep\(\);\s*if \(step\) rows = rows\.filter\(r => stepOfRow\(r\) === step\);/);
    // The chart counts the active rows of EVERY service (before the filter), mapped exactly like the grid.
    expect(ts).toMatch(/readonly whoItems = computed<WhoItem\[\]>\(\(\) => \{[\s\S]{0,300}this\.draftOrders\(\)\.map\(d => whoItemOf\(draftFlowRow\(d, now\)\)\)[\s\S]{0,120}this\._ipAll\(\)\.map\(o => whoItemOf\(orderFlowRow\(o, p, now, \{ primary: 'ip' \}\)\)\)/);
    const html = readFileSync('apps/lms/src/app/features/frontdesk/frontdesk-landing/frontdesk-landing.component.html', 'utf8');
    expect(html).toMatch(/\[service\]="svcSelected\(\)"\s*\[step\]="svcStep\(\)" \(pick\)="pickService\(\$event\)"/);
    expect(html).toMatch(/svcFilterLabel\(\); as l\) \{[\s\S]{0,300}class="fd-side-sub__chip press"[\s\S]{0,120}\(click\)="clearServiceFilter\(\)"/);
    // Pane actions in the head (calendar + "+ New"); the week strip is the ONE date picker, with ‹ › weeks.
    expect(html).toMatch(/data-testid="fd-side-cal"/);
    expect(html).toMatch(/\(click\)="shiftApptWeek\(-1\)" aria-label="Previous week"/);
    expect(html).toMatch(/\(click\)="shiftApptWeek\(1\)" aria-label="Next week"/);
    expect(html).not.toContain('fd-side-dates');
  });
});

describe('<pf-fd-who-is-where>', () => {
  const items = [it_('lab', 'Billed'), it_('lab', 'Billed', true, 41, '#3', 'Mr. Sathish Kumar'), it_('lab', 'In Lab'), it_('opd', 'Billed', true, 34)];
  function mount(service: 'all' | 'lab' | 'opd' = 'all', step: string | null = null) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [WhoIsWhereComponent] });
    const f = TestBed.createComponent(WhoIsWhereComponent);
    f.componentRef.setInput('items', items);
    f.componentRef.setInput('services', LAB_OPD);
    f.componentRef.setInput('service', service);
    f.componentRef.setInput('step', step);
    f.detectChanges();
    const picks: unknown[] = [];
    f.componentInstance.pick.subscribe(p => picks.push(p));
    return { f, el: f.nativeElement as HTMLElement, picks };
  }

  it('slices are focusable buttons with counts; Enter = click; the centre clears', () => {
    const { el, picks } = mount();
    const paths = [...el.querySelectorAll<SVGPathElement>('path.wiw__slice')];
    expect(paths.length).toBe(2 + 4);   // lab › Billed is split: on time + late
    expect(paths.every(p => p.getAttribute('tabindex') === '0' && p.getAttribute('role') === 'button')).toBe(true);
    const billedParts = [...el.querySelectorAll<SVGPathElement>('path[data-svc="lab"][data-step="Billed"]')];
    expect(billedParts.map(p => p.getAttribute('aria-label'))).toEqual(['Lab › Billed, 1', 'Lab › Billed, 1 late']);
    expect(billedParts.map(p => p.classList.contains('wiw__slice--late'))).toEqual([false, true]);   // late rows → soft rose
    const billed = billedParts[0];
    billed.dispatchEvent(new MouseEvent('click'));
    billed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    (el.querySelector('.wiw__ctr') as HTMLButtonElement).click();
    expect(picks).toEqual([{ service: 'lab', step: 'Billed' }, { service: 'lab', step: 'Billed' }, { service: 'all', step: null }]);
    expect(el.querySelector('.wiw__ctr')!.textContent).toContain('4');
    expect(el.querySelector('.wiw__ctr')!.textContent).toContain('in the clinic');
  });

  it('chips: dot + name + count + rose "n late"; a chip click = the same pick', () => {
    const { el, picks } = mount();
    const chips = [...el.querySelectorAll<HTMLButtonElement>('.wiw__chip')];
    const parts = (c: Element) => [...c.querySelectorAll('span')].map(x => x.textContent!.trim());
    expect(chips.map(parts)).toEqual([['Lab', '3', '1 late'], ['OPD', '1', '1 late']]);
    expect(chips.every(c => c.querySelector('.wiw__dot'))).toBe(true);
    chips[1].click();
    expect(picks).toEqual([{ service: 'opd', step: null }]);
  });

  it('a filter in force: its slices lit, the rest grey; the centre names it; its chip is pressed', () => {
    const { el } = mount('lab', 'Billed');
    expect(el.querySelector('.wiw')!.classList.contains('wiw--filtered')).toBe(true);
    const on = [...el.querySelectorAll('path.wiw__slice.is-on')].map(p => `${p.getAttribute('data-svc')}:${p.getAttribute('data-step') ?? ''}`);
    expect(on.sort()).toEqual(['lab:', 'lab:Billed', 'lab:Billed']);
    expect(el.querySelector('.wiw__ctr')!.textContent).toContain('Billed');
    expect(el.querySelector('.wiw__ctr')!.textContent).toContain('tap for all');
    expect(el.querySelector('.wiw__chip[data-svc="lab"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('hover (pointer only) greys the rest and shows the description card; touch never; focus does', () => {
    const { f, el } = mount();
    const c = f.componentInstance;
    const billed = c.slices().find(s => s.step === 'Billed' && s.service === 'lab')!;
    c.pointerOver({ pointerType: 'touch', clientX: 10, clientY: 10 } as PointerEvent, 'lab', 'Billed');
    f.detectChanges();
    expect(el.querySelector('.wiw__tip')).toBeNull();
    c.pointerOver({ pointerType: 'mouse', clientX: 100, clientY: 100 } as PointerEvent, 'lab', 'Billed');
    f.detectChanges();
    expect(el.querySelector('.wiw')!.classList.contains('wiw--hovering')).toBe(true);
    const tip = el.querySelector('.wiw__tip')!.textContent!.replace(/\s+/g, ' ');
    expect(tip).toContain('Lab › Billed');
    expect(tip).toContain('1 late · longest wait 41m');
    expect(tip).toContain('#3 Sathish');
    expect(tip).toContain('Click to show only these');
    expect(el.querySelector('path[data-svc="opd"]')!.classList.contains('is-hov')).toBe(false);
    c.unhover();
    f.detectChanges();
    expect(el.querySelector('.wiw__tip')).toBeNull();
    c.focusOn(billed);
    f.detectChanges();
    expect(el.querySelector('.wiw__tip')).not.toBeNull();
  });

  it('nothing active: an empty ring, no slices, a calm line', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [WhoIsWhereComponent] });
    const f = TestBed.createComponent(WhoIsWhereComponent);
    f.componentRef.setInput('services', LAB_OPD);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelectorAll('path.wiw__slice').length).toBe(0);
    expect(el.querySelector('circle.wiw__empty')).not.toBeNull();
    expect(el.textContent).toContain('Nobody in the clinic right now');
  });

  it('theme tokens only (no hex outside var() fallbacks), reduced motion respected, no emoji', () => {
    const scss = readFileSync('apps/lms/src/app/features/frontdesk/frontdesk-landing/who-is-where/who-is-where.component.scss', 'utf8');
    const bare = scss.replace(/var\([^()]*(\([^()]*\))?[^()]*\)/g, '').match(/#[0-9a-f]{3,8}\b/gi);
    expect(bare).toBeNull();
    expect(scss).toContain('prefers-reduced-motion: reduce');
    const ts = readFileSync('apps/lms/src/app/features/frontdesk/frontdesk-landing/who-is-where/who-is-where.component.ts', 'utf8');
    expect(ts + scss).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
