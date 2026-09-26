import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { BookAppointmentComponent } from './book-appointment.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { AuthService } from '../../../core/auth/auth.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { AppointmentBookingService } from '../../../core/services/appointment-booking.service';

/**
 * Test Master single source — phase 2: booking price display.
 * "Total Price" = Σ effective DTO price (pricing table) of the selected tests;
 * a test nobody priced is ₹1 and shows just "₹1"; a test that
 * isn't offered here is not in the picker.
 */
function make(tests: any[]) {
  const stub = {};
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: { get: () => of([]) } },
      { provide: ToastService, useValue: stub },
      { provide: AuthService, useValue: { hasPermission: () => true, user: () => null } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map(), queryParamMap: new Map() } } },
      { provide: Router, useValue: stub },
      { provide: NavBackService, useValue: stub },
      { provide: Location, useValue: stub },
      { provide: AppointmentBookingService, useValue: stub },
    ],
  });
  const c = TestBed.runInInjectionContext(() => new BookAppointmentComponent()) as any;
  c._tests.set(tests);
  return c;
}

describe('BookAppointment price display (pricing-table DTO)', () => {
  const tests = [
    { id: 'a', name: 'CBC', price: 300, isActive: true },
    { id: 'b', name: 'ESR', price: '120', isActive: true },
    { id: 'c', name: 'NEW', price: 1, priceIsDefault: true, isActive: true },
  ];

  it('selectedTestsTotal = Σ effective price (a ₹1 default counts as ₹1)', () => {
    const c = make(tests);
    c.toggleTest('a'); c.toggleTest('b'); c.toggleTest('c');
    expect(c.selectedTests().map((t: any) => t.id)).toEqual(['a', 'b', 'c']);
    expect(c.selectedTestsTotal()).toBe(421);
  });

  it('toggleTest twice removes the test from the total', () => {
    const c = make(tests);
    c.toggleTest('a'); c.toggleTest('a');
    expect(c.selectedTestsTotal()).toBe(0);
  });

  it('an unpriced test is ₹1 (data knows it is the default) and totals at ₹1', () => {
    const c = make([{ id: 'n', name: 'NEW', isActive: true }]);
    c.toggleTest('n');
    expect(c.selectedTestsTotal()).toBe(1);
    expect(c.isNotPriced('n')).toBe(true);
    expect(c.isNotPriced('zz')).toBe(false);
  });

  it('tests not offered here are hidden from the picker', () => {
    const c = make([...tests, { id: 'x', name: 'CBX', price: 50, isActive: true, isOffered: false }]);
    const ids = c.filteredTests().map((t: any) => t.id);
    expect(ids).toContain('a');
    expect(ids).not.toContain('x');
  });
});
