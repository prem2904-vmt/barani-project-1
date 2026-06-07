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
    <section class="min-h-full bg-[var(--bg-primary)] text-[var(--text-primary)] p-4 md:p-6 lg:p-8">
      <div class="max-w-[1600px] mx-auto w-full space-y-6">
        <pf-screen-header
          eyebrow="Home collection"
          title="My visits"
          subtitle="Home-collection requests assigned to you. Check in on arrival, then collect the samples.">
          <pf-touch-btn actions size="sm" variant="ghost" (pressed)="load()">Refresh</pf-touch-btn>
        </pf-screen-header>

      @if (loading() && items().length === 0) {
        <pf-tile tone="solid" padding="lg" class="block border border-[var(--glass-border)] shadow-lg shadow-black/5">
          <div class="flex justify-center py-6">
            <pf-loading-logo size="lg" color="purple" [showDna]="true" [showText]="true" text="Loading visits…"></pf-loading-logo>
          </div>
        </pf-tile>
      } @else if (items().length === 0) {
        <pf-tile tone="solid" padding="xl" class="block border border-[var(--glass-border)] shadow-lg shadow-black/5">
          <p class="text-center text-[13px]" style="color: var(--text-tertiary);">No home-collection visits assigned to you.</p>
        </pf-tile>
      } @else {
        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
          @for (a of items(); track a.id) {
            <pf-tile tone="solid" padding="lg" class="block h-full border border-[var(--glass-border)] shadow-lg shadow-black/5">
              <div class="flex flex-col justify-between h-full gap-5">
                <div class="min-w-0">
                  <!-- Patient & Status Header -->
                  <div class="flex items-start justify-between gap-4">
                    <div class="min-w-0 flex-1">
                      <h4 class="font-bold text-[16px] leading-tight truncate" style="color: var(--text-primary);" [title]="a.patient?.displayName || 'Patient'">
                        {{ a.patient?.displayName || 'Patient' }}
                      </h4>
                      <p class="text-[11px] mt-1 font-medium tracking-wide uppercase" style="color: var(--text-tertiary);">
                        Scheduled Visit
                      </p>
                    </div>
                    <pf-chip [tone]="a.status === 'checked_in' ? 'amber' : a.status === 'in_progress' ? 'violet' : 'default'" size="sm">
                      {{ statusLabel(a.status) }}
                    </pf-chip>
                  </div>

                  <!-- Divider line -->
                  <div class="my-3 border-t border-slate-700/20"></div>

                  <!-- Details section -->
                  <div class="space-y-2.5">
                    <!-- Date & Time Slot -->
                    <div class="flex items-start gap-2.5 text-[13px]">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 mt-0.5 flex-shrink-0 text-violet-400">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z" />
                      </svg>
                      <div class="min-w-0">
                        <p class="font-medium" style="color: var(--text-secondary);">
                          {{ a.appointmentDate | date:'dd MMM yyyy' }}
                          @if (a.slotTime) {
                            <span class="text-violet-300 font-semibold ml-1">· {{ a.slotTime }}</span>
                          }
                        </p>
                      </div>
                    </div>

                    <!-- Address -->
                    <div class="flex items-start gap-2.5 text-[13px]">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 mt-0.5 flex-shrink-0 text-violet-400">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                      </svg>
                      <div class="min-w-0 flex-1">
                        <p class="leading-relaxed" style="color: var(--text-secondary);">
                          {{ a.address || 'No address' }}
                          @if (a.pincode) {
                            <span class="font-semibold text-violet-300 ml-1">({{ a.pincode }})</span>
                          }
                        </p>
                      </div>
                    </div>

                    <!-- Phone -->
                    @if (a.patient; as patient) {
                      @if (patient.phone) {
                        <div class="flex items-start gap-2.5 text-[13px]">
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 mt-0.5 flex-shrink-0 text-violet-400">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-2.824-1.502-5.184-3.862-6.686-6.686l1.293-.97c.362-.272.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                          </svg>
                          <a href="tel:{{ patient.phone }}" class="hover:underline transition-colors font-semibold text-violet-400">
                            {{ patient.phone }}
                          </a>
                        </div>
                      }
                    }
                  </div>
                </div>

                <!-- Footer Actions: Map Link and Button -->
                <div class="flex items-center justify-between gap-4 pt-1 border-t border-slate-700/15 mt-auto">
                  <div class="flex-shrink-0">
                    @if (mapUrl(a); as url) {
                      <a [href]="url" target="_blank" rel="noopener" class="text-[12px] font-semibold text-violet-400 hover:text-violet-300 transition-colors inline-flex items-center gap-1">
                        <span>Directions</span>
                        <span class="text-[10px]">↗</span>
                      </a>
                    }
                  </div>
                  <div class="flex-shrink-0">
                    @if (a.status === 'booked') {
                      <pf-touch-btn size="sm" variant="primary" class="sm:w-auto" (pressed)="checkInAndCollect(a)">
                        Check in &amp; collect
                      </pf-touch-btn>
                    } @else {
                      <pf-touch-btn size="sm" variant="secondary" class="sm:w-auto" (pressed)="goCollect()">
                        Collect samples
                      </pf-touch-btn>
                    }
                  </div>
                </div>
              </div>
            </pf-tile>
          }
        </div>
      }
      </div>
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
