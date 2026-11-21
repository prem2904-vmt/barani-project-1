import { ViewStateService } from '../../../shared/services/view-state.service';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import { AllCommunityModule, ModuleRegistry, type ColDef, type RowClickedEvent } from 'ag-grid-community';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { gridThemeDark, gridThemeLight } from '../../admin/tests/tests/grid-theme';
import { PharmacyApi, type SupplierBody, type SupplierRow } from './pharmacy.api';
import { errText } from './pharmacy-math';
import { activeWords } from '../../../shared/utils/status-words';
import { statusWordsCol } from '../../../shared/components/status-words/status-words.component';
import { PharmacySectionsComponent } from './pharmacy-sections.component';

ModuleRegistry.registerModules([AllCommunityModule]);

const EMPTY: SupplierBody = { name: '', gstin: '', drugLicenseNo: '', phone: '', email: '', address: '', isActive: true };

/** GSTIN shape: 15 characters (2-digit state, PAN, entity, Z, check). */
export function gstinOk(g: string | null | undefined): boolean {
  const v = (g ?? '').trim().toUpperCase();
  return v.length === 0 || /^[0-9]{2}[A-Z0-9]{13}$/.test(v);
}

/**
 * Pharmacy suppliers (`/opd/pharmacy/suppliers`) — the tenant's distributors
 * (GSTIN, drug licence, contact) in an AG-Grid; the side card edits the picked
 * supplier or adds a new one. Suppliers feed purchase orders and returns.
 */
