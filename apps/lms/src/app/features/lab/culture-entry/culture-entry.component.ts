import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { PlatformService } from '../../../core/services/platform.service';
import { AstRow, CultureOrganism, CultureResult, COMMON_ORGANISMS, PlateMeasurement, panelForSpecimen } from '../../../shared/models/culture.model';
import { PlateMeasureComponent } from './plate-measure.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

interface Breakpoint { organismGroup: string; antibiotic: string; susceptibleMin: number; resistantMax: number; }

/**
 * Structured Culture & Sensitivity result entry — specimen, gram stain, colony
 * count, organism(s) each with an antibiotic-sensitivity table (S/I/R, optional
 * zone), plus resistance/notes. Emits a CultureResult; the parent stores it as
 * the test's `values`.
 */
@Component({
  selector: 'pf-culture-entry',
  standalone: true,
  imports: [FormsModule, PlateMeasureComponent, TouchButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-4 pb-6">
      <!-- Specimen / gram / colony -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label class="flex flex-col gap-1">
          <span class="pf-label">Specimen</span>
          <input type="text" class="pf-input" [ngModel]="m().specimen" (ngModelChange)="patch({ specimen: $event })" placeholder="e.g. Urine" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="pf-label">Colony count</span>
          <input type="text" class="pf-input" [ngModel]="m().colonyCount" (ngModelChange)="patch({ colonyCount: $event })" placeholder="e.g. 1,00,000 cfu/ml" />
        </label>
        <label class="flex items-center gap-2 mt-6">
          <input type="checkbox" [checked]="m().noGrowth" (change)="setNoGrowth($any($event.target).checked)" />
          <span class="text-[13px]" style="color: var(--text-secondary);">No growth</span>
        </label>
      </div>
      <label class="flex flex-col gap-1">
        <span class="pf-label">Gram stain</span>
        <textarea rows="2" class="pf-input" [ngModel]="m().gramStain" (ngModelChange)="patch({ gramStain: $event })"
          placeholder="e.g. Few pus cells, few gram negative bacilli seen"></textarea>
      </label>

      @if (!m().noGrowth) {
        <!-- Organisms -->
        <div class="flex items-center justify-between">
          <span class="pf-label">Organisms isolated</span>
          <pf-touch-btn size="sm" variant="secondary" (pressed)="addOrganism()">+ Add organism</pf-touch-btn>
        </div>

        @if (organismsOpen()) {
          @for (org of m().organisms ?? []; track oi; let oi = $index) {
          <div class="rounded-xl border p-3" style="border-color: var(--border-subtle);">
            <div class="flex flex-wrap items-center gap-2 mb-2">
              <span class="text-[13px] font-bold" style="color: var(--text-tertiary);">{{ oi + 1 }}.</span>
              <input type="text" class="pf-input flex-1 min-w-[200px]" list="pf-org-list" [ngModel]="org.name"
                (ngModelChange)="setOrgName(oi, $event)" placeholder="Organism name" />
              <pf-touch-btn size="sm" variant="secondary" (pressed)="startAddAb(oi)">
                + Add antibiotic
              </pf-touch-btn>
              <pf-touch-btn size="sm" variant="secondary" (pressed)="openMeasure(oi)" title="Photograph the plate and measure zones on-screen">
                <svg icon-left width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M4 7h4l2-3h4l2 3h4v11H4V7z" />
                  <path d="M12 11a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
                </svg>
                Measure
              </pf-touch-btn>
              <pf-touch-btn size="sm" variant="ghost" (pressed)="removeOrganism(org)" title="Remove organism">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                </svg>
              </pf-touch-btn>
              @if (org.plateImageUrl) {
                <a [href]="resolveUrl(org.plateImageUrl)" target="_blank" rel="noopener" class="h-9 w-9 rounded overflow-hidden border"
                  style="border-color: var(--border-subtle);" title="View plate photo">
                  <img [src]="resolveUrl(org.plateImageUrl)" class="h-full w-full object-cover" alt="AST plate" />
                </a>
              }
            </div>

            <div class="overflow-x-auto"><table class="w-full text-[12px]">
              <thead>
                <tr style="color: var(--text-tertiary);">
                  <th class="text-left font-semibold pb-1">Antimicrobial</th>
                  <th class="font-semibold pb-1 w-16">Zone</th>
                  <th class="font-semibold pb-1 w-28">S / I / R</th>
                  <th class="w-6"></th>
                </tr>
              </thead>
              <tbody>
                @for (ab of org.antibiotics; track abi; let abi = $index) {
                  <tr>
                    <td class="py-0.5">
                      <!-- Master-controlled vocabulary — names are picked, never typed. -->
                      <span class="text-[12px] font-medium" style="color: var(--text-primary);">{{ ab.name }}</span>
                    </td>
                    <td class="py-0.5 px-1">
                      <input type="number" class="pf-input pf-input--compact text-center"
                        [ngModel]="ab.zoneSize" (ngModelChange)="setZone(oi, abi, $event ?? null)"
                        [title]="bpHint(org.name, ab.name)" placeholder="mm" />
                    </td>
                    <td class="py-0.5">
                      <div class="flex gap-1 items-center">
                        @for (v of ['S','I','R']; track v) {
                          <button type="button" class="flex-1 py-1 rounded-md text-[11px] font-bold border"
                            [style.borderColor]="ab.interpretation === v ? toneColor(v) : 'var(--border-subtle)'"
                            [style.color]="ab.interpretation === v ? '#fff' : 'var(--text-secondary)'"
                            [style.background]="ab.interpretation === v ? toneColor(v) : 'transparent'"
                            (click)="setInterp(oi, abi, $any(v))">{{ v }}</button>
                        }
                        @if (isAuto(oi, abi) && ab.interpretation) {
                          <span class="text-[9px] px-1 rounded" title="Auto-interpreted from the zone (CLSI). Click S/I/R to override."
                            style="color: var(--text-tertiary);">auto</span>
                        }
                      </div>
                    </td>
                    <td>
                      <pf-touch-btn size="sm" variant="ghost" (pressed)="removeAb(oi, abi)" title="Remove">
                        <span style="color: var(--red-text);">×</span>
                      </pf-touch-btn>
                    </td>
                  </tr>
                }
              </tbody>
            </table></div>

            @if (addingAb() === oi) {
              <!-- Master-only picker: filter the antibiotic master, tap to add.
                   No free text — the AST vocabulary is the antibiotic table. -->
              <div class="mt-2 rounded-lg border p-2" style="border-color: var(--border-subtle);">
                <input type="text" class="pf-input pf-input--compact w-full" [ngModel]="abQuery()"
                       (ngModelChange)="abQuery.set($event)" placeholder="Search the antibiotic master…" autofocus />
                <div class="mt-1 max-h-44 overflow-y-auto">
                  @for (name of abCandidates(oi); track name) {
                    <button type="button" class="block w-full text-left text-[12px] px-2 py-1.5 rounded-md pf-abx-opt"
                            (click)="addAbFromMaster(oi, name)">{{ name }}</button>
                  } @empty {
                    <div class="text-[11.5px] px-2 py-2" style="color: var(--text-tertiary);">
                      {{ abxNames().length ? 'No matching antibiotic — or already on the panel.' : 'Antibiotic master unavailable.' }}
                    </div>
                  }
                </div>
                <button type="button" class="text-[11.5px] mt-1 px-2 py-1" style="color: var(--text-tertiary); background: transparent; border: none; cursor: pointer;"
                        (click)="addingAb.set(null)">Cancel</button>
              </div>
            }
          </div>
          }
        }
        <datalist id="pf-org-list">
          @for (o of organisms; track o) { <option [value]="o"></option> }
        </datalist>
      }

      <!-- Notes -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label class="flex flex-col gap-1">
          <span class="pf-label">Resistance pattern</span>
          <textarea rows="2" class="pf-input" [ngModel]="m().resistancePattern" (ngModelChange)="patch({ resistancePattern: $event })"></textarea>
        </label>
        <label class="flex flex-col gap-1">
          <span class="pf-label">Intrinsic resistance</span>
          <textarea rows="2" class="pf-input" [ngModel]="m().intrinsicResistance" (ngModelChange)="patch({ intrinsicResistance: $event })"></textarea>
        </label>
        <label class="flex flex-col gap-1">
          <span class="pf-label">Clinical notes</span>
          <textarea rows="2" class="pf-input" [ngModel]="m().clinicalNotes" (ngModelChange)="patch({ clinicalNotes: $event })"></textarea>
        </label>
        <label class="flex flex-col gap-1">
          <span class="pf-label">Infection control advice</span>
          <textarea rows="2" class="pf-input" [ngModel]="m().infectionControlAdvice" (ngModelChange)="patch({ infectionControlAdvice: $event })"></textarea>
        </label>
      </div>

      @if (measureOrg() !== null) {
        <pf-plate-measure
          [antibiotics]="activeAbNames()"
          [existingImageUrl]="activePlateUrl()"
          [srI]="plateInterpret"
          (applied)="onMeasured($event)"
          (cancel)="measureOrg.set(null)" />
      }
    </div>
  `,
  styles: [`.pf-input--compact { padding: 4px 8px; font-size: 12px; }
    .pf-abx-opt { color: var(--text-secondary); background: transparent; border: none; cursor: pointer; }
    .pf-abx-opt:hover { color: var(--text-primary); background: rgba(124,58,237,.08); }
    /* ── Phone (additive; desktop untouched) ── */
    @media (max-width: 640px) {
      /* AST table scrolls sideways instead of crushing the antimicrobial
         name column; the global 44px button floor otherwise blew the
         S/I/R triplet out of the row. */
      :host table { min-width: 520px; }
      :host .overflow-x-auto, :host [class*='ast'] { -webkit-overflow-scrolling: touch; }
    }
    @media (pointer: coarse) {
      :host table button { min-width: 0 !important; min-height: 44px; }
    }
`]
})
export class CultureEntryComponent implements OnInit {
  /** Optional master-driven organism list (from /api/microbiology/organisms).
   *  Falls back to the built-in common isolates when not supplied. */
  @Input() organismNames: string[] | null = null;
  get organisms(): string[] { return this.organismNames?.length ? this.organismNames : COMMON_ORGANISMS; }
  private readonly api = inject(ApiService);
  private readonly platform = inject(PlatformService);

  // Camera measure-assist: index of the organism whose plate is being measured.
  readonly measureOrg = signal<number | null>(null);

  // CLSI breakpoints (group|antibiotic → {s,r}) for zone auto-interpretation.
  private bps = new Map<string, { s: number; r: number }>();
  // Antibiotic rows whose S/I/R was set manually — never auto-overwritten.
  private readonly manual = new Set<string>();

  private userEdited = false;
  @Input() set value(v: CultureResult | null | undefined) {
    // Re-seed from the parent (e.g. an existing result loading after first
    // render) until the user starts editing — then external updates are ignored.
    if (this.userEdited) return;
    const norm = this.normalize(v);
    this._m.set(norm);
    // Treat already-entered interpretations as manual so they aren't overwritten.
    (norm.organisms ?? []).forEach((o, oi) =>
      o.antibiotics.forEach((a, abi) => { if (a.interpretation) this.manual.add(`${oi}:${abi}`); }));
  }
  @Output() valueChange = new EventEmitter<CultureResult>();

  /**
   * Organisms identified upstream (the case's Organism-identification stage).
   * Each name not already present is appended with the specimen's default
   * antibiotic panel — so the sensitivity table always mirrors what was
   * identified. Merge-only: never removes or rewrites rows the tech already
   * has, and deliberately bypasses the userEdited guard (an identification
   * made AFTER the tech started on AST must still appear).
   */
  @Input() set seedOrganisms(names: string[] | null | undefined) {
    if (!names?.length) return;
    const cur = this._m();
    const have = new Set((cur.organisms ?? []).map(o => o.name.trim().toLowerCase()));
    const missing = names.map(n => n.trim()).filter(n => n && !have.has(n.toLowerCase()));
    if (!missing.length) return;
    const panel = panelForSpecimen(cur.specimen);
    const next: CultureResult = {
      ...cur, noGrowth: false,
      organisms: [...(cur.organisms ?? []), ...missing.map(name => ({
        name, antibiotics: panel.map(n => ({ name: n, zoneSize: null, interpretation: '' as const })),
      }))],
    };
    this._m.set(next);
    this.valueChange.emit(next);
    this.organismsOpen.set(true);
  }

  /** The AST antibiotic vocabulary — names come ONLY from this master. */
  readonly abxNames = signal<string[]>([]);

  ngOnInit() {
    this.api.get<{ name: string }[]>('/api/microbiology/antibiotics').subscribe({
      next: rows => this.abxNames.set((rows ?? []).map(a => a.name).filter(Boolean)),
      error: () => { /* master unavailable → picker shows an empty-state note */ }
    });
    this.api.get<Breakpoint[]>('/api/microbiology/breakpoints').subscribe({
      next: list => {
        const m = new Map<string, { s: number; r: number }>();
        for (const b of list ?? []) m.set(`${b.organismGroup.toLowerCase()}|${b.antibiotic.toLowerCase()}`, { s: b.susceptibleMin, r: b.resistantMax });
        this.bps = m;
      },
      error: () => { /* offline → manual entry only */ }
    });
  }

  readonly organismsOpen = signal(false);

  private readonly _m = signal<CultureResult>(this.normalize(null));
  readonly m = this._m.asReadonly();

  private normalize(v: CultureResult | null | undefined): CultureResult {
    return {
      specimen: '', gramStain: '', colonyCount: '', noGrowth: false,
      resistancePattern: '', intrinsicResistance: '',
      clinicalNotes: '', infectionControlAdvice: '',
      ...(v ?? {}),
      organisms: (v?.organisms ?? []).map(o => ({ name: o.name, antibiotics: [...(o.antibiotics ?? [])] }))
    };
  }

  private commit(next: CultureResult) { this.userEdited = true; this._m.set(next); this.valueChange.emit(next); }
  patch(p: Partial<CultureResult>) { this.commit({ ...this._m(), ...p }); }
  setNoGrowth(v: boolean) { this.patch({ noGrowth: v }); }

  addOrganism() {
    const panel = panelForSpecimen(this._m().specimen);
    const org: CultureOrganism = { name: '', antibiotics: panel.map(n => ({ name: n, zoneSize: null, interpretation: '' as const })) };
    this.commit({ ...this._m(), organisms: [...(this._m().organisms ?? []), org] });
    if (!this.organismsOpen()) {
      this.organismsOpen.set(true);
    }
  }

  removeOrganism(target: CultureOrganism) {
    const nextOrgs = (this._m().organisms ?? []).filter(o => o !== target);
    this.commit({ ...this._m(), organisms: nextOrgs });
    if (nextOrgs.length === 0) {
      this.organismsOpen.set(false);
    }
  }

  setOrgName(i: number, name: string) {
    this.updateOrg(i, o => ({ ...o, name }));
    // Group may have changed → re-interpret this organism's non-manual rows.
    (this._m().organisms?.[i]?.antibiotics ?? []).forEach((_, abi) => this.autoInterpret(i, abi));
  }

  // ── Master-only antibiotic picker (no free text) ──────────────────
  /** Index of the organism whose add-antibiotic picker is open. */
  readonly addingAb = signal<number | null>(null);
  readonly abQuery = signal('');
  startAddAb(i: number) { this.addingAb.set(this.addingAb() === i ? null : i); this.abQuery.set(''); }
  /** Master names matching the query, minus the ones already on this panel. */
  abCandidates(i: number): string[] {
    const q = this.abQuery().trim().toLowerCase();
    const have = new Set((this._m().organisms?.[i]?.antibiotics ?? []).map(a => a.name.trim().toLowerCase()));
    return this.abxNames()
      .filter(n => !have.has(n.toLowerCase()) && (!q || n.toLowerCase().includes(q)))
      .slice(0, 12);
  }
  addAbFromMaster(i: number, name: string) {
    this.updateOrg(i, o => ({ ...o, antibiotics: [...o.antibiotics, { name, zoneSize: null, interpretation: '' }] }));
    this.abQuery.set('');
  }
  removeAb(i: number, abi: number) {
    this.manual.delete(`${i}:${abi}`);
    this.updateOrg(i, o => ({ ...o, antibiotics: o.antibiotics.filter((_, k) => k !== abi) }));
  }
  setZone(i: number, abi: number, zoneSize: number | null) { this.setAb(i, abi, { zoneSize }); this.autoInterpret(i, abi); }
  setInterp(i: number, abi: number, v: 'S' | 'I' | 'R') { this.manual.add(`${i}:${abi}`); this.setAb(i, abi, { interpretation: v }); }

  private setAb(i: number, abi: number, p: Partial<AstRow>) {
    this.updateOrg(i, o => ({ ...o, antibiotics: o.antibiotics.map((a, k) => k === abi ? { ...a, ...p } : a) }));
  }

  /** Auto-set S/I/R from the zone + CLSI breakpoint, unless manually overridden. */
  private autoInterpret(i: number, abi: number) {
    if (this.manual.has(`${i}:${abi}`)) return;
    const ab = this._m().organisms?.[i]?.antibiotics[abi];
    const name = this._m().organisms?.[i]?.name;
    if (!ab) return;
    const bp = this.bpFor(name, ab.name);
    if (!bp || ab.zoneSize == null) return;
    const interp = ab.zoneSize >= bp.s ? 'S' : ab.zoneSize <= bp.r ? 'R' : 'I';
    if (interp !== ab.interpretation) this.setAb(i, abi, { interpretation: interp });
  }

  isAuto(i: number, abi: number): boolean { return !this.manual.has(`${i}:${abi}`); }
  bpHint(orgName?: string, abName?: string): string {
    const bp = this.bpFor(orgName, abName);
    return bp ? `CLSI: S ≥ ${bp.s} mm, R ≤ ${bp.r} mm` : 'No CLSI breakpoint — enter S/I/R manually';
  }

  private bpFor(orgName?: string, abName?: string): { s: number; r: number } | undefined {
    const group = this.organismGroup(orgName);
    if (!group || !abName) return undefined;
    return this.bps.get(`${group.toLowerCase()}|${abName.toLowerCase()}`);
  }

  /** Mirror of the backend organism→group heuristic. */
  private organismGroup(name?: string): string | null {
    const o = (name ?? '').toLowerCase();
    if (!o) return null;
    if (o.includes('pseudomonas')) return 'Pseudomonas';
    if (o.includes('acinetobacter')) return 'Acinetobacter';
    if (o.includes('staphylococc') || o.includes('mrsa') || o.includes('mssa')) return 'Staphylococcus';
    if (o.includes('enterococc')) return 'Enterococcus';
    if (o.includes('streptococc')) return 'Streptococcus';
    for (const g of ['escherichia', 'e.coli', 'e. coli', 'klebsiella', 'proteus', 'enterobacter',
      'citrobacter', 'serratia', 'salmonella', 'shigella', 'morganella', 'providencia', 'coliform'])
      if (o.includes(g)) return 'Enterobacterales';
    return null;
  }

  private updateOrg(i: number, fn: (o: CultureOrganism) => CultureOrganism) {
    const orgs = (this._m().organisms ?? []).map((o, k) => k === i ? fn(o) : o);
    this.commit({ ...this._m(), organisms: orgs });
  }

  toneColor(v: string): string { return v === 'S' ? '#10b981' : v === 'R' ? '#ef4444' : '#f59e0b'; }

  // ── Camera measure-assist ────────────────────────────────────────
  openMeasure(i: number) { this.measureOrg.set(i); }

  /** Antibiotic names of the organism being measured — map for the overlay's row indices. */
  activeAbNames(): string[] {
    const i = this.measureOrg();
    if (i == null) return [];
    return (this._m().organisms?.[i]?.antibiotics ?? []).map(a => a.name);
  }
  activePlateUrl(): string | null | undefined {
    const i = this.measureOrg();
    return i == null ? null : this._m().organisms?.[i]?.plateImageUrl;
  }

  /** Apply measured zones: each drops into its antibiotic row via setZone, which
   *  fires the CLSI auto-interpretation. The plate photo is kept on the organism. */
  onMeasured(e: { measurements: PlateMeasurement[]; imageUrl: string | null }) {
    const i = this.measureOrg();
    if (i == null) return;
    for (const meas of e.measurements) this.setZone(i, meas.index, meas.zoneMm);
    this.updateOrg(i, o => ({ ...o, plateImageUrl: e.imageUrl }));
    this.measureOrg.set(null);
  }

  /** Live S/I/R for the plate overlay — interprets a measured zone against the
   *  active organism's CLSI breakpoints (arrow keeps `this` bound as an input). */
  readonly plateInterpret = (abName: string, mm: number): 'S' | 'I' | 'R' | '' => {
    const i = this.measureOrg();
    if (i == null) return '';
    const orgName = this._m().organisms?.[i]?.name;
    const bp = this.bpFor(orgName, abName);
    if (!bp || mm == null) return '';
    return mm >= bp.s ? 'S' : mm <= bp.r ? 'R' : 'I';
  };

  /** Resolve a server-relative plate URL to an absolute one for display. */
  resolveUrl(u?: string | null): string {
    if (!u) return '';
    if (/^https?:\/\//i.test(u) || u.startsWith('data:') || u.startsWith('blob:')) return u;
    return `${this.platform.getApiUrl()}${u}`;
  }

  /** Enough entered to submit: no-growth, or at least one named organism. */
  isReady(): boolean {
    const m = this._m();
    if (m.noGrowth) return true;
    return (m.organisms ?? []).some(o => o.name.trim().length > 0);
  }
}
