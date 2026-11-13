import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AppointmentsCalendarComponent } from './appointments-calendar.component';
import { APPOINTMENTS_CALENDAR_ND_STYLES, apptStatusTone, apptStatusWord, matchesAppointment, placeLanes } from './appointments-calendar.nd';
import { ApiService } from '../../../core/services/api.service';
import { AppointmentBookingService } from '../../../core/services/appointment-booking.service';
import { AppointmentQueueService } from '../../../core/services/appointment-queue.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { PatientProfileService } from '../../../core/services/patient-profile.service';
import { ToastService } from '../../../core/services/toast.service';
import { ThemeService } from '../../../core/services/theme.service';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ZoomTransitionService } from '../../../core/navigation/zoom-transition';

/**
 * Appointments calendar — NEW DESIGN (PF-PATTERN §21): the band (back ·
 * tenant · ONE primary "New appointment"), the pill (search + the neutral
 * Day / Week / Month switch + date navigation), CALENDAR (main) + DAY (the
 * collapsible right companion: the chosen day's list → an appointment's
 * detail). Every original action (book from a slot / day, open the
 * profile, check in, reschedule, no-show, complete, mark urgent, cancel)
 * stays reachable, on the same APIs.
 */
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = new Date(); TODAY.setHours(12, 0, 0, 0);
/** Another day in the SAME Monday-first week as today (weeks end on Sunday). */
const OTHER = new Date(TODAY); OTHER.setDate(TODAY.getDate() + (TODAY.getDay() === 0 ? -1 : 1));
const LATE = '23:30';   // later than "now" whenever the suite runs (bar the last half hour)

const P1 = { id: 'p1', firstName: 'Paravai', fathersName: 'Munusamy', title: 'Ms.', age: 44, sex: 'Female', mrn: 'AA0007', phone: '9000000001' };
const P2 = { id: 'p2', firstName: 'Anbu', fathersName: 'Selvan', age: 30, sex: 'Male', mrn: 'AA0003', phone: '9000000003' };
const appt = (id: string, p: any, day: Date, time: string, status: string, extra: any = {}) => ({
  id, tenantId: 't', patientId: p.id, branchId: 'b', type: 'appointment', collectionType: 'walkin',
  appointmentDate: `${iso(day)}T00:00:00`, slotTime: time, status, consultationFee: 0, createdAt: '', patient: p, ...extra,
});
const A1 = appt('a1', P1, TODAY, '10:30', 'booked', { testIds: 't1,t2', notes: 'Fasting' });
const A2 = appt('a2', P2, TODAY, '10:30', 'checked_in', { tokenNumber: 7 });
const A3 = appt('a3', P2, OTHER, '09:00', 'completed');

interface Opts { narrow?: boolean; phone?: boolean; classic?: boolean; list?: any[] }

const realMatchMedia = (window as any).matchMedia;
beforeEach(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null), setItem: (k: string, v: string) => { mem.set(k, String(v)); },
             removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear() },
    configurable: true, writable: true,
  });
});
afterEach(() => {
  TestBed.resetTestingModule();
  (window as any).matchMedia = realMatchMedia;
});

function render(opts: Opts = {}) {
  (window as any).matchMedia = (q: string) => ({
    matches: q.includes('900px') ? !!(opts.narrow || opts.phone) : q.includes('640px') ? !!opts.phone : false,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  const api = { get: vi.fn((url: string) => url.startsWith('/api/appointments') ? of(opts.list ?? [A1, A2, A3]) : of([])) };
  const queue = {
    checkIn: vi.fn(() => of({})), noShow: vi.fn(() => of({})), complete: vi.fn(() => of({})),
    markUrgent: vi.fn(() => of({})), cancel: vi.fn(() => of({})), reschedule: vi.fn(() => of({})),
  };
  const router = { navigate: vi.fn(() => Promise.resolve(true)), navigateByUrl: vi.fn() };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  const navBack = { showBack: () => true, back: vi.fn(), backTo: vi.fn() };
  const profile = { open: vi.fn() };
  const zoom = { runLocal: vi.fn((_d: string, fn: () => void) => fn()), disarm: vi.fn(), tap: () => true,
                 holding: signal(false), attachTarget() {}, detachTarget() {}, attachSource() {}, detachSource() {} };
  TestBed.configureTestingModule({
    imports: [AppointmentsCalendarComponent],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: AppointmentQueueService, useValue: queue },
      { provide: AppointmentBookingService, useValue: { bookedAt: signal(0) } },
      { provide: PatientProfileService, useValue: profile },
      { provide: ToastService, useValue: toasts },
      { provide: NavBackService, useValue: navBack },
      { provide: Router, useValue: router },
      { provide: Location, useValue: {} },
      { provide: ThemeService, useValue: { isNewDesign: () => !opts.classic } },
      { provide: AuthService, useValue: { user: () => ({ id: 'u1', tenantName: 'Micro World' }), hasPermission: () => true } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }) } },
      { provide: ZoomTransitionService, useValue: zoom },
    ],
  });
  const f = TestBed.createComponent(AppointmentsCalendarComponent);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const c = f.componentInstance as any;
  const view = (v: 'day' | 'week' | 'month') => { c.setView(v); c.cursor.set(new Date(TODAY)); f.detectChanges(); };
  return { f, el, c, api, queue, router, toasts, navBack, profile, zoom, view };
}

