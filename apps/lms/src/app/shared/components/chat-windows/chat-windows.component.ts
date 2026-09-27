import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { AuthService } from '../../../core/auth/auth.service';
import { ChatService } from '../../../core/services/chat.service';
import { ChatWindowsService } from '../../../core/services/chat-windows.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { SignalingService } from '../../../core/services/signaling.service';
import { CallReachService } from '../../../core/services/call-reach.service';
import { ToastService } from '../../../core/services/toast.service';
import { WebrtcService } from '../../../core/services/webrtc.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { Conversation } from '../../models/chat.model';
import { ApiError } from '../../models/api-response.model';
import { ApiService } from '../../../core/services/api.service';
import { firstValueFrom } from 'rxjs';
import { SessionScopeService } from '../../../core/auth/session-scope.service';
import {
  Box, CONTROL_SELECTOR, Hit, PRIMARY_SELECTOR, RailPosition, clampLift, parseRailPosition, planRailLift,
} from './chat-rail-placement';

/** Just enough of a patient to list and share one. */
interface PatientLite { id: string; displayName?: string | null; mrn?: string | null; }
import { conversationInitials, conversationTitle } from '../../models/conversation-name';
import { PresenceDotComponent } from '../presence-avatar/presence-avatar.component';

/**
 * Floating chat windows — the Messenger model the owner asked for:
 * conversations open as small windows docked bottom-right above the app
 * bar, side by side up to the viewport's capacity (3 max, iPad ≈ 2), and
 * the overflow parks as circular heads on the right rail. Clicking a
 * head brings that thread back (evicting the least-recently-used one).
 *
 * NEW design only — classic keeps the people drawer untouched. PHONES get
 * no windows at all (capacity 0): there a conversation opens as a full
 * page, WhatsApp-style, which is both the right shape for the screen and
 * where the full composer already lives.
 */
