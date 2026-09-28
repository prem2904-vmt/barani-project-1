import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { BookAppointmentComponent } from './book-appointment.component';
import { BOOK_APPOINTMENT_ND_STYLES, calendarMove, monthGrid, nextFocus, rovingIndex } from './book-appointment.nd';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { AuthService } from '../../../core/auth/auth.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { AppointmentBookingService } from '../../../core/services/appointment-booking.service';
import { ThemeService } from '../../../core/services/theme.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';

/**
 * New appointment — NEW DESIGN (ND-PATTERN §21): ONE page, no tabs,
 * keyboard-first. Band = back · tenant · Cancel + the ONE primary "Book
 * appointment"; the pill = the context bar (date · slot · patient). Cards:
 * PATIENT · DATE → TIME SLOT → DETAILS. The booking call is unchanged.
 */
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAY = new Date(); DAY.setDate(DAY.getDate() + 2); DAY.setHours(12, 0, 0, 0);
const DAY_ISO = iso(DAY);
const PATIENT = { id: 'p1', firstName: 'Paravai', fathersName: 'Munusamy', title: 'Ms.', age: 44, sex: 'Female', mrn: 'AA0007', phone: '9000000001' };
const SCHEDULE = JSON.stringify(Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map(k => [k, [{ from: '09:00', to: '12:00' }]])));
const CONFIG = { branchId: 'b', slotMinutes: 30, open24h: false, weeklyScheduleJson: SCHEDULE, maxConcurrentSlots: 1 };
const TAKEN = { id: 'x', patientId: 'p9', status: 'booked', appointmentDate: `${DAY_ISO}T00:00:00`, slotTime: '09:30' };
const TESTS = [
  { id: 't1', testCode: 'HEM001', name: 'Complete blood count', shortName: 'CBC', price: 300, isActive: true },
  { id: 't2', testCode: 'BIO010', name: 'Lipid profile', shortName: 'LIPID', price: 700, isActive: true },
];

interface Opts { phone?: boolean; classic?: boolean; patientId?: string }

const realMatchMedia = (window as any).matchMedia;
afterEach(() => {
  TestBed.resetTestingModule();
  (window as any).matchMedia = realMatchMedia;
  vi.useRealTimers();
});

async function render(opts: Opts = {}) {
  (window as any).matchMedia = (q: string) => ({
    matches: q.includes('640px') ? !!opts.phone : q.includes('hover') ? !opts.phone : false,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  const api = {
    get: vi.fn((url: string) => {
      if (url === '/api/appointments/config') return of(CONFIG);
      if (url.startsWith('/api/appointments?')) return of([TAKEN]);
      if (url === '/api/tests/?view=summary') return of(TESTS);
      if (url.startsWith('/api/patients?q=')) return of([PATIENT]);
      if (url.startsWith('/api/patients/')) return of({ patient: PATIENT });
      return of(null);
    }),
    post: vi.fn(() => of({})),
  };
  const router = { navigate: vi.fn(), navigateByUrl: vi.fn() };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  const navBack = { showBack: () => true, back: vi.fn(), backTo: vi.fn() };
  const booking = { notifyBooked: vi.fn(), bookedAt: signal(0) };
  const params = new Map<string, string>([['date', DAY_ISO], ...(opts.patientId ? [['patientId', opts.patientId]] as [string, string][] : [])]);
  TestBed.configureTestingModule({
    imports: [BookAppointmentComponent],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toasts },
      { provide: AuthService, useValue: { hasPermission: () => true, user: () => ({ id: 'u1', tenantName: 'Micro World' }) } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map(), queryParamMap: params } } },
      { provide: Router, useValue: router },
      { provide: NavBackService, useValue: navBack },
      { provide: Location, useValue: {} },
      { provide: AppointmentBookingService, useValue: booking },
      { provide: ThemeService, useValue: { isNewDesign: () => !opts.classic } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }) } },
    ],
  });
  const f = TestBed.createComponent(BookAppointmentComponent);
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const c = f.componentInstance as any;
  return { f, el, c, api, router, toasts, navBack, booking };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const primaries = (el: HTMLElement) => el.querySelectorAll('.nd-btn--primary, .pf-hb-btn--primary');