const primaries = (el: HTMLElement) => el.querySelectorAll('.pf-btn--primary, .pf-hb-btn--primary');
const texts = (els: NodeListOf<Element> | Element[]) => Array.from(els).map(e => e.textContent?.replace(/\s+/g, ' ').trim());
const click = (el: Element | null) => (el as HTMLElement).click();

describe('Appointments calendar (nd) — band + pill', () => {
  it('the band: back to /frontdesk, the tenant, and ONE primary "New appointment"', () => {
    const { el, navBack, router } = render();
    expect(el.querySelector('pf-hero-band')).not.toBeNull();
    expect(el.querySelector('.pf-hb__name')?.textContent).toContain('Micro World');
    click(el.querySelector('.pf-hb__back'));
    expect(navBack.backTo).toHaveBeenCalledWith('/frontdesk');
    expect(primaries(el).length).toBe(1);
    const cta = el.querySelector('.pf-hb__actions .pf-hb-btn--primary')!;
    expect(cta.getAttribute('aria-label')).toBe('New appointment');
    click(cta);
    expect(router.navigate).toHaveBeenCalledWith(['/frontdesk/appointments/new']);
    // No page title / old header.
    expect(el.querySelector('h1')).toBeNull();
    expect(el.querySelector('.pf-cal-page')).toBeNull();
  });

  it('the pill holds the search, the neutral Day / Week / Month switch and the date navigation', () => {
    const { el, c, f } = render();
    const pill = el.querySelector('.pf-hb__search')!;
    expect(pill.querySelector<HTMLInputElement>('input.pf-apc-search__input')?.placeholder).toBe('Search patient, phone or MRN');
    const seg = pill.querySelector('.pf-seg.pf-apc-views[role="radiogroup"]')!;
    expect(texts(seg.querySelectorAll('[role="radio"]'))).toEqual(['Day', 'Week', 'Month']);
    // Month is the web default; the switch is neutral (aria-checked, no gradient / --on class).
    expect(seg.querySelector('[aria-checked="true"]')?.textContent?.trim()).toBe('Month');
    expect(seg.querySelector('[class*="--on"]')).toBeNull();
    click(seg.querySelectorAll('[role="radio"]')[1]);
    f.detectChanges();
    expect(c.view()).toBe('week');
    // Arrow keys move the switch (one Tab stop).
    (seg.querySelector('[aria-checked="true"]') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    f.detectChanges();
    expect(c.view()).toBe('month');
    // ‹ Today › + jump: the jump is a button that opens the kit calendar popover (f5969db1) — no native date input.
    expect(pill.querySelectorAll('.pf-apc-nav__btn').length).toBe(3);   // ‹ › and the jump button
    expect(pill.querySelector('.pf-apc-nav__today')?.textContent?.trim()).toBe('Today');
    expect(pill.querySelectorAll('input[type="date"]').length).toBe(0);
    const jump = pill.querySelector<HTMLButtonElement>('.pf-apc-nav__btn.pf-apc-jump')!;
    expect(jump.getAttribute('aria-label')).toBe('Jump to a date');
    click(jump); f.detectChanges();
    expect(el.querySelector('.pf-apc-jump-pop[role="dialog"] pf-calendar')).not.toBeNull();
    click(jump); f.detectChanges();                                       // toggles closed again
    expect(el.querySelector('.pf-apc-jump-pop')).toBeNull();
    const before = c.cursor().getTime();
    click(pill.querySelectorAll('.pf-apc-nav__btn')[1]);
    expect(c.cursor().getTime()).toBeGreaterThan(before);
    click(pill.querySelector('.pf-apc-nav__today'));
    expect(iso(c.cursor())).toBe(iso(new Date()));
  });

  it('the search filters by name, phone or MRN — the grid, the counts and the day list', () => {
    const { el, c, f, view } = render();
    view('week');
    expect(el.querySelectorAll('.pf-apc-ev').length).toBe(3);
    c.query.set('aa0007'); f.detectChanges();
    expect(texts(el.querySelectorAll('.pf-apc-ev__name'))).toEqual(['Ms. Paravai Munusamy']);
    expect(el.querySelector('.pf-apc-main .pf-apc-count')?.textContent).toContain('1 match');
    c.query.set('9000000003'); f.detectChanges();
    expect(el.querySelectorAll('.pf-apc-ev').length).toBe(2);
    c.query.set('selvan'); f.detectChanges();
    expect(el.querySelectorAll('.pf-apc-side .pf-apc-row').length).toBe(1);
  });
});

describe('Appointments calendar (nd) — the grid', () => {
  it('week: neutral cards with the FULL name, a quiet meta line and the status as dot + word; today subtle', () => {
    const { el, view } = render();
    view('week');
    const cards = el.querySelectorAll('.pf-apc-main .pf-apc-ev');
    expect(cards.length).toBe(3);
    const a1 = Array.from(cards).find(e => e.textContent?.includes('Paravai'))!;
    expect(a1.querySelector('.pf-apc-ev__name')?.textContent?.trim()).toBe('Ms. Paravai Munusamy');
    expect(a1.querySelector('.pf-apc-ev__meta')?.textContent?.trim()).toBe('10:30 · 44/F · AA0007');
    expect(a1.querySelector('.pf-apc-ev__meta')?.classList).toContain('pf-num');
    const st = a1.querySelector('.pf-apc-status')!;
    expect(st.textContent?.trim()).toBe('Booked');
    expect(st.getAttribute('data-tone')).toBe('violet');
    expect(st.querySelector('.pf-apc-status__dot')).not.toBeNull();
    // Two at 10:30 sit side by side, never on top of each other.
    const same = Array.from(cards).filter(e => e.textContent?.includes('10:30')) as HTMLElement[];
    expect(same.map(e => e.style.width)).toEqual(['50%', '50%']);
    expect(new Set(same.map(e => e.style.left)).size).toBe(2);
    // …and, narrow in a week, they keep the full name + the dot (meta + word in the tooltip / label).
    expect(same.every(e => e.classList.contains('pf-apc-ev--tight'))).toBe(true);
    expect(same[0].getAttribute('title')).toMatch(/10:30 · .*, (Booked|Checked in)$/);
    // Today's header is marked (aria-current) and its column tinted.
    expect(el.querySelectorAll('.pf-apc-dayhdr--today[aria-current="date"]').length).toBe(1);
    expect(el.querySelectorAll('.pf-apc-col--today .pf-apc-now').length).toBe(1);
    expect(el.querySelectorAll('.pf-apc-dayhdr').length).toBe(7);
  });

  it('day: one column; an empty future slot books that time, a past slot warns', () => {
    const { el, router, toasts, view } = render();
    view('day');
    expect(el.querySelectorAll('.pf-apc-dayhdr').length).toBe(1);
    const late = el.querySelector(`.pf-apc-slot[aria-label^="Book ${LATE}"]`) as HTMLElement;
    click(late);
    if (!late.getAttribute('aria-disabled')) {
      expect(router.navigate).toHaveBeenCalledWith(['/frontdesk/appointments/new'], { queryParams: { date: iso(TODAY), time: LATE } });
    }
    const early = el.querySelector('.pf-apc-slot[aria-label^="Book 00:00"]') as HTMLElement;
    expect(early.getAttribute('aria-disabled')).toBe('true');
    click(early);
    expect(toasts.warning).toHaveBeenCalledWith('Cannot book an appointment in the past');
  });

  it('a day header opens that day (Day view); month: a day books, its count chip opens the day', () => {
    const { el, c, f, router, view } = render();
    view('week');
    click(el.querySelectorAll('.pf-apc-dayhdr')[0]);
    f.detectChanges();
    expect(c.view()).toBe('day');
    view('month');
    const cells = el.querySelectorAll('.pf-apc-mcell');
    expect(cells.length).toBe(42);
    const future = Array.from(cells).find(e => !e.classList.contains('pf-apc-mcell--past')) as HTMLElement;
    click(future);
    expect(router.navigate).toHaveBeenCalledWith(['/frontdesk/appointments/new'], { queryParams: { date: expect.any(String) } });
    const today = el.querySelector('.pf-apc-mcell--today')!;
    expect(today.querySelector('.pf-apc-mcell__n')?.getAttribute('aria-current')).toBe('date');
    const chip = today.querySelector('.pf-apc-mcell__chip')!;
    expect(chip.querySelector('.pf-num')?.textContent?.trim()).toBe('2');
    expect(chip.querySelector('.pf-apc-mcell__word')?.textContent?.trim()).toBe('appointments');
    expect(chip.getAttribute('aria-label')).toMatch(/: 2 appointments$/);
    router.navigate.mockClear();
    click(chip);
    f.detectChanges();
    expect(c.view()).toBe('day');
    expect(router.navigate).not.toHaveBeenCalled();
  });
});

describe('Appointments calendar (nd) — DAY companion + detail', () => {
  it('the right card lists the chosen day (week strip picks it), one row per appointment', () => {
    const { el, c, f, view } = render();
    view('week');
    const side = el.querySelector('aside.pf-card.pf-apc-side')!;
    expect(side.querySelector('.pf-card__label')?.textContent?.trim()).toBe('Day');
    expect(side.querySelector('.pf-apc-range')?.textContent).toContain('Today');
    const rows = side.querySelectorAll('.pf-apc-row');
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('.pf-apc-row__meta')?.textContent?.trim()).toMatch(/^10:30 · /);
    expect(texts(side.querySelectorAll('.pf-apc-status'))).toEqual(expect.arrayContaining(['Booked', 'Checked in']));
    // The strip: 7 days, the chosen one pressed; picking another day keeps the view.
    const days = side.querySelectorAll('.pf-apc-strip7__day');
    expect(days.length).toBe(7);
    const tmr = Array.from(days).find(d => d.getAttribute('aria-label') === c.longDate(OTHER));
    if (tmr) {
      click(tmr); f.detectChanges();
      expect(c.view()).toBe('week');
      expect(el.querySelectorAll('aside .pf-apc-row').length).toBe(1);
    }
  });

  it('a card / row opens the detail in the side card (zoom) with every original action', () => {
    const { el, f, queue, profile, zoom, view } = render();
    view('week');
    const card = Array.from(el.querySelectorAll('.pf-apc-ev')).find(e => e.textContent?.includes('Paravai'))!;
    expect(card.hasAttribute('data-zoom-src')).toBe(true);
    click(card); f.detectChanges();
    expect(zoom.runLocal).toHaveBeenCalledWith('in', expect.any(Function));
    const d = el.querySelector('aside.pf-apc-detail')!;
    expect(d.getAttribute('data-zoom-target')).toBe('a1');
    expect(d.querySelector('.pf-apc-subject__name')?.textContent?.trim()).toBe('Ms. Paravai Munusamy');
    expect(d.textContent).toContain('2 tests booked');
    expect(d.textContent).toContain('Fasting');
    expect(texts(d.querySelectorAll('.pf-apc-acts .pf-btn'))).toEqual(
      ['Open profile', 'Check in', 'Reschedule', 'No-show', 'Cancel appointment']);
    // The band CTA stays the only primary; Cancel is the muted-red outline.
    expect(primaries(el).length).toBe(1);
    expect(d.querySelector('.pf-btn--danger')?.textContent?.trim()).toBe('Cancel appointment');
    click(Array.from(d.querySelectorAll('.pf-apc-acts .pf-btn')).find(b => b.textContent?.trim() === 'Check in')!);
    expect(queue.checkIn).toHaveBeenCalledWith('a1');
    f.detectChanges();
    click(el.querySelector('.pf-apc-row')); f.detectChanges();
    click(Array.from(el.querySelectorAll('aside .pf-apc-acts .pf-btn')).find(b => b.textContent?.trim() === 'Open profile')!);
    expect(profile.open).toHaveBeenCalledWith('p1');
  });

  it('checked-in: Complete · Mark urgent · No-show · Cancel; each on its API', () => {
    const { el, f, queue, c } = render();
    c.openAppt(A2); f.detectChanges();
    const acts = texts(el.querySelectorAll('aside .pf-apc-acts .pf-btn'));
    expect(acts).toEqual(['Open profile', 'Complete', 'Mark urgent', 'No-show', 'Cancel appointment']);
    const btn = (t: string) => Array.from(el.querySelectorAll('aside .pf-apc-acts .pf-btn')).find(b => b.textContent?.trim() === t)!;
    click(btn('Complete')); expect(queue.complete).toHaveBeenCalledWith('a2');
    c.openAppt(A2); f.detectChanges();
    click(btn('Mark urgent')); expect(queue.markUrgent).toHaveBeenCalledWith('a2');
    c.openAppt(A2); f.detectChanges();
    click(btn('No-show')); expect(queue.noShow).toHaveBeenCalledWith('a2');
    c.openAppt(A2); f.detectChanges();
    click(btn('Cancel appointment')); expect(queue.cancel).toHaveBeenCalledWith('a2');
  });

  it('Reschedule is a STEP (slides in): the kit date + a pf-select time, then the same reschedule API', () => {
    const { el, f, queue, c } = render();
    c.openAppt(A1); f.detectChanges();
    click(Array.from(el.querySelectorAll('aside .pf-apc-acts .pf-btn')).find(b => b.textContent?.trim() === 'Reschedule')!);
    f.detectChanges();
    const step = el.querySelector('aside .pf-apc-resched')!;
    expect(step.classList).toContain('pf-apc-step--fwd');
    expect(step.querySelector('pf-date input[type="text"]')?.getAttribute('placeholder')).toBe('dd/mm/yyyy');
    expect(step.querySelector('pf-select')).not.toBeNull();
    expect(el.querySelectorAll('input[type="time"], select, datalist').length).toBe(0);
    expect(el.querySelector('aside .pf-card__label')?.textContent?.trim()).toBe('Reschedule');
    c.rDate = iso(OTHER); c.rTime = '11:00';
    click(Array.from(el.querySelectorAll('aside .pf-apc-acts .pf-btn')).find(b => b.textContent?.trim() === 'Save new time')!);
    expect(queue.reschedule).toHaveBeenCalledWith('a1', new Date(iso(OTHER)).toISOString(), '11:00');
    // Back slides the facts back in from the left.
    c.openAppt(A2); f.detectChanges();
    c.openReschedule(); f.detectChanges();
    click(Array.from(el.querySelectorAll('aside .pf-apc-acts .pf-btn')).find(b => b.textContent?.trim() === 'Back')!);
    f.detectChanges();
    expect(el.querySelector('aside .pf-apc-facts')?.classList).toContain('pf-apc-step--back');
  });

  it('Esc steps back: reschedule → detail → the day (zoom out)', () => {
    const { el, f, c, zoom } = render();
    c.openAppt(A1); c.openReschedule(); f.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); f.detectChanges();
    expect(c.rescheduleOpen()).toBe(false);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); f.detectChanges();
    expect(c.selectedAppt()).toBeNull();
    expect(zoom.runLocal).toHaveBeenCalledWith('out', expect.any(Function));
    expect(el.querySelector('aside.pf-apc-side .pf-apc-strip7')).not.toBeNull();
  });

  it('collapses to a strip on the RIGHT edge (remembered per user) and expands back', () => {
    const { el, f } = render();
    click(el.querySelector('aside .pf-apc-collapse')); f.detectChanges();
    expect(el.querySelector('.pf-apc-panels')?.classList).toContain('pf-apc-panels--collapsed');
    const strip = el.querySelector('aside.pf-apc-strip')!;
    expect(strip.querySelector('.pf-apc-strip__label')?.textContent?.trim()).toBe('Day');
    expect(localStorage.getItem('pf:appt:side-collapsed:u1')).toBe('1');
    click(strip.querySelector('.pf-apc-strip__btn')); f.detectChanges();
    expect(el.querySelector('aside.pf-apc-side')).not.toBeNull();
  });
});

