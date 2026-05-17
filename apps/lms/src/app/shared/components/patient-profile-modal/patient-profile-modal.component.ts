import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy, Component, HostListener,
  computed, effect, inject, signal
} from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { PatientProfileService } from '../../../core/services/patient-profile.service';
import { ToastService } from '../../../core/services/toast.service';
import { Patient, patientDisplayName, patientMrnLabel } from '../../models/patient.model';
import { AvatarComponent } from '../../primitives/avatar.component';
import { PfSelectOption, SelectComponent } from '../../primitives/select.component';
import { LoadingLogoComponent } from '../loading-logo/loading-logo.component';

interface HistoryRow {
  id: string;
  branchId: string;
  branchName?: string;
  status: string;
  priority: string;
  source: string;
  collectionType: string;
  createdAt: string;
  samples: Array<{
    id: string;
    status: string;
    tests: Array<{ id: string; status: string; name?: string; code?: string }>;
  }>;
  bill?: { id: string; status: string; totalPayable: number; balance: number } | null;
  report?: { id: string; status: string; deliveryStatus: string } | null;
}

interface ProfileResponse {
  patient: Patient;
  history: HistoryRow[];
}

const PAGE_SIZE = 50;
const SEX_OPTIONS: PfSelectOption<string>[] = [
  { value: '',       label: '—' },
  { value: 'Male',   label: 'Male' },
  { value: 'Female', label: 'Female' },
  { value: 'Other',  label: 'Other' }
];

const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  draft:      { label: 'Draft',         tone: 'muted' },
  created:    { label: 'Registered',    tone: 'violet' },
  billed:     { label: 'Billing done',  tone: 'amber' },
  collected:  { label: 'Sample collected', tone: 'sky' },
  in_progress:{ label: 'In progress',   tone: 'violet' },
  validated:  { label: 'Ready',         tone: 'emerald' },
  delivered:  { label: 'Completed',     tone: 'emerald' },
  cancelled:  { label: 'Cancelled',     tone: 'rose' }
};

