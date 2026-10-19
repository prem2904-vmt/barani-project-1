import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, ValueGetterParams } from 'ag-grid-community';
import { RowClickedEvent } from 'ag-grid-community';
import { ApiService } from '../../../../core/services/api.service';
import { PfSelectOption, SelectComponent } from '../../../../shared/primitives/select.component';
import { ToastService } from '../../../../core/services/toast.service';
import { ThemeService } from '../../../../core/services/theme.service';
import { gridThemeDark, gridThemeLight } from './grid-theme';
import { BusyDirective } from '../../../../shared/directives/busy.directive';
import { SkeletonTableComponent } from '../../../../shared/primitives/skeleton-kit.component';
import { createLoadHold } from '../../../../shared/utils/min-duration';

interface MicroOrganism {
  code: string; name: string; shortName: string | null; group: string | null;
  gram: string | null; significance: string | null; astApplicable: boolean;
  tenantId?: string | null;
}
interface MicroSpecimen {
  code: string; name: string; category: string | null; site: string | null;
  container: string | null; transport: string | null; suitableFor: string | null;
  tenantId?: string | null;
}
interface MicroAntibiotic {
  code: string; name: string; shortName: string | null; abxClass: string | null;
  drugGroup: string | null; astApplicable: boolean; diskDiffusion: boolean;
  micTesting: boolean; reportingCategory: string | null;
  tenantId?: string | null;
}
interface Breakpoint {
  organismGroup: string; antibiotic: string;
  susceptibleMin: number | null; resistantMax: number | null;
  discContent: number | null; source: string | null; version: string | null; tenant?: boolean;
  shortLabel?: string | null; diskLabel?: string | null;
  zoneI?: string | null; zoneSdd?: string | null;
  micS?: string | null; micSdd?: string | null; micI?: string | null; micR?: string | null;
  urineOnly?: boolean; enabled?: boolean; organism?: string | null;
}

type MasterKey = 'specimens' | 'organisms' | 'antibiotics' | 'breakpoints';

