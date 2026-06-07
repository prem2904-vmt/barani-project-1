import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { AppointmentQueueService } from '../../../core/services/appointment-queue.service';
import { ToastService } from '../../../core/services/toast.service';
import { Appointment, HomeCollectionAgent } from '../../../shared/models/appointment.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { LoadingLogoComponent } from '../../../shared/components/loading-logo/loading-logo.component';

@Component({
  selector: 'pf-home-collection-assign',
  standalone: true,
  imports: [ScreenHeaderComponent, TileComponent, TouchButtonComponent, SelectComponent, LoadingLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10 max-w-3xl">
      <pf-screen-header
        eyebrow="Front desk"
        title="Unassigned home collections"
        subtitle="Requests no agent's area covers. Pick an agent to assign each one.">
        <pf-touch-btn actions size="sm" variant="ghost" (pressed)="load()">Refresh</pf-touch-btn>
      </pf-screen-header>

      @if (loading() && items().length === 0) {
        <pf-tile tone="default" padding="lg" class="block">
          <div class="flex justify-center py-6">
            <pf-loading-logo size="lg" color="purple" [showDna]="true" [showText]="true" text="Loading…"></pf-loading-logo>
          </div>
        </pf-tile>
      } @else if (items().length === 0) {
        <pf-tile tone="default" padding="xl" class="block">
          <p class="text-center text-[13px]" style="color: var(--text-tertiary);">
            Nothing waiting — every home-collection request has an agent.
          </p>
        </pf-tile>
      } @else {
        @if (agentOptions().length === 0) {
          <pf-tile tone="amber" padding="md" class="block mb-3">
            <p class="text-[12px]" style="color: var(--text-secondary);">
              No home-collection agents exist yet. Add some in Admin → Home-collection agents.
            </p>
          </pf-tile>
        }
        <div class="space-y-2.5">
          @for (a of items(); track a.id) {
            <pf-tile tone="default" padding="md" class="block">
              <div class="flex items-start gap-3 flex-wrap md:flex-nowrap">
                <div class="flex-1 min-w-0">
                  <p class="font-semibold text-[15px] truncate" style="color: var(--text-primary);">{{ a.patient?.displayName || 'Patient' }}</p>
                  <p class="text-[13px] mt-0.5" style="color: var(--text-secondary);">{{ a.address || 'No address' }}{{ a.pincode ? ' · ' + a.pincode : '' }}</p>
                  <p class="text-[12px] mt-0.5" style="color: var(--text-tertiary);">{{ a.slotTime || '—' }} @if (a.patient?.phone) { · {{ a.patient?.phone }} }</p>
                </div>
                <div class="flex items-center gap-2 w-full md:w-auto">
                  <div class="w-44">
                    <pf-select [options]="agentOptions()" [value]="pick()[a.id] ?? ''"
                      placeholder="Choose agent" size="sm"
                      (valueChange)="setPick(a.id, $any($event))"></pf-select>
                  </div>
                  <pf-touch-btn size="sm" variant="primary" [disabled]="!pick()[a.id]" (pressed)="assign(a)">Assign</pf-touch-btn>
                </div>
              </div>
            </pf-tile>
          }
        </div>
      }
    </section>
  `
})
export class HomeCollectionAssignComponent implements OnInit {
  private readonly svc = inject(AppointmentQueueService);
  private readonly toast = inject(ToastService);

  private readonly _items = signal<Appointment[]>([]);
  private readonly _agents = signal<HomeCollectionAgent[]>([]);
  private readonly _pick = signal<Record<string, string>>({});
  private readonly _loading = signal(false);

  readonly items = this._items.asReadonly();
  readonly pick = this._pick.asReadonly();
  readonly loading = this._loading.asReadonly();

  readonly agentOptions = computed<PfSelectOption<string>[]>(() =>
    this._agents().filter(a => a.isActive).map(a => ({ value: a.userId, label: this.agentName(a) })));

  ngOnInit() {
    this.load();
    this.svc.listAgents().subscribe({ next: l => this._agents.set(l ?? []) });
  }

  load() {
    this._loading.set(true);
    this.svc.unassignedHomeCollections().subscribe({
      next: l => { this._items.set(l ?? []); this._loading.set(false); },
      error: () => { this._loading.set(false); this.toast.error('Could not load requests.'); }
    });
  }

  setPick(apptId: string, agentUserId: string) {
    this._pick.update(m => ({ ...m, [apptId]: agentUserId }));
  }

  assign(a: Appointment) {
    const agentUserId = this._pick()[a.id];
    if (!agentUserId) return;
    this.svc.assignAgent(a.id, agentUserId).subscribe({
      next: () => { this.toast.success('Assigned.'); this.load(); },
      error: () => this.toast.error('Could not assign.')
    });
  }

  private agentName(a: HomeCollectionAgent): string {
    const u = a.user;
    return u?.displayName || u?.name
      || [u?.firstName, u?.fathersName].filter(Boolean).join(' ')
      || u?.email || a.userId.slice(0, 8);
  }
}
