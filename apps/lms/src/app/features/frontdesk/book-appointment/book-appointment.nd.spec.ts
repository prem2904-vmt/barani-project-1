import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { BookAppointmentComponent } from './book-appointment.component';
import { BOOK_APPOINTMENT_ND_STYLES, nextFocus, rovingIndex } from './book-appointment.nd';
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
      if (url === '/api/tests/') return of(TESTS);
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

  it('date: the kit date (typed dd/mm/yyyy, min today) + one-tap days; a new day clears the slot', async () => {
    const { el, f, c } = await render();
    const d = el.querySelector('.pf-bka-date pf-nd-date input[type="text"]') as HTMLInputElement;
    expect(d.placeholder).toBe('dd/mm/yyyy');
    expect(d.value).toBe(`${pad(DAY.getDate())}/${pad(DAY.getMonth() + 1)}/${DAY.getFullYear()}`);
    click(chip(el, '10:00')); f.detectChanges();
    const days = el.querySelectorAll('.pf-bka-day');
    expect(days.length).toBe(7);
    expect(days[0].textContent).toContain('Today');
    expect(days[2].getAttribute('aria-pressed')).toBe('true');
    click(days[3]); f.detectChanges();
    expect(c.selectedDate()).not.toBe(DAY_ISO);
    expect(c.selectedTime()).toBe('');
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
});
