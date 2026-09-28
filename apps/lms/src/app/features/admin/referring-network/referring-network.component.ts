import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ThemeService } from '../../../core/services/theme.service';
import { bandFilter } from '../../../shared/utils/band-search';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { SkeletonRowsComponent } from '../../../shared/primitives/skeleton-kit.component';
import { heldFlag } from '../../../shared/utils/min-duration';

interface Hospital {
  id: string;
  name: string;
  code?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  notes?: string | null;
  isActive: boolean;
  doctorCount: number;
}

interface Doctor {
  id: string;
  hospitalId?: string | null;
  hospitalName?: string | null;
  name: string;
  designation?: string | null;
  department?: string | null;
  qualification?: string | null;
  specialisation?: string | null;
  registrationNo?: string | null;
  phone?: string | null;
  email?: string | null;
  isActive: boolean;
}

/**
 * Admin → Referring Network. Two-pane:
 *  Left  — Hospitals list (search + add). Click to focus.
 *  Right — Doctors for the focused hospital, with full details
 *          (designation, department, qualification, registration, contact).
 *          Add / edit / soft-delete.
 *
 * Auto-create flow: anything reception types in order-create that doesn't
 * exist gets a stub Hospital + Doctor row here automatically. Admins fill
 * in the extra fields later. Soft-deletes only — historical orders that
 * reference a deactivated hospital/doctor stay intact.
 */
