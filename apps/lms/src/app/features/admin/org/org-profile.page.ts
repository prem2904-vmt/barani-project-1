import { HasUnsavedChanges, guardUnsavedOnUnload } from '../../../shared/utils/unsaved-changes';
import { SettingGroupComponent, SettingRowComponent } from '../../../shared/components/setting-row/setting-row.component';
import { ChangeDetectionStrategy, Component, Injector, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { DialogService } from '../../../core/services/dialog.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { brandingSrc } from '../../../core/services/uploads.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { ApiError } from '../../../shared/models/api-response.model';
import type { TenantBrandingMode } from '../../../shared/models/tenant.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { ImageUploadComponent } from '../report-template/image-upload.component';
import { OrgProfile, OrgProfileService, letterheadDiffers } from './org-profile.service';

const SHORT_NAME_MAX = 30;

/**
 * Settings → Organization → Organization profile (`/admin/org/profile`): who you are, set ONCE. The name, the short name
 * and logo for the top bar, and the login handle. The same name and logo print on reports and bills — the Report design
 * and Invoice letterhead editors show them read-only ("Change in Organization profile"). Saving here writes every
 * existing store in one go (tenant, report template, bill template) through `OrgProfileService`; nothing new is stored.
 */
@Component({
  selector: 'pf-org-profile',
  standalone: true,
  imports: [SettingRowComponent, SettingGroupComponent, BusyDirective, FormsModule, HeroBandComponent, ScreenHeaderComponent, SegmentedComponent, ImageUploadComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10" data-testid="org-profile">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" [tabsOnly]="true">
          <ng-container band-actions>
            @if (hasUnsavedChanges()) { <span class="pf-savestate" role="status" data-testid="unsaved-state"><span class="pf-savestate__dot" aria-hidden="true"></span>Unsaved</span> }
            <button type="button" class="pf-hb-btn pf-hb-btn--primary press" data-testid="op-save"
                    [disabled]="saving() || !canSave()" [pfBusy]="saving()" pfBusyLabel="Saving…" (click)="save()"
                    aria-label="Save" title="Save">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
              {{ saving() ? 'Saving…' : 'Save' }}
            </button>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only" eyebrow="Organization" title="Organization profile"
        subtitle="Your name and logo, set once. They show in the top bar and print on reports and bills.">
      </pf-screen-header>

      <div class="pf-band-body">
        <div class="pf-op__rows pf-sgrid">
          <pf-setting-group id="name" label="Name" scope="everywhere" icon="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01">
          <pf-setting-row data-testid="op-name" label="Organization name" hint="Shown across the app and printed on reports and bills.">
            <input class="pf-input pf-op__in" data-testid="op-name-input" maxlength="80" aria-label="Organization name"
                   [ngModel]="name()" (ngModelChange)="name.set($event)" placeholder="e.g. Arun Labs" />
          </pf-setting-row>
          <pf-setting-row label="Short name for the top bar" [hint]="shortName().length + ' of ' + shortMax + ' letters'">
            <input class="pf-input pf-op__in pf-op__in--short" data-testid="op-short-input" [attr.maxlength]="shortMax" aria-label="Short name for the top bar"
                   [ngModel]="shortName()" (ngModelChange)="onShortName($event)" placeholder="e.g. ARUN" />
          </pf-setting-row>
          </pf-setting-group>
          <pf-setting-group id="logo" label="Logo" scope="top bar, reports and bills" icon="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM9 7a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM21 15l-5-5L5 21">
          <pf-setting-row data-testid="op-logo" label="Logo" hint="One logo for the top bar, reports and bills.">
            <pf-image-upload [url]="logoUrl()" (urlChange)="logoUrl.set($event)"></pf-image-upload>
          </pf-setting-row>
          <pf-setting-row label="What the top bar shows">
            <pf-segmented size="sm" [options]="modeOptions" [value]="mode()" ariaLabel="What the top bar shows" (valueChange)="mode.set($event)"></pf-segmented>
            <span class="pf-op__preview" data-testid="op-preview" [class.pf-op__preview--empty]="!hasBrand()">
              @if (showLogoPreview()) { <img [src]="logoSrc() ?? ''" alt="" class="pf-op__preview-logo" /> }
              @if (showNamePreview()) { <span class="pf-op__preview-name">{{ shortName() }}</span> }
              @if (!hasBrand()) { <span class="pf-op__preview-name pf-op__preview-name--ph">Preview</span> }
            </span>
          </pf-setting-row>
          <pf-setting-row data-testid="op-prints" label="Printed on reports and bills">
            <span row-hint class="pf-op__hint" data-testid="op-prints-status">
              @if (printsDiffer()) {
                Reports or bills still print a different name or logo — Save to use this profile on both.
              } @else {
                Reports and bills print this name and logo; the rest of each letterhead stays in Report design and Billing.
              }
            </span>
          </pf-setting-row>
          </pf-setting-group>
          <pf-setting-group id="signin" label="Sign-in" scope="all staff" icon="M7.5 11a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM21 2l-9.6 9.6M15.5 7.5l3 3L22 7l-3-3">
          <pf-setting-row data-testid="op-handle" label="Login handle" hint="What staff type on the sign-in screen. Changing it changes how everyone logs in.">
            <input class="pf-input pf-op__in" data-testid="op-slug-input" maxlength="40" aria-label="Login handle" [ngModel]="slug()" (ngModelChange)="onSlug($event)"
                   placeholder="e.g. microworld" autocapitalize="off" autocorrect="off" spellcheck="false" />
          </pf-setting-row>
          </pf-setting-group>
        </div>
        <div class="pf-classic-only pf-op__save">
          <button type="button" class="pf-btn pf-btn--primary press" [disabled]="saving() || !canSave()" [pfBusy]="saving()" (click)="save()">{{ saving() ? 'Saving…' : 'Save' }}</button>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .pf-op__in { width: 320px; max-width: 100%; height: 36px; min-height: 36px; }
    .pf-op__in--short { width: 320px; }
    .pf-op__hint { font-size: 12.5px; color: var(--text-tertiary); line-height: 1.4; }
    .pf-op__preview { display: inline-flex; align-items: center; gap: 8px; padding: 0 12px; height: 34px;
      border-radius: 8px; background: var(--pf-chip-bg); border: 1px solid var(--pf-line); }
    .pf-op__preview--empty { border-style: dashed; }
    .pf-op__preview-logo { max-height: 22px; max-width: 72px; object-fit: contain; }
    .pf-op__preview-name { font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--text-primary); }
    .pf-op__preview-name--ph { color: var(--text-tertiary); font-weight: 600; }
    .pf-op__save { display: flex; justify-content: flex-end; }
    @media (max-width: 767px) { .pf-op__in, .pf-op__in--short { width: 100%; } :host input.pf-input { font-size: 16px; } }
  `],
})
export class OrgProfilePage implements HasUnsavedChanges {
  private readonly api = inject(ApiService);
  private readonly profile = inject(OrgProfileService);
  private readonly tenantState = inject(TenantStateService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly injector = inject(Injector);
  protected readonly theme = inject(ThemeService);

  readonly shortMax = SHORT_NAME_MAX;
  readonly modeOptions: SegmentedOption<TenantBrandingMode>[] = [
    { value: 'both', label: 'Both' },
    { value: 'logo', label: 'Logo' },
    { value: 'name', label: 'Name' },
  ];

  readonly name = signal('');
  readonly shortName = signal('');
  readonly mode = signal<TenantBrandingMode>('both');
  readonly logoUrl = signal('');
  readonly slug = signal('');

  /** What was loaded / last saved — the dirty check and the "write only what changed" baseline. */
  private readonly base = signal<OrgProfile>({ name: '', brandingName: '', brandingMode: 'both', logoUrl: '' });
  private readonly slugBase = signal('');
  /** The letterheads' own copies (report + bill), to say whether they already match. */
  private readonly letterheads = signal<{ report: Record<string, unknown> | null; invoice: Record<string, unknown> | null } | null>(null);
  readonly saving = signal(false);

  readonly current = computed<OrgProfile>(() => ({
    name: this.name().trim(), brandingName: this.shortName(), brandingMode: this.mode(), logoUrl: this.logoUrl(),
  }));
  readonly profileDirty = computed(() => JSON.stringify(this.current()) !== JSON.stringify(this.base()));
  readonly slugDirty = computed(() => !!this.slug() && this.slug() !== this.slugBase());
  /** The report / bill letterhead prints something other than the profile. */
  readonly printsDiffer = computed(() => {
    const l = this.letterheads();
    if (!l) return false;
    const p = { name: this.base().name, logoUrl: this.base().logoUrl };
    return letterheadDiffers(l.report, p) || letterheadDiffers(l.invoice, p);
  });
  readonly canSave = computed(() => !!this.name().trim() && (this.profileDirty() || this.slugDirty() || this.printsDiffer()));

  readonly logoSrc = computed(() => brandingSrc(this.injector, this.logoUrl()));
  readonly showLogoPreview = computed(() => (this.mode() === 'logo' || this.mode() === 'both') && !!this.logoUrl());
  readonly showNamePreview = computed(() => (this.mode() === 'name' || this.mode() === 'both') && !!this.shortName());
  readonly hasBrand = computed(() => this.showLogoPreview() || this.showNamePreview());

  private seeded = false;
  private readonly seed = effect(() => {
    const t = this.tenantState.tenant();
    if (!t || this.seeded) return;
    this.seeded = true;
    const p: OrgProfile = { name: t.name ?? '', brandingName: t.brandingName ?? '', brandingMode: t.brandingMode ?? 'both', logoUrl: t.logoUrl ?? '' };
    this.name.set(p.name); this.shortName.set(p.brandingName); this.mode.set(p.brandingMode); this.logoUrl.set(p.logoUrl);
    this.base.set(p);
    const s = (t.slug ?? '').toLowerCase();
    this.slug.set(s); this.slugBase.set(s);
    this.adoptLetterheadLogo();
  });

  /** A lab that only ever uploaded its logo on the report letterhead keeps it: with no organization logo yet, the
   *  profile offers the report's (an unsaved change until Save), so the first Save never blanks a printed logo. */
  private adoptLetterheadLogo(): void {
    const l = this.letterheads();
    const t = this.tenantState.tenant();
    if (!l || !t || this.logoUrl()) return;
    const url = String(l.report?.['logoUrl'] ?? l.invoice?.['logoUrl'] ?? '');
    if (url) this.logoUrl.set(url);
  }

  constructor() {
    this.tenantState.ensureLoaded();
    this.profile.letterheadStatus().subscribe({ next: l => { this.letterheads.set(l); this.adoptLetterheadLogo(); }, error: () => this.letterheads.set(null) });
  }

  /** Short name is a display label: letters / numbers / spaces and a few brand marks only. */
  protected onShortName(v: string) {
    this.shortName.set((v ?? '').replace(/[^\p{L}\p{N} &._'-]/gu, '').slice(0, SHORT_NAME_MAX));
  }
  /** The handle is lowercase letters, numbers and hyphens. */
  protected onSlug(v: string) { this.slug.set((v ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40)); }

  // ── Unsaved changes (ask before leaving; the browser asks on tab close) ──
  readonly unsavedLabel = 'the organization profile';
  hasUnsavedChanges(): boolean { return this.profileDirty() || this.slugDirty(); }
  async saveChanges(): Promise<boolean> { await this.save(); return !this.hasUnsavedChanges(); }
  private readonly _unload = guardUnsavedOnUnload(this);

  async save(): Promise<void> {
    if (this.saving() || !this.canSave()) return;
    let changeHandle = false;
    if (this.slugDirty()) {
      changeHandle = await this.dialog.confirm({
        title: 'Change the login handle?',
        message: 'Changing the login handle changes how staff sign in. Continue?',
        confirmLabel: 'Change handle',
        tone: 'danger',
      });
      if (!changeHandle) return;
    }
    this.saving.set(true);
    try {
      const next = this.current();
      // The profile's name + logo go to the tenant, the report template and the bill template in one go.
      await firstValueFrom(this.profile.saveEverywhere(next, this.base()));
      this.base.set(next);
      this.letterheads.set(await firstValueFrom(this.profile.letterheadStatus()));
      if (changeHandle) {
        const s = this.slug();
        await firstValueFrom(this.api.patch('/api/tenants/current', { slug: s }));
        this.slugBase.set(s);
        this.toasts.success('Saved. Staff now sign in with the new login handle.');
      } else {
        this.toasts.success('Organization profile saved. Reports and bills print the same name and logo.');
      }
    } catch (e: unknown) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.saving.set(false);
    }
  }
}
