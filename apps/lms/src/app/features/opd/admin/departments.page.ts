import { SkelGridComponent } from '../../../shared/components/skeleton-frame/skeleton-frame.component';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import {
  AllCommunityModule, CellValueChangedEvent, ColDef, GetRowIdParams, ICellRendererParams, ModuleRegistry, RowClassParams,
} from 'ag-grid-community';
import { AgGridAngular } from 'ag-grid-angular';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { SkeletonRowsComponent, SkeletonTableComponent } from '../../../shared/primitives/skeleton-kit.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { createLoadHold } from '../../../shared/utils/min-duration';
import { plural } from '../../../shared/utils/plural';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import {
  OpdAdminApi, OpdDepartmentInput, OpdDepartmentRow, OpdFormListRow, OpdServiceInput, OpdServiceRow,
} from './opd-admin.api';
import { numberCol, textCol } from '../../../shared/utils/work-grid';
import { rawChoiceCol } from '../shared/opd-grid-cols';
import { deptCode, inr, mq, opdGridDark, opdGridLight, priceText, readFlag, writeFlag } from './opd-admin.util';

ModuleRegistry.registerModules([AllCommunityModule]);

type Cat = 'all' | 'consultation' | 'procedure';
interface SvcRow extends OpdServiceRow { _dirty?: boolean; }

/** The number a service's Price column sorts / filters on. */
export function svcPriceValue(s: Pick<OpdServiceRow, 'priceMode' | 'commonPrice' | 'doctorPrices'>): number | null {
  if (s.priceMode !== 'per_doctor') return s.commonPrice ?? 0;
  const p = (s.doctorPrices ?? []).filter((x) => x.isActive).map((x) => x.price);
  return p.length ? Math.min(...p) : null;
}
const COLLAPSE_KEY = 'pf.opd.master.deptCollapsed';

/**
 * OPD Master (/admin/opd/departments, Agent A) — Test Master's two-card layout
 * (PF-PATTERN "two jobs on one screen"): DEPARTMENTS (a filter companion, LEFT)
 * with each department's consultation form (pick from the ONE shared library,
 * Edit, + New form), and the SERVICES grid (AG-Grid like Test Master: edit
 * cells, one batch Save). A service's form is the department's unless it
 * overrides it (the Override chip). Price is common, or per doctor (set in
 * the service editor / Doctors grid). Departments are OPD's own (admin-only),
 * never lab departments. First open seeds the tenant's starter set (once).
 */
