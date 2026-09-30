import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AllCommunityModule, ColDef, GetRowIdParams, ICellRendererParams, ModuleRegistry, RowClickedEvent } from 'ag-grid-community';
import { AgGridAngular } from 'ag-grid-angular';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { SkeletonTableComponent } from '../../../shared/primitives/skeleton-kit.component';
import { createLoadHold } from '../../../shared/utils/min-duration';
import { plural } from '../../../shared/utils/plural';
import { bandFilter } from '../../../shared/utils/band-search';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { OpdAdminApi, OpdFormListRow } from './opd-admin.api';
import { libraryVersion, opdGridDark, opdGridLight } from './opd-admin.util';

ModuleRegistry.registerModules([AllCommunityModule]);
type Show = 'active' | 'archived';


/**
 * Consultation forms (/admin/opd/forms, Agent A) — the ONE shared, versioned
 * library (AG-Grid like Test Master). Opening a form edits it in place on the
 * doctor's own consult screen (the form builder); New form starts from a
 * specialty starter, a copy or blank. Past consults keep their version.
 */
@Component({
  selector: 'pf-opd-form-library',
  standalone: true,
  imports: [AgGridAngular, HeroBandComponent, ScreenHeaderComponent, SegmentedComponent, SkeletonTableComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./opd-admin.shared.scss'],
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" backTo="/admin/opd" placeholder="Search forms — name, used by…" [value]="q()" (valueChange)="q.set($event)">
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--primary press" (click)="newForm()" aria-label="New form" title="New form">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
              New form
            </button>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only" eyebrow="OPD" title="Consultation forms" parentRoute="/admin/opd"
        subtitle="One shared library. Edit a form right on the doctor's own screen; publishing makes a new version.">
        <div actions><button type="button" class="nd-btn nd-btn--primary press" (click)="newForm()">New form</button></div>
      </pf-screen-header>

      <div class="pf-band-body pf-band-body--fill">
        <section class="nd-card oa-main" aria-label="Form library" style="flex:1 1 auto">
          <header class="nd-card__head oa-main__head">
            <span class="nd-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6a1 1 0 0 1 1 1v1H8V4a1 1 0 0 1 1-1ZM8 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M8 12h8M8 16h5"/></svg></span>
            <span class="nd-card__label">Form library</span>
            <span class="nd-card__note oa-hint">Vitals, diagnosis, prescription, investigations and follow-up are built into every consult — not form questions.</span>
            <pf-segmented size="sm" [options]="showOptions()" [value]="show()" (valueChange)="show.set($event)" aria-label="Show"></pf-segmented>
            <span class="oa-count nd-num">{{ plural(visible().length, 'form') }}</span>
          </header>
          <div class="oa-main__body">
            @if (skeleton()) { <pf-skeleton-table class="oa-grid-skel" [rows]="8" [cols]="5" label="Loading forms…"></pf-skeleton-table> }
            <ag-grid-angular class="oa-grid" [theme]="gridTheme()" [rowData]="visible()" [columnDefs]="cols" [defaultColDef]="defaultColDef"
                             [getRowId]="getRowId" [animateRows]="true" (rowClicked)="open($event)"></ag-grid-angular>
            @if (!skeleton() && !visible().length) {
              <p class="oa-empty">{{ q().trim() ? 'No forms match “' + q() + '”.' : show() === 'archived' ? 'No archived forms.' : 'No forms yet — New form starts from a specialty starter.' }}</p>
            }
          </div>
        </section>
      </div>
    </section>
  `,
})
export class OpdFormLibraryPage {
  private readonly api = inject(OpdAdminApi);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  protected readonly theme = inject(ThemeService);
  protected readonly plural = plural;

  readonly rows = signal<OpdFormListRow[]>([]);
  readonly q = signal('');
  readonly show = signal<Show>('active');
  private readonly hold = createLoadHold(true);
  readonly skeleton = this.hold.active;
  readonly gridTheme = computed(() => (this.theme.isDark() ? opdGridDark : opdGridLight));
  readonly showOptions = computed<SegmentedOption<Show>[]>(() => [
    { value: 'active', label: 'In use', count: this.rows().filter((r) => r.isActive).length },
    { value: 'archived', label: 'Archived', count: this.rows().filter((r) => !r.isActive).length },
  ]);
  readonly visible = computed(() => bandFilter(this.rows().filter((r) => r.isActive === (this.show() === 'active')), this.q(), (r) => [r.name, r.code, r.description]));

  readonly getRowId = (p: GetRowIdParams<OpdFormListRow>) => p.data.id;
  readonly defaultColDef: ColDef<OpdFormListRow> = { sortable: true, resizable: true, minWidth: 100, flex: 1 };
  readonly cols: ColDef<OpdFormListRow>[] = [
    { field: 'name', headerName: 'Form', flex: 2, minWidth: 200 },
    { headerName: 'Version', minWidth: 150, valueGetter: (p) => (p.data ? libraryVersion(p.data) : '') },
    { field: 'questionCount', headerName: 'Questions', width: 120, flex: 0, cellClass: 'nd-num', type: 'rightAligned' },
    { headerName: 'Used by', minWidth: 170, valueGetter: (p) => (p.data ? usedBy(p.data) : '') },
    { field: 'updatedAt', headerName: 'Changed', minWidth: 130, cellClass: 'nd-num',
      valueFormatter: (p) => (p.value ? new Date(p.value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '') },
    { colId: 'act', headerName: '', width: 92, flex: 0, sortable: false, pinned: 'right',
      cellRenderer: (p: ICellRendererParams<OpdFormListRow>) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'nd-rowact'; b.textContent = 'Edit'; b.setAttribute('aria-label', `Edit ${p.data?.name ?? 'form'}`); return b; } },
  ];

  constructor() {
    this.api.ensureStarter().subscribe(() => this.api.forms().subscribe({
      next: (r) => { this.hold.done(); this.rows.set(r ?? []); },
      error: () => { this.hold.done(); this.toasts.error('Could not load the form library'); },
    }));
  }

  open(e: RowClickedEvent<OpdFormListRow>): void { if (e.data) this.router.navigate(['/admin/opd/forms', e.data.id]); }
  newForm(): void { this.router.navigate(['/admin/opd/forms', 'new']); }
}

function usedBy(f: OpdFormListRow): string {
  const parts: string[] = [];
  if (f.usedByDepartments) parts.push(plural(f.usedByDepartments, 'department'));
  if (f.usedByServices) parts.push(plural(f.usedByServices, 'service'));
  return parts.join(' · ') || 'Not attached yet';
}