@Component({
  selector: 'pf-referring-network',
  standalone: true,
  imports: [SkeletonRowsComponent, FormsModule, ScreenHeaderComponent, TouchButtonComponent, HeroBandComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 lg:px-10 pt-6 pb-10 max-w-screen-2xl mx-auto w-full">
      @if (theme.isNewDesign()) {
        <!-- Band pill (owner): the hospital search moved here from the list
             pane; "Add hospital" rides the band's actions. -->
        <pf-hero-band [back]="true" placeholder="Search hospitals — name, code, phone, address…"
                      [value]="hospitalSearch()" (valueChange)="setHospitalSearch($event)">
          <ng-container band-actions>
            <!-- While an editor modal is open its footer Save is the ONE
                 primary: this steps down (secondary, disabled) behind it. -->
            <button type="button" class="pf-hb-btn press pf-rn-add"
                    [class.pf-hb-btn--primary]="!editorOpen()" [class.pf-hb-btn--ghost]="editorOpen()"
                    [disabled]="editorOpen()" (click)="openHospitalEditor(null)"
                    aria-label="Add hospital">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
              Add hospital
            </button>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Admin · Referring network"
        title="Hospitals &amp; doctors"
        subtitle="Manage the hospitals that refer patients to your lab and the doctors who practise at each.">
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

      <div class="pf-band-body">
      <div class="pf-rn-grid">
        <!-- ── Hospitals (left) ────────────────────────────────── -->
        <aside class="pf-rn-pane pf-rn-pane--list nd-card">
          <header class="nd-card__head pf-rn-pane__hdr">
            <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9h.01M9 13h.01M9 17h.01"/></svg></span>
            <h2 class="nd-card__label pf-rn-pane__title">Hospitals</h2>
            <span class="pf-rn-pane__count nd-num">{{ hospitals().length }}</span>
          </header>
          <input type="search" class="pf-rn-search pf-classic-only"
                 placeholder="Search hospitals…"
                 [value]="hospitalSearch()"
                 (input)="setHospitalSearch(asInput($event))" />

          @if (loadingHospitalsShown()) {
            <div class="flex justify-center py-10">
              <pf-skeleton-rows [rows]="6" label="Loading hospitals…"></pf-skeleton-rows>
            </div>
          } @else if (filteredHospitals().length === 0) {
            <p class="pf-rn-empty">
              @if (hospitalSearch()) { No hospitals match. }
              @else { No hospitals yet. Use <b>Add hospital</b> to start. }
            </p>
          } @else {
            <ul class="pf-rn-list" role="listbox" aria-label="Hospitals">
              @for (h of filteredHospitals(); track h.id) {
                <li>
                  <button type="button" class="pf-rn-row press" role="option"
                          [attr.aria-selected]="selectedHospitalId() === h.id"
                          (click)="selectHospital(h.id)">
                    <div class="min-w-0 flex-1">
                      <p class="pf-rn-row__name">{{ h.name }}</p>
                      <p class="pf-rn-row__meta">
                        @if (h.code) { <span class="nd-num">{{ h.code }}</span> · }
                        <span class="nd-num">{{ h.doctorCount }}</span> doctor<span [class.hidden]="h.doctorCount === 1">s</span>
                        @if (!h.isActive) { · <span class="pf-rn-row__inactive">Inactive</span> }
                      </p>
                    </div>
                  </button>
                </li>
              }
            </ul>
          }
        </aside>

        <!-- ── Doctors (right) ─────────────────────────────────── -->
        <section class="pf-rn-pane nd-card">
          @if (!selectedHospital(); as _) {
            <div class="pf-rn-placeholder">
              <p class="pf-rn-placeholder__title">Pick a hospital to manage its doctors</p>
              <p class="pf-rn-placeholder__sub">
                Or add a new hospital from the top-right. Reception's typed-in entries auto-appear here too.
              </p>
            </div>
          }
          @if (selectedHospital(); as h) {
            <header class="nd-card__head pf-rn-pane__hdr">
              <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
              <div class="min-w-0 flex-1">
                <h2 class="pf-rn-pane__title pf-rn-pane__title--name">{{ h.name }}</h2>
                <p class="pf-rn-pane__sub">
                  @if (h.code) { <span class="nd-num">{{ h.code }}</span> · }
                  @if (h.phone) { <span class="nd-num">{{ h.phone }}</span> · }
                  @if (h.address) { {{ h.address }} }
                  @if (!h.code && !h.phone && !h.address) { no details yet }
                </p>
              </div>
              <button type="button" class="nd-btn nd-btn--tertiary pf-rn-hdrbtn press" (click)="openHospitalEditor(h)">Edit hospital</button>
              <!-- Secondary: "Add hospital" in the band is this view's one primary. -->
              <button type="button" class="nd-btn nd-btn--secondary pf-rn-hdrbtn press" (click)="openDoctorEditor(null)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                Add doctor
              </button>
            </header>

            @if (loadingDoctorsShown()) {
              <div class="flex justify-center py-10">
                <pf-skeleton-rows [rows]="6" label="Loading doctors…"></pf-skeleton-rows>
              </div>
            } @else if (doctorsForSelected().length === 0) {
              <p class="pf-rn-empty">No doctors yet at this hospital. Click <b>Add doctor</b>.</p>
            } @else {
              <ul class="pf-rn-doc-list">
                @for (d of doctorsForSelected(); track d.id) {
                  <li class="pf-rn-doc">
                    <div class="pf-rn-doc__main">
                      <p class="pf-rn-doc__name">{{ d.name }}</p>
                      <p class="pf-rn-doc__meta">
                        @if (d.designation) { {{ d.designation }} }
                        @if (d.designation && d.department) { · }
                        @if (d.department) { {{ d.department }} }
                      </p>
                      <p class="pf-rn-doc__sub">
                        @if (d.qualification) { {{ d.qualification }} }
                        @if (d.qualification && d.registrationNo) { · }
                        @if (d.registrationNo) { Reg #<span class="nd-num">{{ d.registrationNo }}</span> }
                      </p>
                      <p class="pf-rn-doc__contact">
                        @if (d.phone) { <span class="nd-num">{{ d.phone }}</span> }
                        @if (d.phone && d.email) { · }
                        @if (d.email) { {{ d.email }} }
                      </p>
                    </div>
                    <div class="pf-rn-doc__actions">
                      @if (!d.isActive) { <span class="nd-chip nd-chip--static pf-rn-chip">Inactive</span> }
                      <!-- Row actions: text on web, icon on touch. -->
                      <button type="button" class="nd-rowact" [class.nd-rowact--icon]="!web()" (click)="openDoctorEditor(d)" aria-label="Edit doctor" title="Edit"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg><span class="nd-rowact__t">Edit</span></button>
                      @if (d.isActive) {
                        <button type="button" class="nd-rowact" [class.nd-rowact--icon]="!web()" (click)="deactivateDoctor(d)" aria-label="Deactivate doctor" title="Deactivate"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><path d="M12 2v10"/></svg><span class="nd-rowact__t">Deactivate</span></button>
                      }
                    </div>
                  </li>
                }
              </ul>
            }
          }
        </section>
      </div>
      </div>

      <!-- ── Hospital editor modal ─────────────────────────────── -->
      @if (hospitalEditor(); as he) {
        <div class="pf-rn-modal-bd" (click)="closeHospitalEditor()"></div>
        <div class="pf-rn-modal nd-card" role="dialog" aria-modal="true" [attr.aria-label]="he.id ? 'Edit hospital' : 'Add hospital'">
          <span class="nd-sheet__handle" aria-hidden="true"></span>
          <header class="nd-card__head pf-rn-modal__hdr">
            <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9h.01M9 13h.01M9 17h.01"/></svg></span>
            <h3 class="nd-card__label">{{ he.id ? 'Edit hospital' : 'Add hospital' }}</h3>
            <span class="nd-card__spacer"></span>
            <button type="button" class="nd-btn nd-btn--icon pf-rn-modal__close press" (click)="closeHospitalEditor()" aria-label="Close" title="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </header>
          <div class="pf-rn-modal__body">
            <label class="pf-rn-fld">
              <span>Name <span class="pf-rn-fld__req">*</span></span>
              <input class="nd-input" type="text" [(ngModel)]="he.name" (input)="clearHospErr('name')" [class.nd-input--error]="hospErr('name')" placeholder="Apollo Hospitals" />
              @if (hospErr('name')) { <p class="pf-rn-fld__err">{{ hospErr('name') }}</p> }
            </label>
            <label class="pf-rn-fld">
              <span>Code</span>
              <input class="nd-input" type="text" [(ngModel)]="he.code" (input)="clearHospErr('code')" [class.nd-input--error]="hospErr('code')" placeholder="APO" />
              @if (hospErr('code')) { <p class="pf-rn-fld__err">{{ hospErr('code') }}</p> }
            </label>
            <label class="pf-rn-fld pf-rn-fld--wide">
              <span>Address</span>
              <input class="nd-input" type="text" [(ngModel)]="he.address" placeholder="21 Greams Lane, Chennai" />
            </label>
            <label class="pf-rn-fld">
              <span>Phone</span>
              <input class="nd-input" type="tel" [(ngModel)]="he.phone" placeholder="+91 44 1234 5678" />
            </label>
            <label class="pf-rn-fld">
              <span>Email</span>
              <input class="nd-input" type="email" [(ngModel)]="he.email" placeholder="referrals@apollo.com" />
            </label>
            <label class="pf-rn-fld">
              <span>GSTIN</span>
              <input class="nd-input" type="text" [(ngModel)]="he.gstin" placeholder="33AABCA1234A1Z5" />
            </label>
            <label class="pf-rn-fld pf-rn-fld--wide">
              <span>Notes</span>
              <textarea class="nd-input" rows="2" [(ngModel)]="he.notes" placeholder="Panel rates, commission deal, billing quirks…"></textarea>
            </label>
          </div>
          <footer class="pf-rn-modal__ftr">
            @if (he.id) {
              <button type="button" class="nd-btn nd-btn--tertiary press" (click)="deactivateHospital()">Deactivate</button>
            }
            <span class="flex-1"></span>
            <button type="button" class="nd-btn nd-btn--secondary press" (click)="closeHospitalEditor()">Cancel</button>
            <button type="button" class="nd-btn nd-btn--primary press"
                    [disabled]="!he.name?.trim() || savingHospital()" (click)="saveHospital()">
              @if (savingHospital()) { Saving… } @else { Save hospital }
            </button>
          </footer>
        </div>
      }

      <!-- ── Doctor editor modal ───────────────────────────────── -->
      @if (doctorEditor(); as de) {
        <div class="pf-rn-modal-bd" (click)="closeDoctorEditor()"></div>
        <div class="pf-rn-modal nd-card" role="dialog" aria-modal="true" [attr.aria-label]="de.id ? 'Edit doctor' : 'Add doctor'">
          <span class="nd-sheet__handle" aria-hidden="true"></span>
          <header class="nd-card__head pf-rn-modal__hdr">
            <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
            <h3 class="nd-card__label">{{ de.id ? 'Edit doctor' : 'Add doctor' }}</h3>
            <span class="nd-card__spacer"></span>
            <button type="button" class="nd-btn nd-btn--icon pf-rn-modal__close press" (click)="closeDoctorEditor()" aria-label="Close" title="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </header>
          <div class="pf-rn-modal__body">
            <label class="pf-rn-fld pf-rn-fld--wide">
              <span>Name <span class="pf-rn-fld__req">*</span></span>
              <input class="nd-input" type="text" [(ngModel)]="de.name" (input)="clearDocErr('name')" [class.nd-input--error]="docErr('name')" placeholder="Dr. Priya Krishnan" />
              @if (docErr('name')) { <p class="pf-rn-fld__err">{{ docErr('name') }}</p> }
            </label>
            <label class="pf-rn-fld">
              <span>Designation</span>
              <input class="nd-input" type="text" [(ngModel)]="de.designation" placeholder="Consultant Physician" />
            </label>
            <label class="pf-rn-fld">
              <span>Department</span>
              <input class="nd-input" type="text" [(ngModel)]="de.department" placeholder="Cardiology" />
            </label>
            <label class="pf-rn-fld">
              <span>Qualification</span>
              <input class="nd-input" type="text" [(ngModel)]="de.qualification" placeholder="MBBS, MD" />
            </label>
            <label class="pf-rn-fld">
              <span>Registration #</span>
              <input class="nd-input" type="text" [(ngModel)]="de.registrationNo" placeholder="TN-12345" />
            </label>
            <label class="pf-rn-fld">
              <span>Phone</span>
              <input class="nd-input" type="tel" [(ngModel)]="de.phone" placeholder="+91 98765 43210" />
            </label>
            <label class="pf-rn-fld">
              <span>Email</span>
              <input class="nd-input" type="email" [(ngModel)]="de.email" placeholder="priya@apollo.com" />
            </label>
          </div>
          <footer class="pf-rn-modal__ftr">
            <span class="flex-1"></span>
            <button type="button" class="nd-btn nd-btn--secondary press" (click)="closeDoctorEditor()">Cancel</button>
            <button type="button" class="nd-btn nd-btn--primary press"
                    [disabled]="!de.name?.trim() || savingDoctor()" (click)="saveDoctor()">
              @if (savingDoctor()) { Saving… } @else { Save doctor }
            </button>
          </footer>
        </div>
      }
    </section>
  `,
  styles: [`
    @use '../../../shared/styles/device-tier' as dt;
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
    .pf-rn-pane > :not(.nd-card__head) { margin-left: 14px; margin-right: 14px; }
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
    .pf-rn-row:hover { background: var(--nd-chip-bg); }
    /* Neutral selected state (aria-selected), never violet (ND-PATTERN §3). */
    .pf-rn-row[aria-selected='true'] { background: var(--nd-sel-bg); border-color: var(--nd-sel-border); }
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
      background: var(--nd-card-bg);
      border: 1px solid var(--nd-line);
      border-radius: var(--nd-radius);
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
    /* Editor modal = nd-card modal (web) / sheet above the navbar (phones). */
    .pf-rn-modal-bd { position: fixed; top: 0; left: 0; right: 0; bottom: var(--nd-nav-h, 0px); background: rgba(0,0,0,0.45); z-index: 79; }
    .pf-rn-modal {
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      z-index: 80; width: calc(100% - 32px); max-width: 560px;
      max-height: calc(100dvh - var(--nd-nav-h, 0px) - 32px);
      box-shadow: 0 20px 60px rgba(15, 23, 42, 0.28);
    }
    /* Centered modal: fade only (a transform keyframe would un-centre it). */
    .pf-rn-modal { animation: pf-rn-fade var(--nd-dur) var(--nd-spring) both; }
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
      border-top: 1px solid var(--nd-line); flex: none;
    }
    .pf-rn-modal__ftr .nd-btn { height: 40px; min-height: 40px; }

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

      /* The sheet sits ABOVE the always-visible navbar (ND-PATTERN §8). */
      .pf-rn-modal {
        top: auto; left: 0; right: 0; bottom: var(--nd-nav-h, 0px);
        transform: none;
        width: 100%; max-width: none;
        max-height: min(92dvh, calc(100dvh - env(safe-area-inset-top, 0px) - var(--nd-nav-h, 0px) - 8px));
        border-radius: 20px 20px 0 0;
      }
      .pf-rn-modal { animation: nd-rise var(--nd-dur-sheet) var(--nd-spring-bounce) both; }
      .pf-rn-modal__body { max-height: 60dvh; }
      .pf-rn-fld input, .pf-rn-fld textarea { font-size: 16px; }
      .pf-rn-search { font-size: 16px; }
      .pf-rn-modal__ftr { flex-wrap: wrap; }
    }

    /* Capacitor native: bottom-sheet modal must clear the home-indicator /
       gesture bar in addition to the in-app bottom-nav. */
    @media (prefers-reduced-motion: reduce) { .pf-rn-modal { animation: none !important; } }
  `]
})
export class ReferringNetworkComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);
  protected readonly theme = inject(ThemeService);
  /** Row actions: text on web, icon on touch (ND-PATTERN). */
  protected readonly web = webPointerSignal();

  // ── State ───────────────────────────────────────────────────────
  readonly hospitals = signal<Hospital[]>([]);
  readonly loadingHospitals = signal(false);
  /** Skeleton held >= MIN_LOAD_MS (shared/utils/min-duration) so a fast
   *  load never flashes it. */
  readonly loadingHospitalsShown = heldFlag(this.loadingHospitals);
  readonly hospitalSearch = signal('');
  readonly selectedHospitalId = signal<string | null>(null);

  readonly doctorsAll = signal<Doctor[]>([]);
  readonly loadingDoctors = signal(false);
  /** Skeleton held >= MIN_LOAD_MS (shared/utils/min-duration) so a fast
   *  load never flashes it. */
  readonly loadingDoctorsShown = heldFlag(this.loadingDoctors);

  readonly hospitalEditor = signal<Partial<Hospital> | null>(null);
  readonly savingHospital = signal(false);
  readonly doctorEditor = signal<Partial<Doctor> | null>(null);
  readonly savingDoctor = signal(false);
  /** An editor modal is open: its footer Save is the view's ONE primary. */
  readonly editorOpen = computed(() => !!this.hospitalEditor() || !!this.doctorEditor());

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
    return this.doctorsAll().filter(d => d.hospitalId === id);
  });

  setHospitalSearch(v: string) { this.hospitalSearch.set(v); }
  asInput(ev: Event): string { return (ev.target as HTMLInputElement).value; }

  async ngOnInit(): Promise<void> {
    await this.loadHospitals();
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
    } catch (err) {
      this.toasts.error('Could not load hospitals');
    } finally {
      this.loadingHospitals.set(false);
    }
  }

  private async loadDoctorsFor(hospitalId: string): Promise<void> {
    this.loadingDoctors.set(true);
    try {
      const list = await firstValueFrom(
        this.api.get<Doctor[]>(`/api/referring-network/doctors?hospitalId=${hospitalId}&includeInactive=true`));
      // Merge with existing array — keep doctors from other hospitals around
      // (so switching hospitals doesn't refetch unnecessarily).
      const other = this.doctorsAll().filter(d => d.hospitalId !== hospitalId);
      this.doctorsAll.set([...other, ...(list ?? [])]);
    } catch (err) {
      this.toasts.error('Could not load doctors');
    } finally {
      this.loadingDoctors.set(false);
    }
  }

  selectHospital(id: string): void {
    this.selectedHospitalId.set(id);
    void this.loadDoctorsFor(id);
  }

  // ── Hospital editor ────────────────────────────────────────────

  openHospitalEditor(h: Hospital | null): void {
    this.hospitalFieldErr.set({});
    this.hospitalEditor.set(h ? { ...h } : { name: '', isActive: true });
  }
  closeHospitalEditor(): void { this.hospitalEditor.set(null); }

  async saveHospital(): Promise<void> {
    const draft = this.hospitalEditor();
    if (!draft?.name?.trim()) return;
    this.savingHospital.set(true);
    try {
      const body = {
        name: draft.name.trim(),
        code: draft.code ?? null,
        address: draft.address ?? null,
        phone: draft.phone ?? null,
        email: draft.email ?? null,
        gstin: draft.gstin ?? null,
        notes: draft.notes ?? null
      };
      const saved = draft.id
        ? await firstValueFrom(this.api.patch<Hospital>(`/api/referring-network/hospitals/${draft.id}`, body))
        : await firstValueFrom(this.api.post<Hospital>('/api/referring-network/hospitals', body));
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
      if (e.field === 'name' || e.field === 'code') this.hospitalFieldErr.set({ [e.field]: e.message });
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
      message: `Deactivating "${draft.name}" hides it from the order-create dropdown. Past orders that reference it stay intact.`,
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

  // ── Doctor editor ──────────────────────────────────────────────

  openDoctorEditor(d: Doctor | null): void {
    const hospitalId = this.selectedHospitalId();
    this.doctorFieldErr.set({});
    this.doctorEditor.set(d ? { ...d } : { name: '', hospitalId, isActive: true });
  }
  closeDoctorEditor(): void { this.doctorEditor.set(null); }

  async saveDoctor(): Promise<void> {
    const draft = this.doctorEditor();
    if (!draft?.name?.trim()) return;
    this.savingDoctor.set(true);
    try {
      const body = {
        hospitalId: draft.hospitalId ?? this.selectedHospitalId(),
        name: draft.name.trim(),
        designation: draft.designation ?? null,
        department: draft.department ?? null,
        qualification: draft.qualification ?? null,
        specialisation: draft.specialisation ?? null,
        registrationNo: draft.registrationNo ?? null,
        phone: draft.phone ?? null,
        email: draft.email ?? null
      };
      const saved = draft.id
        ? await firstValueFrom(this.api.patch<Doctor>(`/api/referring-network/doctors/${draft.id}`, body))
        : await firstValueFrom(this.api.post<Doctor>('/api/referring-network/doctors', body));
      // Upsert into doctorsAll, update count on the hospital.
      const list = this.doctorsAll().slice();
      const idx = list.findIndex(d => d.id === saved.id);
      if (idx >= 0) list[idx] = saved; else list.push(saved);
      this.doctorsAll.set(list);
      if (!draft.id) {
        // Bump doctor count on the linked hospital.
        this.hospitals.update(h => h.map(x => x.id === saved.hospitalId ? { ...x, doctorCount: x.doctorCount + 1 } : x));
      }
      this.closeDoctorEditor();
      this.toasts.success(draft.id ? 'Doctor updated' : 'Doctor added');
    } catch (err) {
      const e = ApiError.from(err);
      if (e.field === 'name') this.doctorFieldErr.set({ name: e.message });
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
      this.hospitals.update(h => h.map(x => x.id === d.hospitalId ? { ...x, doctorCount: Math.max(0, x.doctorCount - 1) } : x));
      this.toasts.success('Doctor deactivated');
    } catch (err) {
      this.toasts.error(ApiError.from(err).message);
    }
  }
}
