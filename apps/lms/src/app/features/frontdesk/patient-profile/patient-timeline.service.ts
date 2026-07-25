import { Injectable, signal } from '@angular/core';

/**
 * Drives the full-screen Patient Timeline. The overlay is rendered at SHELL
 * ROOT (a sibling of the routed page + nav) rather than inside the patient
 * profile — a fixed element nested under `.shell-main` is trapped below the
 * chrome's stacking context and can't cover the nav. Opening it from anywhere
 * is just `open(patientId)`.
 */
@Injectable({ providedIn: 'root' })
export class PatientTimelineService {
  readonly patientId = signal<string | null>(null);
  readonly isOpen = signal(false);
  // OPD/IPD encounters passed in from the profile (mock today; real when the
  // encounter endpoints land) so the timeline can offer an All/OPD/IPD filter.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly opd = signal<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly ipd = signal<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly pharmacy = signal<any[]>([]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  open(patientId: string, opd: any[] = [], ipd: any[] = [], pharmacy: any[] = []) {
    this.patientId.set(patientId);
    this.opd.set(opd ?? []);
    this.ipd.set(ipd ?? []);
    this.pharmacy.set(pharmacy ?? []);
    this.isOpen.set(true);
  }
  close() { this.isOpen.set(false); }
}
