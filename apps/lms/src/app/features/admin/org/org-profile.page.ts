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
  imports: [BusyDirective, FormsModule, HeroBandComponent, ScreenHeaderComponent, SegmentedComponent, ImageUploadComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10" data-testid="org-profile">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" [tabsOnly]="true">
          <ng-container band-actions>
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
      <div class="pf-op__col">
        <section class="pf-card pf-op__card" data-testid="op-name">
          <div class="pf-card__head">
            <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01"/></svg></span>
            <h3 class="pf-card__label pf-op__title">Name</h3>
          </div>
          <div class="pf-card__body pf-op__body">
            <p class="pf-op__hint">The name shown across the app and printed on reports and bills, for example "Arun Labs".</p>
            <label class="pf-field">
              <span class="pf-field__lbl">Organization name</span>
              <input class="pf-input" data-testid="op-name-input" maxlength="80" [ngModel]="name()" (ngModelChange)="name.set($event)" placeholder="e.g. Arun Labs" />
            </label>
            <label class="pf-field">
              <span class="pf-field__lbl">Short name for the top bar <span class="pf-op__opt">({{ shortName().length }}/{{ shortMax }})</span></span>
              <input class="pf-input" data-testid="op-short-input" [attr.maxlength]="shortMax" [ngModel]="shortName()" (ngModelChange)="onShortName($event)" placeholder="e.g. ARUN" />
            </label>
          </div>
        </section>

        <section class="pf-card pf-op__card" data-testid="op-logo">
          <div class="pf-card__head">
            <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg></span>
            <h3 class="pf-card__label pf-op__title">Logo</h3>
          </div>
          <div class="pf-card__body pf-op__body">
            <p class="pf-op__hint">One logo for the top bar, reports and bills.</p>
            <pf-image-upload [url]="logoUrl()" (urlChange)="logoUrl.set($event)"></pf-image-upload>
            <div class="pf-field">
              <span class="pf-field__lbl" id="op-mode-l">What the top bar shows</span>
              <pf-segmented size="sm" [options]="modeOptions" [value]="mode()" ariaLabel="What the top bar shows" (valueChange)="mode.set($event)"></pf-segmented>
            </div>
            <div class="pf-op__preview" data-testid="op-preview" [class.pf-op__preview--empty]="!hasBrand()">
              @if (showLogoPreview()) { <img [src]="logoSrc() ?? ''" alt="" class="pf-op__preview-logo" /> }
              @if (showNamePreview()) { <span class="pf-op__preview-name">{{ shortName() }}</span> }
              @if (!hasBrand()) { <span class="pf-op__preview-name pf-op__preview-name--ph">Top bar preview</span> }
            </div>
          </div>
        </section>

        <section class="pf-card pf-op__card" data-testid="op-prints">
          <div class="pf-card__head">
            <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg></span>
            <h3 class="pf-card__label pf-op__title">Printed on reports and bills</h3>
          </div>
          <div class="pf-card__body pf-op__body">
            <p class="pf-op__hint" data-testid="op-prints-status">
              @if (printsDiffer()) {
                Reports or bills still print a different name or logo. Press <strong>Save</strong> to use this profile on both.
              } @else {
                Reports and bills print this name and logo. The rest of each letterhead (tagline, NABL, colours, address) stays in Report design and Billing.
              }
            </p>
          </div>
        </section>

        <section class="pf-card pf-op__card" data-testid="op-handle">
          <div class="pf-card__head">
            <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/></svg></span>
            <h3 class="pf-card__label pf-op__title">Login handle</h3>
          </div>
          <div class="pf-card__body pf-op__body">
            <p class="pf-op__hint">
              The organization name your staff type on the sign-in screen.
              <strong>Changing it changes how everyone logs in</strong> — old links and saved credentials that use the previous handle stop working.
            </p>
            <label class="pf-field">
              <span class="pf-field__lbl">Handle</span>
              <input class="pf-input" data-testid="op-slug-input" maxlength="40" [ngModel]="slug()" (ngModelChange)="onSlug($event)"
                     placeholder="e.g. microworld" autocapitalize="off" autocorrect="off" spellcheck="false" />
            </label>
          </div>
        </section>

        <div class="pf-classic-only pf-op__save">
          <button type="button" class="pf-btn pf-btn--primary press" [disabled]="saving() || !canSave()" [pfBusy]="saving()" (click)="save()">{{ saving() ? 'Saving…' : 'Save' }}</button>
        </div>
      </div>
      </div>
    </section>
  `,
  styles: [`
    .pf-op__col { display: flex; flex-direction: column; gap: 16px; max-width: 56rem; margin-inline: auto; width: 100%; }
    .pf-op__card { overflow: visible; }
    .pf-op__body { overflow: visible; gap: 14px; padding: 14px 16px 18px; display: flex; flex-direction: column; }
    .pf-op__title { margin: 0; }
    .pf-op__hint { margin: 0; font-size: 12.5px; color: var(--text-tertiary); line-height: 1.55; }
    .pf-op__opt { font-weight: 400; color: var(--text-tertiary); }
    .pf-op__preview { display: inline-flex; align-self: flex-start; align-items: center; gap: 10px; padding: 10px 14px; min-height: 44px;
      border-radius: 12px; background: var(--glass-bg); border: 1px solid var(--glass-border); }
    .pf-op__preview--empty { border-style: dashed; }
    .pf-op__preview-logo { max-height: 24px; max-width: 80px; object-fit: contain; }
    .pf-op__preview-name { font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--text-primary); }
    .pf-op__preview-name--ph { color: var(--text-tertiary); font-weight: 600; }
    .pf-op__save { display: flex; justify-content: flex-end; }
    @media (max-width: 640px) { :host input.pf-input { font-size: 16px; } }
  `],
})
export class OrgProfilePage {
  private readonly api = inject(ApiService);
  private readonly profile = inject(OrgProfileService);
  private readonly tenantState = inject(TenantStateService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly injector = inject(Injector);
  protected readonly theme = inject(ThemeService);

  readonly shortMax = SHORT_NAME_MAX;
  readonly modeOptions: SegmentedOption<TenantBrandingMode>[] = [
    { value: 'both', label: 'Logo and name' },
    { value: 'logo', label: 'Logo only' },
    { value: 'name', label: 'Name only' },
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