const click = (el: Element | null) => (el as HTMLElement).click();
const enter = (el: Element, extra: KeyboardEventInit = {}) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...extra }));
const chip = (el: HTMLElement, t: string) => el.querySelector(`.pf-bka-chip[data-time="${t}"]`) as HTMLElement;

async function pickPatient(f: any, el: HTMLElement) {
  const input = el.querySelector('.pf-bka-pq') as HTMLInputElement;
  input.value = 'para';
  input.dispatchEvent(new Event('input'));
  await sleep(260);
  f.detectChanges();
  return input;
}

describe('New appointment (nd) — band + pill', () => {
  it('the band: back to the calendar, Cancel (ghost) and ONE primary "Book appointment"', async () => {
    const { el, navBack } = await render();
    expect(el.querySelector('pf-hero-band')).not.toBeNull();
    expect(primaries(el).length).toBe(1);
    const cta = el.querySelector('.pf-hb__actions .pf-hb-btn--primary')!;
    expect(cta.getAttribute('aria-label')).toBe('Book appointment');
    click(el.querySelector('.pf-bka-cancel'));
    expect(navBack.backTo).toHaveBeenCalledWith('/frontdesk/appointments');
    click(el.querySelector('.pf-hb__back'));
    expect(navBack.backTo).toHaveBeenLastCalledWith('/frontdesk/appointments');
    // One page: no tabs, no steps, no old header.
    expect(el.querySelector('[role="tablist"]')).toBeNull();
    expect(el.querySelector('pf-screen-header')).toBeNull();
    expect(Array.from(el.querySelectorAll('.nd-card__label')).map(e => e.textContent?.trim()))
      .toEqual(['Patient', 'Date', 'Time slot', 'Details']);
  });

  it('the pill is the context bar: date, the slot, then the patient once chosen', async () => {
    const { el, f } = await render();
    const pill = el.querySelector('.pf-hb__search .pf-bka-ctx')!;
    expect(pill.querySelector('.pf-bka-ctx__date')?.textContent).toContain(String(DAY.getDate()));
    expect(pill.querySelector('.pf-bka-ctx__slot')?.textContent).toContain('Not picked');
    expect(pill.querySelector('.pf-bka-ctx__patient')).toBeNull();
    click(chip(el, '10:00')); f.detectChanges();
    expect(pill.querySelector('.pf-bka-ctx__slot')?.textContent).toContain('10:00');
    await pickPatient(f, el);
    click(el.querySelector('.pf-bka-result')); f.detectChanges();
    const p = pill.querySelector('.pf-bka-ctx__patient')!;
    expect(p.textContent).toContain('Ms. Paravai Munusamy');
    expect(p.textContent).toContain('44/F · AA0007');
  });
});

