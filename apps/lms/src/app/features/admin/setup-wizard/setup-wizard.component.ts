import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom, Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ToastService } from '../../../core/services/toast.service';
import { BarcodeDisplayComponent } from '../../../shared/components/barcode-display/barcode-display.component';
import {
  cityOptionsForState,
  OTHER_CITY_VALUE,
  stateOptions
} from '../../../shared/data/india-locations';
import { Branch, Department, SubBranch, Tenant, TenantBrandingMode } from '../../../shared/models/tenant.model';
import { ChipComponent } from '../../../shared/primitives/chip.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { ToggleComponent } from '../../../shared/primitives/toggle.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

const BRANDING_LOGO_MAX_BYTES = 100 * 1024;
const BRANDING_NAME_MAX = 10;

interface BrandingDraft {
  logoUrl: string;          // base64 data URL or '' for none
  brandingName: string;     // ≤10 chars
  brandingMode: TenantBrandingMode;
}

interface OrgDraft {
  name: string;
  type: string;
  vendorCode: string;
  gstNumber: string;
}

interface SubBranchDraft {
  name: string;
  code: string;
  type: string;
}

interface BranchDraft {
  name: string;
  code: string;
  type: string;
  city: string;
  state: string;
  pincode: string;
  hasPfBox: boolean;
  subBranches: SubBranchDraft[];
}

interface DepartmentDraft {
  name: string;
  code: string;
  branchId?: string;
}

