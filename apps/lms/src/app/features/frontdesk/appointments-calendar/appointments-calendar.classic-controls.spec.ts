import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AppointmentsCalendarComponent } from './appointments-calendar.component';
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
 * Classic calendar: the "Jump to date" trigger used a VISIBLE (opacity:0
 * overlay, but still a real) native date input; the reschedule panel used
 * native `<input type="date">`/`<input type="time">`. All three are now the
 * same hidden-native-overlay / kit pattern the ND calendar already used
 * (`openJump`, `pf-nd-date`, `pf-select` with the slotted time options).
 */
const P1 = { id: 'p1', firstName: 'Paravai', age: 44, sex: 'Female', mrn: 'AA0007', phone: '9000000001' };
const TODAY = new Date(); TODAY.setHours(12, 0, 0, 0);
const A1 = { id: 'a1', tenantId: 't', patientId: 'p1', branchId: 'b', type: 'appointment', collectionType: 'walkin',
  appointmentDate: `${TODAY.toISOString().slice(0, 10)}T00:00:00`, slotTime: '10:30', status: 'booked',
  consultationFee: 0, createdAt: '', patient: P1 };

function render() {
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const api = { get: vi.fn((url: string) => url.startsWith('/api/appointments') ? of([A1]) : of([])) };
  const queue = { checkIn: vi.fn(() => of({})), noShow: vi.fn(() => of({})), complete: vi.fn(() => of({})),
    markUrgent: vi.fn(() => of({})), cancel: vi.fn(() => of({})), reschedule: vi.fn(() => of({})) };
  const zoom = { runLocal: vi.fn((_d: string, fn: () => void) => fn()), disarm: vi.fn(), tap: () => true,
    holding: signal(false), attachTarget() {}, detachTarget() {}, attachSource() {}, detachSource() {} };
  TestBed.configureTestingModule({
    imports: [AppointmentsCalendarComponent],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: AppointmentQueueService, useValue: queue },
      { provide: AppointmentBookingService, useValue: { bookedAt: signal(0) } },
      { provide: PatientProfileService, useValue: { open: vi.fn() } },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn() } },
      { provide: Router, useValue: { navigate: vi.fn(() => Promise.resolve(true)), navigateByUrl: vi.fn() } },
      { provide: Location, useValue: {} },
      { provide: ThemeService, useValue: { isNewDesign: () => false } },
      { provide: AuthService, useValue: { user: () => ({ id: 'u1', tenantName: 'Micro World' }), hasPermission: () => true } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }) } },
      { provide: ZoomTransitionService, useValue: zoom },
    ],
  });
  const f = TestBed.createComponent(AppointmentsCalendarComponent);
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance as any, queue };
}

describe('Appointments calendar — classic (no native controls)', () => {
  it('"Jump to date" is a button + a hidden native input (never a visible date field)', () => {
    const { el } = render();
    const jump = el.querySelector('.pf-cal-nav__jump')!;
    expect(jump.tagName).toBe('BUTTON');
    const native = el.querySelector<HTMLInputElement>('.pf-cal-nav__jump-input')!;
    expect(native.type).toBe('date');
    expect(native.getAttribute('aria-hidden')).toBe('true');
    expect(native.tabIndex).toBe(-1);
  });

  it('reschedule panel: pf-nd-date + pf-select, never native date/time inputs', () => {
    const { el, c, f } = render();
    c.openAppt(A1);
    c.openReschedule();
    f.detectChanges();
    expect(el.querySelector('input[type="date"]:not([aria-hidden="true"])')).toBeNull();
    expect(el.querySelector('input[type="time"]:not([aria-hidden="true"])')).toBeNull();
    expect(el.querySelectorAll('pf-nd-date').length).toBeGreaterThan(0);
    expect(el.querySelectorAll('pf-select').length).toBeGreaterThan(0);
  });

  it('doReschedule still calls queue.reschedule with the new ISO date + rTime', () => {
    const { c, queue } = render();
    c.rDate = '2026-10-05';
    c.rTime = '11:00';
    c.doReschedule(A1);
    expect(queue.reschedule).toHaveBeenCalledWith('a1', '2026-10-05T00:00:00.000Z', '11:00');
  });
});
