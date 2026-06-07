import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AppointmentQueueService } from '../../core/services/appointment-queue.service';
import { ToastService } from '../../core/services/toast.service';
import { Appointment } from '../../shared/models/appointment.model';
import { ScreenHeaderComponent } from '../../shared/primitives/screen-header.component';
import { TileComponent } from '../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../shared/primitives/touch-button.component';
import { ChipComponent } from '../../shared/primitives/chip.component';
import { LoadingLogoComponent } from '../../shared/components/loading-logo/loading-logo.component';

@Component({
  selector: 'pf-my-home-collections',
  standalone: true,
  imports: [DatePipe, ScreenHeaderComponent, TileComponent, TouchButtonComponent, ChipComponent, LoadingLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10 max-w-3xl">
      <pf-screen-header
        eyebrow="Home collection"
        title="My visits"
        subtitle="Home-collection requests assigned to you. Check in on arrival, then collect the samples.">
        <pf-touch-btn actions size="sm" variant="ghost" (pressed)="load()">Refresh</pf-touch-btn>
      </pf-screen-header>

      @if (loading() && items().length === 0) {
        <pf-tile tone="default" padding="lg" class="block">
          <div class="flex justify-center py-6">
            <pf-loading-logo size="lg" color="purple" [showDna]="true" [showText]="true" text="Loading visits…"></pf-loading-logo>
          </div>
        </pf-tile>
      } @else if (items().length === 0) {
        <pf-tile tone="default" padding="xl" class="block">
          <p class="text-center text-[13px]" style="color: var(--text-tertiary);">No home-collection visits assigned to you.</p>
        </pf-tile>
      } @else {
        <div class="space-y-2.5">
          @for (a of items(); track a.id) {
            <pf-tile tone="default" padding="md" class="block">
              <div class="flex items-start gap-3 flex-wrap md:flex-nowrap">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <p class="font-semibold text-[15px] truncate" style="color: var(--text-primary);">{{ a.patient?.displayName || 'Patient' }}</p>
                    <pf-chip [tone]="a.status === 'checked_in' ? 'amber' : a.status === 'in_progress' ? 'violet' : 'default'" size="sm">{{ statusLabel(a.status) }}</pf-chip>
                  </div>
                  <p class="text-[13px] mt-1" style="color: var(--text-secondary);">{{ a.address || 'No address' }}{{ a.pincode ? ' · ' + a.pincode : '' }}</p>
                  <p class="text-[12px] mt-0.5" style="color: var(--text-tertiary);">
                    {{ a.appointmentDate | date:'dd MMM' }}{{ a.slotTime ? ' · ' + a.slotTime : '' }}
                    @if (a.patient?.phone) { · {{ a.patient?.phone }} }
                  </p>
                </div>
                <div class="flex flex-col items-end gap-1.5">
                  @if (mapUrl(a); as url) {
                    <a [href]="url" target="_blank" rel="noopener" class="text-[12px] font-medium text-violet-400 hover:text-violet-300">Open in maps ↗</a>
                  }
                  @if (a.status === 'booked') {
                    <pf-touch-btn size="sm" variant="primary" (pressed)="checkInAndCollect(a)">Check in &amp; collect</pf-touch-btn>
                  } @else {
                    <pf-touch-btn size="sm" variant="secondary" (pressed)="goCollect()">Collect samples</pf-touch-btn>
                  }
                </div>
              </div>
            </pf-tile>
          }
        </div>
      }
    </section>
  `
})
export class MyHomeCollectionsComponent implements OnInit {
  private readonly svc = inject(AppointmentQueueService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  private readonly _items = signal<Appointment[]>([]);
  private readonly _loading = signal(false);
  readonly items = this._items.asReadonly();
  readonly loading = this._loading.asReadonly();

  ngOnInit() { this.load(); }

  load() {
    this._loading.set(true);
    this.svc.myHomeCollections().subscribe({
      next: l => { this._items.set(l ?? []); this._loading.set(false); },
      error: () => { this._loading.set(false); this.toast.error('Could not load visits.'); }
    });
  }

  checkInAndCollect(a: Appointment) {
    // Check-in spawns the lab order from the pre-booked tests; the agent then
    // collects the samples on the standard collection screen.
    this.svc.checkIn(a.id).subscribe({
      next: () => { this.toast.success('Checked in — collect the samples.'); this.goCollect(); },
      error: () => { this.toast.error('Check-in failed.'); this.load(); }
    });
  }

  goCollect() { this.router.navigate(['/sample-collection']); }

  mapUrl(a: Appointment): string | null {
    if (a.latitude != null && a.longitude != null) {
      return `https://www.google.com/maps/search/?api=1&query=${a.latitude},${a.longitude}`;
    }
    if (a.address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.address + ' ' + (a.pincode ?? ''))}`;
    return null;
  }

  statusLabel(s: string): string {
    return s === 'in_progress' ? 'Collecting' : s === 'checked_in' ? 'Checked in' : s.charAt(0).toUpperCase() + s.slice(1);
  }
}