describe('Appointments calendar (nd) — narrow + phones', () => {
  it('≤900px: the day list is the main card; the detail is a sheet', () => {
    const { el, f, c } = render({ narrow: true });
    expect(c.view()).toBe('day');
    expect(el.querySelector('aside.pf-apc-side')).toBeNull();
    expect(el.querySelector('section.pf-apc-daycard .pf-apc-strip7')).not.toBeNull();
    c.cursor.set(new Date(TODAY)); f.detectChanges();
    click(el.querySelector('.pf-apc-daycard .pf-apc-row')); f.detectChanges();
    const sheet = el.querySelector('.pf-sheet.pf-apc-sheet[role="dialog"]')!;
    expect(sheet).not.toBeNull();
    expect(sheet.querySelector('.pf-apc-acts')).not.toBeNull();
    click(el.querySelector('.pf-apc-scrim')); f.detectChanges();
    expect(el.querySelector('.pf-apc-sheet')).toBeNull();
  });

  it('phones: the primary is a full-width button at the card foot (still exactly one)', () => {
    const { el, router } = render({ phone: true });
    expect(el.querySelector('.pf-hb__actions .pf-hb-btn--primary')).toBeNull();
    expect(primaries(el).length).toBe(1);
    const cta = el.querySelector('.pf-apc-foot .pf-btn--primary.pf-span')!;
    expect(cta.textContent?.trim()).toBe('New appointment');
    click(cta);
    expect(router.navigate).toHaveBeenCalledWith(['/frontdesk/appointments/new']);
    expect(el.querySelector<HTMLInputElement>('.pf-apc-search__input')?.placeholder).toBe('Patient, phone or MRN');
  });
});

