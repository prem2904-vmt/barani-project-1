import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { ReferralLab } from '../../../shared/models/referral-lab.model';
import { Department } from '../../../shared/models/tenant.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ThemeService } from '../../../core/services/theme.service';
import { bandFilter } from '../../../shared/utils/band-search';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { SkeletonRowsComponent } from '../../../shared/primitives/skeleton-kit.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';

interface LabDraft {
  id?: string;
  name: string;
  code: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  address: string;
  departmentCodes: string[];
}

const EMPTY: LabDraft = {
  name: '', code: '', contactName: '', contactPhone: '', contactEmail: '', address: '', departmentCodes: [],
};

/**
 * Admin master for outsourced / referral labs (e.g. Apollo). A test marked
 * "outsourced" in the test editor points at one of these; at sample collection
 * its tests form their own vials grouped by (referral lab + department).
 */
@Component({
  selector: 'pf-referral-labs',
  standalone: true,
  imports: [BusyDirective, SkeletonRowsComponent, FormsModule, ScreenHeaderComponent, TouchButtonComponent, HeroBandComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- Band pill (owner): referral-lab search; "Add referral lab" rides
             the band's actions. -->
        <pf-hero-band [back]="true" placeholder="Search referral labs — name, code, contact, department…"
                      [value]="q()" (valueChange)="q.set($event)">
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn press" [class.pf-hb-btn--primary]="!formOpen()"
                    [class.pf-hb-btn--ghost]="formOpen()" (click)="toggleForm()"
                    [attr.aria-label]="formOpen() ? 'Cancel' : 'Add referral lab'">
              @if (formOpen()) {
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
              } @else {
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
              }
              {{ formOpen() ? 'Cancel' : 'Add referral lab' }}
            </button>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Admin"
        title="Referral / outsourced labs"
        subtitle="External labs you subcontract tests to. Mark a test as outsourced in the test editor and pick one of these — its samples form their own vials per (lab + department).">
        <pf-touch-btn actions size="sm" variant="primary" (pressed)="toggleForm()">
          <span icon-left aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          </span>
          {{ formOpen() ? 'Cancel' : 'Add referral lab' }}
        </pf-touch-btn>
      </pf-screen-header>

      <div class="pf-band-body">
      @if (formOpen()) {
        <section class="pf-card pf-anim-in pf-rl-form" [attr.aria-label]="draft().id ? 'Edit referral lab' : 'New referral lab'">
          <div class="pf-card__head">
            <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3v6l-5 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-9V3M9 3h6M7.5 14h9"/></svg></span>
            <h3 class="pf-card__label">{{ draft().id ? 'Edit referral lab' : 'New referral lab' }}</h3>
            @if (draft().id && draft().name) { <span class="pf-card__note">{{ draft().name }}</span> }
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pf-rl-form__body">
            <div><label class="pf-field__lbl pf-rl-lbl">Name *</label>
              <input type="text" class="pf-input" [class.pf-input--error]="nameError()" [ngModel]="draft().name" (ngModelChange)="patch({ name: $event })" placeholder="Apollo Diagnostics"/>
              @if (nameError()) { <p class="pf-field-err">{{ nameError() }}</p> }</div>
            <div><label class="pf-field__lbl pf-rl-lbl">Code</label>
              <input type="text" class="pf-input pf-num uppercase" [class.pf-input--error]="codeError()" [ngModel]="draft().code" (ngModelChange)="patch({ code: $event.toUpperCase() })" placeholder="APOLLO"/>
              @if (codeError()) { <p class="pf-field-err">{{ codeError() }}</p> }</div>
            <div><label class="pf-field__lbl pf-rl-lbl">Contact name</label>
              <input type="text" class="pf-input" [ngModel]="draft().contactName" (ngModelChange)="patch({ contactName: $event })"/></div>
            <div><label class="pf-field__lbl pf-rl-lbl">Contact phone</label>
              <input type="tel" class="pf-input" [ngModel]="draft().contactPhone" (ngModelChange)="patch({ contactPhone: $event })"/></div>
            <div><label class="pf-field__lbl pf-rl-lbl">Contact email</label>
              <input type="email" class="pf-input" [ngModel]="draft().contactEmail" (ngModelChange)="patch({ contactEmail: $event })"/></div>
            <div class="sm:col-span-2"><label class="pf-field__lbl pf-rl-lbl">Address</label>
              <input type="text" class="pf-input" [ngModel]="draft().address" (ngModelChange)="patch({ address: $event })"/></div>
            <div class="sm:col-span-2">
              <label class="pf-field__lbl pf-rl-lbl">Departments handled</label>
              <div class="flex flex-wrap gap-2">
                @for (d of deptOptions(); track d.code) {
                  <button type="button" class="pf-chip pf-dept-chip" [attr.aria-pressed]="draft().departmentCodes.includes(d.code)"
                          (click)="toggleDept(d.code)">{{ d.name }}</button>
                } @empty {
                  <span class="pf-field__hint">No departments configured yet.</span>
                }
              </div>
              <p class="pf-field__hint pf-rl-hint">Optional — scopes the department picker on outsourced tests.</p>
            </div>
          </div>
          <div class="pf-card__foot">
            <button type="button" class="pf-btn pf-btn--tertiary press" (click)="toggleForm()">Cancel</button>
            <button type="button" class="pf-btn pf-btn--primary press" (click)="save()" [disabled]="!draft().name.trim() || saving()" [pfBusy]="saving()" pfBusyLabel="Saving…">
              {{ saving() ? 'Saving…' : (draft().id ? 'Save changes' : 'Create referral lab') }}
            </button>
          </div>
        </section>
      }

      @if (loading()) {
        <div class="flex justify-center py-6">
          <pf-skeleton-rows [rows]="4" label="Loading referral labs…"></pf-skeleton-rows>
        </div>
      } @else if (labs().length === 0) {
        <p class="pf-band-empty">No referral labs yet. Add one to start outsourcing tests.</p>
      } @else if (visibleLabs().length === 0) {
        <p class="pf-band-empty">No referral labs match "{{ q() }}".</p>
      } @else {
        <div class="space-y-3">
          @for (l of visibleLabs(); track l.id) {
            <div class="pf-card pf-rl-card">
              <div class="flex items-start justify-between gap-4 flex-wrap">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 mb-1">
                    <h3 class="pf-rl__name">{{ l.name }}</h3>
                    @if (l.code) { <span class="pf-chip pf-chip--static pf-num pf-rl__code">{{ l.code }}</span> }
                    @if (!l.isActive) { <span class="pf-chip pf-chip--static pf-rl__code">Inactive</span> }
                  </div>
                  @if (l.contactName || l.contactPhone) {
                    <p class="pf-rl__meta">{{ l.contactName || '—' }} · {{ l.contactPhone || 'no phone' }}</p>
                  }
                  @if (l.address) { <p class="pf-rl__meta">{{ l.address }}</p> }
                  @if (deptCodesOf(l).length > 0) {
                    <div class="flex flex-wrap gap-1.5 mt-2">
                      @for (c of deptCodesOf(l); track c) { <span class="pf-rl__dept">{{ deptName(c) }}</span> }
                    </div>
                  }
                </div>
                <div class="flex gap-2 flex-wrap pf-rl-actions">
                  <button type="button" class="pf-rowact" [class.pf-rowact--icon]="!web()" (click)="edit(l)" aria-label="Edit" title="Edit"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg><span class="pf-rowact__t">Edit</span></button>
                  <button type="button" class="pf-rowact" [class.pf-rowact--icon]="!web()" (click)="toggleActive(l)"
                          [attr.aria-label]="l.isActive ? 'Deactivate' : 'Reactivate'" [title]="l.isActive ? 'Deactivate' : 'Reactivate'"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><path d="M12 2v10"/></svg><span class="pf-rowact__t">{{ l.isActive ? 'Deactivate' : 'Reactivate' }}</span></button>
                </div>
              </div>
            </div>
          }
        </div>
      }
      </div>
    </section>
  `,
  styles: [`
    @use '../../../shared/styles/device-tier' as dt;
    .pf-section-title { font-size: 11px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-muted); }
    .pf-label { display: block; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 4px; }
    .pf-input { width: 100%; padding: 8px 12px; background: var(--input-bg); border: 1px solid var(--input-border); color: var(--input-text); border-radius: 10px; font-size: 13px; outline: none; }
    .pf-input:focus { border-color: var(--input-border-focus); box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.18); }
    .pf-input--error { border-color: #f43f5e; }
    .pf-input--error:focus { box-shadow: 0 0 0 3px rgba(244, 63, 94, 0.18); }
    .pf-field-err { margin: 4px 0 0; font-size: 11.5px; color: var(--red-text); }
    /* Dept chips: kit .pf-chip with the NEUTRAL selected state (aria-pressed). */
    .pf-dept-chip { height: 32px; }
    .pf-rl-form { margin-bottom: 16px; }
    .pf-rl-form__body { padding: 16px 18px; }
    .pf-rl-card { padding: 16px 18px; overflow: visible; }
    .pf-rl-lbl { display: block; margin-bottom: 6px; }
    .pf-rl-hint { margin-top: 6px; }
    .pf-rl__name { margin: 0; font-size: 16px; font-weight: 600; color: var(--text-primary); letter-spacing: -0.01em; }
    .pf-rl__code { height: 24px; font-size: 12px; font-weight: 600; color: var(--text-secondary); }
    .pf-rl__meta { margin: 2px 0 0; font-size: 12px; color: var(--text-secondary); }
    .pf-rl__dept { padding: 2px 8px; border-radius: 6px; font-size: 10.5px; font-weight: 600; background: var(--pf-chip-bg); color: var(--text-secondary); border: 1px solid var(--pf-line); }

    /* ===== Additive cross-platform overrides (do not affect desktop-web >=1280px) ===== */

    /* Touch devices: enlarge dept chips to a comfortable >=44px tap target (incl. iPad/tablet
       where the pointer is coarse but the viewport is wide) without changing the desktop look. */
    @media (pointer: coarse) {
      .pf-dept-chip { padding: 10px 14px; min-height: 44px; display: inline-flex; align-items: center; }
    }

    /* Phone (<=640): prevent iOS focus-zoom (needs >=16px) and give the form action row room.
       The page itself has no fixed chrome; only widen tap targets and stop zoom. */
    @media (max-width: 640px) {
      .pf-input { font-size: 16px; padding: 10px 12px; }
      .pf-dept-chip { min-height: 44px; }
      /* Card header: action buttons drop to their own full-width row under the meta block. */
      .pf-rl-actions { width: 100%; }
      /* Long lab names + code chip must wrap, not overflow, in the narrow card header. */
      .pf-rl__name { overflow-wrap: anywhere; word-break: break-word; }
      .pf-rl__code { flex-shrink: 0; }
    }

    /* Web-below-desktop band (641–1279px): /admin renders with the fixed 64px left
       icon rail and no top chrome. The section's px-4 md:px-8 gutter already aligns
       the screen-header and the body to the same left edge, so no container fix is
       needed here. Only safeguard against a long, unbreakable lab name overflowing
       its flex column in the card header (which would otherwise push card width and
       force horizontal scroll against the rail). */
    @include dt.tablet-band {
      .pf-rl__name { overflow-wrap: anywhere; word-break: break-word; }
      .pf-rl__code { flex-shrink: 0; }
    }
  `]
})
export class ReferralLabsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);

  protected readonly labs = signal<ReferralLab[]>([]);
  protected readonly theme = inject(ThemeService);
  /** Row actions: text on web, icon on touch (PF-PATTERN). */
  protected readonly web = webPointerSignal();

  /** Band pill search: name, code, contact, address and handled departments. */
  readonly q = signal('');
  readonly visibleLabs = computed(() => bandFilter(this.labs(), this.q(), l => [
    l.name, l.code, l.contactName, l.contactPhone, l.contactEmail, l.address,
    ...this.deptCodesOf(l).flatMap(c => [c, this.deptName(c)]),
  ]));
  protected readonly loading = signal<boolean>(true);
  protected readonly saving = signal<boolean>(false);
  protected readonly formOpen = signal<boolean>(false);
  protected readonly draft = signal<LabDraft>({ ...EMPTY });
  protected readonly nameError = signal<string | null>(null);
  protected readonly codeError = signal<string | null>(null);
  private readonly _departments = signal<Department[]>([]);

  /** Distinct department code→name options for the picker. */
  protected readonly deptOptions = computed(() => {
    const seen = new Map<string, string>();
    for (const d of this._departments()) {
      const code = (d.code ?? '').trim().toUpperCase();
      if (code && !seen.has(code)) seen.set(code, d.name ?? code);
    }
    return Array.from(seen.entries()).map(([code, name]) => ({ code, name }));
  });

  ngOnInit() {
    this.refresh();
    this.api.get<Department[]>('/api/tenants/departments').subscribe({ next: l => this._departments.set(l ?? []) });
  }

  refresh() {
    this.loading.set(true);
    this.api.get<ReferralLab[]>('/api/referral-labs?includeInactive=true').subscribe({
      next: l => { this.labs.set(l ?? []); this.loading.set(false); },
      error: e => { this.loading.set(false); this.toasts.error(e?.message ?? 'Could not load referral labs'); }
    });
  }

  toggleForm() {
    this.formOpen.update(v => !v);
    if (!this.formOpen()) { this.draft.set({ ...EMPTY }); this.clearFieldErrors(); }
  }
  patch(p: Partial<LabDraft>) {
    if ('name' in p) this.nameError.set(null);
    if ('code' in p) this.codeError.set(null);
    this.draft.update(d => ({ ...d, ...p }));
  }
  private clearFieldErrors() { this.nameError.set(null); this.codeError.set(null); }
  toggleDept(code: string) {
    this.draft.update(d => ({
      ...d,
      departmentCodes: d.departmentCodes.includes(code)
        ? d.departmentCodes.filter(c => c !== code)
        : [...d.departmentCodes, code],
    }));
  }

  deptCodesOf(l: ReferralLab): string[] {
    if (!l.departmentCodesJson) return [];
    try { const a = JSON.parse(l.departmentCodesJson); return Array.isArray(a) ? a : []; } catch { return []; }
  }
  deptName(code: string): string {
    return this.deptOptions().find(o => o.code === code)?.name ?? code;
  }

  edit(l: ReferralLab) {
    this.draft.set({
      id: l.id, name: l.name, code: l.code ?? '',
      contactName: l.contactName ?? '', contactPhone: l.contactPhone ?? '',
      contactEmail: l.contactEmail ?? '', address: l.address ?? '',
      departmentCodes: this.deptCodesOf(l),
    });
    this.clearFieldErrors();
    this.formOpen.set(true);
  }

  save() {
    const d = this.draft();
    if (!d.name.trim()) return;
    this.clearFieldErrors();
    this.saving.set(true);
    const body = {
      name: d.name.trim(),
      code: d.code.trim() || null,
      contactName: d.contactName.trim() || null,
      contactPhone: d.contactPhone.trim() || null,
      contactEmail: d.contactEmail.trim() || null,
      address: d.address.trim() || null,
      departmentCodesJson: d.departmentCodes.length ? JSON.stringify(d.departmentCodes) : null,
    };
    const req = d.id
      ? this.api.put<ReferralLab>(`/api/referral-labs/${d.id}`, body)
      : this.api.post<ReferralLab>('/api/referral-labs', body);
    req.subscribe({
      next: () => {
        this.saving.set(false);
        this.toasts.success(d.id ? 'Referral lab updated' : 'Referral lab created');
        this.formOpen.set(false);
        this.draft.set({ ...EMPTY });
        this.refresh();
      },
      error: e => {
        this.saving.set(false);
        const err = ApiError.from(e);
        if (err.field === 'name') this.nameError.set(err.message);
        else if (err.field === 'code') this.codeError.set(err.message);
        else this.toasts.error(err.message);
      }
    });
  }

  toggleActive(l: ReferralLab) {
    this.api.put<ReferralLab>(`/api/referral-labs/${l.id}`, {
      name: l.name, code: l.code ?? null,
      contactName: l.contactName ?? null, contactPhone: l.contactPhone ?? null,
      contactEmail: l.contactEmail ?? null, address: l.address ?? null,
      departmentCodesJson: l.departmentCodesJson ?? null,
      isActive: !l.isActive,
    }).subscribe({
      next: () => { this.toasts.success(l.isActive ? 'Deactivated' : 'Reactivated'); this.refresh(); },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }
}
