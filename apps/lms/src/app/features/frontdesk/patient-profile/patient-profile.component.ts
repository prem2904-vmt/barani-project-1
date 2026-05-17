import { DatePipe, Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { ChatService } from '../../../core/services/chat.service';
import { ToastService } from '../../../core/services/toast.service';
import { AuthService } from '../../../core/auth/auth.service';
import { Order, OrderTest } from '../../../shared/models/order.model';
import { Patient, patientDisplayName } from '../../../shared/models/patient.model';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ChipComponent, ChipTone } from '../../../shared/primitives/chip.component';
import { SkeletonComponent } from '../../../shared/primitives/skeleton.component';

interface DirectoryUser { id: string; displayName: string; email: string; isActive: boolean; }

interface ProfilePayload {
  patient: Patient;
  history: Order[];
}

@Component({
  selector: 'pf-patient-profile',
  standalone: true,
  imports: [DatePipe, CurrencyInrPipe, AvatarComponent, ChipComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host {
      display: block;
      height: 100%;
      overflow-y: auto;
      overflow-x: hidden;
    }

    .pf-pp {
      padding: 16px;
    }

    @media (min-width: 768px) {
      .pf-pp { padding: 24px 32px; }
    }

    /* ── Back ────────────────────────────────────────────── */
    .pf-pp__back {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 0;
      margin-bottom: 16px;
      color: var(--text-secondary);
      font-size: 13px;
      font-weight: 600;
      background: none;
      border: none;
      cursor: pointer;
    }
    .pf-pp__back:hover { color: var(--text-primary); }

    /* ── Hero card ───────────────────────────────────────── */
    .pf-pp__hero {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 20px;
      border-radius: 18px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      margin-bottom: 24px;
    }

    @media (min-width: 768px) {
      .pf-pp__hero {
        flex-direction: row;
        align-items: flex-start;
        gap: 20px;
      }
    }

    /* Avatar + info group (left side) */
    .pf-pp__hero-left {
      display: flex;
      flex-direction: column;
      gap: 10px;
      flex: 1;
      min-width: 0;
    }

    @media (min-width: 768px) {
      .pf-pp__hero-left {
        flex-direction: row;
        align-items: flex-start;
        gap: 16px;
      }
    }

    .pf-pp__info { flex: 1; min-width: 0; }

    .pf-pp__name {
      margin: 0 0 8px;
      font-size: 24px;
      font-weight: 700;
      color: var(--text-primary);
      line-height: 1.15;
    }

    /* MRN + demographics row */
    .pf-pp__ids {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0 0 10px;
      font-size: 13px;
      color: var(--text-secondary);
    }

    .pf-pp__mrn {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 11.5px;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 8px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
    }

    /* Contact icons row */
    .pf-pp__contacts {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    @media (min-width: 768px) {
      .pf-pp__contacts {
        flex-direction: row;
        flex-wrap: wrap;
        gap: 20px;
      }
    }

    .pf-pp__contact {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: var(--text-secondary);
    }

    /* ── Action buttons (right side, stacked) ────────────── */
    .pf-pp__hero-actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex-shrink: 0;
    }

    @media (min-width: 768px) {
      .pf-pp__hero-actions {
        align-self: flex-start;
        min-width: 160px;
      }
    }

    .pf-pp__btn-primary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: 42px;
      padding: 0 22px;
      border-radius: 12px;
      background: var(--gradient-primary);
      color: #fff;
      border: none;
      font-size: 13.5px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 6px 18px rgba(124, 58, 237, 0.4);
      white-space: nowrap;
      transition: box-shadow 0.2s, transform 0.1s;
    }
    .pf-pp__btn-primary:hover {
      box-shadow: 0 10px 24px rgba(124, 58, 237, 0.55);
      transform: translateY(-1px);
    }

    .pf-pp__btn-secondary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: 42px;
      padding: 0 22px;
      border-radius: 12px;
      background: transparent;
      color: var(--text-primary);
      border: 1px solid var(--glass-border);
      font-size: 13.5px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s;
    }
    .pf-pp__btn-secondary:hover { background: var(--glass-bg-hover); }

    /* ── Send-to-chat colleague picker modal ──────────────── */
    .pf-pp__chat-pick-backdrop {
      position: fixed; inset: 0; z-index: 200;
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(6px);
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
      animation: pf-pp-fade 0.16s ease-out;
    }
    .pf-pp__chat-pick {
      background: var(--surface-elevated);
      border: 1px solid var(--glass-border-hover);
      border-radius: 14px;
      width: 100%; max-width: 440px;
      max-height: min(80vh, 560px);
      display: flex; flex-direction: column;
      box-shadow: var(--glass-shadow-hover);
      color: var(--text-primary);
      overflow: hidden;
      animation: pf-pp-pop 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .pf-pp__chat-pick-hdr {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 12px;
      padding: 14px 18px;
      border-bottom: 1px solid var(--border-muted);
      h3 { font-size: 14px; font-weight: 700; margin: 0; color: var(--text-primary); }
      p { font-size: 11.5px; color: var(--text-tertiary); margin: 2px 0 0; }
    }
    .pf-pp__chat-pick-close {
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      width: 28px; height: 28px;
      border-radius: 7px;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer;
      &:hover { background: var(--glass-bg-hover); color: var(--text-primary); }
    }
    .pf-pp__chat-pick-search {
      padding: 12px 18px;
      border-bottom: 1px solid var(--border-muted);
      input {
        width: 100%;
        padding: 9px 12px;
        border-radius: 9px;
        border: 1px solid var(--input-border);
        background: var(--bg-input);
        color: var(--input-text);
        font-size: 13px;
        outline: none;
        &:focus { border-color: var(--input-border-focus); }
        &::placeholder { color: var(--input-placeholder); }
      }
    }
    .pf-pp__chat-pick-list {
      list-style: none; margin: 0;
      padding: 6px 0 10px;
      overflow-y: auto;
      flex: 1; min-height: 0;
    }
    .pf-pp__chat-pick-row {
      display: flex; align-items: center; gap: 10px;
      width: 100%; padding: 8px 18px;
      background: transparent; border: none;
      color: inherit; text-align: left;
      cursor: pointer;
      transition: background 0.12s;
      &:hover:not(:disabled) { background: var(--bg-hover); }
      &:disabled { opacity: 0.55; cursor: progress; }
    }
    .pf-pp__chat-pick-avatar {
      width: 34px; height: 34px;
      border-radius: 50%;
      background: var(--gradient-primary);
      color: #fff;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 700;
      flex-shrink: 0;
      box-shadow: 0 2px 6px rgba(139, 92, 246, 0.3);
    }
    .pf-pp__chat-pick-meta {
      display: flex; flex-direction: column; min-width: 0;
    }
    .pf-pp__chat-pick-name {
      font-size: 13px; font-weight: 600;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .pf-pp__chat-pick-email {
      font-size: 11px; color: var(--text-tertiary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .pf-pp__chat-pick-empty {
      padding: 20px 16px;
      text-align: center;
      font-size: 12.5px;
      color: var(--text-tertiary);
    }
    @keyframes pf-pp-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes pf-pp-pop {
      from { opacity: 0; transform: scale(0.96) translateY(8px); }
      to   { opacity: 1; transform: none; }
    }

    /* ── Visit history ───────────────────────────────────── */
    .pf-pp__hist-hdr {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
    }

    .pf-pp__hist-label {
      font-size: 11px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      font-weight: 700;
      color: var(--text-muted);
    }

    .pf-pp__hist-count {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 11px;
      font-weight: 700;
      color: var(--text-muted);
    }

    .pf-pp__viewall {
      margin-left: auto;
      font-size: 13px;
      font-weight: 600;
      color: #a78bfa;
      background: none;
      border: none;
      cursor: pointer;
      padding: 0;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .pf-pp__viewall:hover { color: #c4b5fd; }

    /* ── Visit card ──────────────────────────────────────── */
    .pf-pp__visit {
      padding: 16px;
      border-radius: 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      margin-bottom: 10px;
    }

    /* Top row: date+time on left, amount+chip on right */
    .pf-pp__visit-top {
      display: flex;
      align-items: baseline;
      gap: 10px;
      margin-bottom: 4px;
    }

    .pf-pp__visit-date {
      flex: 1;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .pf-pp__visit-amount {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 13.5px;
      font-weight: 700;
      color: var(--text-primary);
      flex-shrink: 0;
    }

    .pf-pp__visit-meta {
      font-size: 12px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: var(--text-tertiary);
      margin-bottom: 2px;
    }

    /* ── Tests ───────────────────────────────────────────── */
    .pf-pp__tests {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--border-muted);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .pf-pp__test {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .pf-pp__test-code {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10.5px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 6px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-tertiary);
      flex-shrink: 0;
      min-width: 32px;
      text-align: center;
    }

    .pf-pp__test-name {
      font-size: 13px;
      color: var(--text-secondary);
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ── Empty / loading ─────────────────────────────────── */
    .pf-pp__empty {
      padding: 36px 16px;
      text-align: center;
      font-size: 13px;
      color: var(--text-tertiary);
    }

    .pf-pp__skel-visit {
      padding: 16px;
      border-radius: 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      margin-bottom: 10px;
    }

    .pf-pp__skel-hero {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      padding: 20px;
      border-radius: 18px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      margin-bottom: 24px;
    }
  `],
  template: `
    <section class="pf-pp">

      <!-- Back -->
      <button type="button" class="pf-pp__back press" (click)="back()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m15 18-6-6 6-6"/>
        </svg>
        Back
      </button>

      @if (patient(); as p) {

        <!-- ── Hero ──────────────────────────────────────── -->
        <div class="pf-pp__hero">

          <!-- Left: avatar + info -->
          <div class="pf-pp__hero-left">
            <pf-avatar [name]="displayName()" [size]="72"></pf-avatar>
            <div class="pf-pp__info">
              <h1 class="pf-pp__name">{{ displayName() }}</h1>

              <!-- MRN · demographics row -->
              <div class="pf-pp__ids">
                <span class="pf-pp__mrn">MRN-{{ p.id.slice(-5) }}</span>
                <span>{{ p.sex ?? '—' }}, {{ p.age ?? '—' }}y</span>
                @if (p.dateOfBirth) {
                  <span>· DOB {{ p.dateOfBirth | date:'d MMM y' }}</span>
                }
                @if (p.isMinor) {
                  <span style="color:#fbbf24">· Minor</span>
                }
              </div>

              <!-- Contact icons row -->
              <div class="pf-pp__contacts">
                @if (p.email) {
                  <span class="pf-pp__contact">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <rect x="2" y="4" width="20" height="16" rx="2"/>
                      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                    </svg>
                    {{ p.email }}
                  </span>
                }
                @if (p.phone) {
                  <span class="pf-pp__contact">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M22 16.9v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.17 12a19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 3.08 1.2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 8.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 16.9z"/>
                    </svg>
                    {{ p.phone }}
                  </span>
                }
                <span class="pf-pp__contact">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                  {{ history().length }} visit{{ history().length === 1 ? '' : 's' }}
                  @if (p.createdAt) { since {{ p.createdAt | date:'MMM d' }} }
                </span>
              </div>
            </div>
          </div>

          <!-- Right: action buttons (stacked) -->
          <div class="pf-pp__hero-actions">
            <button type="button" class="pf-pp__btn-primary press" (click)="startOrder(p)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14"/>
              </svg>
              New order
            </button>
            <button type="button" class="pf-pp__btn-secondary press" (click)="bookAppointment(p)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2"/>
                <path d="M16 2v4M8 2v4M3 10h18"/>
              </svg>
              Book
            </button>
            <button type="button" class="pf-pp__btn-secondary press" (click)="openChatPicker()" title="Share this patient in chat">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              Send to chat
            </button>
          </div>
        </div>

        <!-- Colleague-picker modal for "Send to chat". Reuses local
             directory + ChatService.sharePatientWithUser. -->
        @if (chatPickerOpen()) {
          <div class="pf-pp__chat-pick-backdrop" (click)="closeChatPicker()">
            <div class="pf-pp__chat-pick" (click)="$event.stopPropagation()">
              <header class="pf-pp__chat-pick-hdr">
                <div>
                  <h3>Send patient to a colleague</h3>
                  <p>{{ displayName() }} will appear in their chat as a tap-to-open card.</p>
                </div>
                <button type="button" class="pf-pp__chat-pick-close" (click)="closeChatPicker()" aria-label="Close">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </header>
              <div class="pf-pp__chat-pick-search">
                <input type="text" placeholder="Search by name or email"
                       [value]="chatPickerSearch()" (input)="chatPickerSearch.set($any($event.target).value)" autofocus>
              </div>
              <ul class="pf-pp__chat-pick-list">
                @for (u of chatPickerFiltered(); track u.id) {
                  <li>
                    <button type="button" class="pf-pp__chat-pick-row" [disabled]="chatPickerSending()"
                            (click)="sendPatientToColleague(u)">
                      <div class="pf-pp__chat-pick-avatar">
                        {{ (u.displayName.charAt(0) + (u.displayName.split(' ')[1]?.charAt(0) ?? '')).toUpperCase() }}
                      </div>
                      <div class="pf-pp__chat-pick-meta">
                        <span class="pf-pp__chat-pick-name">{{ u.displayName }}</span>
                        <span class="pf-pp__chat-pick-email">{{ u.email }}</span>
                      </div>
                    </button>
                  </li>
                } @empty {
                  <li class="pf-pp__chat-pick-empty">No colleagues match.</li>
                }
              </ul>
            </div>
          </div>
        }

        <!-- ── Visit history ──────────────────────────────── -->
        <div class="pf-pp__hist-hdr">
          <span class="pf-pp__hist-label">Visit History</span>
          <span class="pf-pp__hist-count">· {{ history().length }}</span>
          <button type="button" class="pf-pp__viewall press">
            View all →
          </button>
        </div>

        @if (loading()) {
          @for (i of [0, 1, 2]; track i) {
            <div class="pf-pp__skel-visit">
              <pf-skeleton variant="line" width="45%"></pf-skeleton>
              <div style="margin-top:8px">
                <pf-skeleton variant="line" width="65%" height="10px"></pf-skeleton>
              </div>
            </div>
          }
        } @else if (history().length === 0) {
          <p class="pf-pp__empty">No previous visits on record.</p>
        } @else {
          @for (o of history(); track o.id) {
            <div class="pf-pp__visit">

              <!-- Date + time on left, amount + status on right -->
              <div class="pf-pp__visit-top">
                <span class="pf-pp__visit-date">
                  {{ o.createdAt | date:'MMM d, y' }}
                  <span style="color:var(--text-muted);font-weight:400"> · </span>
                  {{ o.createdAt | date:'HH:mm' }}
                </span>
                @if (o.totalAmount) {
                  <span class="pf-pp__visit-amount">{{ o.totalAmount | inr }}</span>
                }
                <pf-chip [tone]="statusTone(o.status)" size="sm">{{ o.status }}</pf-chip>
              </div>

              <!-- Meta row -->
              <p class="pf-pp__visit-meta">
                {{ o.priority }} · {{ o.collectionType }}
                @if (o.id) { · #{{ o.id.slice(0, 8) }} }
              </p>

              <!-- Tests -->
              @if (orderTests(o).length > 0) {
                <div class="pf-pp__tests">
                  @for (t of orderTests(o); track t.id) {
                    <div class="pf-pp__test">
                      @if (t.test?.code) {
                        <span class="pf-pp__test-code">{{ t.test!.code }}</span>
                      }
                      <span class="pf-pp__test-name">{{ t.test?.name ?? 'Unknown test' }}</span>
                      <pf-chip [tone]="testStatusTone(t.status)" size="sm">{{ t.status }}</pf-chip>
                    </div>
                  }
                </div>
              }
            </div>
          }
        }

      } @else if (loading()) {
        <div class="pf-pp__skel-hero">
          <pf-skeleton variant="circle" width="72px" height="72px"></pf-skeleton>
          <div style="flex:1;display:flex;flex-direction:column;gap:10px">
            <pf-skeleton variant="line" width="30%"></pf-skeleton>
            <pf-skeleton variant="line" width="55%" height="10px"></pf-skeleton>
            <pf-skeleton variant="line" width="70%" height="10px"></pf-skeleton>
          </div>
        </div>
      } @else {
        <p class="pf-pp__empty">Patient not found.</p>
      }

    </section>
  `
})
export class PatientProfileComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly locationSvc = inject(Location);
  private readonly chat = inject(ChatService);
  private readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthService);

  private readonly _patient = signal<Patient | null>(null);
  private readonly _history = signal<Order[]>([]);
  private readonly _loading = signal(false);
  readonly patient = this._patient.asReadonly();
  readonly history = this._history.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly displayName = computed(() => patientDisplayName(this._patient()));

  // Send-to-chat colleague picker state.
  protected readonly chatPickerOpen = signal(false);
  protected readonly chatPickerSearch = signal('');
  protected readonly chatPickerUsers = signal<DirectoryUser[]>([]);
  protected readonly chatPickerSending = signal(false);
  protected readonly chatPickerFiltered = computed(() => {
    const term = this.chatPickerSearch().toLowerCase().trim();
    const me = this.auth.user()?.authId ?? this.auth.user()?.id ?? '';
    const all = this.chatPickerUsers().filter(u => u.id !== me && u.isActive);
    return term
      ? all.filter(u => u.displayName.toLowerCase().includes(term) || u.email.toLowerCase().includes(term))
      : all;
  });

  ngOnInit() {
    this.route.paramMap.subscribe(map => {
      const id = map.get('id');
      if (id) this.load(id);
    });
  }

  statusTone(status: string): ChipTone {
    switch (status) {
      case 'completed':    return 'emerald';
      case 'billed':       return 'amber';
      case 'cancelled':    return 'rose';
      case 'in_progress':  return 'violet';
      default:             return 'default';
    }
  }

  testStatusTone(status: string): ChipTone {
    switch (status) {
      case 'validated':
      case 'completed':
      case 'reported':   return 'emerald';
      case 'rejected':   return 'rose';
      case 'in_progress':
      case 'resulted':   return 'violet';
      case 'pending':    return 'amber';
      default:           return 'default';
    }
  }

  orderTests(o: Order): OrderTest[] {
    const tests: OrderTest[] = [];
    for (const s of o.samples ?? []) {
      for (const t of s.tests ?? []) tests.push(t);
    }
    return tests;
  }

  back() {
    if (window.history.length > 1) this.locationSvc.back();
    else this.router.navigateByUrl('/frontdesk');
  }

  startOrder(p: Patient) {
    this.router.navigate(['/frontdesk/order'], { queryParams: { patientId: p.id } });
  }

  bookAppointment(p: Patient) {
    this.router.navigate(['/frontdesk/appointments/new'], { queryParams: { patientId: p.id } });
  }

  // ── Send-to-chat ──────────────────────────────────────────────────

  async openChatPicker(): Promise<void> {
    this.chatPickerOpen.set(true);
    this.chatPickerSearch.set('');
    if (this.chatPickerUsers().length === 0) {
      try {
        const users = await firstValueFrom(
          this.api.get<DirectoryUser[]>('/api/directory/users'));
        this.chatPickerUsers.set(users ?? []);
      } catch {
        this.toasts.error('Could not load directory.');
      }
    }
  }
  closeChatPicker(): void {
    this.chatPickerOpen.set(false);
    this.chatPickerSending.set(false);
  }

  /**
   * Share this patient into a 1:1 with the chosen colleague. Get-or-creates
   * the conversation, drops the patient card into it, then navigates to
   * /messages so the user sees the thread ready to type into.
   */
  async sendPatientToColleague(u: DirectoryUser): Promise<void> {
    const p = this.patient();
    if (!p) return;
    this.chatPickerSending.set(true);
    try {
      // Anchor the chat to this patient: future messages between us about
      // them stay in this thread instead of cluttering the general 1:1.
      // The context label is what shows in the thread header chip.
      const label = `${this.displayName()}${(p as any).mrn ? ' · ' + (p as any).mrn : ''}`;
      await this.chat.sharePatientWithUser(u.id, p.id, label);
      this.toasts.info(`Sent ${this.displayName()} to ${u.displayName}`);
      this.closeChatPicker();
      this.router.navigate(['/messages']);
    } catch (err) {
      this.toasts.error((err as Error).message ?? 'Could not share patient.');
    } finally {
      this.chatPickerSending.set(false);
    }
  }

  private load(id: string) {
    this._loading.set(true);
    this.api.get<ProfilePayload>(`/api/patients/${id}`).subscribe({
      next: res => {
        this._patient.set(res.patient);
        this._history.set(res.history ?? []);
        this._loading.set(false);
      },
      error: () => this._loading.set(false)
    });
  }
}
