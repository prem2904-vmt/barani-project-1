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

            <!-- Each verdict IS its cutoff: tap the S / I / R cell to set the
                 result, edit the mm value inside it. The zone auto-highlights
                 the right cell via CLSI. Rows flow into two columns on wide
                 screens — no half-empty screen. -->
            <div class="ce-abx">
              @for (ab of org.antibiotics; track abi; let abi = $index) {
                <div class="ce-abx__row" [attr.data-interp]="ab.interpretation || null">
                  <span class="ce-abx__name">{{ ab.name }}</span>

                  <span class="ce-abx__cell ce-abx__cell--s" role="button" tabindex="0"
                        [class.ce-abx__cell--on]="ab.interpretation === 'S'"
                        [title]="isAuto(oi, abi) && ab.interpretation === 'S' ? 'Auto from zone — tap another cell to override' : 'Susceptible when zone ≥ this'"
                        (click)="setInterp(oi, abi, 'S')" (keydown.enter)="setInterp(oi, abi, 'S')">
                    <span class="ce-abx__celllbl">S ≥</span>
                    <input type="number" class="ce-abx__bpin" inputmode="numeric"
                           [ngModel]="effS(org.name, ab)" (ngModelChange)="setBpS(oi, abi, $event ?? null)"
                           placeholder="—" (click)="$event.stopPropagation()" />
                    <span class="ce-abx__cellunit">mm</span>
                  </span>

                  <span class="ce-abx__cell ce-abx__cell--i" role="button" tabindex="0"
                        [class.ce-abx__cell--on]="ab.interpretation === 'I'"
                        title="Intermediate — the window between the cutoffs"
                        (click)="setInterp(oi, abi, 'I')" (keydown.enter)="setInterp(oi, abi, 'I')">
                    <span class="ce-abx__celllbl">I</span>
                    <span class="ce-abx__iwin">{{ effI(org.name, ab) }}</span>
                  </span>

                  <span class="ce-abx__cell ce-abx__cell--r" role="button" tabindex="0"
                        [class.ce-abx__cell--on]="ab.interpretation === 'R'"
                        [title]="isAuto(oi, abi) && ab.interpretation === 'R' ? 'Auto from zone — tap another cell to override' : 'Resistant when zone ≤ this'"
                        (click)="setInterp(oi, abi, 'R')" (keydown.enter)="setInterp(oi, abi, 'R')">
                    <span class="ce-abx__celllbl">R ≤</span>
                    <input type="number" class="ce-abx__bpin" inputmode="numeric"
                           [ngModel]="effR(org.name, ab)" (ngModelChange)="setBpR(oi, abi, $event ?? null)"
                           placeholder="—" (click)="$event.stopPropagation()" />
                    <span class="ce-abx__cellunit">mm</span>
                  </span>

                  <span class="ce-abx__zonewrap">
                    <input type="number" class="ce-abx__zone" inputmode="numeric"
                           [ngModel]="ab.zoneSize" (ngModelChange)="setZone(oi, abi, $event ?? null)"
                           (keydown.enter)="focusNextZone($event)" placeholder="zone" />
                    <span class="ce-abx__unit">mm</span>
                  </span>

                  <button type="button" class="ce-abx__x" (click)="removeAb(oi, abi)" [attr.aria-label]="'Remove ' + ab.name">×</button>
                </div>
              }
              <!-- The table's last row IS the add action. -->
              <div class="ce-abx__addrow">
                <pf-select [options]="abxOptionsFor(oi)" [multiple]="true" [searchable]="true" [compactMulti]="true"
                           [values]="abxValuesOf(oi)" placeholder="+ Add antibiotic"
                           [triggerLabel]="'+ Add antibiotic'"
                           (valuesChange)="syncAbx(oi, $event)"></pf-select>
              </div>
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

    /* ── Antibiotic rows: verdict cells carry their own cutoffs ── */
    .ce-abx { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(620px, 100%), 1fr)); gap: 8px 20px; }
    .ce-abx__row { display: grid; grid-template-columns: minmax(130px, 1fr) 108px 92px 108px 112px 24px;
      gap: 8px; align-items: center; padding: 7px 12px; border-radius: 12px;
      border: 1px solid var(--border-subtle); background: var(--glass-bg);
      transition: border-color .15s ease, background .2s ease; }
    .ce-abx__row:hover { border-color: rgba(139,92,246,.45); }
    .ce-abx__row[data-interp="S"] { background: rgba(16,185,129,.06); }
    .ce-abx__row[data-interp="I"] { background: rgba(245,158,11,.06); }
    .ce-abx__row[data-interp="R"] { background: rgba(239,68,68,.07); }
    .ce-abx__name { font-size: 13.5px; font-weight: 600; color: var(--text-primary);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* One cell = the verdict AND its cutoff. Tap to pick, type to adjust. */
    .ce-abx__cell { display: inline-flex; align-items: center; justify-content: center; gap: 3px;
      height: 40px; border-radius: 10px; border: 1px solid var(--border-subtle); cursor: pointer;
      background: transparent; user-select: none;
      transition: background .15s ease, border-color .15s ease, transform .12s cubic-bezier(0.16,1,0.3,1); }
    .ce-abx__cell:active { transform: scale(0.96); }
    .ce-abx__cell:hover { border-color: rgba(139,92,246,.45); }
    .ce-abx__celllbl { font-size: 11px; font-weight: 800; }
    .ce-abx__cell--s .ce-abx__celllbl { color: #34d399; }
    .ce-abx__cell--i .ce-abx__celllbl { color: #fbbf24; }
    .ce-abx__cell--r .ce-abx__celllbl { color: #f87171; }
    .ce-abx__cellunit { font-size: 10px; font-weight: 600; color: var(--text-tertiary, #64748b); }
    .ce-abx__iwin { font-size: 12.5px; font-weight: 600; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
    .ce-abx__cell--s.ce-abx__cell--on { background: #10b981; border-color: #10b981; }
    .ce-abx__cell--i.ce-abx__cell--on { background: #f59e0b; border-color: #f59e0b; }
    .ce-abx__cell--r.ce-abx__cell--on { background: #ef4444; border-color: #ef4444; }
    .ce-abx__cell--on .ce-abx__celllbl, .ce-abx__cell--on .ce-abx__cellunit,
    .ce-abx__cell--on .ce-abx__iwin, .ce-abx__cell--on .ce-abx__bpin { color: #fff; }
    .ce-abx__cell--on .ce-abx__bpin::placeholder { color: rgba(255,255,255,.7); }

    /* The cutoff value lives INSIDE its verdict cell — borderless inline. */
    .ce-abx__bpin { width: 32px; text-align: center; font-size: 13px; font-weight: 700;
      background: transparent; border: none; outline: none; color: var(--text-primary);
      font-variant-numeric: tabular-nums; -moz-appearance: textfield; appearance: textfield; padding: 0; }
    .ce-abx__bpin::-webkit-inner-spin-button, .ce-abx__bpin::-webkit-outer-spin-button { display: none; }
    .ce-abx__bpin:focus { box-shadow: inset 0 -2px 0 var(--input-border-focus, #8b5cf6); }
    .ce-abx__bpin::placeholder { color: var(--text-tertiary, #64748b); font-weight: 400; }

    .ce-abx__zonewrap { display: inline-flex; align-items: center; gap: 5px; }
    .ce-abx__zone { width: 74px; height: 40px; text-align: center; font-size: 15px; font-weight: 600;
      border-radius: 10px; background: var(--input-bg); border: 1px solid var(--input-border);
      color: var(--input-text); outline: none; font-variant-numeric: tabular-nums;
      -moz-appearance: textfield; appearance: textfield; }
    .ce-abx__zone::-webkit-inner-spin-button, .ce-abx__zone::-webkit-outer-spin-button { display: none; }
    .ce-abx__zone:focus { border-color: var(--input-border-focus); box-shadow: 0 0 0 3px rgba(139,92,246,.15); }
    .ce-abx__zone::placeholder { color: var(--text-tertiary, #64748b); font-weight: 400; font-size: 12px; }
    .ce-abx__unit { font-size: 11px; font-weight: 600; color: var(--text-tertiary, #64748b); }
    .ce-abx__x { width: 22px; height: 22px; border-radius: 50%; border: none; cursor: pointer;
      color: var(--text-tertiary); background: transparent; font-size: 14px; line-height: 1; }
    .ce-abx__x:hover { color: #ef4444; background: rgba(239,68,68,.12); }

    /* Add-antibiotic AS a row: dashed, full width, same shape as the rows. */
    .ce-abx__addrow ::ng-deep .pf-dd__trigger { width: 100%; height: 46px; border-style: dashed;
      background: transparent; color: var(--violet-text, #a78bfa); font-weight: 600; justify-content: center; }
    .ce-abx__addrow ::ng-deep .pf-dd__trigger .pf-dd__value { flex: none; }

    /* ── Phone (additive; desktop untouched) ── */
    @media (max-width: 640px) {
      :host .ce-abx__row { display: flex; flex-wrap: wrap; gap: 6px 10px; }
      :host .ce-abx__name { flex-basis: 100%; }
    }
    @media (pointer: coarse) {
      :host .ce-abx__cell, :host .ce-abx__zone { min-height: 44px; }
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
  /** The raw breakpoint rows — the SOURCE of each organism's default panel:
   *  an organism starts with exactly the drugs CLSI can interpret for it. */
  private bpList: Breakpoint[] = [];
  /** Organism master: name → its Group column (the real taxonomy, e.g.
   *  "Enterobacterales", "Coagulase-Negative Staphylococci") — resolved onto
   *  a breakpoint group instead of guessing from the name. */
  private orgGroups = new Map<string, string>();
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
    const next: CultureResult = {
      ...cur, noGrowth: false,
      organisms: [...(cur.organisms ?? []), ...missing.map(name => ({
        name, antibiotics: this.clsiRows(name),
      }))],
    };
    this._m.set(next);
    this.valueChange.emit(next);
    this.organismsOpen.set(true);
  }

  /** The AST antibiotic vocabulary — names come ONLY from this master. */
  readonly abxNames = signal<string[]>([]);

  ngOnInit() {
    this.api.get<{ name: string; group?: string | null }[]>('/api/microbiology/organisms').subscribe({
      next: rows => {
        const m = new Map<string, string>();
        for (const o of rows ?? []) if (o.name) m.set(o.name.trim().toLowerCase(), o.group ?? '');
        this.orgGroups = m;
        this.backfillClsiPanels();
      },
      error: () => { /* falls back to the name heuristic */ }
    });
    this.api.get<{ name: string }[]>('/api/microbiology/antibiotics').subscribe({
      next: rows => this.abxNames.set((rows ?? []).map(a => a.name).filter(Boolean)),
      error: () => { /* master unavailable → picker shows an empty-state note */ }
    });
    this.api.get<Breakpoint[]>('/api/microbiology/breakpoints').subscribe({
      next: list => {
        const m = new Map<string, { s: number; r: number }>();
        for (const b of list ?? []) m.set(`${b.organismGroup.toLowerCase()}|${b.antibiotic.toLowerCase()}`, { s: b.susceptibleMin, r: b.resistantMax });
        this.bps = m;
        this.bpList = list ?? [];
        // Organisms seeded before the breakpoints arrived have empty panels —
        // fill them now that we know which drugs CLSI covers.
        this.backfillClsiPanels();
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
    const org: CultureOrganism = { name: '', antibiotics: [] };
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
    this.updateOrg(i, o => {
      // Nothing entered yet → the panel follows the organism (its CLSI set).
      const untouched = o.antibiotics.every(a => a.zoneSize == null && !a.interpretation);
      const rows = untouched ? this.clsiRows(name) : null;
      return { ...o, name, antibiotics: rows?.length ? rows : o.antibiotics };
    });
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

  /** The organism's DEFAULT panel: every drug the CLSI table can interpret
   *  for its group — so S/I/R fills itself. Anything else is added by hand
   *  via + Add antibiotic. Empty when the group has no breakpoints. */
  private clsiPanelFor(orgName: string): string[] {
    const group = this.organismGroup(orgName);
    if (!group) return [];
    const names = new Set<string>();
    for (const b of this.bpList)
      if (b.organismGroup.toLowerCase() === group.toLowerCase()) names.add(b.antibiotic);
    return [...names].sort((a, b) => a.localeCompare(b));
  }
  private clsiRows(orgName: string) {
    // CLSI-covered group → exactly its interpretable drugs. Anything else
    // still gets the curated default panel (manual S/I/R) — a picked organism
    // must never sit with an empty table.
    const clsi = this.clsiPanelFor(orgName);
    const names = clsi.length ? clsi : panelForSpecimen(this._m().specimen);
    return names.map(n => ({ name: n, zoneSize: null, interpretation: '' as const }));
  }
  /** Fill CLSI panels onto organisms that are still empty (merge-only, and —
   *  like seedOrganisms — without tripping the userEdited guard). */
  private backfillClsiPanels() {
    const cur = this._m();
    let changed = false;
    const orgs = (cur.organisms ?? []).map(o => {
      if (!o.name.trim()) return o;
      const clsi = this.clsiPanelFor(o.name);
      // Upgrade an empty OR untouched default panel once CLSI coverage is known.
      const untouched = o.antibiotics.every(a => a.zoneSize == null && !a.interpretation);
      if (o.antibiotics.length && (!clsi.length || !untouched)) return o;
      const rows = this.clsiRows(o.name);
      if (!rows.length) return o;
      const same = rows.length === o.antibiotics.length
        && rows.every((r, k) => r.name === o.antibiotics[k]?.name);
      if (same) return o;
      changed = true;
      return { ...o, antibiotics: rows };
    });
    if (!changed) return;
    const next = { ...cur, organisms: orgs };
    this._m.set(next);
    this.valueChange.emit(next);
  }

  /** Auto-set S/I/R from the zone + CLSI breakpoint, unless manually overridden. */
  private autoInterpret(i: number, abi: number) {
    if (this.manual.has(`${i}:${abi}`)) return;
    const ab = this._m().organisms?.[i]?.antibiotics[abi];
    const name = this._m().organisms?.[i]?.name;
    if (!ab) return;
    const bp = this.effBp(name, ab);
    if (!bp || ab.zoneSize == null) return;
    const interp = ab.zoneSize >= bp.s ? 'S' : ab.zoneSize <= bp.r ? 'R' : 'I';
    if (interp !== ab.interpretation) this.setAb(i, abi, { interpretation: interp });
  }

  isAuto(i: number, abi: number): boolean { return !this.manual.has(`${i}:${abi}`); }
  /** Effective cutoffs for a ROW: its own edits win over the CLSI table. */
  private effBp(orgName: string | undefined, ab: AstRow): { s: number; r: number } | undefined {
    const g = this.bpFor(orgName, ab.name);
    const s = ab.sMin ?? g?.s;
    const r = ab.rMax ?? g?.r;
    return s != null && r != null ? { s, r } : undefined;
  }
  effS(orgName: string | undefined, ab: AstRow): number | null {
    return ab.sMin ?? this.bpFor(orgName, ab.name)?.s ?? null;
  }
  effR(orgName: string | undefined, ab: AstRow): number | null {
    return ab.rMax ?? this.bpFor(orgName, ab.name)?.r ?? null;
  }
  /** The Intermediate window — derived, never edited directly. */
  effI(orgName: string | undefined, ab: AstRow): string {
    const s = this.effS(orgName, ab), r = this.effR(orgName, ab);
    if (s == null || r == null) return '—';
    return s - 1 >= r + 1 ? `${r + 1}–${s - 1}` : '—';
  }
  setBpS(i: number, abi: number, v: number | null) { this.setAb(i, abi, { sMin: v }); this.autoInterpret(i, abi); }
  setBpR(i: number, abi: number, v: number | null) { this.setAb(i, abi, { rMax: v }); this.autoInterpret(i, abi); }
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

  /** Resolve an organism onto a CLSI breakpoint group: the master's Group
   *  column first (the real taxonomy), the name itself as fallback. */
  private organismGroup(name?: string): string | null {
    const o = (name ?? '').trim().toLowerCase();
    if (!o) return null;
    return this.normalizeGroup(this.orgGroups.get(o)) ?? this.normalizeGroup(o);
  }
  /** Map a group label or organism name onto one of the breakpoint table's
   *  groups — exact match first, then family keywords. */
  private normalizeGroup(g?: string | null): string | null {
    const s = (g ?? '').trim().toLowerCase();
    if (!s) return null;
    for (const b of new Set(this.bpList.map(x => x.organismGroup)))
      if (b.toLowerCase() === s) return b;
    if (s.includes('staphylococc') || s.includes('mrsa') || s.includes('mssa')) return 'Staphylococcus';
    if (s.includes('enterococc')) return 'Enterococcus';
    if (s.includes('streptococc')) return 'Streptococcus';
    if (s.includes('pseudomon')) return 'Pseudomonas';
    if (s.includes('acinetobacter')) return 'Acinetobacter';
    for (const k of ['enterobacterales', 'escherichia', 'e.coli', 'e. coli', 'klebsiella', 'proteus',
      'enterobacter', 'citrobacter', 'serratia', 'salmonella', 'shigella', 'morganella', 'providencia', 'coliform'])
      if (s.includes(k)) return 'Enterobacterales';
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
    const org = this._m().organisms?.[i];
    const row = org?.antibiotics.find(a => a.name === abName);
    const bp = row ? this.effBp(org?.name, row) : this.bpFor(org?.name, abName);
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
