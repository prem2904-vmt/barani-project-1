import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { AppointmentQueueService } from '../../../core/services/appointment-queue.service';
import { ToastService } from '../../../core/services/toast.service';
import { HomeCollectionAgent } from '../../../shared/models/appointment.model';
import { User, userDisplayName } from '../../../shared/models/user.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedOption } from '../../../shared/primitives/segmented.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { NumberInputComponent } from '../../../shared/primitives/number-input.component';
import { ApiError } from '../../../shared/models/api-response.model';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ThemeService } from '../../../core/services/theme.service';
import { bandFilter } from '../../../shared/utils/band-search';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';

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
  imports: [FormsModule, ScreenHeaderComponent, SelectComponent, TouchButtonComponent, NumberInputComponent, HeroBandComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    /* ── ND audit: kit cards ── */
    .pf-hc-form { margin-bottom: 16px; max-width: 48rem; }
    .pf-hc-form .pf-section-title { margin: 0; }
    .pf-hc-form__body { padding: 16px 18px; }
    .pf-hc-lbl { display: block; margin-bottom: 6px; }
    .pf-hc-hint { margin-top: 6px; }
    .pf-hc-card { height: 100%; padding: 14px 16px; overflow: visible; }
    .pf-hc-name { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-hc-chip { height: 24px; font-size: 11.5px; gap: 4px; }
    .pf-hc-area { margin: 6px 0 0; font-size: 12px; line-height: 1.45; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
    .pf-hc-acts { border-top: 1px solid var(--nd-line); }
    /* Phone-only (<=640px): keep this page's OWN text input at >=16px so iOS
       Safari does not auto-zoom on focus. Scoped to this component's instances
       only — does not restyle the global .pf-input primitive elsewhere.
       Desktop-web (>=1280px) and iPad are byte-for-byte unchanged. */
    @media (max-width: 640px) {
      :host input.nd-input { font-size: 16px; }
      /* Same iOS auto-zoom guard for this page's numeric fields (lat/lng/radius/
         weight). pf-number-input's inner .field is 14px; bump to 16px on phone.
         Scoped under :host so only THIS page's number inputs are affected — the
         shared pf-number-input primitive is unchanged everywhere else, and
         iPad/desktop are byte-for-byte untouched. */
      :host ::ng-deep pf-number-input .field { font-size: 16px; }
    }
  `],
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10 max-w-6xl mx-auto w-full">
      @if (theme.isNewDesign()) {
        <!-- Band pill (owner): agent search (name, pincodes, area); "Add
             agent" rides the band's actions. -->
        <pf-hero-band [back]="true" placeholder="Search agents — name, pincode, area…"
                      [value]="q()" (valueChange)="q.set($event)">
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn press" [class.pf-hb-btn--primary]="!formOpen()"
                    [class.pf-hb-btn--ghost]="formOpen()" (click)="toggleForm()"
                    [attr.aria-label]="formOpen() ? 'Cancel' : 'Add agent'">
              @if (formOpen()) {
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
              } @else {
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
              }
              {{ formOpen() ? 'Cancel' : 'Add agent' }}
            </button>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Admin"
        title="Home-collection agents"
        subtitle="Assign staff as home-collection agents and define the area they cover. Requests are auto-routed by area, load-balanced by weight.">
        <pf-touch-btn actions size="sm" variant="primary" (pressed)="toggleForm()">
          {{ formOpen() ? 'Cancel' : '+ Add agent' }}
        </pf-touch-btn>
      </pf-screen-header>

      <div class="pf-band-body">
      @if (formOpen()) {
        <section class="nd-card nd-anim-in pf-hc-form" [attr.aria-label]="editing() ? 'Edit area' : 'New agent'">
          <div class="nd-card__head">
            <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10M9 21v-6h6v6"/></svg></span>
            <h3 class="nd-card__label pf-section-title">{{ editing() ? 'Edit area' : 'New agent' }}</h3>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pf-hc-form__body">
            <div class="sm:col-span-2">
              <label class="nd-field__lbl pf-hc-lbl">Agent (staff member)</label>
              <pf-select [options]="userOptions()" [value]="draft().userId" [disabled]="editing()"
                placeholder="Pick a user" (valueChange)="patch({ userId: $any($event) })"></pf-select>
            </div>
            <div class="sm:col-span-2">
              <label class="nd-field__lbl pf-hc-lbl">Coverage</label>
              <span class="nd-seg" role="radiogroup" aria-label="Coverage">
                @for (o of modeOptions; track o.value) {
                  <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="draft().areaMode === o.value"
                          (click)="patch({ areaMode: o.value })">{{ o.label }}</button>
                }
              </span>
            </div>

            @if (draft().areaMode === 'pincode') {
              <div class="sm:col-span-2">
                <label class="nd-field__lbl pf-hc-lbl">Pincodes — list and/or ranges</label>
                <input type="text" class="nd-input nd-num" [ngModel]="draft().pincodes"
                  (ngModelChange)="patch({ pincodes: $event })" placeholder="600001, 600028, 600001-600050" />
                <p class="nd-field__hint pf-hc-hint">
                  Comma-separated. Use a range with a dash or "to": <span class="nd-num">600001-600050</span> or <span class="nd-num">600001 to 600050</span>.
                </p>
              </div>
            } @else {
              <div>
                <label class="nd-field__lbl pf-hc-lbl">Centre latitude</label>
                <pf-number-input [value]="draft().centerLat" [step]="0.001" [allowEmpty]="true"
                  (valueChange)="patch({ centerLat: $event })"></pf-number-input>
              </div>
              <div>
                <label class="nd-field__lbl pf-hc-lbl">Centre longitude</label>
                <pf-number-input [value]="draft().centerLng" [step]="0.001" [allowEmpty]="true"
                  (valueChange)="patch({ centerLng: $event })"></pf-number-input>
              </div>
              <div>
                <label class="nd-field__lbl pf-hc-lbl">Radius (km)</label>
                <pf-number-input [value]="draft().radiusKm" [step]="1" [min]="1" [allowEmpty]="true"
                  (valueChange)="patch({ radiusKm: $event })"></pf-number-input>
              </div>
            }

            <div>
              <label class="nd-field__lbl pf-hc-lbl">Weight (share of work)</label>
              <pf-number-input [value]="draft().weightage" [step]="1" [min]="1"
                (valueChange)="patch({ weightage: $event ?? 1 })"></pf-number-input>
            </div>
          </div>
          <div class="nd-card__foot">
            <button type="button" class="nd-btn nd-btn--tertiary press" (click)="toggleForm()">Cancel</button>
            <button type="button" class="nd-btn nd-btn--primary press" [disabled]="!draft().userId || saving()" (click)="save()">
              {{ saving() ? 'Saving…' : 'Save agent' }}
            </button>
          </div>
        </section>
      }

      @if (agents().length === 0) {
        <p class="pf-band-empty">No home-collection agents yet.</p>
      } @else if (visibleAgents().length === 0) {
        <p class="pf-band-empty">No agents match "{{ q() }}".</p>
      } @else {
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          @for (a of visibleAgents(); track a.id) {
            <div class="nd-card pf-hc-card">
              <div class="flex flex-col justify-between h-full gap-3">
                <div class="min-w-0">
                  <div class="flex items-center gap-2 flex-wrap min-w-0">
                    <p class="pf-hc-name">{{ agentName(a) }}</p>
                    <span class="nd-chip nd-chip--static pf-hc-chip">Weight <span class="nd-num">{{ a.weightage }}</span></span>
                    @if (!a.isActive) { <span class="nd-chip nd-chip--static pf-hc-chip">Inactive</span> }
                  </div>
                  <p class="pf-hc-area">{{ areaSummary(a) }}</p>
                </div>
                <div class="flex items-center justify-end gap-2 pt-2 pf-hc-acts">
                  <button type="button" class="nd-rowact" [class.nd-rowact--icon]="!web()" (click)="edit(a)" aria-label="Edit area" title="Edit"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg><span class="nd-rowact__t">Edit</span></button>
                  <button type="button" class="nd-rowact" [class.nd-rowact--icon]="!web()" (click)="remove(a)" aria-label="Remove agent" title="Remove"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg><span class="nd-rowact__t">Remove</span></button>
                </div>
              </div>
            </div>
          }
        </div>
      }
      </div>
    </section>
  `
})
export class HomeCollectionAgentsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly svc = inject(AppointmentQueueService);
  private readonly toast = inject(ToastService);
  protected readonly theme = inject(ThemeService);
  /** Row actions: text on web, icon on touch (ND-PATTERN). */
  protected readonly web = webPointerSignal();

  /** Band pill search: agent name/email and the area they cover. */
  readonly q = signal('');
  readonly visibleAgents = computed(() => bandFilter(this._agents(), this.q(),
    a => [this.agentName(a), a.user?.email, this.areaSummary(a)]));

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
