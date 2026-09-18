import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { PlatformService } from '../../../core/services/platform.service';
import { AstRow, CultureOrganism, CultureResult, COMMON_ORGANISMS, PlateMeasurement, panelForSpecimen } from '../../../shared/models/culture.model';
import { PlateMeasureComponent } from './plate-measure.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';

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
  imports: [FormsModule, PlateMeasureComponent, TouchButtonComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-4 pb-6">
      @if (!embedded) {
        <!-- Specimen / gram / colony — the standalone C&S form. The culture
             workbench captures these in their own stages, so embedded mode
             starts at the organisms. -->
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
      }

      @if (!m().noGrowth) {
        @if (!embedded) {
          <div class="flex items-center justify-between">
            <span class="pf-label">Organisms isolated</span>
            <pf-touch-btn size="sm" variant="secondary" (pressed)="addOrganism()">+ Add organism</pf-touch-btn>
          </div>
        }

        @if (organismsOpen() || embedded) {
          @for (org of m().organisms ?? []; track oi; let oi = $index) {
          <section class="ce-org">
            <header class="ce-org__head">
              @if (embedded) {
                <!-- Identification owns WHICH organisms — here they are read-only. -->
                <span class="ce-org__name">{{ org.name || 'Organism' }}</span>
              } @else {
                <pf-select style="min-width: 230px; max-width: 300px;" size="sm"
                           [options]="organismOptions()" [searchable]="true"
                           [value]="org.name" placeholder="Select organism…"
                           (valueChange)="setOrgName(oi, $event)"></pf-select>
              }
              <span class="ce-org__prog" [class.ce-org__prog--done]="interpretedCount(oi) === org.antibiotics.length && org.antibiotics.length > 0">
                {{ interpretedCount(oi) }}/{{ org.antibiotics.length }} interpreted
              </span>
              <span class="ce-org__spacer"></span>
              <pf-select class="ce-org__abxpick" size="sm"
                         [options]="abxOptionsFor(oi)" [multiple]="true" [searchable]="true" [compactMulti]="true"
                         [values]="abxValuesOf(oi)" placeholder="Antibiotics…"
                         (valuesChange)="syncAbx(oi, $event)"></pf-select>
              <pf-touch-btn size="sm" variant="secondary" (pressed)="openMeasure(oi)" title="Photograph the plate and measure zones on-screen">
                <svg icon-left width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M4 7h4l2-3h4l2 3h4v11H4V7z" />
                  <path d="M12 11a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
                </svg>
                Measure
              </pf-touch-btn>
              @if (org.plateImageUrl) {
                <a [href]="resolveUrl(org.plateImageUrl)" target="_blank" rel="noopener" class="h-9 w-9 rounded overflow-hidden border"
                  style="border-color: var(--border-subtle);" title="View plate photo">
                  <img [src]="resolveUrl(org.plateImageUrl)" class="h-full w-full object-cover" alt="AST plate" />
                </a>
              }
              @if (!embedded) {
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
              }
            </header>

            <!-- Generous strips: drug + its CLSI targets on the left, a big
                 mm field and the S/I/R verdict on the right. One column on
                 phones/tabs, two on wide desktops — never a dead gap. -->
            <div class="ce-abx">
              @for (ab of org.antibiotics; track abi; let abi = $index) {
                <div class="ce-abx__row" [attr.data-interp]="ab.interpretation || null">
                  <span class="ce-abx__id">
                    <span class="ce-abx__name">{{ ab.name }}</span>
                    @if (bpShort(org.name, ab.name); as h) {
                      <span class="ce-abx__bp">CLSI · {{ h }}</span>
                    } @else {
                      <span class="ce-abx__bp">No breakpoint — set S/I/R by hand</span>
                    }
                  </span>
                  <span class="ce-abx__zonewrap">
                    <input type="number" class="ce-abx__zone" inputmode="numeric"
                           [ngModel]="ab.zoneSize" (ngModelChange)="setZone(oi, abi, $event ?? null)"
                           (keydown.enter)="focusNextZone($event)" placeholder="—" />
                    <span class="ce-abx__unit">mm</span>
                  </span>
                  <span class="ce-abx__sir">
                    @for (v of ['S','I','R']; track v) {
                      <button type="button" class="ce-abx__sirbtn"
                        [style.borderColor]="ab.interpretation === v ? toneColor(v) : 'var(--border-subtle)'"
                        [style.color]="ab.interpretation === v ? '#fff' : 'var(--text-secondary)'"
                        [style.background]="ab.interpretation === v ? toneColor(v) : 'transparent'"
                        [attr.aria-label]="ab.name + ': ' + v"
                        (click)="setInterp(oi, abi, $any(v))">{{ v }}</button>
                    }
                  </span>
                  <span class="ce-abx__tail">
                    @if (isAuto(oi, abi) && ab.interpretation) {
                      <span class="ce-abx__auto" title="Auto-interpreted from the zone (CLSI). Tap S/I/R to override.">auto</span>
                    }
                    <button type="button" class="ce-abx__x" (click)="removeAb(oi, abi)" [attr.aria-label]="'Remove ' + ab.name">×</button>
                  </span>
                </div>
              } @empty {
                <p class="ce-abx__none">No antibiotics on this panel yet — pick them from the Antibiotics dropdown.</p>
              }
            </div>
          </section>
          }
        }
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
  styles: [`
    .pf-input--compact { padding: 4px 8px; font-size: 12px; }

    /* ── Per-organism sensitivity card ── */
    .ce-org { border: 1px solid var(--border-subtle); border-radius: 14px; padding: 12px 14px;
      background: var(--glass-bg); }
    .ce-org + .ce-org { margin-top: 10px; }
    .ce-org__head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
    .ce-org__name { font-size: 14px; font-weight: 700; color: var(--text-primary); }
    .ce-org__prog { font-size: 11px; font-weight: 600; padding: 2px 9px; border-radius: 999px;
      color: var(--text-tertiary); border: 1px solid var(--border-subtle); white-space: nowrap;
      font-variant-numeric: tabular-nums; }
    .ce-org__prog--done { color: #34d399; border-color: rgba(52,211,153,.4); }
    .ce-org__spacer { flex: 1; }
    .ce-org__abxpick { width: 220px; flex-shrink: 0; }

    /* ── Antibiotic strips: generous rows, big mm, verdict-tinted ── */
    .ce-abx { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(460px, 100%), 1fr)); gap: 8px 16px; }
    .ce-abx__row { display: flex; align-items: center; gap: 14px; padding: 9px 14px; border-radius: 12px;
      border: 1px solid var(--border-subtle); background: var(--glass-bg);
      transition: border-color .15s ease, background .2s ease; }
    .ce-abx__row:hover { border-color: rgba(139,92,246,.45); }
    .ce-abx__row[data-interp="S"] { background: rgba(16,185,129,.06); }
    .ce-abx__row[data-interp="I"] { background: rgba(245,158,11,.06); }
    .ce-abx__row[data-interp="R"] { background: rgba(239,68,68,.07); }
    .ce-abx__id { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .ce-abx__name { font-size: 13.5px; font-weight: 600; color: var(--text-primary);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ce-abx__bp { font-size: 10.5px; color: var(--text-tertiary, #64748b); font-variant-numeric: tabular-nums;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ce-abx__zonewrap { display: inline-flex; align-items: baseline; gap: 5px; flex-shrink: 0; }
    .ce-abx__zone { width: 68px; height: 38px; text-align: center; font-size: 15px; font-weight: 600;
      border-radius: 10px; background: var(--input-bg); border: 1px solid var(--input-border);
      color: var(--input-text); outline: none; font-variant-numeric: tabular-nums;
      -moz-appearance: textfield; appearance: textfield; }
    .ce-abx__zone::-webkit-inner-spin-button, .ce-abx__zone::-webkit-outer-spin-button { display: none; }
    .ce-abx__zone:focus { border-color: var(--input-border-focus); box-shadow: 0 0 0 3px rgba(139,92,246,.15); }
    .ce-abx__zone::placeholder { color: var(--text-tertiary, #64748b); font-weight: 400; }
    .ce-abx__unit { font-size: 11px; font-weight: 600; color: var(--text-tertiary, #64748b); }
    .ce-abx__sir { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; }
    .ce-abx__sirbtn { width: 34px; height: 32px; border-radius: 9px; border: 1px solid var(--border-subtle);
      font-size: 12.5px; font-weight: 700; cursor: pointer;
      transition: transform .12s cubic-bezier(0.16,1,0.3,1), background .15s ease, border-color .15s ease; }
    .ce-abx__sirbtn:active { transform: scale(0.92); }
    .ce-abx__tail { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; width: 52px; justify-content: flex-end; }
    .ce-abx__auto { font-size: 9.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
      color: var(--text-tertiary, #64748b); }
    .ce-abx__x { flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%; border: none; cursor: pointer;
      color: var(--text-tertiary); background: transparent; font-size: 14px; line-height: 1; }
    .ce-abx__x:hover { color: #ef4444; background: rgba(239,68,68,.12); }
    .ce-abx__none { grid-column: 1 / -1; margin: 4px 0; font-size: 12px; color: var(--text-tertiary); }

    /* ── Phone (additive; desktop untouched) ── */
    @media (max-width: 640px) {
      :host .ce-abx { grid-template-columns: 1fr; }
      :host .ce-org__abxpick { width: 100%; }
      :host .ce-abx__row { flex-wrap: wrap; gap: 8px 12px; }
      :host .ce-abx__id { flex-basis: 100%; }
    }
    @media (pointer: coarse) {
      :host .ce-abx__sirbtn { min-width: 44px; min-height: 44px; }
      :host .ce-abx__zone { height: 44px; }
    }
`]
})
export class CultureEntryComponent implements OnInit {
  /** Optional master-driven organism list (from /api/microbiology/organisms).
   *  Falls back to the built-in common isolates when not supplied. */
  @Input() organismNames: string[] | null = null;
  /** Workbench mode: specimen/gram/colony live in their own stages, and the
   *  organisms come from the Identification stage (read-only labels here). */
  @Input() embedded = false;
  get organisms(): string[] { return this.organismNames?.length ? this.organismNames : COMMON_ORGANISMS; }
  private readonly api = inject(ApiService);
  private readonly platform = inject(PlatformService);
  private readonly el = inject(ElementRef<HTMLElement>);

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

