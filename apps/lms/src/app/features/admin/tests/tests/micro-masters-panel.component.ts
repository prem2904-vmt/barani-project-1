import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef } from 'ag-grid-community';
import { ApiService } from '../../../../core/services/api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { ThemeService } from '../../../../core/services/theme.service';
import { gridThemeDark, gridThemeLight } from './tests.component';

interface MicroSpecimen {
  code: string; name: string; category: string | null; site: string | null;
  container: string | null; transport: string | null; suitableFor: string | null;
}
interface MicroAntibiotic {
  code: string; name: string; shortName: string | null; abxClass: string | null;
  drugGroup: string | null; astApplicable: boolean; diskDiffusion: boolean;
  micTesting: boolean; reportingCategory: string | null;
}
interface Breakpoint {
  organismGroup: string; antibiotic: string; susceptibleMin: number; resistantMax: number;
  discContent: number | null; source: string | null; version: string | null;
}

type MasterKey = 'specimens' | 'antibiotics' | 'breakpoints';

/**
 * Test Master → MICROBIOLOGY. The culture pipeline's reference dictionaries —
 * the specimen master, the antibiotic master, and the CLSI disk-diffusion
 * breakpoints that map organism-group × antibiotic to S/I/R — presented with
 * the department-rail + grid language of the tests view. These are the
 * dictionaries MIC200 Bacterial C&S draws from at every culture stage; they
 * are standard references (read-only here), not per-test settings.
 */
