import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { PlatformService } from '../../../core/services/platform.service';
import { AstRow, CultureOrganism, CultureResult, COMMON_ORGANISMS, PlateMeasurement, panelForSpecimen } from '../../../shared/models/culture.model';
import { PlateMeasureComponent } from './plate-measure.component';

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
  imports: [FormsModule, PlateMeasureComponent],
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
          <button type="button" class="text-xs font-semibold text-violet-400 hover:text-violet-300" (click)="addOrganism()">+ Add organism</button>
        </div>

        @for (org of m().organisms ?? []; track oi; let oi = $index) {
          <div class="rounded-xl border p-3" style="border-color: var(--border-subtle);">
            <div class="flex items-center gap-2 mb-2">
              <span class="text-[13px] font-bold" style="color: var(--text-tertiary);">{{ oi + 1 }}.</span>
              <input type="text" class="pf-input flex-1" list="pf-org-list" [ngModel]="org.name"
                (ngModelChange)="setOrgName(oi, $event)" placeholder="Organism name" />
              <button type="button" class="text-rose-400 hover:text-rose-300 px-1" title="Remove organism" (click)="removeOrganism(oi)">×</button>
            </div>

            <table class="w-full text-[12px]">
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
                      <input type="text" class="pf-input pf-input--compact" [ngModel]="ab.name" (ngModelChange)="setName(oi, abi, $event)" placeholder="Antibiotic" />
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
                    <td><button type="button" class="text-rose-400 px-1" title="Remove" (click)="removeAb(oi, abi)">×</button></td>
                  </tr>
                }
              </tbody>
            </table>
            <div class="flex items-center gap-3 mt-2">
              <button type="button" class="text-[11px] font-medium text-violet-400 hover:text-violet-300" (click)="addAb(oi)">+ Add antibiotic</button>
              <button type="button" class="text-[11px] font-medium text-cyan-400 hover:text-cyan-300" (click)="openMeasure(oi)" title="Photograph the plate and measure zones on-screen">📷 Measure from plate</button>
              @if (org.plateImageUrl) {
                <a [href]="resolveUrl(org.plateImageUrl)" target="_blank" rel="noopener" class="ml-auto" title="View plate photo">
                  <img [src]="resolveUrl(org.plateImageUrl)" class="h-9 w-9 rounded object-cover border" style="border-color: var(--border-subtle);" alt="AST plate" />
                </a>
              }
            </div>
          </div>
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
  styles: [`.pf-input--compact { padding: 4px 8px; font-size: 12px; }`]
})
export class CultureEntryComponent implements OnInit {
  readonly organisms = COMMON_ORGANISMS;
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

  ngOnInit() {
    this.api.get<Breakpoint[]>('/api/microbiology/breakpoints').subscribe({
      next: list => {
        const m = new Map<string, { s: number; r: number }>();
        for (const b of list ?? []) m.set(`${b.organismGroup.toLowerCase()}|${b.antibiotic.toLowerCase()}`, { s: b.susceptibleMin, r: b.resistantMax });
        this.bps = m;
      },
      error: () => { /* offline → manual entry only */ }
    });
  }

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
  }
  removeOrganism(i: number) {
    this.commit({ ...this._m(), organisms: (this._m().organisms ?? []).filter((_, k) => k !== i) });
  }
  setOrgName(i: number, name: string) {
    this.updateOrg(i, o => ({ ...o, name }));
    // Group may have changed → re-interpret this organism's non-manual rows.
    (this._m().organisms?.[i]?.antibiotics ?? []).forEach((_, abi) => this.autoInterpret(i, abi));
  }

  addAb(i: number) { this.updateOrg(i, o => ({ ...o, antibiotics: [...o.antibiotics, { name: '', zoneSize: null, interpretation: '' }] })); }
  removeAb(i: number, abi: number) {
    this.manual.delete(`${i}:${abi}`);
    this.updateOrg(i, o => ({ ...o, antibiotics: o.antibiotics.filter((_, k) => k !== abi) }));
  }
  setName(i: number, abi: number, name: string) { this.setAb(i, abi, { name }); this.autoInterpret(i, abi); }
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
