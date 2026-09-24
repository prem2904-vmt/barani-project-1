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
 * Test Master single-source — Stage 1 safety net for booking price display.
 * TODAY: "Total Price" = Σ Number(t.price) of the pre-selected tests, and
 * each line renders `{{ t.name }} (₹{{ t.price }})` straight off the test row.
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

describe('BookAppointment price display (CURRENT: t.price)', () => {
  const tests = [
    { id: 'a', name: 'CBC', price: 300, isActive: true },
    { id: 'b', name: 'ESR', price: '120', isActive: true },
    { id: 'c', name: 'NEW', price: null, isActive: true },
  ];

  it('selectedTestsTotal = Σ Number(t.price); null/NaN count as 0', () => {
    const c = make(tests);
    c.toggleTest('a'); c.toggleTest('b'); c.toggleTest('c');
    expect(c.selectedTests().map((t: any) => t.id)).toEqual(['a', 'b', 'c']);
    expect(c.selectedTestsTotal()).toBe(420);
  });

  it('toggleTest twice removes the test from the total', () => {
    const c = make(tests);
    c.toggleTest('a'); c.toggleTest('a');
    expect(c.selectedTestsTotal()).toBe(0);
  });

  it.skip('TARGET phase 2: an unpriced test shows ₹1 with the "not priced yet" flag and totals at ₹1', () => {
    const c = make([{ id: 'n', name: 'NEW', isActive: true }]);
    c.toggleTest('n');
    expect(c.selectedTestsTotal()).toBe(1);
    expect(c.isNotPriced('n')).toBe(true);
  });
});
