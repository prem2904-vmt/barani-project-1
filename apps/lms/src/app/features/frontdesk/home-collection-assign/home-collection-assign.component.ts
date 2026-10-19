import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { busyIdWhile } from '../busy-id';
import { AppointmentQueueService } from '../../../core/services/appointment-queue.service';
import { ToastService } from '../../../core/services/toast.service';
import { Appointment, HomeCollectionAgent } from '../../../shared/models/appointment.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { ApiError } from '../../../shared/models/api-response.model';
import { SkeletonRowsComponent } from '../../../shared/primitives/skeleton-kit.component';

@Component({
  selector: 'pf-home-collection-assign',
  standalone: true,
  imports: [SkeletonRowsComponent, ScreenHeaderComponent, TileComponent, TouchButtonComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10 max-w-6xl mx-auto w-full">
      <pf-screen-header
        eyebrow="Front desk"
        title="Unassigned home collections"
        subtitle="Requests no agent's area covers. Pick an agent to assign each one.">
        <pf-touch-btn actions size="sm" variant="ghost" [busy]="loading()" busyLabel="Refreshing…" (pressed)="load()">Refresh</pf-touch-btn>
      </pf-screen-header>

      @if (loading() && items().length === 0) {
        <pf-tile tone="default" padding="lg" class="block">
          <div class="flex justify-center py-6">
            <pf-skeleton-rows [rows]="4" label="Loading visits…"></pf-skeleton-rows>
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
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          @for (a of items(); track a.id) {
            <pf-tile tone="default" padding="md" class="block h-full">
              <div class="flex flex-col justify-between h-full gap-4">
                <div class="min-w-0">
                  <p class="font-semibold text-[15px] truncate" style="color: var(--text-primary);">{{ a.patient?.displayName || 'Patient' }}</p>
                  <p class="text-[13px] mt-1" style="color: var(--text-secondary);">{{ a.address || 'No address' }}{{ a.pincode ? ' · ' + a.pincode : '' }}</p>
                  <p class="text-[12px] mt-1" style="color: var(--text-tertiary);">{{ a.slotTime || '—' }} @if (a.patient; as patient) { @if (patient.phone) { · {{ patient.phone }} } }</p>
                </div>
                <div class="pf-assign-row flex items-center gap-2 pt-2 border-t border-slate-700/30">
                  <div class="flex-1 min-w-0">
                    <pf-select [options]="agentOptions()" [value]="pick()[a.id]"
                      placeholder="Choose agent" size="sm"
                      (valueChange)="setPick(a.id, $any($event))"></pf-select>
                  </div>
                  <pf-touch-btn size="sm" variant="primary" class="shrink-0" [disabled]="!pick()[a.id]"
                    [busy]="assigningId() === a.id" busyLabel="Assigning…" (pressed)="assign(a)">Assign</pf-touch-btn>
                </div>
              </div>
            </pf-tile>
          }
        </div>
      }
    </section>
  `,
  styles: [`
    /* Touch-only tap-target floor for the inline agent picker.
       Gated behind (hover:none)+(pointer:coarse) so desktop-web/Electron
       (mouse, fine pointer) stays byte-for-byte unchanged. Scoped to :host. */
    @media (hover: none) and (pointer: coarse) {
      :host ::ng-deep pf-select .pf-dd--sm .pf-dd__trigger {
        min-height: 44px;
      }
      :host ::ng-deep pf-select .pf-dd__option {
        min-height: 40px;
      }
    }
    /* Phone: give the picker + Assign action a touch-comfortable gap. */
    @media (max-width: 640px) {
      :host .pf-assign-row { gap: 10px; }
    }
  `]
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
      error: e => { this._loading.set(false); this.toast.error(ApiError.from(e).message); }
    });
  }

  setPick(apptId: string, agentUserId: string) {
    this._pick.update(m => ({ ...m, [apptId]: agentUserId }));
  }

  /** Visit whose Assign request is in flight. */
  readonly assigningId = signal<string | null>(null);
  assign(a: Appointment) {
    const agentUserId = this._pick()[a.id];
    if (!agentUserId || this.assigningId() === a.id) return;
    this.svc.assignAgent(a.id, agentUserId).pipe(busyIdWhile(this.assigningId, a.id)).subscribe({
      next: () => { this.toast.success('Assigned.'); this.load(); },
      error: e => this.toast.error(ApiError.from(e).message)
    });
  }

  private agentName(a: HomeCollectionAgent): string {
    const u = a.user;
    return u?.displayName || u?.name
      || [u?.firstName, u?.fathersName].filter(Boolean).join(' ')
      || u?.email || a.userId.slice(0, 8);
  }
}
