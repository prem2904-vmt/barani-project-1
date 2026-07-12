import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { AppointmentQueueService } from '../../../core/services/appointment-queue.service';
import { ToastService } from '../../../core/services/toast.service';
import { HomeCollectionAgent } from '../../../shared/models/appointment.model';
import { User, userDisplayName } from '../../../shared/models/user.model';
import { ChipComponent } from '../../../shared/primitives/chip.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { NumberInputComponent } from '../../../shared/primitives/number-input.component';
import { ApiError } from '../../../shared/models/api-response.model';

type AreaMode = 'pincode' | 'radius';
interface Draft {
  userId: string;
  areaMode: AreaMode;
  pincodes: string;
  centerLat: number | null;
  centerLng: number | null;
  radiusKm: number | null;
  weightage: number;
}
const EMPTY: Draft = { userId: '', areaMode: 'pincode', pincodes: '', centerLat: null, centerLng: null, radiusKm: 5, weightage: 1 };

@Component({
  selector: 'pf-home-collection-agents',
  standalone: true,
  imports: [FormsModule, ChipComponent, ScreenHeaderComponent, SegmentedComponent, SelectComponent, TileComponent, TouchButtonComponent, NumberInputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    /* Phone-only (<=640px): keep this page's OWN text input at >=16px so iOS
       Safari does not auto-zoom on focus. Scoped to this component's instances
       only — does not restyle the global .pf-input primitive elsewhere.
       Desktop-web (>=1280px) and iPad are byte-for-byte unchanged. */
    @media (max-width: 640px) {
      :host input.pf-input { font-size: 16px; }
      /* Same iOS auto-zoom guard for this page's numeric fields (lat/lng/radius/
         weight). pf-number-input's inner .field is 14px; bump to 16px on phone.
         Scoped under :host so only THIS page's number inputs are affected — the
         shared pf-number-input primitive is unchanged everywhere else, and
         iPad/desktop are byte-for-byte untouched. */
      :host ::ng-deep pf-number-input .field { font-size: 16px; }
    }
  `],
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10 max-w-6xl mx-auto w-full">
      <pf-screen-header
        eyebrow="Admin"
        title="Home-collection agents"
        subtitle="Assign staff as home-collection agents and define the area they cover. Requests are auto-routed by area, load-balanced by weight.">
        <pf-touch-btn actions size="sm" variant="primary" (pressed)="toggleForm()">
          {{ formOpen() ? 'Cancel' : '+ Add agent' }}
        </pf-touch-btn>
      </pf-screen-header>

      @if (formOpen()) {
        <pf-tile tone="violet" padding="lg" class="block mb-4 max-w-3xl">
          <h3 class="pf-section-title mb-3">{{ editing() ? 'Edit area' : 'New agent' }}</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="sm:col-span-2">
              <label class="pf-label">Agent (staff member)</label>
              <pf-select [options]="userOptions()" [value]="draft().userId" [disabled]="editing()"
                placeholder="Pick a user" (valueChange)="patch({ userId: $any($event) })"></pf-select>
            </div>
            <div class="sm:col-span-2">
              <label class="pf-label">Coverage</label>
              <pf-segmented [options]="modeOptions" [value]="draft().areaMode" size="sm"
                (valueChange)="patch({ areaMode: $any($event) })"></pf-segmented>
            </div>

            @if (draft().areaMode === 'pincode') {
              <div class="sm:col-span-2">
                <label class="pf-label">Pincodes — list and/or ranges</label>
                <input type="text" class="pf-input" [ngModel]="draft().pincodes"
                  (ngModelChange)="patch({ pincodes: $event })" placeholder="600001, 600028, 600001-600050" />
                <p class="text-[11px] mt-1" style="color: var(--text-tertiary);">
                  Comma-separated. Use a range with a dash or "to": <code>600001-600050</code> or <code>600001 to 600050</code>.
                </p>
              </div>
            } @else {
              <div>
                <label class="pf-label">Centre latitude</label>
                <pf-number-input [value]="draft().centerLat" [step]="0.001" [allowEmpty]="true"
                  (valueChange)="patch({ centerLat: $event })"></pf-number-input>
              </div>
              <div>
                <label class="pf-label">Centre longitude</label>
                <pf-number-input [value]="draft().centerLng" [step]="0.001" [allowEmpty]="true"
                  (valueChange)="patch({ centerLng: $event })"></pf-number-input>
              </div>
              <div>
                <label class="pf-label">Radius (km)</label>
                <pf-number-input [value]="draft().radiusKm" [step]="1" [min]="1" [allowEmpty]="true"
                  (valueChange)="patch({ radiusKm: $event })"></pf-number-input>
              </div>
            }

            <div>
              <label class="pf-label">Weight (share of work)</label>
              <pf-number-input [value]="draft().weightage" [step]="1" [min]="1"
                (valueChange)="patch({ weightage: $event ?? 1 })"></pf-number-input>
            </div>
          </div>
          <div class="mt-4 flex justify-end gap-2">
            <pf-touch-btn size="sm" variant="ghost" (pressed)="toggleForm()">Cancel</pf-touch-btn>
            <pf-touch-btn size="sm" variant="primary" [disabled]="!draft().userId || saving()" (pressed)="save()">
              {{ saving() ? 'Saving…' : 'Save agent' }}
            </pf-touch-btn>
          </div>
        </pf-tile>
      }

      @if (agents().length === 0) {
        <pf-tile tone="default" padding="xl" class="block">
          <p class="text-center text-[13px]" style="color: var(--text-tertiary);">No home-collection agents yet.</p>
        </pf-tile>
      } @else {
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          @for (a of agents(); track a.id) {
            <pf-tile tone="default" padding="md" class="block h-full">
              <div class="flex flex-col justify-between h-full gap-3">
                <div class="min-w-0">
                  <div class="flex items-center gap-2 flex-wrap min-w-0">
                    <p class="font-semibold text-[14px] truncate min-w-0" style="color: var(--text-primary);">{{ agentName(a) }}</p>
                    <pf-chip tone="violet" size="sm">weight {{ a.weightage }}</pf-chip>
                    @if (!a.isActive) { <pf-chip tone="default" size="sm">inactive</pf-chip> }
                  </div>
                  <p class="text-[12px] mt-1.5" style="color: var(--text-tertiary);">{{ areaSummary(a) }}</p>
                </div>
                <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-700/30">
                  <pf-touch-btn size="sm" variant="secondary" (pressed)="edit(a)">Edit</pf-touch-btn>
                  <pf-touch-btn size="sm" variant="ghost" (pressed)="remove(a)">Remove</pf-touch-btn>
                </div>
              </div>
            </pf-tile>
          }
        </div>
      }
    </section>
  `
})
export class HomeCollectionAgentsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly svc = inject(AppointmentQueueService);
  private readonly toast = inject(ToastService);

  readonly modeOptions: SegmentedOption<AreaMode>[] = [
    { value: 'pincode', label: 'Pincode list' },
    { value: 'radius', label: 'Geo radius' }
  ];

  private readonly _agents = signal<HomeCollectionAgent[]>([]);
  private readonly _users = signal<User[]>([]);
  private readonly _draft = signal<Draft>({ ...EMPTY });
  private readonly _formOpen = signal(false);
  private readonly _editing = signal(false);
  private readonly _saving = signal(false);

  readonly agents = this._agents.asReadonly();
  readonly draft = this._draft.asReadonly();
  readonly formOpen = this._formOpen.asReadonly();
  readonly editing = this._editing.asReadonly();
  readonly saving = this._saving.asReadonly();

  readonly userOptions = computed<PfSelectOption<string>[]>(() =>
    this._users().filter(u => u.isActive).map(u => ({ value: u.id, label: `${userDisplayName(u)} · ${u.email}` })));

  ngOnInit() {
    this.load();
    this.api.get<User[]>('/api/users/').subscribe({ next: l => this._users.set(l ?? []) });
  }

  private load() {
    this.svc.listAgents().subscribe({ next: l => this._agents.set(l ?? []) });
  }

  toggleForm() {
    if (this._formOpen()) { this._formOpen.set(false); return; }
    this._draft.set({ ...EMPTY });
    this._editing.set(false);
    this._formOpen.set(true);
  }
  patch(p: Partial<Draft>) { this._draft.update(d => ({ ...d, ...p })); }

  edit(a: HomeCollectionAgent) {
    this._draft.set({
      userId: a.userId,
      areaMode: a.areaMode,
      pincodes: this.parsePincodes(a.pincodesJson).join(', '),
      centerLat: a.centerLat ?? null,
      centerLng: a.centerLng ?? null,
      radiusKm: a.radiusKm ?? 5,
      weightage: a.weightage
    });
    this._editing.set(true);
    this._formOpen.set(true);
  }

  save() {
    const d = this._draft();
    if (!d.userId) return;
    this._saving.set(true);
    this.svc.upsertAgent({
      userId: d.userId,
      areaMode: d.areaMode,
      centerLat: d.areaMode === 'radius' ? d.centerLat : null,
      centerLng: d.areaMode === 'radius' ? d.centerLng : null,
      radiusKm: d.areaMode === 'radius' ? d.radiusKm : null,
      pincodes: d.areaMode === 'pincode' ? d.pincodes.split(',').map(p => p.trim()).filter(Boolean) : [],
      weightage: Math.max(1, d.weightage),
      isActive: true
    }).subscribe({
      next: () => { this._saving.set(false); this._formOpen.set(false); this.toast.success('Saved.'); this.load(); },
      error: e => { this._saving.set(false); this.toast.error(ApiError.from(e).message); }
    });
  }

  remove(a: HomeCollectionAgent) {
    this.svc.removeAgent(a.id).subscribe({
      next: () => { this.toast.success('Removed.'); this.load(); },
      error: e => this.toast.error(ApiError.from(e).message)
    });
  }

  agentName(a: HomeCollectionAgent): string {
    return a.user?.name || this._users().find(u => u.id === a.userId)?.displayName || a.user?.email || a.userId.slice(0, 8);
  }
  areaSummary(a: HomeCollectionAgent): string {
    if (a.areaMode === 'radius') {
      if (a.centerLat == null || a.centerLng == null) return 'Radius area — coordinates not set';
      return `${a.radiusKm ?? '?'} km around ${a.centerLat.toFixed(3)}, ${a.centerLng.toFixed(3)}`;
    }
    const pins = this.parsePincodes(a.pincodesJson);
    return pins.length ? `Pincodes: ${pins.join(', ')}` : 'Pincode area — none set';
  }
  private parsePincodes(json?: string | null): string[] {
    if (!json) return [];
    try { return JSON.parse(json) as string[]; } catch { return []; }
  }
}
