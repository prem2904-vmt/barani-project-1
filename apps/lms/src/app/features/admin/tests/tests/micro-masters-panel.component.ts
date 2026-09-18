import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef } from 'ag-grid-community';
import { RowClickedEvent } from 'ag-grid-community';
import { ApiService } from '../../../../core/services/api.service';
import { PfSelectOption, SelectComponent } from '../../../../shared/primitives/select.component';
import { ToastService } from '../../../../core/services/toast.service';
import { ThemeService } from '../../../../core/services/theme.service';
import { gridThemeDark, gridThemeLight } from './tests.component';

interface MicroOrganism {
  code: string; name: string; shortName: string | null; group: string | null;
  gram: string | null; significance: string | null; astApplicable: boolean;
}
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
  discContent: number | null; source: string | null; version: string | null; tenant?: boolean;
}

type MasterKey = 'specimens' | 'organisms' | 'antibiotics' | 'breakpoints';

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
  imports: [AgGridAngular, FormsModule, SelectComponent],
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

        <!-- ── RIGHT: the selected master's grid (+ organism detail) ── -->
        <div class="pf-mm__split" [class.pf-mm__split--detail]="section() === 'organisms' && selOrg()">
          <div class="pf-mm__grid">
            <ag-grid-angular
              style="width: 100%; height: 62vh;"
              [theme]="gridTheme()"
              [rowData]="rows()"
              [columnDefs]="columnDefs()"
              [defaultColDef]="defaultColDef"
              [animateRows]="true"
              [suppressCellFocus]="true"
              (rowClicked)="onRowClicked($event)">
            </ag-grid-angular>
          </div>

          @if (section() === 'organisms' && selOrg(); as org) {
            <!-- The organism's AST panel: its mapped antibiotics + cutoffs.
                 Rows come from the breakpoint table (group-resolved); adding
                 one writes a lab (tenant) breakpoint row. -->
            <aside class="pf-mm__side">
              <div class="pf-mm__shead">
                <span class="pf-mm__sname">{{ org.name }}</span>
                <button type="button" class="pf-mm__ghost" (click)="selOrg.set(null)">Close</button>
              </div>
              <div class="pf-mm__smeta">{{ org.group || 'No group' }}@if (org.gram) { · {{ org.gram }} }</div>

              <div class="pf-mm__slabel">Mapped antibiotics ({{ mappedFor(org).length }})</div>
              @for (b of mappedFor(org); track b.antibiotic) {
                <div class="pf-mm__map">
                  <span class="pf-mm__mapname">{{ b.antibiotic }}</span>
                  <span class="pf-mm__mapbp">
                    <em class="pf-mm__s">S ≥ {{ b.susceptibleMin }}</em>
                    <em class="pf-mm__r">R ≤ {{ b.resistantMax }}</em>
                  </span>
                  @if (b.tenant) {
                    <span class="pf-mm__lab" title="Lab-authored mapping">lab</span>
                    <button type="button" class="pf-mm__mapx" (click)="removeMapping(org, b)"
                            [attr.aria-label]="'Remove ' + b.antibiotic">×</button>
                  } @else {
                    <span class="pf-mm__clsi" title="Seeded CLSI default">CLSI</span>
                  }
                </div>
              } @empty {
                <p class="pf-mm__none">No antibiotics mapped yet — add the first below.</p>
              }

              <div class="pf-mm__slabel">Add antibiotic</div>
              <pf-select size="sm" [options]="addableAbx(org)" [searchable]="true"
                         [value]="addAbxName()" placeholder="Pick from the antibiotic master…"
                         (valueChange)="addAbxName.set($event)"></pf-select>
              <div class="pf-mm__cutrow">
                <label class="pf-mm__cut"><span class="pf-mm__s">S ≥</span>
                  <input type="number" class="pf-mm__cutin" [ngModel]="addS()" (ngModelChange)="addS.set($event)" placeholder="mm" /></label>
                <label class="pf-mm__cut"><span class="pf-mm__r">R ≤</span>
                  <input type="number" class="pf-mm__cutin" [ngModel]="addR()" (ngModelChange)="addR.set($event)" placeholder="mm" /></label>
                <button type="button" class="pf-mm__save" [disabled]="!canAdd() || saving()"
                        (click)="saveMapping(org)">{{ saving() ? 'Saving…' : 'Add' }}</button>
              </div>
              <p class="pf-mm__hint2">The Culture bench builds this organism's panel from these rows — S/I/R auto-interprets from the cutoffs.</p>
            </aside>
          }
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
    .pf-mm__split { display: grid; grid-template-columns: 1fr; gap: 14px; align-items: start; min-width: 0; }
    .pf-mm__split--detail { grid-template-columns: minmax(0, 1.15fr) minmax(320px, .85fr); }
    @media (max-width: 1100px) { .pf-mm__split--detail { grid-template-columns: 1fr; } }
    .pf-mm__grid { border-radius: 12px; overflow: hidden; min-width: 0; }
    .pf-mm__side { border: 1px solid var(--glass-border); border-radius: 14px; background: var(--glass-bg);
      padding: 14px 16px; max-height: 62vh; overflow-y: auto; }
    .pf-mm__shead { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .pf-mm__sname { font-size: 14px; font-weight: 700; color: var(--text-primary); }
    .pf-mm__smeta { font-size: 11.5px; color: var(--text-tertiary); margin-top: 2px; }
    .pf-mm__ghost { padding: 5px 12px; border-radius: 9px; font-size: 12px; font-weight: 600; cursor: pointer;
      color: var(--text-secondary); background: var(--glass-bg); border: 1px solid var(--glass-border); }
    .pf-mm__slabel { font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase;
      color: var(--text-tertiary); margin: 14px 0 6px; }
    .pf-mm__map { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 10px;
      border: 1px solid var(--border-subtle); margin-bottom: 5px; }
    .pf-mm__mapname { flex: 1; min-width: 0; font-size: 12.5px; font-weight: 600; color: var(--text-primary);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pf-mm__mapbp { display: inline-flex; gap: 8px; font-size: 11.5px; font-weight: 600; font-style: normal;
      font-variant-numeric: tabular-nums; white-space: nowrap; }
    .pf-mm__mapbp em { font-style: normal; }
    .pf-mm__s { color: #34d399; }
    .pf-mm__r { color: #f87171; }
    .pf-mm__lab { font-size: 9.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase;
      color: #a78bfa; border: 1px solid rgba(124,58,237,.4); border-radius: 999px; padding: 1px 7px; }
    .pf-mm__clsi { font-size: 9.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase;
      color: var(--text-tertiary); border: 1px solid var(--border-subtle); border-radius: 999px; padding: 1px 7px; }
    .pf-mm__mapx { width: 20px; height: 20px; border-radius: 50%; border: none; cursor: pointer;
      color: var(--text-tertiary); background: transparent; font-size: 13px; line-height: 1; }
    .pf-mm__mapx:hover { color: #ef4444; background: rgba(239,68,68,.12); }
    .pf-mm__none { font-size: 12px; color: var(--text-tertiary); margin: 4px 0; }
    .pf-mm__cutrow { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
    .pf-mm__cut { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 700; }
    .pf-mm__cutin { width: 62px; height: 34px; text-align: center; font-size: 13px; border-radius: 9px;
      background: var(--input-bg); border: 1px solid var(--input-border); color: var(--input-text); outline: none;
      -moz-appearance: textfield; appearance: textfield; }
    .pf-mm__cutin::-webkit-inner-spin-button, .pf-mm__cutin::-webkit-outer-spin-button { display: none; }
    .pf-mm__cutin:focus { border-color: var(--input-border-focus); }
    .pf-mm__save { padding: 7px 16px; border-radius: 9px; font-size: 12.5px; font-weight: 700; color: #fff; cursor: pointer;
      background: var(--gradient-primary, linear-gradient(90deg,#a855f7,#ec4899)); border: 1px solid transparent; }
    .pf-mm__save:disabled { opacity: .5; cursor: default; }
    .pf-mm__hint2 { font-size: 11px; color: var(--text-tertiary); margin: 10px 0 0; }
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
    { key: 'organisms',   title: 'Organisms',        sub: 'Isolates & their AST panels' },
    { key: 'antibiotics', title: 'Antibiotics',      sub: 'AST panel drugs' },
    { key: 'breakpoints', title: 'CLSI breakpoints', sub: 'Organism × drug S/I/R mapping' },
  ];

  readonly section = signal<MasterKey>('specimens');
  readonly query = signal('');
  readonly specimens = signal<MicroSpecimen[]>([]);
  readonly organisms = signal<MicroOrganism[]>([]);
  readonly antibiotics = signal<MicroAntibiotic[]>([]);
  readonly breakpoints = signal<Breakpoint[]>([]);

  label(k: MasterKey): string {
    return k === 'specimens' ? 'specimens' : k === 'organisms' ? 'organisms'
      : k === 'antibiotics' ? 'antibiotics' : 'breakpoints';
  }
  countOf(k: MasterKey): number {
    return k === 'specimens' ? this.specimens().length
      : k === 'organisms' ? this.organisms().length
      : k === 'antibiotics' ? this.antibiotics().length
      : this.breakpoints().length;
  }
  totalCount(): number { return this.countOf(this.section()); }
  shownCount(): number { return this.rows().length; }

  select(k: MasterKey) {
    this.section.set(k);
    this.query.set('');
    this.selOrg.set(null);
  }

  /** Rows of the active master, filtered by the search box over every column. */
  readonly rows = computed<unknown[]>(() => {
    const q = this.query().trim().toLowerCase();
    const all: unknown[] = this.section() === 'specimens' ? this.specimens()
      : this.section() === 'organisms' ? this.organisms()
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
      case 'organisms': return [
        { headerName: 'Organism', field: 'name', minWidth: 210, flex: 1.4, sort: 'asc' },
        { headerName: 'Short', field: 'shortName', minWidth: 90, maxWidth: 120 },
        { headerName: 'Group', field: 'group', minWidth: 160 },
        { headerName: 'Gram', field: 'gram', minWidth: 130 },
        { headerName: 'Significance', field: 'significance', minWidth: 130 },
        { headerName: 'AST', field: 'astApplicable', minWidth: 85, maxWidth: 100, cellRenderer: this.yesNo },
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

  // ── Organism detail: its AST panel mapping ────────────────────────
  readonly selOrg = signal<MicroOrganism | null>(null);
  readonly addAbxName = signal('');
  readonly addS = signal<number | null>(null);
  readonly addR = signal<number | null>(null);
  readonly saving = signal(false);

  onRowClicked(e: RowClickedEvent) {
    if (this.section() !== 'organisms') return;
    this.selOrg.set(e.data as MicroOrganism);
    this.addAbxName.set(''); this.addS.set(null); this.addR.set(null);
  }

  /** The breakpoint group this organism's panel reads from: exact match on
   *  its master Group first, then family keywords, else the group itself
   *  (which is where lab-authored rows for uncovered organisms live). */
  resolveGroup(org: MicroOrganism): string {
    const s = (org.group || org.name).trim();
    const l = s.toLowerCase();
    for (const b of new Set(this.breakpoints().map(x => x.organismGroup)))
      if (b.toLowerCase() === l) return b;
    if (l.includes('staphylococc')) return 'Staphylococcus';
    if (l.includes('enterococc')) return 'Enterococcus';
    if (l.includes('streptococc')) return 'Streptococcus';
    if (l.includes('pseudomon')) return 'Pseudomonas';
    if (l.includes('acinetobacter')) return 'Acinetobacter';
    for (const k of ['enterobacterales', 'escherichia', 'klebsiella', 'proteus', 'enterobacter',
      'citrobacter', 'serratia', 'salmonella', 'shigella', 'morganella', 'providencia'])
      if (l.includes(k)) return 'Enterobacterales';
    return s;
  }
  mappedFor(org: MicroOrganism): Breakpoint[] {
    const g = this.resolveGroup(org).toLowerCase();
    return this.breakpoints()
      .filter(b => b.organismGroup.toLowerCase() === g)
      .sort((a, b) => a.antibiotic.localeCompare(b.antibiotic));
  }
  addableAbx(org: MicroOrganism): PfSelectOption<string>[] {
    const have = new Set(this.mappedFor(org).map(b => b.antibiotic.toLowerCase()));
    return this.antibiotics()
      .filter(a => !have.has(a.name.toLowerCase()))
      .map(a => ({ value: a.name, label: a.name, hint: a.abxClass ?? undefined }));
  }
  canAdd(): boolean {
    const s = this.addS(), r = this.addR();
    return !!this.addAbxName() && s != null && r != null && r >= 1 && s > r;
  }
  saveMapping(org: MicroOrganism) {
    if (!this.canAdd()) return;
    this.saving.set(true);
    this.api.post('/api/microbiology/breakpoints', {
      organismGroup: this.resolveGroup(org),
      antibiotic: this.addAbxName(),
      susceptibleMin: this.addS(),
      resistantMax: this.addR(),
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.toasts.success(`${this.addAbxName()} mapped to ${org.name}`);
        this.addAbxName.set(''); this.addS.set(null); this.addR.set(null);
        this.reloadBreakpoints();
      },
      error: (e: { message?: string }) => { this.saving.set(false); this.toasts.error(e?.message || 'Could not save the mapping'); },
    });
  }
  removeMapping(org: MicroOrganism, b: Breakpoint) {
    this.api.delete(`/api/microbiology/breakpoints?organismGroup=${encodeURIComponent(b.organismGroup)}&antibiotic=${encodeURIComponent(b.antibiotic)}`)
      .subscribe({
        next: () => { this.toasts.success(`${b.antibiotic} removed`); this.reloadBreakpoints(); },
        error: (e: { message?: string }) => this.toasts.error(e?.message || 'Could not remove the mapping'),
      });
  }
  private reloadBreakpoints() {
    this.api.get<Breakpoint[]>('/api/microbiology/breakpoints').subscribe({
      next: l => this.breakpoints.set(l ?? []),
      error: () => { /* keep the stale list */ },
    });
  }

  ngOnInit() {
    this.api.get<MicroOrganism[]>('/api/microbiology/organisms').subscribe({
      next: l => this.organisms.set(l ?? []),
      error: () => this.toasts.error('Could not load the organism master.'),
    });
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
