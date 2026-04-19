import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom, Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { BarcodeDisplayComponent } from '../../../shared/components/barcode-display/barcode-display.component';
import { Branch, Department, Tenant } from '../../../shared/models/tenant.model';
import { ChipComponent } from '../../../shared/primitives/chip.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { ToggleComponent } from '../../../shared/primitives/toggle.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

interface OrgDraft {
  name: string;
  type: string;
  vendorCode: string;
  gstNumber: string;
  logoUrl: string;
}

interface BranchDraft {
  name: string;
  code: string;
  type: string;
  city: string;
  state: string;
  pincode: string;
  hasPfBox: boolean;
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
    SelectComponent,
    TileComponent,
    ToggleComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10 max-w-5xl mx-auto">

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
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="pf-label">GST number
                    <span class="text-[11px] font-normal" style="color: var(--text-muted);">(optional)</span>
                  </label>
                  <input type="text" class="pf-input"
                         [ngModel]="org().gstNumber" (ngModelChange)="updateOrg({ gstNumber: $event })" />
                </div>
                <div>
                  <label class="pf-label">Logo URL
                    <span class="text-[11px] font-normal" style="color: var(--text-muted);">(optional)</span>
                  </label>
                  <input type="text" class="pf-input"
                         [ngModel]="org().logoUrl" (ngModelChange)="updateOrg({ logoUrl: $event })" />
                </div>
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

      <!-- Step 1: Branches -->
      @if (step() === 1) {
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
                    <div class="col-span-6 md:col-span-2">
                      <label class="pf-label">City</label>
                      <input type="text" class="pf-input" [ngModel]="b.city"
                             (ngModelChange)="updateBranch(i, { city: $event })" />
                    </div>
                    <div class="col-span-4 md:col-span-2">
                      <label class="pf-label">State</label>
                      <input type="text" class="pf-input" [ngModel]="b.state"
                             (ngModelChange)="updateBranch(i, { state: $event })" />
                    </div>
                    <div class="col-span-4 md:col-span-2">
                      <label class="pf-label">Pincode</label>
                      <input type="text" class="pf-input" [ngModel]="b.pincode"
                             (ngModelChange)="updateBranch(i, { pincode: $event })" />
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

                  <div class="mt-3 flex items-center justify-between">
                    <span class="text-[13px]" style="color: var(--text-secondary);">
                      On-premise PF Box
                    </span>
                    <pf-toggle size="sm"
                               [checked]="b.hasPfBox"
                               (checkedChange)="updateBranch(i, { hasPfBox: $event })">
                    </pf-toggle>
                  </div>
                </div>
              }
            </div>
          }
        </pf-tile>
      }

      <!-- Step 2: Departments -->
      @if (step() === 2) {
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
                <div class="grid grid-cols-12 gap-2">
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
  `]
})
export class SetupWizardComponent {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

  readonly stepLabels = ['Organization', 'Branches', 'Departments'];
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

  readonly year = new Date().getFullYear();

  private readonly _step = signal(0);
  private readonly _org = signal<OrgDraft>({ name: '', type: 'independent', vendorCode: '', gstNumber: '', logoUrl: '' });
  private readonly _branches = signal<BranchDraft[]>([{ name: '', code: '', type: 'lab', city: '', state: '', pincode: '', hasPfBox: false }]);
  private readonly _departments = signal<DepartmentDraft[]>([]);
  private readonly _saving = signal(false);

  readonly step = this._step.asReadonly();
  readonly org = this._org.asReadonly();
  readonly branches = this._branches.asReadonly();
  readonly departments = this._departments.asReadonly();
  readonly saving = this._saving.asReadonly();

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
    if (s === 1) {
      return this._branches().every(b => b.name.trim() && b.code.trim()) && this._branches().length > 0;
    }
    if (s === 2) {
      return this._departments().every(d => d.name.trim() && d.code.trim()) && this._departments().length > 0;
    }
    return false;
  });

  updateOrg(patch: Partial<OrgDraft>) { this._org.update(o => ({ ...o, ...patch })); }
  updateVendorCode(v: string) { this.updateOrg({ vendorCode: (v ?? '').toUpperCase().slice(0, 4) }); }

  addBranch() {
    this._branches.update(list => [...list, { name: '', code: '', type: 'lab', city: '', state: '', pincode: '', hasPfBox: false }]);
  }
  updateBranch(i: number, patch: Partial<BranchDraft>) {
    this._branches.update(list => list.map((b, idx) => idx === i ? { ...b, ...patch } : b));
  }
  removeBranch(i: number) {
    if (this._branches().length <= 1) return;
    this._branches.update(list => list.filter((_, idx) => idx !== i));
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
      await firstValueOfApi(this.api.post<Tenant>('/api/tenants/setup', {
        name: o.name, type: o.type, vendorCode: o.vendorCode,
        gstNumber: o.gstNumber || undefined, logoUrl: o.logoUrl || undefined
      }));

      const createdBranches: Branch[] = [];
      for (const b of this._branches()) {
        const saved = await firstValueOfApi(this.api.post<Branch>('/api/tenants/branches', b));
        createdBranches.push(saved);
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
