import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { LoadingLogoComponent } from '../../../shared/components/loading-logo/loading-logo.component';

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
  imports: [FormsModule, ScreenHeaderComponent, TouchButtonComponent, LoadingLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 lg:px-10 pt-6 pb-10 max-w-screen-2xl mx-auto w-full">
      <pf-screen-header
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

      <div class="pf-rn-grid">
        <!-- ── Hospitals (left) ────────────────────────────────── -->
        <aside class="pf-rn-pane pf-rn-pane--list">
          <header class="pf-rn-pane__hdr">
            <h2 class="pf-rn-pane__title">Hospitals</h2>
            <span class="pf-rn-pane__count">{{ hospitals().length }}</span>
          </header>
          <input type="search" class="pf-rn-search"
                 placeholder="Search hospitals…"
                 [value]="hospitalSearch()"
                 (input)="setHospitalSearch(asInput($event))" />

          @if (loadingHospitals()) {
            <div class="flex justify-center py-10">
              <pf-loading-logo size="lg" color="purple" [showDna]="true"
                               [showText]="true" text="Loading hospitals…"></pf-loading-logo>
            </div>
          } @else if (filteredHospitals().length === 0) {
            <p class="pf-rn-empty">
              @if (hospitalSearch()) { No hospitals match. }
              @else { No hospitals yet. Click <b>Add hospital</b> above. }
            </p>
          } @else {
            <ul class="pf-rn-list" role="listbox">
              @for (h of filteredHospitals(); track h.id) {
                <li>
                  <button type="button" class="pf-rn-row press"
                          [class.pf-rn-row--on]="selectedHospitalId() === h.id"
                          (click)="selectHospital(h.id)">
                    <div class="min-w-0 flex-1">
                      <p class="pf-rn-row__name">{{ h.name }}</p>
                      <p class="pf-rn-row__meta">
                        @if (h.code) { {{ h.code }} · }
                        {{ h.doctorCount }} doctor<span [class.hidden]="h.doctorCount === 1">s</span>
                        @if (!h.isActive) { · <span class="pf-rn-row__inactive">inactive</span> }
                      </p>
                    </div>
                  </button>
                </li>
              }
            </ul>
          }
        </aside>

        <!-- ── Doctors (right) ─────────────────────────────────── -->
        <section class="pf-rn-pane">
          @if (!selectedHospital(); as _) {
            <div class="pf-rn-placeholder">
              <p class="pf-rn-placeholder__title">Pick a hospital to manage its doctors</p>
              <p class="pf-rn-placeholder__sub">
                Or add a new hospital from the top-right. Reception's typed-in entries auto-appear here too.
              </p>
            </div>
          }
          @if (selectedHospital(); as h) {
            <header class="pf-rn-pane__hdr">
              <div class="min-w-0 flex-1">
                <h2 class="pf-rn-pane__title">{{ h.name }}</h2>
                <p class="pf-rn-pane__sub">
                  @if (h.code) { {{ h.code }} · }
                  @if (h.phone) { {{ h.phone }} · }
                  @if (h.address) { {{ h.address }} }
                  @if (!h.code && !h.phone && !h.address) { no details yet }
                </p>
              </div>
              <pf-touch-btn size="sm" variant="ghost" (pressed)="openHospitalEditor(h)">Edit hospital</pf-touch-btn>
              <pf-touch-btn size="sm" variant="primary" (pressed)="openDoctorEditor(null)">
                <span icon-left aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 5v14M5 12h14"/>
                  </svg>
                </span>
                Add doctor
              </pf-touch-btn>
            </header>

            @if (loadingDoctors()) {
              <div class="flex justify-center py-10">
                <pf-loading-logo size="lg" color="purple" [showDna]="true"
                                 [showText]="true" text="Loading doctors…"></pf-loading-logo>
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
                        @if (d.registrationNo) { Reg #{{ d.registrationNo }} }
                      </p>
                      <p class="pf-rn-doc__contact">
                        @if (d.phone) { {{ d.phone }} }
                        @if (d.phone && d.email) { · }
                        @if (d.email) { {{ d.email }} }
                      </p>
                    </div>
                    <div class="pf-rn-doc__actions">
                      @if (!d.isActive) { <span class="pf-rn-row__inactive">inactive</span> }
                      <button type="button" class="pf-rn-doc__btn press" (click)="openDoctorEditor(d)" aria-label="Edit">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      @if (d.isActive) {
                        <button type="button" class="pf-rn-doc__btn pf-rn-doc__btn--danger press"
                                (click)="deactivateDoctor(d)" aria-label="Deactivate">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                          </svg>
                        </button>
                      }
                    </div>
                  </li>
                }
              </ul>
            }
          }
        </section>
      </div>

      <!-- ── Hospital editor modal ─────────────────────────────── -->
      @if (hospitalEditor(); as he) {
        <div class="pf-rn-modal-bd" (click)="closeHospitalEditor()"></div>
        <div class="pf-rn-modal" role="dialog" aria-modal="true">
          <header class="pf-rn-modal__hdr">
            <h3>{{ he.id ? 'Edit hospital' : 'Add hospital' }}</h3>
            <button type="button" class="pf-rn-modal__close press" (click)="closeHospitalEditor()" aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </header>
          <div class="pf-rn-modal__body">
            <label class="pf-rn-fld">
              <span>Name <span class="pf-rn-fld__req">*</span></span>
              <input type="text" [(ngModel)]="he.name" placeholder="Apollo Hospitals" />
            </label>
            <label class="pf-rn-fld">
              <span>Code</span>
              <input type="text" [(ngModel)]="he.code" placeholder="APO" />
            </label>
            <label class="pf-rn-fld pf-rn-fld--wide">
              <span>Address</span>
              <input type="text" [(ngModel)]="he.address" placeholder="21 Greams Lane, Chennai" />
            </label>
            <label class="pf-rn-fld">
              <span>Phone</span>
              <input type="tel" [(ngModel)]="he.phone" placeholder="+91 44 1234 5678" />
            </label>
            <label class="pf-rn-fld">
              <span>Email</span>
              <input type="email" [(ngModel)]="he.email" placeholder="referrals@apollo.com" />
            </label>
            <label class="pf-rn-fld">
              <span>GSTIN</span>
              <input type="text" [(ngModel)]="he.gstin" placeholder="33AABCA1234A1Z5" />
            </label>
            <label class="pf-rn-fld pf-rn-fld--wide">
              <span>Notes</span>
              <textarea rows="2" [(ngModel)]="he.notes" placeholder="Panel rates, commission deal, billing quirks…"></textarea>
            </label>
          </div>
          <footer class="pf-rn-modal__ftr">
            @if (he.id) {
              <pf-touch-btn size="sm" variant="ghost" (pressed)="deactivateHospital()">Deactivate</pf-touch-btn>
            }
            <span class="flex-1"></span>
            <pf-touch-btn size="sm" variant="ghost" (pressed)="closeHospitalEditor()">Cancel</pf-touch-btn>
            <pf-touch-btn size="sm" variant="primary"
                          [disabled]="!he.name?.trim() || savingHospital()"
                          (pressed)="saveHospital()">
              @if (savingHospital()) { Saving… } @else { Save }
            </pf-touch-btn>
          </footer>
        </div>
      }

      <!-- ── Doctor editor modal ───────────────────────────────── -->
      @if (doctorEditor(); as de) {
        <div class="pf-rn-modal-bd" (click)="closeDoctorEditor()"></div>
        <div class="pf-rn-modal" role="dialog" aria-modal="true">
          <header class="pf-rn-modal__hdr">
            <h3>{{ de.id ? 'Edit doctor' : 'Add doctor' }}</h3>
            <button type="button" class="pf-rn-modal__close press" (click)="closeDoctorEditor()" aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </header>
          <div class="pf-rn-modal__body">
            <label class="pf-rn-fld pf-rn-fld--wide">
              <span>Name <span class="pf-rn-fld__req">*</span></span>
              <input type="text" [(ngModel)]="de.name" placeholder="Dr. Priya Krishnan" />
            </label>
            <label class="pf-rn-fld">
              <span>Designation</span>
              <input type="text" [(ngModel)]="de.designation" placeholder="Consultant Physician" />
            </label>
            <label class="pf-rn-fld">
              <span>Department</span>
              <input type="text" [(ngModel)]="de.department" placeholder="Cardiology" />
            </label>
            <label class="pf-rn-fld">
              <span>Qualification</span>
              <input type="text" [(ngModel)]="de.qualification" placeholder="MBBS, MD" />
            </label>
            <label class="pf-rn-fld">
              <span>Registration #</span>
              <input type="text" [(ngModel)]="de.registrationNo" placeholder="TN-12345" />
            </label>
            <label class="pf-rn-fld">
              <span>Phone</span>
              <input type="tel" [(ngModel)]="de.phone" placeholder="+91 98765 43210" />
            </label>
            <label class="pf-rn-fld">
              <span>Email</span>
              <input type="email" [(ngModel)]="de.email" placeholder="priya@apollo.com" />
            </label>
          </div>
          <footer class="pf-rn-modal__ftr">
            <span class="flex-1"></span>
            <pf-touch-btn size="sm" variant="ghost" (pressed)="closeDoctorEditor()">Cancel</pf-touch-btn>
            <pf-touch-btn size="sm" variant="primary"
                          [disabled]="!de.name?.trim() || savingDoctor()"
                          (pressed)="saveDoctor()">
              @if (savingDoctor()) { Saving… } @else { Save }
            </pf-touch-btn>
          </footer>
        </div>
      }
    </section>
  `,
  styles: [`
    .pf-rn-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
      margin-top: 16px;
    }
    @media (min-width: 1024px) {
      .pf-rn-grid { grid-template-columns: 340px 1fr; align-items: start; }
    }
    .pf-rn-pane {
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 14px;
      padding: 14px;
      min-height: 200px;
    }
    .pf-rn-pane--list { display: flex; flex-direction: column; gap: 10px; }
    .pf-rn-pane__hdr {
      display: flex; align-items: center; gap: 10px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--glass-border);
      margin-bottom: 10px;
    }
    .pf-rn-pane__title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pf-rn-pane__sub { margin: 2px 0 0; font-size: 12px; color: var(--text-tertiary); }
    .pf-rn-pane__count {
      margin-left: auto; padding: 2px 8px; border-radius: 999px;
      background: rgba(168, 85, 247, 0.18); color: #c4b5fd;
      font-size: 11px; font-weight: 700;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }

    .pf-rn-search {
      width: 100%; height: 36px; padding: 0 12px;
      border-radius: 9px;
      border: 1px solid var(--glass-border);
      background: var(--glass-bg);
      color: var(--text-primary); font-size: 13px; outline: none;
    }
    .pf-rn-search:focus { border-color: rgba(168, 85, 247, 0.55); }

    .pf-rn-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; max-height: 60vh; overflow-y: auto; }
    .pf-rn-row {
      display: flex; align-items: center; gap: 10px;
      width: 100%; padding: 10px 12px;
      background: transparent; border: 1px solid transparent;
      border-radius: 10px; text-align: left;
      color: var(--text-primary); cursor: pointer;
      transition: background 0.12s, border-color 0.12s;
    }
    .pf-rn-row:hover { background: var(--glass-bg-hover); }
    .pf-rn-row--on {
      background: color-mix(in srgb, #a78bfa 14%, transparent);
      border-color: rgba(168, 85, 247, 0.55);
    }
    .pf-rn-row__name { margin: 0; font-size: 13.5px; font-weight: 600; }
    .pf-rn-row__meta { margin: 2px 0 0; font-size: 11.5px; color: var(--text-tertiary); }
    .pf-rn-row__inactive { color: #f59e0b; font-weight: 600; }

    .pf-rn-empty { padding: 24px 8px; text-align: center; color: var(--text-tertiary); font-size: 13px; }
    .pf-rn-placeholder { padding: 50px 16px; text-align: center; }
    .pf-rn-placeholder__title { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .pf-rn-placeholder__sub { margin: 6px 0 0; font-size: 12px; color: var(--text-tertiary); }

    .pf-rn-doc-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .pf-rn-doc {
      display: flex; gap: 12px;
      padding: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 12px;
    }
    .pf-rn-doc__main { flex: 1; min-width: 0; }
    .pf-rn-doc__name { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .pf-rn-doc__meta { margin: 2px 0 0; font-size: 12.5px; color: var(--text-secondary); }
    .pf-rn-doc__sub  { margin: 2px 0 0; font-size: 11.5px; color: var(--text-tertiary);
      font-family: 'JetBrains Mono', ui-monospace, monospace; }
    .pf-rn-doc__contact { margin: 2px 0 0; font-size: 11.5px; color: var(--text-tertiary); }
    .pf-rn-doc__actions { display: inline-flex; align-items: flex-start; gap: 4px; }
    .pf-rn-doc__btn {
      width: 28px; height: 28px; border-radius: 8px;
      background: transparent; border: 1px solid var(--glass-border);
      color: var(--text-secondary); cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .pf-rn-doc__btn:hover { background: var(--glass-bg-hover); color: var(--text-primary); }
    .pf-rn-doc__btn--danger:hover { color: #ef4444; border-color: rgba(239, 68, 68, 0.4); }

    /* ── Editor modal ─────────────────────────────────────────── */
    .pf-rn-modal-bd { position: fixed; inset: 0; background: rgba(0,0,0,0.5); backdrop-filter: blur(4px); z-index: 50; }
    .pf-rn-modal {
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      z-index: 51; width: calc(100% - 32px); max-width: 560px;
      max-height: calc(100vh - 32px);
      display: flex; flex-direction: column;
      background: var(--bg-card-solid, #14142a);
      border: 1px solid var(--glass-border);
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }
    .pf-rn-modal__hdr {
      display: flex; align-items: center; gap: 8px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--glass-border);
    }
    .pf-rn-modal__hdr h3 { flex: 1; margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pf-rn-modal__close {
      width: 28px; height: 28px; border-radius: 8px;
      background: transparent; border: none; color: var(--text-secondary); cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .pf-rn-modal__close:hover { background: var(--glass-bg-hover); color: var(--text-primary); }
    .pf-rn-modal__body {
      padding: 14px 16px;
      display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px;
      overflow-y: auto;
    }
    @media (max-width: 540px) { .pf-rn-modal__body { grid-template-columns: 1fr; } }
    .pf-rn-fld--wide { grid-column: 1 / -1; }
    .pf-rn-fld { display: flex; flex-direction: column; gap: 4px; }
    .pf-rn-fld > span {
      font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
      color: var(--text-tertiary);
    }
    .pf-rn-fld__req { color: #f43f5e; }
    .pf-rn-fld input, .pf-rn-fld textarea {
      height: 36px; padding: 0 10px;
      border-radius: 8px;
      border: 1px solid var(--glass-border);
      background: var(--glass-bg);
      color: var(--text-primary); font-size: 13px; outline: none;
    }
    .pf-rn-fld textarea { height: auto; padding: 8px 10px; resize: vertical; min-height: 60px; }
    .pf-rn-fld input:focus, .pf-rn-fld textarea:focus { border-color: rgba(168, 85, 247, 0.55); }
    .pf-rn-modal__ftr {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--glass-border);
    }
  `]
})
export class ReferringNetworkComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);

  // ── State ───────────────────────────────────────────────────────
  readonly hospitals = signal<Hospital[]>([]);
  readonly loadingHospitals = signal(false);
  readonly hospitalSearch = signal('');
  readonly selectedHospitalId = signal<string | null>(null);

  readonly doctorsAll = signal<Doctor[]>([]);
  readonly loadingDoctors = signal(false);

  readonly hospitalEditor = signal<Partial<Hospital> | null>(null);
  readonly savingHospital = signal(false);
  readonly doctorEditor = signal<Partial<Doctor> | null>(null);
  readonly savingDoctor = signal(false);

  // ── Derived ─────────────────────────────────────────────────────
  readonly filteredHospitals = computed(() => {
    const q = this.hospitalSearch().trim().toLowerCase();
    const list = this.hospitals();
    if (!q) return list;
    return list.filter(h =>
      h.name.toLowerCase().includes(q) || (h.code ?? '').toLowerCase().includes(q));
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
      this.toasts.error((err as Error).message ?? 'Save failed');
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
      this.toasts.error((err as Error).message ?? 'Could not deactivate');
    }
  }

  // ── Doctor editor ──────────────────────────────────────────────

  openDoctorEditor(d: Doctor | null): void {
    const hospitalId = this.selectedHospitalId();
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
      this.toasts.error((err as Error).message ?? 'Save failed');
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
      this.toasts.error((err as Error).message ?? 'Could not deactivate');
    }
  }
}
