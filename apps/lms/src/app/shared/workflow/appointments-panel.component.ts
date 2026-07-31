import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { Appointment } from '../models/appointment.model';

/**
 * Self-contained appointments list — the portable panel for the `appointment`
 * action. Embeddable in any work-area screen via the portable-panels registry.
 * Fetches its own data so it works wherever it's dropped.
 */
@Component({
  selector: 'pf-appointments-panel',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ap">
      @if (loading()) {
        <p class="ap__msg">Loading appointments…</p>
      } @else if (appts().length === 0) {
        <p class="ap__msg">No appointments for today.</p>
      } @else {
        <ul class="ap__list">
          @for (a of appts(); track a.id) {
            <li class="ap__row press" (click)="open(a)">
              <span class="ap__time">{{ a.slotTime || (a.appointmentDate | date:'shortTime') }}</span>
              <span class="ap__name">{{ a.patient?.displayName ?? 'Patient' }}</span>
              <span class="ap__meta">{{ testCount(a) }} test{{ testCount(a) === 1 ? '' : 's' }}</span>
              <span class="ap__status" [attr.data-s]="a.status">{{ a.status }}</span>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: [`
    .ap { padding: 8px; }
    .ap__msg { font-size: 12.5px; color: var(--text-tertiary); text-align: center; padding: 18px 8px; }
    .ap__list { display: flex; flex-direction: column; gap: 6px; }
    .ap__row { display: grid; grid-template-columns: 64px 1fr auto auto; align-items: center; gap: 10px;
               padding: 9px 11px; border-radius: 9px; background: var(--bg-card-solid, rgba(255,255,255,0.04));
               border: 1px solid var(--glass-border); cursor: pointer; }
    .ap__row:hover { border-color: #7c3aed; }
    .ap__time { font-size: 12px; font-weight: 700; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
    .ap__name { font-size: 13px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ap__meta { font-size: 11px; color: var(--text-tertiary); }
    .ap__status { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
                  padding: 2px 7px; border-radius: 999px; color: var(--text-secondary); background: rgba(255,255,255,0.06); }
    .ap__status[data-s='checked_in'] { color: var(--green-text); background: rgba(16,185,129,0.15); }
    .ap__status[data-s='in_progress'] { color: var(--violet-text); background: rgba(124,58,237,0.18); }
  `]
})
export class AppointmentsPanelComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  readonly appts = signal<Appointment[]>([]);
  readonly loading = signal(true);

  ngOnInit() {
    this.api.get<Appointment[]>('/api/appointments/today').subscribe({
      next: l => { this.appts.set(l ?? []); this.loading.set(false); },
      error: () => { this.appts.set([]); this.loading.set(false); },
    });
  }

  testCount(a: Appointment): number {
    return (a.testIds ?? '').split(',').map(s => s.trim()).filter(Boolean).length;
  }

  open(a: Appointment) {
    // Start the order / check-in flow for this appointment (route guards still apply).
    this.router.navigate(['/frontdesk/order'], { queryParams: { patientId: a.patientId, appointmentId: a.id } });
  }
}