@Component({
  selector: 'pf-pharmacy-suppliers',
  standalone: true,
  imports: [AgGridAngular, HeroBandComponent, BusyDirective, PharmacySectionsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./pharmacy.scss'],
  template: `
    <section class="pf-band-page ph">
      <pf-hero-band [back]="true" backTo="/opd/pharmacy" [customSearch]="true">
        <label band-search class="ph-search">
          <svg class="ph-search__glass" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input class="ph-search__input" type="search" placeholder="Search suppliers" aria-label="Search suppliers" [value]="q()" (input)="q.set($any($event.target).value)" />
        </label>
        <pf-pharmacy-sections band-tools active="suppliers"></pf-pharmacy-sections>
        <ng-container band-actions>
          <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" (click)="startNew()">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            New supplier
          </button>
        </ng-container>
      </pf-hero-band>
      <div class="ph-body">
        <section class="pf-card" aria-labelledby="ph-sp-t">
          <header class="pf-card__head">
            <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h13v10H3zM16 10h4l1 3v4h-5"/><circle cx="7" cy="18" r="1.6"/><circle cx="18" cy="18" r="1.6"/></svg></span>
            <span class="pf-card__label" id="ph-sp-t">Suppliers</span>
            <span class="pf-card__spacer"></span>
            <span class="ph-sub pf-num">{{ rows().length }}</span>
          </header>
          <div class="pf-card__body ph-card-body--flush">
            <ag-grid-angular class="ph-grid" style="height:100%" [theme]="gridTheme()" [rowData]="rows()" [columnDefs]="cols"
                             [getRowId]="rowId" (rowClicked)="pick($event)" [overlayNoRowsTemplate]="noRows"></ag-grid-angular>
          </div>
        </section>
        <aside class="pf-card" aria-labelledby="ph-se-t">
          <header class="pf-card__head">
            <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></span>
            <span class="pf-card__label" id="ph-se-t">{{ editId() ? 'Edit supplier' : 'New supplier' }}</span>
          </header>
          <div class="pf-card__body">
            <div class="ph-fields">
              <div class="pf-field ph-span"><label class="pf-field__lbl" for="ph-sn">Name <span class="pf-dot-unpriced" aria-hidden="true"></span></label><input id="ph-sn" class="pf-input" [value]="form().name" (input)="set('name', $any($event.target).value)" /></div>
              <div class="pf-field"><label class="pf-field__lbl" for="ph-sg">GSTIN</label><input id="ph-sg" class="pf-input pf-num" [class.pf-input--error]="!gstOk()" [value]="form().gstin" (input)="set('gstin', $any($event.target).value)" maxlength="15" />
                @if (!gstOk()) { <span class="pf-field__hint" style="color:var(--red-text,#dc2626)">A GSTIN has 15 characters.</span> }</div>
              <div class="pf-field"><label class="pf-field__lbl" for="ph-sl">Drug licence no.</label><input id="ph-sl" class="pf-input pf-num" [value]="form().drugLicenseNo" (input)="set('drugLicenseNo', $any($event.target).value)" /></div>
              <div class="pf-field"><label class="pf-field__lbl" for="ph-sph">Phone</label><input id="ph-sph" class="pf-input pf-num" inputmode="tel" [value]="form().phone" (input)="set('phone', $any($event.target).value)" /></div>
              <div class="pf-field"><label class="pf-field__lbl" for="ph-se">Email</label><input id="ph-se" class="pf-input" type="email" [value]="form().email" (input)="set('email', $any($event.target).value)" /></div>
              <div class="pf-field ph-span"><label class="pf-field__lbl" for="ph-sa">Address</label><textarea id="ph-sa" class="pf-input" rows="3" style="height:auto;padding-top:8px" [value]="form().address ?? ''" (input)="set('address', $any($event.target).value)"></textarea></div>
              <div class="pf-field ph-span" style="flex-direction:row;align-items:center;justify-content:space-between;display:flex">
                <span class="pf-field__lbl" id="ph-sact">Active</span>
                <button type="button" class="pf-toggle" role="switch" [attr.aria-checked]="form().isActive" aria-labelledby="ph-sact" (click)="set('isActive', !form().isActive)"><span class="pf-toggle__track"><span class="pf-toggle__knob"></span></span></button>
              </div>
            </div>
          </div>
          <div class="pf-card__foot">
            <button type="button" class="pf-btn pf-btn--secondary" (click)="startNew()">Clear</button>
            <button type="button" class="pf-btn" [class.pf-btn--primary]="valid()" [class.pf-btn--secondary]="!valid()" [disabled]="!valid() || saving()" [pfBusy]="saving()" pfBusyLabel="Saving…" (click)="save()">{{ editId() ? 'Save' : 'Add supplier' }}</button>
          </div>
        </aside>
      </div>
    </section>
  `,
})
export class PharmacySuppliersPage {
  private readonly api = inject(PharmacyApi);
  private readonly toast = inject(ToastService);
  private readonly theme = inject(ThemeService);
  protected readonly gridTheme = computed(() => (this.theme.isDark() ? gridThemeDark : gridThemeLight));
  protected readonly q = signal('');
  private readonly all = signal<SupplierRow[]>([]);
  protected readonly editId = signal<string | null>(null);
  protected readonly form = signal<SupplierBody>({ ...EMPTY });
  protected readonly saving = signal(false);
  protected readonly noRows = '<span class="ph-sub">No suppliers yet — add your first distributor.</span>';
  protected readonly rows = computed(() => {
    const t = this.q().trim().toLowerCase();
    return !t ? this.all() : this.all().filter(s => (s.name + ' ' + (s.gstin ?? '') + ' ' + (s.phone ?? '')).toLowerCase().includes(t));
  });
  protected readonly gstOk = computed(() => gstinOk(this.form().gstin));
  protected readonly valid = computed(() => !!this.form().name.trim() && this.gstOk());
  protected readonly rowId = (p: { data: SupplierRow }) => p.data.id;
  protected readonly cols: ColDef<SupplierRow>[] = [
    { field: 'name', headerName: 'Supplier', flex: 2, minWidth: 180, wrapText: true, autoHeight: true, cellClass: 'ph-wrap' },
    { field: 'gstin', headerName: 'GSTIN', flex: 1, minWidth: 150 },
    { field: 'drugLicenseNo', headerName: 'Drug licence', flex: 1, minWidth: 130 },
    { field: 'phone', headerName: 'Phone', width: 130 },
    statusWordsCol<SupplierRow>({ field: 'isActive', colId: 'isActive', headerName: 'Status', width: 110, valueGetter: p => (p.data?.isActive ? 'Active' : 'Inactive') }, s => activeWords(!!s.isActive)),
  ];

  constructor() { this.load(); }
  private load() { this.api.suppliers(true).subscribe({ next: s => this.all.set(s), error: e => this.toast.error(errText(e)) }); }
  protected set<K extends keyof SupplierBody>(k: K, v: SupplierBody[K]) { this.form.update(f => ({ ...f, [k]: v })); }
  protected pick(e: RowClickedEvent<SupplierRow>) {
    if (!e.data) return;
    const { id, ...rest } = e.data;
    this.editId.set(id);
    this.form.set({ ...EMPTY, ...rest });
  }
  protected startNew() { this.editId.set(null); this.form.set({ ...EMPTY }); }
  protected save() {
    if (!this.valid()) return;
    this.saving.set(true);
    this.api.saveSupplier(this.editId(), this.form()).subscribe({
      next: s => { this.saving.set(false); this.toast.success(`${s.name} saved`); this.editId.set(s.id); this.load(); },
      error: e => { this.saving.set(false); this.toast.error(errText(e)); },
    });
  }

  // Screen view state (owner 2026-11-21): filters / tab / search come back as left after in-app navigation;
  // fresh on reload, sign-out and branch switch.
  private readonly _viewState = inject(ViewStateService).bind('opd.suppliers', { q: this.q });
}