describe('Appointments calendar (nd) — rules', () => {
  it('no native controls, no emoji / glyph icons; SVG icons only', () => {
    const { el, f, c, view } = render();
    view('week');
    c.openAppt(A1); f.detectChanges();
    expect(el.querySelectorAll('select, datalist, input[type="time"]').length).toBe(0);
    expect(el.textContent).not.toMatch(/[‹›✕⚠✓✔●]/u);
    expect(el.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('styles: palette only (no pink / gradient / green hex), Noto tabular numbers — never monospace; reduced motion', () => {
    const s = APPOINTMENTS_CALENDAR_ND_STYLES;
    expect(s).not.toMatch(/monospace|JetBrains/i);
    expect(s).not.toMatch(/linear-gradient|#ec4899|#10b981|#22c55e|#8b5cf6/i);
    const rm = s.slice(s.indexOf('@media (prefers-reduced-motion: reduce)'));
    for (const cls of ['.pf-apc-side', '.pf-apc-strip', '.pf-apc-row', '.pf-apc-step--fwd', '.pf-apc-sheet', '.pf-apc-panels']) {
      expect(rm, cls).toContain(cls);
    }
  });

  it('the classic design keeps its own calendar untouched', () => {
    const { el } = render({ classic: true });
    expect(el.querySelector('.pf-cal-page')).not.toBeNull();
    expect(el.querySelector('pf-hero-band')).toBeNull();
  });
});

describe('Appointments calendar (nd) — helpers', () => {
  it('status = the list language: tone + word', () => {
    expect(['booked', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show', 'skipped'].map(apptStatusTone))
      .toEqual(['violet', 'amber', 'amber', 'green', 'red', 'red', 'neutral']);
    expect(apptStatusWord('no_show')).toBe('No-show');
    expect(apptStatusWord('checked_in')).toBe('Checked in');
  });
  it('search matches name / MRN substrings and phone digits (3+)', () => {
    expect(matchesAppointment(A1 as any, 'munus')).toBe(true);
    expect(matchesAppointment(A1 as any, 'aa0007')).toBe(true);
    expect(matchesAppointment(A1 as any, '000 001')).toBe(true);
    expect(matchesAppointment(A1 as any, 'zz')).toBe(false);
    expect(matchesAppointment({ ...A1, patient: { ...P1, mrn: 'X' } } as any, '00')).toBe(false);
  });
  it('a full number matches its last 10 digits whatever the format (stored +91…)', () => {
    const stored = { ...A1, patient: { ...P1, phone: '+919000000001' } } as any;
    for (const q of ['9000000001', '09000000001', '+91 90000-00001', '919000000001']) {
      expect(matchesAppointment(stored, q)).toBe(true);
    }
    expect(matchesAppointment(stored, '9000000002')).toBe(false);
  });
  it('placeLanes: same start → equal lanes; top follows the hour', () => {
    const start = (a: any) => { const d = new Date(`${a.appointmentDate.slice(0, 10)}T${a.slotTime}:00`); return d; };
    const out = placeLanes([A1, A2] as any, start);
    expect(out.map(o => o.width)).toEqual([50, 50]);
    expect(out.map(o => o.left)).toEqual([0, 50]);
    expect(out[0].top).toBeGreaterThan(0);
  });
});