@Component({
  selector: 'pf-patient-profile-modal',
  standalone: true,
  imports: [CommonModule, AvatarComponent, SelectComponent, LoadingLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-pp-root pf-sheet" [class.pf-pp-hidden]="!open()" role="dialog" aria-modal="true" [attr.aria-hidden]="!open()" aria-label="Patient profile">
      <div class="pf-pp-backdrop" (click)="close()"></div>

        <div class="pf-pp-shell pf-sheet__panel">
          @if (loading()) {
            <div class="pf-pp-loading flex justify-center py-10">
              <pf-loading-logo size="xl" color="purple" [showDna]="true"
                               [showText]="true" text="Loading patient…"></pf-loading-logo>
            </div>
          } @else if (!patient()) {
            <div class="pf-pp-loading">Patient not found.</div>
          } @else {
            <!-- ── Header — patient identity ──────────────────── -->
            <header class="pf-pp-hdr">
              <div class="pf-pp-hdr__avatar-wrap">
                <pf-avatar [name]="displayName()" [size]="64"></pf-avatar>
                @if (patient()!.isMinor) {
                  <span class="pf-pp-hdr__minor-tag" title="Minor">Minor</span>
                }
              </div>

              <div class="pf-pp-hdr__main">
                @if (!editMode()) {
                  <div class="pf-pp-hdr__row1">
                    <h2 class="pf-pp-hdr__name">{{ displayName() }}</h2>
                    <span class="pf-pp-id-chip"
                          [title]="'MRN: ' + mrnLabel()">{{ mrnLabel() }}</span>
                  </div>
                  <ul class="pf-pp-hdr__meta">
                    <li class="pf-pp-meta-item">
                      <span class="pf-pp-meta-icon">👤</span>
                      <span>{{ patient()!.age ?? '—' }}{{ patient()!.age != null ? 'y' : '' }} · {{ patient()!.sex || '—' }}</span>
                    </li>
                    <li class="pf-pp-meta-item">
                      <span class="pf-pp-meta-icon">📞</span>
                      <span class="pf-pp-mono">{{ patient()!.phone || 'No mobile' }}</span>
                      <button type="button" class="pf-pp-link-sm"
                              (click)="startMobileChange()">Change</button>
                    </li>
                    @if (patient()!.email) {
                      <li class="pf-pp-meta-item">
                        <span class="pf-pp-meta-icon">✉</span>
                        <span class="pf-pp-truncate">{{ patient()!.email }}</span>
                      </li>
                    }
                    @if (stats().lastVisit) {
                      <li class="pf-pp-meta-item">
                        <span class="pf-pp-meta-icon">🗓</span>
                        <span>Last visit {{ formatDate(stats().lastVisit!) }}</span>
                      </li>
                    }
                  </ul>
                } @else {
                  <div class="pf-pp-edit-grid">
                    <label>
                      <span>First name</span>
                      <input class="pf-pp-input" [value]="draft().firstName"
                             (input)="setDraftField('firstName', $any($event.target).value)" />
                    </label>
                    <label>
                      <span>Father's name</span>
                      <input class="pf-pp-input" [value]="draft().fathersName"
                             (input)="setDraftField('fathersName', $any($event.target).value)" />
                    </label>
                    <label>
                      <span>Date of birth</span>
                      <input type="date" class="pf-pp-input" [value]="draft().dateOfBirth"
                             (input)="setDob($any($event.target).value)" />
                    </label>
                    <label>
                      <span>Age</span>
                      <input type="number" min="0" max="130" class="pf-pp-input"
                             [value]="draft().age"
                             (input)="setAge($any($event.target).value)" />
                    </label>
                    <label>
                      <span>Sex</span>
                      <pf-select [options]="sexOptions" [value]="draft().sex"
                                 (valueChange)="setDraftField('sex', $event)"></pf-select>
                    </label>
                  </div>
                  <p class="pf-pp-hint">DOB → age auto-calculates. Setting age leaves DOB untouched.</p>
                }
              </div>

              <div class="pf-pp-hdr__actions">
                @if (!editMode()) {
                  <button type="button" class="pf-pp-btn pf-pp-btn--primary press"
                          (click)="newOrder()">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M12 5v14M5 12h14"/>
                    </svg>
                    New order
                  </button>
                  @if (canEdit()) {
                    <button type="button" class="pf-pp-btn pf-pp-btn--ghost press"
                            (click)="enterEdit()" title="Edit patient details">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z"/>
                      </svg>
                      Edit
                    </button>
                  }
                  @if (canDelete()) {
                    <button type="button" class="pf-pp-icon-btn pf-pp-icon-btn--danger press"
                            (click)="confirmDelete()" title="Delete (admin)">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                      </svg>
                    </button>
                  }
                } @else {
                  <button type="button" class="pf-pp-btn pf-pp-btn--ghost press"
                          [disabled]="saving()" (click)="cancelEdit()">Cancel</button>
                  <button type="button" class="pf-pp-btn pf-pp-btn--primary press"
                          [disabled]="saving() || !editValid()"
                          (click)="saveEdit()">{{ saving() ? 'Saving…' : 'Save changes' }}</button>
                }
                <button type="button" class="pf-pp-icon-btn press" aria-label="Close" (click)="close()">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
                  </svg>
                </button>
              </div>
            </header>

            <!-- ── Stats strip + ABHA card on one row ───────────── -->
            <section class="pf-pp-overview">
              <div class="pf-pp-stat" data-tone="violet">
                <span class="pf-pp-stat__label">Visits</span>
                <span class="pf-pp-stat__value">{{ stats().visits }}</span>
              </div>
              <div class="pf-pp-stat" data-tone="sky">
                <span class="pf-pp-stat__label">Branches</span>
                <span class="pf-pp-stat__value">{{ stats().branches || '—' }}</span>
              </div>
              <div class="pf-pp-stat" [attr.data-tone]="stats().unpaid > 0 ? 'rose' : 'emerald'">
                <span class="pf-pp-stat__label">Unpaid</span>
                <span class="pf-pp-stat__value">{{ stats().unpaid }}</span>
              </div>

              <div class="pf-pp-abha-card" [class.pf-pp-abha-card--linked]="!!patient()!.abhaId">
                <div class="pf-pp-abha-card__head">
                  <span class="pf-pp-abha-card__icon" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="3" y="6" width="18" height="13" rx="2"/>
                      <path d="M3 10h18"/><path d="M8 15h2"/>
                    </svg>
                  </span>
                  <div class="pf-pp-abha-card__text">
                    <span class="pf-pp-abha-card__title">ABHA</span>
                    @if (patient()!.abhaId) {
                      <span class="pf-pp-abha-card__sub pf-pp-mono">{{ patient()!.abhaId }}</span>
                    } @else {
                      <span class="pf-pp-abha-card__sub pf-pp-muted">Not linked</span>
                    }
                  </div>
                  @if (patient()!.abhaId && patient()!.abhaVerified) {
                    <span class="pf-pp-badge pf-pp-badge--success">Verified</span>
                  }
                </div>
                <div class="pf-pp-abha-card__actions">
                  @if (patient()!.abhaId) {
                    <button type="button" class="pf-pp-mini-btn pf-pp-mini-btn--rose"
                            (click)="unlinkAbha()" [disabled]="abhaBusy()">Unlink</button>
                  } @else {
                    <button type="button" class="pf-pp-mini-btn pf-pp-mini-btn--accent"
                            (click)="startAbhaLink()">Link existing</button>
                    <button type="button" class="pf-pp-mini-btn"
                            (click)="startAbhaCreate()">Create new</button>
                  }
                </div>
              </div>
            </section>

            <!-- ── Visit history ──────────────────────────────── -->
            <section class="pf-pp-history">
              <header class="pf-pp-history__hdr">
                <h3>Visit history</h3>
                <span class="pf-pp-history__count">{{ history().length }} visit{{ history().length === 1 ? '' : 's' }}</span>
              </header>

              @if (history().length === 0) {
                <p class="pf-pp-empty">No visits yet for this patient.</p>
              } @else {
                <div class="pf-pp-table-wrap">
                  <table class="pf-pp-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Test / package</th>
                        <th>Branch</th>
                        <th>Status</th>
                        <th>Invoice</th>
                        <th>Report</th>
                        <th class="pf-pp-th-end">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (h of pagedHistory(); track h.id) {
                        <tr>
                          <td class="pf-pp-mono pf-pp-cell-date">{{ formatDate(h.createdAt) }}</td>
                          <td>{{ summariseTests(h) }}</td>
                          <td>{{ h.branchName || '—' }}</td>
                          <td>
                            <span class="pf-pp-status" [attr.data-tone]="statusTone(h.status)">
                              {{ statusLabel(h.status) }}
                            </span>
                          </td>
                          <td>
                            @if (h.bill) {
                              <button type="button" class="pf-pp-link"
                                      (click)="openInvoice(h)">View</button>
                            } @else {
                              <span class="pf-pp-muted">—</span>
                            }
                          </td>
                          <td>
                            @if (canViewReport(h)) {
                              <button type="button" class="pf-pp-link"
                                      (click)="openReport(h)">View</button>
                            } @else {
                              <span class="pf-pp-muted">—</span>
                            }
                          </td>
                          <td class="pf-pp-th-end">
                            <button type="button" class="pf-pp-mini-btn pf-pp-mini-btn--accent"
                                    (click)="repeat(h)">↻ Repeat</button>
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>

                  @if (history().length > pageLimit()) {
                    <footer class="pf-pp-history__foot">
                      <span class="pf-pp-muted">
                        Showing {{ pagedHistory().length }} of {{ history().length }}
                      </span>
                      <button type="button" class="pf-pp-btn pf-pp-btn--ghost press"
                              (click)="loadMore()">
                        Load {{ remainingCount() }} more
                      </button>
                    </footer>
                  }
                </div>
              }
            </section>

            <!-- ── Footer ─────────────────────────────────────── -->
            <footer class="pf-pp-foot">
              <button type="button" class="pf-pp-btn pf-pp-btn--ghost press" (click)="close()">Close</button>
            </footer>
          }
        </div>
    </div>

    <!-- ── Sub-modal: change mobile ─────────────────────────── -->
    @if (mobilePromptOpen()) {
      <div class="pf-pp-sub" role="dialog" aria-modal="true" aria-label="Change mobile">
        <div class="pf-pp-sub__bd" (click)="cancelMobileChange()"></div>
        <div class="pf-pp-sub__card">
          <h3>Change mobile</h3>
          <p>Updates the patient's contact number. No OTP. No record merge.</p>
          <input class="pf-pp-input" type="tel" inputmode="numeric" maxlength="13"
                 placeholder="10-digit mobile"
                 [value]="mobileDraft()"
                 (input)="mobileDraft.set($any($event.target).value)" />
          @if (mobileError()) {
            <p class="pf-pp-error">{{ mobileError() }}</p>
          }
          <div class="pf-pp-sub__actions">
            <button type="button" class="pf-pp-btn pf-pp-btn--ghost"
                    (click)="cancelMobileChange()">Cancel</button>
            <button type="button" class="pf-pp-btn pf-pp-btn--primary"
                    [disabled]="!mobileValid() || mobileBusy()"
                    (click)="saveMobile()">{{ mobileBusy() ? 'Saving…' : 'Save' }}</button>
          </div>
        </div>
      </div>
    }

    <!-- ── Sub-modal: link ABHA ─────────────────────────────── -->
    @if (abhaLinkOpen()) {
      <div class="pf-pp-sub" role="dialog" aria-modal="true" aria-label="Link ABHA">
        <div class="pf-pp-sub__bd" (click)="cancelAbhaLink()"></div>
        <div class="pf-pp-sub__card">
          <h3>Link ABHA</h3>
          <p>Enter the patient's existing 14-digit ABHA number.</p>
          <input class="pf-pp-input pf-pp-mono" inputmode="numeric" maxlength="17"
                 placeholder="1234-5678-9012-3456"
                 [value]="abhaDraft()"
                 (input)="abhaDraft.set($any($event.target).value)" />
          @if (abhaError()) { <p class="pf-pp-error">{{ abhaError() }}</p> }
          <div class="pf-pp-sub__actions">
            <button type="button" class="pf-pp-btn pf-pp-btn--ghost"
                    (click)="cancelAbhaLink()">Cancel</button>
            <button type="button" class="pf-pp-btn pf-pp-btn--primary"
                    [disabled]="!abhaValid() || abhaBusy()"
                    (click)="saveAbhaLink()">{{ abhaBusy() ? 'Linking…' : 'Link' }}</button>
          </div>
        </div>
      </div>
    }

    <!-- ── Sub-modal: create ABHA (placeholder — ABDM not yet wired) ── -->
    @if (abhaCreateOpen()) {
      <div class="pf-pp-sub" role="dialog" aria-modal="true" aria-label="Create ABHA">
        <div class="pf-pp-sub__bd" (click)="cancelAbhaCreate()"></div>
        <div class="pf-pp-sub__card">
          <h3>Create ABHA</h3>
          <p>Issue a fresh ABHA via Aadhaar OTP. The patient's name, DOB and mobile carry over from the profile.</p>
          <div class="pf-pp-stub">
            <p><strong>Coming next phase.</strong></p>
            <p>This requires a live ABDM gateway integration. The link will switch on once production credentials are wired in.</p>
          </div>
          <div class="pf-pp-sub__actions">
            <button type="button" class="pf-pp-btn pf-pp-btn--ghost"
                    (click)="cancelAbhaCreate()">Close</button>
          </div>
        </div>
      </div>
    }

    <!-- ── Sub-modal: confirm delete ────────────────────────── -->
    @if (deleteConfirmOpen()) {
      <div class="pf-pp-sub" role="dialog" aria-modal="true" aria-label="Delete patient">
        <div class="pf-pp-sub__bd" (click)="cancelDelete()"></div>
        <div class="pf-pp-sub__card pf-pp-sub__card--danger">
          <h3>Delete this patient?</h3>
          <p>The patient and their full history will stop appearing in search and listings. Existing orders, bills and reports remain in the system for compliance — this is a soft-delete.</p>
          <div class="pf-pp-sub__actions">
            <button type="button" class="pf-pp-btn pf-pp-btn--ghost"
                    (click)="cancelDelete()">Cancel</button>
            <button type="button" class="pf-pp-btn pf-pp-btn--danger"
                    [disabled]="deleteBusy()"
                    (click)="doDelete()">{{ deleteBusy() ? 'Deleting…' : 'Delete' }}</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }

    /* Always-rendered modal: visibility is toggled via this class.
     * See plan /Users/suganthan/.claude/plans/drifting-orbiting-anchor.md. */
    .pf-pp-hidden { display: none !important; }

    /* ── Backdrop + shell ─────────────────────────────────── */
    .pf-pp-root {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 5vh 24px 24px;
    }
    .pf-pp-backdrop {
      position: absolute;
      inset: 0;
      background:
        radial-gradient(900px 600px at 50% 100%, rgba(124, 58, 237, 0.12), transparent 60%),
        rgba(15, 15, 25, 0.45);
      backdrop-filter: blur(10px) saturate(1.2);
      -webkit-backdrop-filter: blur(10px) saturate(1.2);
      animation: pf-pp-fade 0.18s ease-out both;
    }
    .pf-pp-shell {
      position: relative;
      width: 100%;
      max-width: 1080px;
      max-height: 86dvh;
      display: flex;
      flex-direction: column;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      border-radius: 18px;
      box-shadow:
        0 1px 0 0 rgba(255,255,255,0.04) inset,
        0 30px 70px rgba(0,0,0,0.55),
        0 0 0 1px rgba(168,85,247,0.06);
      overflow: hidden;
      animation: pf-pp-pop 0.24s cubic-bezier(0.2, 0.9, 0.25, 1.05) both;
    }

    /* ── Header ──────────────────────────────────────────── */
    .pf-pp-hdr {
      position: relative;
      display: flex;
      align-items: flex-start;
      gap: 18px;
      padding: 22px 24px 18px;
      border-bottom: 1px solid var(--glass-border);
      background:
        radial-gradient(640px 200px at 0% 0%, rgba(168, 85, 247, 0.08), transparent 60%),
        radial-gradient(640px 200px at 100% 0%, rgba(236, 72, 153, 0.06), transparent 60%);
    }
    .pf-pp-hdr__avatar-wrap {
      position: relative;
      flex-shrink: 0;
      padding: 3px;
      border-radius: 9999px;
      background: linear-gradient(135deg, rgba(139, 92, 246, 0.4), rgba(217, 70, 239, 0.32));
    }
    .pf-pp-hdr__avatar-wrap > * { display: block; }
    .pf-pp-hdr__minor-tag {
      position: absolute;
      bottom: -4px;
      right: -4px;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 2px 6px;
      border-radius: 9999px;
      background: linear-gradient(135deg, #f59e0b, #fbbf24);
      color: #1f1300;
      box-shadow: 0 4px 10px rgba(245, 158, 11, 0.4);
    }

    .pf-pp-hdr__main { flex: 1; min-width: 0; }
    .pf-pp-hdr__row1 {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .pf-pp-hdr__name {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.015em;
      color: var(--text-primary);
      line-height: 1.2;
    }
    .pf-pp-id-chip {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      padding: 2px 8px;
      border-radius: 6px;
      background: rgba(168, 85, 247, 0.12);
      border: 1px solid rgba(168, 85, 247, 0.24);
      color: #c4b5fd;
    }

    .pf-pp-hdr__meta {
      list-style: none;
      margin: 8px 0 0;
      padding: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 4px 16px;
      font-size: 13px;
      color: var(--text-secondary);
    }
    .pf-pp-meta-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .pf-pp-meta-icon {
      font-size: 12px;
      opacity: 0.7;
      filter: grayscale(0.4);
    }
    .pf-pp-truncate {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 22ch;
    }

    .pf-pp-link-sm {
      background: transparent;
      border: 0;
      color: #c4b5fd;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      padding: 0 0 0 4px;
    }
    .pf-pp-link-sm:hover { color: #ddd6fe; text-decoration: underline; }

    .pf-pp-hdr__actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

    /* Edit grid */
    .pf-pp-edit-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px 12px;
      margin-top: 6px;
    }
    .pf-pp-edit-grid label { display: flex; flex-direction: column; gap: 4px; }
    .pf-pp-edit-grid label > span {
      font-size: 10.5px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-tertiary);
    }
    .pf-pp-input {
      width: 100%;
      padding: 0.55rem 0.8rem;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      color: var(--input-text);
      border-radius: 10px;
      font-size: 13.5px;
      outline: none;
    }
    .pf-pp-input:focus { border-color: var(--input-border-focus); box-shadow: 0 0 0 3px rgba(139,92,246,0.18); }
    .pf-pp-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12.5px; }
    .pf-pp-hint { margin: 6px 0 0; font-size: 11.5px; color: var(--text-muted); }

    /* Buttons */
    .pf-pp-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0.5rem 0.95rem;
      font-size: 12.5px;
      font-weight: 600;
      border-radius: 9px;
      border: 1px solid transparent;
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
    }
    .pf-pp-btn[disabled] { opacity: 0.5; cursor: not-allowed; }
    .pf-pp-btn--ghost { background: transparent; color: var(--text-secondary); border-color: var(--glass-border); }
    .pf-pp-btn--ghost:hover:not([disabled]) { background: var(--bg-hover); color: var(--text-primary); }
    .pf-pp-btn--primary {
      background: linear-gradient(135deg, #8b5cf6, #ec4899);
      color: white;
      box-shadow: 0 6px 18px rgba(124, 58, 237, 0.32);
    }
    .pf-pp-btn--primary:hover:not([disabled]) { filter: brightness(1.08); }
    .pf-pp-btn--danger {
      background: linear-gradient(135deg, #ef4444, #f43f5e);
      color: white;
    }
    .pf-pp-btn--danger:hover:not([disabled]) { filter: brightness(1.08); }

    .pf-pp-icon-btn {
      width: 32px; height: 32px;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent;
      border: 1px solid var(--glass-border);
      border-radius: 9px;
      color: var(--text-muted);
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    }
    .pf-pp-icon-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
    .pf-pp-icon-btn--danger:hover {
      background: rgba(239, 68, 68, 0.1);
      color: #fca5a5;
      border-color: rgba(239, 68, 68, 0.32);
    }

    .pf-pp-mini-btn {
      padding: 3px 9px;
      font-size: 11.5px;
      font-weight: 600;
      border-radius: 7px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      cursor: pointer;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .pf-pp-mini-btn:hover:not([disabled]) { background: var(--bg-hover); color: var(--text-primary); }
    .pf-pp-mini-btn[disabled] { opacity: 0.5; cursor: not-allowed; }
    .pf-pp-mini-btn--accent {
      background: rgba(168, 85, 247, 0.12);
      border-color: rgba(168, 85, 247, 0.3);
      color: #c4b5fd;
    }
    .pf-pp-mini-btn--accent:hover { background: rgba(168, 85, 247, 0.2); }
    .pf-pp-mini-btn--rose { color: #fca5a5; border-color: rgba(239, 68, 68, 0.3); }
    .pf-pp-mini-btn--rose:hover:not([disabled]) { background: rgba(239, 68, 68, 0.1); }

    /* ── Overview row: stat tiles + ABHA card ─────────────── */
    .pf-pp-overview {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(220px, 1.6fr);
      gap: 10px;
      padding: 14px 24px;
      border-bottom: 1px solid var(--glass-border);
    }
    @media (max-width: 720px) {
      .pf-pp-overview {
        grid-template-columns: repeat(3, 1fr);
      }
      .pf-pp-abha-card { grid-column: 1 / -1; }
    }

    .pf-pp-stat {
      position: relative;
      padding: 10px 14px;
      border-radius: 12px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      display: flex;
      flex-direction: column;
      gap: 2px;
      overflow: hidden;
    }
    .pf-pp-stat::before {
      content: '';
      position: absolute;
      left: 0; top: 0; bottom: 0;
      width: 3px;
      background: var(--stat-stripe, #8b5cf6);
    }
    .pf-pp-stat[data-tone='violet']  { --stat-stripe: linear-gradient(180deg, #8b5cf6, #ec4899); }
    .pf-pp-stat[data-tone='sky']     { --stat-stripe: linear-gradient(180deg, #0ea5e9, #38bdf8); }
    .pf-pp-stat[data-tone='emerald'] { --stat-stripe: linear-gradient(180deg, #10b981, #34d399); }
    .pf-pp-stat[data-tone='rose']    { --stat-stripe: linear-gradient(180deg, #f43f5e, #fb7185); }
    .pf-pp-stat__label {
      font-size: 10.5px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-tertiary);
    }
    .pf-pp-stat__value {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: var(--text-primary);
      line-height: 1.05;
    }

    .pf-pp-abha-card {
      padding: 10px 14px;
      border-radius: 12px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      display: flex;
      flex-direction: column;
      gap: 8px;
      transition: border-color 0.18s ease;
    }
    .pf-pp-abha-card--linked {
      border-color: rgba(34, 197, 94, 0.32);
      background: linear-gradient(135deg, rgba(34, 197, 94, 0.06), rgba(34, 197, 94, 0));
    }
    .pf-pp-abha-card__head { display: flex; align-items: center; gap: 10px; }
    .pf-pp-abha-card__icon {
      width: 32px; height: 32px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 9px;
      background: rgba(34, 197, 94, 0.14);
      border: 1px solid rgba(34, 197, 94, 0.28);
      color: #86efac;
      flex-shrink: 0;
    }
    .pf-pp-abha-card--linked .pf-pp-abha-card__icon {
      background: linear-gradient(135deg, rgba(34, 197, 94, 0.24), rgba(16, 185, 129, 0.12));
    }
    .pf-pp-abha-card__text { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
    .pf-pp-abha-card__title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-tertiary);
    }
    .pf-pp-abha-card__sub {
      font-size: 13px;
      color: var(--text-primary);
    }
    .pf-pp-abha-card__actions { display: flex; gap: 6px; flex-wrap: wrap; }

    .pf-pp-muted { color: var(--text-muted); }
    .pf-pp-badge {
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.06em;
      padding: 2px 6px;
      border-radius: 4px;
      text-transform: uppercase;
    }
    .pf-pp-badge--success {
      background: rgba(34, 197, 94, 0.14);
      border: 1px solid rgba(34, 197, 94, 0.28);
      color: #86efac;
    }

    /* ── History ─────────────────────────────────────────── */
    .pf-pp-history { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 24px 20px; }
    .pf-pp-history__hdr {
      display: flex;
      align-items: baseline;
      gap: 10px;
      margin-bottom: 10px;
    }
    .pf-pp-history__hdr h3 {
      margin: 0;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-tertiary);
    }
    .pf-pp-history__count {
      font-size: 11.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: var(--text-secondary);
      padding: 1px 8px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
    }

    .pf-pp-empty {
      padding: 36px 24px;
      text-align: center;
      color: var(--text-secondary);
      font-size: 13px;
      border: 1px dashed var(--glass-border);
      border-radius: 12px;
    }

    .pf-pp-table-wrap {
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      overflow: hidden;
      background: var(--bg-card-solid);
    }
    .pf-pp-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .pf-pp-table thead th {
      position: sticky;
      top: 0;
      background: rgba(0,0,0,0.28);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      padding: 10px 14px;
      text-align: left;
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-tertiary);
      border-bottom: 1px solid var(--glass-border);
      z-index: 1;
    }
    .pf-pp-th-end { text-align: right; }
    .pf-pp-table tbody td {
      padding: 12px 14px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      vertical-align: middle;
      color: var(--text-primary);
    }
    .pf-pp-table tbody tr:last-child td { border-bottom: 0; }
    .pf-pp-table tbody tr {
      transition: background 0.12s ease;
    }
    .pf-pp-table tbody tr:hover {
      background: linear-gradient(90deg, rgba(168,85,247,0.06), rgba(168,85,247,0));
    }
    .pf-pp-cell-date {
      color: var(--text-secondary);
      white-space: nowrap;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 12px;
    }

    .pf-pp-status {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11.5px;
      font-weight: 600;
      padding: 3px 9px 3px 8px;
      border-radius: 9999px;
      letter-spacing: 0.01em;
    }
    .pf-pp-status::before {
      content: '';
      width: 6px;
      height: 6px;
      border-radius: 9999px;
      background: currentColor;
      flex-shrink: 0;
      box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.0);
    }
    .pf-pp-status[data-tone='violet'] { background: rgba(168,85,247,0.14); color: #c4b5fd; border: 1px solid rgba(168,85,247,0.32); }
    .pf-pp-status[data-tone='amber']  { background: rgba(245,158,11,0.14); color: #fbbf24; border: 1px solid rgba(245,158,11,0.32); }
    .pf-pp-status[data-tone='sky']    { background: rgba(14,165,233,0.14); color: #38bdf8; border: 1px solid rgba(14,165,233,0.32); }
    .pf-pp-status[data-tone='emerald']{ background: rgba(34,197,94,0.14); color: #86efac; border: 1px solid rgba(34,197,94,0.32); }
    .pf-pp-status[data-tone='rose']   { background: rgba(244,63,94,0.14); color: #fb7185; border: 1px solid rgba(244,63,94,0.32); }
    .pf-pp-status[data-tone='muted']  { background: rgba(255,255,255,0.04); color: var(--text-muted); border: 1px solid var(--glass-border); }

    .pf-pp-link {
      background: transparent;
      border: 0;
      color: #c4b5fd;
      font-weight: 600;
      cursor: pointer;
      font-size: 12.5px;
      padding: 4px 10px;
      border-radius: 8px;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .pf-pp-link:hover {
      color: #ddd6fe;
      background: rgba(168, 85, 247, 0.1);
    }

    .pf-pp-history__foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      border-top: 1px solid var(--glass-border);
    }

    /* ── Footer ──────────────────────────────────────────── */
    .pf-pp-foot {
      padding: 12px 22px;
      border-top: 1px solid var(--glass-border);
      display: flex;
      justify-content: flex-end;
    }

    .pf-pp-loading {
      padding: 56px 32px;
      text-align: center;
      color: var(--text-tertiary);
      font-size: 13px;
    }

    /* ── Sub-modals ──────────────────────────────────────── */
    .pf-pp-sub {
      position: fixed;
      inset: 0;
      z-index: 1100;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .pf-pp-sub__bd {
      position: absolute;
      inset: 0;
      background: rgba(5,5,15,0.62);
      backdrop-filter: blur(8px);
    }
    .pf-pp-sub__card {
      position: relative;
      width: 100%;
      max-width: 420px;
      padding: 22px 22px 18px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      border-radius: 16px;
      box-shadow: 0 30px 70px rgba(0,0,0,0.55);
    }
    .pf-pp-sub__card--danger { border-color: rgba(239, 68, 68, 0.32); }
    .pf-pp-sub__card h3 { margin: 0 0 6px; font-size: 16px; font-weight: 600; color: var(--text-primary); }
    .pf-pp-sub__card p { margin: 0 0 12px; font-size: 13px; color: var(--text-secondary); line-height: 1.5; }
    .pf-pp-sub__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }

    .pf-pp-error { color: #fca5a5; font-size: 12.5px; margin: 6px 0 0; }
    .pf-pp-stub {
      padding: 12px;
      border: 1px dashed rgba(168,85,247,0.32);
      border-radius: 10px;
      background: rgba(168,85,247,0.06);
      color: var(--text-secondary);
      font-size: 12.5px;
      line-height: 1.5;
    }
    .pf-pp-stub p { margin: 0 0 4px; }
  `]
})
export class PatientProfileModalComponent {
  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly profile = inject(PatientProfileService);
  private readonly toasts = inject(ToastService);

  protected readonly sexOptions = SEX_OPTIONS;

  // Lifecycle: when activeId flips, fetch the profile.
  private readonly _patient = signal<Patient | null>(null);
  private readonly _history = signal<HistoryRow[]>([]);
  private readonly _loading = signal(false);
  private readonly _saving = signal(false);
  private readonly _editMode = signal(false);
  private readonly _draft = signal<DraftPatient>({ firstName: '', fathersName: '', dateOfBirth: '', age: '', sex: '' });
  private readonly _pageLimit = signal(PAGE_SIZE);

  // Sub-modal state.
  private readonly _mobilePromptOpen = signal(false);
  protected readonly mobileDraft = signal('');
  private readonly _mobileBusy = signal(false);
  private readonly _mobileError = signal<string | null>(null);

  private readonly _abhaLinkOpen = signal(false);
  protected readonly abhaDraft = signal('');
  private readonly _abhaBusy = signal(false);
  private readonly _abhaError = signal<string | null>(null);
  private readonly _abhaCreateOpen = signal(false);

  private readonly _deleteConfirmOpen = signal(false);
  private readonly _deleteBusy = signal(false);

  readonly open = computed(() => this.profile.activeId() !== null);
  readonly patient = this._patient.asReadonly();
  readonly history = this._history.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly editMode = this._editMode.asReadonly();
  readonly draft = this._draft.asReadonly();
  readonly pageLimit = this._pageLimit.asReadonly();

  readonly mobilePromptOpen = this._mobilePromptOpen.asReadonly();
  readonly mobileBusy = this._mobileBusy.asReadonly();
  readonly mobileError = this._mobileError.asReadonly();

  readonly abhaLinkOpen = this._abhaLinkOpen.asReadonly();
  readonly abhaCreateOpen = this._abhaCreateOpen.asReadonly();
  readonly abhaBusy = this._abhaBusy.asReadonly();
  readonly abhaError = this._abhaError.asReadonly();

  readonly deleteConfirmOpen = this._deleteConfirmOpen.asReadonly();
  readonly deleteBusy = this._deleteBusy.asReadonly();

  readonly displayName = computed(() => patientDisplayName(this._patient()));
  readonly mrnLabel = computed(() => patientMrnLabel(this._patient()));

  /** Quick-glance numbers shown in the header strip — derived from the
   *  loaded history so we don't make a second round-trip. */
  readonly stats = computed(() => {
    const rows = this._history();
    const visits = rows.length;
    const branches = new Set(rows.map(r => r.branchId).filter(Boolean)).size;
    const lastVisit = rows.length > 0 ? rows[0].createdAt : null;
    const unpaid = rows.filter(r => r.bill && r.bill.status !== 'paid').length;
    return { visits, branches, lastVisit, unpaid };
  });

  readonly canEdit = computed(() => this.auth.hasPermission('edit_patient'));
  readonly canDelete = computed(() =>
    this.auth.hasPermission('manage_tenant') || (this.auth.user()?.permissions ?? []).includes('*'));

  readonly editValid = computed(() => {
    const d = this._draft();
    if (!d.firstName.trim()) return false;
    if (!d.sex) return false;
    if (!d.dateOfBirth && !d.age) return false; // at least one
    return true;
  });

  readonly mobileValid = computed(() => {
    const digits = this.mobileDraft().replace(/\D/g, '');
    return digits.length === 10;
  });

  readonly abhaValid = computed(() => {
    const digits = this.abhaDraft().replace(/\D/g, '');
    return digits.length === 14;
  });

  readonly pagedHistory = computed(() => this._history().slice(0, this._pageLimit()));
  readonly remainingCount = computed(() => Math.max(0, this._history().length - this._pageLimit()));

  constructor() {
    // Re-fetch whenever the active id changes. effect() runs in the DI
    // context so it auto-cleans on destroy. NOTE: previously also
    // portaled the host into document.body, but that reparent triggered
    // a Web-Animations InvalidStateError at boot which poisoned
    // Angular's microtask scheduler — subscribe callbacks downstream
    // (including booking-modal's loadConfig.next) silently never fired.
    // The modal's position:fixed + z-index already escape stacking
    // contexts the shell creates; portaling was unnecessary.
    effect(() => {
      const id = this.profile.activeId();
      if (id) this.loadProfile(id);
      else this.resetState();
    });
  }

  @HostListener('document:keydown.escape')
  onEsc() {
    if (this._mobilePromptOpen() || this._abhaLinkOpen() || this._abhaCreateOpen() || this._deleteConfirmOpen()) {
      this.cancelMobileChange();
      this.cancelAbhaLink();
      this.cancelAbhaCreate();
      this.cancelDelete();
      return;
    }
    if (this.open()) this.close();
  }

  close() {
    this.profile.close();
  }

  private resetState() {
    this._patient.set(null);
    this._history.set([]);
    this._editMode.set(false);
    this._pageLimit.set(PAGE_SIZE);
    this._mobilePromptOpen.set(false);
    this._abhaLinkOpen.set(false);
    this._abhaCreateOpen.set(false);
    this._deleteConfirmOpen.set(false);
  }

  private loadProfile(id: string) {
    this._loading.set(true);
    this.api.get<ProfileResponse>(`/api/patients/${id}`).subscribe({
      next: res => {
        this._patient.set(res.patient);
        this._history.set(res.history ?? []);
        this._loading.set(false);
        this.seedDraftFromPatient();
      },
      error: () => {
        this._loading.set(false);
        this._patient.set(null);
        this._history.set([]);
      }
    });
  }

  // ── Edit mode ──────────────────────────────────────────────
  private seedDraftFromPatient() {
    const p = this._patient();
    if (!p) return;
    this._draft.set({
      firstName: p.firstName ?? '',
      fathersName: p.fathersName ?? '',
      dateOfBirth: p.dateOfBirth ? p.dateOfBirth.slice(0, 10) : '',
      age: p.age != null ? String(p.age) : '',
      sex: p.sex ?? ''
    });
  }

  enterEdit() { this.seedDraftFromPatient(); this._editMode.set(true); }
  cancelEdit() { this._editMode.set(false); this.seedDraftFromPatient(); }

  setDraftField<K extends keyof DraftPatient>(key: K, value: DraftPatient[K]) {
    this._draft.update(d => ({ ...d, [key]: value }));
  }

  /**
   * Setting DOB auto-calculates age (per spec). Setting age does NOT
   * auto-calculate DOB — DOB is left untouched in that direction.
   */
  setDob(value: string) {
    if (!value) {
      this._draft.update(d => ({ ...d, dateOfBirth: '' }));
      return;
    }
    const dob = new Date(value);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
    this._draft.update(d => ({ ...d, dateOfBirth: value, age: String(Math.max(0, age)) }));
  }
  setAge(value: string) {
    this._draft.update(d => ({ ...d, age: value }));
  }

  saveEdit() {
    const p = this._patient();
    const d = this._draft();
    if (!p || !this.editValid()) return;
    this._saving.set(true);
    const body: Record<string, unknown> = {
      firstName: d.firstName.trim(),
      fathersName: d.fathersName.trim(),
      sex: d.sex || null
    };
    if (d.dateOfBirth) body['dateOfBirth'] = new Date(d.dateOfBirth).toISOString();
    if (d.age) body['age'] = parseInt(d.age, 10);
    this.api.patch<Patient>(`/api/patients/${p.id}`, body).subscribe({
      next: updated => {
        this._patient.set(updated);
        this._editMode.set(false);
        this._saving.set(false);
        this.toasts.success('Patient updated');
      },
      error: () => {
        this._saving.set(false);
        this.toasts.error('Could not save — try again');
      }
    });
  }

  // ── Mobile change ──────────────────────────────────────────
  startMobileChange() {
    const p = this._patient();
    this.mobileDraft.set(p?.phone ?? '');
    this._mobileError.set(null);
    this._mobilePromptOpen.set(true);
  }
  cancelMobileChange() { this._mobilePromptOpen.set(false); }
  saveMobile() {
    const p = this._patient();
    const next = this.mobileDraft().replace(/\D/g, '');
    if (!p || next.length !== 10) {
      this._mobileError.set('Mobile must be 10 digits');
      return;
    }
    this._mobileBusy.set(true);
    this.api.patch<Patient>(`/api/patients/${p.id}`, { phone: next }).subscribe({
      next: updated => {
        this._patient.set(updated);
        this._mobilePromptOpen.set(false);
        this._mobileBusy.set(false);
        this.toasts.success('Mobile updated');
      },
      error: () => {
        this._mobileBusy.set(false);
        this._mobileError.set('Could not update — try again');
      }
    });
  }

  // ── ABHA link / unlink / create ────────────────────────────
  startAbhaLink() {
    this.abhaDraft.set('');
    this._abhaError.set(null);
    this._abhaLinkOpen.set(true);
  }
  cancelAbhaLink() { this._abhaLinkOpen.set(false); }
  saveAbhaLink() {
    const p = this._patient();
    const digits = this.abhaDraft().replace(/\D/g, '');
    if (!p || digits.length !== 14) {
      this._abhaError.set('ABHA must be 14 digits');
      return;
    }
    this._abhaBusy.set(true);
    this.api.patch<Patient>(`/api/patients/${p.id}/abha-link`, { abhaId: digits }).subscribe({
      next: updated => {
        this._patient.set(updated);
        this._abhaLinkOpen.set(false);
        this._abhaBusy.set(false);
        this.toasts.success('ABHA linked');
      },
      error: err => {
        this._abhaBusy.set(false);
        const msg = (err as { error?: { message?: string } })?.error?.message;
        this._abhaError.set(msg ?? 'Could not link — check the ABHA number');
      }
    });
  }
  unlinkAbha() {
    const p = this._patient();
    if (!p) return;
    if (!confirm('Unlink this ABHA from the patient?')) return;
    this._abhaBusy.set(true);
    this.api.delete<Patient>(`/api/patients/${p.id}/abha`).subscribe({
      next: updated => {
        this._patient.set(updated);
        this._abhaBusy.set(false);
        this.toasts.success('ABHA unlinked');
      },
      error: () => {
        this._abhaBusy.set(false);
        this.toasts.error('Could not unlink');
      }
    });
  }
  startAbhaCreate() { this._abhaCreateOpen.set(true); }
  cancelAbhaCreate() { this._abhaCreateOpen.set(false); }

  // ── Delete (soft) ──────────────────────────────────────────
  confirmDelete() { this._deleteConfirmOpen.set(true); }
  cancelDelete() { this._deleteConfirmOpen.set(false); }
  doDelete() {
    const p = this._patient();
    if (!p) return;
    this._deleteBusy.set(true);
    this.api.delete<{ id: string }>(`/api/patients/${p.id}`).subscribe({
      next: () => {
        this._deleteBusy.set(false);
        this._deleteConfirmOpen.set(false);
        this.toasts.success('Patient deleted');
        this.close();
      },
      error: () => {
        this._deleteBusy.set(false);
        this.toasts.error('Could not delete');
      }
    });
  }

  // ── Navigation actions ─────────────────────────────────────
  newOrder() {
    const p = this._patient();
    if (!p) return;
    this.router.navigate(['/frontdesk/order'], { queryParams: { patientId: p.id } });
    this.close();
  }
  repeat(h: HistoryRow) {
    const p = this._patient();
    if (!p) return;
    this.router.navigate(['/frontdesk/order'], {
      queryParams: { patientId: p.id, fromOrderId: h.id }
    });
    this.close();
  }
  openInvoice(h: HistoryRow) {
    if (!h.bill) return;
    this.router.navigate(['/frontdesk/post-payment'], {
      queryParams: { orderId: h.id, billId: h.bill.id }
    });
    this.close();
  }
  openReport(h: HistoryRow) {
    this.router.navigate(['/reports/report'], {
      queryParams: { orderId: h.id, reportId: h.report?.id }
    });
    this.close();
  }

  // ── History helpers ────────────────────────────────────────
  loadMore() { this._pageLimit.update(n => n + PAGE_SIZE); }

  formatDate(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /**
   * "CBC" for one test, "CBC + 2 more" for several. Falls back to the test
   * count if no names came down (rare — only on demo data without seeded
   * test rows).
   */
  summariseTests(h: HistoryRow): string {
    const names: string[] = [];
    for (const s of h.samples ?? []) {
      for (const t of s.tests ?? []) {
        if (t.name) names.push(t.name);
      }
    }
    if (names.length === 0) return '—';
    if (names.length === 1) return names[0];
    return `${names[0]} + ${names.length - 1} more`;
  }

  statusLabel(status: string): string {
    return STATUS_LABELS[status]?.label ?? status;
  }
  statusTone(status: string): string {
    return STATUS_LABELS[status]?.tone ?? 'muted';
  }

  canViewReport(h: HistoryRow): boolean {
    if (!h.report) return false;
    // Only validated / final reports are viewable. Drafts hide the link.
    return h.report.status === 'final' || h.report.status === 'amended';
  }
}

interface DraftPatient {
  firstName: string;
  fathersName: string;
  dateOfBirth: string; // yyyy-MM-dd
  age: string;
  sex: string;
}