@Component({
  selector: 'pf-chat-windows',
  standalone: true,
  imports: [DatePipe, PresenceDotComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.--pf-cw-lift]': "(railLift() + railAvoid()) + 'px'" },
  template: `
    @if (theme.isNewDesign() && messagesOn()) {
      <div class="pf-cw" [class.pf-cw--railed]="heads().length > 0">
        @for (c of windows(); track c.id) {
          <section class="pf-cw__win" (click)="windowsSvc.focus(c.id)">
            <header class="pf-cw__hdr">
              <span class="pf-cw__init">{{ initials(c) }}<pf-presence-dot [userId]="peerOf(c)?.userId" /></span>
              <span class="pf-cw__name">{{ title(c) }}</span>
              @if (peerOf(c); as peer) {
                <button type="button" class="pf-cw__icon press"
                        [disabled]="webrtc.inCall()"
                        [title]="webrtc.inCall() ? 'Already in a call' : reach.hint(peer.userId)"
                        (click)="call(c); $event.stopPropagation()" aria-label="Voice call">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/>
                  </svg>
                </button>
              }
              <button type="button" class="pf-cw__icon press"
                      [class.is-fav]="windowsSvc.isFavourite(c.id)"
                      (click)="windowsSvc.toggleFavourite(c.id); $event.stopPropagation()"
                      [attr.aria-pressed]="windowsSvc.isFavourite(c.id)"
                      [title]="windowsSvc.isFavourite(c.id) ? 'Remove from favourites' : 'Add to favourites'"
                      aria-label="Favourite">
                <svg width="15" height="15" viewBox="0 0 24 24"
                     [attr.fill]="windowsSvc.isFavourite(c.id) ? 'currentColor' : 'none'"
                     stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
                     stroke-linejoin="round" aria-hidden="true">
                  <path d="m12 17.3-5.6 3 1.1-6.3-4.5-4.4 6.3-.9L12 3l2.7 5.7 6.3.9-4.5 4.4 1.1 6.3z"/>
                </svg>
              </button>
              <button type="button" class="pf-cw__icon press" (click)="windowsSvc.minimize(c.id); $event.stopPropagation()"
                      aria-label="Minimize chat">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" aria-hidden="true">
                  <path d="M5 12h14"/>
                </svg>
              </button>
              <button type="button" class="pf-cw__icon press" (click)="closeWindow(c.id); $event.stopPropagation()"
                      aria-label="Close chat">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18"/>
                </svg>
              </button>
            </header>

            <div class="pf-cw__msgs" [attr.data-conv]="c.id">
              @for (m of chat.messagesFor(c.id); track m.id) {
                <div class="pf-cw__row" [class.pf-cw__row--mine]="m.fromUserId === meId()">
                  <div class="pf-cw__bubble" [class.pf-cw__bubble--mine]="m.fromUserId === meId()"
                       [class.pf-cw__bubble--pending]="m.pending">
                    {{ m.body }}
                    <span class="pf-cw__time">{{ m.sentAt | date:'shortTime' }}</span>
                  </div>
                </div>
              } @empty {
                <p class="pf-cw__empty">No messages yet — say hello.</p>
              }
            </div>

            <!-- Share-a-patient picker (opens from the + menu). Same
                 chat.sharePatient the Messages page calls, so a card shared
                 from a window is the same card there. -->
            @if (patientFor() === c.id) {
              <div class="pf-cw__sheet">
                <input type="text" class="pf-cw__sheet-search" placeholder="Search patients…"
                       [value]="patientQuery()" (input)="onPatientQuery($any($event.target).value)"
                       aria-label="Search patients" />
                <div class="pf-cw__sheet-list">
                  @for (pt of patientResults(); track pt.id) {
                    <button type="button" class="pf-cw__sheet-item press" (click)="sharePatient(c.id, pt)">
                      <span class="pf-cw__sheet-name">{{ pt.displayName || '(unknown)' }}</span>
                      @if (pt.mrn) { <span class="pf-cw__sheet-sub">{{ pt.mrn }}</span> }
                    </button>
                  } @empty {
                    <p class="pf-cw__sheet-empty">{{ patientLoading() ? 'Searching…' : 'No patients found.' }}</p>
                  }
                </div>
              </div>
            }

            <!-- Emoji strip (opens from the + menu). -->
            @if (emojiFor() === c.id) {
              <div class="pf-cw__emoji">
                @for (e of EMOJI; track e) {
                  <button type="button" class="pf-cw__emoji-btn press"
                          (click)="addEmoji(box, e)" [attr.aria-label]="'Insert ' + e">{{ e }}</button>
                }
              </div>
            }

            <div class="pf-cw__composer">
              <input #file type="file" class="pf-cw__file" multiple
                     (change)="onFiles(c.id, file)" />
              <!-- One "+" holding everything the page composer offers
                   (owner): attach a file, share a patient, emoji. The
                   window had only a paperclip, and sharing a patient is
                   the point of most of these conversations. -->
              <div class="pf-cw__plus">
                <button type="button" class="pf-cw__clip press" (click)="toggleMenu(c.id)"
                        [class.is-open]="menuFor() === c.id" [disabled]="uploading()"
                        [attr.aria-expanded]="menuFor() === c.id" aria-label="More" title="More">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2" stroke-linecap="round" aria-hidden="true">
                    <path d="M12 5v14M5 12h14"/>
                  </svg>
                </button>
                @if (menuFor() === c.id) {
                  <div class="pf-cw__plus-bd" (click)="menuFor.set(null)" aria-hidden="true"></div>
                  <div class="pf-cw__plus-pop" role="menu">
                    <button type="button" role="menuitem" class="pf-cw__plus-item press"
                            (click)="menuFor.set(null); file.click()">
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.5 3.5 0 1 1 4.95 4.95l-9.2 9.19a1.5 1.5 0 0 1-2.12-2.12l8.49-8.49"/>
                      </svg>
                      <span>Attach a file</span>
                    </button>
                    <button type="button" role="menuitem" class="pf-cw__plus-item press"
                            (click)="openPatients(c.id)">
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                      </svg>
                      <span>Share a patient</span>
                    </button>
                    <button type="button" role="menuitem" class="pf-cw__plus-item press"
                            (click)="openEmoji(c.id)">
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/>
                        <path d="M9 9h.01M15 9h.01"/>
                      </svg>
                      <span>Emoji</span>
                    </button>
                  </div>
                }
              </div>
              <!-- WhatsApp-style field: the mic lives INSIDE the pill (owner).
                   Tap mic → recording row with timer; tap stop → a preview you
                   can play back or discard. Nothing leaves until Send / Enter. -->
              <div class="pf-cw__field" [class.is-rec]="recordingFor() === c.id"
                   [class.is-draft]="voiceDraft()?.convId === c.id">
                @if (recordingFor() === c.id) {
                  <span class="pf-cw__recdot" aria-hidden="true"></span>
                  <span class="pf-cw__rectime">{{ fmtSecs(recordSecs()) }}</span>
                  <span class="pf-cw__rechint">Recording…</span>
                  <button type="button" class="pf-cw__fieldbtn press" (click)="cancelRecording()"
                          title="Discard" aria-label="Discard recording">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
                    </svg>
                  </button>
                  <button type="button" class="pf-cw__fieldbtn pf-cw__fieldbtn--stop press"
                          (click)="finishRecording(sendBtn)" title="Stop" aria-label="Stop recording">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <rect x="6" y="6" width="12" height="12" rx="2"/>
                    </svg>
                  </button>
                } @else if (voiceDraft()?.convId === c.id) {
                  <button type="button" class="pf-cw__fieldbtn pf-cw__fieldbtn--play press"
                          (click)="togglePlay(aud)" [attr.aria-label]="playing() ? 'Pause' : 'Play'">
                    @if (playing()) {
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>
                      </svg>
                    } @else {
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M7 4.5v15l13-7.5z"/>
                      </svg>
                    }
                  </button>
                  <audio #aud [src]="voiceDraft()!.url" preload="metadata"
                         (timeupdate)="playPos.set(aud.currentTime)"
                         (ended)="playing.set(false); playPos.set(0)"></audio>
                  <span class="pf-cw__track" aria-hidden="true">
                    <span class="pf-cw__track-fill"
                          [style.width.%]="(playPos() / voiceDraft()!.secs) * 100"></span>
                  </span>
                  <span class="pf-cw__rectime">{{ fmtSecs(playing() || playPos() > 0 ? playPos() : voiceDraft()!.secs) }}</span>
                  <button type="button" class="pf-cw__fieldbtn press" (click)="discardDraft()"
                          title="Discard" aria-label="Discard voice note">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
                    </svg>
                  </button>
                }
                <input #box type="text" class="pf-cw__input"
                       [hidden]="recordingFor() === c.id || voiceDraft()?.convId === c.id"
                       [placeholder]="uploading() ? 'Uploading…' : 'Write a message…'"
                       [attr.aria-label]="'Message ' + title(c)"
                       (focus)="windowsSvc.focus(c.id)"
                       (keydown.enter)="send(c.id, box)" />
                @if (recordingFor() !== c.id && voiceDraft()?.convId !== c.id) {
                  <button type="button" class="pf-cw__fieldbtn press"
                          (click)="startRecording(c.id)" [disabled]="!!recordingFor() || uploading()"
                          title="Record a voice message" aria-label="Record a voice message">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <rect x="9" y="2" width="6" height="12" rx="3"/>
                      <path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v4"/>
                    </svg>
                  </button>
                }
              </div>
              <button #sendBtn type="button" class="pf-cw__send press" (click)="send(c.id, box)"
                      [disabled]="recordingFor() === c.id || uploading()" aria-label="Send">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m22 2-7 20-4-9-9-4Z"/>
                </svg>
              </button>
            </div>
          </section>
        }

      </div>

      <!-- Head rail — minimized chats stacked VERTICALLY at the right
           edge (the owner's Facebook reference). NO compose button here:
           new messages start from the navbar's Messages icon only.
           It never sits on the page's own controls: it lifts itself clear
           of whatever is underneath (primary actions first), and it can be
           DRAGGED (up/down, either edge) — remembered per user. -->
      @if (heads().length) {
        <div #rail class="pf-cw__rail" [class.pf-cw__rail--left]="railSide() === 'left'"
             [class.pf-cw__rail--dragging]="dragging()"
             [style.bottom]="railBottom()" (pointerdown)="onRailDown($event)">
          @for (c of heads(); track c.id) {
            <button type="button" class="pf-cw__head press" (click)="openHead(c.id)"
                    [title]="title(c)" [attr.aria-label]="'Open chat with ' + title(c)">
              <span class="pf-cw__init">{{ initials(c) }}<pf-presence-dot [userId]="peerOf(c)?.userId" /></span>
              @if (c.unreadCount > 0) {
                <span class="pf-cw__head-badge">{{ c.unreadCount > 9 ? '9+' : c.unreadCount }}</span>
              }
              @if (windowsSvc.isFavourite(c.id)) {
                <span class="pf-cw__head-fav" aria-hidden="true">
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="m12 17.3-5.6 3 1.1-6.3-4.5-4.4 6.3-.9L12 3l2.7 5.7 6.3.9-4.5 4.4 1.1 6.3z"/>
                  </svg>
                </span>
              }
            </button>
          }
        </div>
      }
    }
  `,
  styles: [`
    /* Dock: bottom-right, above the app bar when it's docked there. */
    .pf-cw {
      position: fixed;
      right: 72px;                 /* clear of the head rail */
      bottom: calc(var(--pf-botbar-h, 0px) + 12px);
      z-index: 48;
      display: flex;
      align-items: flex-end;
      gap: 12px;
      pointer-events: none;
    }
    .pf-cw > * { pointer-events: auto; }
    /* Phones: one full-width sheet docked above the bar — there is no
       Messages screen in this design, so chat has to live here. */
    @media (max-width: 767px) {
      .pf-cw { left: 8px; right: 8px; }
      .pf-cw__win { width: 100%; height: min(70dvh, 460px); }
      .pf-cw__rail { right: 8px; bottom: calc(var(--pf-botbar-h, 0px) + 12px); }
    }

    /* ── Phone (<=640px) ────────────────────────────────────────
       The sheet is full-width here, so a VERTICAL rail hugging the right
       edge would sit on top of the conversation. Lay the heads out as a
       horizontal strip docked to the bar and float the sheet above it. */
    @media (max-width: 640px) {
      /* Shrink-wrapped to its heads (a full-width strip used to swallow
         taps across the whole row, e.g. a phone's full-width CTA). */
      .pf-cw__rail {
        left: auto; right: 8px; max-width: calc(100vw - 16px);
        flex-direction: row; justify-content: flex-end; align-items: center;
        gap: 8px;
        overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch;
      }
      .pf-cw__rail::-webkit-scrollbar { display: none; }
      .pf-cw--railed { bottom: calc(var(--pf-botbar-h, 0px) + 12px + 56px + var(--pf-cw-lift, 0px)); }
      .pf-cw--railed .pf-cw__win { height: min(64dvh, 420px); }
      /* Composer input at 16px or iOS zooms the page when it focuses. */
      .pf-cw__input { font-size: 16px; }
      .pf-cw__field { height: 40px; }
      /* Blur is expensive on phones; the sheet is opaque enough already. */
      .pf-cw__win { backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
    }

    .pf-cw__win {
      width: 330px;
      height: 420px;
      max-height: calc(100dvh - var(--pf-botbar-h, 0px) - 90px);
      display: flex;
      flex-direction: column;
      border-radius: 16px 16px 12px 12px;
      overflow: hidden;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      box-shadow: 0 18px 50px rgba(0, 0, 0, 0.28);
    }

    .pf-cw__hdr {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 8px 8px 10px;
      border-bottom: 1px solid var(--border-muted);
      background: var(--bg-secondary);
    }
    .pf-cw__name {
      flex: 1; min-width: 0;
      font-size: 12.5px; font-weight: 500; color: var(--text-primary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .pf-cw__icon {
      width: 26px; height: 26px; border-radius: 9999px;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent; border: none; cursor: pointer;
      color: var(--text-secondary);
    }
    .pf-cw__icon:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
    .pf-cw__icon:disabled { opacity: 0.4; cursor: not-allowed; }

    /* Neutral avatar — the same anatomy as the Messages screen (nd-kit). */
    .pf-cw__init {
      position: relative;                          /* anchors the presence dot */
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; border-radius: 9999px; flex-shrink: 0;
      background: var(--nd-chip-bg, #f3f4f6); color: var(--text-secondary);
      border: 1px solid var(--nd-line, var(--border-muted));
      font-size: 10.5px; font-weight: 600;
    }

    .pf-cw__msgs {
      flex: 1; min-height: 0;
      overflow-y: auto; overscroll-behavior: contain;
      padding: 10px;
      display: flex; flex-direction: column; gap: 6px;
    }
    .pf-cw__empty { margin: auto; font-size: 12px; color: var(--text-muted); }
    .pf-cw__row { display: flex; }
    .pf-cw__row--mine { justify-content: flex-end; }
    /* Calm bubbles (Messages screen parity): theirs neutral, ours a subtle
       violet tint; times muted in Noto tabular numbers (never monospace). */
    .pf-cw__bubble {
      max-width: 78%;
      padding: 7px 10px;
      border-radius: 14px 14px 14px 5px;
      background: color-mix(in srgb, var(--text-primary) 5%, var(--bg-card-solid, #fff));
      border: 1px solid var(--nd-line, var(--border-muted));
      color: var(--text-primary);
      font-size: 12.5px; line-height: 1.45;
      word-break: break-word;
    }
    .pf-cw__bubble--mine {
      border-radius: 14px 14px 5px 14px;
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 10%, var(--bg-card-solid, #fff));
      border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 22%, transparent);
    }
    :host-context(.dark) .pf-cw__bubble--mine,
    :host-context([data-theme='dark']) .pf-cw__bubble--mine {
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 24%, var(--bg-card-solid, #14141f));
    }
    .pf-cw__bubble--pending { opacity: 0.6; }
    .pf-cw__time {
      display: block; margin-top: 2px;
      font-size: 10px; color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }

    .pf-cw__composer {
      display: flex; align-items: center; gap: 6px;
      padding: 8px;
      border-top: 1px solid var(--border-muted);
    }
    /* The pill is the field; input + mic (or recorder / preview) sit inside. */
    .pf-cw__field {
      flex: 1; min-width: 0; height: 34px;
      display: flex; align-items: center; gap: 6px;
      padding: 0 3px 0 12px; border-radius: 9999px;
      background: var(--bg-input, transparent);
      border: 1px solid var(--input-border, var(--border-muted));
    }
    .pf-cw__field:focus-within { border-color: #7c3aed; }
    .pf-cw__field.is-draft { padding-left: 3px; }
    .pf-cw__input {
      flex: 1; min-width: 0; height: 100%;
      padding: 0; border: 0; background: transparent;
      color: var(--text-primary);
      font-size: 12.5px; font-family: inherit;
      outline: none;
    }
    .pf-cw__input[hidden] { display: none; }
    .pf-cw__fieldbtn {
      width: 28px; height: 28px; border-radius: 9999px; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent; border: 0; color: var(--text-muted);
      cursor: pointer; min-width: 28px !important; min-height: 28px !important;
    }
    .pf-cw__fieldbtn:hover:not(:disabled) { color: #7c3aed; background: rgba(124, 58, 237, 0.1); }
    .pf-cw__fieldbtn:disabled { opacity: 0.4; cursor: default; }
    .pf-cw__fieldbtn--stop { color: #f87171; }
    .pf-cw__fieldbtn--play { background: #7c3aed; color: #fff; }
    .pf-cw__fieldbtn--play:hover:not(:disabled) { background: #6d28d9; color: #fff; }
    .pf-cw__recdot {
      width: 8px; height: 8px; border-radius: 9999px; background: #ef4444; flex-shrink: 0;
      animation: pf-cw-rec 1.1s ease-in-out infinite;
    }
    .pf-cw__rectime {
      font-size: 12px; font-variant-numeric: tabular-nums; color: var(--text-primary);
      flex-shrink: 0;
    }
    .pf-cw__rechint { flex: 1; min-width: 0; font-size: 12px; color: var(--text-muted); }
    .pf-cw__track {
      flex: 1; min-width: 0; height: 3px; border-radius: 9999px;
      background: var(--border-muted); overflow: hidden;
    }
    .pf-cw__track-fill { display: block; height: 100%; background: #7c3aed; transition: width .2s linear; }
    .pf-cw__send:disabled { opacity: 0.4; cursor: default; }
    .pf-cw__file { display: none; }
    .pf-cw__icon.is-fav { color: var(--violet-text, #7c3aed); }
    @keyframes pf-cw-rec { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
    @media (prefers-reduced-motion: reduce) { .pf-cw__recdot { animation: none; } }
    .pf-cw__head-fav {
      position: absolute; bottom: -1px; right: -1px;
      width: 14px; height: 14px; border-radius: 9999px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--bg-card-solid, #14141f); color: var(--violet-text, #7c3aed);
    }

    /* "+" menu — opens UPWARD; the composer sits at the window's floor. */
    .pf-cw__plus { position: relative; display: inline-flex; flex-shrink: 0; }
    .pf-cw__plus-bd { position: fixed; inset: 0; z-index: 49; }
    .pf-cw__plus-pop {
      position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 50;
      min-width: 186px; padding: 6px;
      display: flex; flex-direction: column;
      border-radius: 14px;
      background: var(--bg-card-solid, rgba(20, 22, 30, 0.98));
      border: 1px solid var(--glass-border);
      box-shadow: 0 18px 44px rgba(0, 0, 0, 0.45);
    }
    .pf-cw__plus-item {
      display: flex; align-items: center; gap: 10px;
      padding: 9px 10px; min-height: 40px;
      border: none; background: transparent; border-radius: 9px;
      color: var(--text-secondary); font-size: 13px; font-family: inherit;
      cursor: pointer; text-align: left;
    }
    .pf-cw__plus-item:hover { background: var(--bg-hover); color: var(--text-primary); }
    .pf-cw__clip.is-open { color: var(--violet-text, #a78bfa); }

    /* Patient picker + emoji strip sit ABOVE the composer, inside the
       window, so the thread stays visible behind them. */
    .pf-cw__sheet {
      flex-shrink: 0; border-top: 1px solid var(--glass-border);
      padding: 8px; display: flex; flex-direction: column; gap: 6px;
      max-height: 190px;
    }
    .pf-cw__sheet-search {
      height: 32px; padding: 0 10px; border-radius: 8px;
      border: 1px solid var(--glass-border); background: var(--glass-bg);
      color: var(--text-primary); font-size: 12.5px; font-family: inherit; outline: none;
    }
    .pf-cw__sheet-search:focus { border-color: #7c3aed; }
    .pf-cw__sheet-list { overflow-y: auto; display: flex; flex-direction: column; }
    .pf-cw__sheet-item {
      display: flex; align-items: baseline; gap: 8px;
      padding: 8px 8px; min-height: 38px;
      border: none; background: transparent; border-radius: 8px;
      color: var(--text-primary); font-size: 12.5px; font-family: inherit;
      cursor: pointer; text-align: left;
    }
    .pf-cw__sheet-item:hover { background: var(--bg-hover); }
    .pf-cw__sheet-sub {
      font-size: 11px; color: var(--text-tertiary);
      font-variant-numeric: tabular-nums;
    }
    .pf-cw__sheet-empty { margin: 6px 4px; font-size: 12px; color: var(--text-tertiary); }

    .pf-cw__emoji {
      flex-shrink: 0; border-top: 1px solid var(--glass-border);
      padding: 6px; display: grid; grid-template-columns: repeat(8, 1fr); gap: 2px;
    }
    .pf-cw__emoji-btn {
      height: 30px; border: none; background: transparent; border-radius: 7px;
      font-size: 16px; line-height: 1; cursor: pointer;
    }
    .pf-cw__emoji-btn:hover { background: var(--bg-hover); }
    .pf-cw__clip {
      width: 32px; height: 32px; border-radius: 9999px; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
      border: none; background: transparent; color: var(--text-tertiary); cursor: pointer;
    }
    .pf-cw__clip:hover:not(:disabled) { background: rgba(124, 58, 237, 0.1); color: var(--text-primary); }
    .pf-cw__clip:disabled { opacity: 0.5; cursor: progress; }
    /* Send = the window's ONE primary (the kit's violet gradient). */
    .pf-cw__send {
      width: 32px; height: 32px; border-radius: 10px; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--gradient-primary, linear-gradient(90deg, #7c3aed, #c026d3));
      border: 0; color: #fff;
      cursor: pointer;
    }
    .pf-cw__send:hover:not(:disabled) { filter: brightness(1.05); }

    /* Minimized heads rail — a fixed vertical column hugging the right
       edge; heads stack upward, compose sits at the bottom. */
    .pf-cw__rail {
      position: fixed;
      right: 14px;
      bottom: calc(var(--pf-botbar-h, 0px) + 12px);
      z-index: 48;
      display: flex;
      flex-direction: column;
      gap: 10px;
      /* Only the heads take taps — the gaps between them never block the page. */
      pointer-events: none;
      transition: bottom 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .pf-cw__rail > * { pointer-events: auto; }
    .pf-cw__rail--left { right: auto; left: 14px; }
    .pf-cw__rail--dragging { transition: none; }
    .pf-cw__rail--dragging .pf-cw__head { cursor: grabbing; }
    @media (max-width: 640px) {
      .pf-cw__rail--left { left: 8px; right: auto; justify-content: flex-start; }
    }
    @media (prefers-reduced-motion: reduce) { .pf-cw__rail { transition: none; } }
    .pf-cw__head {
      position: relative;
      width: 44px; height: 44px; border-radius: 9999px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
      cursor: pointer;
      touch-action: none;          /* a head is also the drag handle */
    }
    @media (max-width: 640px) { .pf-cw__head { touch-action: pan-x; } }
    .pf-cw__head .pf-cw__init { width: 34px; height: 34px; font-size: 12px; }
    /* Unread: a neutral chip with a small violet dot, never a loud badge. */
    .pf-cw__head-badge {
      position: absolute; top: -3px; right: -4px;
      display: inline-flex; align-items: center; gap: 3px;
      min-width: 17px; height: 17px; padding: 0 5px 0 4px;
      border-radius: 9999px;
      background: var(--bg-card-solid, #fff); color: var(--text-primary);
      border: 1px solid var(--nd-line, var(--border-muted));
      font-size: 10px; font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums;
    }
    .pf-cw__head-badge::before {
      content: ''; width: 5px; height: 5px; border-radius: 9999px;
      background: var(--color-violet-600, #7c3aed);
    }
  `]
})
export class ChatWindowsComponent {
  protected readonly theme = inject(ThemeService);
  protected readonly chat = inject(ChatService);
  protected readonly windowsSvc = inject(ChatWindowsService);
  private readonly auth = inject(AuthService);
  private readonly process = inject(ProcessWorkflowService);
  private readonly entitlements = inject(TenantEntitlementsService);
  protected readonly webrtc = inject(WebrtcService);
  private readonly signaling = inject(SignalingService);
  protected readonly reach = inject(CallReachService);
  private readonly toasts = inject(ToastService);
  private readonly api = inject(ApiService);

