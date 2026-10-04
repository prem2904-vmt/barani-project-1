import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { WorkEventsService } from '../../../core/services/work-events.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SkeletonRowsComponent } from '../../../shared/primitives/skeleton-kit.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { ApiError } from '../../../shared/models/api-response.model';
import { OpdDeskApi } from '../frontdesk/desk-api.service';
import type { OpdVisitDetail, OpdVisitRow } from '../frontdesk/desk.models';
import { waitedLabel } from '../frontdesk/visit-status';
import { OpdVitalsFormComponent } from './vitals-form.component';

/**
 * The vitals station (Agent B): VITALS QUEUE on the left (patients the
 * workflow sent to the station, oldest first) and the VITALS capture for the
 * picked patient on the right — BP, pulse, temperature, SpO₂, RR, weight,
 * height, BMI derived, GRBS, pain, a nurse's note; who / when is stamped by
 * the server. ONE primary: "Save & send to doctor" (visit → waiting); "Skip
 * vitals" is secondary. Both `/opd/vitals` and `/opd/vitals/:visitId` render it.
 */
@Component({
  selector: 'pf-opd-vitals-workspace',
  standalone: true,
  imports: [HeroBandComponent, ScreenHeaderComponent, SkeletonRowsComponent, BusyDirective, OpdVitalsFormComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './vitals-workspace.component.html',
  styleUrls: ['../frontdesk/opd-b.scss', './vitals-workspace.component.scss'],
})
export class OpdVitalsWorkspaceComponent {
  private readonly desk = inject(OpdDeskApi);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly work = inject(WorkEventsService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly theme = inject(ThemeService);

  /** Deep-linked visit (`/opd/vitals/:visitId`); null = the first in the queue. */
  readonly visitId = input<string | null>(null);
  readonly form = viewChild(OpdVitalsFormComponent);

  readonly queue = signal<OpdVisitRow[] | null>(null);
  readonly selectedId = signal<string | null>(null);
  readonly visit = signal<OpdVisitDetail | null>(null);
  readonly saving = signal(false);
  readonly skipping = signal(false);
  readonly waited = waitedLabel;
  readonly nurse = computed(() => this.auth.user()?.displayName ?? '');

  readonly selectedRow = computed(() => (this.queue() ?? []).find(r => r.id === this.selectedId()) ?? null);

  constructor() {
    effect(() => {
      const id = this.visitId();
      untracked(() => { if (id) this.select(id); });
    });
    this.loadQueue();
    this.work.on('consults').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.loadQueue());
  }

  loadQueue(): void {
    this.desk.vitalsQueue().subscribe({
      next: rows => {
        this.queue.set(rows);
        if (!this.selectedId() && rows.length) this.select(rows[0].id);
      },
      error: e => { this.queue.set([]); this.toasts.error(ApiError.from(e).message); },
    });
  }

  select(id: string): void {
    if (this.selectedId() === id && this.visit()) return;
    this.selectedId.set(id);
    this.visit.set(null);
    this.form()?.reset();
    this.desk.visit(id).subscribe({
      next: v => { if (this.selectedId() === id) this.visit.set(v); },
      error: e => this.toasts.error(ApiError.from(e).message),
    });
  }

  async save(): Promise<void> {
    const v = this.visit(); const f = this.form();
    if (!v || !f) return;
    f.reveal();
    if (!f.valid()) { this.toasts.error('Check the highlighted readings.'); return; }
    this.saving.set(true);
    try {
      await firstValueFrom(this.desk.saveVitals(v.id, f.vitals(), true));
      this.toasts.success(`${v.patient.name} sent to ${v.doctor.name}`);
      this.next(v.id);
    } catch (e) { this.toasts.error(ApiError.from(e).message); }
    finally { this.saving.set(false); }
  }

  async skip(): Promise<void> {
    const v = this.visit(); if (!v) return;
    this.skipping.set(true);
    try {
      await firstValueFrom(this.desk.skipVitals(v.id));
      this.toasts.info(`${v.patient.name} sent to ${v.doctor.name} without vitals`);
      this.next(v.id);
    } catch (e) { this.toasts.error(ApiError.from(e).message); }
    finally { this.skipping.set(false); }
  }

  /** After a save: drop the patient and open the next one. */
  private next(doneId: string): void {
    const rest = (this.queue() ?? []).filter(r => r.id !== doneId);
    this.queue.set(rest);
    this.selectedId.set(null); this.visit.set(null); this.form()?.reset();
    if (rest.length) this.select(rest[0].id);
    if (this.visitId()) void this.router.navigate(['/opd/vitals'], { replaceUrl: true });
  }
}
