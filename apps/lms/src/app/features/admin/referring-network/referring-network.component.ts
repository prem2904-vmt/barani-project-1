import { ViewStateService } from '../../../shared/services/view-state.service';
import { stableJson } from '../../../shared/utils/dirty-snapshot';
import { SkelGridComponent } from '../../../shared/components/skeleton-frame/skeleton-frame.component';
import { ChangeDetectionStrategy, Component, OnInit, TemplateRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import {
  AllCommunityModule, CellClickedEvent, ColDef, ICellRendererParams, ModuleRegistry,
} from 'ag-grid-community';
import { DataGridComponent } from '../../../shared/components/data-grid/data-grid.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { hospitalErrors, referralDoctorErrors } from '../../../shared/forms/contact-validate';
import { validatePhoneNumber } from '../../../shared/forms/validate';
import { ApiError } from '../../../shared/models/api-response.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ThemeService } from '../../../core/services/theme.service';
import { bandFilter } from '../../../shared/utils/band-search';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { SkeletonRowsComponent, SkeletonTableComponent } from '../../../shared/primitives/skeleton-kit.component';
import { NgTemplateOutlet } from '@angular/common';
import {
  SG_ICON, SG_PHONE_MQ, SgAction, SgStatus, sgActions, sgActionsCol, sgBare, sgByStatus, sgCell, sgChips, sgMedia, sgPillCol,
  sgRowOff, sgStatusOptions, sgGridTheme,
} from '../../../shared/settings-grid/settings-grid';
import { heldFlag } from '../../../shared/utils/min-duration';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import {
  ALL_HOSPITALS, Doctor, Hospital, NO_HOSPITAL,
  doctorHospitalIds, doctorHospitals, doctorHospitalsLabel, filterDoctorsByHospital, linkDiff,
} from './referring-network.model';
import { ReferringPasteComponent } from './referring-paste.component';
import type { PasteMode } from './referring-paste';
import { numberCol, textCol } from '../../../shared/utils/work-grid';

ModuleRegistry.registerModules([AllCommunityModule]);

type View = 'hospitals' | 'doctors';

/** Doctor editor draft: the doctor plus the hospital set being edited. */
type DoctorDraft = Partial<Doctor> & { hospitalIds: string[] };
/** Hospital editor draft: the hospital plus the doctors attached to it. */
type HospitalDraft = Partial<Hospital> & { doctorIds: string[] };

/**
 * Admin → Referring Network. Two views (band toggle):
 *  Hospitals — hospital list + the focused hospital's doctors (add a new
 *              doctor there, link existing doctors, remove one from it).
 *  Doctors   — every doctor in one AG-Grid with a Hospitals column; filter
 *              by hospital or "Independent". A doctor can be created with
 *              no hospital and linked to one or more hospitals later.
 *
 * Doctor-first (owner 2026-09-30): both entry points exist — "Add doctor"
 * (optionally pick hospitals) and "Add hospital" (optionally attach existing
 * doctors). The server keeps the many-to-many links; this screen only sends
 * the wanted sets.
 *
 * Auto-create flow: anything reception types in order-create that doesn't
 * exist gets a stub Hospital + Doctor row here automatically. Soft-deletes
 * only — historical orders keep the names they were placed with.
 */
@Component({
  selector: 'pf-referring-network',
  standalone: true,
  imports: [SkelGridComponent, BusyDirective, SkeletonRowsComponent, SkeletonTableComponent, FormsModule, ScreenHeaderComponent, TouchButtonComponent,
    HeroBandComponent, SegmentedComponent, SelectComponent, DataGridComponent, NgTemplateOutlet, ReferringPasteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- Band pill (owner): search + the Hospitals / Doctors switch ride in
             the pill; the view's ONE primary ("Add hospital" / "Add doctor")
             sits top-right. -->
        <pf-hero-band [back]="true"
                      [placeholder]="view() === 'hospitals' ? 'Search hospitals — name, code, phone, address…' : 'Search doctors — name, hospital, department, phone…'"
                      [value]="view() === 'hospitals' ? hospitalSearch() : doctorSearch()"
                      (valueChange)="onBandSearch($event)">
          
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Admin · Referring network"
        title="Hospitals &amp; doctors"
        subtitle="Manage the hospitals and doctors that refer patients to your lab. A doctor can work independently or at several hospitals.">
        <pf-touch-btn actions size="sm" variant="secondary" (pressed)="openDoctorEditor(null, null)">Add doctor</pf-touch-btn>
        <pf-touch-btn actions size="sm" variant="primary" (pressed)="openHospitalEditor(null)">
          <span icon-left aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                 stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </span>
          Add hospital
        </pf-touch-btn>
      </pf-screen-header>

      <div class="pf-classic-only pf-rn-classic-seg">
        <pf-segmented size="sm" [options]="viewOptions()" [value]="view()" (valueChange)="setView($event)"></pf-segmented>
      </div>

      <!-- ONE Test Master grid (owner 2026-11-17: "a grid, with filters"): Doctors (default) or Hospitals.
           Inside the Settings shell the grid is bare and the shell's card head shows #headTools. -->
      <div class="pf-band-body pf-band-body--fill">
        <section class="pf-card pf-sg-main pf-rn-main" [class.pf-sg-main--bare]="bare" [attr.aria-label]="view() === 'doctors' ? 'Doctors' : 'Hospitals'">
          <header class="pf-card__head pf-sg-main__head">
            <span class="pf-card__icon" aria-hidden="true">
              @if (view() === 'doctors') {
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              } @else {
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9h.01M9 13h.01M9 17h.01"/></svg>
              }
            </span>
            <span class="pf-card__label">{{ view() === 'doctors' ? 'Doctors' : 'Hospitals' }}</span>
            <span class="pf-card__spacer"></span>
            <ng-container *ngTemplateOutlet="headToolsTpl"></ng-container>
          </header>
          <div class="pf-sg-main__body">
            @if (view() === 'doctors' ? loadingDoctorsShown() : loadingHospitalsShown()) {
              <pf-skel-grid class="pf-sg-skel" [rows]="30" [columns]="6" [label]="view() === 'doctors' ? 'Loading doctors…' : 'Loading hospitals…'"></pf-skel-grid>
            }
            @if (view() === 'doctors') {
              <pf-data-grid viewStateKey="admin.referring.g1" [rowData]="gridDoctors()" [columnDefs]="doctorColDefs()" [defaultColDef]="defaultColDef" [getRowId]="rowId" [getRowClass]="doctorRowClass" [suppressCellFocus]="true"></pf-data-grid>
              @if (!loadingDoctorsShown() && gridDoctors().length === 0) {
                <div class="pf-sg-empty"><p class="pf-sg-empty__title pf-rn-empty">{{ emptyDoctorsText() }}</p></div>
              }
            } @else {
              <pf-data-grid viewStateKey="admin.referring.g2" [clickable]="true" [rowData]="gridHospitals()" [columnDefs]="hospitalColDefs()" [defaultColDef]="defaultColDef" [getRowId]="hospitalRowId" [getRowClass]="hospitalRowClass" [suppressCellFocus]="true" (cellClicked)="onHospitalCell($event)"></pf-data-grid>
              @if (!loadingHospitalsShown() && gridHospitals().length === 0) {
                <div class="pf-sg-empty"><p class="pf-sg-empty__title pf-rn-empty">{{ hospitalSearch() ? 'No hospitals match.' : 'No hospitals yet. Use Add hospital to start.' }}</p></div>
              }
            }
          </div>
        </section>
      </div>

      <!-- Head tools: Doctors | Hospitals, the hospital filter (doctors), All / Active / Inactive, count.
           Exposed as headTools so the Settings shell can show them in ITS card head. -->
      <ng-template #headToolsTpl>
        <!-- Left → right: count · dynamic filters · the STATIC Doctors | Hospitals switch at the far right (owner). -->
        <span class="pf-sg-count pf-num">{{ countLabel() }}</span>
        @if (view() === 'doctors') {
          <pf-select class="pf-rn-hfilter" size="sm" [searchable]="true"
                     [options]="hospitalFilterOptions()" [value]="hospitalFilter()"
                     (valueChange)="setHospitalFilter($event)" placeholder="All hospitals"></pf-select>
        }
        <pf-segmented class="pf-sg-status-filter" size="sm" [options]="statusOptions()" [value]="status()"
                      (valueChange)="status.set($event)" aria-label="Filter by status"></pf-segmented>
        <pf-segmented class="pf-rn-viewseg" size="sm" [options]="viewOptions()" [value]="view()"
                      (valueChange)="setView($event)" aria-label="Doctors or hospitals"></pf-segmented>
            <!-- The page's action, IN the pane (owner: no band buttons in Settings), after the head tools. -->
            
            @if (view() === 'hospitals') {
              <button type="button" class="pf-btn pf-btn--secondary pf-sg-act press pf-rn-add"
                      [disabled]="editorOpen()" (click)="openHospitalEditor(null)"
                      aria-label="Add hospital">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                Add hospital
              </button>
            } @else {
              <button type="button" class="pf-btn pf-btn--secondary pf-sg-act press pf-rn-add-doc"
                      [disabled]="editorOpen()" (click)="openDoctorEditor(null, filterHospital()?.id ?? null)"
                      aria-label="Add doctor">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                Add doctor
              </button>
            }
            <button type="button" class="pf-btn pf-btn--secondary pf-sg-act press pf-rn-paste"
                    [disabled]="editorOpen()" (click)="openPaste()" data-testid="rn-paste-open"
                    [attr.aria-label]="view() === 'doctors' ? 'Paste doctors from a sheet' : 'Paste hospitals from a sheet'">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>
              Paste from sheet
            </button>
    </ng-template>

      <!-- ── Paste from a sheet (bulk add) ──────────────────────── -->
      @if (paste(); as pm) {
        <pf-referring-paste [mode]="pm" [doctors]="doctorsAll()" [hospitals]="hospitals()"
                            (saved)="onPasteSaved()" (closed)="paste.set(null)"></pf-referring-paste>
      }

      <!-- ── Hospital editor modal ─────────────────────────────── -->
      @if (hospitalEditor(); as he) {
        <div class="pf-rn-modal-bd" (click)="closeHospitalEditor()"></div>
        <div class="pf-rn-modal pf-card" role="dialog" aria-modal="true" [attr.aria-label]="he.id ? 'Edit hospital' : 'Add hospital'">
          <span class="pf-sheet__handle" aria-hidden="true"></span>
          <header class="pf-card__head pf-rn-modal__hdr">
            <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9h.01M9 13h.01M9 17h.01"/></svg></span>
            <h3 class="pf-card__label">{{ he.id ? 'Edit hospital' : 'Add hospital' }}</h3>
            <span class="pf-card__spacer"></span>
            <button type="button" class="pf-btn pf-btn--icon pf-rn-modal__close press" (click)="closeHospitalEditor()" aria-label="Close" title="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </header>
          <div class="pf-rn-modal__body">
            <label class="pf-rn-fld">
              <span>Name <span class="pf-rn-fld__req">*</span></span>
              <input class="pf-input" type="text" [(ngModel)]="he.name" (input)="clearHospErr('name')" [class.pf-input--error]="hospErr('name')" placeholder="Apollo Hospitals" />
              @if (hospErr('name')) { <p class="pf-rn-fld__err">{{ hospErr('name') }}</p> }
            </label>
            <label class="pf-rn-fld">
              <span>Code</span>
              <input class="pf-input" type="text" [(ngModel)]="he.code" (input)="clearHospErr('code')" [class.pf-input--error]="hospErr('code')" placeholder="APO" />
              @if (hospErr('code')) { <p class="pf-rn-fld__err">{{ hospErr('code') }}</p> }
            </label>
            <label class="pf-rn-fld pf-rn-fld--wide">
              <span>Address</span>
              <input class="pf-input" type="text" [(ngModel)]="he.address" (input)="clearHospErr('address')" [class.pf-input--error]="hospErr('address')" placeholder="21 Greams Lane, Chennai" />
              @if (hospErr('address')) { <p class="pf-rn-fld__err">{{ hospErr('address') }}</p> }
            </label>
            <label class="pf-rn-fld">
              <span>Phone</span>
              <input class="pf-input" type="tel" [(ngModel)]="he.phone" (input)="clearHospErr('phone')" [class.pf-input--error]="hospErr('phone')" placeholder="+91 44 1234 5678" />
              @if (hospErr('phone')) { <p class="pf-rn-fld__err">{{ hospErr('phone') }}</p> }
            </label>
            <label class="pf-rn-fld">
              <span>Email</span>
              <input class="pf-input" type="email" [(ngModel)]="he.email" (input)="clearHospErr('email')" [class.pf-input--error]="hospErr('email')" placeholder="referrals@apollo.com" />
              @if (hospErr('email')) { <p class="pf-rn-fld__err">{{ hospErr('email') }}</p> }
            </label>
            <label class="pf-rn-fld">
              <span>GSTIN</span>
              <input class="pf-input" type="text" [(ngModel)]="he.gstin" (input)="clearHospErr('gstin')" [class.pf-input--error]="hospErr('gstin')" placeholder="33AABCA1234A1Z5" />
              @if (hospErr('gstin')) { <p class="pf-rn-fld__err">{{ hospErr('gstin') }}</p> }
            </label>
            <div class="pf-rn-fld pf-rn-fld--wide">
              <span>Doctors <span class="pf-rn-fld__opt">optional</span></span>
              <pf-select class="pf-rn-docsel" [multiple]="true" [searchable]="true"
                         [options]="doctorOptions()" [values]="he.doctorIds"
                         (valuesChange)="setHospitalDoctors($event)"
                         placeholder="Attach doctors you already have"></pf-select>
            </div>
            <label class="pf-rn-fld pf-rn-fld--wide">
              <span>Notes</span>
              <textarea class="pf-input" rows="2" [(ngModel)]="he.notes" placeholder="Panel rates, commission deal, billing quirks…"></textarea>
            </label>
          </div>
          <footer class="pf-rn-modal__ftr">
            @if (he.id) {
              <button type="button" class="pf-btn pf-btn--tertiary press" (click)="deactivateHospital()">Deactivate</button>
            }
            <span class="flex-1"></span>
            <button type="button" class="pf-btn pf-btn--secondary press" (click)="closeHospitalEditor()">Cancel</button>
            <button type="button" class="pf-btn pf-btn--primary press"
                    [disabled]="!he.name?.trim() || savingHospital() || !hospitalChanged()" [pfBusyInactive]="!he.name?.trim() || savingHospital() || !hospitalChanged()"
                    [attr.title]="hospitalChanged() || savingHospital() ? null : 'No changes to save'" [pfBusy]="savingHospital()" pfBusyLabel="Saving…" (click)="saveHospital()">
              @if (savingHospital()) { Saving… } @else { Save hospital }
            </button>
          </footer>
        </div>
      }

      <!-- ── Link existing doctors to a hospital ───────────────── -->
      @if (linkEditor(); as le) {
        <div class="pf-rn-modal-bd" (click)="closeLinkEditor()"></div>
        <div class="pf-rn-modal pf-rn-modal--sm pf-card" role="dialog" aria-modal="true" aria-label="Link doctors">
          <span class="pf-sheet__handle" aria-hidden="true"></span>
          <header class="pf-card__head pf-rn-modal__hdr">
            <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></span>
            <h3 class="pf-card__label">Link doctors</h3>
            <span class="pf-card__spacer"></span>
            <button type="button" class="pf-btn pf-btn--icon pf-rn-modal__close press" (click)="closeLinkEditor()" aria-label="Close" title="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </header>
          <div class="pf-rn-modal__body pf-rn-modal__body--one">
            <p class="pf-rn-modal__lead">Doctors you already have who also refer from <b>{{ le.hospitalName }}</b>. Their other hospitals stay as they are.</p>
            <div class="pf-rn-fld">
              <span>Doctors</span>
              <pf-select class="pf-rn-docsel" [multiple]="true" [searchable]="true"
                         [options]="linkableDoctorOptions()" [values]="le.doctorIds"
                         (valuesChange)="setLinkDoctors($event)"
                         placeholder="Search doctors"></pf-select>
            </div>
          </div>
          <footer class="pf-rn-modal__ftr">
            <span class="flex-1"></span>
            <button type="button" class="pf-btn pf-btn--secondary press" (click)="closeLinkEditor()">Cancel</button>
            <button type="button" class="pf-btn pf-btn--primary press"
                    [disabled]="!le.doctorIds.length || savingLink()" [pfBusy]="savingLink()" pfBusyLabel="Linking…" (click)="saveLinks()">
              @if (savingLink()) { Linking… } @else { Link doctors }
            </button>
          </footer>
        </div>
      }

      <!-- ── Doctor editor modal ───────────────────────────────── -->
      @if (doctorEditor(); as de) {
        <div class="pf-rn-modal-bd" (click)="closeDoctorEditor()"></div>
        <div class="pf-rn-modal pf-card" role="dialog" aria-modal="true" [attr.aria-label]="de.id ? 'Edit doctor' : 'Add doctor'">
          <span class="pf-sheet__handle" aria-hidden="true"></span>
          <header class="pf-card__head pf-rn-modal__hdr">
            <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
            <h3 class="pf-card__label">{{ de.id ? 'Edit doctor' : 'Add doctor' }}</h3>
            <span class="pf-card__spacer"></span>
            <button type="button" class="pf-btn pf-btn--icon pf-rn-modal__close press" (click)="closeDoctorEditor()" aria-label="Close" title="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </header>
          <div class="pf-rn-modal__body">
            <label class="pf-rn-fld pf-rn-fld--wide">
              <span>Name <span class="pf-rn-fld__req">*</span></span>
              <input class="pf-input" type="text" [(ngModel)]="de.name" (input)="clearDocErr('name')" [class.pf-input--error]="docErr('name')" placeholder="Dr. Priya Krishnan" />
              @if (docErr('name')) { <p class="pf-rn-fld__err">{{ docErr('name') }}</p> }
            </label>
            <div class="pf-rn-fld pf-rn-fld--wide">
              <span>Hospitals <span class="pf-rn-fld__opt">optional — leave empty for an independent doctor</span></span>
              <pf-select class="pf-rn-hospsel" [multiple]="true" [searchable]="true"
                         [options]="hospitalOptions()" [values]="de.hospitalIds"
                         (valuesChange)="setDoctorHospitals($event)"
                         placeholder="No hospital (independent)"></pf-select>
            </div>
            <label class="pf-rn-fld">
              <span>Designation</span>
              <input class="pf-input" type="text" [(ngModel)]="de.designation" (input)="clearDocErr('designation')" [class.pf-input--error]="docErr('designation')" placeholder="Consultant Physician" />
              @if (docErr('designation')) { <p class="pf-rn-fld__err">{{ docErr('designation') }}</p> }
            </label>
            <label class="pf-rn-fld">
              <span>Department</span>
              <input class="pf-input" type="text" [(ngModel)]="de.department" (input)="clearDocErr('department')" [class.pf-input--error]="docErr('department')" placeholder="Cardiology" />
              @if (docErr('department')) { <p class="pf-rn-fld__err">{{ docErr('department') }}</p> }
            </label>
            <label class="pf-rn-fld">
              <span>Qualification</span>
              <input class="pf-input" type="text" [(ngModel)]="de.qualification" (input)="clearDocErr('qualification')" [class.pf-input--error]="docErr('qualification')" placeholder="MBBS, MD" />
              @if (docErr('qualification')) { <p class="pf-rn-fld__err">{{ docErr('qualification') }}</p> }
            </label>
            <label class="pf-rn-fld">
              <span>Registration #</span>
              <input class="pf-input" type="text" [(ngModel)]="de.registrationNo" (input)="clearDocErr('registrationNo')" [class.pf-input--error]="docErr('registrationNo')" placeholder="TN-12345" />
              @if (docErr('registrationNo')) { <p class="pf-rn-fld__err">{{ docErr('registrationNo') }}</p> }
            </label>
            <label class="pf-rn-fld">
              <span>Phone</span>
              <input class="pf-input" type="tel" [(ngModel)]="de.phone" (input)="clearDocErr('phone')" [class.pf-input--error]="docErr('phone')" placeholder="+91 98765 43210" />
              @if (docErr('phone')) { <p class="pf-rn-fld__err">{{ docErr('phone') }}</p> }
            </label>
            <label class="pf-rn-fld">
              <span>Email</span>
              <input class="pf-input" type="email" [(ngModel)]="de.email" (input)="clearDocErr('email')" [class.pf-input--error]="docErr('email')" placeholder="priya@apollo.com" />
              @if (docErr('email')) { <p class="pf-rn-fld__err">{{ docErr('email') }}</p> }
            </label>
          </div>
          <footer class="pf-rn-modal__ftr">
            <span class="flex-1"></span>
            <button type="button" class="pf-btn pf-btn--secondary press" (click)="closeDoctorEditor()">Cancel</button>
            <button type="button" class="pf-btn pf-btn--primary press"
                    [disabled]="!de.name?.trim() || savingDoctor() || !doctorChanged()" [pfBusyInactive]="!de.name?.trim() || savingDoctor() || !doctorChanged()"
                    [attr.title]="doctorChanged() || savingDoctor() ? null : 'No changes to save'" [pfBusy]="savingDoctor()" pfBusyLabel="Saving…" (click)="saveDoctor()">
              @if (savingDoctor()) { Saving… } @else { Save doctor }
            </button>
          </footer>
        </div>
      }
    </section>
  `,
  styleUrls: ['../../../shared/settings-grid/settings-grid.scss'],
  styles: [`
    @use '../../../shared/styles/device-tier' as dt;
    .pf-rn-hfilter { flex: 0 1 220px; min-width: 160px; }
    .pf-rn-viewseg { flex-shrink: 0; }
    .pf-rn-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
      margin-top: 16px;
    }
    @media (min-width: 1024px) {
      .pf-rn-grid { grid-template-columns: 340px 1fr; align-items: start; }
    }
    :host-context(.design-new) .pf-rn-grid { margin-top: 0; }
    /* Panes = kit cards with the BILLING header; bodies pad inside. */
    .pf-rn-pane { min-height: 200px; overflow: visible; }
    .pf-rn-pane > :not(.pf-card__head) { margin-left: 14px; margin-right: 14px; }
    .pf-rn-pane > :last-child { margin-bottom: 14px; }
    .pf-rn-pane--list { gap: 10px; }
    .pf-rn-pane__hdr { margin: 0 0 10px; }
    .pf-rn-pane__title { margin: 0; }
    .pf-rn-pane__title--name { font-size: 15px; font-weight: 600; letter-spacing: 0; text-transform: none; color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-rn-pane__sub { margin: 2px 0 0; font-size: 12px; color: var(--text-tertiary); }
    .pf-rn-pane__count { margin-left: auto; font-size: 12px; font-weight: 500; color: var(--text-tertiary); }
    .pf-rn-hdrbtn { height: 36px; min-height: 36px; }
    .pf-rn-chip { height: 24px; font-size: 11.5px; }

    .pf-rn-search {
      width: 100%; height: 36px; padding: 0 12px;
      border-radius: 9px;
      border: 1px solid var(--glass-border);
      background: var(--glass-bg);
      color: var(--text-primary); font-size: 13px; outline: none;
    }
    .pf-rn-search:focus { border-color: rgba(168, 85, 247, 0.55); }

    .pf-rn-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; max-height: 60dvh; overflow-y: auto; }
    .pf-rn-row {
      display: flex; align-items: center; gap: 10px;
      width: 100%; padding: 10px 12px;
      background: transparent; border: 1px solid transparent;
      border-radius: 10px; text-align: left;
      color: var(--text-primary); cursor: pointer;
      transition: background 0.12s, border-color 0.12s;
    }
    .pf-rn-row:hover { background: var(--pf-chip-bg); }
    /* Neutral selected state (aria-selected), never violet (PF-PATTERN §3). */
    .pf-rn-row[aria-selected='true'] { background: var(--pf-sel-bg); border-color: var(--pf-sel-border); }
    .pf-rn-row__name { margin: 0; font-size: 13.5px; font-weight: 600; }
    .pf-rn-row__meta { margin: 2px 0 0; font-size: 11.5px; color: var(--text-tertiary); }
    .pf-rn-row__inactive { color: var(--text-secondary); font-weight: 600; }

    .pf-rn-empty { padding: 24px 8px; text-align: center; color: var(--text-tertiary); font-size: 13px; }
    .pf-rn-placeholder { padding: 50px 16px; text-align: center; }
    .pf-rn-placeholder__title { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .pf-rn-placeholder__sub { margin: 6px 0 0; font-size: 12px; color: var(--text-tertiary); }

    .pf-rn-doc-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .pf-rn-doc {
      display: flex; gap: 12px;
      padding: 12px;
      background: var(--pf-card-bg);
      border: 1px solid var(--pf-line);
      border-radius: var(--pf-radius);
    }
    .pf-rn-doc__main { flex: 1; min-width: 0; }
    .pf-rn-doc__name { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .pf-rn-doc__meta { margin: 2px 0 0; font-size: 12.5px; color: var(--text-secondary); }
    .pf-rn-doc__sub  { margin: 2px 0 0; font-size: 12px; color: var(--text-tertiary); }
    .pf-rn-doc__contact { margin: 2px 0 0; font-size: 11.5px; color: var(--text-tertiary); }
    .pf-rn-doc__actions { display: inline-flex; align-items: flex-start; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
    .pf-rn-doc__btn {
      width: 28px; height: 28px; border-radius: 8px;
      background: transparent; border: 1px solid var(--glass-border);
      color: var(--text-secondary); cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .pf-rn-doc__btn:hover { background: var(--glass-bg-hover); color: var(--text-primary); }
    .pf-rn-doc__btn--danger:hover { color: #ef4444; border-color: rgba(239, 68, 68, 0.4); }

    /* ── Editor modal ─────────────────────────────────────────── */
    /* Editor modal = pf-card modal (web) / sheet above the navbar (phones). */
    .pf-rn-modal-bd { position: fixed; top: 0; left: 0; right: 0; bottom: var(--pf-nav-h, 0px); background: rgba(0,0,0,0.45); z-index: 79; }
    .pf-rn-modal {
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      z-index: 80; width: calc(100% - 32px); max-width: 560px;
      max-height: calc(100dvh - var(--pf-nav-h, 0px) - 32px);
      box-shadow: 0 20px 60px rgba(15, 23, 42, 0.28);
    }
    /* Centered modal: fade only (a transform keyframe would un-centre it). */
    .pf-rn-modal { animation: pf-rn-fade var(--pf-dur) var(--pf-spring) both; }
    @keyframes pf-rn-fade { from { opacity: 0; } to { opacity: 1; } }
    .pf-rn-modal__hdr { flex: none; }
    .pf-rn-modal__close { width: 36px; height: 36px; min-height: 36px; }
    .pf-rn-modal__body {
      padding: 14px 16px;
      display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px;
      overflow-y: auto;
    }
    @media (max-width: 540px) { .pf-rn-modal__body { grid-template-columns: 1fr; } }
    .pf-rn-fld--wide { grid-column: 1 / -1; }
    .pf-rn-fld { display: flex; flex-direction: column; gap: 4px; }
    .pf-rn-fld > span { font-size: 12px; font-weight: 500; color: var(--text-secondary); }
    .pf-rn-fld__req { color: var(--red-text); }
    .pf-rn-fld textarea { min-height: 64px; }
    .pf-rn-fld__err { margin: 2px 0 0; font-size: 11.5px; color: var(--red-text); text-transform: none; letter-spacing: 0; font-weight: 500; }
    .pf-rn-modal__ftr {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--pf-line); flex: none;
    }
    .pf-rn-modal__ftr .pf-btn { height: 40px; min-height: 40px; }

    /* ───────────────────────────────────────────────────────────────
       Cross-platform overrides — ADDITIVE ONLY.
       Desktop-web (>=1280) is intentionally untouched above.
       ─────────────────────────────────────────────────────────────── */

    /* Hover affordances: only on real pointers (no sticky :hover on touch). */
    @media (hover: none) {
      .pf-rn-row:hover { background: transparent; }

    }

    /* Touch pointers: grow tap targets to >=44px without shifting desktop. */
    @media (pointer: coarse) {
      .pf-rn-modal__close { width: 44px; height: 44px; }
      .pf-rn-row { padding-top: 12px; padding-bottom: 12px; }
      /* Text fields meet the 44px tap floor (desktop keeps its 36px). */
      .pf-rn-search,
      .pf-rn-fld input { min-height: 44px; }
      /* >=8px between adjacent edit/delete hit boxes on a card. */
      .pf-rn-doc__actions { gap: 8px; }
    }

    /* iPad / mid-width (641–1279): two-column doctor cards use the width;
       the two-pane grid still kicks in at 1024 (unchanged). */
    @media (min-width: 768px) and (max-width: 1023px) {
      .pf-rn-doc-list {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
    }

    /* iPad/tablet (641–1279): centered modal sizes to the *visible* viewport
       so browser/keyboard chrome can't clip it (raw vh stays for >=1280). */
    @include dt.tablet-band {
      .pf-rn-modal { max-height: calc(100dvh - 32px); }
    }

    /* Phone (<=640): full-width bottom-sheet modal, list/modal scroll in
       dvh, inputs at 16px to stop iOS auto-zoom, footer clears bottom-nav. */
    @media (max-width: 640px) {
      .pf-rn-list { max-height: 50dvh; }

      /* Right-pane header (title + Edit hospital + Add doctor) wraps instead
         of crowding/overflowing on narrow phones; title keeps full width. */
      .pf-rn-pane__hdr { flex-wrap: wrap; }
      .pf-rn-pane__hdr > .min-w-0 { flex-basis: 100%; }

      /* The sheet sits ABOVE the always-visible navbar (PF-PATTERN §8). */
      .pf-rn-modal {
        top: auto; left: 0; right: 0; bottom: var(--pf-nav-h, 0px);
        transform: none;
        width: 100%; max-width: none;
        max-height: min(92dvh, calc(100dvh - env(safe-area-inset-top, 0px) - var(--pf-nav-h, 0px) - 8px));
        border-radius: 20px 20px 0 0;
      }
      .pf-rn-modal { animation: pf-rise var(--pf-dur-sheet) var(--pf-spring-bounce) both; }
      .pf-rn-modal__body { max-height: 60dvh; }
      .pf-rn-fld input, .pf-rn-fld textarea { font-size: 16px; }
      .pf-rn-search { font-size: 16px; }
      .pf-rn-modal__ftr { flex-wrap: wrap; }
    }

    /* Capacitor native: bottom-sheet modal must clear the home-indicator /
       gesture bar in addition to the in-app bottom-nav. */
    @media (prefers-reduced-motion: reduce) { .pf-rn-modal { animation: none !important; } }
  
    /* ── Doctor-first additions (2026-09-30) ─────────────────────── */
    .pf-rn-classic-seg { margin-top: 12px; }
    :host-context(.design-new) .pf-rn-classic-seg { display: none; }
    .pf-rn-indep { align-self: flex-start; height: 36px; min-height: 36px; font-size: 12.5px; }
    .pf-rn-doc__also { margin: 4px 0 0; font-size: 11.5px; color: var(--text-secondary); overflow-wrap: anywhere; }
    .pf-rn-fld__opt { font-weight: 400; color: var(--text-tertiary); }
    .pf-rn-modal--sm { max-width: 460px; }
    .pf-rn-modal__body--one { grid-template-columns: 1fr; }
    .pf-rn-modal__lead { margin: 0; font-size: 13px; color: var(--text-secondary); }

    /* Doctors view: filter bar + a grid that scrolls itself (no page scroll). */
    .pf-rn-docbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 16px 0 10px; }
    :host-context(.design-new) .pf-rn-docbar { margin-top: 0; }
    .pf-rn-hfilter { width: 260px; max-width: 100%; }
    .pf-rn-search--docs { width: 240px; }
    .pf-rn-docbar__count { margin-left: auto; font-size: 12px; color: var(--text-tertiary); }
    .pf-rn-docgrid {
      position: relative; width: 100%;
      height: calc(100dvh - 280px); min-height: 360px;
      border: 1px solid var(--pf-line); border-radius: var(--pf-radius); overflow: hidden;
    }
    :host-context(.design-new) .pf-rn-docgrid { flex: 1 1 auto; height: auto; min-height: 320px; }
    .pf-rn-docgrid__skel { position: absolute; inset: 0; z-index: 2; background: var(--pf-card-bg, var(--bg-primary)); padding: 16px; }
    @media (max-width: 640px) {
      .pf-rn-hfilter, .pf-rn-search--docs { width: 100%; }
      .pf-rn-docbar__count { margin-left: 0; }
    }
    @media (pointer: coarse) { .pf-rn-indep { min-height: 44px; } }
  `],
})
export class ReferringNetworkComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);
  protected readonly theme = inject(ThemeService);
  /** Row actions: text on web, icon on touch (PF-PATTERN). */
  protected readonly web = webPointerSignal();

  // ── State ───────────────────────────────────────────────────────
  /** Doctors first (owner 2026-11-17): the list reception actually uses. */
  readonly view = signal<View>('doctors');

  readonly hospitals = signal<Hospital[]>([]);
  readonly loadingHospitals = signal(false);
  /** Skeleton held >= MIN_LOAD_MS (shared/utils/min-duration) so a fast
   *  load never flashes it. */
  readonly loadingHospitalsShown = heldFlag(this.loadingHospitals);
  readonly hospitalSearch = signal('');
  readonly selectedHospitalId = signal<string | null>(null);

  /** EVERY doctor of the lab (with or without hospitals) — one load powers
   *  both views. */
  readonly doctorsAll = signal<Doctor[]>([]);
  readonly loadingDoctors = signal(false);
  readonly loadingDoctorsShown = heldFlag(this.loadingDoctors);
  readonly doctorSearch = signal('');
  readonly hospitalFilter = signal<string>(ALL_HOSPITALS);

  readonly hospitalEditor = signal<HospitalDraft | null>(null);
  /** The hospital's doctors when its editor opened (to diff on save). */
  private hospitalEditorDoctorsBefore: string[] = [];
  readonly savingHospital = signal(false);
  readonly doctorEditor = signal<DoctorDraft | null>(null);
  readonly savingDoctor = signal(false);
  readonly linkEditor = signal<{ hospitalId: string; hospitalName: string; doctorIds: string[] } | null>(null);
  readonly savingLink = signal(false);
  /** An editor modal is open: its footer Save is the view's ONE primary. */
  readonly editorOpen = computed(() => !!this.hospitalEditor() || !!this.doctorEditor() || !!this.linkEditor() || !!this.paste());
  /** Paste from a sheet (bulk add) — open for the current view's list. */
  readonly paste = signal<PasteMode | null>(null);
  openPaste(): void { this.paste.set(this.view()); }
  /** "Add doctor" / "Add hospital" for the current view (a host card head calls it). */
  addNew(): void {
    if (this.view() === 'hospitals') this.openHospitalEditor(null);
    else this.openDoctorEditor(null, this.filterHospital()?.id ?? null);
  }
  /** Rows were saved from the paste sheet: re-read both lists (links + counts are server-owned). */
  async onPasteSaved(): Promise<void> { await Promise.all([this.loadHospitals(), this.loadDoctors()]); }

  // Inline, per-field backend errors for the editors (e.g. duplicate name/code).
  readonly hospitalFieldErr = signal<Record<string, string>>({});
  readonly doctorFieldErr = signal<Record<string, string>>({});
  hospErr(f: string): string | undefined { return this.hospitalFieldErr()[f]; }
  docErr(f: string): string | undefined { return this.doctorFieldErr()[f]; }
  clearHospErr(f: string): void {
    if (this.hospitalFieldErr()[f]) this.hospitalFieldErr.update(e => { const n = { ...e }; delete n[f]; return n; });
  }
  clearDocErr(f: string): void {
    if (this.doctorFieldErr()[f]) this.doctorFieldErr.update(e => { const n = { ...e }; delete n[f]; return n; });
  }

  // ── Derived ─────────────────────────────────────────────────────
  readonly viewOptions = computed<SegmentedOption<View>[]>(() => [
    { value: 'hospitals', label: 'Hospitals', count: this.hospitals().length,
      iconPath: ['M3 21h18M5 21V7l8-4v18M19 21V11l-6-4'] },
    { value: 'doctors', label: 'Doctors', count: this.doctorsAll().length,
      iconPath: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'] },
  ]);

  readonly filteredHospitals = computed(() => {
    // Band pill search (owner): every word must hit name, code or contact.
    return bandFilter(this.hospitals(), this.hospitalSearch(),
      h => [h.name, h.code, h.address, h.phone, h.email, h.gstin]);
  });

  readonly selectedHospital = computed<Hospital | null>(() => {
    const id = this.selectedHospitalId();
    if (!id) return null;
    return this.hospitals().find(h => h.id === id) ?? null;
  });

  readonly doctorsForSelected = computed<Doctor[]>(() => {
    const id = this.selectedHospitalId();
    if (!id) return [];
    return filterDoctorsByHospital(this.doctorsAll(), id);
  });

  readonly independentCount = computed(() =>
    filterDoctorsByHospital(this.doctorsAll(), NO_HOSPITAL).filter(d => d.isActive).length);

  /** Doctors view rows: hospital filter, then the band search (name,
   *  hospitals, department, qualification, registration, phone, email). */
  readonly gridDoctors = computed<Doctor[]>(() =>
    bandFilter(sgByStatus(filterDoctorsByHospital(this.doctorsAll(), this.hospitalFilter()), this.status(), d => d.isActive), this.doctorSearch(),
      d => [d.name, doctorHospitalsLabel(d), d.designation, d.department, d.qualification, d.specialisation,
            d.registrationNo, d.phone, d.email]));

  readonly noRowsText = computed(() => {
    const f = this.hospitalFilter();
    const msg = this.doctorSearch() ? 'No doctors match.'
      : f === NO_HOSPITAL ? 'No independent doctors.'
      : f !== ALL_HOSPITALS ? 'No doctors at this hospital yet.'
      : 'No doctors yet. Use Add doctor to start.';
    return `<span class="pf-rn-empty">${msg}</span>`;
  });

  readonly hospitalFilterOptions = computed<PfSelectOption<string>[]>(() => [
    { value: ALL_HOSPITALS, label: 'All hospitals' },
    { value: NO_HOSPITAL, label: 'Independent (no hospital)' },
    ...this.hospitals().map(h => ({ value: h.id, label: h.name, hint: h.isActive ? undefined : 'Inactive' })),
  ]);

  /** Hospitals a doctor can be linked to: the active ones, plus any inactive
   *  one the doctor being edited is already at (so it isn't silently dropped). */
  readonly hospitalOptions = computed<PfSelectOption<string>[]>(() => {
    const keep = new Set(this.doctorEditor()?.hospitalIds ?? []);
    return this.hospitals()
      .filter(h => h.isActive || keep.has(h.id))
      .map(h => ({ value: h.id, label: h.name, hint: h.isActive ? (h.code ?? undefined) : 'Inactive' }));
  });

  /** Existing doctors (active, plus any already chosen) for the hospital editor. */
  readonly doctorOptions = computed<PfSelectOption<string>[]>(() => {
    const keep = new Set(this.hospitalEditor()?.doctorIds ?? []);
    return this.doctorOptionList(d => d.isActive || keep.has(d.id));
  });

  /** Doctors not yet at the hospital being linked. */
  readonly linkableDoctorOptions = computed<PfSelectOption<string>[]>(() => {
    const le = this.linkEditor();
    if (!le) return [];
    return this.doctorOptionList(d => d.isActive && !doctorHospitalIds(d).includes(le.hospitalId));
  });

  private doctorOptionList(keep: (d: Doctor) => boolean): PfSelectOption<string>[] {
    return this.doctorsAll().filter(keep)
      .slice().sort((a, b) => a.name.localeCompare(b.name))
      .map(d => ({ value: d.id, label: d.name, hint: doctorHospitalsLabel(d) }));
  }

  /** "Kauvery, MIOT" — the doctor's hospitals other than `hospitalId`. */
  otherHospitals(d: Doctor, hospitalId: string): string {
    return doctorHospitals(d).filter(h => h.id !== hospitalId).map(h => h.name).filter(Boolean).join(', ');
  }

  // ── Grid (Test Master) ──────────────────────────────────────────
  /** Hosted in the Settings shell (Front desk): bare grid; the shell's card head shows headTools. */
  protected readonly bare = sgBare();
  private readonly headToolsTpl = viewChild<TemplateRef<unknown>>('headToolsTpl');
  /** View switch + hospital filter + status filter + count, for a host card head. */
  readonly headTools = computed(() => this.headToolsTpl());
  readonly phone = sgMedia(SG_PHONE_MQ);
  readonly gridTheme = sgGridTheme();
  readonly rowId = (p: { data: Doctor }) => p.data.id;
  readonly hospitalRowId = (p: { data: Hospital }) => p.data.id;
  readonly doctorRowClass = sgRowOff<Doctor>(d => d.isActive);
  readonly hospitalRowClass = sgRowOff<Hospital>(h => h.isActive);
  readonly defaultColDef: ColDef = { sortable: true, resizable: true, filter: false, minWidth: 90, wrapText: true, autoHeight: true };
  /** All · Active · Inactive for the current view. */
  readonly status = signal<SgStatus>('all');
  readonly statusOptions = computed(() => {
    const rows: { isActive: boolean }[] = this.view() === 'doctors'
      ? filterDoctorsByHospital(this.doctorsAll(), this.hospitalFilter()) : this.hospitals();
    return sgStatusOptions(rows.length, rows.filter(r => !r.isActive).length);
  });
  readonly gridHospitals = computed(() => sgByStatus(this.filteredHospitals(), this.status(), h => h.isActive));
  readonly countLabel = computed(() => {
    const n = this.view() === 'doctors' ? this.gridDoctors().length : this.gridHospitals().length;
    return `${n} ${this.view() === 'doctors' ? (n === 1 ? 'doctor' : 'doctors') : (n === 1 ? 'hospital' : 'hospitals')}`;
  });
  readonly emptyDoctorsText = computed(() => {
    const f = this.hospitalFilter();
    return this.doctorSearch() ? 'No doctors match.'
      : f === NO_HOSPITAL ? 'No independent doctors.'
      : f !== ALL_HOSPITALS ? 'No doctors at this hospital yet.'
      : 'No doctors yet. Use Add doctor to start.';
  });
  /** The hospital the doctors grid is filtered to (enables "Remove from this hospital"). */
  readonly filterHospital = computed(() => this.hospitals().find(h => h.id === this.hospitalFilter()) ?? null);

  doctorActions(d: Doctor): SgAction[] {
    const acts: SgAction[] = [{ label: 'Edit', aria: `Edit ${d.name}`, path: SG_ICON.edit, icon: true, run: () => this.openDoctorEditor(d, null) }];
    const h = this.filterHospital();
    if (h && doctorHospitalIds(d).includes(h.id)) {
      acts.push({ label: 'Remove', aria: `Remove ${d.name} from ${h.name}`, icon: true,
        path: '<path d="M18.84 12.25 20.25 10.84a5 5 0 0 0-7.07-7.07l-1.41 1.41"/><path d="m5.16 11.75-1.41 1.41a5 5 0 0 0 7.07 7.07l1.41-1.41"/><path d="M8 2v3M2 8h3M16 22v-3M22 16h-3"/>',
        run: () => { void this.unlinkDoctor(d, h); } });
    }
    if (d.isActive) acts.push({ label: 'Deactivate', aria: `Deactivate ${d.name}`, path: SG_ICON.power, icon: true, run: () => { void this.deactivateDoctor(d); } });
    return acts;
  }
  hospitalActions(h: Hospital): SgAction[] {
    return [
      { label: 'Edit hospital', aria: `Edit ${h.name}`, path: SG_ICON.edit, icon: true, run: () => this.openHospitalEditor(h) },
      { label: 'Link doctors', aria: `Link doctors to ${h.name}`, icon: true,
        path: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
        run: () => this.openLinkEditor(h) },
    ];
  }

  readonly doctorColDefs = computed<ColDef<Doctor>[]>(() => {
    const web = this.web() && !this.phone();
    this.hospitalFilter(); this.hospitals();
    const cols: ColDef<Doctor>[] = [
      // Every data column sorts + filters on its real value (owner 2026-11-21); the name filter also finds the
      // designation and registration number shown under it.
      textCol<Doctor>({ headerName: 'Doctor', colId: 'name', flex: 1.3, minWidth: 190, sort: 'asc',
        cellRenderer: (p: ICellRendererParams<Doctor>) => sgCell(p.data?.name, [p.data?.designation, p.data?.registrationNo ? 'Reg ' + p.data.registrationNo : null].filter(Boolean).join(' · ') || null, true) },
        d => [d.name, d.designation, d.registrationNo].filter(Boolean).join(' '), 'left', d => d.name),
      textCol<Doctor>({ headerName: 'Qualification', colId: 'qualification', flex: 0.8, minWidth: 140 }, d => d.qualification || ''),
      textCol<Doctor>({ headerName: 'Hospital(s)', colId: 'hospitals', flex: 1.3, minWidth: 180,
        cellRenderer: (p: ICellRendererParams<Doctor>) => sgChips(p.data ? doctorHospitals(p.data).map(h => h.name) : [], 'Independent') },
        d => doctorHospitalsLabel(d)),
      textCol<Doctor>({ headerName: 'Department', colId: 'department', flex: 0.8, minWidth: 140 }, d => d.department || d.specialisation || ''),
      textCol<Doctor>({ headerName: 'Phone', colId: 'phone', width: 150, flex: 0, cellClass: 'pf-num' }, d => d.phone || ''),
      sgPillCol<Doctor>(d => d.isActive),
      sgActionsCol<Doctor>(web, [], 3, p => (p.data ? sgActions(web, this.doctorActions(p.data)) : document.createElement('span'))),
    ];
    if (this.phone()) return cols.filter(c => ['name', 'hospitals', 'actions'].includes(c.colId ?? ''));
    return cols;
  });

  readonly hospitalColDefs = computed<ColDef<Hospital>[]>(() => {
    const web = this.web() && !this.phone();
    const cols: ColDef<Hospital>[] = [
      textCol<Hospital>({ headerName: 'Hospital', colId: 'name', flex: 1.4, minWidth: 190, sort: 'asc',
        cellRenderer: (p: ICellRendererParams<Hospital>) => sgCell(p.data?.name, p.data?.address || null, true) },
        h => [h.name, h.address].filter(Boolean).join(' '), 'left', h => h.name),
      textCol<Hospital>({ headerName: 'Code', colId: 'code', width: 116, flex: 0, cellClass: 'pf-num', valueFormatter: q => q.value || '—' }, h => h.code || ''),
      numberCol<Hospital>({ headerName: 'Doctors', colId: 'doctors', width: 120, flex: 0, cellClass: 'pf-num' }, h => h.doctorCount ?? 0),
      textCol<Hospital>({ headerName: 'Phone', colId: 'phone', width: 150, flex: 0, cellClass: 'pf-num' }, h => h.phone || ''),
      textCol<Hospital>({ headerName: 'GSTIN', colId: 'gstin', flex: 0.9, minWidth: 150, cellClass: 'pf-num',
        cellRenderer: (p: ICellRendererParams<Hospital>) => { const el = sgCell(p.data?.gstin || null, p.data?.gstin ? null : 'Not set'); if (!p.data?.gstin) el.firstElementChild?.remove(); return el; } }, h => h.gstin || ''),
      sgPillCol<Hospital>(h => h.isActive),
      sgActionsCol<Hospital>(web, [], 2, p => (p.data ? sgActions(web, this.hospitalActions(p.data)) : document.createElement('span'))),
    ];
    if (this.phone()) return cols.filter(c => ['name', 'doctors', 'actions'].includes(c.colId ?? ''));
    return cols;
  });

  /** A hospital row opens its doctors (the Doctors view filtered to it). */
  onHospitalCell(e: CellClickedEvent<Hospital>): void {
    if (e.colDef.colId === 'actions' || !e.data) return;
    this.hospitalFilter.set(e.data.id);
    this.status.set('all');
    this.view.set('doctors');
  }

  // ── View / search ───────────────────────────────────────────────
  setView(v: View): void { this.view.set(v); this.status.set('all'); }
  onBandSearch(v: string): void {
    if (this.view() === 'hospitals') this.hospitalSearch.set(v); else this.doctorSearch.set(v);
  }
  setHospitalSearch(v: string) { this.hospitalSearch.set(v); }
  setHospitalFilter(v: string): void { this.hospitalFilter.set(v || ALL_HOSPITALS); }
  showIndependent(): void { this.hospitalFilter.set(NO_HOSPITAL); this.view.set('doctors'); }
  asInput(ev: Event): string { return (ev.target as HTMLInputElement).value; }

  async ngOnInit(): Promise<void> {
    await Promise.all([this.loadHospitals(), this.loadDoctors()]);
  }

  // ── Loads ───────────────────────────────────────────────────────

  private async loadHospitals(): Promise<void> {
    this.loadingHospitals.set(true);
    try {
      const list = await firstValueFrom(this.api.get<Hospital[]>('/api/referring-network/hospitals'));
      this.hospitals.set(list ?? []);
      // Auto-select the first hospital if none chosen yet.
      if (!this.selectedHospitalId() && (list ?? []).length > 0) {
        this.selectHospital(list![0].id);
      }
    } catch {
      this.toasts.error('Could not load hospitals');
    } finally {
      this.loadingHospitals.set(false);
    }
  }

  private async loadDoctors(): Promise<void> {
    this.loadingDoctors.set(true);
    try {
      const list = await firstValueFrom(this.api.get<Doctor[]>('/api/referring-network/doctors?includeInactive=true'));
      this.doctorsAll.set(list ?? []);
    } catch {
      this.toasts.error('Could not load doctors');
    } finally {
      this.loadingDoctors.set(false);
    }
  }

  /** Re-read the hospital counts after a link change (server-owned). */
  private async refreshHospitals(): Promise<void> {
    try {
      const list = await firstValueFrom(this.api.get<Hospital[]>('/api/referring-network/hospitals'));
      if (list) this.hospitals.set(list);
    } catch { /* counts refresh on the next load */ }
  }

  selectHospital(id: string): void {
    this.selectedHospitalId.set(id);
  }

  private upsertDoctor(saved: Doctor): void {
    const list = this.doctorsAll().slice();
    const idx = list.findIndex(d => d.id === saved.id);
    if (idx >= 0) list[idx] = saved; else list.push(saved);
    list.sort((a, b) => a.name.localeCompare(b.name));
    this.doctorsAll.set(list);
  }

  // ── Hospital editor ────────────────────────────────────────────

  openHospitalEditor(h: Hospital | null): void {
    this.hospitalFieldErr.set({});
    const doctorIds = h ? filterDoctorsByHospital(this.doctorsAll(), h.id).map(d => d.id) : [];
    this.hospitalEditorDoctorsBefore = doctorIds.slice();
    this.hospitalEditor.set(h ? { ...h, doctorIds } : { name: '', isActive: true, doctorIds: [] });
    this.hospitalBase = stableJson(this.hospitalEditor());
  }
  /** Save only when something changed (owner 2026-11-19): the open hospital / doctor compared with how it was opened.
   *  The form edits the draft in place (ngModel), so these are read on every check, not memoised. A NEW record has
   *  nothing saved to compare with — its Save follows the name only. */
  private hospitalBase = '';
  private doctorBase = '';
  hospitalChanged(): boolean { const e = this.hospitalEditor(); return !!e && (!e.id || stableJson(e) !== this.hospitalBase); }
  doctorChanged(): boolean { const e = this.doctorEditor(); return !!e && (!e.id || stableJson(e) !== this.doctorBase); }
  closeHospitalEditor(): void { this.hospitalEditor.set(null); }
  setHospitalDoctors(ids: string[]): void {
    this.hospitalEditor.update(e => (e ? { ...e, doctorIds: ids ?? [] } : e));
  }

  async saveHospital(): Promise<void> {
    const draft = this.hospitalEditor();
    if (!draft?.name?.trim()) return;
    const bad = hospitalErrors(draft);
    if (Object.keys(bad).length) { this.hospitalFieldErr.set(bad); return; }
    this.hospitalFieldErr.set({});
    this.savingHospital.set(true);
    try {
      const body = {
        name: draft.name.trim(),
        code: draft.code ?? null,
        address: draft.address ?? null,
        phone: draft.phone ?? null,
        email: draft.email ?? null,
        gstin: draft.gstin ?? null,
        notes: draft.notes ?? null,
      };
      let saved: Hospital;
      if (draft.id) {
        saved = await firstValueFrom(this.api.patch<Hospital>(`/api/referring-network/hospitals/${draft.id}`, body));
        const { add, remove } = linkDiff(this.hospitalEditorDoctorsBefore, draft.doctorIds);
        if (add.length) {
          saved = await firstValueFrom(this.api.post<Hospital>(`/api/referring-network/hospitals/${draft.id}/doctors`, { doctorIds: add }));
        }
        for (const docId of remove) {
          saved = await firstValueFrom(this.api.delete<Hospital>(`/api/referring-network/hospitals/${draft.id}/doctors/${docId}`));
        }
        if (add.length || remove.length) await this.loadDoctors();
      } else {
        // "Add hospital" may attach existing doctors in the same save.
        saved = await firstValueFrom(this.api.post<Hospital>('/api/referring-network/hospitals',
          { ...body, doctorIds: draft.doctorIds.length ? draft.doctorIds : null }));
        if (draft.doctorIds.length) await this.loadDoctors();
      }
      // Upsert into local list.
      const list = this.hospitals().slice();
      const idx = list.findIndex(h => h.id === saved.id);
      if (idx >= 0) list[idx] = saved; else list.push(saved);
      list.sort((a, b) => a.name.localeCompare(b.name));
      this.hospitals.set(list);
      if (!draft.id) this.selectHospital(saved.id);
      this.closeHospitalEditor();
      this.toasts.success(draft.id ? 'Hospital updated' : 'Hospital added');
    } catch (err) {
      const e = ApiError.from(err);
      if (e.field) this.hospitalFieldErr.set({ [e.field]: e.message });
      else this.toasts.error(e.message);
    } finally {
      this.savingHospital.set(false);
    }
  }

  async deactivateHospital(): Promise<void> {
    const draft = this.hospitalEditor();
    if (!draft?.id) return;
    const ok = await this.dialog.confirm({
      title: 'Deactivate hospital?',
      message: `Deactivating "${draft.name}" hides it from the order-create dropdown. Its doctors stay (at their other hospitals, or independent). Past orders that reference it stay intact.`,
      confirmLabel: 'Deactivate',
      tone: 'danger'
    });
    if (!ok) return;
    try {
      await firstValueFrom(this.api.delete(`/api/referring-network/hospitals/${draft.id}`));
      this.hospitals.update(list => list.map(h => h.id === draft.id ? { ...h, isActive: false } : h));
      this.closeHospitalEditor();
      this.toasts.success('Hospital deactivated');
    } catch (err) {
      this.toasts.error(ApiError.from(err).message);
    }
  }

  // ── Link existing doctors to a hospital ─────────────────────────

  openLinkEditor(h: Hospital): void {
    this.linkEditor.set({ hospitalId: h.id, hospitalName: h.name, doctorIds: [] });
  }
  closeLinkEditor(): void { this.linkEditor.set(null); }
  setLinkDoctors(ids: string[]): void {
    this.linkEditor.update(e => (e ? { ...e, doctorIds: ids ?? [] } : e));
  }

  async saveLinks(): Promise<void> {
    const le = this.linkEditor();
    if (!le?.doctorIds.length) return;
    this.savingLink.set(true);
    try {
      const saved = await firstValueFrom(this.api.post<Hospital>(
        `/api/referring-network/hospitals/${le.hospitalId}/doctors`, { doctorIds: le.doctorIds }));
      if (saved?.id) this.hospitals.update(list => list.map(h => h.id === saved.id ? saved : h));
      await this.loadDoctors();
      this.closeLinkEditor();
      this.toasts.success(le.doctorIds.length === 1 ? 'Doctor linked' : `${le.doctorIds.length} doctors linked`);
    } catch (err) {
      this.toasts.error(ApiError.from(err).message);
    } finally {
      this.savingLink.set(false);
    }
  }

  async unlinkDoctor(d: Doctor, h: Hospital): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Remove from this hospital?',
      message: `"${d.name}" will no longer be listed under ${h.name}. The doctor stays in your network${this.otherHospitals(d, h.id) ? ` (still at ${this.otherHospitals(d, h.id)})` : ' as an independent doctor'}. Past orders stay intact.`,
      confirmLabel: 'Remove',
      tone: 'danger'
    });
    if (!ok) return;
    try {
      const saved = await firstValueFrom(this.api.delete<Hospital>(`/api/referring-network/hospitals/${h.id}/doctors/${d.id}`));
      if (saved?.id) this.hospitals.update(list => list.map(x => x.id === saved.id ? saved : x));
      await this.loadDoctors();
      this.toasts.success('Removed from hospital');
    } catch (err) {
      this.toasts.error(ApiError.from(err).message);
    }
  }

  // ── Doctor editor ──────────────────────────────────────────────

  /** `d` = edit; else a new doctor, pre-linked to `hospitalId` when added
   *  from a hospital's pane (none from the Doctors view = independent). */
  openDoctorEditor(d: Doctor | null, hospitalId: string | null): void {
    this.doctorFieldErr.set({});
    this.doctorEditor.set(d
      ? { ...d, hospitalIds: doctorHospitalIds(d) }
      : { name: '', isActive: true, hospitalIds: hospitalId ? [hospitalId] : [] });
    this.doctorBase = stableJson(this.doctorEditor());
  }
  closeDoctorEditor(): void { this.doctorEditor.set(null); }
  setDoctorHospitals(ids: string[]): void {
    this.doctorEditor.update(e => (e ? { ...e, hospitalIds: ids ?? [] } : e));
  }

  async saveDoctor(): Promise<void> {
    const draft = this.doctorEditor();
    if (!draft?.name?.trim()) return;
    const bad = referralDoctorErrors(draft, validatePhoneNumber);
    if (Object.keys(bad).length) { this.doctorFieldErr.set(bad); return; }
    this.doctorFieldErr.set({});
    this.savingDoctor.set(true);
    try {
      const hospitalIds = draft.hospitalIds ?? [];
      // Keep the current primary when it is still linked; else the first pick.
      const primary = draft.hospitalId && hospitalIds.includes(draft.hospitalId) ? draft.hospitalId : (hospitalIds[0] ?? null);
      const body = {
        hospitalId: primary,
        hospitalIds,
        name: draft.name.trim(),
        designation: draft.designation ?? null,
        department: draft.department ?? null,
        qualification: draft.qualification ?? null,
        specialisation: draft.specialisation ?? null,
        registrationNo: draft.registrationNo ?? null,
        phone: draft.phone ?? null,
        email: draft.email ?? null
      };
      const before = draft.id ? doctorHospitalIds(this.doctorsAll().find(x => x.id === draft.id) ?? { hospitalId: null }) : [];
      const saved = draft.id
        ? await firstValueFrom(this.api.patch<Doctor>(`/api/referring-network/doctors/${draft.id}`, body))
        : await firstValueFrom(this.api.post<Doctor>('/api/referring-network/doctors', body));
      this.upsertDoctor(saved);
      const { add, remove } = linkDiff(before, doctorHospitalIds(saved));
      if (add.length || remove.length) void this.refreshHospitals();
      this.closeDoctorEditor();
      this.toasts.success(draft.id ? 'Doctor updated' : 'Doctor added');
    } catch (err) {
      const e = ApiError.from(err);
      if (e.field) this.doctorFieldErr.set({ [e.field]: e.message });
      else this.toasts.error(e.message);
    } finally {
      this.savingDoctor.set(false);
    }
  }

  async deactivateDoctor(d: Doctor): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Deactivate doctor?',
      message: `Deactivating "${d.name}" hides them from the order-create dropdown. Past orders stay intact.`,
      confirmLabel: 'Deactivate',
      tone: 'danger'
    });
    if (!ok) return;
    try {
      await firstValueFrom(this.api.delete(`/api/referring-network/doctors/${d.id}`));
      this.doctorsAll.update(list => list.map(x => x.id === d.id ? { ...x, isActive: false } : x));
      const ids = new Set(doctorHospitalIds(d));
      this.hospitals.update(h => h.map(x => ids.has(x.id) ? { ...x, doctorCount: Math.max(0, x.doctorCount - 1) } : x));
      this.toasts.success('Doctor deactivated');
    } catch (err) {
      this.toasts.error(ApiError.from(err).message);
    }
  }

  // Screen view state (owner 2026-11-21): filters / tab / search come back as left after in-app navigation;
  // fresh on reload, sign-out and branch switch.
  private readonly _viewState = inject(ViewStateService).bind('admin.referring', { view: this.view, hospitalSearch: this.hospitalSearch, doctorSearch: this.doctorSearch, hospitalFilter: this.hospitalFilter, status: this.status });
}