@Component({
  selector: 'pf-setup-wizard',
  standalone: true,
  imports: [
    FormsModule,
    BarcodeDisplayComponent,
    ChipComponent,
    ScreenHeaderComponent,
    SegmentedComponent,
    SelectComponent,
    TileComponent,
    ToggleComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10">

      <pf-screen-header
        eyebrow="First-time setup"
        title="Set up your lab"
        subtitle="Three short steps. You can edit everything later.">
      </pf-screen-header>

      <!-- Stepper -->
      <ol class="stepper" role="list">
        @for (label of stepLabels; track $index) {
          <li class="step" [class.step-active]="$index === step()" [class.step-done]="$index < step()">
            <span class="step-dot">
              @if ($index < step()) {
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                  <path d="m5 12 4 4L19 6"/>
                </svg>
              } @else {
                {{ $index + 1 }}
              }
            </span>
            <span class="step-label">{{ label }}</span>
            @if ($index < stepLabels.length - 1) {
              <span class="step-connector" [class.step-connector-filled]="$index < step()"></span>
            }
          </li>
        }
      </ol>

      <!-- Step 0: Organization -->
      @if (step() === 0) {
        <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
          <pf-tile tone="default" padding="lg" class="md:col-span-2 block">
            <h2 class="section-title">Organization details</h2>

            <div class="space-y-4 mt-4">
              <div>
                <label class="pf-label">Organization name</label>
                <input type="text" class="pf-input"
                       [ngModel]="org().name"
                       (ngModelChange)="updateOrg({ name: $event })"
                       placeholder="Apollo Diagnostics" />
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="pf-label">Type</label>
                  <pf-select
                    [options]="typeOptions"
                    [value]="org().type"
                    (valueChange)="updateOrg({ type: $event })">
                  </pf-select>
                </div>
                <div>
                  <label class="pf-label">Vendor code
                    <span class="text-[11px] font-normal" style="color: var(--text-muted);">(2–4 chars)</span>
                  </label>
                  <input type="text" class="pf-input uppercase" maxlength="4"
                         [ngModel]="org().vendorCode" (ngModelChange)="updateVendorCode($event)"
                         placeholder="AP" />
                </div>
              </div>
              <div>
                <label class="pf-label">GST number
                  <span class="text-[11px] font-normal" style="color: var(--text-muted);">(optional)</span>
                </label>
                <input type="text" class="pf-input"
                       [ngModel]="org().gstNumber" (ngModelChange)="updateOrg({ gstNumber: $event })" />
              </div>
            </div>
          </pf-tile>

          <pf-tile tone="violet" padding="lg" class="block">
            <h3 class="section-title">Barcode preview</h3>
            <p class="text-[11.5px] font-mono mt-2"
               style="color: var(--text-tertiary);">
              PF-{{ org().vendorCode || '??' }}-{{ year }}-#####-DEPT
            </p>
            <div class="mt-4">
              <pf-barcode-display [code]="barcodePreview()"></pf-barcode-display>
            </div>
          </pf-tile>
        </div>
      }

      <!-- Step 1: Branding (logo + short name + mode, all optional) -->
      @if (step() === 1) {
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <pf-tile tone="default" padding="lg" class="lg:col-span-2 block">
            <h2 class="section-title">Top-navigation branding</h2>
            <p class="text-[12px] mt-1" style="color: var(--text-tertiary);">
              What appears in the header pill next to your user avatar. All three fields are optional —
              you can skip this and add them later.
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
      }

      <!-- Step 2: Branches -->
      @if (step() === 2) {
        <pf-tile tone="default" padding="lg" class="block">
          <div class="flex items-center justify-between mb-3">
            <h2 class="section-title">Branches</h2>
            <pf-touch-btn size="sm" variant="ghost" (pressed)="addBranch()">
              <span icon-left aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 5v14"/>
                  <path d="M5 12h14"/>
                </svg>
              </span>
              Add branch
            </pf-touch-btn>
          </div>

          @if (branches().length === 0) {
            <p class="text-[13px]" style="color: var(--text-tertiary);">
              Add at least one branch to continue.
            </p>
          } @else {
            <div class="space-y-3">
              @for (b of branches(); let i = $index; track i) {
                <div class="branch-row">
                  <div class="grid grid-cols-12 gap-2">
                    <div class="col-span-12 md:col-span-3">
                      <label class="pf-label">Name</label>
                      <input type="text" class="pf-input" [ngModel]="b.name"
                             (ngModelChange)="updateBranch(i, { name: $event })"
                             placeholder="Chennai Main" />
                    </div>
                    <div class="col-span-6 md:col-span-2">
                      <label class="pf-label">Code</label>
                      <input type="text" class="pf-input uppercase" [ngModel]="b.code"
                             (ngModelChange)="updateBranch(i, { code: $event.toUpperCase() })"
                             placeholder="MAIN" />
                    </div>
                    <!-- State first so City can filter to its cities. -->
                    <div class="col-span-6 md:col-span-2">
                      <label class="pf-label">State</label>
                      <pf-select size="md"
                                 [options]="stateSelectOptions"
                                 [value]="b.state"
                                 placeholder="Select state…"
                                 (valueChange)="onBranchStateChange(i, $event)">
                      </pf-select>
                    </div>
                    <div class="col-span-6 md:col-span-2">
                      <label class="pf-label">City</label>
                      @if (b.state) {
                        <pf-select size="md"
                                   [options]="cityOptionsFor(b.state, b.city)"
                                   [value]="cityValueFor(b.city, b.state)"
                                   placeholder="Select city…"
                                   (valueChange)="onBranchCityChange(i, $event)">
                        </pf-select>
                        @if (isCityCustom(b.city, b.state)) {
                          <input type="text" class="pf-input mt-1.5" placeholder="Type city name"
                                 [ngModel]="b.city"
                                 (ngModelChange)="updateBranch(i, { city: $event })" />
                        }
                      } @else {
                        <input type="text" class="pf-input" disabled
                               placeholder="Pick a state first" />
                      }
                    </div>
                    <div class="col-span-4 md:col-span-2">
                      <label class="pf-label">Pincode</label>
                      <input type="text" class="pf-input" inputmode="numeric"
                             maxlength="6" [ngModel]="b.pincode"
                             (ngModelChange)="updateBranch(i, { pincode: $event.replace(/\D/g, '').slice(0, 6) })"
                             placeholder="6 digits" />
                    </div>
                    <div class="col-span-4 md:col-span-1 flex items-end justify-end">
                      <button type="button" class="row-remove"
                              [disabled]="branches().length <= 1"
                              (click)="removeBranch(i)" aria-label="Remove branch">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M18 6 6 18"/>
                          <path d="m6 6 12 12"/>
                        </svg>
                      </button>
                    </div>
                  </div>

                  <div class="mt-3 flex items-center gap-2">
                    <pf-toggle size="sm"
                               [checked]="b.hasPfBox"
                               (checkedChange)="updateBranch(i, { hasPfBox: $event })">
                    </pf-toggle>
                    <span class="text-[13px]" style="color: var(--text-secondary);">
                      On-premise PF Box
                    </span>
                    
                  </div>

                  <!-- Sub-branches under this branch -->
                  <div class="sub-branches-section">
                    @if (b.subBranches.length > 0) {
                      <p class="text-[11px] font-mono uppercase tracking-[0.16em] mb-2"
                         style="color: var(--text-muted);">Sub-branches</p>
                      <div class="space-y-1.5 mb-2">
                        @for (sb of b.subBranches; let sbi = $index; track sbi) {
                          <div class="sub-branch-row">
                            <div class="sub-branch-name">
                              <input type="text" class="pf-input" placeholder="Sub-branch name"
                                     [ngModel]="sb.name"
                                     (ngModelChange)="updateSubBranch(i, sbi, { name: $event })" />
                            </div>
                            <div class="sub-branch-code">
                              <input type="text" class="pf-input uppercase" placeholder="CODE"
                                     [ngModel]="sb.code"
                                     (ngModelChange)="updateSubBranch(i, sbi, { code: $event.toUpperCase() })" />
                            </div>
                            <div class="sub-branch-type">
                              <pf-select
                                [options]="subBranchTypeOpts"
                                [value]="sb.type"
                                (valueChange)="updateSubBranch(i, sbi, { type: $any($event) })">
                              </pf-select>
                            </div>
                            <button type="button" class="row-remove"
                                    (click)="removeSubBranch(i, sbi)" aria-label="Remove sub-branch">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M18 6 6 18"/>
                                <path d="m6 6 12 12"/>
                              </svg>
                            </button>
                          </div>
                        }
                      </div>
                    }
                    <button type="button" class="add-sub-link" (click)="addSubBranch(i)">
                      + Add sub-branch
                    </button>
                  </div>
                </div>
              }
            </div>
          }
        </pf-tile>
      }

      <!-- Step 3: Departments -->
      @if (step() === 3) {
        <pf-tile tone="default" padding="lg" class="block">
          <div class="flex items-center justify-between mb-3">
            <h2 class="section-title">Departments</h2>
            <pf-touch-btn size="sm" variant="ghost" (pressed)="addDepartment()">
              <span icon-left aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 5v14"/>
                  <path d="M5 12h14"/>
                </svg>
              </span>
              Add department
            </pf-touch-btn>
          </div>

          <p class="text-[11px] font-mono uppercase tracking-[0.16em] mb-2"
             style="color: var(--text-muted);">Quick add</p>
          <div class="flex flex-wrap gap-2 mb-5">
            @for (q of quickDepts; track q.code) {
              <pf-chip tone="violet" size="sm" (tapped)="addQuickDept(q)">+ {{ q.name }}</pf-chip>
            }
          </div>

          @if (departments().length === 0) {
            <p class="text-[13px]" style="color: var(--text-tertiary);">
              Add at least one department to continue.
            </p>
          } @else {
            <div class="space-y-2">
              @for (d of departments(); let i = $index; track i) {
                <div class="grid grid-cols-12 gap-2"
                     [class.dept-row-dup]="duplicateDeptIndices().has(i)">
                  <div class="col-span-7 md:col-span-7">
                    <input type="text" class="pf-input" [ngModel]="d.name"
                           (ngModelChange)="updateDept(i, { name: $event })"
                           placeholder="Department name" />
                  </div>
                  <div class="col-span-4 md:col-span-4">
                    <input type="text" class="pf-input uppercase" [ngModel]="d.code"
                           (ngModelChange)="updateDept(i, { code: $event.toUpperCase() })"
                           placeholder="CODE" />
                  </div>
                  <div class="col-span-1 flex items-center justify-end">
                    <button type="button" class="row-remove"
                            (click)="removeDept(i)" aria-label="Remove">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 6 6 18"/>
                        <path d="m6 6 12 12"/>
                      </svg>
                    </button>
                  </div>
                  @if (duplicateDeptIndices().has(i)) {
                    <p class="col-span-12 text-[11.5px] mt-0.5 ml-1" style="color: #f87171;">
                      Duplicate name or code — each department must be unique.
                    </p>
                  }
                </div>
              }
            </div>
          }
        </pf-tile>
      }

      <!-- Navigation -->
      <div class="mt-6 flex items-center justify-between">
        <pf-touch-btn size="md" variant="ghost"
                       [disabled]="step() === 0 || saving()"
                       (pressed)="back()">
          <span icon-left aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
          </span>
          Back
        </pf-touch-btn>

        @if (step() < stepLabels.length - 1) {
          <pf-touch-btn size="md" variant="primary"
                         [disabled]="!canAdvance()"
                         (pressed)="forward()">
            Next
            <span icon-right aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m9 18 6-6-6-6"/>
              </svg>
            </span>
          </pf-touch-btn>
        } @else {
          <pf-touch-btn size="md" variant="primary"
                         [disabled]="!canAdvance() || saving()"
                         (pressed)="finish()">
            {{ saving() ? 'Saving…' : 'Finish setup' }}
          </pf-touch-btn>
        }
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

    /* ── Stepper ─────────────────────────────────────────── */
    .stepper {
      list-style: none;
      margin: 0 0 28px;
      padding: 0;
      display: flex;
      align-items: center;
      gap: 0;
      overflow-x: auto;
    }
    .step {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .step-dot {
      width: 28px;
      height: 28px;
      border-radius: 9999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 12.5px;
      font-weight: 600;
      background: var(--glass-bg);
      color: var(--text-muted);
      border: 1px solid var(--glass-border);
      transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
    }
    .step-active .step-dot {
      background: var(--gradient-primary);
      color: #ffffff;
      border-color: transparent;
      box-shadow: 0 4px 14px rgba(124, 58, 237, 0.35);
    }
    .step-done .step-dot {
      background: rgba(16, 185, 129, 0.2);
      color: #6ee7b7;
      border-color: rgba(16, 185, 129, 0.4);
    }
    .step-label {
      font-size: 13px;
      color: var(--text-secondary);
      white-space: nowrap;
    }
    .step-active .step-label {
      color: var(--text-primary);
      font-weight: 600;
    }
    .step-connector {
      width: 48px;
      height: 1px;
      margin: 0 8px;
      background: var(--border-muted);
      flex-shrink: 0;
    }
    .step-connector-filled {
      background: linear-gradient(90deg, rgba(16, 185, 129, 0.6), rgba(168, 85, 247, 0.5));
    }

    /* ── Branch row card ─────────────────────────────────── */
    .branch-row {
      padding: 14px;
      border-radius: 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
    }

    .row-remove {
      width: 34px;
      height: 34px;
      border-radius: 9999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      color: var(--text-muted);
      border: 1px solid transparent;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    }
    .row-remove:hover:not(:disabled) {
      background: rgba(239, 68, 68, 0.15);
      color: #fca5a5;
      border-color: rgba(239, 68, 68, 0.3);
    }
    .row-remove:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }

    .sub-branches-section {
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px dashed var(--border-muted);
    }
    .sub-branch-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .sub-branch-name {
      flex: 0 0 50%;
      min-width: 0;
    }
    .sub-branch-name .pf-input {
      width: 100%;
    }
    .sub-branch-code {
      flex: 1 1 0%;
      min-width: 0;
    }
    .sub-branch-type {
      flex: 1 1 0%;
      min-width: 0;
    }
    .add-sub-link {
      background: none;
      border: none;
      color: #ec4899;
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      padding: 4px 0;
    }
    .add-sub-link:hover { text-decoration: underline; }

    /* Duplicate department row — soft red ring on the inputs so the user
     * sees which row to fix instead of just a disabled Next button. */
    .dept-row-dup .pf-input {
      border-color: rgba(239, 68, 68, 0.55);
      background: rgba(239, 68, 68, 0.04);
    }

    /* ── Branding step ─────────────────────────────────────── */
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
      color: #c4b5fd;
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
      color: #fca5a5;
      border-color: rgba(239, 68, 68, 0.4);
      background: rgba(239, 68, 68, 0.08);
    }
    .brand-upload__btn--danger:hover { background: rgba(239, 68, 68, 0.16); }

    .brand-error {
      font-size: 12px;
      color: #f87171;
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
  `]
})
export class SetupWizardComponent {
  private readonly api = inject(ApiService);
  private readonly tenantState = inject(TenantStateService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

  @ViewChild('logoInput') logoInput?: ElementRef<HTMLInputElement>;

  readonly stepLabels = ['Organization', 'Branding', 'Branches', 'Departments'];
  readonly brandingModeOptions: SegmentedOption<TenantBrandingMode>[] = [
    { value: 'both', label: 'Both' },
    { value: 'logo', label: 'Logo only' },
    { value: 'name', label: 'Name only' }
  ];
  readonly nameMax = BRANDING_NAME_MAX;
  readonly quickDepts = [
    { name: 'Haematology',   code: 'HAEM' },
    { name: 'Biochemistry',  code: 'BIO' },
    { name: 'Microbiology',  code: 'MICRO' },
    { name: 'Serology',      code: 'SERO' },
    { name: 'Histopathology',code: 'HISTO' }
  ];
  readonly typeOptions: PfSelectOption<string>[] = [
    { value: 'independent',       label: 'Independent lab' },
    { value: 'chain',             label: 'Chain' },
    { value: 'hospital',          label: 'Hospital' },
    { value: 'diagnostic_center', label: 'Diagnostic center' }
  ];
  readonly subBranchTypeOpts: PfSelectOption<string>[] = [
    { value: 'lab',               label: 'Lab' },
    { value: 'collection-center', label: 'Collection' },
    { value: 'satellite',         label: 'Satellite' }
  ];
  // India address dropdowns — see shared/data/india-locations.ts
  readonly stateSelectOptions: PfSelectOption<string>[] = stateOptions();
  cityOptionsFor(state: string, currentCity: string): PfSelectOption<string>[] {
    const opts = cityOptionsForState(state);
    // If the saved city isn't in the canonical list, surface it as a value
    // so the select reflects the existing data instead of going blank.
    if (currentCity && !opts.some(o => o.value === currentCity) && currentCity !== OTHER_CITY_VALUE) {
      return [{ value: currentCity, label: currentCity }, ...opts];
    }
    return opts;
  }
  cityValueFor(currentCity: string, state: string): string {
    if (!currentCity) return '';
    const known = cityOptionsForState(state).some(o => o.value === currentCity);
    return known ? currentCity : OTHER_CITY_VALUE;
  }
  isCityCustom(currentCity: string, state: string): boolean {
    if (!currentCity) return false;
    const known = cityOptionsForState(state).some(o => o.value === currentCity);
    return !known;
  }
  onBranchStateChange(i: number, state: string) {
    // Switching state invalidates the city if it doesn't belong to the new state.
    const current = this._branches()[i];
    const stillValid = cityOptionsForState(state).some(o => o.value === current.city);
    this.updateBranch(i, { state, city: stillValid ? current.city : '' });
  }
  onBranchCityChange(i: number, value: string) {
    if (value === OTHER_CITY_VALUE) {
      // Clear the city; the inline text input shows up so the user types one.
      this.updateBranch(i, { city: '' });
    } else {
      this.updateBranch(i, { city: value });
    }
  }

  readonly year = new Date().getFullYear();

  private readonly _step = signal(0);
  private readonly _org = signal<OrgDraft>({ name: '', type: 'independent', vendorCode: '', gstNumber: '' });
  private readonly _branding = signal<BrandingDraft>({ logoUrl: '', brandingName: '', brandingMode: 'both' });
  private readonly _draggingLogo = signal(false);
  private readonly _logoError = signal<string | null>(null);
  private readonly _branches = signal<BranchDraft[]>([{ name: '', code: '', type: 'lab', city: '', state: '', pincode: '', hasPfBox: false, subBranches: [] }]);
  private readonly _departments = signal<DepartmentDraft[]>([]);
  private readonly _saving = signal(false);

  readonly step = this._step.asReadonly();
  readonly org = this._org.asReadonly();
  readonly branding = this._branding.asReadonly();
  readonly draggingLogo = this._draggingLogo.asReadonly();
  readonly logoError = this._logoError.asReadonly();
  readonly branches = this._branches.asReadonly();
  readonly departments = this._departments.asReadonly();
  readonly saving = this._saving.asReadonly();

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

  readonly barcodePreview = computed(() => {
    const vc = this._org().vendorCode || '??';
    return `PF-${vc.toUpperCase()}-${this.year}-00001-HAEM`;
  });

  readonly canAdvance = computed(() => {
    const s = this._step();
    if (s === 0) {
      const o = this._org();
      return o.name.trim().length > 0 && o.vendorCode.trim().length >= 2;
    }
    // Step 1 (Branding) is entirely optional — admins can skip straight through
    // and come back to branding later.
    if (s === 1) return true;
    if (s === 2) {
      const branches = this._branches();
      if (branches.length === 0) return false;
      return branches.every(b =>
        b.name.trim() && b.code.trim() &&
        // Sub-branch rows that are completely empty are ignored; if the user
        // typed anything (name OR code), both must be filled before advancing.
        b.subBranches.every(sb => {
          const touched = sb.name.trim() || sb.code.trim();
          if (!touched) return true;
          return sb.name.trim() && sb.code.trim();
        })
      );
    }
    if (s === 3) {
      const depts = this._departments();
      if (depts.length === 0) return false;
      if (!depts.every(d => d.name.trim() && d.code.trim())) return false;
      // Block on duplicate name or code (case-insensitive).
      const names = new Set<string>();
      const codes = new Set<string>();
      for (const d of depts) {
        const n = d.name.trim().toLowerCase();
        const c = d.code.trim().toUpperCase();
        if (names.has(n) || codes.has(c)) return false;
        names.add(n); codes.add(c);
      }
      return true;
    }
    return false;
  });

  // Per-row duplicate flags so the UI can highlight offending rows
  // and the user can see *why* Next is disabled.
  readonly duplicateDeptIndices = computed(() => {
    const depts = this._departments();
    const dupSet = new Set<number>();
    for (let i = 0; i < depts.length; i++) {
      const ni = depts[i].name.trim().toLowerCase();
      const ci = depts[i].code.trim().toUpperCase();
      if (!ni && !ci) continue;
      for (let j = 0; j < depts.length; j++) {
        if (i === j) continue;
        const nj = depts[j].name.trim().toLowerCase();
        const cj = depts[j].code.trim().toUpperCase();
        if ((ni && ni === nj) || (ci && ci === cj)) {
          dupSet.add(i);
          break;
        }
      }
    }
    return dupSet;
  });

  updateOrg(patch: Partial<OrgDraft>) { this._org.update(o => ({ ...o, ...patch })); }
  updateVendorCode(v: string) { this.updateOrg({ vendorCode: (v ?? '').toUpperCase().slice(0, 4) }); }

  // ── Branding (step 1) ──────────────────────────────
  updateBranding(patch: Partial<BrandingDraft>) {
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

  addBranch() {
    this._branches.update(list => [...list, { name: '', code: '', type: 'lab', city: '', state: '', pincode: '', hasPfBox: false, subBranches: [] }]);
  }
  updateBranch(i: number, patch: Partial<BranchDraft>) {
    this._branches.update(list => list.map((b, idx) => idx === i ? { ...b, ...patch } : b));
  }
  removeBranch(i: number) {
    if (this._branches().length <= 1) return;
    this._branches.update(list => list.filter((_, idx) => idx !== i));
  }

  addSubBranch(branchIndex: number) {
    this._branches.update(list => list.map((b, idx) =>
      idx === branchIndex
        ? { ...b, subBranches: [...b.subBranches, { name: '', code: '', type: 'lab' }] }
        : b
    ));
  }
  updateSubBranch(branchIndex: number, subIndex: number, patch: Partial<SubBranchDraft>) {
    this._branches.update(list => list.map((b, idx) =>
      idx === branchIndex
        ? { ...b, subBranches: b.subBranches.map((sb, si) => si === subIndex ? { ...sb, ...patch } : sb) }
        : b
    ));
  }
  removeSubBranch(branchIndex: number, subIndex: number) {
    this._branches.update(list => list.map((b, idx) =>
      idx === branchIndex
        ? { ...b, subBranches: b.subBranches.filter((_, si) => si !== subIndex) }
        : b
    ));
  }

  addDepartment() {
    this._departments.update(list => [...list, { name: '', code: '' }]);
  }
  addQuickDept(q: { name: string; code: string }) {
    if (this._departments().some(d => d.code.toUpperCase() === q.code)) return;
    this._departments.update(list => [...list, { name: q.name, code: q.code }]);
  }
  updateDept(i: number, patch: Partial<DepartmentDraft>) {
    this._departments.update(list => list.map((d, idx) => idx === i ? { ...d, ...patch } : d));
  }
  removeDept(i: number) {
    this._departments.update(list => list.filter((_, idx) => idx !== i));
  }

  back() {
    if (this._step() > 0) this._step.update(s => s - 1);
  }
  forward() {
    if (this.canAdvance()) this._step.update(s => s + 1);
  }

  async finish() {
    if (!this.canAdvance() || this._saving()) return;
    this._saving.set(true);
    try {
      const o = this._org();
      const br = this._branding();
      await firstValueOfApi(this.api.post<Tenant>('/api/tenants/setup', {
        name: o.name, type: o.type, vendorCode: o.vendorCode,
        gstNumber: o.gstNumber || undefined,
        logoUrl: br.logoUrl || undefined
      }));

      // Apply branding fields via the dedicated tenant update endpoint so
      // the navbar picks them up through the TenantStateService cache +
      // cross-tab BroadcastChannel.
      if (br.brandingName || br.brandingMode !== 'both' || br.logoUrl) {
        const updated = await firstValueOfApi(this.api.patch<Tenant>('/api/tenants/current', {
          brandingName: br.brandingName || null,
          brandingMode: br.brandingMode,
          logoUrl: br.logoUrl || ''
        }));
        this.tenantState.update(updated);
      }

      const createdBranches: Branch[] = [];
      for (const b of this._branches()) {
        const { subBranches, ...branchBody } = b;
        const saved = await firstValueOfApi(this.api.post<Branch>('/api/tenants/branches', branchBody));
        createdBranches.push(saved);
        for (const sb of subBranches) {
          if (!sb.name.trim() || !sb.code.trim()) continue;
          await firstValueOfApi(this.api.post<SubBranch>(
            `/api/tenants/branches/${saved.id}/sub-branches`,
            { name: sb.name, code: sb.code, type: sb.type }
          ));
        }
      }

      for (const d of this._departments()) {
        await firstValueOfApi(this.api.post<Department>('/api/tenants/departments', {
          name: d.name, code: d.code,
          branchId: createdBranches[0]?.id
        }));
      }

      this.toasts.success('Setup complete!');
      this.router.navigateByUrl('/admin');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Setup failed';
      this.toasts.error(msg);
    } finally {
      this._saving.set(false);
    }
  }
}

function firstValueOfApi<T>(source: Observable<T>): Promise<T> {
  return firstValueFrom(source);
}