describe('New appointment (nd) — the form', () => {
  it('slots: a chip grid — available / taken (Full, disabled) / selected (aria-checked)', async () => {
    const { el, f, c } = await render();
    const chips = el.querySelectorAll('.pf-bka-chips[role="radiogroup"] .pf-bka-chip[role="radio"]');
    expect(Array.from(chips).map(x => x.getAttribute('data-time'))).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']);
    const taken = chip(el, '09:30');
    expect(taken.getAttribute('aria-disabled')).toBe('true');
    expect(taken.textContent).toContain('Full');
    click(taken); f.detectChanges();
    expect(c.selectedTime()).toBe('');
    click(chip(el, '10:30')); f.detectChanges();
    expect(chip(el, '10:30').getAttribute('aria-checked')).toBe('true');
    expect(el.querySelectorAll('.pf-bka-chip[aria-checked="true"]').length).toBe(1);
    // One Tab stop: the selected chip.
    expect(Array.from(chips).filter(x => x.getAttribute('tabindex') === '0').map(x => x.getAttribute('data-time'))).toEqual(['10:30']);
    // Part of the day = a neutral radiogroup with counts.
    const periods = el.querySelectorAll('.pf-bka-periods [role="radio"]');
    expect(periods.length).toBe(4);
    expect(periods[0].getAttribute('aria-checked')).toBe('true');
    click(periods[1]); f.detectChanges();
    expect(c.timePeriod()).toBe('afternoon');
    expect(el.querySelector('.pf-bka-slots .pf-bka-note')?.textContent).toContain('No slots in this part of the day');
  });

  it('date: the kit date (typed dd/mm/yyyy, min today) above a full month grid', async () => {
    const { el } = await render();
    const d = el.querySelector('.pf-bka-date pf-nd-date input[type="text"]') as HTMLInputElement;
    expect(d.placeholder).toBe('dd/mm/yyyy');
    expect(d.value).toBe(`${pad(DAY.getDate())}/${pad(DAY.getMonth() + 1)}/${DAY.getFullYear()}`);
    // The 7-day strip is gone: one month grid, ‹ Month Year ›, M..S, 6 weeks.
    expect(el.querySelector('.pf-bka-days')).toBeNull();
    const grid = el.querySelector('.pf-bka-date [role="grid"]')!;
    expect(grid.getAttribute('aria-labelledby')).toBe('pf-bka-cal-title');
    const monthName = DAY.toLocaleString('en-GB', { month: 'long' });
    expect(el.querySelector('#pf-bka-cal-title')?.textContent?.trim()).toBe(`${monthName} ${DAY.getFullYear()}`);
    expect(Array.from(grid.querySelectorAll('[role="columnheader"]')).map(h => h.textContent?.trim()).join('')).toBe('MTWTFSS');
    expect(grid.querySelectorAll('.pf-bka-cal__weeks [role="row"]').length).toBe(6);
    expect(grid.querySelectorAll('[role="gridcell"]').length).toBe(42);
    const sel = grid.querySelector(`[data-iso="${DAY_ISO}"]`)!;
    expect(sel.getAttribute('aria-selected')).toBe('true');
    expect(grid.querySelectorAll('[aria-selected="true"]').length).toBe(1);
    expect(sel.getAttribute('aria-label')).toBe(DAY.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).replace(',', ''));
    // Days of the neighbouring months are muted.
    const cells = Array.from(grid.querySelectorAll('[role="gridcell"]'));
    const first = cells.findIndex(c => c.textContent?.trim() === '1');
    cells.slice(0, first).forEach(c => expect(c.classList).toContain('pf-bka-cal__day--out'));
    // One Tab stop: the picked day.
    expect(cells.filter(c => c.getAttribute('tabindex') === '0')).toEqual([sel]);
  });

  it('date: past days are disabled (min = today), today is marked', async () => {
    const { el, f, c, api } = await render();
    const today = new Date();
    // Show the current month (the picked day may sit in the next one).
    c.calMonth.set(new Date(today.getFullYear(), today.getMonth(), 1)); f.detectChanges();
    const t = el.querySelector(`.pf-bka-cal__day[data-iso="${iso(today)}"]`)!;
    expect(t.classList).toContain('pf-bka-cal__day--today');
    expect(t.getAttribute('aria-current')).toBe('date');
    expect(t.getAttribute('aria-disabled')).toBeNull();
    // A shown day before today (yesterday, or the previous month's tail).
    const past = Array.from(el.querySelectorAll<HTMLElement>('.pf-bka-cal__day'))
      .filter(x => x.getAttribute('data-iso')! < iso(today)).pop() ?? null;
    if (!past) return; // today is a Monday the 1st: nothing before it is shown.
    expect(past.getAttribute('aria-disabled')).toBe('true');
    const calls = api.get.mock.calls.length;
    click(past); f.detectChanges();
    expect(c.selectedDate()).toBe(DAY_ISO);
    expect(api.get.mock.calls.length).toBe(calls);
    // No month before the current one.
    expect((el.querySelector('.pf-bka-cal__nav[aria-label="Previous month"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('date: a picked day updates the pill + the typed date, clears the slot and reloads the slots', async () => {
    const { el, f, c, api } = await render();
    click(chip(el, '10:00')); f.detectChanges();
    expect(c.selectedTime()).toBe('10:00');
    const next = new Date(DAY); next.setDate(next.getDate() + 1);
    const nextIso = iso(next);
    const cell = el.querySelector(`.pf-bka-cal__day[data-iso="${nextIso}"]`) as HTMLElement;
    const before = api.get.mock.calls.filter((x: any[]) => String(x[0]).startsWith('/api/appointments?')).length;
    click(cell); f.detectChanges(); await f.whenStable(); f.detectChanges();
    expect(c.selectedDate()).toBe(nextIso);
    expect(c.selectedTime()).toBe('');
    expect(el.querySelector(`.pf-bka-cal__day[data-iso="${nextIso}"]`)?.getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('.pf-bka-ctx__date')?.textContent).toContain(String(next.getDate()));
    const typed = el.querySelector('.pf-bka-date pf-nd-date input[type="text"]') as HTMLInputElement;
    expect(typed.value).toBe(`${pad(next.getDate())}/${pad(next.getMonth() + 1)}/${next.getFullYear()}`);
    expect(api.get.mock.calls.filter((x: any[]) => String(x[0]).startsWith('/api/appointments?')).length).toBe(before + 1);
    // The other way: the typed date moves the grid to its month.
    const later = new Date(DAY.getFullYear(), DAY.getMonth() + 2, 10);
    c.selectDate(iso(later)); f.detectChanges();
    expect(el.querySelector('#pf-bka-cal-title')?.textContent).toContain(later.toLocaleString('en-GB', { month: 'long' }));
    expect(el.querySelector(`.pf-bka-cal__day[data-iso="${iso(later)}"]`)?.getAttribute('aria-selected')).toBe('true');
  });

  it('date keyboard: arrows move the day, Enter picks it, PageUp / PageDown change the month', async () => {
    const { el, f, c } = await render();
    const key = (k: string) => {
      const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
      (document.activeElement as HTMLElement).dispatchEvent(ev);
      f.detectChanges();
      return ev;
    };
    const focusDay = (d: string) => (el.querySelector(`.pf-bka-cal__day[data-iso="${d}"]`) as HTMLElement).focus();
    const shift = (n: number) => { const x = new Date(DAY); x.setDate(x.getDate() + n); return iso(x); };
    focusDay(DAY_ISO);
    key('ArrowRight'); await sleep(0);
    expect(document.activeElement?.getAttribute('data-iso')).toBe(shift(1));
    key('ArrowDown'); await sleep(0);
    expect(document.activeElement?.getAttribute('data-iso')).toBe(shift(8));
    key('ArrowLeft'); await sleep(0);
    expect(document.activeElement?.getAttribute('data-iso')).toBe(shift(7));
    expect(document.activeElement?.getAttribute('tabindex')).toBe('0');
    const ev = key('Enter');
    expect(ev.defaultPrevented).toBe(true);
    expect(c.selectedDate()).toBe(shift(7));
    // PageDown: the same day next month, with the grid on that month.
    const sel = new Date(DAY); sel.setDate(sel.getDate() + 7);
    const title0 = el.querySelector('#pf-bka-cal-title')?.textContent;
    key('PageDown'); await sleep(0);
    expect(el.querySelector('#pf-bka-cal-title')?.textContent).not.toBe(title0);
    const nm = new Date(sel.getFullYear(), sel.getMonth() + 1, 1);
    expect(document.activeElement?.getAttribute('data-iso')?.slice(0, 7)).toBe(iso(nm).slice(0, 7));
    expect(el.querySelector('.pf-bka-cal__weeks')?.classList).toContain('pf-bka-cal__weeks--next');
    key('PageUp'); await sleep(0);
    expect(el.querySelector('#pf-bka-cal-title')?.textContent).toBe(title0);
    expect(document.activeElement?.getAttribute('data-iso')).toBe(shift(7));
    // The picked date only changes on Enter / click.
    expect(c.selectedDate()).toBe(shift(7));
  });

  it('date: ‹ › change the month without changing the picked day', async () => {
    const { el, f, c } = await render();
    const title0 = el.querySelector('#pf-bka-cal-title')?.textContent;
    click(el.querySelector('.pf-bka-cal__nav[aria-label="Next month"]')); f.detectChanges();
    expect(el.querySelector('#pf-bka-cal-title')?.textContent).not.toBe(title0);
    expect(c.selectedDate()).toBe(DAY_ISO);
    click(el.querySelector('.pf-bka-cal__nav[aria-label="Previous month"]')); f.detectChanges();
    expect(el.querySelector('#pf-bka-cal-title')?.textContent).toBe(title0);
  });

  it('validation is inline: Book with nothing picked marks the patient + the slot, sends nothing', async () => {
    const { el, f, api } = await render();
    click(el.querySelector('.pf-hb__actions .pf-hb-btn--primary')); f.detectChanges();
    expect(api.post).not.toHaveBeenCalled();
    expect(el.querySelector('#pf-bka-e-patient')?.textContent).toContain('Pick the patient to book for.');
    expect(el.querySelector('.pf-bka-pq')?.getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector('#pf-bka-e-slot')?.textContent).toContain('Pick a time slot.');
    expect(el.querySelector('.pf-bka-chips')?.getAttribute('aria-invalid')).toBe('true');
    await sleep(0);
    expect(document.activeElement).toBe(el.querySelector('.pf-bka-pq'));
  });

  it('keyboard-first: Enter walks patient → date → slot → tests → collection → notes', async () => {
    const { el, f, c } = await render();
    const input = await pickPatient(f, el);
    enter(input); f.detectChanges();
    expect(c.patient()?.id).toBe('p1');
    await sleep(0); f.detectChanges();
    const date = el.querySelector('.pf-bka-date pf-nd-date input[type="text"]') as HTMLInputElement;
    expect(document.activeElement).toBe(date);
    enter(date); f.detectChanges();
    expect(document.activeElement?.getAttribute('data-time')).toBe('09:00');
    // Arrow to the next free slot, Enter picks it and moves on.
    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(document.activeElement?.getAttribute('data-time')).toBe('10:00');
    enter(document.activeElement!); f.detectChanges();
    expect(c.selectedTime()).toBe('10:00');
    expect(document.activeElement?.id).toBe('pf-bka-tq');
    enter(document.activeElement!); f.detectChanges();
    expect(document.activeElement?.closest('.pf-bka-coll')).not.toBeNull();
    expect(document.activeElement?.getAttribute('aria-checked')).toBe('true');
    enter(document.activeElement!); f.detectChanges();
    expect(document.activeElement?.classList).toContain('pf-bka-notes');
    // A textarea keeps Enter.
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    document.activeElement!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('tests: search → ↓ / Enter adds, rows show code · name · price, remove, total', async () => {
    const { el, f, c } = await render();
    const tq = el.querySelector('#pf-bka-tq') as HTMLInputElement;
    tq.dispatchEvent(new Event('focus'));
    tq.value = 'profile'; tq.dispatchEvent(new Event('input')); f.detectChanges();
    const rows = el.querySelectorAll('#pf-bka-tlist .pf-bka-result');
    expect(rows.length).toBe(1);
    expect(rows[0].querySelector('.pf-bka-result__code')?.textContent?.trim()).toBe('BIO010');
    expect(rows[0].querySelector('.pf-bka-result__price')?.textContent).toContain('700');
    enter(tq); f.detectChanges();
    expect(c.selectedTestIds()).toEqual(['t2']);
    tq.value = 'cbc'; tq.dispatchEvent(new Event('input')); f.detectChanges();
    enter(tq); f.detectChanges();
    expect(el.querySelectorAll('.pf-bka-ptest:not(.pf-bka-ptest--total)').length).toBe(2);
    expect(el.querySelector('.pf-bka-ptest--total')?.textContent).toContain('2 tests');
    expect(el.querySelector('.pf-bka-ptest--total')?.textContent).toContain('1,000');
    click(el.querySelector('.pf-bka-ptest__x')); f.detectChanges();
    expect(c.selectedTestIds().length).toBe(1);
  });

  it('books on the same API: walk-in and home collection payloads; then back to the Frontdesk', async () => {
    const { el, f, c, api, router, booking, toasts } = await render({ patientId: 'p1' });
    expect(c.patient()?.id).toBe('p1');
    click(chip(el, '11:00'));
    c.toggleTest('t1');
    const coll = el.querySelectorAll('.pf-bka-coll [role="radio"]');
    click(coll[1]); f.detectChanges();
    const home = el.querySelectorAll('.pf-bka-home input');
    expect(Array.from(home).map(i => i.getAttribute('type'))).toEqual(['text', 'text', 'text', 'text']);
    const set = (i: number, v: string) => { const x = home[i] as HTMLInputElement; x.value = v; x.dispatchEvent(new Event('input')); };
    set(0, '12 Anna Salai'); set(1, '600002'); set(2, '13.0827'); set(3, '80.2707');
    const notes = el.querySelector('.pf-bka-notes') as HTMLTextAreaElement;
    notes.value = 'Fasting'; notes.dispatchEvent(new Event('input'));
    f.detectChanges();
    click(el.querySelector('.pf-hb__actions .pf-hb-btn--primary'));
    expect(api.post).toHaveBeenCalledTimes(1);
    const [url, body] = (api.post.mock.calls[0] as unknown) as [string, any];
    expect(url).toBe('/api/appointments');
    expect(body).toMatchObject({
      patientId: 'p1', type: 'appointment', collectionType: 'home_collection', slotTime: '11:00', consultationFee: 0,
      notes: 'Fasting', testIds: 't1', address: '12 Anna Salai', pincode: '600002', latitude: 13.0827, longitude: 80.2707,
    });
    expect(new Date(body.appointmentDate).getHours()).toBe(11);
    expect(booking.notifyBooked).toHaveBeenCalled();
    expect(toasts.success).toHaveBeenCalledWith('Appointment booked');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/frontdesk');
  });

  it('Ctrl / ⌘ + Enter books from anywhere; Change swaps the patient', async () => {
    const { el, f, api } = await render({ patientId: 'p1' });
    click(chip(el, '10:00')); f.detectChanges();
    enter(el.querySelector('.pf-bka-notes')!, { ctrlKey: true });
    expect(api.post).toHaveBeenCalledTimes(1);
    click(el.querySelector('.pf-bka-change')); f.detectChanges();
    expect(el.querySelector('.pf-bka-pq')).not.toBeNull();
  });
});

describe('New appointment (nd) — phones + rules', () => {
  it('phones: a full-width primary in the bottom bar (still exactly one), slots 2-up', async () => {
    const { el } = await render({ phone: true });
    expect(el.querySelector('.pf-hb__actions .pf-hb-btn--primary')).toBeNull();
    expect(primaries(el).length).toBe(1);
    expect(el.querySelector('.nd-bottombar .nd-btn--primary')?.textContent?.trim()).toBe('Book appointment');
    const s = BOOK_APPOINTMENT_ND_STYLES;
    const phone = s.slice(s.indexOf('@media (max-width: 640px)'));
    expect(phone).toMatch(/\.pf-bka-chips \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
    expect(phone).toMatch(/font-size: 16px/);
    // The month grid: stretching rows on wide screens, 44px square cells on phones.
    expect(s).toMatch(/\.pf-bka-cal__weeks \{[^}]*grid-template-rows: repeat\(6, minmax\(40px, 1fr\)\)/);
    expect(phone).toMatch(/\.pf-bka-cal__weeks \{[^}]*grid-auto-rows: 44px/);
    expect(phone).toMatch(/\.pf-bka-cal__day \{ min-height: 44px; \}/);
  });

  it('no native controls / flatpickr, no emoji / glyphs, no monospace, palette only', async () => {
    const { el } = await render();
    expect(el.querySelectorAll('select, datalist, input[type="number"], input[type="time"]').length).toBe(0);
    expect(el.querySelectorAll('.flatpickr-calendar').length).toBe(0);
    const dates = Array.from(el.querySelectorAll('input[type="date"]'));
    expect(dates.every(d => d.classList.contains('pf-ndd__native'))).toBe(true);
    expect(el.textContent).not.toMatch(/[✕⚠✓✔●]/u);
    expect(el.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(el.querySelector('.font-mono')).toBeNull();
    const s = BOOK_APPOINTMENT_ND_STYLES;
    expect(s).not.toMatch(/monospace|JetBrains/i);
    expect(s).not.toMatch(/linear-gradient|#ec4899|#10b981|#22c55e/i);
    expect(s.slice(s.indexOf('@media (prefers-reduced-motion: reduce)'))).toContain('.pf-bka-chip');
    expect(s.slice(s.indexOf('@media (prefers-reduced-motion: reduce)'))).toContain('.pf-bka-cal__weeks');
  });

  it('the classic design keeps its own page untouched', async () => {
    const { el } = await render({ classic: true });
    expect(el.querySelector('.book-appt-page')).not.toBeNull();
    expect(el.querySelector('pf-hero-band')).toBeNull();
  });
});

describe('New appointment (nd) — helpers', () => {
  it('rovingIndex: the picked slot, else the first free, else the first', () => {
    const l = [{ time: 'a', available: false }, { time: 'b', available: true }, { time: 'c', available: true }];
    expect(rovingIndex(l, 'c')).toBe(2);
    expect(rovingIndex(l, '')).toBe(1);
    expect(rovingIndex([{ time: 'a', available: false }], '')).toBe(0);
    expect(rovingIndex([], '')).toBe(-1);
  });
  it('nextFocus skips stops with nothing focusable', () => {
    const a = document.createElement('div');
    const b = document.createElement('div'); b.innerHTML = '<input type="text">';
    expect(nextFocus([a, b], 0)).toBe(b.querySelector('input'));
    expect(nextFocus([a], 0)).toBeNull();
  });
  it('monthGrid: six Monday-first weeks, outside / today / past flags, long labels', () => {
    const w = monthGrid(new Date(2026, 8, 15), '2026-09-27');
    expect(w.length).toBe(6);
    expect(w.every(r => r.length === 7)).toBe(true);
    expect(w[0][0].iso).toBe('2026-08-31');
    expect(w[0][0].outside).toBe(true);
    const c28 = w.flat().find(c => c.iso === '2026-09-28')!;
    expect(c28.label).toBe('Monday 28 September 2026');
    expect(c28.past).toBe(false);
    expect(w.flat().find(c => c.iso === '2026-09-27')!.today).toBe(true);
    expect(w.flat().find(c => c.iso === '2026-09-26')!.past).toBe(true);
  });
  it('calendarMove: arrows, Home / End, PageUp / PageDown', () => {
    expect(calendarMove('2026-09-28', 'ArrowRight')).toBe('2026-09-29');
    expect(calendarMove('2026-09-28', 'ArrowUp')).toBe('2026-09-21');
    expect(calendarMove('2026-09-30', 'ArrowDown')).toBe('2026-10-07');
    expect(calendarMove('2026-10-01', 'Home')).toBe('2026-09-28');
    expect(calendarMove('2026-10-01', 'End')).toBe('2026-10-04');
    expect(calendarMove('2026-01-31', 'PageDown')).toBe('2026-02-28');
    expect(calendarMove('2026-09-28', 'PageUp')).toBe('2026-08-28');
    expect(calendarMove('2026-09-28', 'a')).toBeNull();
  });
});
