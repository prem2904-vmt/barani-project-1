import { Injectable, signal } from '@angular/core';

/**
 * Cross-screen billing event bus. The billing screen bumps these
 * counters when payments / pay-later commitments are recorded; other
 * screens (FD landing) watch them via toObservable to refetch their
 * bills list immediately rather than waiting for the next 30s poll.
 *
 * Signals are monotonic counters so consecutive emissions of the same
 * event each push a distinct value the consumer can react to.
 */
@Injectable({ providedIn: 'root' })
export class BillingEventsService {
  private readonly _paid = signal(0);
  private readonly _payLater = signal(0);

  /** A payment was just collected on a bill. */
  readonly paid = this._paid.asReadonly();
  /** A bill was just marked as pay-later (balance left outstanding). */
  readonly payLater = this._payLater.asReadonly();

  notifyPaid() { this._paid.update(n => n + 1); }
  notifyPayLater() { this._payLater.update(n => n + 1); }
}
