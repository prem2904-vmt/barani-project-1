import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ChatService } from '../../../core/services/chat.service';
import { RingtoneService } from '../../../core/services/ringtone.service';
import { SignalingService } from '../../../core/services/signaling.service';
import { WebrtcService } from '../../../core/services/webrtc.service';
import { ToastService } from '../../../core/services/toast.service';
import { SrcObjectDirective } from '../../directives/src-object.directive';

interface DirectoryUser {
  id: string;          // Supabase sub (== AuthId)
  displayName: string;
  email: string;
  isActive: boolean;
}

/**
 * Global call overlay — mounted once in the shell. Renders two states:
 *
 * - Incoming-call ringer: full-screen card with caller name, Accept / Decline.
 * - Active-call mini-panel: floating bottom-right pill with call duration,
 *   mic mute toggle, and end-call button. Auto-hides when idle.
 *
 * The overlay reads everything from `WebrtcService` signals — no @Input
 * plumbing needed. Audio playback uses a hidden `<audio>` per remote peer.
 */
@Component({
  selector: 'pf-call-overlay',
  standalone: true,
  imports: [SrcObjectDirective, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Hidden audio sinks for each remote peer's stream. The SrcObjectDirective
         (selector "audio[srcObject]") intercepts the [srcObject] binding in
         the directive lifecycle — after the element is in the DOM — and
         calls .play() explicitly. This is the reliable cross-browser path;
         Angular's raw [srcObject] property binding worked on Chrome but
         silently no-op'd on Safari, and the earlier querySelectorAll-based
         effect raced Angular's render and ran before the element existed. -->
    @for (entry of audioEntries(); track entry.userId) {
      <audio [srcObject]="entry.stream" autoplay playsinline></audio>
    }

    @if (webrtc.incomingCall(); as ic) {
      <div class="pf-call-ring pf-modal-centered" role="dialog" aria-modal="true" aria-label="Incoming call">
        <div class="pf-call-ring__backdrop"></div>
        <div class="pf-call-ring__card pf-modal-centered" [class.pf-call-ring__card--group]="ic.isGroup">
          <p class="pf-call-ring__eyebrow">
            @if (ic.isGroup) { Incoming group call }
            @else { Incoming call }
          </p>
          <div class="pf-call-ring__avatar-wrap">
            <span class="pf-call-ring__pulse-ring" aria-hidden="true"></span>
            <span class="pf-call-ring__pulse-ring pf-call-ring__pulse-ring--delay" aria-hidden="true"></span>
            <div class="pf-call-ring__avatar">
              {{ initials(ic.isGroup ? (ic.conversationName ?? 'Group') : ic.callerName) }}
            </div>
          </div>
          <h2 class="pf-call-ring__name">{{ ic.isGroup ? (ic.conversationName ?? 'Group call') : ic.callerName }}</h2>
          @if (ic.isGroup) {
            <p class="pf-call-ring__source">{{ ic.callerName }} is calling</p>
          } @else if (ic.source) {
            <p class="pf-call-ring__source">{{ sourceLabel(ic.source) }}</p>
          } @else {
            <p class="pf-call-ring__source">Voice call</p>
          }
          <div class="pf-call-ring__actions">
            <button type="button" class="pf-call-ring__btn pf-call-ring__btn--reject"
                    (click)="reject()" aria-label="Decline">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.94.36 1.85.68 2.72a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.36-1.36a2 2 0 0 1 2.11-.45c.87.32 1.78.55 2.72.68A2 2 0 0 1 22 16.92z"
                      transform="rotate(135 12 12)"/>
              </svg>
            </button>
            <button type="button" class="pf-call-ring__btn pf-call-ring__btn--accept"
                    (click)="accept()" aria-label="Accept">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.94.36 1.85.68 2.72a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.36-1.36a2 2 0 0 1 2.11-.45c.87.32 1.78.55 2.72.68A2 2 0 0 1 22 16.92z"/>
              </svg>
            </button>
          </div>
          <div class="pf-call-ring__labels">
            <span>Decline</span><span>Accept</span>
          </div>
        </div>
      </div>
    }

    <!-- Full-screen call view (toggleable with the minimise button on the
         pill). Same controls as the pill but with caller avatars + much
         more breathing room. Click the minimise icon to return to the
         floating pill; click End to leave. -->
    @if (showInCallPanel() && callExpanded()) {
      <div class="pf-call-screen pf-modal-centered" role="dialog" aria-modal="true" aria-label="Active call">
        <div class="pf-call-screen__backdrop"></div>
        <div class="pf-call-screen__card pf-modal-centered" [class.pf-call-screen__card--with-chat]="chatPanelOpen()">
          <header class="pf-call-screen__hdr">
            <button type="button" class="pf-call-screen__icon-btn"
                    (click)="minimise()" aria-label="Minimise" title="Minimise">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            <div class="pf-call-screen__hdr-info">
              <span class="pf-call-screen__hdr-status"
                    [class.pf-call-screen__hdr-status--live]="webrtc.status() === 'active'">
                <span class="pf-call-screen__live-dot"></span>
                {{ webrtc.status() === 'active' ? 'On call' : 'Connecting…' }}
              </span>
              <span class="pf-call-screen__hdr-meta">
                <span class="pf-call-screen__time">{{ duration() }}</span>
                <span class="pf-call-screen__route-chip" [attr.data-cost]="routeCost()" [title]="routeTitle()">
                  {{ routeCost() === 'paid' ? 'Relay' : 'Direct' }}
                </span>
                @if (showRemaining()) {
                  <span class="pf-call-screen__remaining" [class.pf-call-screen__remaining--urgent]="remainingUrgent()"
                        title="Call auto-ends at this point">
                    {{ remainingLabel() }}
                  </span>
                }
              </span>
            </div>
            <button type="button" class="pf-call-screen__icon-btn"
                    [class.pf-call-screen__icon-btn--active]="chatPanelOpen()"
                    (click)="toggleChatPanel()" aria-label="In-call chat" title="In-call chat">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </button>
            <button type="button" class="pf-call-screen__icon-btn"
                    (click)="leave()" aria-label="End call" title="End call">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </header>

          <div class="pf-call-screen__participants" [attr.data-count]="participants().length">
            @for (p of participants(); track p.id) {
              <div class="pf-call-screen__pcard"
                   [class.pf-call-screen__pcard--mine]="p.isMe"
                   [class.pf-call-screen__pcard--muted]="p.muted">
                <div class="pf-call-screen__avatar-wrap">
                  <span class="pf-call-screen__avatar-ring" aria-hidden="true"></span>
                  <div class="pf-call-screen__avatar">{{ initials(p.name) }}</div>
                  @if (p.muted) {
                    <span class="pf-call-screen__mute-badge" title="Muted">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="1" y1="1" x2="23" y2="23"/>
                        <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
                        <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
                      </svg>
                    </span>
                  }
                </div>
                <p class="pf-call-screen__pname">{{ p.name }}</p>
                <p class="pf-call-screen__pmeta">
                  @if (p.isMe) { You }
                  @else if (p.muted) { Muted }
                  @else { Connected }
                </p>
              </div>
            }
          </div>

          @if (chatPanelOpen()) {
            <aside class="pf-call-screen__chat" aria-label="In-call chat">
              <header class="pf-call-screen__chat-hdr">
                <span class="pf-call-screen__chat-title">Chat</span>
                <button type="button" class="pf-call-screen__icon-btn pf-call-screen__icon-btn--sm"
                        (click)="toggleChatPanel()" title="Close chat">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </header>
              <div class="pf-call-screen__chat-scroller">
                @if (chat.activeMessages().length === 0) {
                  <p class="pf-call-screen__chat-empty">No messages yet — say something during the call.</p>
                }
                @for (m of chat.activeMessages(); track m.id) {
                  <div class="pf-call-screen__chat-row"
                       [class.pf-call-screen__chat-row--mine]="m.fromUserId === meAuthId()">
                    <div class="pf-call-screen__chat-bubble"
                         [class.pf-call-screen__chat-bubble--mine]="m.fromUserId === meAuthId()">
                      <div class="pf-call-screen__chat-body">{{ m.body }}</div>
                      <div class="pf-call-screen__chat-time">{{ m.sentAt | date:'shortTime' }}</div>
                    </div>
                  </div>
                }
              </div>
              <div class="pf-call-screen__chat-composer">
                <input type="text" placeholder="Type a message" [value]="chatDraft()"
                       (input)="chatDraft.set($any($event.target).value)" (keydown)="onChatKeyDown($event)">
                <button type="button" (click)="sendInCallMessage()" [disabled]="!chatDraft().trim()" title="Send">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                </button>
              </div>
            </aside>
          }

          <footer class="pf-call-screen__ctrls">
            <button type="button" class="pf-call-screen__ctrl"
                    [class.pf-call-screen__ctrl--on]="webrtc.micMuted()"
                    (click)="toggleMute()"
                    [attr.aria-label]="webrtc.micMuted() ? 'Unmute' : 'Mute'">
              <div class="pf-call-screen__ctrl-circle">
                @if (webrtc.micMuted()) {
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="1" y1="1" x2="23" y2="23"/>
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
                    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
                    <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
                  </svg>
                } @else {
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
                  </svg>
                }
              </div>
              <span class="pf-call-screen__ctrl-lbl">{{ webrtc.micMuted() ? 'Unmute' : 'Mute' }}</span>
            </button>
            <button type="button" class="pf-call-screen__ctrl"
                    [class.pf-call-screen__ctrl--active]="invitePopoverOpen()"
                    (click)="toggleInvite()" aria-label="Add participant">
              <div class="pf-call-screen__ctrl-circle">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="8.5" cy="7" r="4"/>
                  <line x1="20" y1="8" x2="20" y2="14"/>
                  <line x1="23" y1="11" x2="17" y2="11"/>
                </svg>
              </div>
              <span class="pf-call-screen__ctrl-lbl">Add</span>
            </button>
            <button type="button" class="pf-call-screen__ctrl pf-call-screen__ctrl--end"
                    (click)="leave()" aria-label="End call">
              <div class="pf-call-screen__ctrl-circle">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"
                          transform="rotate(135 12 12)"/>
                </svg>
              </div>
              <span class="pf-call-screen__ctrl-lbl">End</span>
            </button>
          </footer>

          <!-- Invite popover stays attached to the full-screen Add button too. -->
          @if (invitePopoverOpen()) {
            <div class="pf-call-invite-pop pf-call-invite-pop--screen" role="dialog" aria-label="Invite to call"
                 (click)="$event.stopPropagation()">
              <header class="pf-call-invite-pop__hdr">
                <span class="pf-call-invite-pop__title">Invite to call</span>
                <span class="pf-call-invite-pop__count">{{ availableToInvite().length }} online</span>
              </header>
              @if (loadingInvite()) {
                <p class="pf-call-invite-pop__empty">Loading…</p>
              } @else if (availableToInvite().length === 0) {
                <p class="pf-call-invite-pop__empty">No one else is online right now.</p>
              } @else {
                <ul class="pf-call-invite-pop__list" role="listbox">
                  @for (u of availableToInvite(); track u.id) {
                    <li>
                      <button type="button" class="pf-call-invite-pop__item press" (click)="inviteUser(u)">
                        <span class="pf-call-invite-pop__name">{{ u.displayName }}</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M5 12h14M12 5l7 7-7 7"/>
                        </svg>
                      </button>
                    </li>
                  }
                </ul>
              }
            </div>
          }
        </div>
      </div>
    }

    @if (showInCallPanel() && !callExpanded()) {
      <div class="pf-call-pill" role="region" aria-label="Active call">
        <div class="pf-call-pill__avatar">
          @if (webrtc.status() === 'active') {
            <span class="pf-call-pill__avatar-live" aria-hidden="true"></span>
          }
          {{ initials(pillTitle()) }}
        </div>
        <div class="pf-call-pill__meta">
          <span class="pf-call-pill__label">{{ pillTitle() }}</span>
          <span class="pf-call-pill__time">
            {{ webrtc.status() === 'active' ? duration() : 'Connecting…' }}
          </span>
        </div>
        @if (showRemaining()) {
          <span class="pf-call-pill__remaining" [class.pf-call-pill__remaining--urgent]="remainingUrgent()"
                title="Call auto-ends at this point — 10-minute cap on 1:1, 30-minute on group">
            {{ remainingLabel() }}
          </span>
        }
        <!-- Compact route badge: green "Free" when peer-to-peer, amber
             "Paid" when media is relayed via TURN (CF egress = billable). -->
        <span class="pf-call-pill__route" [attr.data-cost]="routeCost()" [title]="routeTitle()">
          {{ routeLabel() }}
        </span>
        <button type="button" class="pf-call-pill__btn"
                (click)="expand()" aria-label="Open full call screen" title="Expand">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 3h6v6M14 10l7-7M9 21H3v-6M10 14l-7 7"/>
          </svg>
        </button>
        <button type="button" class="pf-call-pill__btn"
                [class.pf-call-pill__btn--on]="webrtc.micMuted()"
                (click)="toggleMute()" [attr.aria-label]="webrtc.micMuted() ? 'Unmute' : 'Mute'">
          @if (webrtc.micMuted()) {
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="1" y1="1" x2="23" y2="23"/>
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
              <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          } @else {
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          }
        </button>
        <!-- Add participant (group call) — opens a popover with online
             tenant users not already in the call. Click one to invite. -->
        <button type="button" class="pf-call-pill__btn pf-call-pill__btn--add"
                (click)="toggleInvite()"
                [class.pf-call-pill__btn--on]="invitePopoverOpen()"
                aria-label="Add participant" title="Add participant">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="8.5" cy="7" r="4"/>
            <line x1="20" y1="8" x2="20" y2="14"/>
            <line x1="23" y1="11" x2="17" y2="11"/>
          </svg>
        </button>
        <button type="button" class="pf-call-pill__btn pf-call-pill__btn--end"
                (click)="leave()" aria-label="End call">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"
                  transform="rotate(135 12 12)"/>
          </svg>
        </button>

        @if (invitePopoverOpen()) {
          <div class="pf-call-invite-pop" role="dialog" aria-label="Invite to call"
               (click)="$event.stopPropagation()">
            <header class="pf-call-invite-pop__hdr">
              <span class="pf-call-invite-pop__title">Invite to call</span>
              <span class="pf-call-invite-pop__count">{{ availableToInvite().length }} online</span>
            </header>
            @if (loadingInvite()) {
              <p class="pf-call-invite-pop__empty">Loading…</p>
            } @else if (availableToInvite().length === 0) {
              <p class="pf-call-invite-pop__empty">No one else is online right now.</p>
            } @else {
              <ul class="pf-call-invite-pop__list" role="listbox">
                @for (u of availableToInvite(); track u.id) {
                  <li>
                    <button type="button" class="pf-call-invite-pop__item press"
                            (click)="inviteUser(u)">
                      <span class="pf-call-invite-pop__name">{{ u.displayName }}</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M5 12h14M12 5l7 7-7 7"/>
                      </svg>
                    </button>
                  </li>
                }
              </ul>
            }
          </div>
        }
      </div>
    }

    @if (webrtc.status() === 'outgoing' && !webrtc.incomingCall()) {
      <div class="pf-call-pill pf-call-pill--ringing" role="region" aria-label="Ringing">
        <div class="pf-call-pill__avatar">
          <span class="pf-call-pill__avatar-pulse" aria-hidden="true"></span>
          {{ initials(webrtc.localCallerName() ?? 'Calling') }}
        </div>
        <div class="pf-call-pill__meta">
          <span class="pf-call-pill__label">{{ webrtc.localCallerName() ?? 'Calling' }}</span>
          <span class="pf-call-pill__time">Ringing…</span>
        </div>
        <button type="button" class="pf-call-pill__btn pf-call-pill__btn--end"
                (click)="cancelOutgoing()" aria-label="Cancel call">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.94.36 1.85.68 2.72a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.36-1.36a2 2 0 0 1 2.11-.45c.87.32 1.78.55 2.72.68A2 2 0 0 1 22 16.92z"
                  transform="rotate(135 12 12)"/>
          </svg>
        </button>
      </div>
    }
  `,
  styles: [`
    /* Call overlay — themed against the app's violet glass tokens
       (--gradient-primary, --glass-*, --color-violet-*). No hardcoded
       hex/rgba except small inline shadows that need fixed alpha. */
    :host { display: contents; }

    /* ── Shared mono accent for time/duration ─────────────────── */
    .pf-call-mono { font-variant-numeric: tabular-nums;
      font-family: 'JetBrains Mono', ui-monospace, monospace; }

    /* ─────────────────────────────────────────────────────────
       INCOMING-CALL RINGER — fullscreen, avatar-centric, big
       circular accept/decline buttons. Pulse rings emanate from
       the avatar (one solid + one delayed) for a phone-style
       "someone's calling you" feel.
       ───────────────────────────────────────────────────────── */
    .pf-call-ring {
      position: fixed; inset: 0; z-index: 100;
      display: flex;
    }
    /* Immersive full-bleed background — a real "someone's calling you"
       screen, not a card. Deep violet radial wash over near-black so
       the avatar + buttons read against a calm field. */
    .pf-call-ring__backdrop {
      position: absolute; inset: 0;
      background:
        radial-gradient(120% 70% at 50% 18%, rgba(124, 58, 237, 0.42) 0%, transparent 62%),
        radial-gradient(90% 60% at 50% 100%, rgba(236, 72, 153, 0.20) 0%, transparent 60%),
        #07050f;
    }
    .pf-call-ring__card {
      position: relative;
      width: 100%; height: 100%;
      display: flex; flex-direction: column; align-items: center;
      /* Avatar sits in the upper third; actions hug the bottom thumb
         zone. safe-area insets keep clear of the notch + home bar. */
      padding:
        calc(env(safe-area-inset-top, 0px) + 72px)
        24px
        calc(env(safe-area-inset-bottom, 0px) + 40px);
      color: var(--text-primary); text-align: center;
      background: transparent; border: 0; border-radius: 0;
      animation: pf-call-ring-in 0.32s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes pf-call-ring-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    .pf-call-ring__eyebrow {
      font-size: 12px; font-weight: 600;
      letter-spacing: 0.18em; text-transform: uppercase;
      color: rgba(196, 181, 253, 0.9);
      margin: 0 0 44px;
    }
    .pf-call-ring__avatar-wrap {
      position: relative;
      width: 132px; height: 132px;
      margin: 0 auto 28px;
      display: flex; align-items: center; justify-content: center;
    }
    .pf-call-ring__pulse-ring {
      position: absolute; inset: 0;
      border-radius: 50%;
      border: 2px solid rgba(167, 139, 250, 0.7);
      animation: pf-call-ring-pulse 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
      opacity: 0;
    }
    .pf-call-ring__pulse-ring--delay { animation-delay: 1.2s; }
    @keyframes pf-call-ring-pulse {
      0%   { transform: scale(0.8);  opacity: 0.7; }
      70%  { transform: scale(1.6);  opacity: 0;   }
      100% { transform: scale(1.6);  opacity: 0;   }
    }
    .pf-call-ring__avatar {
      position: relative;
      width: 116px; height: 116px; border-radius: 50%;
      background: var(--gradient-primary);
      display: flex; align-items: center; justify-content: center;
      font-size: 40px; font-weight: 700; color: #fff;
      letter-spacing: 0.02em;
      box-shadow:
        0 0 60px rgba(139, 92, 246, 0.55),
        0 16px 40px rgba(0, 0, 0, 0.45),
        inset 0 0 0 2px rgba(255, 255, 255, 0.16);
    }
    .pf-call-ring__card--group .pf-call-ring__avatar {
      background: linear-gradient(135deg, #06b6d4, #6366f1);
      box-shadow:
        0 0 60px rgba(99, 102, 241, 0.5),
        0 16px 40px rgba(0, 0, 0, 0.45),
        inset 0 0 0 2px rgba(255, 255, 255, 0.16);
    }
    .pf-call-ring__card--group .pf-call-ring__pulse-ring {
      border-color: rgba(129, 140, 248, 0.7);
    }
    .pf-call-ring__name {
      font-size: 30px; font-weight: 700; margin: 0;
      letter-spacing: -0.02em;
      color: #fff;
    }
    .pf-call-ring__source {
      font-size: 15px; color: rgba(226, 232, 240, 0.62);
      margin: 8px 0 0;
    }
    /* Spacer pushes the action row to the bottom of the screen. */
    .pf-call-ring__actions {
      margin-top: auto;
      display: flex; gap: 72px; justify-content: center;
    }
    .pf-call-ring__btn {
      width: 76px; height: 76px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 50%; border: none; cursor: pointer; color: #fff;
      transition: transform 0.12s, box-shadow 0.2s, filter 0.2s;
    }
    .pf-call-ring__btn:hover { filter: brightness(1.08); }
    .pf-call-ring__btn:active { transform: scale(0.92); }
    .pf-call-ring__btn--reject {
      background: linear-gradient(135deg, #f43f5e, #e11d48);
      box-shadow: 0 12px 32px rgba(244, 63, 94, 0.5);
    }
    .pf-call-ring__btn--accept {
      background: linear-gradient(135deg, #22c55e, #16a34a);
      box-shadow: 0 12px 32px rgba(34, 197, 94, 0.5);
      animation: pf-call-accept-breathe 1.8s ease-in-out infinite;
    }
    @keyframes pf-call-accept-breathe {
      0%, 100% { transform: scale(1);    box-shadow: 0 12px 32px rgba(34, 197, 94, 0.5); }
      50%      { transform: scale(1.06); box-shadow: 0 18px 44px rgba(34, 197, 94, 0.66); }
    }
    .pf-call-ring__labels {
      display: flex; gap: 72px; justify-content: center;
      margin-top: 14px;
      font-size: 13px; font-weight: 500;
      color: rgba(226, 232, 240, 0.7);
    }
    .pf-call-ring__labels span {
      flex-basis: 76px; text-align: center;
    }

    /* ─────────────────────────────────────────────────────────
       MINIMIZED PILL — slim glass capsule bottom-right with a
       small avatar, peer name + duration, and the core controls.
       Sits above the mobile bottom-nav.
       ───────────────────────────────────────────────────────── */
    .pf-call-pill {
      position: fixed;
      bottom: calc(88px + env(safe-area-inset-bottom, 0px));
      right: 12px; z-index: 60;
      display: inline-flex; align-items: center; gap: 10px;
      padding: 6px 8px 6px 6px;
      border-radius: 9999px;
      background: var(--surface-elevated);
      border: 1px solid var(--glass-border-hover);
      box-shadow: var(--glass-shadow), 0 0 0 1px rgba(139, 92, 246, 0.15) inset;
      backdrop-filter: blur(var(--glass-blur));
      -webkit-backdrop-filter: blur(var(--glass-blur));
      color: var(--text-primary);
      font-size: 12.5px; line-height: 1.2;
      animation: pf-call-pill-in 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
      max-width: calc(100vw - 24px);
    }
    @media (min-width: 1280px) {
      .pf-call-pill { bottom: 16px; right: 16px; }
    }
    @keyframes pf-call-pill-in {
      from { opacity: 0; transform: translateY(10px) scale(0.92); }
      to   { opacity: 1; transform: none; }
    }
    .pf-call-pill__avatar {
      position: relative;
      width: 34px; height: 34px; border-radius: 50%;
      background: var(--gradient-primary);
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 700; color: #fff;
      letter-spacing: 0.02em;
      box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
      flex-shrink: 0;
    }
    .pf-call-pill__avatar-live {
      position: absolute; inset: -3px;
      border-radius: 50%;
      border: 2px solid var(--color-success);
      box-shadow: 0 0 8px rgba(16, 185, 129, 0.5);
      animation: pf-call-pill-ring 1.8s ease-in-out infinite;
    }
    .pf-call-pill__avatar-pulse {
      position: absolute; inset: -4px;
      border-radius: 50%;
      border: 2px solid var(--color-violet-400);
      animation: pf-call-pill-ring 1.4s ease-in-out infinite;
    }
    @keyframes pf-call-pill-ring {
      0%, 100% { transform: scale(1);   opacity: 0.85; }
      50%      { transform: scale(1.15); opacity: 0.25; }
    }
    .pf-call-pill__meta {
      display: flex; flex-direction: column; gap: 0;
      min-width: 0; max-width: 130px;
    }
    .pf-call-pill__label {
      font-weight: 600; color: var(--text-primary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .pf-call-pill__time {
      font-size: 11px; color: var(--text-tertiary);
      font-variant-numeric: tabular-nums;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }
    .pf-call-pill__btn {
      width: 32px; height: 32px; border-radius: 50%;
      background: var(--glass-bg-hover);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer;
      transition: background 0.12s, color 0.12s, transform 0.08s, border-color 0.12s;
    }
    .pf-call-pill__btn:hover {
      background: rgba(139, 92, 246, 0.2);
      border-color: rgba(139, 92, 246, 0.4);
      color: var(--text-primary);
    }
    .pf-call-pill__btn:active { transform: scale(0.92); }
    .pf-call-pill__btn--on {
      background: rgba(244, 63, 94, 0.22);
      border-color: rgba(244, 63, 94, 0.4);
      color: #fb7185;
    }
    .pf-call-pill__btn--add {
      background: rgba(139, 92, 246, 0.2);
      border-color: rgba(139, 92, 246, 0.4);
      color: var(--color-violet-300);
    }
    .pf-call-pill__btn--end {
      background: linear-gradient(135deg, #f43f5e, #e11d48);
      border-color: transparent;
      color: #fff;
      box-shadow: 0 4px 12px rgba(244, 63, 94, 0.4);
    }
    .pf-call-pill__btn--end:hover {
      background: linear-gradient(135deg, #ec4055, #be123c);
      color: #fff;
    }

    /* Remaining time + route chips on the pill */
    .pf-call-pill__remaining {
      font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em;
      padding: 3px 8px; border-radius: 9999px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      background: var(--info-bg); color: var(--info-text);
      white-space: nowrap; cursor: help;
    }
    .pf-call-pill__remaining--urgent {
      background: var(--error-bg); color: var(--error-text);
      animation: pf-call-remaining-pulse 1s ease-in-out infinite;
    }
    @keyframes pf-call-remaining-pulse {
      0%, 100% { opacity: 1; }
      50%      { opacity: 0.5; }
    }
    .pf-call-pill__route {
      font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
      padding: 3px 8px; border-radius: 9999px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      white-space: nowrap; cursor: help;
      text-transform: uppercase;
    }
    .pf-call-pill__route[data-cost='free'] {
      background: var(--success-bg); color: var(--success-text);
    }
    .pf-call-pill__route[data-cost='paid'] {
      background: var(--warning-bg); color: var(--warning-text);
    }
    /* Hide the route badge on narrow phones — keep the pill compact. */
    @media (max-width: 420px) {
      .pf-call-pill__route { display: none; }
    }

    .pf-call-pill--ringing .pf-call-pill__avatar {
      background: linear-gradient(135deg, #a78bfa, #8b5cf6);
    }

    /* ─────────────────────────────────────────────────────────
       FULL-SCREEN ACTIVE CALL — wider card, clean header with
       live-dot status + duration + relay chip, larger participant
       tiles with a pulsing ring around connected (unmuted) people,
       and Teams-style circular control buttons at the bottom.
       ───────────────────────────────────────────────────────── */
    .pf-call-screen {
      position: fixed; inset: 0; z-index: 90;
      display: flex;
    }
    /* Immersive full-bleed active-call background — same violet wash
       family as the ringer so accepting a call feels continuous. */
    .pf-call-screen__backdrop {
      position: absolute; inset: 0;
      background:
        radial-gradient(110% 60% at 50% 0%, rgba(124, 58, 237, 0.34) 0%, transparent 60%),
        radial-gradient(90% 55% at 50% 100%, rgba(236, 72, 153, 0.16) 0%, transparent 58%),
        #07050f;
    }
    .pf-call-screen__card {
      position: relative;
      width: 100%; height: 100%;
      padding:
        calc(env(safe-area-inset-top, 0px) + 14px)
        20px
        calc(env(safe-area-inset-bottom, 0px) + 24px);
      background: transparent; border: 0; border-radius: 0;
      color: var(--text-primary);
      display: flex; flex-direction: column; gap: 16px;
      animation: pf-call-screen-in 0.26s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes pf-call-screen-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    /* Header: icon-btn left (minimise) + status pill + chips + icon-btn right (close).
       Compact, glass surfaces, no borders that look like form fields. */
    .pf-call-screen__hdr {
      display: flex; align-items: center; gap: 10px;
      flex-shrink: 0;
    }
    .pf-call-screen__icon-btn {
      width: 36px; height: 36px; border-radius: 10px;
      display: inline-flex; align-items: center; justify-content: center;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: rgba(226, 232, 240, 0.85);
      cursor: pointer;
      transition: background 0.12s, color 0.12s, border-color 0.12s;
      flex-shrink: 0;
    }
    .pf-call-screen__icon-btn:hover {
      background: rgba(255, 255, 255, 0.14);
      color: #fff;
      border-color: rgba(255, 255, 255, 0.2);
    }
    .pf-call-screen__hdr-info {
      flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px;
      min-width: 0;
    }
    .pf-call-screen__hdr-status {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 3px 10px; border-radius: 9999px;
      font-size: 11.5px; font-weight: 700; letter-spacing: 0.04em;
      text-transform: uppercase;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-tertiary);
    }
    .pf-call-screen__hdr-status--live {
      background: rgba(16, 185, 129, 0.15);
      border-color: rgba(16, 185, 129, 0.32);
      color: var(--color-success);
    }
    .pf-call-screen__live-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--color-success);
      box-shadow: 0 0 6px var(--color-success);
      animation: pf-call-live-blink 1.6s ease-in-out infinite;
    }
    .pf-call-screen__hdr-status:not(.pf-call-screen__hdr-status--live) .pf-call-screen__live-dot {
      background: var(--color-violet-400);
      box-shadow: 0 0 6px var(--color-violet-400);
    }
    @keyframes pf-call-live-blink {
      0%, 100% { opacity: 0.55; transform: scale(0.85); }
      50%      { opacity: 1;    transform: scale(1.15); }
    }
    .pf-call-screen__hdr-meta {
      display: inline-flex; align-items: center; gap: 6px;
      flex-wrap: wrap; justify-content: center;
    }
    .pf-call-screen__time {
      font-size: 12px; color: var(--text-tertiary);
      font-variant-numeric: tabular-nums;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }
    .pf-call-screen__route-chip {
      font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
      padding: 2px 7px; border-radius: 9999px;
      text-transform: uppercase;
      cursor: help;
    }
    .pf-call-screen__route-chip[data-cost='free'] {
      background: var(--success-bg); color: var(--success-text);
    }
    .pf-call-screen__route-chip[data-cost='paid'] {
      background: var(--warning-bg); color: var(--warning-text);
    }
    .pf-call-screen__remaining {
      font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em;
      padding: 3px 8px; border-radius: 9999px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      background: var(--info-bg); color: var(--info-text);
    }
    .pf-call-screen__remaining--urgent {
      background: var(--error-bg); color: var(--error-text);
      animation: pf-call-remaining-pulse 1s ease-in-out infinite;
    }

    /* Participants grid — bigger cards, ring around the avatar that
       pulses for connected (unmuted) participants, mute badge in the
       corner. Phone gets a 2-col stack. */
    .pf-call-screen__participants {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      padding: 4px 0;
      overflow-y: auto;
      /* Fill the space between header and controls, and centre the
         avatar cards vertically — gives the immersive call the
         "people floating in the middle" look. */
      flex: 1; min-height: 0;
      align-content: center;
    }
    .pf-call-screen__participants[data-count='1'],
    .pf-call-screen__participants[data-count='2'] {
      grid-template-columns: repeat(2, 1fr);
    }
    @media (max-width: 520px) {
      .pf-call-screen__participants {
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
      }
    }
    .pf-call-screen__pcard {
      display: flex; flex-direction: column; align-items: center; gap: 10px;
      padding: 22px 12px 18px;
      /* Translucent glass tile against the immersive backdrop. */
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.09);
      border-radius: 18px;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      transition: border-color 0.2s, background 0.2s;
    }
    .pf-call-screen__pcard--mine {
      border-color: rgba(167, 139, 250, 0.4);
      background: rgba(124, 58, 237, 0.14);
    }
    .pf-call-screen__pcard--muted { opacity: 0.7; }

    .pf-call-screen__avatar-wrap {
      position: relative;
      width: 64px; height: 64px;
      display: flex; align-items: center; justify-content: center;
    }
    .pf-call-screen__avatar-ring {
      position: absolute; inset: -4px;
      border-radius: 50%;
      border: 2px solid var(--color-success);
      opacity: 0;
      animation: pf-call-screen-ring 2.2s ease-in-out infinite;
    }
    /* Only show the connected-ring pulse on participants who are NOT
       muted (best-effort visual; real VAD would need WebAudio). */
    .pf-call-screen__pcard:not(.pf-call-screen__pcard--muted) .pf-call-screen__avatar-ring {
      opacity: 1;
    }
    @keyframes pf-call-screen-ring {
      0%, 100% { transform: scale(1);    opacity: 0.7; }
      50%      { transform: scale(1.08); opacity: 0.2; }
    }
    .pf-call-screen__avatar {
      width: 64px; height: 64px; border-radius: 50%;
      background: var(--gradient-primary);
      display: flex; align-items: center; justify-content: center;
      font-size: 22px; font-weight: 700; color: #fff;
      letter-spacing: 0.02em;
      box-shadow: 0 8px 24px rgba(139, 92, 246, 0.32), inset 0 0 0 2px rgba(255, 255, 255, 0.15);
    }
    .pf-call-screen__pcard--mine .pf-call-screen__avatar {
      background: linear-gradient(135deg, #06b6d4, #6366f1);
      box-shadow: 0 8px 24px rgba(99, 102, 241, 0.32), inset 0 0 0 2px rgba(255, 255, 255, 0.15);
    }
    .pf-call-screen__mute-badge {
      position: absolute;
      right: -2px; bottom: -2px;
      width: 22px; height: 22px;
      border-radius: 50%;
      background: var(--surface-elevated);
      border: 2px solid var(--bg-card-solid);
      color: var(--color-danger);
      display: inline-flex; align-items: center; justify-content: center;
    }
    .pf-call-screen__pname {
      margin: 0;
      font-size: 13.5px; font-weight: 600;
      text-align: center;
      max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      color: var(--text-primary);
    }
    .pf-call-screen__pmeta {
      margin: 0;
      font-size: 11px; font-weight: 500;
      color: var(--text-tertiary);
      text-transform: uppercase; letter-spacing: 0.06em;
    }
    @media (max-width: 520px) {
      .pf-call-screen__avatar-wrap { width: 52px; height: 52px; }
      .pf-call-screen__avatar      { width: 52px; height: 52px; font-size: 18px; }
      .pf-call-screen__pcard       { padding: 14px 8px 12px; gap: 8px; }
      .pf-call-screen__pname       { font-size: 12.5px; }
      .pf-call-screen__pmeta       { font-size: 10px; }
    }

    /* Control row: 3 buttons each as a {circle + label} stack.
       The circles look like Teams/Zoom — large, solid, with the
       End button in danger red and the active state on Add. */
    .pf-call-screen__ctrls {
      display: flex; align-items: flex-start; justify-content: center; gap: 28px;
      padding-top: 8px;
      flex-shrink: 0;
    }
    @media (max-width: 520px) {
      .pf-call-screen__ctrls { gap: 18px; }
    }
    .pf-call-screen__ctrl {
      display: inline-flex; flex-direction: column; align-items: center; gap: 6px;
      background: transparent; border: none; padding: 0;
      cursor: pointer;
      color: var(--text-secondary);
      transition: color 0.12s;
    }
    .pf-call-screen__ctrl:hover { color: var(--text-primary); }
    .pf-call-screen__ctrl-circle {
      width: 60px; height: 60px;
      border-radius: 50%;
      /* Glass discs against the immersive backdrop — translucent so the
         violet wash shows through, like FaceTime / Meet controls. */
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.16);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      display: inline-flex; align-items: center; justify-content: center;
      transition: background 0.15s, border-color 0.15s, transform 0.08s, box-shadow 0.15s;
    }
    .pf-call-screen__ctrl:hover .pf-call-screen__ctrl-circle {
      background: rgba(139, 92, 246, 0.18);
      border-color: rgba(139, 92, 246, 0.4);
    }
    .pf-call-screen__ctrl:active .pf-call-screen__ctrl-circle {
      transform: scale(0.94);
    }
    .pf-call-screen__ctrl--on .pf-call-screen__ctrl-circle {
      background: rgba(244, 63, 94, 0.2);
      border-color: rgba(244, 63, 94, 0.45);
      color: #fb7185;
    }
    .pf-call-screen__ctrl--on { color: #fb7185; }
    .pf-call-screen__ctrl--active .pf-call-screen__ctrl-circle {
      background: rgba(139, 92, 246, 0.28);
      border-color: var(--color-violet-500);
    }
    .pf-call-screen__ctrl--active { color: var(--color-violet-300); }
    .pf-call-screen__ctrl--end .pf-call-screen__ctrl-circle {
      background: linear-gradient(135deg, #f43f5e, #e11d48);
      border-color: transparent;
      color: #fff;
      box-shadow: 0 8px 20px rgba(244, 63, 94, 0.42);
    }
    .pf-call-screen__ctrl--end:hover .pf-call-screen__ctrl-circle {
      background: linear-gradient(135deg, #ec4055, #be123c);
    }
    .pf-call-screen__ctrl--end { color: #fb7185; }
    .pf-call-screen__ctrl-lbl { font-size: 11px; font-weight: 600; letter-spacing: 0.02em; }

    /* ── In-call chat side panel ─────────────────────────────── */
    .pf-call-screen__card--with-chat {
      display: grid;
      grid-template-areas:
        "hdr      hdr"
        "people   chat"
        "ctrls    ctrls";
      grid-template-columns: 1fr min(360px, 32vw);
      grid-template-rows: auto 1fr auto;
      gap: 12px;
    }
    .pf-call-screen__card--with-chat .pf-call-screen__hdr           { grid-area: hdr; }
    .pf-call-screen__card--with-chat .pf-call-screen__participants  { grid-area: people; }
    .pf-call-screen__card--with-chat .pf-call-screen__chat          { grid-area: chat; }
    .pf-call-screen__card--with-chat .pf-call-screen__ctrls         { grid-area: ctrls; }
    @media (max-width: 720px) {
      .pf-call-screen__card--with-chat {
        grid-template-areas:
          "hdr"
          "chat"
          "ctrls";
        grid-template-columns: 1fr;
        grid-template-rows: auto 1fr auto;
      }
      .pf-call-screen__card--with-chat .pf-call-screen__participants { display: none; }
    }

    .pf-call-screen__chat {
      display: flex; flex-direction: column;
      min-height: 0; min-width: 0;
      background: var(--bg-card);
      border: 1px solid var(--glass-border);
      border-radius: 14px;
      overflow: hidden;
    }
    .pf-call-screen__chat-hdr {
      display: flex; align-items: center; justify-content: space-between;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border-muted);
      background: var(--bg-card-solid);
    }
    .pf-call-screen__chat-title {
      font-size: 12px; font-weight: 700;
      letter-spacing: 0.04em; text-transform: uppercase;
      color: var(--text-secondary);
    }
    .pf-call-screen__icon-btn--sm {
      width: 24px; height: 24px;
      padding: 0;
    }
    .pf-call-screen__icon-btn--active {
      background: rgba(139, 92, 246, 0.22);
      border-color: rgba(139, 92, 246, 0.45);
      color: var(--color-violet-300);
    }
    .pf-call-screen__chat-scroller {
      flex: 1; min-height: 0;
      overflow-y: auto;
      padding: 10px 10px 6px;
      display: flex; flex-direction: column; gap: 6px;
    }
    .pf-call-screen__chat-empty {
      margin: auto;
      text-align: center;
      font-size: 12px;
      color: var(--text-tertiary);
      padding: 16px;
    }
    .pf-call-screen__chat-row {
      display: flex;
      &.pf-call-screen__chat-row--mine { justify-content: flex-end; }
    }
    .pf-call-screen__chat-bubble {
      max-width: 78%;
      padding: 6px 10px;
      border-radius: 10px 10px 10px 3px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      &.pf-call-screen__chat-bubble--mine {
        border-radius: 10px 10px 3px 10px;
        background: var(--gradient-primary);
        color: #fff;
        border-color: transparent;
      }
    }
    .pf-call-screen__chat-body {
      font-size: 12.5px;
      line-height: 1.4;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .pf-call-screen__chat-time {
      font-size: 10px;
      opacity: 0.7;
      margin-top: 2px;
      font-variant-numeric: tabular-nums;
    }
    .pf-call-screen__chat-composer {
      display: flex; gap: 6px;
      padding: 8px 10px;
      border-top: 1px solid var(--border-muted);
      background: var(--bg-card-solid);
      input {
        flex: 1; min-width: 0;
        padding: 6px 10px;
        border-radius: 16px;
        border: 1px solid var(--input-border);
        background: var(--bg-input);
        color: var(--input-text);
        font-size: 12.5px;
        outline: none;
        &:focus { border-color: var(--input-border-focus); }
      }
      button {
        width: 30px; height: 30px;
        border-radius: 50%;
        border: none;
        background: var(--gradient-primary);
        color: #fff;
        display: inline-flex; align-items: center; justify-content: center;
        cursor: pointer;
        flex-shrink: 0;
        &:disabled { opacity: 0.4; cursor: not-allowed; }
      }
    }

    /* ── Invite-to-call popover ───────────────────────────────── */
    .pf-call-invite-pop {
      position: absolute; bottom: calc(100% + 8px); right: 0;
      width: 280px; max-height: 320px;
      display: flex; flex-direction: column;
      background: var(--surface-elevated);
      border: 1px solid var(--glass-border-hover);
      border-radius: 14px;
      box-shadow: var(--glass-shadow-hover);
      overflow: hidden;
      animation: pf-call-pop-in 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .pf-call-invite-pop--screen {
      position: absolute;
      bottom: 92px;
      left: 50%; right: auto;
      transform: translateX(-50%);
    }
    @keyframes pf-call-pop-in {
      from { opacity: 0; transform: translateY(8px) scale(0.95); }
      to   { opacity: 1; transform: none; }
    }
    .pf-call-invite-pop--screen[class] {
      /* Override the translateY animation start so the centered one
         doesn't override our centering. */
      animation: pf-call-pop-in-center 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    @keyframes pf-call-pop-in-center {
      from { opacity: 0; transform: translateX(-50%) translateY(8px) scale(0.95); }
      to   { opacity: 1; transform: translateX(-50%); }
    }
    .pf-call-invite-pop__hdr {
      display: flex; align-items: baseline; justify-content: space-between;
      padding: 12px 14px;
      border-bottom: 1px solid var(--border-muted);
    }
    .pf-call-invite-pop__title {
      font-size: 13px; font-weight: 700;
      color: var(--text-primary);
    }
    .pf-call-invite-pop__count {
      font-size: 10.5px; color: var(--text-tertiary);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }
    .pf-call-invite-pop__list {
      list-style: none; padding: 6px; margin: 0;
      overflow-y: auto;
    }
    .pf-call-invite-pop__item {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      width: 100%; padding: 9px 10px;
      background: transparent; border: none; border-radius: 8px;
      color: var(--text-secondary);
      font-size: 13px; font-weight: 500; text-align: left;
      cursor: pointer;
      transition: background 0.12s, color 0.12s;
    }
    .pf-call-invite-pop__item:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    .pf-call-invite-pop__name {
      flex: 1; min-width: 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .pf-call-invite-pop__empty {
      padding: 22px 16px; text-align: center;
      font-size: 12.5px; color: var(--text-tertiary);
    }

    /* ────────────────────────────────────────────────────────────
       MOBILE — phone-first overrides
       The call surface is the most safety-critical UX in the app
       (incoming call must be impossible to miss + impossible to
       accidentally accept/decline). On phone we:
         - take the full viewport, edge-to-edge
         - push action buttons into the natural thumb-zone (bottom 1/3)
         - bump button targets to 64-72px diameter
         - honour safe-area-inset-bottom so the home indicator doesn't
           sit on top of the End button
       ──────────────────────────────────────────────────────────── */
    @media (max-width: 640px) {
      /* Incoming ringer fills the screen — feels like a real phone call */
      .pf-call-ring { padding: 0; }
      .pf-call-ring__card {
        width: 100%; max-width: none;
        min-height: 100vh;
        border-radius: 0;
        padding: max(28px, env(safe-area-inset-top)) 28px max(28px, env(safe-area-inset-bottom));
        display: flex; flex-direction: column;
        justify-content: center;
        animation: pf-call-ring-fade 0.18s ease-out;
      }
      @keyframes pf-call-ring-fade { from { opacity: 0; } to { opacity: 1; } }
      .pf-call-ring__avatar-wrap { width: 132px; height: 132px; }
      .pf-call-ring__avatar      { width: 116px; height: 116px; font-size: 38px; }
      .pf-call-ring__name        { font-size: 28px; }
      .pf-call-ring__source      { font-size: 14px; }
      .pf-call-ring__actions {
        gap: 64px;
        margin-top: auto;       /* push to bottom thumb-zone */
        padding-top: 64px;
      }
      .pf-call-ring__btn  { width: 76px; height: 76px; }
      .pf-call-ring__labels { gap: 64px;
        span { flex-basis: 76px; }
      }

      /* Full-screen active call — edge-to-edge, thicker controls */
      .pf-call-screen { padding: 0; align-items: stretch; }
      .pf-call-screen__card {
        width: 100%; max-width: none;
        max-height: none;
        height: 100vh; min-height: 100vh;
        border-radius: 0;
        padding: max(12px, env(safe-area-inset-top)) 12px max(14px, env(safe-area-inset-bottom));
      }
      .pf-call-screen__ctrls { gap: 24px; padding-top: 16px; }
      .pf-call-screen__ctrl-circle { width: 60px; height: 60px; }
      .pf-call-screen__ctrl-lbl    { font-size: 11px; }
      .pf-call-screen__hdr-info    { gap: 6px; }
      .pf-call-screen__hdr-meta    { gap: 6px; }

      /* In-call chat: when open on phone, it takes the participants
         space + controls area becomes a slim bar at the bottom. */
      .pf-call-screen__card--with-chat {
        grid-template-areas: "hdr" "chat" "ctrls" !important;
        grid-template-columns: 1fr !important;
        grid-template-rows: auto 1fr auto !important;
      }
      .pf-call-screen__card--with-chat .pf-call-screen__participants {
        display: none !important;
      }

      /* Floating pill — bigger, more prominent above the bottom nav */
      .pf-call-pill {
        bottom: calc(96px + env(safe-area-inset-bottom));
        padding: 8px 10px 8px 8px;
        font-size: 13px;
      }
      .pf-call-pill__avatar { width: 38px; height: 38px; font-size: 13px; }
      .pf-call-pill__btn    { width: 36px; height: 36px; }
    }

    @media (max-width: 360px) {
      .pf-call-pill__meta { max-width: 90px; }
      .pf-call-pill__btn--add { display: none; }
    }
  `]
})
export class CallOverlayComponent {
  protected readonly webrtc = inject(WebrtcService);
  protected readonly chat = inject(ChatService);
  private readonly toast = inject(ToastService);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly signaling = inject(SignalingService);
  private readonly ringtone = inject(RingtoneService);

  // ── In-call chat side panel ──────────────────────────────────────
  protected readonly chatPanelOpen = signal(false);
  protected readonly chatDraft = signal('');

  /** Resolve the conversation to use for the in-call chat sidebar:
   *   - Group call (incoming-call payload carried conversationId) → that.
   *   - 1:1 with one remote participant → get-or-create the direct convo.
   *   - Otherwise null (no chat). */
  protected async toggleChatPanel(): Promise<void> {
    const next = !this.chatPanelOpen();
    this.chatPanelOpen.set(next);
    if (!next) return;
    // Already open? Make sure ChatService has the right conversation loaded.
    const ic = this.webrtc.incomingCall();
    const remotes = this.webrtc.remoteParticipants();
    try {
      if (ic?.isGroup && ic.conversationId) {
        if (this.chat.activeConversationId() !== ic.conversationId) {
          await this.chat.openConversation(ic.conversationId);
        }
      } else if (remotes.length === 1) {
        await this.chat.openDirectConversation(remotes[0]);
      } else {
        // Group call I initiated → look for the matching group conversation
        // by participant overlap. Best-effort.
        const me = this.auth.user()?.authId ?? this.auth.user()?.id ?? '';
        const all = new Set([me, ...remotes]);
        const match = this.chat.conversations().find(c =>
          c.isGroup
          && c.participants.length === all.size
          && c.participants.every(p => all.has(p.userId)));
        if (match) await this.chat.openConversation(match.id);
        else {
          this.toast.info('In-call chat is not available for this call.');
          this.chatPanelOpen.set(false);
        }
      }
    } catch (err) {
      this.toast.error('Could not open chat for this call.');
      this.chatPanelOpen.set(false);
    }
  }

  protected async sendInCallMessage(): Promise<void> {
    const body = this.chatDraft().trim();
    const convId = this.chat.activeConversationId();
    if (!body || !convId) return;
    this.chatDraft.set('');
    try { await this.chat.sendMessage(convId, body); }
    catch (err) { this.toast.error((err as Error).message ?? 'Could not send.'); }
  }
  protected onChatKeyDown(ev: KeyboardEvent): void {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); void this.sendInCallMessage(); }
  }
  protected meAuthId(): string {
    return this.auth.user()?.authId ?? this.auth.user()?.id ?? '';
  }

  // ── Add-participant (group call) state ────────────────────────
  protected readonly invitePopoverOpen = signal(false);
  protected readonly loadingInvite = signal(false);
  private readonly directoryUsers = signal<DirectoryUser[]>([]);

  // ── Full-screen call view ─────────────────────────────────────
  /** When true, the rich full-screen call view replaces the floating pill.
   *  Default is true on call-start; the user can minimise to return to the pill. */
  protected readonly callExpanded = signal(true);
  expand(): void { this.callExpanded.set(true); }
  minimise(): void { this.callExpanded.set(false); this.invitePopoverOpen.set(false); }

  /**
   * Title for the minimized call pill: the other party for 1:1, or
   * "Group call · N" for multi-party. Falls back to "On call" if we
   * don't have the directory loaded yet.
   */
  protected readonly pillTitle = computed(() => {
    const parts = this.participants();
    const others = parts.filter(p => !p.isMe);
    if (others.length === 0) return 'Connecting…';
    if (others.length === 1) return others[0].name;
    return `Group call · ${others.length + 1}`;
  });

  /** Self + remote participants, with names resolved from the directory cache. */
  protected readonly participants = computed(() => {
    const me = this.auth.user();
    const meId = me?.authId ?? me?.id ?? '';
    const dir = this.directoryUsers();
    const byId = new Map(dir.map(d => [d.id, d.displayName]));
    const mutedRemote = this.webrtc.remoteMuted();
    const incomingCallerId = this.webrtc.incomingCall()?.callerId;
    const incomingCallerName = this.webrtc.localCallerName();
    const remote = this.webrtc.remoteParticipants().map(rid => {
      // Directory entry wins. If missing, fall back to the incoming-call
      // payload ONLY when this rid is the original caller — otherwise other
      // group participants would all wrongly inherit that name. Last resort
      // is "Joining…" which reads correctly while the directory is loading.
      const fromDir = byId.get(rid);
      const fromCaller = rid === incomingCallerId ? incomingCallerName : null;
      return {
        id: rid,
        name: fromDir ?? fromCaller ?? 'Joining…',
        isMe: false,
        muted: mutedRemote.get(rid) ?? false
      };
    });
    return [
      { id: meId, name: me?.displayName ?? 'You', isMe: true, muted: this.webrtc.micMuted() },
      ...remote
    ];
  });

  /** Media routing badge: P2P direct = free; TURN relay = billable Cloudflare egress. */
  protected readonly routeCost = computed<'free' | 'paid'>(() =>
    this.webrtc.usingTurnRelay() ? 'paid' : 'free');
  protected readonly routeLabel = computed(() =>
    this.webrtc.usingTurnRelay() ? '● Paid' : '● Free');
  protected readonly routeTitle = computed(() =>
    this.webrtc.usingTurnRelay()
      ? 'Media is relayed via TURN — billable Cloudflare egress'
      : 'Peer-to-peer direct media — no relay cost');

  /** Online users in my tenant who AREN'T already in the call (and aren't me). */
  protected readonly availableToInvite = computed<DirectoryUser[]>(() => {
    const me = this.auth.user()?.authId ?? this.auth.user()?.id ?? '';
    const online = this.signaling.onlineUserIds();
    const inCall = new Set<string>([me, ...this.webrtc.remoteParticipants()]);
    return this.directoryUsers().filter(u =>
      u.isActive && !inCall.has(u.id) && online.has(u.id));
  });

  protected readonly audioEntries = computed(() => {
    const m = this.webrtc.remoteAudio();
    return Array.from(m.entries()).map(([userId, stream]) => ({ userId, stream }));
  });

  protected readonly showInCallPanel = computed(() => {
    const s = this.webrtc.status();
    return s === 'connecting' || s === 'active' || s === 'ending';
  });

  private readonly _now = signal(Date.now());

  constructor() {
    // 1Hz timer so the duration string updates while in a call.
    effect(onCleanup => {
      if (!this.webrtc.inCall()) return;
      const h = setInterval(() => this._now.set(Date.now()), 1000);
      onCleanup(() => clearInterval(h));
    });

    // On entering a call, expand to full-screen + preload the directory so
    // participant names render correctly. On exit, reset to expanded for the
    // next call.
    effect(() => {
      const inCall = this.webrtc.inCall();
      if (inCall) {
        this.callExpanded.set(true);
        if (this.directoryUsers().length === 0) {
          queueMicrotask(async () => {
            try {
              const list = await firstValueFrom(
                this.api.get<DirectoryUser[]>('/api/directory/users'));
              this.directoryUsers.set(list ?? []);
            } catch { /* names will fall back to "Caller" */ }
          });
        }
      } else {
        this.callExpanded.set(true);
        this.invitePopoverOpen.set(false);
      }
    });

    // Audio cues — synthesised tones via Web Audio API, no asset files.
    // ringback while outgoing (caller hears it before pickup); ringtone
    // while an incoming call is pending. Stops the moment status leaves
    // those states (answered / rejected / cancelled).
    effect(() => {
      const status = this.webrtc.status();
      const incoming = this.webrtc.incomingCall();
      if (incoming) {
        this.ringtone.play('ringtone');
      } else if (status === 'outgoing') {
        this.ringtone.play('ringback');
      } else {
        this.ringtone.stop();
      }
    });

    // Voice playback runs via SrcObjectDirective on the <audio> elements —
    // see template above. The directive handles property-assignment +
    // .play() in the element's lifecycle, which avoids the race the
    // previous querySelectorAll-based effect had with Angular's render
    // (firing before the new audio element existed in the DOM).
  }

  protected duration = computed(() => {
    const started = this.webrtc.callStartedAt();
    if (!started) return '00:00';
    const sec = Math.max(0, Math.floor((this._now() - started) / 1000));
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  });

  /** "MM:SS" countdown until the cap kicks in. Hidden until under 2min. */
  protected remainingLabel = computed(() => {
    const ms = this.webrtc.remainingMs();
    if (ms <= 0) return '';
    const sec = Math.ceil(ms / 1000);
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    return `${mm}:${ss} left`;
  });
  protected showRemaining = computed(() => this.webrtc.remainingMs() > 0 && this.webrtc.remainingMs() <= 120_000);
  protected remainingUrgent = computed(() => this.webrtc.remainingMs() > 0 && this.webrtc.remainingMs() <= 60_000);

  protected initials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('') || '?';
  }

  protected sourceLabel(src: string): string {
    switch (src) {
      case 'pathologist_validation': return 'Pathologist consult';
      case 'frontdesk_patient':      return 'Frontdesk';
      case 'admin_internal':         return 'Internal';
      default: return src;
    }
  }

  async accept() {
    try { await this.webrtc.acceptIncoming(); }
    catch (err) { this.toast.error((err as Error).message ?? 'Could not accept call.'); }
  }
  async reject() {
    try { await this.webrtc.rejectIncoming(); }
    catch (err) { this.toast.error((err as Error).message ?? 'Could not decline call.'); }
  }
  async leave() {
    await this.webrtc.leaveCall();
  }
  async cancelOutgoing() {
    await this.webrtc.cancelOutgoing();
  }
  toggleMute() { this.webrtc.toggleMute(); }

  // ── Add participant (group call) ─────────────────────────────

  async toggleInvite(): Promise<void> {
    const next = !this.invitePopoverOpen();
    this.invitePopoverOpen.set(next);
    if (next) {
      // Lazy-load directory on first open. Skip if already fetched this session.
      if (this.directoryUsers().length === 0) {
        this.loadingInvite.set(true);
        try {
          const list = await firstValueFrom(
            this.api.get<DirectoryUser[]>('/api/directory/users'));
          this.directoryUsers.set(list ?? []);
        } catch {
          this.toast.error('Could not load people list');
        } finally {
          this.loadingInvite.set(false);
        }
      }
      // Make sure presence is fresh so we don't show offline users.
      void this.signaling.getOnlineUsersWithStatus().catch(() => undefined);
    }
  }

  async inviteUser(u: DirectoryUser): Promise<void> {
    this.invitePopoverOpen.set(false);
    try {
      // u.id is the Supabase sub (DirectoryController returns AuthId as Id).
      // Matches the id space SignalR addresses connections by, so the
      // IncomingCall event fires on the right tab.
      await this.webrtc.inviteToCall(u.id);
      this.toast.info(`Ringing ${u.displayName}…`);
    } catch (err) {
      this.toast.error((err as Error).message ?? 'Could not invite');
    }
  }
}
