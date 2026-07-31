import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ToastService } from '../../../core/services/toast.service';
import { Tenant, TenantBrandingMode } from '../../../shared/models/tenant.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

const BRANDING_LOGO_MAX_BYTES = 100 * 1024;
const BRANDING_NAME_MAX = 10;

interface BrandingDraft {
  logoUrl: string;          // base64 data URL or '' for none
  brandingName: string;     // ≤10 chars
  brandingMode: TenantBrandingMode;
}

/**
 * Lab branding editor (route `/setup`). The org, branches and departments are
 * created up-front by the control-plane provisioning flow, so the only thing a
 * live tenant edits here is the top-bar branding — logo + short name + mode.
 */
@Component({
  selector: 'pf-setup-wizard',
  standalone: true,
  imports: [
    FormsModule,
    ScreenHeaderComponent,
    SegmentedComponent,
    TileComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10">

      <pf-screen-header
        eyebrow="Branding"
        title="Lab branding"
        subtitle="The logo and short name shown in the top bar. Everything else about your lab is managed under Admin.">
      </pf-screen-header>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-5 mt-2">
        <pf-tile tone="default" padding="lg" class="lg:col-span-2 block">
          <h2 class="section-title">Top-navigation branding</h2>
          <p class="text-[12px] mt-1" style="color: var(--text-tertiary);">
            What appears in the header pill next to your user avatar. All three fields are optional.
          </p>

          <div class="mt-5">
            <label class="pf-label">What to show</label>
            <pf-segmented size="md"
                           [options]="brandingModeOptions"
                           [value]="branding().brandingMode"
                           (valueChange)="updateBranding({ brandingMode: $event })">
            </pf-segmented>
          </div>

          @if (branding().brandingMode !== 'name') {
            <div class="mt-5">
              <label class="pf-label">Logo</label>
              <div class="brand-upload"
                   [class.brand-upload--dragging]="draggingLogo()"
                   (dragenter)="onLogoDrag($event, true)"
                   (dragover)="onLogoDrag($event, true)"
                   (dragleave)="onLogoDrag($event, false)"
                   (drop)="onLogoDrop($event)">
                @if (branding().logoUrl) {
                  <img [src]="branding().logoUrl" alt="Logo preview" class="brand-upload__preview" />
                  <div class="brand-upload__actions">
                    <button type="button" class="brand-upload__btn" (click)="openLogoPicker()">Replace</button>
                    <button type="button" class="brand-upload__btn brand-upload__btn--danger" (click)="clearLogo()">Remove</button>
                  </div>
                } @else {
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="brand-upload__icon">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <path d="M17 8l-5-5-5 5"/>
                    <path d="M12 3v12"/>
                  </svg>
                  <p class="brand-upload__hint">
                    Drop an image, or
                    <button type="button" class="brand-upload__link" (click)="openLogoPicker()">browse</button>
                  </p>
                  <p class="brand-upload__meta">PNG / SVG / JPG / WebP, up to 100 KB</p>
                }
                <input #logoInput type="file"
                       accept="image/png,image/svg+xml,image/jpeg,image/webp"
                       hidden
                       (change)="onLogoSelected($any($event.target).files)" />
              </div>
              @if (logoError()) {
                <p class="brand-error">{{ logoError() }}</p>
              }
            </div>
          }

          @if (branding().brandingMode !== 'logo') {
            <div class="mt-5">
              <label class="pf-label">
                Short name
                <span class="text-[11px] font-mono ml-2" style="color: var(--text-muted);">
                  {{ branding().brandingName.length }}/{{ nameMax }}
                </span>
              </label>
              <input #nameIn type="text"
                     class="pf-input"
                     [attr.value]="branding().brandingName"
                     [attr.maxlength]="nameMax"
                     placeholder="e.g. APOLLO"
                     (input)="updateBranding({ brandingName: nameIn.value.slice(0, nameMax) })" />
              <p class="text-[11px] mt-1" style="color: var(--text-muted);">
                Hard-capped at {{ nameMax }} characters so the header stays tidy.
              </p>
              @if (nameError()) {
                <p class="brand-error">{{ nameError() }}</p>
              }
            </div>
          }
        </pf-tile>

        <pf-tile tone="violet" padding="lg" class="block">
          <h3 class="section-title">Preview</h3>
          <p class="text-[11.5px] font-mono mt-2" style="color: var(--text-tertiary);">
            How your brand appears in the top strip.
          </p>

          <div class="brand-preview">
            <div class="brand-preview__slot"
                 [class.brand-preview__slot--empty]="!hasBrand()">
              @if (showLogoPreview()) {
                <img [src]="branding().logoUrl" alt="" class="brand-preview__logo" />
              }
              @if (showNamePreview()) {
                <span class="brand-preview__name">{{ branding().brandingName }}</span>
              }
              @if (!hasBrand()) {
                <span class="brand-preview__name brand-preview__name--placeholder">YOUR LOGO</span>
              }
            </div>
          </div>
        </pf-tile>
      </div>

      <!-- Save -->
      <div class="mt-6 flex items-center justify-end">
        <pf-touch-btn size="md" variant="primary"
                       [disabled]="saving()"
                       (pressed)="save()">
          {{ saving() ? 'Saving…' : 'Save branding' }}
        </pf-touch-btn>
      </div>
    </section>
  `,
  styles: [`
    .section-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
      letter-spacing: -0.01em;
      margin: 0;
    }

    /* ── Branding ──────────────────────────────────────────── */
    .brand-upload {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 22px;
      border-radius: 14px;
      border: 2px dashed rgba(168, 85, 247, 0.35);
      background: rgba(168, 85, 247, 0.04);
      min-height: 140px;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .brand-upload--dragging {
      background: rgba(168, 85, 247, 0.12);
      border-color: #a855f7;
    }
    .brand-upload__icon { color: var(--text-muted); }
    .brand-upload__hint { font-size: 13px; color: var(--text-secondary); margin: 0; }
    .brand-upload__meta {
      font-size: 11px;
      color: var(--text-muted);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      margin: 0;
    }
    .brand-upload__link {
      background: none;
      border: none;
      color: var(--violet-text);
      font-weight: 600;
      cursor: pointer;
      padding: 0 2px;
      text-decoration: underline;
    }
    .brand-upload__link:hover { color: #a855f7; }
    .brand-upload__preview { max-height: 80px; max-width: 240px; object-fit: contain; }
    .brand-upload__actions { display: flex; gap: 8px; margin-top: 4px; }
    .brand-upload__btn {
      padding: 5px 12px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid var(--glass-border);
      background: var(--glass-bg);
      color: var(--text-primary);
    }
    .brand-upload__btn:hover { background: var(--glass-bg-hover); }
    .brand-upload__btn--danger {
      color: var(--red-text);
      border-color: rgba(239, 68, 68, 0.4);
      background: rgba(239, 68, 68, 0.08);
    }
    .brand-upload__btn--danger:hover { background: rgba(239, 68, 68, 0.16); }

    .brand-error {
      font-size: 12px;
      color: var(--red-text);
      margin: 6px 0 0;
    }

    .brand-preview { margin-top: 14px; }
    .brand-preview__slot {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border-radius: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      min-height: 44px;
    }
    .brand-preview__slot--empty {
      border-style: dashed;
      border-color: rgba(236, 72, 153, 0.55);
      background: rgba(236, 72, 153, 0.06);
    }
    .brand-preview__logo { max-height: 24px; max-width: 80px; object-fit: contain; }
    .brand-preview__name {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: var(--text-primary);
      text-transform: uppercase;
    }
    .brand-preview__name--placeholder { color: #ec4899; letter-spacing: 0.14em; }

    /* ════════════════════════════════════════════════════════════
     * RESPONSIVE / CROSS-PLATFORM OVERRIDES (additive only).
     * Desktop-web (>=1280px) is untouched: every rule below is gated
     * to a sub-desktop width, a touch pointer, or a platform class.
     * ════════════════════════════════════════════════════════════ */

    /* ── Phone (<=640) ─────────────────────────────────────── */
    @media (max-width: 640px) {
      /* iOS zooms any input whose font-size < 16px on focus. */
      :host input.pf-input {
        font-size: 16px;
      }
      /* The fixed 240px logo preview can exceed a narrow tile's inner width. */
      .brand-upload__preview {
        max-width: 100%;
      }
    }

    /* Touch pointers (phone + tablet): grow the branding pill / link hit areas. */
    @media (pointer: coarse) {
      .brand-upload__btn {
        min-height: 44px;
      }
      .brand-upload__link {
        min-height: 44px;
        display: inline-flex;
        align-items: center;
      }
    }

    /* Only show hover affordances on devices that actually hover. */
    @media (hover: none) {
      .brand-upload__link:hover { color: var(--violet-text); }
      .brand-upload__btn:hover { background: var(--glass-bg); }
      .brand-upload__btn--danger:hover { background: rgba(239, 68, 68, 0.08); }
    }

    /* ── Bottom-nav clearance (phone only) ─────────────────── */
    @media (max-width: 640px) {
      section {
        padding-bottom: var(--tab-nav-total-height);
      }
    }
  `]
})
export class SetupWizardComponent {
  private readonly api = inject(ApiService);
  private readonly tenantState = inject(TenantStateService);
  private readonly toasts = inject(ToastService);

  @ViewChild('logoInput') logoInput?: ElementRef<HTMLInputElement>;

  readonly brandingModeOptions: SegmentedOption<TenantBrandingMode>[] = [
    { value: 'both', label: 'Both' },
    { value: 'logo', label: 'Logo only' },
    { value: 'name', label: 'Name only' }
  ];
  readonly nameMax = BRANDING_NAME_MAX;

  private readonly _branding = signal<BrandingDraft>({ logoUrl: '', brandingName: '', brandingMode: 'both' });
  private readonly _draggingLogo = signal(false);
  private readonly _logoError = signal<string | null>(null);
  private readonly _nameError = signal<string | null>(null);
  private readonly _saving = signal(false);

  readonly branding = this._branding.asReadonly();
  readonly draggingLogo = this._draggingLogo.asReadonly();
  readonly logoError = this._logoError.asReadonly();
  readonly nameError = this._nameError.asReadonly();
  readonly saving = this._saving.asReadonly();

  // Seed the editor from the current tenant once it loads (edit, not create).
  // Guarded so an in-flight edit is never clobbered by a later tenant refresh.
  private _seeded = false;
  private readonly _seed = effect(() => {
    const t = this.tenantState.tenant();
    if (t && !this._seeded) {
      this._seeded = true;
      this._branding.set({
        logoUrl: t.logoUrl ?? '',
        brandingName: t.brandingName ?? '',
        brandingMode: t.brandingMode ?? 'both'
      });
    }
  });

  constructor() { this.tenantState.ensureLoaded(); }

  // Preview helpers — what the navbar pill will actually render.
  readonly showLogoPreview = computed(() => {
    const b = this._branding();
    return (b.brandingMode === 'logo' || b.brandingMode === 'both') && !!b.logoUrl;
  });
  readonly showNamePreview = computed(() => {
    const b = this._branding();
    return (b.brandingMode === 'name' || b.brandingMode === 'both') && !!b.brandingName;
  });
  readonly hasBrand = computed(() => this.showLogoPreview() || this.showNamePreview());

  updateBranding(patch: Partial<BrandingDraft>) {
    if ('brandingName' in patch) this._nameError.set(null);
    this._branding.update(b => ({ ...b, ...patch }));
  }
  openLogoPicker() { this.logoInput?.nativeElement?.click(); }
  onLogoSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    this.ingestLogo(files[0]);
    if (this.logoInput?.nativeElement) this.logoInput.nativeElement.value = '';
  }
  onLogoDrag(ev: DragEvent, entering: boolean) {
    ev.preventDefault(); ev.stopPropagation();
    this._draggingLogo.set(entering);
  }
  onLogoDrop(ev: DragEvent) {
    ev.preventDefault(); ev.stopPropagation();
    this._draggingLogo.set(false);
    const f = ev.dataTransfer?.files?.[0];
    if (f) this.ingestLogo(f);
  }
  clearLogo() {
    this.updateBranding({ logoUrl: '' });
    this._logoError.set(null);
  }
  private ingestLogo(file: File) {
    this._logoError.set(null);
    if (!file.type.startsWith('image/')) {
      this._logoError.set('Only image files are allowed.');
      return;
    }
    if (file.size > BRANDING_LOGO_MAX_BYTES) {
      this._logoError.set(`File is ${Math.round(file.size / 1024)} KB. Keep it under ${Math.round(BRANDING_LOGO_MAX_BYTES / 1024)} KB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => this.updateBranding({ logoUrl: String(reader.result ?? '') });
    reader.onerror = () => this._logoError.set('Could not read the file.');
    reader.readAsDataURL(file);
  }

  async save() {
    if (this._saving()) return;
    this._saving.set(true);
    this._nameError.set(null);
    this._logoError.set(null);
    try {
      const br = this._branding();
      // Persist through the dedicated tenant update endpoint so the navbar
      // picks the change up via the TenantStateService cache + cross-tab
      // BroadcastChannel.
      const updated = await firstValueFrom(this.api.patch<Tenant>('/api/tenants/current', {
        brandingName: br.brandingName || null,
        brandingMode: br.brandingMode,
        logoUrl: br.logoUrl || ''
      }));
      this.tenantState.update(updated);
      this.toasts.success('Branding saved.');
    } catch (e: unknown) {
      const err = ApiError.from(e);
      if (err.field === 'brandingName') this._nameError.set(err.message);
      else if (err.field === 'logoUrl') this._logoError.set(err.message);
      else this.toasts.error(err.message);
    } finally {
      this._saving.set(false);
    }
  }
}
