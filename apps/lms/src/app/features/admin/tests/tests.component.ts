import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { SlideOverComponent } from '../../../shared/components/slide-over/slide-over.component';
import { Department } from '../../../shared/models/tenant.model';
import { Test, TestParametersBlob } from '../../../shared/models/test.model';
import { ChipComponent } from '../../../shared/primitives/chip.component';
import { NumberInputComponent } from '../../../shared/primitives/number-input.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

type Tab = 'individual' | 'package';

@Component({
  selector: 'pf-tests',
  standalone: true,
  imports: [
    FormsModule,
    CurrencyInrPipe,
    SlideOverComponent,
    ChipComponent,
    NumberInputComponent,
    ScreenHeaderComponent,
    SegmentedComponent,
    SelectComponent,
    TileComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10 max-w-7xl mx-auto">
      <pf-screen-header
        eyebrow="Admin"
        title="Tests"
        subtitle="Master test catalog and packages. Parameters, reference ranges, and TAT per test.">
        <pf-touch-btn actions size="sm" variant="primary" (pressed)="openCreate()">
          <span icon-left aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 5v14"/>
              <path d="M5 12h14"/>
            </svg>
          </span>
          Create test
        </pf-touch-btn>
      </pf-screen-header>

      <div class="mb-4">
        <pf-segmented
          [options]="tabOptions"
          [value]="tab()"
          size="md"
          (valueChange)="setTab($event)">
        </pf-segmented>
      </div>

      <div class="flex flex-wrap gap-2 items-center mb-4">
        <input type="text" class="pf-input max-w-xs" placeholder="Search test name…"
               [ngModel]="search()" (ngModelChange)="onSearch($event)" />
        @if (tab() === 'individual') {
          <select class="pf-input max-w-xs" [ngModel]="deptFilter()" (ngModelChange)="deptFilter.set($event)">
            <option [ngValue]="''">All departments</option>
            @for (d of departments(); track d.id) { <option [ngValue]="d.id">{{ d.name }}</option> }
          </select>
        }
        <p class="text-[12px] font-mono ml-auto" style="color: var(--text-muted);">
          {{ visible().length }} / {{ allForTab().length }}
        </p>
      </div>

      @if (visible().length === 0) {
        <pf-tile tone="default" padding="xl">
          <div class="text-center py-6">
            <p class="text-[14px]" style="color: var(--text-secondary);">No tests match.</p>
          </div>
        </pf-tile>
      } @else {
        <div class="space-y-2.5">
          @for (t of visible(); track t.id) {
            <pf-tile [tone]="t.isActive ? 'default' : 'default'" padding="md">
              <div class="flex items-center gap-3 flex-wrap md:flex-nowrap">
                <div class="pf-test-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10 2v7.31"/>
                    <path d="M14 9.31V2"/>
                    <path d="M8.5 2h7"/>
                    <path d="M14 9.3a6.5 6.5 0 1 1-4 0"/>
                  </svg>
                </div>

                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <p class="font-semibold text-[15px] truncate" style="color: var(--text-primary);">{{ t.name }}</p>
                    @if (tab() === 'individual') {
                      @if (t.flow === 'direct') {
                        <pf-chip tone="emerald" size="sm">direct</pf-chip>
                      } @else {
                        <pf-chip tone="amber" size="sm">approval</pf-chip>
                      }
                    }
                    @if (!t.isActive) {
                      <pf-chip tone="default" size="sm">inactive</pf-chip>
                    }
                  </div>
                  <p class="text-[12px] mt-0.5 truncate" style="color: var(--text-tertiary);">
                    @if (tab() === 'individual') {
                      {{ t.department?.name ?? '—' }}
                      · {{ t.sampleType ?? 'no sample' }}
                      · TAT {{ t.tatHours }}h
                    } @else {
                      Package · {{ packageItemCount(t) }} tests
                    }
                  </p>
                </div>

                <div class="flex items-center gap-3">
                  <p class="font-semibold text-[15px]" style="color: var(--text-primary);">{{ t.price | inr }}</p>
                  <pf-touch-btn size="sm" variant="secondary" (pressed)="openEdit(t)">Edit</pf-touch-btn>
                </div>
              </div>
            </pf-tile>
          }
        </div>
      }
    </section>

    <pf-slide-over [open]="editorOpen()" [title]="editorTitle()" (closed)="closeEditor()">
      @let d = draft();
      <div class="space-y-3">
        <div><label class="pf-label">Name</label>
          <input type="text" class="pf-input" [ngModel]="d.name" (ngModelChange)="patch({ name: $event })" /></div>
        <div class="grid grid-cols-2 gap-2">
          <div><label class="pf-label">Type</label>
            <pf-select [options]="typeOptions" [value]="d.type" (valueChange)="patch({ type: $event })"></pf-select>
          </div>
          <div><label class="pf-label">Flow</label>
            <pf-select [options]="flowOptions" [value]="d.flow" (valueChange)="patch({ flow: $event })"></pf-select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div><label class="pf-label">Price</label>
            <pf-number-input
              [value]="d.price" [min]="0" [step]="50" suffix="₹"
              (valueChange)="patch({ price: $event ?? 0 })"></pf-number-input>
          </div>
          <div><label class="pf-label">Tax slab</label>
            <pf-number-input
              [value]="d.taxSlab" [min]="0" [max]="50" [step]="0.5" suffix="%"
              (valueChange)="patch({ taxSlab: $event ?? 0 })"></pf-number-input>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div><label class="pf-label">Department</label>
            <pf-select [options]="departmentOptions()" [value]="d.departmentId"
                       placeholder="— Select department —"
                       (valueChange)="patch({ departmentId: $event })"></pf-select>
          </div>
          <div><label class="pf-label">TAT</label>
            <pf-number-input
              [value]="d.tatHours" [min]="1" [step]="1" suffix="hrs"
              (valueChange)="patch({ tatHours: $event ?? 1 })"></pf-number-input>
          </div>
        </div>
        <div><label class="pf-label">Sample type</label>
          <input type="text" class="pf-input" [ngModel]="d.sampleType" (ngModelChange)="patch({ sampleType: $event })" /></div>

        <div class="pt-4" style="border-top: 1px solid var(--border-muted);">
          <div class="flex items-center justify-between mb-3">
            <p class="text-[11px] font-mono uppercase tracking-[0.16em]"
               style="color: var(--text-muted);">Parameters ({{ editedParams().length }})</p>
            <button type="button" class="text-[12px] font-semibold hover:underline"
                    style="color: #c4b5fd;"
                    (click)="addParameter()">+ Add parameter</button>
          </div>

          @if (editedParams().length === 0) {
            <p class="text-[13px]" style="color: var(--text-tertiary);">
              No parameters yet. Add one to let lab staff enter results.
            </p>
          } @else {
            <div class="space-y-3">
              @for (p of editedParams(); let i = $index; track i) {
                <div class="pf-param-row space-y-2">
                  <div class="grid grid-cols-12 gap-2">
                    <div class="col-span-4">
                      <label class="text-[11px] font-mono" style="color: var(--text-muted);">Label</label>
                      <input type="text" class="pf-input text-sm"
                             [ngModel]="p.title"
                             (ngModelChange)="patchParam(i, { title: $event, name: deriveName($event, p.name) })" />
                    </div>
                    <div class="col-span-3">
                      <label class="text-[11px] font-mono" style="color: var(--text-muted);">Type</label>
                      <pf-select size="sm"
                                 [options]="paramTypeOptions"
                                 [value]="p.type"
                                 (valueChange)="patchParam(i, { type: $event })">
                      </pf-select>
                    </div>
                    <div class="col-span-3">
                      <label class="text-[11px] font-mono" style="color: var(--text-muted);">Unit</label>
                      <input type="text" class="pf-input text-sm"
                             [ngModel]="p.unit"
                             [disabled]="!isNumericType(p.type)"
                             (ngModelChange)="patchParam(i, { unit: $event })" />
                    </div>
                    <div class="col-span-2 flex items-end justify-end">
                      <button type="button" class="pf-param-remove"
                              (click)="removeParam(i)" aria-label="Remove">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M18 6 6 18"/>
                          <path d="m6 6 12 12"/>
                        </svg>
                      </button>
                    </div>
                  </div>

                  @if (isNumericType(p.type)) {
                    <div class="grid grid-cols-4 gap-2">
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
        </div>
      </div>
      <ng-container footer>
        <div class="flex justify-end gap-2 w-full">
          <pf-touch-btn size="sm" variant="ghost" (pressed)="closeEditor()">Cancel</pf-touch-btn>
          <pf-touch-btn size="sm" variant="primary" (pressed)="saveTest()">Save</pf-touch-btn>
        </div>
      </ng-container>
    </pf-slide-over>
  `,
  styles: [`
    .pf-test-icon {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.22), rgba(168, 85, 247, 0.08));
      border: 1px solid rgba(168, 85, 247, 0.3);
      color: #c4b5fd;
      flex-shrink: 0;
    }
    .pf-param-row {
      border-radius: 14px;
      padding: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
    }
    .pf-param-remove {
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
    .pf-param-remove:hover {
      background: rgba(239, 68, 68, 0.15);
      color: #fca5a5;
      border-color: rgba(239, 68, 68, 0.3);
    }
  `]
})
export class TestsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);

  readonly tabOptions: SegmentedOption<Tab>[] = [
    { value: 'individual', label: 'Individual tests' },
    { value: 'package',    label: 'Packages' }
  ];

  readonly typeOptions: PfSelectOption<'individual' | 'package'>[] = [
    { value: 'individual', label: 'Individual' },
    { value: 'package',    label: 'Package' }
  ];
  readonly flowOptions: PfSelectOption<'direct' | 'approval'>[] = [
    { value: 'direct',   label: 'Direct',   hint: 'Result goes straight to reports' },
    { value: 'approval', label: 'Approval', hint: 'Needs pathologist validation' }
  ];
  readonly departmentOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: '— None —' },
    ...this._departments().map(d => ({ value: d.id, label: d.name }))
  ]);
  private readonly _tab = signal<Tab>('individual');
  private readonly _tests = signal<Test[]>([]);
  private readonly _departments = signal<Department[]>([]);
  private readonly _search = signal('');
  readonly deptFilter = signal('');

  readonly tab = this._tab.asReadonly();
  readonly tests = this._tests.asReadonly();
  readonly departments = this._departments.asReadonly();
  readonly search = this._search.asReadonly();

  readonly allForTab = computed(() =>
    this._tests().filter(t => t.type === this._tab())
  );
  readonly visible = computed(() => {
    const s = this._search().toLowerCase();
    const dep = this.deptFilter();
    return this.allForTab().filter(t =>
      (!s || t.name.toLowerCase().includes(s)) &&
      (!dep || t.departmentId === dep)
    );
  });

  // Editor
  protected readonly editorOpen = signal(false);
  private readonly _draft = signal<DraftTest>(makeEmptyDraft());
  readonly draft = this._draft.asReadonly();
  readonly editorTitle = computed(() => this._draft().id ? 'Edit test' : 'Create test');

  // Parameter editor state
  private readonly _editedParams = signal<ParameterRow[]>([]);
  readonly editedParams = this._editedParams.asReadonly();

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

  isNumericType(t: string): boolean {
    return t === 'numeric' || t === 'numeric_with_range' || t === 'critical_numeric';
  }
  hasOptions(t: string): boolean {
    return ['select', 'radio', 'button_select', 'multiselect'].includes(t);
  }

  numOrUndef(v: unknown): number | undefined {
    if (v === null || v === '' || v === undefined) return undefined;
    const n = Number(v);
    return Number.isNaN(n) ? undefined : n;
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
        name: p.name,
        title: p.title,
        type: p.type,
        unit: p.unit,
        options: p.options,
        referenceRanges: p.referenceRanges,
        criticalLow: p.criticalLow,
        criticalHigh: p.criticalHigh,
        normalValue: p.normalValue as string | undefined
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

  ngOnInit() {
    this.loadTests();
    this.api.get<Department[]>('/api/tenants/departments').subscribe({ next: l => this._departments.set(l ?? []) });
  }

  setTab(t: Tab) { this._tab.set(t); }
  onSearch(v: string) { this._search.set(v); }
  packageItemCount(t: Test): number {
    try {
      const blob = JSON.parse(t.parameters ?? '{}');
      return (blob.items?.length as number) ?? 0;
    } catch { return 0; }
  }

  private loadTests() {
    this.api.get<Test[]>('/api/tests/').subscribe({ next: l => this._tests.set(l ?? []) });
  }

  openCreate() {
    this._draft.set({ ...makeEmptyDraft(), type: this._tab() });
    this._editedParams.set([]);
    this.editorOpen.set(true);
  }
  openEdit(t: Test) {
    this._draft.set({
      id: t.id, name: t.name, type: t.type, flow: t.flow,
      price: t.price, taxSlab: t.taxSlab,
      departmentId: t.departmentId ?? '', tatHours: t.tatHours,
      sampleType: t.sampleType ?? '',
      parametersJson: t.parameters ?? '', conditionsJson: t.conditions ?? '[]',
      isActive: t.isActive
    });
    this._editedParams.set(this.loadParameters(t.parameters ?? ''));
    this.editorOpen.set(true);
  }
  closeEditor() { this.editorOpen.set(false); }
  patch(p: Partial<DraftTest>) { this._draft.update(d => ({ ...d, ...p })); }

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

    if (d.id) {
      this.api.patch<Test>(`/api/tests/${d.id}`, body).subscribe({
        next: saved => { this._tests.update(l => l.map(t => t.id === saved.id ? saved : t)); this.toasts.success('Updated'); this.closeEditor(); }
      });
    } else {
      this.api.post<Test>('/api/tests/', body).subscribe({
        next: saved => { this._tests.update(l => [...l, saved]); this.toasts.success('Created'); this.closeEditor(); }
      });
    }
  }
}

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
