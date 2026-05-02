import { Injectable, signal } from '@angular/core';

/**
 * Global open/close coordinator for the patient profile modal. Any screen
 * (advanced search, frontdesk landing, lab my-work, etc.) can call
 * <code>open(patientId)</code> to bring up the modal. The modal itself is
 * mounted once, in <code>pf-shell</code>, and watches this service's
 * <code>activeId</code> signal.
 *
 * Keeping it as a signal-only service (no Subject / no Observable) means
 * components consume it the same way they consume route state — via
 * <code>computed()</code> reads. The modal closes itself by calling
 * <code>close()</code>, never directly mutating its <code>open</code>
 * input.
 */
@Injectable({ providedIn: 'root' })
export class PatientProfileService {
  private readonly _activeId = signal<string | null>(null);
  /** Patient id to render. Null = modal closed. */
  readonly activeId = this._activeId.asReadonly();

  open(patientId: string) {
    if (!patientId) return;
    this._activeId.set(patientId);
  }

  close() {
    this._activeId.set(null);
  }
}
