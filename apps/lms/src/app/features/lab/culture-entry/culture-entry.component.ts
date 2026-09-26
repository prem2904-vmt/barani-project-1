import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { PlatformService } from '../../../core/services/platform.service';
import { AstRow, CultureOrganism, CultureResult, COMMON_ORGANISMS, PlateMeasurement, PlateMeasureSession, panelForSpecimen } from '../../../shared/models/culture.model';
import { LiveDisk, PlateMeasureComponent } from './plate-measure.component';
import { DiskCandidate, MasterAntibiotic, baseDrug, drugForCode, masterCandidates, panelCandidates } from './disk-codes';
import { AuthService } from '../../../core/auth/auth.service';
import { PlateReading, parsePlate, plateJsonFromCase, readingFromMeasure } from './plate-reading';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { LogoMarkComponent } from '../../../shared/primitives/logo-mark.component';

interface Breakpoint {
  organismGroup: string; antibiotic: string;
  susceptibleMin: number | null; resistantMax: number | null;
  shortLabel?: string | null; diskLabel?: string | null; enabled?: boolean; organism?: string | null;
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
  imports: [FormsModule, PlateMeasureComponent, TouchButtonComponent, SelectComponent, LogoMarkComponent],
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
        @if (plateOn()) {
          <!-- The PLATE, measured BEFORE the organism (SME flow): OpenCV
               measures every zone, PF Sense reads the codes against the whole
               antibiotic master; held on the case until the organism is known. -->
          <section class="ce-plate" aria-label="Plate">
            <div class="ce-plate__head">
              <span class="ce-plate__ttl">Plate</span>
              @if (plate(); as p) {
                <span class="ce-plate__meta nd-num">{{ p.disks.length }} {{ p.disks.length === 1 ? 'antibiotic' : 'antibiotics' }} measured</span>
              }
              <span class="ce-plate__grow"></span>
              <button type="button" class="nd-btn nd-btn--secondary ce-plate__btn" (click)="openPlateMeasure()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h4l2-3h4l2 3h4v11H4V7z"/><path d="M12 11a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>
                {{ plate() ? 'Re-measure plate' : 'Measure plate' }}
              </button>
            </div>
            @if (plate(); as p) {
              <ul class="ce-plate__chips" aria-label="Antibiotics on the plate">
                @for (d of p.disks; track d.drug) {
                  <li class="nd-chip nd-chip--static ce-plate__chip" [title]="d.drug"><span class="nd-num">{{ d.code || d.drug }}</span><span class="ce-plate__mm nd-num">{{ d.mm }} mm</span></li>
                }
              </ul>
              <div class="ce-plate__assign">
                <span class="ce-plate__assignlbl" id="ce-plate-org">{{ plateOrgName() ? 'Organism' : 'Assign organism' }}</span>
                <pf-select class="ce-plate__orgsel" size="sm" [options]="organismOptions()" [searchable]="true"
                           [value]="plateOrgName() ?? ''" placeholder="Pick the organism…"
                           aria-labelledby="ce-plate-org" (valueChange)="assignOrganism($any($event))"></pf-select>
              </div>
              <p class="ce-plate__note">
                {{ plateOrgName() ? 'CLSI for ' + plateOrgName() + ': the plate’s antibiotics are ticked with S / I / R; the rest of its panel is listed unticked.'
                   : 'Assign the organism — CLSI breakpoints are applied and S / I / R is worked out.' }}
              </p>
            } @else {
              <p class="ce-plate__note">Measure the AST plate now, before the organism is known. PF Sense reads each disk against the whole antibiotic list; the table fills in once the organism is identified.</p>
            }
            @if (plateError()) { <p class="ce-plate__err" role="alert">{{ plateError() }}</p> }
          </section>
        }
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
                    @if (noBreakpoint(org, ab)) {
                      <span class="ce-abx__nobp">No CLSI breakpoint for {{ org.name }} — enter S ≥ and R ≤</span>
                    } @else if (manualBreakpoint(org, ab)) {
                      <span class="ce-abx__nobp ce-abx__manbp">
                        Breakpoint entered manually
                        @if (bpSavedFor(org, ab)) {
                          · saved to CLSI for {{ org.name }}
                        } @else if (canSaveBreakpoints()) {
                          <label class="ce-abx__savebp">
                            <input type="checkbox" [checked]="false" [disabled]="ab.sMin == null || ab.rMax == null || !!bpSaving()"
                                   (change)="saveBreakpointToMaster(oi, abi)" />
                            Save to CLSI for {{ org.name }}
                          </label>
                        } @else {
                          · kept on this case
                        }
                      </span>
                    }
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
                        [class.ce-sir--s]="ab.interpretation === v && v === 'S'"
                        [class.ce-sir--i]="ab.interpretation === v && v === 'I'"
                        [class.ce-sir--r]="ab.interpretation === v && v === 'R'"
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

