import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { BarcodeDisplayComponent } from '../../../shared/components/barcode-display/barcode-display.component';
import { Branch, Department, Tenant } from '../../../shared/models/tenant.model';

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
  imports: [FormsModule, BarcodeDisplayComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-8 max-w-5xl mx-auto">
      <header class="mb-6">
        <h1 class="text-2xl font-semibold">Set up your lab</h1>
        <p class="text-sm text-slate-600">Three short steps. You can edit everything later.</p>
      </header>

      <ol class="flex items-center gap-3 mb-8">
        @for (label of stepLabels; track $index) {
          <li class="flex items-center gap-2">
            <span class="h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold"
                  [class.bg-[var(--color-primary)]]="$index <= step()"
                  [class.text-white]="$index <= step()"
                  [class.bg-slate-200]="$index > step()"
                  [class.text-slate-500]="$index > step()">{{ $index + 1 }}</span>
            <span class="text-sm"
                  [class.font-semibold]="$index === step()"
                  [class.text-slate-500]="$index !== step()">{{ label }}</span>
            @if ($index < stepLabels.length - 1) {
              <span class="w-10 h-px bg-slate-300 mx-1"></span>
            }
          </li>
        }
      </ol>

      @if (step() === 0) {
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div class="md:col-span-2 pf-card space-y-4">
            <h2 class="text-base font-semibold">Organization details</h2>
            <div>
              <label class="pf-label">Organization name</label>
              <input type="text" class="pf-input"
                     [ngModel]="org().name" (ngModelChange)="updateOrg({ name: $event })"
                     placeholder="Apollo Diagnostics" />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="pf-label">Type</label>
                <select class="pf-input" [ngModel]="org().type" (ngModelChange)="updateOrg({ type: $event })">
                  <option value="independent">Independent lab</option>
                  <option value="chain">Chain</option>
                  <option value="hospital">Hospital</option>
                  <option value="diagnostic_center">Diagnostic center</option>
                </select>
              </div>
              <div>
                <label class="pf-label">Vendor code <span class="text-slate-400 font-normal">(2–4 chars)</span></label>
                <input type="text" class="pf-input uppercase" maxlength="4"
                       [ngModel]="org().vendorCode" (ngModelChange)="updateVendorCode($event)" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="pf-label">GST number <span class="text-slate-400 font-normal">(optional)</span></label>
                <input type="text" class="pf-input"
                       [ngModel]="org().gstNumber" (ngModelChange)="updateOrg({ gstNumber: $event })" />
              </div>
              <div>
                <label class="pf-label">Logo URL <span class="text-slate-400 font-normal">(optional)</span></label>
                <input type="text" class="pf-input"
                       [ngModel]="org().logoUrl" (ngModelChange)="updateOrg({ logoUrl: $event })" />
              </div>
            </div>
          </div>
          <div class="pf-card">
            <h3 class="text-sm font-semibold mb-2">Barcode preview</h3>
            <p class="text-xs text-slate-500 mb-3">Format <code class="bg-slate-100 px-1 rounded">PF-{{ org().vendorCode || '??' }}-YYYY-#####-DEPT</code></p>
            <pf-barcode-display [code]="barcodePreview()"></pf-barcode-display>
          </div>
        </div>
      }

      @if (step() === 1) {
        <div class="pf-card">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-base font-semibold">Branches</h2>
            <button class="pf-btn pf-btn-ghost" (click)="addBranch()">+ Add branch</button>
          </div>
          @if (branches().length === 0) {
            <p class="text-sm text-slate-500">Add at least one branch to continue.</p>
          }
          <div class="space-y-3">
            @for (b of branches(); let i = $index; track i) {
              <div class="grid grid-cols-12 gap-2 items-end border-b border-slate-100 pb-3">
                <div class="col-span-3">
                  <label class="pf-label">Name</label>
                  <input type="text" class="pf-input" [ngModel]="b.name"
                         (ngModelChange)="updateBranch(i, { name: $event })" />
                </div>
                <div class="col-span-2">
                  <label class="pf-label">Code</label>
                  <input type="text" class="pf-input uppercase" [ngModel]="b.code"
                         (ngModelChange)="updateBranch(i, { code: $event.toUpperCase() })" />
                </div>
                <div class="col-span-2">
                  <label class="pf-label">City</label>
                  <input type="text" class="pf-input" [ngModel]="b.city"
                         (ngModelChange)="updateBranch(i, { city: $event })" />
                </div>
                <div class="col-span-2">
                  <label class="pf-label">State</label>
                  <input type="text" class="pf-input" [ngModel]="b.state"
                         (ngModelChange)="updateBranch(i, { state: $event })" />
                </div>
                <div class="col-span-2">
                  <label class="pf-label">Pincode</label>
                  <input type="text" class="pf-input" [ngModel]="b.pincode"
                         (ngModelChange)="updateBranch(i, { pincode: $event })" />
                </div>
                <div class="col-span-1 pb-2 text-right">
                  <button class="text-slate-400 hover:text-red-500" (click)="removeBranch(i)">✕</button>
                </div>
                <div class="col-span-12">
                  <label class="inline-flex items-center gap-2 text-xs">
                    <input type="checkbox" [ngModel]="b.hasPfBox"
                           (ngModelChange)="updateBranch(i, { hasPfBox: $event })" />
                    <span>On-premise PF Box</span>
                  </label>
                </div>
              </div>
            }
          </div>
        </div>
      }

      @if (step() === 2) {
        <div class="pf-card">
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-base font-semibold">Departments</h2>
            <button class="pf-btn pf-btn-ghost" (click)="addDepartment()">+ Add department</button>
          </div>
          <p class="text-xs text-slate-500 mb-3">Quick add:</p>
          <div class="flex flex-wrap gap-2 mb-4">
            @for (q of quickDepts; track q.code) {
              <button type="button"
                      class="rounded-full border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50"
                      (click)="addQuickDept(q)">+ {{ q.name }}</button>
            }
          </div>
          <div class="space-y-2">
            @for (d of departments(); let i = $index; track i) {
              <div class="grid grid-cols-12 gap-2">
                <div class="col-span-6"><input type="text" class="pf-input" [ngModel]="d.name"
                                               (ngModelChange)="updateDept(i, { name: $event })" placeholder="Department name" /></div>
                <div class="col-span-5"><input type="text" class="pf-input uppercase" [ngModel]="d.code"
                                               (ngModelChange)="updateDept(i, { code: $event.toUpperCase() })" placeholder="CODE" /></div>
                <div class="col-span-1 text-right pt-2">
                  <button class="text-slate-400 hover:text-red-500" (click)="removeDept(i)">✕</button>
                </div>
              </div>
            }
            @if (departments().length === 0) {
              <p class="text-sm text-slate-500">Add at least one department to continue.</p>
            }
          </div>
        </div>
      }

      <div class="mt-6 flex items-center justify-between">
        <button class="pf-btn pf-btn-ghost"
                [disabled]="step() === 0 || saving()"
                (click)="back()">← Back</button>
        @if (step() < stepLabels.length - 1) {
          <button class="pf-btn pf-btn-primary" [disabled]="!canAdvance()" (click)="forward()">Next →</button>
        } @else {
          <button class="pf-btn pf-btn-primary" [disabled]="!canAdvance() || saving()" (click)="finish()">
            {{ saving() ? 'Saving…' : 'Finish setup' }}
          </button>
        }
      </div>
    </section>
  `
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
    const year = new Date().getFullYear();
    return `PF-${vc.toUpperCase()}-${year}-00001-HAEM`;
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

import { firstValueFrom, Observable } from 'rxjs';
function firstValueOfApi<T>(source: Observable<T>): Promise<T> {
  return firstValueFrom(source);
}
