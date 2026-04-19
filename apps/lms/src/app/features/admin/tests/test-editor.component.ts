import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { Department } from '../../../shared/models/tenant.model';
import { Test, TestParametersBlob } from '../../../shared/models/test.model';
import { NumberInputComponent } from '../../../shared/primitives/number-input.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

interface ParameterRow {
  name: string;
  title: string;
  type: string;
  unit?: string;
  options?: string[];
  referenceRanges?: { segment: string; min?: number; max?: number }[];
  criticalLow?: number;
  criticalHigh?: number;
  normalValue?: string;
}

interface DraftTest {
  id?: string;
  name: string;
  type: 'individual' | 'package';
  flow: 'direct' | 'approval';
  price: number;
  taxSlab: number;
  departmentId: string;
  tatHours: number;
  sampleType: string;
  parametersJson: string;
  conditionsJson: string;
  isActive: boolean;
}

function makeEmptyDraft(): DraftTest {
  return {
    name: '', type: 'individual', flow: 'direct',
    price: 0, taxSlab: 0,
    departmentId: '', tatHours: 24, sampleType: '',
    parametersJson: '', conditionsJson: '[]',
    isActive: true
  };
}

@Component({
  selector: 'pf-test-editor',
  standalone: true,
  imports: [
    FormsModule,
    NumberInputComponent,
    ScreenHeaderComponent,
    SelectComponent,
    TileComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10 max-w-5xl mx-auto">

      <pf-screen-header
        eyebrow="Admin · Tests"
        [title]="draft().id ? 'Edit test' : 'Create test'"
        [subtitle]="subtitle()">
        <pf-touch-btn actions size="sm" variant="ghost" (pressed)="back()">
          <span icon-left aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
          </span>
          Back
        </pf-touch-btn>
        <pf-touch-btn actions size="sm" variant="primary" [disabled]="saving()" (pressed)="saveTest()">
          {{ saving() ? 'Saving…' : 'Save' }}
        </pf-touch-btn>
      </pf-screen-header>

      @let d = draft();

      <!-- General -->
      <pf-tile tone="default" padding="lg" class="block mb-4">
        <h3 class="section-title">General</h3>
        <div class="space-y-3 mt-4">
          <div><label class="pf-label">Name</label>
            <input type="text" class="pf-input"
                   [ngModel]="d.name" (ngModelChange)="patch({ name: $event })" /></div>
          <div class="grid grid-cols-2 gap-2">
            <div><label class="pf-label">Type</label>
              <pf-select [options]="typeOptions" [value]="d.type" (valueChange)="patch({ type: $event })"></pf-select>
            </div>
            <div><label class="pf-label">Flow</label>
              <pf-select [options]="flowOptions" [value]="d.flow" (valueChange)="patch({ flow: $event })"></pf-select>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div><label class="pf-label">Department</label>
              <pf-select [options]="departmentOptions()" [value]="d.departmentId"
                         placeholder="— Select department —"
                         (valueChange)="patch({ departmentId: $event })"></pf-select>
            </div>
            <div><label class="pf-label">Sample type</label>
              <input type="text" class="pf-input" [ngModel]="d.sampleType"
                     (ngModelChange)="patch({ sampleType: $event })" /></div>
          </div>
        </div>
      </pf-tile>

      <!-- Pricing + TAT -->
      <pf-tile tone="default" padding="lg" class="block mb-4">
        <h3 class="section-title">Pricing & TAT</h3>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
          <div><label class="pf-label">Price</label>
            <pf-number-input [value]="d.price" [min]="0" [step]="50" suffix="₹"
                             (valueChange)="patch({ price: $event ?? 0 })"></pf-number-input>
          </div>
          <div><label class="pf-label">Tax slab</label>
            <pf-number-input [value]="d.taxSlab" [min]="0" [max]="50" [step]="0.5" suffix="%"
                             (valueChange)="patch({ taxSlab: $event ?? 0 })"></pf-number-input>
          </div>
          <div><label class="pf-label">TAT</label>
            <pf-number-input [value]="d.tatHours" [min]="1" [step]="1" suffix="hrs"
                             (valueChange)="patch({ tatHours: $event ?? 1 })"></pf-number-input>
          </div>
        </div>
      </pf-tile>

      <!-- Parameters -->
      <pf-tile tone="default" padding="lg" class="block">
        <div class="flex items-center justify-between mb-3">
          <h3 class="section-title">Parameters ({{ editedParams().length }})</h3>
          <pf-touch-btn size="sm" variant="ghost" (pressed)="addParameter()">
            <span icon-left aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 5v14"/>
                <path d="M5 12h14"/>
              </svg>
            </span>
            Add parameter
          </pf-touch-btn>
        </div>

        @if (editedParams().length === 0) {
          <p class="text-[13px]" style="color: var(--text-tertiary);">
            No parameters yet. Add one to let lab staff enter results.
          </p>
        } @else {
          <div class="space-y-3">
            @for (p of editedParams(); let i = $index; track i) {
              <div class="param-row space-y-2">
                <div class="grid grid-cols-12 gap-2">
                  <div class="col-span-12 md:col-span-4">
                    <label class="text-[11px] font-mono" style="color: var(--text-muted);">Label</label>
                    <input type="text" class="pf-input text-sm"
                           [ngModel]="p.title"
                           (ngModelChange)="patchParam(i, { title: $event, name: deriveName($event, p.name) })" />
                  </div>
                  <div class="col-span-6 md:col-span-3">
                    <label class="text-[11px] font-mono" style="color: var(--text-muted);">Type</label>
                    <pf-select size="sm"
                               [options]="paramTypeOptions"
                               [value]="p.type"
                               (valueChange)="patchParam(i, { type: $event })">
                    </pf-select>
                  </div>
                  <div class="col-span-5 md:col-span-3">
                    <label class="text-[11px] font-mono" style="color: var(--text-muted);">Unit</label>
                    <input type="text" class="pf-input text-sm"
                           [ngModel]="p.unit"
                           [disabled]="!isNumericType(p.type)"
                           (ngModelChange)="patchParam(i, { unit: $event })" />
                  </div>
                  <div class="col-span-1 md:col-span-2 flex items-end justify-end">
                    <button type="button" class="param-remove"
                            (click)="removeParam(i)" aria-label="Remove">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 6 6 18"/>
                        <path d="m6 6 12 12"/>
                      </svg>
                    </button>
                  </div>
                </div>

                @if (isNumericType(p.type)) {
                  <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div>
                      <label class="text-[11px] font-mono" style="color: var(--text-muted);">Normal min</label>
                      <pf-number-input size="sm" [allowEmpty]="true" [step]="0.1"
                                        [value]="(p.referenceRanges ?? [])[0]?.min ?? null"
                                        (valueChange)="patchRange(i, { min: $event ?? undefined })">
                      </pf-number-input>
                    </div>
                    <div>
                      <label class="text-[11px] font-mono" style="color: var(--text-muted);">Normal max</label>
                      <pf-number-input size="sm" [allowEmpty]="true" [step]="0.1"
                                        [value]="(p.referenceRanges ?? [])[0]?.max ?? null"
                                        (valueChange)="patchRange(i, { max: $event ?? undefined })">
                      </pf-number-input>
                    </div>
                    <div>
                      <label class="text-[11px] font-mono" style="color: var(--text-muted);">Critical low</label>
                      <pf-number-input size="sm" [allowEmpty]="true" [step]="0.1"
                                        [value]="p.criticalLow ?? null"
                                        (valueChange)="patchParam(i, { criticalLow: $event ?? undefined })">
                      </pf-number-input>
                    </div>
                    <div>
                      <label class="text-[11px] font-mono" style="color: var(--text-muted);">Critical high</label>
                      <pf-number-input size="sm" [allowEmpty]="true" [step]="0.1"
                                        [value]="p.criticalHigh ?? null"
                                        (valueChange)="patchParam(i, { criticalHigh: $event ?? undefined })">
                      </pf-number-input>
                    </div>
                  </div>
                }

                @if (hasOptions(p.type)) {
                  <div>
                    <label class="text-[11px] font-mono" style="color: var(--text-muted);">Options (comma-separated)</label>
                    <input type="text" class="pf-input text-sm"
                           [ngModel]="(p.options ?? []).join(', ')"
                           (ngModelChange)="patchParam(i, { options: splitOptions($event) })"
                           placeholder="Positive, Negative" />
                  </div>
                }
              </div>
            }
          </div>
        }
      </pf-tile>
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
    .param-row {
      border-radius: 14px;
      padding: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
    }
    .param-remove {
      width: 32px;
      height: 32px;
      border-radius: 9999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      background: transparent;
      border: 1px solid transparent;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .param-remove:hover {
      background: rgba(239, 68, 68, 0.15);
      color: #fca5a5;
      border-color: rgba(239, 68, 68, 0.3);
    }
  `]
})
export class TestEditorComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly typeOptions: PfSelectOption<'individual' | 'package'>[] = [
    { value: 'individual', label: 'Individual' },
    { value: 'package',    label: 'Package' }
  ];
  readonly flowOptions: PfSelectOption<'direct' | 'approval'>[] = [
    { value: 'direct',   label: 'Direct',   hint: 'Result goes straight to reports' },
    { value: 'approval', label: 'Approval', hint: 'Needs pathologist validation' }
  ];
  readonly paramTypes = [
    { value: 'numeric',              label: 'Numeric' },
    { value: 'numeric_with_range',   label: 'Numeric w/ range' },
    { value: 'critical_numeric',     label: 'Numeric w/ critical' },
    { value: 'text',                 label: 'Free text' },
    { value: 'select',               label: 'Dropdown' },
    { value: 'radio',                label: 'Radio buttons' },
    { value: 'button_select',        label: 'Button select' },
    { value: 'multiselect',          label: 'Multi-select' },
    { value: 'yesno',                label: 'Yes / No' },
    { value: 'toggle',               label: 'Toggle' }
  ];
  readonly paramTypeOptions: PfSelectOption<string>[] = this.paramTypes.map(t => ({
    value: t.value, label: t.label
  }));

  private readonly _departments = signal<Department[]>([]);
  readonly departments = this._departments.asReadonly();
  readonly departmentOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: '— None —' },
    ...this._departments().map(d => ({ value: d.id, label: d.name }))
  ]);

  private readonly _draft = signal<DraftTest>(makeEmptyDraft());
  readonly draft = this._draft.asReadonly();

  private readonly _editedParams = signal<ParameterRow[]>([]);
  readonly editedParams = this._editedParams.asReadonly();

  private readonly _saving = signal(false);
  readonly saving = this._saving.asReadonly();

  readonly subtitle = computed(() =>
    this._draft().id
      ? 'Update name, pricing, parameters, or flow.'
      : 'Define what the lab collects, how it\'s priced, and the parameters captured.'
  );

  ngOnInit() {
    this.api.get<Department[]>('/api/tenants/departments').subscribe({
      next: l => this._departments.set(l ?? [])
    });

    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.api.get<Test>(`/api/tests/${id}`).subscribe({
        next: t => this.hydrateFrom(t),
        error: () => this.toasts.error('Could not load test')
      });
    }
  }

  private hydrateFrom(t: Test) {
    this._draft.set({
      id: t.id, name: t.name, type: t.type, flow: t.flow,
      price: t.price, taxSlab: t.taxSlab,
      departmentId: t.departmentId ?? '', tatHours: t.tatHours,
      sampleType: t.sampleType ?? '',
      parametersJson: t.parameters ?? '', conditionsJson: t.conditions ?? '[]',
      isActive: t.isActive
    });
    this._editedParams.set(this.loadParameters(t.parameters ?? ''));
  }

  isNumericType(t: string): boolean {
    return t === 'numeric' || t === 'numeric_with_range' || t === 'critical_numeric';
  }
  hasOptions(t: string): boolean {
    return ['select', 'radio', 'button_select', 'multiselect'].includes(t);
  }
  splitOptions(s: string): string[] {
    return s.split(',').map(x => x.trim()).filter(Boolean);
  }
  deriveName(title: string, currentName: string | undefined): string {
    if (currentName && currentName.trim() && !currentName.startsWith('new_param')) return currentName;
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || currentName || '';
  }

  private loadParameters(draftJson: string): ParameterRow[] {
    if (!draftJson) return [];
    try {
      const blob = JSON.parse(draftJson) as TestParametersBlob;
      return (blob.parameters ?? []).map(p => ({
        name: p.name, title: p.title, type: p.type, unit: p.unit, options: p.options,
        referenceRanges: p.referenceRanges, criticalLow: p.criticalLow,
        criticalHigh: p.criticalHigh, normalValue: p.normalValue as string | undefined
      }));
    } catch { return []; }
  }

  private persistParamsToDraft() {
    const params = this._editedParams();
    const existing = (() => {
      try { return JSON.parse(this._draft().parametersJson || '{}'); } catch { return {}; }
    })();
    const blob = { ...existing, parameters: params };
    this.patch({ parametersJson: JSON.stringify(blob) });
  }

  addParameter() {
    const idx = this._editedParams().length + 1;
    this._editedParams.update(list => [...list, {
      name: `new_param_${idx}`,
      title: `New parameter ${idx}`,
      type: 'numeric_with_range',
      unit: '',
      referenceRanges: [{ segment: 'normal', min: undefined, max: undefined }]
    }]);
    this.persistParamsToDraft();
  }

  patchParam(i: number, updates: Partial<ParameterRow>) {
    this._editedParams.update(list =>
      list.map((p, idx) => idx === i ? { ...p, ...updates } : p)
    );
    this.persistParamsToDraft();
  }

  patchRange(i: number, updates: Partial<{ min?: number; max?: number }>) {
    this._editedParams.update(list => list.map((p, idx) => {
      if (idx !== i) return p;
      const ranges = [...(p.referenceRanges ?? [{ segment: 'normal' }])];
      ranges[0] = { ...ranges[0], segment: ranges[0].segment ?? 'normal', ...updates };
      return { ...p, referenceRanges: ranges };
    }));
    this.persistParamsToDraft();
  }

  removeParam(i: number) {
    this._editedParams.update(list => list.filter((_, idx) => idx !== i));
    this.persistParamsToDraft();
  }

  patch(p: Partial<DraftTest>) { this._draft.update(d => ({ ...d, ...p })); }

  back() { this.router.navigateByUrl('/admin/tests'); }

  saveTest() {
    const d = this._draft();
    if (!d.name.trim()) { this.toasts.warning('Name is required'); return; }

    const body = {
      name: d.name, type: d.type, flow: d.flow,
      price: d.price, taxSlab: d.taxSlab,
      departmentId: d.departmentId || undefined,
      tatHours: d.tatHours, sampleType: d.sampleType || undefined,
      parametersJson: d.parametersJson || undefined,
      conditionsJson: d.conditionsJson || undefined,
      isActive: d.isActive
    };

    this._saving.set(true);
    if (d.id) {
      this.api.patch<Test>(`/api/tests/${d.id}`, body).subscribe({
        next: () => { this._saving.set(false); this.toasts.success('Updated'); this.back(); },
        error: e => { this._saving.set(false); this.toasts.error(e.message ?? 'Save failed'); }
      });
    } else {
      this.api.post<Test>('/api/tests/', body).subscribe({
        next: () => { this._saving.set(false); this.toasts.success('Created'); this.back(); },
        error: e => { this._saving.set(false); this.toasts.error(e.message ?? 'Save failed'); }
      });
    }
  }
}
