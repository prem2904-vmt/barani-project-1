import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { PlatformService } from '../../../core/services/platform.service';
import { AstRow, CultureOrganism, CultureResult, COMMON_ORGANISMS, PlateMeasurement, PlateMeasureSession, panelForSpecimen } from '../../../shared/models/culture.model';
import { PlateMeasureComponent } from './plate-measure.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';

interface Breakpoint {
  organismGroup: string; antibiotic: string;
  susceptibleMin: number | null; resistantMax: number | null;
  shortLabel?: string | null; enabled?: boolean; organism?: string | null;
  micS?: string | null; micI?: string | null; micR?: string | null;
}

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
    <div class="space-y-4 pb-6" [class.ce--ro]="readonly">
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
          @if ((m().organisms ?? []).length) {
            <!-- UNIVERSAL entry mode: every organism's table reads in it. -->
            <div class="ce-modebar">
              <span class="ce-modebar__lbl" id="ce-mode-lbl">Reading method</span>
              <span class="nd-seg ce-modeseg" role="radiogroup" aria-labelledby="ce-mode-lbl">
                <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="mode() === 'zone'"
                        (click)="setMode('zone')">Zone (mm)</button>
                <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="mode() === 'mic'"
                        (click)="setMode('mic')">MIC (µg/mL)</button>
              </span>
            </div>
          }
          @for (org of m().organisms ?? []; track oi; let oi = $index) {
          <section class="ce-org">
            <header class="ce-org__head">
              @if (rhOn()) {
                <input type="checkbox" class="ce-rh" [checked]="isShown('org:' + oi)"
                       (change)="toggleShown('org:' + oi)"
                       title="Print this organism on the report (unticked = hidden on the PDF only)" />
              }
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

            <!-- ONE antibiotic per row. Wide screens: cutoffs and the S/I/R
                 result as separate columns under a header. Small screens: the
                 clubbed cells (verdict + its mm in one tap target). -->
            <div class="ce-abx">
              <div class="ce-abx__head" aria-hidden="true">
                <span>Antimicrobial</span>
                @if (mode() === 'mic') {
                  <span class="ce-abx__col--s">S ≤ µg/mL</span>
                  <span class="ce-abx__col--i">I µg/mL</span>
                  <span class="ce-abx__col--r">R ≥ µg/mL</span>
                  <span>MIC</span>
                } @else {
                  <span class="ce-abx__col--s">S ≥ mm</span>
                  <span class="ce-abx__col--i">I mm</span>
                  <span class="ce-abx__col--r">R ≤ mm</span>
                  <span>Zone</span>
                }
                <span>Result</span><span></span>
              </div>
              @for (ab of org.antibiotics; track abi; let abi = $index) {
                <div class="ce-abx__row" [attr.data-interp]="ab.interpretation || null">
                  <span class="ce-abx__namewrap">
                    <span class="ce-abx__nameline">
                      @if (rhOn()) {
                        <input type="checkbox" class="ce-rh" [checked]="isShown('ast:' + oi + ':' + ab.name)"
                               (change)="toggleShown('ast:' + oi + ':' + ab.name)"
                               title="Print this antibiotic on the report (unticked = hidden on the PDF only)" />
                      }
                      <span class="ce-abx__name">{{ ab.name }}</span>
                    </span>
                    @if (micRef(org.name, ab); as m) {
                      <span class="ce-abx__mic" title="MIC breakpoints only — CLSI defines no disk zone for this drug/organism. Set S/I/R by hand (or enter your own zone cutoffs).">
                        MIC µg/mL · <em class="ce-abx__col--s">{{ m.s }}</em> · <em class="ce-abx__col--i">{{ m.i }}</em> · <em class="ce-abx__col--r">{{ m.r }}</em>
                      </span>
                    }
                  </span>

                  <!-- Wide: separated CLSI cutoffs (editable), in the active mode's units -->
                  @if (mode() === 'mic') {
                    <span class="ce-abx__bpwide ce-abx__col--s">
                      <input type="text" class="ce-abx__bpbox" inputmode="decimal"
                             [ngModel]="effMic(org.name, ab, 'micS')" (ngModelChange)="setMicBp(oi, abi, 'micS', $event)"
                             placeholder="—" title="Susceptible when MIC ≤ this (µg/mL) — editable" />
                    </span>
                    <span class="ce-abx__bpwide ce-abx__col--i">
                      <input type="text" class="ce-abx__bpbox ce-abx__bpbox--i" inputmode="decimal"
                             [ngModel]="effMic(org.name, ab, 'micI')" (ngModelChange)="setMicBp(oi, abi, 'micI', $event)"
                             placeholder="—" title="Intermediate MIC (µg/mL) — editable" />
                    </span>
                    <span class="ce-abx__bpwide ce-abx__col--r">
                      <input type="text" class="ce-abx__bpbox" inputmode="decimal"
                             [ngModel]="effMic(org.name, ab, 'micR')" (ngModelChange)="setMicBp(oi, abi, 'micR', $event)"
                             placeholder="—" title="Resistant when MIC ≥ this (µg/mL) — editable" />
                    </span>
                  } @else {
                    <span class="ce-abx__bpwide ce-abx__col--s">
                      <input type="number" class="ce-abx__bpbox" inputmode="numeric"
                             [ngModel]="effS(org.name, ab)" (ngModelChange)="setBpS(oi, abi, $event ?? null)"
                             placeholder="—" title="Susceptible when zone ≥ this (mm) — editable" />
                    </span>
                    <span class="ce-abx__bpwide ce-abx__col--i">
                      <input type="text" class="ce-abx__bpbox ce-abx__bpbox--i"
                             [value]="effIVal(org.name, ab)" (change)="setBpI(oi, abi, $any($event.target).value)"
                             placeholder="—" title="Intermediate window (e.g. 14–16) — typing it sets the S and R cutoffs around it" />
                    </span>
                    <span class="ce-abx__bpwide ce-abx__col--r">
                      <input type="number" class="ce-abx__bpbox" inputmode="numeric"
                             [ngModel]="effR(org.name, ab)" (ngModelChange)="setBpR(oi, abi, $event ?? null)"
                             placeholder="—" title="Resistant when zone ≤ this (mm) — editable" />
                    </span>
                  }

                  <span class="ce-abx__zonewrap">
                    @if (mode() === 'mic') {
                      <input type="text" class="ce-abx__zone" inputmode="decimal"
                             [ngModel]="ab.micValue" (ngModelChange)="setMic(oi, abi, $event ?? null)"
                             (keydown.enter)="focusNextZone($event)" placeholder="MIC" />
                      <span class="ce-abx__unit">µg/mL</span>
                    } @else {
                      <input type="number" class="ce-abx__zone" inputmode="numeric"
                             [ngModel]="ab.zoneSize" (ngModelChange)="setZone(oi, abi, $event ?? null)"
                             (keydown.enter)="focusNextZone($event)" placeholder="zone" />
                      <span class="ce-abx__unit">mm</span>
                    }
                  </span>

                  <!-- Wide: separate S/I/R result buttons -->
                  <span class="ce-abx__sirbtns">
                    <span class="nd-seg ce-sirseg" role="radiogroup" [attr.aria-label]="ab.name + ' result'">
                    @for (v of ['S','I','R']; track v) {
                      <button type="button" class="nd-seg__item ce-abx__sirbtn" role="radio"
                        [attr.data-v]="v"
                        [class.ce-sir-picked]="ab.interpretation === v"
                        [attr.aria-checked]="ab.interpretation === v"
                        [attr.aria-label]="ab.name + ': ' + v"
                        (click)="setInterp(oi, abi, $any(v))">{{ v }}</button>
                    }
                    </span>
                    @if (isAuto(oi, abi) && ab.interpretation) {
                      <span class="ce-abx__auto" title="Auto-interpreted from the zone (CLSI). Tap S/I/R to override.">auto</span>
                    }
                  </span>

                  <!-- Small screens: verdict + cutoff clubbed into one cell -->
                  <span class="ce-abx__cell ce-abx__cell--s" role="button" tabindex="0"
                        [class.ce-abx__cell--on]="ab.interpretation === 'S'"
                        (click)="setInterp(oi, abi, 'S')" (keydown.enter)="setInterp(oi, abi, 'S')">
                    <span class="ce-abx__celllbl">{{ mode() === 'mic' ? 'S ≤' : 'S ≥' }}</span>
                    @if (mode() === 'mic') {
                      <input type="text" class="ce-abx__bpin" inputmode="decimal"
                             [ngModel]="effMic(org.name, ab, 'micS')" (ngModelChange)="setMicBp(oi, abi, 'micS', $event)"
                             placeholder="—" (click)="$event.stopPropagation()" />
                    } @else {
                      <input type="number" class="ce-abx__bpin" inputmode="numeric"
                             [ngModel]="effS(org.name, ab)" (ngModelChange)="setBpS(oi, abi, $event ?? null)"
                             placeholder="—" (click)="$event.stopPropagation()" />
                      <span class="ce-abx__cellunit">mm</span>
                    }
                  </span>
                  <span class="ce-abx__cell ce-abx__cell--i" role="button" tabindex="0"
                        [class.ce-abx__cell--on]="ab.interpretation === 'I'"
                        (click)="setInterp(oi, abi, 'I')" (keydown.enter)="setInterp(oi, abi, 'I')">
                    <span class="ce-abx__celllbl">I</span>
                    @if (mode() === 'mic') {
                      <input type="text" class="ce-abx__bpin ce-abx__bpin--i" inputmode="decimal"
                             [ngModel]="effMic(org.name, ab, 'micI')" (ngModelChange)="setMicBp(oi, abi, 'micI', $event)"
                             placeholder="—" (click)="$event.stopPropagation()" />
                    } @else {
                      <input type="text" class="ce-abx__bpin ce-abx__bpin--i"
                             [value]="effIVal(org.name, ab)" (change)="setBpI(oi, abi, $any($event.target).value)"
                             placeholder="—" (click)="$event.stopPropagation()" />
                    }
                  </span>
                  <span class="ce-abx__cell ce-abx__cell--r" role="button" tabindex="0"
                        [class.ce-abx__cell--on]="ab.interpretation === 'R'"
                        (click)="setInterp(oi, abi, 'R')" (keydown.enter)="setInterp(oi, abi, 'R')">
                    <span class="ce-abx__celllbl">{{ mode() === 'mic' ? 'R ≥' : 'R ≤' }}</span>
                    @if (mode() === 'mic') {
                      <input type="text" class="ce-abx__bpin" inputmode="decimal"
                             [ngModel]="effMic(org.name, ab, 'micR')" (ngModelChange)="setMicBp(oi, abi, 'micR', $event)"
                             placeholder="—" (click)="$event.stopPropagation()" />
                    } @else {
                      <input type="number" class="ce-abx__bpin" inputmode="numeric"
                             [ngModel]="effR(org.name, ab)" (ngModelChange)="setBpR(oi, abi, $event ?? null)"
                             placeholder="—" (click)="$event.stopPropagation()" />
                      <span class="ce-abx__cellunit">mm</span>
                    }
                  </span>

                  <button type="button" class="ce-abx__x" (click)="removeAb(oi, abi)" [attr.aria-label]="'Remove ' + ab.name" [title]="'Remove ' + ab.name">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                  </button>
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
        <div class="flex flex-col gap-1">
          <span class="pf-label flex items-center gap-2">
            @if (rhOn()) {
              <input type="checkbox" class="ce-rh" [checked]="isShown('resistancePattern')"
                     (change)="toggleShown('resistancePattern')" title="Print on the report (unticked = hidden on the PDF only)" />
            }
            Resistance pattern
          </span>
          <textarea rows="2" class="pf-input" [ngModel]="m().resistancePattern" (ngModelChange)="patch({ resistancePattern: $event })"></textarea>
        </div>
        <div class="flex flex-col gap-1">
          <span class="pf-label flex items-center gap-2">
            @if (rhOn()) {
              <input type="checkbox" class="ce-rh" [checked]="isShown('intrinsicResistance')"
                     (change)="toggleShown('intrinsicResistance')" title="Print on the report (unticked = hidden on the PDF only)" />
            }
            Intrinsic resistance
          </span>
          <textarea rows="2" class="pf-input" [ngModel]="m().intrinsicResistance" (ngModelChange)="patch({ intrinsicResistance: $event })"></textarea>
        </div>
        <div class="flex flex-col gap-1">
          <span class="pf-label flex items-center gap-2">
            @if (rhOn()) {
              <input type="checkbox" class="ce-rh" [checked]="isShown('clinicalNotes')"
                     (change)="toggleShown('clinicalNotes')" title="Print on the report (unticked = hidden on the PDF only)" />
            }
            Clinical notes
          </span>
          <textarea rows="2" class="pf-input" [ngModel]="m().clinicalNotes" (ngModelChange)="patch({ clinicalNotes: $event })"></textarea>
        </div>
        <div class="flex flex-col gap-1">
          <span class="pf-label flex items-center gap-2">
            @if (rhOn()) {
              <input type="checkbox" class="ce-rh" [checked]="isShown('infectionControlAdvice')"
                     (change)="toggleShown('infectionControlAdvice')" title="Print on the report (unticked = hidden on the PDF only)" />
            }
            Infection control advice
          </span>
          <textarea rows="2" class="pf-input" [ngModel]="m().infectionControlAdvice" (ngModelChange)="patch({ infectionControlAdvice: $event })"></textarea>
        </div>
      </div>

      @if (measureOrg() !== null) {
        <pf-plate-measure
          [antibiotics]="activeAbNames()"
          [existingImageUrl]="activePlateUrl()"
          [existingSession]="activeSession()"
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

    /* ── Antibiotic table: one drug per row ── */
    .ce-abx { display: flex; flex-direction: column; gap: 5px; }
    .ce-abx__head, .ce-abx__row {
      display: grid; grid-template-columns: minmax(170px, 1fr) 84px 88px 84px 140px 168px 24px;
      gap: 10px; align-items: center;
    }
    .ce-abx__head { padding: 2px 12px 0; font-size: 10.5px; font-weight: 700; letter-spacing: .07em;
      text-transform: uppercase; color: var(--text-tertiary, #64748b); }
    .ce-abx__head .ce-abx__col--s, .ce-abx__head .ce-abx__col--i, .ce-abx__head .ce-abx__col--r { text-align: center; }
    .ce-abx__col--s { color: #34d399; }
    .ce-abx__col--i { color: #fbbf24; }
    .ce-abx__col--r { color: #f87171; }
    .ce-abx__row { padding: 6px 12px; border-radius: 12px;
      border: 1px solid var(--border-subtle); background: var(--glass-bg);
      transition: border-color .15s ease, background .2s ease; }
    .ce-abx__row:hover { border-color: rgba(139,92,246,.45); }
    .ce-abx__row[data-interp="S"] { background: rgba(16,185,129,.06); }
    .ce-abx__row[data-interp="I"] { background: rgba(245,158,11,.06); }
    .ce-abx__row[data-interp="R"] { background: rgba(239,68,68,.07); }
    .ce-abx__namewrap { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    /* Checkbox sits INLINE with the drug name (owner: "checkbox value", never stacked). */
    .ce-abx__nameline { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
    .ce-abx__name { font-size: 13.5px; font-weight: 600; color: var(--text-primary);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ce-abx__mic { font-size: 10.5px; color: var(--text-tertiary, #64748b); font-variant-numeric: tabular-nums;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ce-abx__mic em { font-style: normal; font-weight: 600; }

    /* Wide: boxed editable cutoffs + the I window, centered per column. */
    .ce-abx__bpwide { text-align: center; }
    .ce-abx__bpbox { width: 64px; height: 36px; text-align: center; font-size: 13.5px; font-weight: 700;
      border-radius: 9px; background: var(--input-bg); border: 1px solid var(--input-border);
      color: inherit; outline: none; font-variant-numeric: tabular-nums;
      -moz-appearance: textfield; appearance: textfield; }
    .ce-abx__bpbox::-webkit-inner-spin-button, .ce-abx__bpbox::-webkit-outer-spin-button { display: none; }
    .ce-abx__bpbox:focus { border-color: var(--input-border-focus); }
    .ce-abx__bpbox::placeholder { color: var(--text-tertiary, #64748b); font-weight: 400; }
    .ce-abx__bpbox--i { width: 76px; font-size: 12.5px; }
    .ce-abx__iwin { font-size: 12.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .ce-abx__sirbtns { display: inline-flex; align-items: center; gap: 4px; }
    .ce-abx__sirbtn { width: 36px; height: 34px; border-radius: 9px; border: 1px solid var(--border-subtle);
      font-size: 12.5px; font-weight: 700; cursor: pointer;
      transition: transform .12s cubic-bezier(0.16,1,0.3,1), background .15s ease, border-color .15s ease; }
    .ce-abx__sirbtn:active { transform: scale(0.92); }
    .ce-abx__auto { font-size: 9.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
      color: var(--text-tertiary, #64748b); }

    /* Clubbed cells exist only on small screens. */
    .ce-abx__cell { display: none; align-items: center; justify-content: center; gap: 3px;
      height: 44px; border-radius: 10px; border: 1px solid var(--border-subtle); cursor: pointer;
      background: transparent; user-select: none;
      transition: background .15s ease, border-color .15s ease, transform .12s cubic-bezier(0.16,1,0.3,1); }
    .ce-abx__cell:active { transform: scale(0.96); }
    .ce-abx__celllbl { font-size: 11px; font-weight: 800; }
    .ce-abx__cell--s .ce-abx__celllbl { color: #34d399; }
    .ce-abx__cell--i .ce-abx__celllbl { color: #fbbf24; }
    .ce-abx__cell--r .ce-abx__celllbl { color: #f87171; }
    .ce-abx__cellunit { font-size: 10px; font-weight: 600; color: var(--text-tertiary, #64748b); }
    .ce-abx__cell--s.ce-abx__cell--on { background: #10b981; border-color: #10b981; }
    .ce-abx__cell--i.ce-abx__cell--on { background: #f59e0b; border-color: #f59e0b; }
    .ce-abx__cell--r.ce-abx__cell--on { background: #ef4444; border-color: #ef4444; }
    .ce-abx__cell--on .ce-abx__celllbl, .ce-abx__cell--on .ce-abx__cellunit,
    .ce-abx__cell--on .ce-abx__iwin, .ce-abx__cell--on .ce-abx__bpin { color: #fff; }
    .ce-abx__cell--on .ce-abx__bpin::placeholder { color: rgba(255,255,255,.7); }
    .ce-abx__bpin { width: 32px; text-align: center; font-size: 13px; font-weight: 700;
      background: transparent; border: none; outline: none; color: var(--text-primary);
      font-variant-numeric: tabular-nums; -moz-appearance: textfield; appearance: textfield; padding: 0; }
    .ce-abx__bpin::-webkit-inner-spin-button, .ce-abx__bpin::-webkit-outer-spin-button { display: none; }
    .ce-abx__bpin:focus { box-shadow: inset 0 -2px 0 var(--input-border-focus, #8b5cf6); }
    .ce-abx__bpin::placeholder { color: var(--text-tertiary, #64748b); font-weight: 400; }
    .ce-abx__bpin--i { width: 52px; font-size: 12px; }

    .ce-abx__zonewrap { display: inline-flex; align-items: center; gap: 5px; }
    .ce-abx__mode { display: inline-flex; border: 1px solid var(--border-subtle); border-radius: 8px; overflow: hidden; }
    .ce-abx__mode button { padding: 4px 8px; font-size: 10px; font-weight: 700; letter-spacing: .04em;
      text-transform: uppercase; color: var(--text-tertiary); background: transparent; border: none; cursor: pointer; }
    .ce-abx__mode--on { color: var(--violet-text, #a78bfa) !important; background: rgba(124,58,237,.16) !important; }
    .ce-org__modetgl { flex-shrink: 0; }
    .ce-org__modetgl button { padding: 6px 11px; font-size: 10.5px; }
    /* Read-only review: same view, nothing editable. */
    .ce--ro input, .ce--ro textarea, .ce--ro button, .ce--ro pf-select, .ce--ro pf-touch-btn { pointer-events: none; }
    /* Report-row checkboxes stay live even in readonly review — hiding a row
       from the PDF is a review action, not a result edit. */
    .ce--ro .ce-rh { pointer-events: auto; }
    .ce-rh { width: 15px; height: 15px; accent-color: #8b5cf6; flex-shrink: 0; cursor: pointer; }
    .ce--ro .ce-abx__addrow, .ce--ro .ce-abx__x, .ce--ro .ce-org__measure, .ce--ro pf-touch-btn { display: none; }
    .ce-modebar { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-bottom: 4px; }
    .ce-modebar__lbl { font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase;
      color: var(--text-tertiary, #64748b); }
    .ce-abx__zone { width: 74px; height: 38px; text-align: center; font-size: 15px; font-weight: 600;
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
    .ce-abx__addrow { padding: 2px 0 0; }
    .ce-abx__addrow ::ng-deep .pf-dd__trigger { width: 100%; height: 46px; border-style: dashed;
      background: transparent; color: var(--violet-text, #a78bfa); font-weight: 600; justify-content: center; }
    .ce-abx__addrow ::ng-deep .pf-dd__trigger .pf-dd__value { flex: none; }

    /* Small screens: hide the separated columns, show the clubbed cells. */
    @media (max-width: 1080px) {
      .ce-abx__head { display: none; }
      .ce-abx__row { display: flex; flex-wrap: wrap; gap: 8px 10px; }
      .ce-abx__bpwide, .ce-abx__sirbtns { display: none; }
      .ce-abx__cell { display: inline-flex; flex: 1 1 30%; min-width: 104px; }
      .ce-abx__name { flex-basis: 100%; }
      .ce-abx__zonewrap { order: 4; }
      .ce-abx__x { order: 5; }
    }

    /* ── Phone (additive; desktop untouched) ── */
    @media (pointer: coarse) {
      :host .ce-abx__cell, :host .ce-abx__zone, :host .ce-abx__sirbtn { min-height: 44px; }
    }

    /* ══ Kit restyle (both themes; colour-independent) ══ */
    :host { font-family: inherit; }
    .ce-modebar__lbl { font-size: 13px; font-weight: 400; letter-spacing: 0; text-transform: none; color: var(--text-tertiary); }
    .ce-modeseg .nd-seg__item { height: 32px; font-size: 13px; }
    .ce-abx__head { font-size: 12px; font-weight: 500; letter-spacing: 0; text-transform: none; }
    .ce-abx__auto { font-size: 11px; font-weight: 500; letter-spacing: 0; text-transform: none; }
    .ce-sirseg { gap: 2px; }
    .ce-abx__sirbtn { width: 36px; height: 32px; border: 0; border-radius: 8px; padding: 0;
      font: inherit; font-size: 13px; font-weight: 600; color: var(--text-secondary); background: transparent; }
    /* Dark keeps its traffic-light verdict (owner: dark is fine). */
    .ce-sir-picked[data-v='S'] { background: #10b981; color: #fff; }
    .ce-sir-picked[data-v='I'] { background: #f59e0b; color: #fff; }
    .ce-sir-picked[data-v='R'] { background: #ef4444; color: #fff; }
    .ce-abx__zone { font-family: inherit; border-radius: var(--nd-radius-sm, 10px);
      background: var(--nd-card-bg, var(--input-bg)); border: 1px solid var(--nd-line, var(--input-border)); color: var(--text-primary); }
    .ce-abx__zone:focus { border-color: var(--color-violet-600, #7c3aed);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent); }
    .ce-abx__bpbox { font-family: inherit; border-radius: var(--nd-radius-chip, 8px); }
    .ce-abx__unit { font-weight: 500; }
    .ce-abx__x { width: 32px; height: 32px; border-radius: var(--nd-radius-sm, 10px); display: inline-flex;
      align-items: center; justify-content: center; color: var(--text-tertiary); }
    .ce-abx__x:hover { color: var(--text-primary); background: var(--nd-chip-bg); }
    @media (pointer: coarse) { .ce-abx__x { width: 44px; height: 44px; } }

    /* ══ LIGHT mode: no traffic lights (owner: eye strain). Neutral headers,
       neutral breakpoint chips, muted MIC line, neutral S/I/R selection —
       a small red dot on a selected R is the only colour left. ══ */
    :host-context(.light) .ce-abx__col--s,
    :host-context(.light) .ce-abx__col--i,
    :host-context(.light) .ce-abx__col--r { color: var(--text-tertiary); }
    :host-context(.light) .ce-abx__bpwide .ce-abx__bpbox { color: var(--text-primary);
      background: var(--nd-chip-bg); border-color: transparent; }
    :host-context(.light) .ce-abx__mic,
    :host-context(.light) .ce-abx__mic em { color: var(--text-tertiary); font-weight: 400; }
    :host-context(.light) .ce-abx__row[data-interp] { background: var(--nd-card-bg, #fff); }
    :host-context(.light) .ce-abx__row:hover { border-color: var(--nd-sel-border); }
    :host-context(.light) .ce-sir-picked[data-v] {
      background: var(--nd-card-bg, #fff); color: var(--text-primary); box-shadow: 0 1px 2px rgba(15, 23, 42, 0.18); }
    :host-context(.light) .ce-sir-picked[data-v='R'] { position: relative; }
    :host-context(.light) .ce-sir-picked[data-v='R']::after {
      content: ''; position: absolute; top: 5px; right: 5px; width: 5px; height: 5px; border-radius: 999px; background: #dc2626; }
    :host-context(.light) .ce-abx__celllbl,
    :host-context(.light) .ce-abx__cell--s .ce-abx__celllbl,
    :host-context(.light) .ce-abx__cell--i .ce-abx__celllbl,
    :host-context(.light) .ce-abx__cell--r .ce-abx__celllbl { color: var(--text-tertiary); }
    :host-context(.light) .ce-abx__cell--on,
    :host-context(.light) .ce-abx__cell--s.ce-abx__cell--on,
    :host-context(.light) .ce-abx__cell--i.ce-abx__cell--on,
    :host-context(.light) .ce-abx__cell--r.ce-abx__cell--on { background: var(--nd-sel-bg); border-color: var(--nd-sel-border); }
    :host-context(.light) .ce-abx__cell--on .ce-abx__celllbl,
    :host-context(.light) .ce-abx__cell--on .ce-abx__cellunit,
    :host-context(.light) .ce-abx__cell--on .ce-abx__bpin { color: var(--text-primary); }
    :host-context(.light) .ce-abx__cell--r.ce-abx__cell--on { position: relative; }
    :host-context(.light) .ce-abx__cell--r.ce-abx__cell--on::after {
      content: ''; position: absolute; top: 6px; right: 6px; width: 5px; height: 5px; border-radius: 999px; background: #dc2626; }
    :host-context(.light) .ce-org__prog--done { color: var(--violet-text, #6d28d9); border-color: var(--nd-sel-border); }
`]
})
export class CultureEntryComponent implements OnInit {
  /** Optional master-driven organism list (from /api/microbiology/organisms).
   *  Falls back to the built-in common isolates when not supplied. */
  @Input() organismNames: string[] | null = null;
  /** Workbench mode: specimen/gram/colony live in their own stages, and the
   *  organisms come from the Identification stage (read-only labels here). */
  @Input() embedded = false;
  /** Review mode (validation screen): the exact bench view, nothing editable. */
  @Input() readonly = false;
  /** Report-row visibility (PDF-only hiding; bench data untouched). Keys the
   *  parent has hidden — null = feature OFF (no checkboxes rendered). The
   *  parent owns persistence (culture case report-hidden endpoint). */
  @Input() reportHidden: string[] | null = null;
  @Output() reportHiddenChange = new EventEmitter<string[]>();
  rhOn(): boolean { return this.reportHidden !== null; }
  isShown(key: string): boolean { return !(this.reportHidden ?? []).includes(key); }
  toggleShown(key: string) {
    const cur = this.reportHidden ?? [];
    this.reportHiddenChange.emit(cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key]);
  }
  get organisms(): string[] { return this.organismNames?.length ? this.organismNames : COMMON_ORGANISMS; }
  private readonly api = inject(ApiService);
  private readonly platform = inject(PlatformService);
  private readonly el = inject(ElementRef<HTMLElement>);

  // Camera measure-assist: index of the organism whose plate is being measured.
  readonly measureOrg = signal<number | null>(null);

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
   * RECONCILES the sensitivity cards with the identification: newly
   * identified organisms are appended with their CLSI panels, and organisms
   * REMOVED from the identification disappear here too — unless the tech
   * already entered data on them (zones, verdicts, or a plate photo), which
   * is never silently discarded. Bypasses the userEdited guard on purpose:
   * an identification change AFTER the tech started on AST must still land.
   */
  @Input() set seedOrganisms(names: string[] | null | undefined) {
    const wanted = (names ?? []).map(n => n.trim()).filter(Boolean);
    if (!wanted.length) return;                     // cleared upstream → rows stay (remove via ×)
    const cur = this._m();
    const old = cur.organisms ?? [];
    const wantedSet = new Set(wanted.map(n => n.toLowerCase()));

    // Drop un-identified organisms with nothing entered; keep touched ones.
    const keptWithIndex = old
      .map((o, oi) => ({ o, oi }))
      .filter(({ o }) => wantedSet.has(o.name.trim().toLowerCase())
        || o.antibiotics.some(a => a.zoneSize != null || a.interpretation)
        || !!o.plateImageUrl);

    const have = new Set(keptWithIndex.map(({ o }) => o.name.trim().toLowerCase()));
    const missing = wanted.filter(n => !have.has(n.toLowerCase()));
    if (keptWithIndex.length === old.length && !missing.length) return;

    // Re-index the manual S/I/R flags to the surviving organisms' positions.
    const indexMap = new Map<number, number>();
    keptWithIndex.forEach(({ oi }, ni) => indexMap.set(oi, ni));
    const remapped = new Set<string>();
    for (const key of this.manual) {
      const [oi, abi] = key.split(':');
      const ni = indexMap.get(Number(oi));
      if (ni != null) remapped.add(`${ni}:${abi}`);
    }
    this.manual.clear();
    for (const k of remapped) this.manual.add(k);

    const organisms = [...keptWithIndex.map(({ o }) => o), ...missing.map(name => ({
      name, antibiotics: this.clsiRows(name),
    }))];
    const next: CultureResult = { ...cur, noGrowth: false, organisms };
    this._m.set(next);
    this.valueChange.emit(next);
    this.organismsOpen.set(organisms.length > 0);
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
        // Keep ALL rows (incl. disabled + organism-pinned) — effective rows
        // are resolved PER ORGANISM: a row pinned to the isolate outranks its
        // group row, and only then does the enabled filter apply.
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
      organisms: (v?.organisms ?? []).map(o => ({
        name: o.name, antibiotics: [...(o.antibiotics ?? [])],
        plateImageUrl: o.plateImageUrl ?? null, plateMeasure: o.plateMeasure ?? null,
      }))
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
    // Per-antibiotic: the organism-pinned row (if any) decides; disabled
    // rows drop the drug from THIS organism's panel only.
    const names = new Set<string>();
    for (const b of this.bpList)
      if (b.organismGroup.toLowerCase() === group.toLowerCase()) names.add(b.antibiotic);
    return [...names]
      .filter(n => this.effectiveRow(orgName, n) !== undefined)
      .sort((a, b) => a.localeCompare(b));
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
    let interp: 'S' | 'I' | 'R' | '' = '';
    if (this.mode() === 'mic') {
      // MIC: S when value ≤ the S threshold, R when ≥ the R threshold.
      const b = this.effectiveRow(name, ab.name);
      const v = this.num(ab.micValue);
      const s = this.num(ab.micS ?? b?.micS), r = this.num(ab.micR ?? b?.micR);
      if (v == null || (s == null && r == null)) return;
      if (s != null && v <= s) interp = 'S';
      else if (r != null && v >= r) interp = 'R';
      else if (s != null && r != null) interp = 'I';
      else return;
    } else {
      const bp = this.effBp(name, ab);
      if (!bp || ab.zoneSize == null) return;
      interp = ab.zoneSize >= bp.s ? 'S' : ab.zoneSize <= bp.r ? 'R' : 'I';
    }
    if (interp && interp !== ab.interpretation) this.setAb(i, abi, { interpretation: interp });
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
  /** The I window as an editable value ('' when unknown). */
  effIVal(orgName: string | undefined, ab: AstRow): string {
    const v = this.effI(orgName, ab);
    return v === '—' ? '' : v;
  }
  /** Typing the I window ("14–16", "14-16", or a single number) sets the
   *  cutoffs around it: R ≤ low−1, S ≥ high+1. Clearing it reverts the row
   *  to the seeded CLSI values. */
  setBpI(i: number, abi: number, raw: string) {
    const t = (raw ?? '').trim();
    if (!t) { this.setAb(i, abi, { sMin: null, rMax: null }); this.autoInterpret(i, abi); return; }
    const m = t.match(/^(\d+)\s*[-–—]\s*(\d+)$/) ?? t.match(/^(\d+)$/);
    if (!m) return;
    const lo = parseInt(m[1], 10);
    const hi = m[2] != null ? parseInt(m[2], 10) : lo;
    const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
    this.setAb(i, abi, { rMax: a - 1, sMin: b + 1 });
    this.autoInterpret(i, abi);
  }
  setBpS(i: number, abi: number, v: number | null) { this.setAb(i, abi, { sMin: v }); this.autoInterpret(i, abi); }
  setBpR(i: number, abi: number, v: number | null) { this.setAb(i, abi, { rMax: v }); this.autoInterpret(i, abi); }
  /** Effective MIC cutoff for a ROW: its own edits win over the CLSI table. */
  effMic(orgName: string | undefined, ab: AstRow, key: 'micS' | 'micI' | 'micR'): string {
    return ab[key] ?? this.effectiveRow(orgName, ab.name)?.[key] ?? '';
  }
  setMicBp(i: number, abi: number, key: 'micS' | 'micI' | 'micR', raw: string | null) {
    const t = (raw ?? '').trim();
    this.setAb(i, abi, { [key]: t || null });
    this.autoInterpret(i, abi);
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

  /** The row effective for THIS organism × drug: organism-pinned beats the
   *  group row; disabled rows yield nothing. */
  private effectiveRow(orgName?: string, abName?: string): Breakpoint | undefined {
    const group = this.organismGroup(orgName);
    if (!group || !abName) return undefined;
    const g = group.toLowerCase(), a = abName.toLowerCase(), n = (orgName ?? '').trim().toLowerCase();
    let best: Breakpoint | undefined;
    for (const b of this.bpList) {
      if (b.organismGroup.toLowerCase() !== g || b.antibiotic.toLowerCase() !== a) continue;
      if (b.organism && b.organism.toLowerCase() !== n) continue;
      if (!best || (!best.organism && b.organism)) best = b;
    }
    return best?.enabled === false ? undefined : best;
  }
  /** Does this row carry MIC breakpoints at all? (drives the Zone/MIC toggle) */
  hasMic(orgName: string | undefined, ab: AstRow): boolean {
    const b = this.effectiveRow(orgName, ab.name);
    return !!b && (!!b.micS || !!b.micR);
  }
  /** The UNIVERSAL entry mode — one toggle at the top governs everything. */
  mode(): 'zone' | 'mic' {
    return this._m().astMode === 'mic' ? 'mic' : 'zone';
  }
  setMode(mode: 'zone' | 'mic') {
    this.patch({ astMode: mode });
    (this._m().organisms ?? []).forEach((o, oi) =>
      o.antibiotics.forEach((_, abi) => this.autoInterpret(oi, abi)));
  }
  /** MIC criteria line: in MIC mode wherever criteria exist; in zone mode
   *  only on rows with no zone cutoffs (explains the empty mm boxes). */
  micRef(orgName: string | undefined, ab: AstRow): { s: string; i: string; r: string } | null {
    const b = this.effectiveRow(orgName, ab.name);
    if (!b || (!b.micS && !b.micR)) return null;
    const show = this.mode() === 'zone'
      && b.susceptibleMin == null && ab.sMin == null && ab.rMax == null;
    if (!show) return null;
    return { s: b.micS || '—', i: b.micI || '—', r: b.micR || '—' };
  }
  /** First numeric in a breakpoint/measured string ("≤ 0.25", "8/4" → 0.25, 8). */
  private num(v?: string | number | null): number | null {
    if (v == null || v === '') return null;
    const m = String(v).match(/\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }
  setMic(i: number, abi: number, v: string | null) {
    this.setAb(i, abi, { micValue: v });
    this.autoInterpret(i, abi);
  }
  private bpFor(orgName?: string, abName?: string): { s: number; r: number } | undefined {
    const b = this.effectiveRow(orgName, abName);
    return b && b.susceptibleMin != null && b.resistantMax != null
      ? { s: b.susceptibleMin, r: b.resistantMax } : undefined;
  }

  /** Resolve an organism onto a CLSI breakpoint group: the master's Group
   *  column first (the real taxonomy), the name itself as fallback. */
  private organismGroup(name?: string): string | null {
    const o = (name ?? '').trim().toLowerCase();
    if (!o) return null;
    // Name-level splits outrank the master's genus group: Salmonella lives
    // under Enterobacterales, and both Neisseria share one group.
    if (o.includes('salmonella') || o.includes('shigella')) return 'Salmonella & Shigella';
    if (o.includes('gonorrhoeae')) return 'Neisseria gonorrhoeae';
    if (o.includes('meningitidis')) return 'Neisseria meningitidis';
    return this.normalizeGroup(this.orgGroups.get(o)) ?? this.normalizeGroup(o);
  }
  /** Map a group label or organism name onto one of the breakpoint table's
   *  groups — Ed36 taxonomy: name-level splits first (Salmonella/Shigella and
   *  the two Neisseria live under shared genus groups in the master), then an
   *  exact group match, then family aliases and catch-alls. */
  private normalizeGroup(g?: string | null): string | null {
    const s = (g ?? '').trim().toLowerCase();
    if (!s) return null;
    if (s.includes('salmonella') || s.includes('shigella')) return 'Salmonella & Shigella';
    if (s.includes('gonorrhoeae')) return 'Neisseria gonorrhoeae';
    if (s.includes('meningitidis')) return 'Neisseria meningitidis';
    for (const b of new Set(this.bpList.map(x => x.organismGroup)))
      if (b.toLowerCase() === s) return b;
    if (s.includes('pneumococc')) return 'Pneumococcus';
    if (s.includes('group a strep') || s.includes('group b strep') || s.includes('hemolytic strep') || s.includes('β-hemolytic'))
      return 'β-Hemolytic Streptococcus';
    if (s.includes('viridans') || s.includes('anginosus') || s.includes('nutritionally variant'))
      return 'Viridans Group Streptococci';
    if (s.includes('coagulase-negative')) return 'Coagulase-Negative Staphylococci';
    if (s.includes('staphylococc') || s.includes('mrsa') || s.includes('mssa')) return 'Staphylococcus';
    if (s.includes('enterococc')) return 'Enterococcus';
    if (s.includes('pseudomon')) return 'Pseudomonas';
    if (s.includes('acinetobacter')) return 'Acinetobacter';
    if (s.includes('stenotrophomonas') || s.includes('maltophilia')) return 'Stenotrophomonas';
    if (s.includes('haemophilus')) return 'Haemophilus';
    for (const k of ['bacteroides', 'prevotella', 'porphyromonas', 'fusobacterium', 'clostridi',
      'cutibacterium', 'veillonella', 'anaerob', 'actinomyces', 'lactobacillus'])
      if (s.includes(k)) return 'Anaerobes';
    for (const k of ['achromobacter', 'aeromonas', 'burkholderia', 'comamonas', 'delftia',
      'elizabethkingia', 'chryseobacterium', 'moraxella', 'ochrobactrum', 'pasteurella',
      'ralstonia', 'shewanella', 'sphingomonas', 'vibrio', 'non-fermenter', 'gram-negative bacilli'])
      if (s.includes(k)) return 'Other Non-Enterobacterales';
    for (const k of ['enterobacterales', 'escherichia', 'e.coli', 'e. coli', 'klebsiella', 'proteus',
      'enterobacter', 'citrobacter', 'serratia', 'morganella', 'providencia', 'coliform'])
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
  /** The saved measure session of the organism being measured — reopening
   *  restores every ring instead of starting from a blank plate. */
  activeSession(): PlateMeasureSession | null {
    const i = this.measureOrg();
    return i == null ? null : this._m().organisms?.[i]?.plateMeasure ?? null;
  }

  /** Apply measured zones: each drops into its antibiotic row via setZone, which
   *  fires the CLSI auto-interpretation. The plate photo is kept on the organism. */
  onMeasured(e: { measurements: PlateMeasurement[]; imageUrl: string | null; session: PlateMeasureSession }) {
    const i = this.measureOrg();
    if (i == null) return;
    for (const meas of e.measurements) this.setZone(i, meas.index, meas.zoneMm);
    // Keep the photo AND the fitted rings — Measure reopens exactly here.
    this.updateOrg(i, o => ({ ...o, plateImageUrl: e.imageUrl, plateMeasure: e.session }));
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
