import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { OrderEntryService } from './order-entry.service';

/**
 * OWNER DECISION (2026-09-30): the cart is ALWAYS lab — never a 'choose'
 * dialog — and OPD gets its own `startConsult` entry point. This pins that
 * simplification at the service boundary (the pure-function branching is
 * separately pinned in shared/opd/order-entry.spec.ts).
 */
describe('OrderEntryService', () => {
  let navigate: ReturnType<typeof vi.fn>;
  let service: OrderEntryService;

  beforeEach(() => {
    navigate = vi.fn(async () => true);
    TestBed.configureTestingModule({
      providers: [OrderEntryService, { provide: Router, useValue: { navigate } }],
    });
    service = TestBed.inject(OrderEntryService);
  });

  it('startNewOrder always goes to the lab order screen, with no patient', async () => {
    await service.startNewOrder();
    expect(navigate).toHaveBeenCalledWith(['/frontdesk/order'], {});
  });

  it('startNewOrder always goes to the lab order screen, with a patient', async () => {
    await service.startNewOrder('p1');
    expect(navigate).toHaveBeenCalledWith(['/frontdesk/order'], { queryParams: { patientId: 'p1' } });
  });

  it('startConsult always goes to the OPD booking screen', async () => {
    await service.startConsult('p1');
    expect(navigate).toHaveBeenCalledWith(['/opd/visit/new'], { queryParams: { patientId: 'p1' } });
  });

  it('startConsult with no patient omits queryParams', async () => {
    await service.startConsult();
    expect(navigate).toHaveBeenCalledWith(['/opd/visit/new'], {});
  });
});