  /** Chat only exists when the workflow says Messages is part of this
   *  tenant's process — same rule the bar's Messages icon uses. */
  protected readonly messagesOn = computed(() =>
    this.entitlements.moduleEnabled('messages') && this.process.isEnabled('messages'));
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  protected readonly meId = computed(() =>
    this.auth.user()?.authId ?? this.auth.user()?.id ?? '');

  /** Open windows resolved against the live conversation list. */
  protected readonly windows = computed(() => this.resolve(this.windowsSvc.open()));
  /** Minimized heads, same resolution. */
  /** The rail = minimised chats PLUS favourites that aren't open right now
   *  (owner: a favourite stays on the rail even after you close it). A
   *  favourite you just closed is still one tap away; ordering keeps the
   *  minimised ones first since those are the live conversations. */
  protected readonly heads = computed(() => {
    const open = new Set(this.windowsSvc.open());
    const mini = this.windowsSvc.minimized();
    const favs = this.windowsSvc.favourites()
      .filter((id) => !open.has(id) && !mini.includes(id));
    return this.resolve([...mini, ...favs]);
  });

  // ── Rail placement: auto-clear + drag, remembered per user ────────────
  private readonly scope = inject(SessionScopeService);
  private readonly router = inject(Router, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  private readonly railRef = viewChild<ElementRef<HTMLElement>>('rail');
  /** Which edge the rail hugs (user's choice, by drag). */
  protected readonly railSide = signal<'left' | 'right'>('right');
  /** User's drag offset above the dock (px). */
  protected readonly railLift = signal(0);
  /** Automatic lift that clears the controls underneath (px). */
  protected readonly railAvoid = signal(0);
  protected readonly dragging = signal(false);
  protected readonly railBottom = computed(() =>
    `calc(var(--pf-botbar-h, 0px) + 12px + ${this.railLift() + this.railAvoid()}px)`);
  private drag: { x0: number; y0: number; lift0: number; moved: boolean } | null = null;
  private suppressClick = false;
  private measureTimer: ReturnType<typeof setTimeout> | null = null;
  private observer: MutationObserver | null = null;
  private settleTimer: ReturnType<typeof setInterval> | null = null;
  /** Top chrome the rail must never slide under (navbar + band air). */
  private static readonly TOP_CLEARANCE = 72;

  private railKey(): string { return this.scope.storageKey('pf.chatRail'); }

  constructor() {
    // Per-user rail position: re-read whenever the signed-in account changes.
    effect(() => {
      this.scope.identity();
      untracked(() => {
        let raw: string | null = null;
        try { raw = localStorage.getItem(this.railKey()); } catch { /* private mode */ }
        const pos = parseRailPosition(raw);
        this.railSide.set(pos.side);
        this.railLift.set(pos.lift);
        this.railAvoid.set(0);
        this.scheduleMeasure();
      });
    });
    // Watch the page only while there is a rail to place.
    effect(() => {
      const el = this.railRef()?.nativeElement;
      untracked(() => (el ? this.watchPage() : this.unwatchPage()));
    });
    if (typeof window !== 'undefined') {
      const onLayout = () => this.scheduleMeasure();
      window.addEventListener('resize', onLayout);
      document.addEventListener('scroll', onLayout, { capture: true, passive: true });
      const nav = this.router?.events.subscribe(e => { if (e instanceof NavigationEnd) this.scheduleMeasure(400); });
      this.destroyRef.onDestroy(() => {
        window.removeEventListener('resize', onLayout);
        document.removeEventListener('scroll', onLayout, { capture: true });
        nav?.unsubscribe();
        this.unwatchPage();
        this.endDrag();
        if (this.measureTimer) clearTimeout(this.measureTimer);
      });
    }

    // Keep every open thread pinned to its newest message.
    effect(() => {
      this.chat.threads();                    // re-run on any thread change
      queueMicrotask(() => {
        const panes = this.host.nativeElement.querySelectorAll<HTMLElement>('.pf-cw__msgs');
        panes.forEach(p => { p.scrollTop = p.scrollHeight; });
      });
    });
  }

  protected title(c: Conversation): string { return conversationTitle(c, this.meId()); }

  /** The other participant of a 1:1 thread — groups have no call target. */
  protected peerOf(c: Conversation): { userId: string; displayName: string } | null {
    if (c.isGroup) return null;
    const me = this.meId();
    return c.participants?.find(p => p.userId !== me) ?? null;
  }

  protected isOnline(peer: { userId: string }): boolean {
    return this.signaling.onlineUserIds().has(peer.userId);
  }

  /** Voice call the thread's peer — same path the people drawer uses, so
   *  the existing global call overlay takes over from here. */
  protected async call(c: Conversation): Promise<void> {
    const peer = this.peerOf(c);
    if (!peer) return;
    // Presence never blocks a call — offline peers ring by push.
    try {
      await this.webrtc.startCall(peer.userId, 'admin_internal', peer.displayName);
      this.toasts.info(`Ringing ${peer.displayName}…`);
    } catch (err) {
      this.toasts.error((err as Error).message ?? 'Could not start call.');
    }
  }
  protected initials(c: Conversation): string { return conversationInitials(c, this.meId()); }

  /** Common set for the quick strip — a full picker belongs on the page,
   *  not in a 330px window. */
  protected readonly EMOJI = ['👍','🙏','✅','❌','⚠️','🙂','😀','😅','🎉','🔥','💯','👀',
                             '🩸','🧪','🔬','📄','⏱️','❗','❓','👌','🤝','💊','🚑','📌'];

  /** Which window has its "+" menu / patient picker / emoji strip open.
   *  One at a time, and opening one closes the others. */
  protected readonly menuFor = signal<string | null>(null);
  protected readonly emojiFor = signal<string | null>(null);
  protected readonly patientFor = signal<string | null>(null);
  protected readonly patientQuery = signal('');
  protected readonly patientResults = signal<PatientLite[]>([]);
  protected readonly patientLoading = signal(false);
  private patientDebounce: ReturnType<typeof setTimeout> | null = null;

  protected toggleMenu(id: string): void {
    this.menuFor.update((cur) => (cur === id ? null : id));
    this.emojiFor.set(null);
    this.patientFor.set(null);
  }

  protected openEmoji(id: string): void {
    this.menuFor.set(null);
    this.patientFor.set(null);
    this.emojiFor.update((cur) => (cur === id ? null : id));
  }

  protected addEmoji(box: HTMLInputElement, e: string): void {
    box.value = (box.value ?? '') + e;
    box.focus();
  }

  protected openPatients(id: string): void {
    this.menuFor.set(null);
    this.emojiFor.set(null);
    this.patientFor.set(id);
    this.patientQuery.set('');
    void this.searchPatients('');
  }

  protected onPatientQuery(q: string): void {
    this.patientQuery.set(q);
    if (this.patientDebounce) clearTimeout(this.patientDebounce);
    this.patientDebounce = setTimeout(() => void this.searchPatients(q), 220);
  }

  private async searchPatients(q: string): Promise<void> {
    this.patientLoading.set(true);
    try {
      const t = q.trim();
      const path = t ? `/api/patients?q=${encodeURIComponent(t)}&limit=12` : '/api/patients?limit=12';
      this.patientResults.set((await firstValueFrom(this.api.get<PatientLite[]>(path))) ?? []);
    } catch {
      this.patientResults.set([]);
    } finally {
      this.patientLoading.set(false);
    }
  }

  /** Same call the Messages page makes, so a card shared from a window is
   *  indistinguishable from one shared there. */
  protected async sharePatient(conversationId: string, p: PatientLite): Promise<void> {
    try {
      await this.chat.sharePatient(conversationId, p.id);
      this.patientFor.set(null);
      this.windowsSvc.focus(conversationId);
    } catch (err) {
      this.toasts.error(ApiError.from(err).message);
    }
  }

  // ── Voice messages ────────────────────────────────────────────────
  /** Which window is recording (null = none). Only one at a time. */
  protected readonly recordingFor = signal<string | null>(null);
  protected readonly recordSecs = signal(0);
  /** A stopped recording waiting for Send — previewable, discardable. */
  protected readonly voiceDraft = signal<{ convId: string; file: File; url: string; secs: number } | null>(null);
  protected readonly playing = signal(false);
  protected readonly playPos = signal(0);
  private mediaRecorder: MediaRecorder | null = null;
  private recordStream: MediaStream | null = null;
  private recordChunks: Blob[] = [];
  private recordTimer: ReturnType<typeof setInterval> | null = null;
  private recordStartedAt = 0;
  private keepRecording = false;

  protected fmtSecs(v: number): string {
    const t = Math.max(0, Math.floor(v));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }

  /**
   * WhatsApp contract (owner): tap the mic inside the field to start, tap
   * stop to get a preview, then Send / Enter. Nothing is sent on stop.
   * 60-second hard cap stops into the preview, never auto-sends.
   */
  protected async startRecording(conversationId: string): Promise<void> {
    if (this.recordingFor()) return;
    if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') {
      this.toasts.error("Voice messages aren't supported on this browser.");
      return;
    }
    this.discardDraft();
    try {
      this.recordStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
      this.mediaRecorder = mime
        ? new MediaRecorder(this.recordStream, { mimeType: mime })
        : new MediaRecorder(this.recordStream);
      this.recordChunks = [];
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this.recordChunks.push(e.data);
      };
      this.mediaRecorder.onstop = () => this.makeDraft(conversationId);
      this.mediaRecorder.start();
      this.recordStartedAt = Date.now();
      this.recordSecs.set(0);
      this.recordingFor.set(conversationId);
      this.recordTimer = setInterval(() => {
        const elapsed = Date.now() - this.recordStartedAt;
        this.recordSecs.set(Math.floor(elapsed / 1000));
        if (elapsed >= 60000) this.stopRecording(true);   // hard cap → preview
      }, 200);
    } catch {
      this.toasts.error('Microphone permission denied.');
    }
  }

  /** Stop into the preview and hand focus to Send so Enter sends it. */
  protected finishRecording(sendBtn: HTMLButtonElement): void {
    this.stopRecording(true);
    setTimeout(() => sendBtn.focus(), 60);
  }

  protected cancelRecording(): void { this.stopRecording(false); }

  private stopRecording(keep: boolean): void {
    if (!this.recordingFor()) return;
    this.keepRecording = keep;
    this.recordingFor.set(null);
    if (this.recordTimer) { clearInterval(this.recordTimer); this.recordTimer = null; }
    try { this.mediaRecorder?.stop(); } catch { /* already stopped */ }
    this.recordStream?.getTracks().forEach((t) => t.stop());
    this.recordStream = null;
  }

  private makeDraft(conversationId: string): void {
    const chunks = this.recordChunks;
    this.recordChunks = [];
    if (!this.keepRecording || chunks.length === 0) return;
    const secs = Math.max(1, Math.round((Date.now() - this.recordStartedAt) / 1000));
    const mime = this.mediaRecorder?.mimeType?.split(';')[0] ?? 'audio/webm';
    const ext = mime === 'audio/mp4' ? 'm4a' : 'webm';
    const file = new File([new Blob(chunks, { type: mime })], `voice-${secs}s.${ext}`, { type: mime });
    this.playing.set(false);
    this.playPos.set(0);
    this.voiceDraft.set({ convId: conversationId, file, url: URL.createObjectURL(file), secs });
  }

  protected togglePlay(aud: HTMLAudioElement): void {
    if (aud.paused) { void aud.play(); this.playing.set(true); }
    else { aud.pause(); this.playing.set(false); }
  }

  protected discardDraft(): void {
    const d = this.voiceDraft();
    if (d) URL.revokeObjectURL(d.url);
    this.voiceDraft.set(null);
    this.playing.set(false);
    this.playPos.set(0);
  }

  private async sendDraft(): Promise<void> {
    const d = this.voiceDraft();
    if (!d) return;
    this.discardDraft();
    this.uploading.set(true);
    try {
      const up = await this.chat.uploadAttachment(d.file);
      await this.chat.sendMessage(d.convId, '', null, up);
      this.windowsSvc.focus(d.convId);
    } catch (err) {
      this.toasts.error(ApiError.from(err).message);
    } finally {
      this.uploading.set(false);
    }
  }

  /** True while an attachment is on its way up — the composer says so and
   *  the clip is disabled so a second pick can't race the first. */
  protected readonly uploading = signal(false);

  /**
   * Attach files from the docked window. One file goes with whatever is
   * already typed as its caption; several are sent one per message, in
   * order, which is what the Messages page does — there is no multi-
   * attachment column to put them in.
   */
  protected async onFiles(conversationId: string, input: HTMLInputElement): Promise<void> {
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) return;
    const tooBig = files.find((f) => f.size > 15 * 1024 * 1024);
    if (tooBig) { this.toasts.error(`${tooBig.name} is larger than 15 MB.`); return; }

    this.uploading.set(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const up = await this.chat.uploadAttachment(files[i]);
        await this.chat.sendMessage(conversationId, '', null, up);
      }
      this.windowsSvc.focus(conversationId);
    } catch (err) {
      this.toasts.error(ApiError.from(err).message);
    } finally {
      this.uploading.set(false);
    }
  }

  protected send(conversationId: string, box: HTMLInputElement): void {
    if (this.voiceDraft()?.convId === conversationId) { void this.sendDraft(); return; }
    const body = box.value.trim();
    if (!body) return;
    box.value = '';
    this.windowsSvc.focus(conversationId);
    void this.chat.sendMessage(conversationId, body);
  }

  protected closeWindow(conversationId: string): void {
    if (this.recordingFor() === conversationId) this.stopRecording(false);
    if (this.voiceDraft()?.convId === conversationId) this.discardDraft();
    this.windowsSvc.close(conversationId);
    this.chat.forgetThread(conversationId);
  }

  // ── Rail: open / drag / auto-clear ─────────────────────────────────────

  /** Tap a head → its window; a tap that ended a drag is not a tap. */
  protected openHead(id: string): void {
    if (this.suppressClick) { this.suppressClick = false; return; }
    this.windowsSvc.openWindow(id);
  }

  /** Room above the dock: the rail may rise until its top meets the chrome. */
  private maxLift(): number {
    const rail = this.railRef()?.nativeElement;
    if (!rail || typeof window === 'undefined') return 0;
    const r = rail.getBoundingClientRect();
    const now = this.railLift() + this.railAvoid();
    const topAtZero = r.top + now;
    return Math.max(0, topAtZero - ChatWindowsComponent.TOP_CLEARANCE);
  }

  protected onRailDown(e: PointerEvent): void {
    if (e.button !== 0 || typeof window === 'undefined') return;
    this.drag = { x0: e.clientX, y0: e.clientY, lift0: this.railLift() + this.railAvoid(), moved: false };
    window.addEventListener('pointermove', this.onDragMove);
    window.addEventListener('pointerup', this.onDragEnd);
    window.addEventListener('pointercancel', this.onDragEnd);
  }

  private readonly onDragMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.x0;
    const dy = d.y0 - e.clientY;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    if (!d.moved) { d.moved = true; this.dragging.set(true); }
    e.preventDefault();
    const max = this.maxLift();
    this.railAvoid.set(0);
    this.railLift.set(clampLift(d.lift0 + dy, max));
  };

  private readonly onDragEnd = (e: PointerEvent): void => {
    const d = this.drag;
    this.endDrag();
    if (!d?.moved) return;
    // The click that follows this pointerup must not open the chat.
    this.suppressClick = true;
    setTimeout(() => { this.suppressClick = false; }, 0);
    const side: RailPosition['side'] =
      typeof window !== 'undefined' && e.clientX < window.innerWidth / 2 ? 'left' : 'right';
    this.railSide.set(side);
    this.saveRail();
    this.scheduleMeasure(0);
  };

  private endDrag(): void {
    this.drag = null;
    this.dragging.set(false);
    if (typeof window === 'undefined') return;
    window.removeEventListener('pointermove', this.onDragMove);
    window.removeEventListener('pointerup', this.onDragEnd);
    window.removeEventListener('pointercancel', this.onDragEnd);
  }

  private saveRail(): void {
    const pos: RailPosition = { side: this.railSide(), lift: this.railLift() };
    try { localStorage.setItem(this.railKey(), JSON.stringify(pos)); } catch { /* private mode */ }
  }

  private scheduleMeasure(delay = 150): void {
    if (this.measureTimer) clearTimeout(this.measureTimer);
    this.measureTimer = setTimeout(() => { this.measureTimer = null; this.measure(); }, delay);
  }

  /** Lift the rail clear of the control underneath it (primary actions are
   *  never covered; any control is avoided when there is room). */
  measure(): void {
    const rail = this.railRef()?.nativeElement;
    if (!rail || this.drag || typeof document === 'undefined' || !document.elementsFromPoint) return;
    const avoid = this.railAvoid();
    const heads: Box[] = Array.from(rail.querySelectorAll<HTMLElement>('.pf-cw__head')).map(h => {
      const r = h.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top + avoid, bottom: r.bottom + avoid };
    }).filter(b => b.right > b.left && b.bottom > b.top);
    if (!heads.length) return;
    const topAtZero = Math.min(...heads.map(h => h.top));
    const max = Math.max(0, topAtZero - ChatWindowsComponent.TOP_CLEARANCE);
    // Primary actions by GEOMETRY too: one behind a transient overlay (a
    // search dropdown's backdrop) is still the page's CTA — the rail must
    // not be sitting on it the moment the overlay closes.
    const host = this.host.nativeElement;
    const primaries: Box[] = Array.from(document.querySelectorAll<HTMLElement>(PRIMARY_SELECTOR))
      .filter(el => !host.contains(el))
      .map(el => this.primaryZone(el))
      .filter(r => r.width > 0 && r.height > 0)
      .map(r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }));
    const next = planRailLift(heads, (x, y) => this.hitAt(x, y), max, 8, primaries);
    if (next !== avoid) this.railAvoid.set(next);
  }

  /** A primary's keep-out zone: the whole sticky / fixed action bar (or
   *  footer) it lives in — its total, its secondary button — not just the
   *  button; a bar taller than 40% of the screen is a layout, not a bar. */
  private primaryZone(el: HTMLElement): DOMRect {
    const own = el.getBoundingClientRect();
    if (own.width === 0 || own.height === 0 || typeof getComputedStyle === 'undefined') return own;
    let node: HTMLElement | null = el.parentElement;
    for (let i = 0; node && i < 6 && node !== document.body; i++, node = node.parentElement) {
      const pos = getComputedStyle(node).position;
      if (node.tagName === 'FOOTER' || pos === 'sticky' || pos === 'fixed') {
        const r = node.getBoundingClientRect();
        return r.height > 0 && r.height <= window.innerHeight * 0.4 ? r : own;
      }
    }
    return own;
  }

  /** What the page shows at (x, y) under the rail — its own heads skipped. */
  private hitAt(x: number, y: number): Hit {
    if (typeof window !== 'undefined' && (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight)) return null;
    const host = this.host.nativeElement;
    const top = document.elementsFromPoint(x, y).find(el => !host.contains(el));
    if (!top) return null;
    const ctl = top.closest(CONTROL_SELECTOR);
    if (!ctl || host.contains(ctl)) return null;
    return ctl.closest(PRIMARY_SELECTOR) ? 'primary' : 'control';
  }

  private watchPage(): void {
    if (this.observer || typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
    this.observer = new MutationObserver(() => this.scheduleMeasure(200));
    this.observer.observe(document.body, { childList: true, subtree: true });
    // Bars that slide / fade in change no DOM — a slow re-check settles them.
    this.settleTimer = setInterval(() => {
      if (document.visibilityState !== 'hidden') this.measure();
    }, 1500);
    this.scheduleMeasure(0);
  }

  private unwatchPage(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.settleTimer) { clearInterval(this.settleTimer); this.settleTimer = null; }
  }

  private resolve(ids: readonly string[]): Conversation[] {
    const byId = new Map(this.chat.conversations().map(c => [c.id, c] as const));
    return ids.map(id => byId.get(id)).filter((c): c is Conversation => !!c);
  }
}