@Component({
  selector: 'pf-micro-masters-panel',
  standalone: true,
  imports: [AgGridAngular, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-mm">
      <div class="pf-mm__bar">
        <input type="text" class="pf-mm__search" [placeholder]="'Search ' + label(section()) + '…'"
               [ngModel]="query()" (ngModelChange)="query.set($event)" />
        <span class="pf-mm__count">{{ shownCount() }} of {{ totalCount() }} {{ label(section()) }}</span>
        <span class="pf-mm__spacer"></span>
        <span class="pf-mm__hint">Standard reference masters — used by the Culture bench (MIC200 C&amp;S)</span>
      </div>

      <div class="pf-mm__cols">
        <!-- ── LEFT: the masters rail (mirrors the departments rail) ── -->
        <aside class="pf-mm__rail">
          <div class="pf-mm__railhead">Masters</div>
          <ul class="pf-mm__list">
            @for (s of sections; track s.key) {
              <li>
                <button type="button" class="pf-mm__item" [class.pf-mm__item--active]="section() === s.key"
                        (click)="select(s.key)">
                  <span class="pf-mm__iname">{{ s.title }}<span class="pf-mm__isub">{{ s.sub }}</span></span>
                  <span class="pf-mm__icount">{{ countOf(s.key) }}</span>
                </button>
              </li>
            }
          </ul>
        </aside>

        <!-- ── RIGHT: the selected master's grid ── -->
        <div class="pf-mm__grid">
          <ag-grid-angular
            style="width: 100%; height: 62vh;"
            [theme]="gridTheme()"
            [rowData]="rows()"
            [columnDefs]="columnDefs()"
            [defaultColDef]="defaultColDef"
            [animateRows]="true"
            [suppressCellFocus]="true">
          </ag-grid-angular>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .pf-mm { display: flex; flex-direction: column; gap: 12px; }
    .pf-mm__bar { display: flex; align-items: center; gap: 12px; }
    .pf-mm__spacer { flex: 1; }
    .pf-mm__search { flex: 0 1 320px; padding: 9px 12px; border-radius: 10px; font-size: 13px;
      color: var(--text-primary); background: var(--input-bg); border: 1px solid var(--input-border); outline: none; }
    .pf-mm__search:focus { border-color: var(--input-border-focus); }
    .pf-mm__count { font-size: 12px; font-weight: 600; color: var(--text-tertiary); white-space: nowrap; }
    .pf-mm__hint { font-size: 11.5px; color: var(--text-tertiary); white-space: nowrap; }
    @media (max-width: 900px) { .pf-mm__hint { display: none; } }

    /* Rail left, grid right — the departments-panel language. */
    .pf-mm__cols { display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 14px; align-items: start; }
    @media (max-width: 980px) { .pf-mm__cols { grid-template-columns: 1fr; } }
    .pf-mm__rail { border: 1px solid var(--glass-border); border-radius: 14px; background: var(--glass-bg); padding: 10px; }
    .pf-mm__railhead { font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase;
      color: var(--text-tertiary); padding: 4px 8px 8px; }
    .pf-mm__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .pf-mm__item { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%;
      padding: 9px 11px; border-radius: 10px; cursor: pointer; text-align: left;
      background: transparent; border: 1px solid transparent; }
    .pf-mm__item:hover { background: rgba(124,58,237,.06); }
    .pf-mm__item--active { background: rgba(124,58,237,.1); border-color: rgba(124,58,237,.35); }
    .pf-mm__iname { display: flex; flex-direction: column; gap: 1px; min-width: 0;
      font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .pf-mm__isub { font-size: 10.5px; font-weight: 500; color: var(--text-tertiary); }
    .pf-mm__icount { flex-shrink: 0; font-size: 11.5px; font-weight: 700; color: var(--text-tertiary);
      font-variant-numeric: tabular-nums; }
    .pf-mm__grid { border-radius: 12px; overflow: hidden; }
  `],
})
export class MicroMastersPanelComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly theme = inject(ThemeService);

  // Exact same theme objects as the tests grid — one look, three views.
  readonly gridTheme = computed(() => (this.theme.isDark() ? gridThemeDark : gridThemeLight));

  readonly sections: { key: MasterKey; title: string; sub: string }[] = [
    { key: 'specimens',   title: 'Specimens',        sub: 'Collection sites & containers' },
    { key: 'antibiotics', title: 'Antibiotics',      sub: 'AST panel drugs' },
    { key: 'breakpoints', title: 'CLSI breakpoints', sub: 'Organism × drug S/I/R mapping' },
  ];

  readonly section = signal<MasterKey>('specimens');
  readonly query = signal('');
  readonly specimens = signal<MicroSpecimen[]>([]);
  readonly antibiotics = signal<MicroAntibiotic[]>([]);
  readonly breakpoints = signal<Breakpoint[]>([]);

  label(k: MasterKey): string {
    return k === 'specimens' ? 'specimens' : k === 'antibiotics' ? 'antibiotics' : 'breakpoints';
  }
  countOf(k: MasterKey): number {
    return k === 'specimens' ? this.specimens().length
      : k === 'antibiotics' ? this.antibiotics().length
      : this.breakpoints().length;
  }
  totalCount(): number { return this.countOf(this.section()); }
  shownCount(): number { return this.rows().length; }

  select(k: MasterKey) {
    this.section.set(k);
    this.query.set('');
  }

  /** Rows of the active master, filtered by the search box over every column. */
  readonly rows = computed<unknown[]>(() => {
    const q = this.query().trim().toLowerCase();
    const all: unknown[] = this.section() === 'specimens' ? this.specimens()
      : this.section() === 'antibiotics' ? this.antibiotics()
      : this.breakpoints();
    if (!q) return all;
    return all.filter(r => Object.values(r as Record<string, unknown>)
      .some(v => v != null && String(v).toLowerCase().includes(q)));
  });

  readonly defaultColDef: ColDef = { sortable: true, resizable: true, filter: false, suppressMovable: true };

  readonly columnDefs = computed<ColDef[]>(() => {
    switch (this.section()) {
      case 'specimens': return [
        { headerName: 'Specimen', field: 'name', minWidth: 190, flex: 1.4, sort: 'asc' },
        { headerName: 'Category', field: 'category', minWidth: 130 },
        { headerName: 'Site', field: 'site', minWidth: 140 },
        { headerName: 'Container', field: 'container', minWidth: 160 },
        { headerName: 'Transport', field: 'transport', minWidth: 140 },
        { headerName: 'Suitable for', field: 'suitableFor', minWidth: 220, flex: 1.6 },
      ];
      case 'antibiotics': return [
        { headerName: 'Antibiotic', field: 'name', minWidth: 190, flex: 1.4, sort: 'asc' },
        { headerName: 'Short', field: 'shortName', minWidth: 90, maxWidth: 110 },
        { headerName: 'Class', field: 'abxClass', minWidth: 160 },
        { headerName: 'Group', field: 'drugGroup', minWidth: 150 },
        { headerName: 'AST', field: 'astApplicable', minWidth: 85, maxWidth: 100, cellRenderer: this.yesNo },
        { headerName: 'Disk', field: 'diskDiffusion', minWidth: 85, maxWidth: 100, cellRenderer: this.yesNo },
        { headerName: 'MIC', field: 'micTesting', minWidth: 85, maxWidth: 100, cellRenderer: this.yesNo },
        { headerName: 'Reporting', field: 'reportingCategory', minWidth: 130 },
      ];
      default: return [
        { headerName: 'Organism group', field: 'organismGroup', minWidth: 180, flex: 1, sort: 'asc' },
        { headerName: 'Antibiotic', field: 'antibiotic', minWidth: 180, flex: 1 },
        { headerName: 'Disc (µg)', field: 'discContent', minWidth: 100, maxWidth: 120 },
        { headerName: 'S ≥ (mm)', field: 'susceptibleMin', minWidth: 100, maxWidth: 130 },
        { headerName: 'R ≤ (mm)', field: 'resistantMax', minWidth: 100, maxWidth: 130 },
        { headerName: 'Source', field: 'source', minWidth: 120 },
        { headerName: 'Version', field: 'version', minWidth: 100 },
      ];
    }
  });

  /** "Yes"/dash — quieter than checkboxes in a read-only reference grid. */
  private readonly yesNo = (p: { value?: unknown }) => (p.value === true ? 'Yes' : '—');

  ngOnInit() {
    this.api.get<MicroSpecimen[]>('/api/microbiology/specimens').subscribe({
      next: l => this.specimens.set(l ?? []),
      error: () => this.toasts.error('Could not load the specimen master.'),
    });
    this.api.get<MicroAntibiotic[]>('/api/microbiology/antibiotics?all=true').subscribe({
      next: l => this.antibiotics.set(l ?? []),
      error: () => this.toasts.error('Could not load the antibiotic master.'),
    });
    this.api.get<Breakpoint[]>('/api/microbiology/breakpoints').subscribe({
      next: l => this.breakpoints.set(l ?? []),
      error: () => this.toasts.error('Could not load the CLSI breakpoints.'),
    });
  }
}
