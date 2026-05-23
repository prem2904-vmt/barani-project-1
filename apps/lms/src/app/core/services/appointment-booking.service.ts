import { Injectable, signal, inject } from '@angular/core';
import { Router } from '@angular/router';

/** Optional preset when opening the booking modal — pre-selects a patient,
 *  date, and/or time slot. Useful when launching from a calendar slot
 *  click or from inside the patient profile modal. */
export interface AppointmentBookingPreset {
  patientId?: string;
  /** ISO yyyy-MM-dd. Slot grid renders for this day. */
  date?: string;
  /** "HH:mm" — pre-selects this slot in the grid (if it matches). */
  time?: string;
}

/**
 * Global open/close coordinator for the appointment booking modal — same
 * pattern as PatientProfileService. Any component injects this and calls
 * <code>open(preset?)</code>; the modal lives once at shell level and
 * watches <code>request</code>.
 */
@Injectable({ providedIn: 'root' })
export class AppointmentBookingService {
  private readonly router = inject(Router);
  private readonly _request = signal<AppointmentBookingPreset | null>(null);
  readonly request = this._request.asReadonly();

  /** Monotonic tick that bumps every time an appointment is successfully
   *  booked. Calendar/list views watch this to refetch without a manual
   *  page refresh. Counter (not boolean) so consecutive bookings each
   *  emit a distinct value the effect can react to. */
  private readonly _bookedAt = signal(0);
  readonly bookedAt = this._bookedAt.asReadonly();

  notifyBooked() { this._bookedAt.update(n => n + 1); }

  /** JSON-stringified copy of the last fired preset — the cheapest reliable
   *  way to detect "same payload" regardless of object identity quirks. */
  private _lastKey: string | null = null;
  /** Ms epoch of the last fire. Used for time-based rapid-fire dedupe. */
  private _lastFiredAt = 0;

  open(preset: AppointmentBookingPreset = {}) {
    const queryParams: Record<string, string> = {};
    if (preset.patientId) queryParams['patientId'] = preset.patientId;
    if (preset.date) queryParams['date'] = preset.date;
    if (preset.time) queryParams['time'] = preset.time;

    this.router.navigate(['/frontdesk/appointments/new'], { queryParams });
  }

  close() {
    this._lastKey = null;
    this._request.set(null);
  }
}

function stableKey(p: AppointmentBookingPreset): string {
  return `${p.patientId ?? ''}|${p.date ?? ''}|${p.time ?? ''}`;
}