/** The editor's working copy — a superset of all four masters' fields. */
interface EdModel {
  code?: string | null; name?: string; shortName?: string | null; group?: string | null;
  gram?: string | null; significance?: string | null; astApplicable?: boolean;
  abxClass?: string | null; drugGroup?: string | null; diskDiffusion?: boolean; micTesting?: boolean;
  category?: string | null; site?: string | null; container?: string | null;
  transport?: string | null; suitableFor?: string | null;
  organismGroup?: string; antibiotic?: string; shortLabel?: string | null; diskLabel?: string | null;
  susceptibleMin?: number | null; resistantMax?: number | null;
  micS?: string | null; micI?: string | null; micR?: string | null;
  urineOnly?: boolean; tenantId?: string | null; tenant?: boolean;
}

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
  imports: [AgGridAngular, FormsModule, SelectComponent, BusyDirective, SkeletonTableComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-mm">
      <div class="pf-mm__bar">
        @if (bandQuery() === null) {
          <input type="search" class="pf-input pf-mm__search" [placeholder]="'Search ' + label(section()) + '…'" [attr.aria-label]="'Search ' + label(section())"
                 [ngModel]="query()" (ngModelChange)="query.set($event)" />
        }
        <span class="pf-mm__count"><span class="pf-num">{{ shownCount() }}</span> of <span class="pf-num">{{ totalCount() }}</span> {{ label(section()) }}</span>
        <span class="pf-mm__spacer"></span>
        <span class="pf-mm__hint">Lab edits overlay the standards — used by the Culture bench (MIC200 C&amp;S)</span>
      </div>

      <div class="pf-mm__cols">
        <!-- ── LEFT: the masters rail (mirrors the departments rail) ── -->
        <aside class="pf-mm__rail" aria-label="Masters">
          <div class="pf-mm__railhead">Masters</div>
          <ul class="pf-mm__list">
            @for (s of sections; track s.key) {
              <li>
                <button type="button" class="pf-mm__item" [attr.aria-pressed]="section() === s.key"
                        (click)="select(s.key)">
                  <span class="pf-mm__iname">{{ s.title }}<span class="pf-mm__isub">{{ s.sub }}</span></span>
                  <span class="pf-mm__icount pf-num">{{ countOf(s.key) }}</span>
                </button>
              </li>
            }
          </ul>
        </aside>

        <!-- ── RIGHT: the selected master's grid (+ organism detail) ── -->
        <div class="pf-mm__split" [class.pf-mm__split--detail]="editor() || (section() === 'organisms' && selOrg())">
          <div class="pf-mm__grid">
            @if (listSkeleton()) {
              <!-- First load of the masters: the grid's shape (PF-PATTERN "Loading feedback"). -->
              <pf-skeleton-table class="pf-mm__gridskel" [rows]="10" [cols]="4" label="Loading microbiology masters…"></pf-skeleton-table>
            }
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

          @if (editor(); as ed) {
            <!-- The master-row EDITOR: side card; a sheet above the navbar on phones. -->
            <div class="pf-sheet-backdrop" (click)="editor.set(null)" aria-hidden="true"></div>
            <aside class="pf-card pf-sheet pf-mm__side pf-mm__side--editor" [attr.aria-label]="ed.isNew ? 'New ' + singular(ed.kind) : 'Edit ' + singular(ed.kind)">
              <span class="pf-sheet__handle" aria-hidden="true"></span>
              <div class="pf-card__head">
                <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6M10 3v6.5L4.6 18.2A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-2.8L14 9.5V3"/><path d="M7.5 15h9"/></svg></span>
                <span class="pf-card__label pf-mm__sname">{{ ed.isNew ? 'New ' + singular(ed.kind) : ed.model.name || ed.model.antibiotic }}</span>
                <span class="pf-card__spacer"></span>
                <button type="button" class="pf-btn pf-btn--icon pf-mm__x press" (click)="editor.set(null)" aria-label="Close" title="Close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
              </div>
              <div class="pf-card__body">
              @if (!ed.isNew) {
                <div class="pf-mm__smeta">{{ ed.model.tenantId || ed.model.tenant ? 'Lab-authored — editable in place' : 'Standard row — saving creates your lab\u2019s override' }}</div>
              }

              @if (ed.kind === 'specimens') {
                <div class="pf-mm__slabel">Specimen</div>
                <label class="pf-field pf-mm__fld"><span class="pf-field__lbl">Name</span><input class="pf-input pf-input--sm" [ngModel]="ed.model.name" (ngModelChange)="patchEd('name', $event)" /></label>
                <label class="pf-field pf-mm__fld"><span class="pf-field__lbl">Category</span><input class="pf-input pf-input--sm" [ngModel]="ed.model.category" (ngModelChange)="patchEd('category', $event)" /></label>
                <label class="pf-field pf-mm__fld"><span class="pf-field__lbl">Site</span><input class="pf-input pf-input--sm" [ngModel]="ed.model.site" (ngModelChange)="patchEd('site', $event)" /></label>
                <label class="pf-field pf-mm__fld"><span class="pf-field__lbl">Container</span><input class="pf-input pf-input--sm" [ngModel]="ed.model.container" (ngModelChange)="patchEd('container', $event)" /></label>
                <label class="pf-field pf-mm__fld"><span class="pf-field__lbl">Transport</span><input class="pf-input pf-input--sm" [ngModel]="ed.model.transport" (ngModelChange)="patchEd('transport', $event)" /></label>
                <label class="pf-field pf-mm__fld"><span class="pf-field__lbl">Suitable for</span><input class="pf-input pf-input--sm" [ngModel]="ed.model.suitableFor" (ngModelChange)="patchEd('suitableFor', $event)" /></label>
              }

              @if (ed.kind === 'antibiotics') {
                <div class="pf-mm__slabel">Antibiotic</div>
                <label class="pf-field pf-mm__fld"><span class="pf-field__lbl">Name</span><input class="pf-input pf-input--sm" [ngModel]="ed.model.name" (ngModelChange)="patchEd('name', $event)" /></label>
                <label class="pf-field pf-mm__fld"><span class="pf-field__lbl">Short</span><input class="pf-input pf-input--sm" [ngModel]="ed.model.shortName" (ngModelChange)="patchEd('shortName', $event)" /></label>
                <label class="pf-field pf-mm__fld"><span class="pf-field__lbl">Class</span><input class="pf-input pf-input--sm" [ngModel]="ed.model.abxClass" (ngModelChange)="patchEd('abxClass', $event)" /></label>
                <label class="pf-field pf-mm__fld"><span class="pf-field__lbl">Group</span><input class="pf-input pf-input--sm" [ngModel]="ed.model.drugGroup" (ngModelChange)="patchEd('drugGroup', $event)" /></label>
                <div class="pf-mm__flags">
                  <button type="button" class="pf-toggle pf-mm__flag" role="switch" [attr.aria-checked]="!!ed.model.astApplicable" (click)="patchEd('astApplicable', !ed.model.astApplicable)"><span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>AST</button>
                  <button type="button" class="pf-toggle pf-mm__flag" role="switch" [attr.aria-checked]="!!ed.model.diskDiffusion" (click)="patchEd('diskDiffusion', !ed.model.diskDiffusion)"><span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>Disk diffusion</button>
                  <button type="button" class="pf-toggle pf-mm__flag" role="switch" [attr.aria-checked]="!!ed.model.micTesting" (click)="patchEd('micTesting', !ed.model.micTesting)"><span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>MIC</button>
                </div>
              }

              @if (ed.kind === 'organisms') {
                <div class="pf-mm__slabel">Organism</div>
                <label class="pf-field pf-mm__fld"><span class="pf-field__lbl">Name</span><input class="pf-input pf-input--sm" [ngModel]="ed.model.name" (ngModelChange)="patchEd('name', $event)" /></label>
                <label class="pf-field pf-mm__fld"><span class="pf-field__lbl">Short</span><input class="pf-input pf-input--sm" [ngModel]="ed.model.shortName" (ngModelChange)="patchEd('shortName', $event)" /></label>
                <label class="pf-field pf-mm__fld"><span class="pf-field__lbl">Group</span><input class="pf-input pf-input--sm" [ngModel]="ed.model.group" (ngModelChange)="patchEd('group', $event)" placeholder="e.g. Enterobacterales" /></label>
                <label class="pf-field pf-mm__fld"><span class="pf-field__lbl">Gram</span>
                  <pf-select size="sm" [options]="gramOptions" [value]="ed.model.gram || ''"
                             placeholder="Gram stain…" (valueChange)="patchEd('gram', $event)"></pf-select></label>
                <label class="pf-field pf-mm__fld"><span class="pf-field__lbl">Significance</span><input class="pf-input pf-input--sm" [ngModel]="ed.model.significance" (ngModelChange)="patchEd('significance', $event)" /></label>
                <div class="pf-mm__flags">
                  <button type="button" class="pf-toggle pf-mm__flag" role="switch" [attr.aria-checked]="!!ed.model.astApplicable" (click)="patchEd('astApplicable', !ed.model.astApplicable)"><span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>AST applicable</button>
                </div>
              }

              @if (ed.kind === 'breakpoints') {
                <div class="pf-mm__slabel">Breakpoint mapping</div>
                <label class="pf-field pf-mm__fld"><span class="pf-field__lbl">Organism group</span><input class="pf-input pf-input--sm" [ngModel]="ed.model.organismGroup" (ngModelChange)="patchEd('organismGroup', $event)" placeholder="e.g. Enterobacterales" /></label>
                <label class="pf-field pf-mm__fld"><span class="pf-field__lbl">Antibiotic</span>
                  <pf-select size="sm" [options]="abxNameOptions()" [searchable]="true"
                             [value]="ed.model.antibiotic || ''" placeholder="Pick from the antibiotic master…"
                             (valueChange)="patchEd('antibiotic', $event)"></pf-select></label>
                <label class="pf-field pf-mm__fld"><span class="pf-field__lbl">Short label</span><input class="pf-input pf-input--sm" [ngModel]="ed.model.shortLabel" (ngModelChange)="patchEd('shortLabel', $event)" placeholder="e.g. AZA 30" /></label>
                <label class="pf-field pf-mm__fld"><span class="pf-field__lbl">Disk</span><input class="pf-input pf-input--sm" [ngModel]="ed.model.diskLabel" (ngModelChange)="patchEd('diskLabel', $event)" placeholder="e.g. 30 μg" /></label>
                <div class="pf-mm__cutrow">
                  <label class="pf-mm__cut"><span class="pf-mm__s">S ≥</span>
                    <input type="number" class="pf-input pf-num pf-mm__cutin" [ngModel]="ed.model.susceptibleMin" (ngModelChange)="patchEd('susceptibleMin', $event)" placeholder="mm" /></label>
                  <span class="pf-mm__cut pf-mm__i">I {{ ed.model.susceptibleMin != null && ed.model.resistantMax != null ? iWindow(ed.model.susceptibleMin, ed.model.resistantMax) : '—' }}</span>
                  <label class="pf-mm__cut"><span class="pf-mm__r">R ≤</span>
                    <input type="number" class="pf-input pf-num pf-mm__cutin" [ngModel]="ed.model.resistantMax" (ngModelChange)="patchEd('resistantMax', $event)" placeholder="mm" /></label>
                </div>
                <div class="pf-mm__cutrow">
                  <label class="pf-mm__cut"><span class="pf-mm__s">MIC S</span><input class="pf-input pf-num pf-mm__cutin pf-mm__cutin--i" [ngModel]="ed.model.micS" (ngModelChange)="patchEd('micS', $event)" placeholder="≤ n" /></label>
                  <label class="pf-mm__cut"><span class="pf-mm__i">I</span><input class="pf-input pf-num pf-mm__cutin pf-mm__cutin--i" [ngModel]="ed.model.micI" (ngModelChange)="patchEd('micI', $event)" placeholder="n" /></label>
                  <label class="pf-mm__cut"><span class="pf-mm__r">R</span><input class="pf-input pf-num pf-mm__cutin pf-mm__cutin--i" [ngModel]="ed.model.micR" (ngModelChange)="patchEd('micR', $event)" placeholder="≥ n" /></label>
                </div>
                <div class="pf-mm__flags">
                  <button type="button" class="pf-toggle pf-mm__flag" role="switch" [attr.aria-checked]="!!ed.model.urineOnly" (click)="patchEd('urineOnly', !ed.model.urineOnly)"><span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>Urine isolates only</button>
                </div>
              }

              </div>
              <div class="pf-mm__actions">
                @if (!ed.isNew && (ed.model.tenantId || ed.model.tenant)) {
                  <button type="button" class="pf-btn pf-btn--tertiary pf-mm__del press" (click)="deleteEd()"
                          [disabled]="deleting() || saving()" [pfBusy]="deleting()" pfBusyLabel="Removing…">
                    {{ hasStandard(ed) ? 'Revert to standard' : 'Delete' }}
                  </button>
                }
                <span class="pf-mm__spacer"></span>
                <button type="button" class="pf-btn pf-btn--primary pf-mm__save press" [disabled]="saving() || deleting() || !edValid()" [pfBusy]="saving()" pfBusyLabel="Saving…" (click)="saveEd()">
                  {{ saving() ? 'Saving…' : 'Save' }}
                </button>
              </div>
            </aside>
          } @else if (section() === 'organisms' && selOrg(); as org) {
            <!-- The organism's AST panel: its mapped antibiotics + cutoffs.
                 Rows come from the breakpoint table (group-resolved); adding
                 one writes a lab (tenant) breakpoint row. -->
            <aside class="pf-card pf-mm__side" [attr.aria-label]="org.name + ' AST panel'">
              <div class="pf-card__head">
                <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6M10 3v6.5L4.6 18.2A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-2.8L14 9.5V3"/><path d="M7.5 15h9"/></svg></span>
                <span class="pf-card__label pf-mm__sname">{{ org.name }}</span>
                <span class="pf-card__spacer"></span>
                <button type="button" class="pf-btn pf-btn--secondary pf-mm__hbtn press" (click)="startEdit('organisms', org)">Edit</button>
                <button type="button" class="pf-btn pf-btn--icon pf-mm__x press" (click)="selOrg.set(null)" aria-label="Close" title="Close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
              </div>
              <div class="pf-card__body">
              <div class="pf-mm__smeta">{{ org.group || 'No group' }}@if (org.gram) { · {{ org.gram }} }</div>

              <div class="pf-mm__slabel">Mapped antibiotics ({{ mappedFor(org).length }})</div>
              @for (b of mappedFor(org); track b.antibiotic) {
                <div class="pf-mm__map" [class.pf-mm__map--off]="b.enabled === false">
                  <!-- On the bench = on this switch: only enabled drugs reach
                       the AST table in result entry. -->
                  <button type="button" class="pf-toggle pf-mm__sw" role="switch" [attr.aria-checked]="b.enabled !== false"
                          [attr.aria-label]="'On the AST table: ' + b.antibiotic"
                          [title]="b.enabled === false ? 'Disabled — hidden from the AST table. Tap to enable.' : 'Enabled — shown on the AST table. Tap to disable.'"
                          [disabled]="mapBusy() === b.antibiotic" [attr.aria-busy]="mapBusy() === b.antibiotic ? 'true' : null"
                          (click)="toggleMapping(b)">
                    <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                  </button>
                  <span class="pf-mm__mapname">{{ b.antibiotic }}
                    @if (b.shortLabel) { <span class="pf-mm__short">{{ b.shortLabel }}</span> }
                    @if (b.organism) { <span class="pf-mm__short" title="Customised for this organism only">this organism</span> }
                  </span>
                  @if (b.susceptibleMin != null && b.resistantMax != null) {
                    <span class="pf-mm__mapbp">
                      <em class="pf-mm__s">S ≥ {{ b.susceptibleMin }}</em>
                      <em class="pf-mm__i">I {{ iWindow(b.susceptibleMin, b.resistantMax) }}</em>
                      <em class="pf-mm__r">R ≤ {{ b.resistantMax }}</em>
                    </span>
                  } @else {
                    <span class="pf-mm__mapbp" title="MIC breakpoints only — no disk diffusion for this drug/organism">
                      <em class="pf-mm__s">{{ b.micS || '—' }}</em>
                      <em class="pf-mm__i">{{ b.micI || '—' }}</em>
                      <em class="pf-mm__r">{{ b.micR || '—' }}</em>
                      <em class="pf-mm__micnote">MIC</em>
                    </span>
                  }
                  @if (b.tenant) {
                    <span class="pf-mm__lab" title="Lab-authored mapping">Lab</span>
                    <button type="button" class="pf-mm__mapx" (click)="removeMapping(org, b)"
                            [disabled]="mapBusy() === b.antibiotic" [pfBusy]="mapBusy() === b.antibiotic" pfBusyLabel="Removing…"
                            [attr.aria-label]="'Remove ' + b.antibiotic" [title]="'Remove ' + b.antibiotic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
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
                  <input type="number" class="pf-input pf-num pf-mm__cutin" [ngModel]="addS()" (ngModelChange)="addS.set($event)" placeholder="mm" /></label>
                <label class="pf-mm__cut"><span class="pf-mm__i">I</span>
                  <input type="text" class="pf-input pf-num pf-mm__cutin pf-mm__cutin--i"
                         [value]="addS() != null && addR() != null ? iWindow(addS()!, addR()!) : ''"
                         (change)="setAddI($any($event.target).value)"
                         placeholder="a–b" title="Intermediate window (e.g. 14–16) — typing it sets the S and R cutoffs around it" /></label>
                <label class="pf-mm__cut"><span class="pf-mm__r">R ≤</span>
                  <input type="number" class="pf-input pf-num pf-mm__cutin" [ngModel]="addR()" (ngModelChange)="addR.set($event)" placeholder="mm" /></label>
                <button type="button" class="pf-btn pf-btn--secondary pf-mm__add press" [disabled]="!canAdd() || saving()"
                        [pfBusy]="saving()" pfBusyLabel="Saving…" (click)="saveMapping(org)">{{ saving() ? 'Saving…' : 'Add' }}</button>
              </div>
              <p class="pf-mm__hint2">The Culture bench builds this organism's panel from these rows — S/I/R auto-interprets from the cutoffs.</p>
              </div>
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
    .pf-mm__search { flex: 0 1 320px; }
    .pf-mm__count { font-size: 12.5px; font-weight: 500; color: var(--text-tertiary); white-space: nowrap; }
    .pf-mm__hint { font-size: 11.5px; color: var(--text-tertiary); white-space: nowrap; }
    @media (max-width: 900px) { .pf-mm__hint { display: none; } }

    /* Rail left, grid right — the departments-panel language. */
    .pf-mm__cols { display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 14px; align-items: start; }
    @media (max-width: 980px) { .pf-mm__cols { grid-template-columns: 1fr; } }
    .pf-mm__rail { border: 1px solid var(--pf-line); border-radius: var(--pf-radius-card, 16px); background: var(--pf-card-bg); box-shadow: var(--pf-shadow-sm); padding: 10px; }
    .pf-mm__railhead { font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
      color: var(--text-tertiary); padding: 4px 8px 8px; }
    .pf-mm__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .pf-mm__item { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%;
      padding: 9px 11px; border-radius: 10px; cursor: pointer; text-align: left;
      background: transparent; border: 1px solid transparent; }
    .pf-mm__item:hover { background: var(--pf-chip-bg); }
    .pf-mm__item[aria-pressed='true'] { background: var(--pf-sel-bg); border-color: var(--pf-sel-border); }
    .pf-mm__iname { display: flex; flex-direction: column; gap: 1px; min-width: 0;
      font-size: 13px; font-weight: 500; color: var(--text-primary); }
    .pf-mm__isub { font-size: 11.5px; font-weight: 500; color: var(--text-tertiary); }
    .pf-mm__icount { flex-shrink: 0; font-size: 11.5px; font-weight: 700; color: var(--text-tertiary);
      font-variant-numeric: tabular-nums; }
    .pf-mm__split { display: grid; grid-template-columns: 1fr; gap: 14px; align-items: start; min-width: 0; }
    .pf-mm__split--detail { grid-template-columns: minmax(0, 1.15fr) minmax(320px, .85fr); }
    @media (max-width: 1100px) { .pf-mm__split--detail { grid-template-columns: 1fr; } }
    .pf-mm__grid { position: relative; border-radius: 12px; overflow: hidden; min-width: 0; }
    .pf-mm__gridskel { position: absolute; inset: 0; z-index: 2; overflow: hidden; background: var(--pf-card-bg, var(--bg-primary)); border-radius: inherit; }
    .pf-mm__side { max-height: 62vh; min-height: 0; }
    .pf-mm__side .pf-card__body { gap: 6px; }
    .pf-mm__side:not(.pf-sheet) .pf-sheet__handle { display: none; }
    /* The phone-sheet scrim is only a scrim on phones — never a grid cell. */
    @media (min-width: 641px) { .pf-mm__split > .pf-sheet-backdrop { display: none; } }
    .pf-mm__x { width: 36px; height: 36px; min-height: 36px; }
    .pf-mm__hbtn { height: 36px; min-height: 36px; }
    @media (max-width: 640px) { .pf-mm__side.pf-sheet { max-height: none; } }
        .pf-mm__sname { text-transform: none; letter-spacing: 0; font-size: 14px; color: var(--text-primary); }
    .pf-mm__smeta { font-size: 12px; color: var(--text-tertiary); margin: 0 0 4px; }
        .pf-mm__slabel { font-size: 12px; font-weight: 500; color: var(--text-secondary); margin: 10px 0 4px; }
    .pf-mm__map { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: var(--pf-radius-sm);
      border: 1px solid var(--pf-line); background: var(--pf-card-bg); margin-bottom: 5px; flex-wrap: wrap; }
    .pf-mm__map--off { opacity: .45; }
    .pf-mm__map--off .pf-mm__mapname { text-decoration: line-through; }
    .pf-mm__sw { flex-shrink: 0; }   /* kit slate switch (.pf-toggle) */
    .pf-mm__mapname { flex: 1; min-width: 0; font-size: 13px; font-weight: 500; color: var(--text-primary);
      overflow-wrap: anywhere; }
    .pf-mm__mapbp { display: inline-flex; gap: 8px; font-size: 11.5px; font-weight: 600; font-style: normal;
      font-variant-numeric: tabular-nums; white-space: nowrap; }
    .pf-mm__mapbp em { font-style: normal; }
    /* Breakpoints are NEUTRAL (PF-PATTERN §13): only a PICKED S/I/R result carries colour. */
    .pf-mm__s, .pf-mm__i, .pf-mm__r { color: var(--text-secondary); }
    .pf-mm__short { margin-left: 6px; font-size: 11px; font-weight: 500; color: var(--text-tertiary);
      border: 1px solid var(--border-subtle); border-radius: 6px; padding: 0 5px; font-variant-numeric: tabular-nums; }
    .pf-mm__micnote { font-size: 11px; font-weight: 500; color: var(--text-tertiary); }
    .pf-mm__lab { font-size: 11px; font-weight: 500; color: var(--text-secondary); background: var(--pf-chip-bg);
      border: 1px solid var(--pf-line); border-radius: var(--pf-radius-chip, 8px); padding: 1px 7px; }
    .pf-mm__clsi { font-size: 11px; font-weight: 500; color: var(--text-tertiary); background: var(--pf-chip-bg);
      border: 1px solid var(--pf-line); border-radius: var(--pf-radius-chip, 8px); padding: 1px 7px; }
    .pf-mm__mapx { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 8px;
      border: 1px solid transparent; cursor: pointer; color: var(--text-tertiary); background: transparent; }
    .pf-mm__mapx:hover { color: var(--red-text, #b91c1c); border-color: var(--pf-line); }
    .pf-mm__none { font-size: 12px; color: var(--text-tertiary); margin: 4px 0; }
    .pf-mm__cutrow { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
    .pf-mm__cut { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 500; color: var(--text-secondary); }
    .pf-mm__cutin { width: 68px; min-height: 36px; padding: 6px 8px; text-align: center;
      -moz-appearance: textfield; appearance: textfield; }
    .pf-mm__cutin::-webkit-inner-spin-button, .pf-mm__cutin::-webkit-outer-spin-button { display: none; }
        .pf-mm__cutin--i { width: 80px; }
    .pf-mm__save, .pf-mm__add { height: 40px; min-height: 40px; }
    .pf-mm__hint2 { font-size: 12px; color: var(--text-tertiary); margin: 10px 0 0; }
        .pf-mm__fld { margin-bottom: 6px; }
        .pf-mm__flags { display: flex; flex-wrap: wrap; gap: 10px 16px; margin: 6px 0 4px; }
    .pf-mm__flag { font-size: 12.5px; min-height: 32px; }
    .pf-mm__actions { flex: none; display: flex; align-items: center; gap: 10px; padding: 12px 14px 14px;
      border-top: 1px solid var(--pf-line); background: var(--pf-card-bg); }
    .pf-mm__del { color: var(--red-text, #b91c1c); }
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
  /** Bound by a host that owns the search (Test Master's band pill); it
   *  replaces this panel's own search box. null = standalone. */
  readonly bandQuery = input<string | null>(null);
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
    this.editor.set(null);
  }

  /** Rows of the active master, filtered by the search box over every column. */
  readonly rows = computed<unknown[]>(() => {
    const q = (this.bandQuery() ?? this.query()).trim().toLowerCase();
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
        { headerName: 'Organism group', field: 'organismGroup', minWidth: 170, flex: 1.1, sort: 'asc' },
        { headerName: 'Antibiotic', field: 'antibiotic', minWidth: 200, flex: 1.4 },
        { headerName: 'Short', field: 'shortLabel', minWidth: 90, maxWidth: 110 },
        { headerName: 'Disk', field: 'diskLabel', minWidth: 95, maxWidth: 115 },
        { headerName: 'S ≥ mm', field: 'susceptibleMin', minWidth: 85, maxWidth: 100,
          cellStyle: { color: '#34d399', fontWeight: '600' } },
        { headerName: 'I mm', minWidth: 85, maxWidth: 105, cellStyle: { color: '#fbbf24', fontWeight: '600' },
          valueGetter: (p: ValueGetterParams<Breakpoint>) => p.data?.zoneI
            ?? (p.data?.susceptibleMin != null && p.data?.resistantMax != null
                ? this.iWindow(p.data.susceptibleMin, p.data.resistantMax) : '') },
        { headerName: 'R ≤ mm', field: 'resistantMax', minWidth: 85, maxWidth: 100,
          cellStyle: { color: '#f87171', fontWeight: '600' } },
        { headerName: 'MIC S', field: 'micS', minWidth: 85, maxWidth: 110, cellStyle: { color: '#34d399', fontWeight: '500' } },
        { headerName: 'MIC I', field: 'micI', minWidth: 85, maxWidth: 110, cellStyle: { color: '#fbbf24', fontWeight: '500' } },
        { headerName: 'MIC R', field: 'micR', minWidth: 85, maxWidth: 110, cellStyle: { color: '#f87171', fontWeight: '500' } },
        { headerName: 'Urine', field: 'urineOnly', minWidth: 80, maxWidth: 95, cellRenderer: this.yesNo },
        { headerName: 'Origin', minWidth: 95, maxWidth: 115,
          valueGetter: (p: ValueGetterParams<Breakpoint>) => p.data?.tenant ? 'Lab' : 'CLSI Ed36' },
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
  /** Delete / Revert on the open editor is running. */
  readonly deleting = signal(false);
  /** The organism panel row (antibiotic) whose toggle / remove is running. */
  readonly mapBusy = signal<string | null>(null);
  /** First load: the four masters answer before the grid shows (held, no flash). */
  private readonly listHold = createLoadHold(true);
  readonly listSkeleton = this.listHold.active;
  private firstLoadsLeft = 4;
  private firstLoadDone = () => { if (--this.firstLoadsLeft === 0) this.listHold.done(); };

  onRowClicked(e: RowClickedEvent) {
    if (this.section() === 'organisms') {
      this.editor.set(null);
      this.selOrg.set(e.data as MicroOrganism);
      this.addAbxName.set(''); this.addS.set(null); this.addR.set(null);
      return;
    }
    // Other masters: row click opens the editor on a copy of the row.
    this.startEdit(this.section(), e.data as EdModel);
  }

  // ── Create / edit (tenant overlay — the standard is never mutated) ──
  readonly editor = signal<{ kind: MasterKey; isNew: boolean; model: EdModel } | null>(null);
  /** Tells the host (Test Master's band) the row editor is open, so the
   *  band's Create steps down and the editor's Save is the ONE primary. */
  readonly editingChange = output<boolean>();
  private readonly _emitEditing = effect(() => this.editingChange.emit(this.editor() !== null));
  readonly gramOptions: PfSelectOption<string>[] = [
    'Gram Positive', 'Gram Negative', 'Acid-Fast Bacilli', 'Variable', 'Not Applicable',
  ].map(g => ({ value: g, label: g }));
  singular(k: MasterKey): string {
    return k === 'specimens' ? 'specimen' : k === 'organisms' ? 'organism'
      : k === 'antibiotics' ? 'antibiotic' : 'breakpoint';
  }
  abxNameOptions(): PfSelectOption<string>[] {
    return this.antibiotics().map(a => ({ value: a.name, label: a.name, hint: a.abxClass ?? undefined }));
  }
  startCreate() {
    this.selOrg.set(null);
    const kind = this.section();
    const model: EdModel = kind === 'antibiotics'
      ? { astApplicable: true, diskDiffusion: true, micTesting: false }
      : kind === 'organisms' ? { astApplicable: true } : {};
    this.editor.set({ kind, isNew: true, model });
  }
  startEdit(kind: MasterKey, row: EdModel) {
    this.selOrg.set(null);
    this.editor.set({ kind, isNew: false, model: { ...row } });
  }
  patchEd(field: string, value: unknown) {
    const ed = this.editor();
    if (ed) this.editor.set({ ...ed, model: { ...ed.model, [field]: value } as EdModel });
  }
  edValid(): boolean {
    const ed = this.editor();
    if (!ed) return false;
    const m = ed.model;
    if (ed.kind === 'breakpoints') {
      const s = m.susceptibleMin ?? null, r = m.resistantMax ?? null;
      const zoneOk = (s == null && r == null) || (s != null && r != null && r >= 1 && s > r);
      const any = (s != null && r != null) || !!m.micS || !!m.micR;
      return !!m.organismGroup && !!m.antibiotic && zoneOk && any;
    }
    return !!m.name;
  }
  /** A standard row exists behind this lab row (delete = revert, not remove). */
  hasStandard(ed: { kind: MasterKey; model: EdModel }): boolean {
    return ed.kind === 'breakpoints'
      ? true   // Ed36 may define the pair; the backend answers precisely on delete
      : String(ed.model.code ?? '').length > 0 && !String(ed.model.code).includes('-L');
  }
  saveEd() {
    const ed = this.editor();
    if (!ed || !this.edValid()) return;
    this.saving.set(true);
    const m = ed.model;
    const done = (msg: string) => {
      this.saving.set(false);
      this.toasts.success(msg);
      this.editor.set(null);
      this.reloadSection(ed.kind);
    };
    const fail = (e: { message?: string }) => { this.saving.set(false); this.toasts.error(e?.message || 'Could not save'); };
    if (ed.kind === 'breakpoints') {
      this.api.post('/api/microbiology/breakpoints', {
        organismGroup: m.organismGroup, antibiotic: m.antibiotic,
        susceptibleMin: m.susceptibleMin ?? null, resistantMax: m.resistantMax ?? null,
        shortLabel: m.shortLabel ?? null, diskLabel: m.diskLabel ?? null,
        micS: m.micS ?? null, micI: m.micI ?? null, micR: m.micR ?? null,
        urineOnly: m.urineOnly === true,
      }).subscribe({ next: () => done('Breakpoint saved'), error: fail });
      return;
    }
    const path = `/api/microbiology/${ed.kind}`;
    this.api.post(path, { ...m, code: m.code ?? null }).subscribe({
      next: () => done(`${this.singular(ed.kind)} saved`), error: fail,
    });
  }
  deleteEd() {
    const ed = this.editor();
    if (!ed || this.deleting()) return;
    const m = ed.model;
    this.deleting.set(true);
    const done = () => { this.deleting.set(false); this.toasts.success('Removed — the standard resurfaces where one exists'); this.editor.set(null); this.reloadSection(ed.kind); };
    const fail = (e: { message?: string }) => { this.deleting.set(false); this.toasts.error(e?.message || 'Could not remove'); };
    if (ed.kind === 'breakpoints') {
      this.api.delete(`/api/microbiology/breakpoints?organismGroup=${encodeURIComponent(String(m.organismGroup))}&antibiotic=${encodeURIComponent(String(m.antibiotic))}`)
        .subscribe({ next: done, error: fail });
      return;
    }
    this.api.delete(`/api/microbiology/${ed.kind}/${encodeURIComponent(String(m.code))}`)
      .subscribe({ next: done, error: fail });
  }
  private reloadSection(kind: MasterKey) {
    if (kind === 'breakpoints') { this.reloadBreakpoints(); return; }
    const url = kind === 'antibiotics' ? '/api/microbiology/antibiotics?all=true' : `/api/microbiology/${kind}`;
    this.api.get<never[]>(url).subscribe({
      next: l => {
        if (kind === 'specimens') this.specimens.set(l ?? []);
        else if (kind === 'organisms') this.organisms.set(l ?? []);
        else this.antibiotics.set(l ?? []);
      },
      error: () => { /* stale list stays */ },
    });
  }

  /** The breakpoint group this organism's panel reads from: exact match on
   *  its master Group first, then family keywords, else the group itself
   *  (which is where lab-authored rows for uncovered organisms live). */
  resolveGroup(org: MicroOrganism): string {
    const name = org.name.toLowerCase();
    // Name-level splits outrank the genus group (Salmonella is an
    // Enterobacterales; both Neisseria share one master group).
    if (name.includes('salmonella') || name.includes('shigella')) return 'Salmonella & Shigella';
    if (name.includes('gonorrhoeae')) return 'Neisseria gonorrhoeae';
    if (name.includes('meningitidis')) return 'Neisseria meningitidis';
    const s = (org.group || org.name).trim();
    const l = s.toLowerCase();
    for (const b of new Set(this.breakpoints().map(x => x.organismGroup)))
      if (b.toLowerCase() === l) return b;
    if (l.includes('pneumococc')) return 'Pneumococcus';
    if (l.includes('group a strep') || l.includes('group b strep') || l.includes('hemolytic strep') || l.includes('β-hemolytic'))
      return 'β-Hemolytic Streptococcus';
    if (l.includes('viridans') || l.includes('anginosus') || l.includes('nutritionally variant'))
      return 'Viridans Group Streptococci';
    if (l.includes('coagulase-negative')) return 'Coagulase-Negative Staphylococci';
    if (l.includes('staphylococc')) return 'Staphylococcus';
    if (l.includes('enterococc')) return 'Enterococcus';
    if (l.includes('pseudomon')) return 'Pseudomonas';
    if (l.includes('acinetobacter')) return 'Acinetobacter';
    if (l.includes('stenotrophomonas') || l.includes('maltophilia')) return 'Stenotrophomonas';
    if (l.includes('haemophilus')) return 'Haemophilus';
    for (const k of ['bacteroides', 'prevotella', 'porphyromonas', 'fusobacterium', 'clostridi',
      'cutibacterium', 'veillonella', 'anaerob', 'actinomyces', 'lactobacillus'])
      if (l.includes(k)) return 'Anaerobes';
    for (const k of ['achromobacter', 'aeromonas', 'burkholderia', 'comamonas', 'delftia',
      'elizabethkingia', 'chryseobacterium', 'moraxella', 'ochrobactrum', 'pasteurella',
      'ralstonia', 'shewanella', 'sphingomonas', 'vibrio', 'non-fermenter', 'gram-negative bacilli'])
      if (l.includes(k)) return 'Other Non-Enterobacterales';
    for (const k of ['enterobacterales', 'escherichia', 'klebsiella', 'proteus', 'enterobacter',
      'citrobacter', 'serratia', 'morganella', 'providencia'])
      if (l.includes(k)) return 'Enterobacterales';
    return s;
  }
  /** The rows effective for THIS organism: its group's rows, with any row
   *  pinned to this organism outranking the group row per antibiotic —
   *  so a toggle/edit here never leaks to the rest of the group. */
  mappedFor(org: MicroOrganism): Breakpoint[] {
    const g = this.resolveGroup(org).toLowerCase();
    const name = org.name.toLowerCase();
    const candidates = this.breakpoints().filter(b =>
      b.organismGroup.toLowerCase() === g
      && (!b.organism || b.organism.toLowerCase() === name));
    const byAbx = new Map<string, Breakpoint>();
    for (const b of candidates) {
      const k = b.antibiotic.toLowerCase();
      const cur = byAbx.get(k);
      if (!cur || (!cur.organism && b.organism)) byAbx.set(k, b);
    }
    return [...byAbx.values()].sort((a, b) => a.antibiotic.localeCompare(b.antibiotic));
  }
  addableAbx(org: MicroOrganism): PfSelectOption<string>[] {
    const have = new Set(this.mappedFor(org).map(b => b.antibiotic.toLowerCase()));
    return this.antibiotics()
      .filter(a => !have.has(a.name.toLowerCase()))
      .map(a => ({ value: a.name, label: a.name, hint: a.abxClass ?? undefined }));
  }
  /** The Intermediate window — derived, mm between the cutoffs. */
  iWindow(s: number, r: number): string {
    return s - 1 >= r + 1 ? `${r + 1}–${s - 1}` : '—';
  }
  /** Typing the I window ("14–16", "14-16", or one number) sets the cutoffs
   *  around it: R ≤ low−1, S ≥ high+1 — same behaviour as the bench table. */
  setAddI(raw: string) {
    const t = (raw ?? '').trim();
    if (!t) { this.addS.set(null); this.addR.set(null); return; }
    const m = t.match(/^(\d+)\s*[-–—]\s*(\d+)$/) ?? t.match(/^(\d+)$/);
    if (!m) return;
    const lo = parseInt(m[1], 10);
    const hi = m[2] != null ? parseInt(m[2], 10) : lo;
    const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
    this.addR.set(a - 1);
    this.addS.set(b + 1);
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
      organism: org.name,          // pinned: this organism's panel alone
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
  /** Only enabled drugs reach the bench's AST table for this organism —
   *  the toggle writes an organism-pinned row, so ONLY this organism moves. */
  toggleMapping(b: Breakpoint) {
    const org = this.selOrg();
    const next = b.enabled === false;
    if (this.mapBusy() === b.antibiotic) return;
    this.mapBusy.set(b.antibiotic);
    this.api.post('/api/microbiology/breakpoints/toggle', {
      organismGroup: b.organismGroup, antibiotic: b.antibiotic, enabled: next,
      organism: org?.name ?? b.organism ?? null,
    }).subscribe({
      next: () => {
        this.mapBusy.set(null);
        this.toasts.success(`${b.antibiotic} ${next ? 'enabled' : 'disabled'} for this panel`);
        this.reloadBreakpoints();
      },
      error: (e: { message?: string }) => { this.mapBusy.set(null); this.toasts.error(e?.message || 'Could not toggle'); },
    });
  }
  removeMapping(org: MicroOrganism, b: Breakpoint) {
    const orgQ = b.organism ? `&organism=${encodeURIComponent(b.organism)}` : '';
    if (this.mapBusy() === b.antibiotic) return;
    this.mapBusy.set(b.antibiotic);
    this.api.delete(`/api/microbiology/breakpoints?organismGroup=${encodeURIComponent(b.organismGroup)}&antibiotic=${encodeURIComponent(b.antibiotic)}${orgQ}`)
      .subscribe({
        next: () => { this.mapBusy.set(null); this.toasts.success(`${b.antibiotic} removed`); this.reloadBreakpoints(); },
        error: (e: { message?: string }) => { this.mapBusy.set(null); this.toasts.error(e?.message || 'Could not remove the mapping'); },
      });
  }
  private reloadBreakpoints() {
    this.api.get<Breakpoint[]>('/api/microbiology/breakpoints').subscribe({
      next: l => this.breakpoints.set(l ?? []),
      error: () => { /* keep the stale list */ },
    });
  }

  ngOnInit() {
    this.destroyRef.onDestroy(() => this.listHold.cancel());
    this.api.get<MicroOrganism[]>('/api/microbiology/organisms').subscribe({
      next: l => { this.organisms.set(l ?? []); this.firstLoadDone(); },
      error: () => { this.firstLoadDone(); this.toasts.error('Could not load the organism master.'); },
    });
    this.api.get<MicroSpecimen[]>('/api/microbiology/specimens').subscribe({
      next: l => { this.specimens.set(l ?? []); this.firstLoadDone(); },
      error: () => { this.firstLoadDone(); this.toasts.error('Could not load the specimen master.'); },
    });
    this.api.get<MicroAntibiotic[]>('/api/microbiology/antibiotics?all=true').subscribe({
      next: l => { this.antibiotics.set(l ?? []); this.firstLoadDone(); },
      error: () => { this.firstLoadDone(); this.toasts.error('Could not load the antibiotic master.'); },
    });
    this.api.get<Breakpoint[]>('/api/microbiology/breakpoints').subscribe({
      next: l => { this.breakpoints.set(l ?? []); this.firstLoadDone(); },
      error: () => { this.firstLoadDone(); this.toasts.error('Could not load the CLSI breakpoints.'); },
    });
  }
  private readonly destroyRef = inject(DestroyRef);
}