      @if (measuringPlate()) {
        <pf-plate-measure
          [antibiotics]="abxNames()"
          [candidateList]="masterCands()"
          [existingImageUrl]="plate()?.imageUrl"
          [existingSession]="plate()?.session"
          [orderTestId]="orderTestId"
          [srI]="plateSrI"
          (applied)="onPlateMeasured($event)"
          (cancel)="measuringPlate.set(false)" />
      }
      @if (orgMeasureOpen() && orgMeasureReady()) {
        <!-- The culture case's MAIN path (Identification header → Measure):
             plate → PF Sense codes → pick the organism INSIDE the measure →
             its CLSI panel with live S / I / R → OK fills the AST table. -->
        <pf-plate-measure
          [antibiotics]="abxNames()"
          [candidateList]="masterCands()"
          [existingImageUrl]="orgMeasureStart()?.imageUrl"
          [existingSession]="orgMeasureStart()?.session"
          [orderTestId]="orderTestId"
          [srI]="orgSrI"
          [reviewTpl]="orgPanelTpl"
          reviewStepLabel="Organism"
          applyLabel="OK"
          [applyBlocked]="!orgMeasureCanApply()"
          [phoneFull]="true"
          (applied)="onOrganismMeasured($event)"
          (cancel)="closeOrgMeasure()" />
      }
      <ng-template #orgPanelTpl let-disks>
        <div class="ce-mo">
          <div class="ce-mo__pick">
            <span class="ce-mo__lbl" id="ce-mo-org">Organism</span>
            <pf-select class="ce-mo__sel" size="sm" [options]="organismOptions()" [searchable]="true"
                       [value]="mOrg()" placeholder="Pick the organism…"
                       aria-labelledby="ce-mo-org" (valueChange)="setMeasureOrg($any($event))"></pf-select>
            <!-- Phones: the picker is a sheet (search + 44px rows). -->
            <button type="button" class="ce-mo__trigger" (click)="openOrgSheet()" aria-haspopup="dialog"
                    [attr.aria-label]="mOrg() ? 'Organism: ' + mOrg() + ' — change' : 'Pick the organism'">
              <span class="ce-mo__trigtxt" [class.ce-mo__trigtxt--ph]="!mOrg()">{{ mOrg() || 'Pick the organism…' }}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
            </button>
          </div>
          @if (!mOrg()) {
            <p class="ce-mo__note">Pick the organism — its CLSI panel is applied and S / I / R is worked out for each measured zone.</p>
          } @else {
            @let rows = previewRows(disks);
            <p class="ce-mo__note">CLSI for {{ mOrg() }}: the plate’s antibiotics are ticked with S / I / R; the rest of its panel is listed unticked.</p>
            @if (overwriteTarget(); as ow) {
              <label class="ce-mo__warn">
                <input type="checkbox" class="ce-mo-chk ce-mo__warnbox" [checked]="mReplace()" (change)="mReplace.set($any($event.target).checked)" />
                <span>{{ ow }} already has sensitivity results. Replace them with this plate.</span>
              </label>
            }
            <ul class="ce-mo__rows" aria-label="CLSI panel">
              @for (r of rows; track r.name) {
                <li class="ce-mo__row" [class.ce-mo__row--off]="!r.ticked" [attr.data-sir]="r.sir || null">
                  <span class="ce-mo__tick" [class.ce-mo__tick--on]="r.ticked" role="img"
                        [attr.aria-label]="r.ticked ? 'On the report' : 'Not reported'">
                    @if (r.ticked) {
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                    }
                  </span>
                  <span class="ce-mo__namewrap">
                    <span class="ce-mo__name">{{ r.name }}</span>
                    @if (r.needsBp) {
                      <span class="ce-mo__bp">
                        <span class="ce-mo__bpnote">No CLSI breakpoint for {{ mOrg() }} — enter S ≥ and R ≤</span>
                        <label class="ce-mo__bpf">S ≥
                          <input type="text" inputmode="numeric" class="ce-mo__bpin nd-num" [value]="r.s ?? ''"
                                 [attr.aria-label]="r.name + ' susceptible at or above (mm)'"
                                 (change)="setMeasureBp(r.name, 's', $any($event.target).value)" /></label>
                        <label class="ce-mo__bpf">R ≤
                          <input type="text" inputmode="numeric" class="ce-mo__bpin nd-num" [value]="r.r ?? ''"
                                 [attr.aria-label]="r.name + ' resistant at or below (mm)'"
                                 (change)="setMeasureBp(r.name, 'r', $any($event.target).value)" /></label>
                        @if (canSaveBreakpoints()) {
                          <label class="ce-mo__save">
                            <input type="checkbox" class="ce-mo-chk" [checked]="mSave().has(r.name)" [disabled]="r.s == null || r.r == null"
                                   (change)="toggleMeasureSave(r.name)" />
                            Save to CLSI for {{ mOrg() }}
                          </label>
                        }
                      </span>
                    }
                  </span>
                  <span class="ce-mo__mm nd-num">{{ r.mm != null ? r.mm + ' mm' : '—' }}</span>
                  <span class="ce-mo__sir" [class.ce-sir-picked]="!!r.sir"
                        [class.ce-sir--s]="r.sir === 'S'" [class.ce-sir--i]="r.sir === 'I'" [class.ce-sir--r]="r.sir === 'R'"
                        [attr.aria-label]="r.sir ? 'Result ' + r.sir : 'No result'">{{ r.sir || '–' }}</span>
                </li>
              } @empty {
                <li class="ce-mo__empty">No coded disks yet — go back and pick each disk’s code.</li>
              }
            </ul>
          }
        </div>
        @if (orgSheet()) {
          <div class="ce-mo-sheetbd" (click)="orgSheet.set(false)" aria-hidden="true"></div>
          <!-- pf-modal-centered: opts out of the global phone dialog→sheet rules (this IS the sheet). -->
          <div class="ce-mo-sheet pf-modal-centered" role="dialog" aria-modal="true" aria-label="Pick the organism">
            <span class="ce-mo-sheet__handle" aria-hidden="true"></span>
            <div class="ce-mo-sheet__head">
              <span class="ce-mo-sheet__ttl">Organism</span>
              <button type="button" class="ce-mo-sheet__x" (click)="orgSheet.set(false)" aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <input type="search" class="ce-mo-sheet__q" placeholder="Search organisms" aria-label="Search organisms"
                   [value]="orgQuery()" (input)="orgQuery.set($any($event.target).value)" />
            <ul class="ce-mo-sheet__list">
              @for (o of orgSheetOptions(); track o) {
                <li><button type="button" class="ce-mo-sheet__opt" [attr.aria-pressed]="o === mOrg()" (click)="setMeasureOrg(o); orgSheet.set(false)">{{ o }}</button></li>
              } @empty {
                <li class="ce-mo__empty">No organism matches.</li>
              }
            </ul>
          </div>
        }
      </ng-template>
      @if (measureOrg() !== null) {
        <pf-plate-measure
          [antibiotics]="activeAbNames()"
          [existingImageUrl]="activePlateUrl()"
          [existingSession]="activeSession()"
          [orderTestId]="orderTestId"
          [codeHints]="activeCodeHints()"
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
    .ce-abx__row { padding: 6px 12px; border-radius: 12px;
      border: 1px solid var(--border-subtle); background: var(--glass-bg);
      transition: border-color .15s ease, background .2s ease; }
    .ce-abx__row:hover { border-color: rgba(139,92,246,.45); }
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
    .ce-abx__cellunit { font-size: 10px; font-weight: 600; color: var(--text-tertiary, #64748b); }
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

    /* ══ AST (owner, both themes): breakpoints / headers / MIC line NEUTRAL;
       the PICKED S / I / R result carries a SUBTLE colour (soft tint + dark
       text, ≥4.5:1) — unselected S / I / R stay neutral. ══ */
    .ce-abx__col--s,
    .ce-abx__col--i,
    .ce-abx__col--r { color: var(--text-tertiary); }
    .ce-abx__bpwide .ce-abx__bpbox { color: var(--text-primary);
      background: var(--nd-chip-bg); border-color: transparent; }
    .ce-abx__bpin { color: var(--text-primary); }
    .ce-abx__mic,
    .ce-abx__mic em { color: var(--text-tertiary); font-weight: 400; }
    /* Picked result tints — light: 13% tint + deep text; dark: 20% tint +
       pale text. Shared by the wide buttons and the small-screen cells. */
    .ce-sir-picked[data-v], .ce-abx__cell--on { box-shadow: none; }
    :host-context(.light) .ce-sir-picked.ce-sir--s, :host-context(.light) .ce-abx__cell--s.ce-abx__cell--on { background: rgba(16,185,129,0.13); color: #065f46; }
    :host-context(.light) .ce-sir-picked.ce-sir--i, :host-context(.light) .ce-abx__cell--i.ce-abx__cell--on { background: rgba(245,158,11,0.14); color: #92400e; }
    :host-context(.light) .ce-sir-picked.ce-sir--r, :host-context(.light) .ce-abx__cell--r.ce-abx__cell--on { background: rgba(239,68,68,0.12); color: #991b1b; }
    :host-context(.dark) .ce-sir-picked.ce-sir--s, :host-context(.dark) .ce-abx__cell--s.ce-abx__cell--on { background: rgba(16,185,129,0.20); color: #6ee7b7; }
    :host-context(.dark) .ce-sir-picked.ce-sir--i, :host-context(.dark) .ce-abx__cell--i.ce-abx__cell--on { background: rgba(245,158,11,0.20); color: #fcd34d; }
    :host-context(.dark) .ce-sir-picked.ce-sir--r, :host-context(.dark) .ce-abx__cell--r.ce-abx__cell--on { background: rgba(239,68,68,0.20); color: #fca5a5; }
    .ce-abx__celllbl,
    .ce-abx__cell--s .ce-abx__celllbl,
    .ce-abx__cell--i .ce-abx__celllbl,
    .ce-abx__cell--r .ce-abx__celllbl { color: var(--text-tertiary); }
    .ce-abx__cell--on { border-color: transparent; }
    .ce-abx__cell--on .ce-abx__celllbl,
    .ce-abx__cell--on .ce-abx__cellunit,
    .ce-abx__cell--on .ce-abx__bpin { color: inherit; }
    .ce-org__prog--done { color: var(--violet-text, #6d28d9); border-color: var(--nd-sel-border); }

    /* ══ Row surface — every antimicrobial row is its own subtle card in
       BOTH themes: 10px radius, a small gap, a slightly stronger hover. ══ */
    .ce-abx { gap: 6px; }
    .ce-abx__row { border-radius: 10px; }
    :host-context(.dark) .ce-abx__row { background: var(--glass-bg); }
    :host-context(.dark) .ce-abx__row:hover { background: rgba(255,255,255,0.07); border-color: var(--nd-line); }
    :host-context(.light) .ce-abx__row { background: #f6f7f9; border-color: transparent; }
    :host-context(.light) .ce-abx__row:hover { background: #eef0f3; border-color: transparent; }
    /* On the light row the breakpoint chips / zone field sit on white. */
    :host-context(.light) .ce-abx__bpwide .ce-abx__bpbox { background: var(--nd-card-bg, #fff); border-color: var(--nd-line); }
    /* ── The plate, measured before the organism ── */
    .ce-plate { border: 1px solid var(--nd-line, var(--border-subtle)); border-radius: 14px; padding: 12px 14px; background: var(--nd-card-bg); }
    .ce-plate__head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .ce-plate__ttl { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); }
    .ce-plate__meta { font-size: 12.5px; color: var(--text-secondary); }
    .ce-plate__grow { flex: 1 1 auto; }
    .ce-plate__btn { display: inline-flex; align-items: center; gap: 7px; height: 36px; padding: 0 12px; font-size: 13.5px; }
    .ce-plate__chips { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .ce-plate__chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; }
    .ce-plate__mm { font-weight: 400; color: var(--text-secondary); }
    .ce-plate__note { margin: 8px 0 0; font-size: 12.5px; color: var(--text-tertiary); text-wrap: pretty; }
    .ce-plate__err { margin: 6px 0 0; font-size: 12.5px; color: var(--red-text, #b91c1c); }
    .ce-abx__nobp { display: block; margin-top: 2px; font-size: 12px; color: var(--text-tertiary); }
    .ce-abx__savebp { display: inline-flex; align-items: center; gap: 6px; margin-left: 6px; color: var(--text-secondary); cursor: pointer; min-height: 28px; }
    .ce-plate__assign { display: flex; align-items: center; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
    .ce-plate__assignlbl { font-size: 13px; font-weight: 500; color: var(--text-primary); }
    .ce-plate__orgsel { min-width: 240px; max-width: 340px; flex: 1 1 240px; }
    @media (hover: none), (pointer: coarse) { .ce-abx__savebp { min-height: 44px; } }

    /* ── Measure → organism, INSIDE the measure view (Review step) ── */
    .ce-mo { display: flex; flex-direction: column; gap: 10px; }
    .ce-mo__pick { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .ce-mo__lbl { font-size: 13px; font-weight: 500; color: var(--text-primary); }
    .ce-mo__sel { flex: 1 1 200px; min-width: 0; }
    .ce-mo__trigger { display: none; flex: 1 1 auto; align-items: center; justify-content: space-between; gap: 8px;
      min-height: 44px; padding: 0 12px; border-radius: var(--nd-radius-sm, 10px); border: 1px solid var(--nd-line);
      background: var(--nd-card-bg); color: var(--text-primary); font: inherit; font-size: 16px; cursor: pointer; text-align: left; }
    .ce-mo__trigger svg { color: var(--text-tertiary); flex: none; }
    .ce-mo__trigtxt--ph { color: var(--text-tertiary); }
    .ce-mo__note { margin: 0; font-size: 12.5px; color: var(--text-tertiary); text-wrap: pretty; }
    .ce-mo__warn { display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; border-radius: var(--nd-radius-sm, 10px);
      background: var(--nd-chip-bg); border: 1px solid var(--nd-line); font-size: 12.5px; color: var(--text-primary); cursor: pointer; }
    .ce-mo__warnbox { margin-top: 1px; }
    /* Kit checkbox (drawn, never the native look). */
    .ce-mo-chk { appearance: none; -webkit-appearance: none; flex: none; margin: 0; cursor: pointer;
      width: 16px; height: 16px; border-radius: 5px; border: 1.5px solid var(--nd-sel-border, #9aa4ae); background: var(--nd-card-bg);
      display: inline-grid; place-content: center; }
    .ce-mo-chk::after { content: ''; width: 9px; height: 5px; margin-top: -2px; border: 2px solid #fff; border-top: 0; border-right: 0;
      transform: rotate(-45deg) scale(0); }
    .ce-mo-chk:checked { background: var(--color-violet-600, #7c3aed); border-color: transparent; }
    .ce-mo-chk:checked::after { transform: rotate(-45deg) scale(1); }
    .ce-mo-chk:disabled { opacity: 0.45; cursor: not-allowed; }
    .ce-mo-chk:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .ce-mo__rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .ce-mo__row { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto 32px; align-items: center; gap: 8px;
      min-height: 40px; padding: 5px 8px; border-radius: 10px; font-variant-numeric: tabular-nums; }
    /* The measure lives on <body> (outside this host), so the theme hooks
       are global selectors scoped by the unique ce-mo classes. */
    ::ng-deep html.light .ce-mo__row { background: #f6f7f9; }
    ::ng-deep html.dark .ce-mo__row { background: rgba(255,255,255,0.05); }
    .ce-mo__row--off { opacity: 0.62; }
    .ce-mo__tick { width: 16px; height: 16px; border-radius: 5px; display: inline-flex; align-items: center; justify-content: center;
      border: 1.5px solid var(--nd-sel-border, #9aa4ae); color: #fff; }
    .ce-mo__tick--on { background: var(--color-violet-600, #7c3aed); border-color: transparent; }
    .ce-mo__namewrap { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .ce-mo__name { font-size: 13.5px; font-weight: 500; color: var(--text-primary); }
    .ce-mo__bp { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; font-size: 12px; color: var(--text-tertiary); }
    .ce-mo__bpnote { flex-basis: 100%; }
    .ce-mo__bpf { display: inline-flex; align-items: center; gap: 4px; color: var(--text-secondary); }
    .ce-mo__bpin { width: 44px; height: 30px; text-align: center; border-radius: 8px; border: 1px solid var(--nd-line);
      background: var(--nd-card-bg); color: var(--text-primary); font: inherit; font-size: 13px; outline: none; }
    .ce-mo__bpin:focus { border-color: var(--color-violet-600, #7c3aed); }
    .ce-mo__save { display: inline-flex; align-items: center; gap: 6px; color: var(--text-secondary); cursor: pointer; }
    .ce-mo__mm { font-size: 13px; color: var(--text-primary); white-space: nowrap; }
    .ce-mo__sir { width: 32px; height: 28px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center;
      font-size: 13px; font-weight: 600; color: var(--text-tertiary); border: 1px solid var(--nd-line); }
    .ce-mo__sir.ce-sir-picked { border-color: transparent; }
    ::ng-deep html.light .ce-mo__sir.ce-sir--s { background: rgba(16,185,129,0.13); color: #065f46; }
    ::ng-deep html.light .ce-mo__sir.ce-sir--i { background: rgba(245,158,11,0.14); color: #92400e; }
    ::ng-deep html.light .ce-mo__sir.ce-sir--r { background: rgba(239,68,68,0.12); color: #991b1b; }
    ::ng-deep html.dark .ce-mo__sir.ce-sir--s { background: rgba(16,185,129,0.20); color: #6ee7b7; }
    ::ng-deep html.dark .ce-mo__sir.ce-sir--i { background: rgba(245,158,11,0.20); color: #fcd34d; }
    ::ng-deep html.dark .ce-mo__sir.ce-sir--r { background: rgba(239,68,68,0.20); color: #fca5a5; }
    .ce-mo__empty { font-size: 13px; color: var(--text-tertiary); padding: 8px 2px; }
    /* Phone organism sheet (inside the full-screen measure). */
    .ce-mo-sheetbd { position: fixed; inset: 0; z-index: 1010; background: rgba(0, 0, 0, 0.45); }
    .ce-mo-sheet { position: fixed; left: 0; right: 0; bottom: var(--nd-nav-h, 0px); z-index: 1011;
      max-height: min(80dvh, calc(100dvh - var(--nd-nav-h, 0px) - 24px)); display: flex; flex-direction: column; gap: 8px;
      padding: 0 12px max(12px, env(safe-area-inset-bottom)); border-radius: 20px 20px 0 0;
      background: var(--nd-card-bg, var(--bg-card-solid)); border: 1px solid var(--nd-line); border-bottom: 0;
      animation: ce-mo-rise var(--nd-dur-sheet, 320ms) var(--nd-spring, ease) both; }
    @keyframes ce-mo-rise { from { transform: translateY(24px); opacity: 0; } to { transform: none; opacity: 1; } }
    .ce-mo-sheet__handle { display: block; flex: 0 0 5px; align-self: center; width: 40px; max-width: 40px; height: 5px; min-height: 0;
      padding: 0; margin: 8px auto 2px; border-radius: 999px; background: var(--nd-line); }
    .ce-mo-sheet__head { display: flex; align-items: center; justify-content: space-between; }
    .ce-mo-sheet__ttl { font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .ce-mo-sheet__x { width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; border: 0;
      border-radius: 10px; background: transparent; color: var(--text-tertiary); cursor: pointer; }
    .ce-mo-sheet__q { height: 44px; padding: 0 12px; border-radius: var(--nd-radius-sm, 10px); border: 1px solid var(--nd-line);
      background: var(--nd-card-bg); color: var(--text-primary); font: inherit; font-size: 16px; outline: none; }
    .ce-mo-sheet__q:focus { border-color: var(--color-violet-600, #7c3aed); }
    .ce-mo-sheet__list { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1 1 auto; min-height: 0; }
    .ce-mo-sheet__opt { width: 100%; min-height: 44px; padding: 0 10px; border: 0; border-radius: 10px; background: transparent;
      color: var(--text-primary); font: inherit; font-size: 15px; text-align: left; cursor: pointer; }
    .ce-mo-sheet__opt:hover, .ce-mo-sheet__opt[aria-pressed='true'] { background: var(--nd-sel-bg); }
    @media (max-width: 640px) {
      .ce-mo__sel { display: none; }
      .ce-mo__trigger { display: inline-flex; }
      .ce-mo__bpin { height: 44px; width: 56px; font-size: 16px; }
      .ce-mo__row { grid-template-columns: 18px minmax(0, 1fr) auto 32px; padding: 6px; }
    }
    @media (min-width: 641px) { .ce-mo-sheet, .ce-mo-sheetbd { display: none; } }
    @media (prefers-reduced-motion: reduce) { .ce-mo-sheet { animation: none; } }
    @media (hover: none), (pointer: coarse) { .ce-plate__btn { height: 44px; } }
    @media (max-width: 640px) { .ce-plate__btn { width: 100%; justify-content: center; } }
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
  /** The culture case (order test) — the plate's AI code read is audited against it. */
  @Input() orderTestId: string | null = null;
  /** The culture branch (subculture case id; null = the primary) whose AST
   *  stage holds the plate reading. */
  private _plateCaseId: string | null = null;
  @Input() set plateCaseId(v: string | null | undefined) {
    const next = v ?? null;
    if (next === this._plateCaseId && this.plateLoaded) return;
    this._plateCaseId = next;
    if (this.plateLoaded) this.loadPlate();
  }
  get plateCaseId(): string | null { return this._plateCaseId; }
  @Output() reportHiddenChange = new EventEmitter<string[]>();
  rhOn(): boolean { return this.reportHidden !== null; }
  isShown(key: string): boolean { return !(this.reportHidden ?? []).includes(key); }
  toggleShown(key: string) {
    const cur = this.reportHidden ?? [];
    this.reportHiddenChange.emit(cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key]);
  }
  get organisms(): string[] { return this.organismNames?.length ? this.organismNames : COMMON_ORGANISMS; }
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService, { optional: true });
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
    // Our own emission echoed back by the parent: nothing new — and its
    // auto S / I / R must stay auto (not be re-flagged as typed by hand).
    if (v && v === this._m()) return;
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
    // A plate organism whose identification CHANGED keeps its plate zones and
    // takes the new organism's breakpoints (S / I / R recomputed).
    {
      const orgs0 = this._m().organisms ?? [];
      const have0 = new Set(orgs0.map(o => o.name.trim().toLowerCase()));
      const pi = orgs0.findIndex(o => o.fromPlate);
      const newName = wanted.find(n => !have0.has(n.toLowerCase()));
      if (pi >= 0 && newName && !wanted.some(n => n.toLowerCase() === orgs0[pi].name.trim().toLowerCase())) {
        this.remapPlateOrganism(pi, newName);
        this.valueChange.emit(this._m());
      }
    }
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

    // The case's plate goes onto the FIRST new organism when no organism
    // carries it yet: ONLY the plate's antibiotics, zones filled.
    const plate = this.plate();
    let plateAt = keptWithIndex.some(({ o }) => o.fromPlate) || !plate ? -1 : keptWithIndex.length;
    const organisms: CultureOrganism[] = [...keptWithIndex.map(({ o }) => o), ...missing.map(name => ({ name, antibiotics: this.clsiRows(name) }))];
    if (plateAt >= organisms.length) plateAt = -1;
    const next: CultureResult = { ...cur, noGrowth: false, organisms };
    this._m.set(next);
    if (plateAt >= 0) this.quietly(() => this.buildFromPlate(plateAt, organisms[plateAt].name));
    this.valueChange.emit(this._m());
    this.organismsOpen.set(organisms.length > 0);
  }

  /** The AST antibiotic vocabulary — names come ONLY from this master. */
  readonly abxNames = signal<string[]>([]);
  /** The antibiotic master with short names (PF Sense candidates for a plate
   *  read before the organism). */
  readonly abxMaster = signal<MasterAntibiotic[]>([]);

  ngOnInit() {
    this.loadPlate();
    this.api.get<{ name: string; group?: string | null }[]>('/api/microbiology/organisms').subscribe({
      next: rows => {
        const m = new Map<string, string>();
        for (const o of rows ?? []) if (o.name) m.set(o.name.trim().toLowerCase(), o.group ?? '');
        this.orgGroups = m;
        this.bpVer.update(v => v + 1);
        this.rebuildPristinePlates();
        this.backfillClsiPanels();
      },
      error: () => { /* falls back to the name heuristic */ }
    });
    this.api.get<{ name: string; shortName?: string | null }[]>('/api/microbiology/antibiotics').subscribe({
      next: rows => {
        this.abxNames.set((rows ?? []).map(a => a.name).filter(Boolean));
        this.abxMaster.set((rows ?? []).filter(a => !!a.name).map(a => ({ name: a.name, shortName: a.shortName ?? null })));
        this.abxLoaded.set(true);
      },
      error: () => { this.abxLoaded.set(true); /* master unavailable → picker shows an empty-state note */ }
    });
    this.api.get<Breakpoint[]>('/api/microbiology/breakpoints').subscribe({
      next: list => {
        // Keep ALL rows (incl. disabled + organism-pinned) — effective rows
        // are resolved PER ORGANISM: a row pinned to the isolate outranks its
        // group row, and only then does the enabled filter apply.
        this.bpList = list ?? [];
        this.bpVer.update(v => v + 1);
        // Breakpoints just arrived → a plate organism's verdicts can be computed.
        this.quietly(() => (this._m().organisms ?? []).forEach((o, oi) => { if (o.fromPlate) o.antibiotics.forEach((_, abi) => this.autoInterpret(oi, abi)); }));
        this.rebuildPristinePlates();
        // Organisms seeded before the breakpoints arrived have empty panels —
        // fill them now that we know which drugs CLSI covers.
        this.backfillClsiPanels();
      },
      error: () => { /* offline → manual entry only */ }
    });
  }

  readonly organismsOpen = signal(false);

  // ── The PLATE, measured before the organism (SME flow) ───────────
  /** The case's plate reading (AST stage `plateJson`), null = not measured. */
  readonly plate = signal<PlateReading | null>(null);
  readonly measuringPlate = signal(false);
  readonly plateSaving = signal(false);
  readonly plateError = signal('');
  private plateLoaded = false;
  /** Plate-before-organism is a case feature: the workbench, editable. */
  plateOn(): boolean { return this.embedded && !this.readonly && !!this.orderTestId; }
  private caseQ(): string { return this._plateCaseId ? `?caseId=${this._plateCaseId}` : ''; }
  loadPlate() {
    this.plateLoaded = true;
    if (!this.plateOn()) { this.plateFetched.set(true); return; }
    this.api.get<unknown>(`/api/microbiology/culture/${this.orderTestId}`).subscribe({
      next: c => {
        this.plate.set(parsePlate(plateJsonFromCase(c, this._plateCaseId)));
        if (this.plate()) this.applyPlate();
        this.plateFetched.set(true);
      },
      error: () => { this.plateFetched.set(true); /* no plate — the manual path is untouched */ },
    });
  }
  /** PF Sense candidates: EVERY antibiotic in the master (code + potency). */
  private readonly masterCandsC = computed<DiskCandidate[]>(() => { this.bpVer(); return masterCandidates(this.abxMaster(), this.bpList); });
  masterCands(): DiskCandidate[] { return this.masterCandsC(); }
  /** The organism the case plate is on: the one carrying the latest plate
   *  photo (several organisms may each have been measured), else the first. */
  private plateOrgIndex(): number {
    const orgs = this._m().organisms ?? [];
    const url = this.plate()?.imageUrl;
    const byPhoto = url ? orgs.findIndex(o => o.fromPlate && o.plateImageUrl === url) : -1;
    return byPhoto >= 0 ? byPhoto : orgs.findIndex(o => o.fromPlate);
  }
  plateOrgName(): string | null {
    const o = (this._m().organisms ?? [])[this.plateOrgIndex()];
    return o?.name?.trim() || null;
  }
  openPlateMeasure() { this.plateError.set(''); this.measuringPlate.set(true); }
  /** Measure → Review → Apply: store the reading on the case, then build the
   *  organism's table from it (if the organism is known yet). */
  onPlateMeasured(e: { measurements: PlateMeasurement[]; imageUrl: string | null; session: PlateMeasureSession; auditId?: string | null }) {
    const reading = readingFromMeasure(e, this.abxNames());
    this.measuringPlate.set(false);
    this.plate.set(reading);
    this.savePlate(reading);
    this.applyPlate(true);
  }
  private savePlate(r: PlateReading | null) {
    if (!this.orderTestId) return;
    this.plateSaving.set(true);
    this.api.put(`/api/microbiology/culture/${this.orderTestId}/stage/ast/plate${this.caseQ()}`, { plateJson: r ? JSON.stringify(r) : null }).subscribe({
      next: () => { this.plateSaving.set(false); this.plateError.set(''); },
      error: e => { this.plateSaving.set(false); this.plateError.set((e as { message?: string })?.message || 'Couldn’t save the plate — it stays on this screen.'); },
    });
  }
  /**
   * Put the plate onto an organism: the one already built from it, else the
   * first organism with nothing entered. Its rows become ONLY the plate's
   * antibiotics (zones filled), S / I / R from ITS breakpoints. `remeasured`
   * replaces a plate organism's rows with the new reading.
   */
  applyPlate(remeasured = false) { this.quietly(() => this.applyPlateNow(remeasured)); }
  private applyPlateNow(remeasured: boolean) {
    const r = this.plate();
    if (!r) return;
    const orgs = this._m().organisms ?? [];
    let oi = orgs.findIndex(o => o.fromPlate);
    if (oi >= 0 && !remeasured) return;               // already built — keep the tech's edits
    if (oi < 0) oi = orgs.findIndex(o => o.name.trim() && o.antibiotics.every(a => a.zoneSize == null && !a.interpretation && !a.micValue));
    if (oi < 0) return;                                 // no organism yet (or all touched) — the plate waits
    this.buildFromPlate(oi, orgs[oi].name);
  }
  /**
   * The plate organism's table (owner, 2026-09-25): the organism's FULL CLSI
   * panel. The plate's antibiotics come FIRST, in plate order, CHECKED, with
   * their zones; every other panel drug follows UNCHECKED (not reported, no
   * zone — tick it to enter one by hand). A measured drug outside the panel
   * is still added, checked, with editable breakpoints. Plate drugs map onto
   * the panel's own names by their printed code ("AMC 30" → "Amoxicillin-
   * Clavulanate 20"), else by drug. `prev` (an organism change) carries the
   * tech's zones, and manual breakpoints for drugs still outside the panel.
   */
  private plateTable(orgName: string, prev?: AstRow[], disks?: { code: string | null; drug: string; mm: number }[]): { rows: AstRow[]; unchecked: string[] } {
    const panel = this.clsiPanelFor(orgName);
    const pc = panelCandidates(panel);
    const byName = new Map((prev ?? []).map(a => [a.name, a]));
    const used = new Set<string>();
    const plateRowsOut: AstRow[] = [];
    for (const d of disks ?? this.plate()?.disks ?? []) {
      const name = this.panelName(panel, pc, d.drug, d.code);
      if (used.has(name)) continue;
      used.add(name);
      const old = byName.get(name) ?? byName.get(d.drug);
      const inPanel = panel.includes(name);
      plateRowsOut.push({
        name, zoneSize: old?.zoneSize ?? d.mm, interpretation: '',
        ...(!inPanel && (old?.sMin != null || old?.rMax != null) ? { sMin: old?.sMin ?? null, rMax: old?.rMax ?? null } : {}),
      });
    }
    const rest = panel.filter(n => !used.has(n)).map(n => ({ name: n, zoneSize: null, interpretation: '' as const }));
    return { rows: [...plateRowsOut, ...rest], unchecked: rest.map(x => x.name) };
  }
  /** A plate disk → the organism panel's own row name: by its printed code
   *  ("PIT 100/10" → "Piperacillin-Tazobactam 100"), else by drug. */
  private panelName(panel: string[], pc: DiskCandidate[], drug: string, code: string | null | undefined): string {
    return (code ? drugForCode(code, pc) : null) ?? panel.find(p => baseDrug(p) === baseDrug(drug)) ?? drug;
  }
  private buildFromPlate(oi: number, name: string, prev?: AstRow[]) {
    const r = this.plate();
    if (!r) return;
    this.clearManual(oi);
    const t = this.plateTable(name, prev);
    this.updateOrg(oi, o => ({ ...o, name, antibiotics: t.rows, fromPlate: true, plateImageUrl: r.imageUrl ?? o.plateImageUrl ?? null, plateMeasure: r.session }));
    this.setUnchecked(oi, t.unchecked);
    if (this.mode() !== 'zone') this.patch({ astMode: 'zone' });
    (this._m().organisms?.[oi]?.antibiotics ?? []).forEach((_, abi) => this.autoInterpret(oi, abi));
  }
  /** Report ticks for organism `oi`: exactly `names` unticked (the report
   *  prints only ticked rows). No-op when the parent has the feature off. */
  private setUnchecked(oi: number, names: string[]) {
    if (this.reportHidden === null) return;
    const prefix = `ast:${oi}:`;
    const next = [...(this.reportHidden ?? []).filter(k => !k.startsWith(prefix)), ...names.map(n => prefix + n)];
    this.reportHidden = next;
    this.reportHiddenChange.emit(next);
  }
  /** A plate organism renamed (identification changed / reassigned): the
   *  NEW organism's full panel, plate drugs checked, same zones, every
   *  verdict recomputed; manual breakpoints kept for drugs still outside. */
  private remapPlateOrganism(oi: number, name: string) { this.quietly(() => this.remapNow(oi, name)); }
  private remapNow(oi: number, name: string) {
    this.buildFromPlate(oi, name, this._m().organisms?.[oi]?.antibiotics ?? []);
  }
  private clearManual(oi: number) {
    for (const k of [...this.manual]) if (k.startsWith(`${oi}:`)) this.manual.delete(k);
  }

  // ── Plate drugs outside the organism's CLSI panel ────────────────
  private outsidePanel(org: CultureOrganism, ab: AstRow): boolean {
    return !!org.fromPlate && !!org.name.trim() && this.effectiveRow(org.name, ab.name) === undefined;
  }
  /** "No CLSI breakpoint for <organism>" — enter S ≥ / R ≤ on the row. */
  noBreakpoint(org: CultureOrganism, ab: AstRow): boolean {
    return this.outsidePanel(org, ab) && ab.sMin == null && ab.rMax == null;
  }
  /** The tech typed this row's breakpoints (the organism's CLSI has none). */
  manualBreakpoint(org: CultureOrganism, ab: AstRow): boolean {
    return this.outsidePanel(org, ab) && (ab.sMin != null || ab.rMax != null);
  }
  /** Saving to the breakpoint master = the Test Master permission. */
  canSaveBreakpoints(): boolean { return !!this.auth?.hasPermission('manage_tests'); }
  readonly bpSaving = signal<string | null>(null);
  readonly bpSaved = signal<Set<string>>(new Set());
  /** "Save to CLSI for <organism>": an organism-pinned lab breakpoint, so
   *  the next case fetches it. Without the permission the breakpoints stay
   *  on this case only (they ride on the row). */
  saveBreakpointToMaster(oi: number, abi: number) {
    const org = this._m().organisms?.[oi], ab = org?.antibiotics[abi];
    if (!org || !ab || !this.canSaveBreakpoints() || ab.sMin == null || ab.rMax == null) return;
    const key = `${org.name}|${ab.name}`;
    const group = this.organismGroup(org.name) ?? org.name;
    this.bpSaving.set(key);
    this.api.post('/api/microbiology/breakpoints', {
      organismGroup: group, antibiotic: ab.name, organism: org.name,
      susceptibleMin: ab.sMin, resistantMax: ab.rMax,
    }).subscribe({
      next: () => {
        this.bpSaving.set(null);
        this.bpSaved.update(s => new Set([...s, key]));
        this.bpList = [...this.bpList, { organismGroup: group, antibiotic: ab.name, organism: org.name,
          susceptibleMin: ab.sMin ?? null, resistantMax: ab.rMax ?? null, enabled: true }];
      },
      error: () => this.bpSaving.set(null),
    });
  }
  bpSavedFor(org: CultureOrganism, ab: AstRow): boolean { return this.bpSaved().has(`${org.name}|${ab.name}`); }

  // ── Measure from the Identification header (the case's main path) ──
  /** Bumped whenever breakpoints / organism groups arrive (bpList and
   *  orgGroups are plain fields) so computed views re-read them. */
  private readonly bpVer = signal(0);
  private readonly abxLoaded = signal(false);
  private readonly plateFetched = signal(false);
  /** The measure opened from the Identification header. */
  readonly orgMeasureOpen = signal(false);
  /** The organism the measure was opened for (its own photo wins). */
  private readonly orgMeasureFor = signal('');
  /** What it reopens on: that organism's own photo + rings, else the case
   *  plate (still on the case), else a fresh capture. Resolved when the
   *  modal renders — the case plate may arrive after the request. */
  readonly orgMeasureStart = computed<{ imageUrl: string | null; session: PlateMeasureSession | null } | null>(() => {
    const name = this.orgMeasureFor().toLowerCase();
    const target = name ? (this._m().organisms ?? []).find(o => o.name.trim().toLowerCase() === name) : undefined;
    if (target?.plateImageUrl && target.plateMeasure) return { imageUrl: target.plateImageUrl, session: target.plateMeasure };
    const p = this.plate();
    return p ? { imageUrl: p.imageUrl, session: p.session } : null;
  });
  /** Open once the master + the case plate are known (candidates, re-measure). */
  readonly orgMeasureReady = computed(() => this.abxLoaded() && this.plateFetched());
  /** The organism picked INSIDE the measure view. */
  readonly mOrg = signal('');
  /** Breakpoints typed in the measure view for drugs outside the organism's
   *  CLSI panel (drug → S ≥ / R ≤, mm). */
  readonly mBp = signal<Record<string, { s: number | null; r: number | null }>>({});
  /** Drugs whose typed breakpoints go to the CLSI master on OK. */
  readonly mSave = signal<Set<string>>(new Set());
  /** The technician confirmed replacing the organism's entered results. */
  readonly mReplace = signal(false);
  readonly orgSheet = signal(false);
  readonly orgQuery = signal('');
  /** OK has written the organism + its sensitivity table. */
  @Output() organismMeasured = new EventEmitter<string>();
  /** The measure closed (OK or cancel) — the request is spent. */
  @Output() measureClosed = new EventEmitter<void>();

  /** The workbench asks for the measure (Identification header → Measure):
   *  `{ org, n }` — a new `n` opens it, `org` pre-fills the organism. */
  private lastMeasureReq = 0;
  @Input() set measureRequest(r: { org: string | null; n: number } | null | undefined) {
    if (!r || r.n === this.lastMeasureReq) return;
    this.lastMeasureReq = r.n;
    this.openOrgMeasure(r.org);
  }
  openOrgMeasure(org?: string | null) {
    const name = (org ?? '').trim();
    const target = name ? (this._m().organisms ?? []).find(o => o.name.trim().toLowerCase() === name.toLowerCase()) : undefined;
    this.orgMeasureFor.set(target?.name ?? name);
    this.mOrg.set(target?.name ?? name);
    this.mBp.set({}); this.mSave.set(new Set()); this.mReplace.set(false);
    this.orgQuery.set(''); this.orgSheet.set(false);
    this.orgMeasureOpen.set(true);
  }
  closeOrgMeasure() { this.orgMeasureOpen.set(false); this.orgSheet.set(false); this.measureClosed.emit(); }
  setMeasureOrg(name: string) {
    const n = (name ?? '').trim();
    if (n === this.mOrg()) return;
    this.mOrg.set(n);
    this.mReplace.set(false);
    // Typed breakpoints belong to the organism they were typed for.
    this.mBp.set({}); this.mSave.set(new Set());
  }
  openOrgSheet() { this.orgQuery.set(''); this.orgSheet.set(true); }
  orgSheetOptions(): string[] {
    const q = this.orgQuery().trim().toLowerCase();
    return this.organismOptions().map(o => o.value).filter(n => !q || n.toLowerCase().includes(q));
  }
  setMeasureBp(drug: string, key: 's' | 'r', raw: string) {
    const t = String(raw ?? '').trim();
    const v = t === '' ? null : Number(t);
    if (v !== null && !Number.isFinite(v)) return;
    this.mBp.update(m => ({ ...m, [drug]: { s: m[drug]?.s ?? null, r: m[drug]?.r ?? null, [key]: v } }));
  }
  toggleMeasureSave(drug: string) {
    this.mSave.update(s => { const n = new Set(s); n.has(drug) ? n.delete(drug) : n.add(drug); return n; });
  }
  /** The organism already on the AST table with results entered — OK would
   *  replace them, so it asks first (inline, inside the measure). */
  overwriteTarget(): string | null {
    const n = this.mOrg().trim().toLowerCase();
    if (!n) return null;
    const orgs = this._m().organisms ?? [];
    const oi = orgs.findIndex(x => x.name.trim().toLowerCase() === n);
    const o = orgs[oi];
    if (!o || !o.antibiotics.some(a => a.zoneSize != null || !!a.interpretation || !!a.micValue)) return null;
    return this.pristinePlateBuild(oi) ? null : o.name;
  }
  /** The organism's table is exactly what the case plate built (no zone,
   *  verdict or MIC typed by the technician) — nothing of theirs to lose. */
  private pristinePlateBuild(oi: number): boolean {
    const o = this._m().organisms?.[oi];
    const disks = this.plate()?.disks;
    if (!o?.fromPlate || !disks) return false;
    if ([...this.manual].some(k => k.startsWith(`${oi}:`))) return false;
    // Every zone on the table is a plate zone (same drug, same mm) — by the
    // drug's base name, so it holds before AND after the panel is known.
    return o.antibiotics.every(a => !a.micValue && (a.zoneSize == null
      || disks.some(d => baseDrug(d.drug) === baseDrug(a.name) && d.mm === a.zoneSize)));
  }
  /** Breakpoints / organism groups arrived after the case plate built a
   *  table: rebuild the untouched ones so plate drugs land on the panel's
   *  own rows (and the rest of the panel is listed). */
  private rebuildPristinePlates() {
    this.quietly(() => (this._m().organisms ?? []).forEach((o, oi) => {
      if (!o.fromPlate || !o.name.trim() || !this.pristinePlateBuild(oi)) return;
      const want = this.plateTable(o.name).rows;
      const same = want.length === o.antibiotics.length
        && want.every((r, k) => r.name === o.antibiotics[k].name && (r.zoneSize ?? null) === (o.antibiotics[k].zoneSize ?? null));
      if (!same) this.buildFromPlate(oi, o.name);                  // only when it would change
    }));
  }
  orgMeasureCanApply(): boolean { return !!this.mOrg().trim() && (!this.overwriteTarget() || this.mReplace()); }

  /** The organism's CLSI panel for the live disks: plate drugs first,
   *  ticked, zone + S / I / R; the rest of the panel unticked; a measured
   *  drug outside the panel asks for its breakpoints. */
  previewRows(disks: LiveDisk[] | null | undefined): { name: string; mm: number | null; ticked: boolean; needsBp: boolean; s: number | null; r: number | null; sir: 'S' | 'I' | 'R' | '' }[] {
    const org = this.mOrg().trim();
    this.bpVer();
    if (!org) return [];
    const t = this.plateTable(org, undefined, disks ?? []);
    const off = new Set(t.unchecked);
    const typed = this.mBp();
    return t.rows.map(row => {
      const inPanel = this.effectiveRow(org, row.name) !== undefined;
      const bp = inPanel ? this.bpFor(org, row.name) : undefined;
      const s = inPanel ? bp?.s ?? null : typed[row.name]?.s ?? null;
      const r = inPanel ? bp?.r ?? null : typed[row.name]?.r ?? null;
      const mm = row.zoneSize ?? null;
      return { name: row.name, mm, ticked: !off.has(row.name), needsBp: !inPanel, s, r, sir: this.sirFrom(mm, s, r) };
    });
  }
  private sirFrom(mm: number | null, s: number | null, r: number | null): 'S' | 'I' | 'R' | '' {
    if (mm == null || s == null || r == null) return '';
    return mm >= s ? 'S' : mm <= r ? 'R' : 'I';
  }
  /** Live S / I / R in the measure (rings, disk list) for the picked organism. */
  readonly orgSrI = (drug: string, mm: number, code?: string | null): 'S' | 'I' | 'R' | '' => {
    const org = this.mOrg().trim();
    if (!org || mm == null) return '';
    const panel = this.clsiPanelFor(org);
    const name = this.panelName(panel, panelCandidates(panel), drug, code);
    const bp = this.bpFor(org, name);
    if (bp) return this.sirFrom(mm, bp.s, bp.r);
    const t = this.mBp()[name];
    return this.sirFrom(mm, t?.s ?? null, t?.r ?? null);
  };

  /** OK: the reading goes on the case, the organism gets its table (full
   *  CLSI panel, plate drugs ticked, zones + S / I / R), typed breakpoints
   *  ride on their rows (and go to the master when asked). Nothing is
   *  submitted — the stage's Submit / "Submit all results" stay the user's. */
  onOrganismMeasured(e: { measurements: PlateMeasurement[]; imageUrl: string | null; session: PlateMeasureSession; auditId?: string | null }) {
    const name = this.mOrg().trim();
    if (!name || !this.orgMeasureCanApply()) return;
    const reading = readingFromMeasure(e, this.abxNames());
    this.plate.set(reading);
    this.savePlate(reading);
    const orgs = this._m().organisms ?? [];
    let oi = orgs.findIndex(o => o.name.trim().toLowerCase() === name.toLowerCase());
    if (oi < 0) {
      this.commit({ ...this._m(), noGrowth: false, organisms: [...orgs, { name, antibiotics: [] }] });
      oi = orgs.length;
    } else if (this._m().noGrowth) {
      this.patch({ noGrowth: false });
    }
    const orgName = this._m().organisms![oi].name;
    this.buildFromPlate(oi, orgName);
    const typed = this.mBp();
    const save = this.mSave();
    (this._m().organisms?.[oi]?.antibiotics ?? []).forEach((ab, abi) => {
      const bp = typed[ab.name];
      if (!bp || this.effectiveRow(orgName, ab.name) !== undefined) return;
      this.setAb(oi, abi, { sMin: bp.s, rMax: bp.r });
      this.autoInterpret(oi, abi);
      if (save.has(ab.name)) this.saveBreakpointToMaster(oi, abi);
    });
    this.organismsOpen.set(true);
    this.closeOrgMeasure();
    this.organismMeasured.emit(orgName);
  }

  // ── Assign the organism right under the PLATE card ───────────────
  /** The organism the plate is assigned to (picker right under the plate). */
  assignOrganism(name: string) {
    const n = (name ?? '').trim();
    if (!n || !this.plate()) return;
    const orgs = this._m().organisms ?? [];
    const pi = this.plateOrgIndex();
    if (pi >= 0) { if (orgs[pi].name !== n) this.remapNow(pi, n); return; }
    let oi = orgs.findIndex(o => o.name.trim().toLowerCase() === n.toLowerCase());
    if (oi < 0) {
      this.commit({ ...this._m(), noGrowth: false, organisms: [...orgs, { name: n, antibiotics: [] }] });
      oi = orgs.length;
    }
    this.buildFromPlate(oi, n);
    this.organismsOpen.set(true);
  }

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
        ...(o.fromPlate ? { fromPlate: true } : {}),
      }))
    };
  }

  private commit(next: CultureResult) { if (!this.quiet) this.userEdited = true; this._m.set(next); this.valueChange.emit(next); }
  /** Automatic changes (building the table from the case's plate) are not
   *  the user's edits — they must not freeze re-seeding from the parent. */
  private quiet = 0;
  private quietly(fn: () => void) { this.quiet++; try { fn(); } finally { this.quiet--; } }
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
    if (this._m().organisms?.[i]?.fromPlate) { this.remapNow(i, name); return; }   // the user renamed it
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

  /** Drug → the breakpoint's short label + disk content ("AZA 30") — the
   *  plate reader's fallback disk code for drugs outside its code table. */
  activeCodeHints(): Record<string, string> {
    const i = this.measureOrg();
    const org = i == null ? null : this._m().organisms?.[i];
    const out: Record<string, string> = {};
    for (const a of org?.antibiotics ?? []) {
      const b = this.effectiveRow(org?.name, a.name);
      const sl = b?.shortLabel?.trim();
      if (!sl) continue;
      const pot = this.num(b?.diskLabel);
      out[a.name] = /\d/.test(sl) || pot == null ? sl : `${sl} ${pot}`;
    }
    return out;
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

  /** S / I / R in the plate modal: against the plate organism once known. */
  readonly plateSrI = (abName: string, mm: number): 'S' | 'I' | 'R' | '' => {
    const org = this.plateOrgName();
    const bp = org ? this.bpFor(org, abName) : undefined;
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