  // ── Master-only antibiotic vocabulary (no free text, our dropdown) ──
  /** Organism master as dropdown options (standalone mode's name picker). */
  organismOptions(): PfSelectOption<string>[] {
    const names = new Set(this.organisms);
    for (const o of this._m().organisms ?? []) if (o.name.trim()) names.add(o.name.trim());
    return [...names].map(n => ({ value: n, label: n }));
  }
  /** Antibiotic master ∪ this panel's current rows (so a default row whose
   *  drug left the master still shows checked and removable). */
  abxOptionsFor(i: number): PfSelectOption<string>[] {
    const names = new Set(this.abxNames());
    for (const a of this._m().organisms?.[i]?.antibiotics ?? []) if (a.name.trim()) names.add(a.name.trim());
    return [...names].map(n => ({ value: n, label: n }));
  }
  abxValuesOf(i: number): string[] {
    return (this._m().organisms?.[i]?.antibiotics ?? []).map(a => a.name);
  }
  interpretedCount(i: number): number {
    return (this._m().organisms?.[i]?.antibiotics ?? []).filter(a => !!a.interpretation).length;
  }
  /** The checkbox dropdown IS the panel: checked = row exists. Unchecking
   *  removes the row (same as ×); checking adds it blank. Existing rows keep
   *  their zone/interpretation — manual flags are re-indexed by drug name. */
  syncAbx(i: number, names: string[]) {
    const org = this._m().organisms?.[i];
    if (!org) return;
    const manualByName = new Set(org.antibiotics
      .filter((_, k) => this.manual.has(`${i}:${k}`))
      .map(a => a.name.toLowerCase()));
    org.antibiotics.forEach((_, k) => this.manual.delete(`${i}:${k}`));
    const byName = new Map(org.antibiotics.map(a => [a.name.toLowerCase(), a]));
    const next = names.map(n => byName.get(n.toLowerCase()) ?? { name: n, zoneSize: null, interpretation: '' as const });
    next.forEach((a, k) => { if (manualByName.has(a.name.toLowerCase())) this.manual.add(`${i}:${k}`); });
    this.updateOrg(i, o => ({ ...o, antibiotics: next }));
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
  /** Inline CLSI target shown under the drug name — the tech sees what zone
   *  means S or R before measuring, instead of hunting a tooltip. */
  bpShort(orgName?: string, abName?: string): string {
    const bp = this.bpFor(orgName, abName);
    return bp ? `S ≥ ${bp.s} · R ≤ ${bp.r} mm` : '';
  }
  /** Enter in a zone field hops to the next one — plate-reading rhythm. */
  focusNextZone(ev: Event) {
    ev.preventDefault();
    const host = this.el.nativeElement as HTMLElement;
    const zones = Array.from(host.querySelectorAll<HTMLInputElement>('.ce-abx__zone'));
    const i = zones.indexOf(ev.target as HTMLInputElement);
    zones[i + 1]?.focus();
    zones[i + 1]?.select();
  }
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