@Component({
  selector: 'pf-opd-departments',
  standalone: true,
  imports: [SkelGridComponent, NgTemplateOutlet, AgGridAngular, HeroBandComponent, ScreenHeaderComponent, SelectComponent, SegmentedComponent,
    SkeletonRowsComponent, SkeletonTableComponent, BusyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./opd-admin.shared.scss'],
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" backTo="/admin/opd" placeholder="Search services — name, code, form…"
                      [value]="q()" (valueChange)="q.set($event)">
          <ng-container band-tools>
            @if (narrow()) {
              <button type="button" class="pf-chip press" (click)="sheetOpen.set(true)" aria-haspopup="dialog"
                      [attr.aria-expanded]="sheetOpen()" [attr.aria-pressed]="!!dept()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
                {{ dept()?.name || 'Departments' }}
              </button>
            }
          </ng-container>
          <ng-container band-actions>
            <ng-container *ngTemplateOutlet="actions"></ng-container>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only" eyebrow="OPD" title="OPD Master" parentRoute="/admin/opd"
        subtitle="Departments, their consultation forms and services — common or per-doctor prices, follow-up rules.">
        <div actions class="oa-actions"><ng-container *ngTemplateOutlet="actions"></ng-container></div>
      </pf-screen-header>

      <div class="pf-band-body pf-band-body--fill">
        <div class="oa-panels" [class.oa-panels--collapsed]="collapsed() && !narrow()" [class.oa-panels--narrow]="narrow()">
          @if (narrow()) {
            @if (sheetOpen()) {
              <div class="oa-sheet-backdrop" (click)="sheetOpen.set(false)"></div>
              <aside class="pf-card oa-side oa-side--sheet" role="dialog" aria-modal="true" aria-label="Departments" (keydown.escape)="sheetOpen.set(false)">
                <span class="pf-sheet__handle" aria-hidden="true"></span>
                <ng-container *ngTemplateOutlet="deptHead; context: { sheet: true }"></ng-container>
                <ng-container *ngTemplateOutlet="deptBody"></ng-container>
              </aside>
            }
          } @else if (collapsed()) {
            <aside class="pf-card oa-strip" aria-label="Departments">
              <button type="button" class="oa-strip__btn" (click)="toggleCollapsed()" aria-label="Show departments" aria-expanded="false">
                <span class="pf-btn pf-btn--icon oa-side__collapse" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></span>
                <span class="oa-strip__label">Departments</span>
              </button>
            </aside>
          } @else {
            <aside class="pf-card oa-side" aria-label="Departments">
              <ng-container *ngTemplateOutlet="deptHead; context: { sheet: false }"></ng-container>
              <ng-container *ngTemplateOutlet="deptBody"></ng-container>
            </aside>
          }

          <section class="pf-card oa-main" aria-label="Services">
            <header class="pf-card__head oa-main__head">
              <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg></span>
              <span class="pf-card__label">Services</span>
              <span class="pf-card__note oa-hint">Form = the department's unless a service overrides it · double-click a cell to edit</span>
              <pf-segmented size="sm" [options]="catOptions()" [value]="cat()" (valueChange)="cat.set($event)" aria-label="Category"></pf-segmented>
              <span class="oa-count pf-num">{{ countLabel() }}</span>
            </header>
            <div class="oa-main__body">
              @if (listSkeleton()) {
                <pf-skel-grid class="oa-grid-skel" [rows]="30" [columns]="7" label="Loading services…"></pf-skel-grid>
              }
              <ag-grid-angular class="oa-grid" [theme]="gridTheme()" [rowData]="visible()" [columnDefs]="colDefs()"
                               [defaultColDef]="defaultColDef" [getRowId]="getRowId" [getRowClass]="rowClass"
                               [stopEditingWhenCellsLoseFocus]="true" [animateRows]="true"
                               (cellValueChanged)="onCell($event)"></ag-grid-angular>
              @if (!listSkeleton() && !visible().length) {
                <p class="oa-empty">{{ q().trim() ? 'No services match “' + q() + '”.' : 'No services here yet — Add service to create one.' }}</p>
              }
            </div>
          </section>
        </div>
      </div>
    </section>

    <ng-template #actions>
      @if (dirtyCount() > 0) {
        <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" [disabled]="saving()" (click)="discard()" aria-label="Discard changes" title="Discard changes">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          Discard
        </button>
        <button type="button" class="pf-hb-btn pf-hb-btn--primary press" [disabled]="saving()" [pfBusy]="saving()" pfBusyLabel="Saving…"
                (click)="save()" aria-label="Save changes" title="Save changes">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>
          {{ saving() ? 'Saving…' : 'Save changes (' + dirtyCount() + ')' }}
        </button>
      }
      <button type="button" class="pf-hb-btn press" [class.pf-hb-btn--primary]="dirtyCount() === 0" [class.pf-hb-btn--ghost]="dirtyCount() > 0"
              (click)="addService()" aria-label="Add service" title="Add service" [disabled]="!depts().length">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
        Add service
      </button>
    </ng-template>

    <ng-template #deptHead let-sheet="sheet">
      <header class="pf-card__head">
        <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg></span>
        <span class="pf-card__label">Departments</span>
        <span class="pf-card__spacer"></span>
        <button type="button" class="pf-btn pf-btn--tertiary press" (click)="addDepartment()" [disabled]="deptBusy()">+ Add</button>
        @if (sheet) {
          <button type="button" class="pf-btn pf-btn--icon oa-side__collapse" (click)="sheetOpen.set(false)" aria-label="Close departments">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        } @else {
          <button type="button" class="pf-btn pf-btn--icon oa-side__collapse" (click)="toggleCollapsed()" aria-label="Hide departments" aria-expanded="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
        }
      </header>
    </ng-template>

    <ng-template #deptBody>
      <div class="pf-card__body">
        @if (listSkeleton()) {
          <pf-skeleton-rows [rows]="5" [avatar]="false" [dense]="true" [trailing]="false" label="Loading departments…"></pf-skeleton-rows>
        } @else {
          <ul class="oa-list" style="padding:0">
            <li class="oa-li">
              <button type="button" class="oa-li__btn" [attr.aria-pressed]="!deptId()" (click)="pickDept(null)">
                <span class="oa-li__text"><span class="oa-li__name">All departments</span>
                  <span class="oa-li__meta">{{ plural(forms().length, 'form') }} in the shared library</span></span>
                <span class="oa-li__n pf-num">{{ services().length }}</span>
              </button>
              <span class="oa-li__gap" aria-hidden="true"></span>
            </li>
            @for (d of depts(); track d.id) {
              <li class="oa-li" [class.oa-li--off]="!d.isActive">
                <button type="button" class="oa-li__btn" [attr.aria-pressed]="deptId() === d.id" (click)="pickDept(d.id)">
                  <span class="oa-li__text">
                    <span class="oa-li__name">{{ d.name }}@if (!d.isActive) {<span class="oa-li__off">Off</span>}</span>
                    <span class="oa-li__meta">Form · {{ formName(d.defaultFormId) }}</span>
                  </span>
                  <span class="oa-li__n pf-num">{{ countIn(d.id) }}</span>
                </button>
                <button type="button" class="pf-toggle" role="switch" [attr.aria-checked]="d.isActive" (click)="toggleDept(d)"
                        [attr.aria-label]="'Department ' + d.name + ' on'" [disabled]="deptBusy()">
                  <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                </button>
              </li>
            } @empty {
              <li class="oa-empty">No departments yet — + Add one.</li>
            }
          </ul>
          @if (dept(); as d) {
            <div class="oa-sec">{{ d.name }} · consultation form</div>
            <pf-select [options]="formOptions()" [value]="d.defaultFormId ?? ''" [searchable]="forms().length > 8"
                       placeholder="Pick a form" (valueChange)="setDeptForm(d, $event)"></pf-select>
            <span class="oa-li__meta">{{ formMeta(d.defaultFormId) }}</span>
            <div class="oa-actions">
              <button type="button" class="pf-btn pf-btn--secondary oa-btn press" [disabled]="!d.defaultFormId" (click)="editForm(d.defaultFormId)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                Edit
              </button>
              <button type="button" class="pf-btn pf-btn--tertiary oa-btn press" (click)="newForm(d)">+ New form</button>
            </div>
            <p class="oa-note">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/></svg>
              <span>Doctors may add their own questions on top — they can't remove yours. Vitals, diagnosis, prescription, investigations and follow-up are built into every consult.</span>
            </p>
          } @else {
            <div class="oa-sec">Consultation forms</div>
            <p class="oa-note"><span>One shared library of {{ plural(forms().length, 'form') }}. Pick a department to see — or change — the form its doctors fill.</span></p>
          }
        }
      </div>
    </ng-template>
  `,
})
export class OpdDepartmentsPage {
  private readonly api = inject(OpdAdminApi);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly router = inject(Router);
  protected readonly theme = inject(ThemeService);
  protected readonly plural = plural;

  readonly depts = signal<OpdDepartmentRow[]>([]);
  readonly forms = signal<OpdFormListRow[]>([]);
  readonly services = signal<SvcRow[]>([]);
  private pristine: SvcRow[] = [];
  readonly deptId = signal<string | null>(null);
  readonly cat = signal<Cat>('all');
  readonly q = signal('');
  readonly saving = signal(false);
  readonly deptBusy = signal(false);
  readonly sheetOpen = signal(false);
  readonly collapsed = signal(readFlag(COLLAPSE_KEY));
  readonly narrow = signal(false);
  private readonly hold = createLoadHold(true);
  readonly listSkeleton = this.hold.active;

  readonly dept = computed(() => this.depts().find((d) => d.id === this.deptId()) ?? null);
  readonly gridTheme = computed(() => (this.theme.isDark() ? opdGridDark : opdGridLight));
  readonly dirtyCount = computed(() => this.services().filter((s) => s._dirty).length);
  readonly formById = computed(() => new Map(this.forms().map((f) => [f.id, f] as const)));
  readonly deptById = computed(() => new Map(this.depts().map((d) => [d.id, d] as const)));
  readonly formOptions = computed<PfSelectOption<string>[]>(() => this.forms().filter((f) => f.isActive).map((f) => ({
    value: f.id, label: f.name, hint: `${f.publishedVersion ? 'v' + f.publishedVersion : 'new'} · ${plural(f.usedByServices, 'service')}`,
  })));
  readonly catOptions = computed<SegmentedOption<Cat>[]>(() => {
    const inDept = this.services().filter((s) => !this.deptId() || s.departmentId === this.deptId());
    return [
      { value: 'all', label: 'All', count: inDept.length },
      { value: 'consultation', label: 'Consultation', count: inDept.filter((s) => s.category === 'consultation').length },
      { value: 'procedure', label: 'Procedure', count: inDept.filter((s) => s.category === 'procedure').length },
    ];
  });
  readonly visible = computed(() => {
    const q = this.q().trim().toLowerCase();
    const order = new Map(this.depts().map((d, i) => [d.id, i] as const));
    return this.services()
      .filter((s) => (!this.deptId() || s.departmentId === this.deptId()) && (this.cat() === 'all' || s.category === this.cat()))
      .filter((s) => !q || `${s.name} ${s.code} ${this.formName(this.effectiveForm(s))}`.toLowerCase().includes(q))
      .sort((a, b) => (order.get(a.departmentId) ?? 0) - (order.get(b.departmentId) ?? 0) || a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  });
  readonly countLabel = computed(() => plural(this.visible().length, 'service'));

  readonly getRowId = (p: GetRowIdParams<SvcRow>) => p.data.id;
  readonly rowClass = (p: RowClassParams<SvcRow>) => (p.data && !p.data.isActive ? 'pf-row-off' : '');
  readonly defaultColDef: ColDef<SvcRow> = { resizable: true, sortable: true, filter: false, minWidth: 90, wrapText: true, autoHeight: true };

  readonly colDefs = computed<ColDef<SvcRow>[]>(() => {
    const depts = this.depts();
    const forms = this.forms();
    const all = !this.deptId();
    return [
      textCol<SvcRow>({ field: 'code', headerName: 'Code', editable: true, width: 100, flex: 0, cellClass: 'pf-num',
        valueParser: (p) => String(p.newValue ?? '').trim().toUpperCase().slice(0, 32) || p.oldValue }, (r) => r.code ?? ''),
      textCol<SvcRow>({ field: 'name', headerName: 'Service', editable: true, flex: 1.4, minWidth: 150,
        valueParser: (p) => String(p.newValue ?? '').trim().slice(0, 160) || p.oldValue }, (r) => r.name ?? ''),
      rawChoiceCol<SvcRow>({ field: 'category', headerName: 'Category', editable: true, width: 124, flex: 0,
        cellEditor: 'agSelectCellEditor', cellEditorParams: { values: ['consultation', 'procedure'] },
        valueFormatter: (p) => (p.value === 'procedure' ? 'Procedure' : 'Consultation') },
        (r) => r.category, (r) => (r.category === 'procedure' ? 'Procedure' : 'Consultation')),
      rawChoiceCol<SvcRow>({ field: 'departmentId', headerName: 'Department', editable: true, flex: 0.9, minWidth: 110, hide: !all,
        cellEditor: 'agSelectCellEditor', cellEditorParams: { values: depts.map((d) => d.id) },
        refData: Object.fromEntries(depts.map((d) => [d.id, d.name])) },
        (r) => r.departmentId, (r) => depts.find((d) => d.id === r.departmentId)?.name ?? ''),
      rawChoiceCol<SvcRow>({ field: 'formId', headerName: 'Form', editable: true, flex: 1.2, minWidth: 160,
        cellEditor: 'agSelectCellEditor', cellEditorParams: { values: ['', ...forms.filter((f) => f.isActive).map((f) => f.id)] },
        refData: { '': 'Department form', ...Object.fromEntries(forms.map((f) => [f.id, f.name])) },
        valueSetter: (p) => { if (!p.data) return false; p.data.formId = p.newValue || null; return true; },
        cellRenderer: (p: ICellRendererParams<SvcRow>) => this.formCell(p.data) },
        (r) => r.formId ?? '', (r) => this.formName(this.effectiveForm(r))),
      rawChoiceCol<SvcRow>({ field: 'priceMode', headerName: 'Price mode', editable: true, width: 156, flex: 0,
        cellEditor: 'agSelectCellEditor', cellEditorParams: { values: ['common', 'per_doctor'] },
        valueFormatter: (p) => (p.value === 'per_doctor' ? 'Per doctor' : 'Common'),
        cellRenderer: (p: ICellRendererParams<SvcRow>) => this.modeCell(p.data) },
        (r) => r.priceMode, (r) => (r.priceMode === 'per_doctor' ? 'Per doctor' : 'Common')),
      // The price as a NUMBER (common price; per-doctor = the lowest active doctor price, none = blank, sorts last);
      // the cell still reads "₹500" / "₹400 – ₹600" / "Set per doctor".
      numberCol<SvcRow>({ colId: 'price', headerName: 'Price', width: 118, flex: 0, type: 'rightAligned', cellClass: 'pf-num',
        editable: (p) => p.data?.priceMode !== 'per_doctor',
        valueFormatter: (p) => (p.data?.priceMode === 'per_doctor' ? priceText(p.data) : typeof p.value === 'number' ? inr(p.value) : String(p.value ?? '')),
        valueSetter: (p) => { const n = Number(p.newValue); if (!p.data || !Number.isFinite(n) || n < 0) return false; p.data.commonPrice = Math.round(n * 100) / 100; return true; } },
        (r) => svcPriceValue(r), 'right'),
      { colId: 'act', headerName: '', width: 84, flex: 0, sortable: false, resizable: false, pinned: this.narrow() ? 'right' : undefined,
        cellRenderer: (p: ICellRendererParams<SvcRow>) => this.editButton(p.data) },
    ];
  });

  constructor() {
    const ref = inject(DestroyRef);
    this.narrow.set(mq('(max-width: 900px)', ref, (m) => this.narrow.set(m)));
    this.api.ensureStarter().subscribe(() => this.load());
  }

  load(): void {
    forkJoin({ d: this.api.departments(), s: this.api.services(), f: this.api.forms() }).subscribe({
      next: ({ d, s, f }) => {
        this.hold.done();
        this.depts.set(d ?? []);
        this.forms.set(f ?? []);
        this.pristine = (s ?? []).map((x) => ({ ...x }));
        this.services.set((s ?? []).map((x) => ({ ...x })));
      },
      error: () => { this.hold.done(); this.toasts.error('Could not load OPD Master'); },
    });
  }

  formName(id: string | null | undefined): string { return (id && this.formById().get(id)?.name) || 'No form yet'; }
  formMeta(id: string | null | undefined): string {
    const f = id ? this.formById().get(id) : null;
    if (!f) return 'Pick a form from the library.';
    return `${f.publishedVersion ? 'v' + f.publishedVersion : 'New'}${f.draftVersion ? ' · draft changes' : ''} · used by ${plural(f.usedByServices, 'service')}`;
  }
  effectiveForm(s: OpdServiceRow): string | null { return s.formId ?? this.deptById().get(s.departmentId)?.defaultFormId ?? null; }
  countIn(deptId: string): number { return this.services().filter((s) => s.departmentId === deptId).length; }

  private formCell(s: SvcRow | undefined): HTMLElement {
    const el = document.createElement('span');
    el.style.cssText = 'display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap';
    if (!s) return el;
    const name = document.createElement('span');
    name.textContent = this.formName(this.effectiveForm(s));
    if (!s.formId) name.style.color = 'var(--text-secondary)';
    el.appendChild(name);
    if (s.formId && s.category === 'consultation') {
      const chip = document.createElement('span');
      chip.className = 'oa-chip-ov';
      chip.style.cssText = 'display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:999px;font-size:11px;font-weight:600;color:var(--violet-text,#6d28d9);background:color-mix(in srgb,var(--color-primary,#7c3aed) 10%,transparent)';
      chip.textContent = 'Override';
      chip.title = "Overrides the department's form";
      el.appendChild(chip);
    }
    return el;
  }
  /** Price mode + the follow-up rule under it ("Follow-up 7 d · ₹250"). */
  private modeCell(s: SvcRow | undefined): HTMLElement {
    const el = document.createElement('span');
    el.style.cssText = 'display:flex;flex-direction:column;gap:2px;line-height:1.35';
    if (!s) return el;
    const m = document.createElement('span');
    m.textContent = s.priceMode === 'per_doctor' ? 'Per doctor' : 'Common';
    el.appendChild(m);
    const f = document.createElement('small');
    f.style.cssText = 'font-size:11.5px;color:var(--text-tertiary)';
    f.textContent = s.followUpWithinDays ? `Follow-up ${s.followUpWithinDays} d · ${s.followUpFee ? inr(s.followUpFee) : 'free'}` : 'No follow-up rule';
    el.appendChild(f);
    return el;
  }
  private editButton(s: SvcRow | undefined): HTMLElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pf-rowact';
    b.textContent = 'Edit';
    b.setAttribute('aria-label', `Edit ${s?.name ?? 'service'}`);
    b.addEventListener('click', () => s && this.openEditor(s));
    return b;
  }

  onCell(e: CellValueChangedEvent<SvcRow>): void {
    const id = e.data?.id;
    if (!id) return;
    this.services.update((list) => list.map((s) => (s.id === id ? { ...e.data!, _dirty: true } : s)));
  }

  pickDept(id: string | null): void { this.deptId.set(id); if (this.narrow()) this.sheetOpen.set(false); }
  toggleCollapsed(): void { const v = !this.collapsed(); this.collapsed.set(v); writeFlag(COLLAPSE_KEY, v); }

  async discard(): Promise<void> {
    const ok = await this.dialog.confirm({ title: 'Discard your changes?', message: `${plural(this.dirtyCount(), 'service')} will go back to what was saved.`, confirmLabel: 'Discard', tone: 'danger' });
    if (ok) this.services.set(this.pristine.map((x) => ({ ...x })));
  }

  save(): void {
    const rows = this.services().filter((s) => s._dirty);
    if (!rows.length || this.saving()) return;
    this.saving.set(true);
    const body: OpdServiceInput[] = rows.map(({ _dirty, doctorPrices, ...r }) => r);
    this.api.saveServices(body).subscribe({
      next: (saved) => {
        this.saving.set(false);
        const byId = new Map(saved.map((s) => [s.id, s] as const));
        this.services.update((list) => list.map((s) => byId.get(s.id) ?? s));
        this.pristine = this.services().map((x) => ({ ...x }));
        this.toasts.success(`${plural(saved.length, 'service')} saved`);
        this.api.forms().subscribe((f) => this.forms.set(f ?? []));
      },
      error: (e: Error) => { this.saving.set(false); this.toasts.error(e.message || 'Could not save services'); },
    });
  }

  addService(): void {
    const d = this.deptId() ?? this.depts()[0]?.id;
    this.router.navigate(['/admin/opd/services', 'new'], { queryParams: d ? { departmentId: d } : {} });
  }
  async openEditor(s: SvcRow): Promise<void> {
    if (s._dirty) {
      const ok = await this.dialog.confirm({ title: 'Leave unsaved changes?', message: 'Save the grid first to keep your edits to this service.', confirmLabel: 'Open anyway' });
      if (!ok) return;
    }
    this.router.navigate(['/admin/opd/services', s.id]);
  }
  editForm(id: string | null | undefined): void { if (id) this.router.navigate(['/admin/opd/forms', id]); }
  newForm(d: OpdDepartmentRow): void { this.router.navigate(['/admin/opd/forms', 'new'], { queryParams: { departmentId: d.id } }); }

  private deptInput(d: OpdDepartmentRow, patch: Partial<OpdDepartmentRow> = {}): OpdDepartmentInput {
    const x = { ...d, ...patch };
    return { id: x.id, name: x.name, code: x.code, description: x.description ?? null, defaultFormId: x.defaultFormId ?? null, sortOrder: x.sortOrder, isActive: x.isActive };
  }
  private saveDepts(rows: OpdDepartmentInput[], done: string): void {
    this.deptBusy.set(true);
    this.api.saveDepartments(rows).subscribe({
      next: (list) => { this.deptBusy.set(false); this.depts.set(list); this.toasts.success(done); this.api.forms().subscribe((f) => this.forms.set(f ?? [])); },
      error: (e: Error) => { this.deptBusy.set(false); this.toasts.error(e.message || 'Could not save the department'); },
    });
  }

  setDeptForm(d: OpdDepartmentRow, formId: string): void {
    if (!formId || formId === d.defaultFormId) return;
    const overrides = this.services().filter((s) => s.departmentId === d.id && s.formId).length;
    this.saveDepts([this.deptInput(d, { defaultFormId: formId })],
      `${d.name} now uses ${this.formName(formId)}${overrides ? ` · ${plural(overrides, 'service')} with an override keep theirs` : ''}`);
  }

  async toggleDept(d: OpdDepartmentRow): Promise<void> {
    if (d.isActive) {
      const ok = await this.dialog.confirm({ title: `Turn ${d.name} off?`, message: 'The desk stops offering its services. Past visits are kept.', confirmLabel: 'Turn off', tone: 'danger' });
      if (!ok) return;
    }
    this.saveDepts([this.deptInput(d, { isActive: !d.isActive })], `${d.name} ${d.isActive ? 'turned off' : 'turned on'}`);
  }

  async addDepartment(): Promise<void> {
    const name = (await this.dialog.prompt({ title: 'New department', message: 'OPD departments are this clinic’s own — not lab departments.', placeholder: 'e.g. Dermatology', required: true }))?.trim();
    if (!name) return;
    const code = deptCode(name, this.depts().map((d) => d.code));
    const firstForm = this.forms().find((f) => f.isActive)?.id ?? null;
    this.saveDepts([{ name, code, defaultFormId: firstForm, sortOrder: this.depts().length + 1, isActive: true }], `${name} added`);
  }
}
