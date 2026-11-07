import { HttpErrorResponse } from '@angular/common/http';
import { readFileSync } from 'node:fs';
import { ApiError } from '../../../shared/models/api-response.model';

/** OPS-29 #11: the server's 409 appointment_conflict reaches the booking form as plain words. */
const body = { success: false, error: 'appointment_conflict', message: 'This patient already has an appointment at 07 Nov 10:00. Pick a different time or open the existing appointment.' };

describe('booking a slot the patient already holds', () => {
  it('the 409 body becomes the inline message (page form)', () => {
    const err = ApiError.from(new HttpErrorResponse({ status: 409, error: body }));
    expect(err.code).toBe('appointment_conflict');
    expect(err.message).toContain('already has an appointment');
  });
  it('both booking forms show the server message instead of a generic one', () => {
    const page = readFileSync('apps/lms/src/app/features/frontdesk/book-appointment/book-appointment.component.ts', 'utf8');
    const modal = readFileSync('apps/lms/src/app/shared/components/appointment-booking-modal/appointment-booking-modal.component.ts', 'utf8');
    expect(page).toContain('this._errorMsg.set(ApiError.from(err).message)');
    expect(modal).toContain('?.error?.message');
  });
});
