import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ChatService } from '../../../core/services/chat.service';
import { SignalingService } from '../../../core/services/signaling.service';
import { WebrtcService } from '../../../core/services/webrtc.service';
import { ToastService } from '../../../core/services/toast.service';
import { SrcObjectDirective } from '../../directives/src-object.directive';
import { PresenceAvatarComponent, PresenceDotComponent } from '../presence-avatar/presence-avatar.component';

interface DirectoryUser {
  id: string;          // Supabase sub (== AuthId)
  displayName: string;
  email: string;
  isActive: boolean;
}

/**
 * Global call overlay — mounted once in the shell. New design (ND-PATTERN,
 * owner 2026-09-27): neutral cards + neutral initials avatars, a violet dot
 * on a neutral status chip, violet only for Answer / Send, solid danger red
 * only for Decline / Cancel / End (no glows), Noto tabular numbers.
 *
 * - Incoming: caller name + avatar, "Incoming audio call", Decline · Answer.
 * - Outgoing: the CALLEE's name + initials (was "Calling" / "C"), "Ringing…"
 *   with a gentle pulse ring, Cancel.
 * - In call: status chip "On call · 00:27", Direct/Group, participant tiles
 *   (full name, quiet "You", neutral muted chip), 56px round controls
 *   (mute = filled neutral dark chip when ON), in-call chat, add participant.
 * - Minimised pill: bottom-right capsule. Phones: full-screen sheets.
 *
 * The overlay reads everything from `WebrtcService` signals — no @Input
 * plumbing needed. Audio playback uses a hidden `<audio>` per remote peer.
 */
@Component({
  selector: 'pf-call-overlay',
  standalone: true,
  imports: [SrcObjectDirective, DatePipe, PresenceAvatarComponent, PresenceDotComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Hidden audio sinks for each remote peer's stream. The SrcObjectDirective
         (selector "audio[srcObject]") intercepts the [srcObject] binding in
         the directive lifecycle — after the element is in the DOM — and
         calls .play() explicitly (Safari ignored a raw property binding). -->
    @for (entry of audioEntries(); track entry.userId) {
      <audio [srcObject]="entry.stream" autoplay playsinline></audio>
    }

    <!-- ── INCOMING ───────────────────────────────────────────────────── -->
    @if (webrtc.incomingCall(); as ic) {
      <div class="pf-call-ring pf-modal-centered" role="dialog" aria-modal="true" aria-label="Incoming call">
        <div class="pf-call-ring__backdrop"></div>
        <div class="pf-call-ring__card pf-modal-centered" data-testid="call-incoming">
          <p class="pf-call-ring__eyebrow">{{ ic.isGroup ? 'Group call' : 'Audio call' }}</p>
          <div class="pf-call-ring__avatar-wrap">
            <span class="pf-call-ring__pulse" aria-hidden="true"></span>
            <span class="pf-call-ring__pulse pf-call-ring__pulse--late" aria-hidden="true"></span>
            <span class="pf-call-avatar pf-call-avatar--xl" aria-hidden="true">
              {{ initials(ic.isGroup ? (ic.conversationName ?? 'Group') : ic.callerName) }}
            </span>
            @if (!ic.isGroup) { <pf-presence-dot [userId]="ic.callerId" /> }
          </div>
          <h2 class="pf-call-ring__name">{{ ic.isGroup ? (ic.conversationName ?? 'Group call') : ic.callerName }}</h2>
          <p class="pf-call-ring__sub">
            @if (ic.isGroup) { {{ ic.callerName }} is calling }
            @else if (ic.source) { {{ sourceLabel(ic.source) }} }
            @else { Incoming audio call }
          </p>
          <div class="pf-call-ring__actions">
            <div class="pf-call-ctl">
              <button type="button" class="pf-call-round pf-call-round--lg pf-call-round--danger"
                      (click)="reject()" aria-label="Decline" data-testid="call-decline">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path [attr.d]="PHONE" transform="rotate(135 12 12)"/>
                </svg>
              </button>
              <span class="pf-call-ctl__lbl">Decline</span>
            </div>
            <div class="pf-call-ctl">
              <button type="button" class="pf-call-round pf-call-round--lg pf-call-round--primary"
                      (click)="accept()" aria-label="Answer" data-testid="call-answer">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path [attr.d]="PHONE"/>
                </svg>
              </button>
              <span class="pf-call-ctl__lbl">Answer</span>
            </div>
          </div>
        </div>
      </div>
    }

    <!-- ── OUTGOING ───────────────────────────────────────────────────── -->
    @if (webrtc.status() === 'outgoing' && !webrtc.incomingCall()) {
      <div class="pf-call-ring pf-call-ring--outgoing pf-modal-centered" role="dialog" aria-modal="true"
           [attr.aria-label]="'Calling ' + outgoingName()">
        <div class="pf-call-ring__backdrop"></div>
        <div class="pf-call-ring__card pf-modal-centered" data-testid="call-outgoing">
          <p class="pf-call-ring__eyebrow">{{ webrtc.outgoingPeer()?.isGroup ? 'Group call' : 'Audio call' }}</p>
          <div class="pf-call-ring__avatar-wrap">
            <span class="pf-call-ring__pulse" aria-hidden="true"></span>
            <span class="pf-call-ring__pulse pf-call-ring__pulse--late" aria-hidden="true"></span>
            <span class="pf-call-avatar pf-call-avatar--xl" aria-hidden="true">{{ initials(outgoingName()) }}</span>
            @if (webrtc.outgoingPeer(); as op) { @if (!op.isGroup) { <pf-presence-dot [userId]="op.id" /> } }
          </div>
          <h2 class="pf-call-ring__name" data-testid="call-outgoing-name">{{ outgoingName() }}</h2>
          <p class="pf-call-ring__sub" aria-live="polite">Ringing…</p>
          <div class="pf-call-ring__actions">
            <div class="pf-call-ctl">
              <button type="button" class="pf-call-round pf-call-round--lg pf-call-round--danger"
                      (click)="cancelOutgoing()" aria-label="Cancel call" data-testid="call-cancel">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path [attr.d]="PHONE" transform="rotate(135 12 12)"/>
                </svg>
              </button>
              <span class="pf-call-ctl__lbl">Cancel</span>
            </div>
          </div>
        </div>
      </div>
    }

    <!-- ── IN CALL (expanded) ─────────────────────────────────────────── -->
    @if (showInCallPanel() && callExpanded()) {
      <div class="pf-call-screen pf-modal-centered" role="dialog" aria-modal="true" aria-label="Active call">
        <div class="pf-call-screen__backdrop"></div>
        <div class="pf-call-screen__card pf-modal-centered" data-testid="call-screen"
             [class.pf-call-screen__card--with-chat]="chatPanelOpen()">
          <header class="pf-call-screen__hdr">
            <button type="button" class="pf-call-icon" (click)="minimise()" aria-label="Minimise call" title="Minimise">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="pf-call-screen__hdr-info">
              <span class="pf-call-chip" data-testid="call-status">
                <span class="pf-call-chip__dot" [class.pf-call-chip__dot--pulse]="webrtc.status() !== 'active'" aria-hidden="true"></span>
                @if (webrtc.status() === 'active') {
                  On call · <span class="pf-call-num" data-testid="call-timer">{{ duration() }}</span>
                } @else { Connecting… }
              </span>
              <span class="pf-call-chip pf-call-chip--quiet">{{ isGroupCall() ? 'Group' : 'Direct' }}</span>
              @if (webrtc.status() === 'active' && webrtc.usingTurnRelay()) {
                <span class="pf-call-chip pf-call-chip--quiet" title="Relayed via TURN server">Relay</span>
              }
              @if (showRemaining()) {
                <span class="pf-call-chip pf-call-chip--quiet pf-call-num" [class.pf-call-chip--urgent]="remainingUrgent()"
                      title="Call auto-ends at this point">{{ remainingLabel() }}</span>
              }
            </div>
            <button type="button" class="pf-call-icon" (click)="toggleChatPanel()"
                    [attr.aria-pressed]="chatPanelOpen()" aria-label="In-call chat" title="In-call chat">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </button>
          </header>

          @if (webrtc.callError(); as err) {
            <div class="pf-call-screen__error" role="alert">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span>{{ err }}</span>
            </div>
          }

          <div class="pf-call-screen__body">
            <div class="pf-call-screen__participants" [attr.data-count]="participants().length">
              @for (p of participants(); track p.id) {
                <div class="pf-call-tile" data-testid="call-tile">
                  <pf-presence-avatar size="lg" [name]="p.name" [userId]="p.id" />
                  <p class="pf-call-tile__name">{{ p.name }}</p>
                  <p class="pf-call-tile__meta">
                    @if (p.isMe) { <span class="pf-call-tile__you">You</span> }
                    @if (p.muted) {
                      <span class="pf-call-chip pf-call-chip--quiet pf-call-chip--sm" data-testid="call-muted-chip">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <line x1="1" y1="1" x2="23" y2="23"/>
                          <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
                          <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
                        </svg>
                        Muted
                      </span>
                    } @else if (!p.isMe) {
                      <span class="pf-call-tile__quiet">Connected</span>
                    }
                  </p>
                </div>
              }
            </div>

            @if (chatPanelOpen()) {
              <aside class="pf-call-chat" aria-label="In-call chat">
                <header class="pf-call-chat__hdr">
                  <span class="pf-call-chat__title">Chat</span>
                  <button type="button" class="pf-call-icon pf-call-icon--sm" (click)="toggleChatPanel()" aria-label="Close chat">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </header>
                <div class="pf-call-chat__scroller">
                  @if (chat.activeMessages().length === 0) {
                    <p class="pf-call-chat__empty">No messages yet — say something during the call.</p>
                  }
                  @for (m of chat.activeMessages(); track m.id) {
                    <div class="pf-call-chat__row" [class.pf-call-chat__row--mine]="m.fromUserId === meAuthId()">
                      <div class="pf-call-chat__bubble" [class.pf-call-chat__bubble--mine]="m.fromUserId === meAuthId()">
                        <div class="pf-call-chat__body">{{ m.body }}</div>
                        <div class="pf-call-chat__time pf-call-num">{{ m.sentAt | date:'shortTime' }}</div>
                      </div>
                    </div>
                  }
                </div>
                <div class="pf-call-chat__composer">
                  <input type="text" class="pf-call-chat__input" placeholder="Type a message" aria-label="Message"
                         [value]="chatDraft()" (input)="chatDraft.set($any($event.target).value)" (keydown)="onChatKeyDown($event)">
                  <button type="button" class="pf-call-round pf-call-round--sm pf-call-round--primary"
                          (click)="sendInCallMessage()" [disabled]="!chatDraft().trim()" aria-label="Send">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                    </svg>
                  </button>
                </div>
              </aside>
            }
          </div>

          <footer class="pf-call-screen__ctrls">
            <div class="pf-call-ctl">
              <button type="button" class="pf-call-round" (click)="toggleMute()" data-testid="call-mute"
                      [attr.aria-pressed]="webrtc.micMuted()" [attr.aria-label]="webrtc.micMuted() ? 'Unmute' : 'Mute'">
                @if (webrtc.micMuted()) {
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <line x1="1" y1="1" x2="23" y2="23"/>
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
                    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
                    <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
                  </svg>
                } @else {
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
                  </svg>
                }
              </button>
              <span class="pf-call-ctl__lbl">{{ webrtc.micMuted() ? 'Unmute' : 'Mute' }}</span>
            </div>
            <div class="pf-call-ctl">
              <button type="button" class="pf-call-round" (click)="toggleInvite()"
                      [attr.aria-pressed]="invitePopoverOpen()" aria-label="Add participant">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/>
                  <line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>
                </svg>
              </button>
              <span class="pf-call-ctl__lbl">Add</span>
            </div>
            <div class="pf-call-ctl">
              <button type="button" class="pf-call-round" (click)="toggleChatPanel()"
                      [attr.aria-pressed]="chatPanelOpen()" aria-label="Chat">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </button>
              <span class="pf-call-ctl__lbl">Chat</span>
            </div>
            <div class="pf-call-ctl">
              <button type="button" class="pf-call-round pf-call-round--danger" (click)="leave()"
                      aria-label="End call" data-testid="call-end">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path [attr.d]="PHONE" transform="rotate(135 12 12)"/>
                </svg>
              </button>
              <span class="pf-call-ctl__lbl">End</span>
            </div>
          </footer>

          @if (invitePopoverOpen()) {
            <div class="pf-call-invite pf-call-invite--screen" role="dialog" aria-label="Invite to call"
                 (click)="$event.stopPropagation()">
              <header class="pf-call-invite__hdr">
                <span class="pf-call-invite__title">Invite to call</span>
                <span class="pf-call-invite__count pf-call-num">{{ availableToInvite().length }} online</span>
              </header>
              @if (loadingInvite()) {
                <p class="pf-call-invite__empty">Loading…</p>
              } @else if (availableToInvite().length === 0) {
                <p class="pf-call-invite__empty">No one else is online right now.</p>
              } @else {
                <ul class="pf-call-invite__list" role="listbox">
                  @for (u of availableToInvite(); track u.id) {
                    <li>
                      <button type="button" class="pf-call-invite__item" (click)="inviteUser(u)">
                        <pf-presence-avatar size="sm" [name]="u.displayName" [userId]="u.id" />
                        <span class="pf-call-invite__name">{{ u.displayName }}</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
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

    <!-- ── IN CALL (minimised pill) ───────────────────────────────────── -->
    @if (showInCallPanel() && !callExpanded()) {
      <div class="pf-call-pill" role="region" aria-label="Active call" data-testid="call-pill">
        <span class="pf-call-avatar pf-call-avatar--sm" aria-hidden="true">{{ initials(pillTitle()) }}</span>
        <div class="pf-call-pill__meta">
          <span class="pf-call-pill__label">{{ pillTitle() }}</span>
          <span class="pf-call-pill__status">
            <span class="pf-call-chip__dot" [class.pf-call-chip__dot--pulse]="webrtc.status() !== 'active'" aria-hidden="true"></span>
            @if (webrtc.status() === 'active') { <span class="pf-call-num">{{ duration() }}</span> } @else { Connecting… }
            @if (showRemaining()) {
              <span class="pf-call-num pf-call-pill__remaining" [class.pf-call-chip--urgent]="remainingUrgent()"
                    title="Call auto-ends at this point — 10-minute cap on 1:1, 30-minute on group">· {{ remainingLabel() }}</span>
            }
          </span>
        </div>
        <button type="button" class="pf-call-icon" (click)="expand()" aria-label="Open full call screen" title="Expand">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M14 10l7-7M9 21H3v-6M10 14l-7 7"/></svg>
        </button>
        <button type="button" class="pf-call-icon" (click)="toggleMute()"
                [attr.aria-pressed]="webrtc.micMuted()" [attr.aria-label]="webrtc.micMuted() ? 'Unmute' : 'Mute'">
          @if (webrtc.micMuted()) {
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="1" y1="1" x2="23" y2="23"/>
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
              <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          } @else {
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          }
        </button>
        <button type="button" class="pf-call-icon pf-call-pill__add" (click)="toggleInvite()"
                [attr.aria-pressed]="invitePopoverOpen()" aria-label="Add participant" title="Add participant">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/>
            <line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>
          </svg>
        </button>
        <button type="button" class="pf-call-round pf-call-round--sm pf-call-round--danger" (click)="leave()" aria-label="End call">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path [attr.d]="PHONE" transform="rotate(135 12 12)"/>
          </svg>
        </button>

        @if (invitePopoverOpen()) {
          <div class="pf-call-invite" role="dialog" aria-label="Invite to call" (click)="$event.stopPropagation()">
            <header class="pf-call-invite__hdr">
              <span class="pf-call-invite__title">Invite to call</span>
              <span class="pf-call-invite__count pf-call-num">{{ availableToInvite().length }} online</span>
            </header>
            @if (loadingInvite()) {
              <p class="pf-call-invite__empty">Loading…</p>
            } @else if (availableToInvite().length === 0) {
              <p class="pf-call-invite__empty">No one else is online right now.</p>
            } @else {
              <ul class="pf-call-invite__list" role="listbox">
                @for (u of availableToInvite(); track u.id) {
                  <li>
                    <button type="button" class="pf-call-invite__item" (click)="inviteUser(u)">
                      <pf-presence-avatar size="sm" [name]="u.displayName" [userId]="u.id" />
                      <span class="pf-call-invite__name">{{ u.displayName }}</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                    </button>
                  </li>
                }
              </ul>
            }
          </div>
        }
      </div>
    }
  `,
  styles: [`
    /* Call overlay — NEW DESIGN (docs/ND-PATTERN.md; owner 2026-09-27).
       Palette only: neutral cards, the app's neutral initials avatar, a
       violet dot on the status chip, violet primary ONLY for Answer / Send,
       and the kit's danger red ONLY for Decline / Cancel / End (solid — the
       universal hang-up — but no glow). Noto Sans with tabular numbers (the
       timer too; never monospace). Round controls get a CIRCULAR
       :focus-visible ring; labels sit outside the button so the ring never
       wraps button + label. Phones: full-screen sheets with safe areas,
       44px+ targets. Reduced motion: nothing pulses. */
    :host {
      display: contents;
      /* Text red follows the theme; the SOLID hang-up fill stays a strong
         red in both themes (the dark-theme text red is too pale for a fill
         under a white glyph). */
      --call-danger: var(--red-text, #dc2626);
      --call-danger-fill: #dc2626;
      --call-danger-hover: #b91c1c;
      --call-primary: var(--gradient-primary, linear-gradient(90deg, #7c3aed, #c026d3));
      --call-violet: var(--color-primary, #7c3aed);
      --call-font: 'Noto Sans', var(--font-sans, system-ui), sans-serif;
    }
    .pf-call-num { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum' 1; }

    /* ── Shared atoms ────────────────────────────────────────────────── */
    .pf-call-avatar {
      display: inline-flex; align-items: center; justify-content: center; flex: none;
      border-radius: 9999px;
      background: var(--nd-chip-bg, #f3f4f6);
      border: 1px solid var(--nd-line, var(--border-muted, #e5e7eb));
      color: var(--text-secondary);
      font-family: var(--call-font); font-weight: 600; letter-spacing: 0;
    }
    .pf-call-avatar--sm { width: 36px; height: 36px; font-size: 13px; }
    .pf-call-avatar--lg { width: 64px; height: 64px; font-size: 20px; }
    .pf-call-avatar--xl { width: 88px; height: 88px; font-size: 28px; position: relative; z-index: 1; }

    .pf-call-chip {
      display: inline-flex; align-items: center; gap: 6px;
      height: 28px; padding: 0 10px; border-radius: 9999px;
      background: var(--nd-chip-bg, #f3f4f6); color: var(--text-primary);
      font-family: var(--call-font); font-size: 13px; font-weight: 500; white-space: nowrap;
    }
    .pf-call-chip--quiet { color: var(--text-secondary); font-weight: 500; }
    .pf-call-chip--sm { height: 22px; padding: 0 8px; font-size: 12px; gap: 4px; }
    .pf-call-chip--urgent { color: var(--call-danger); }
    .pf-call-chip__dot { width: 7px; height: 7px; border-radius: 9999px; background: var(--call-violet); flex: none; }
    .pf-call-chip__dot--pulse { animation: pf-call-blink 1.4s ease-in-out infinite; }
    @keyframes pf-call-blink { 50% { opacity: 0.35; } }

    /* 40px quiet icon button (header / pill). */
    .pf-call-icon {
      display: inline-flex; align-items: center; justify-content: center; flex: none;
      width: 40px; height: 40px; border-radius: 9999px;
      background: transparent; border: 1px solid transparent; color: var(--text-secondary);
      cursor: pointer; transition: background-color var(--nd-dur-fast, 200ms) ease, color var(--nd-dur-fast, 200ms) ease;
    }
    .pf-call-icon:hover { background: var(--nd-chip-bg, #f3f4f6); color: var(--text-primary); }
    /* ON (muted mic / open panel): the same filled neutral dark chip as the
       56px controls. */
    .pf-call-icon[aria-pressed='true'] {
      background: var(--text-primary, #111827); border-color: var(--text-primary, #111827); color: var(--nd-card-bg, #fff);
    }
    .pf-call-icon--sm { width: 32px; height: 32px; }

    /* 56px round control — neutral secondary by default. */
    .pf-call-round {
      display: inline-flex; align-items: center; justify-content: center; flex: none;
      width: 56px; height: 56px; border-radius: 9999px;
      background: var(--nd-card-bg, #fff); border: 1px solid var(--nd-line, #e5e7eb);
      color: var(--text-primary); cursor: pointer;
      box-shadow: var(--nd-shadow-sm);
      transition: background-color var(--nd-dur-fast, 200ms) ease, transform 120ms ease;
    }
    .pf-call-round:hover:not(:disabled) { background: var(--nd-chip-bg, #f3f4f6); }
    .pf-call-round:active:not(:disabled) { transform: scale(0.96); }
    .pf-call-round:disabled { opacity: 0.45; cursor: not-allowed; }
    /* ON state (muted mic, open panel): a filled neutral dark chip. */
    .pf-call-round[aria-pressed='true'] {
      background: var(--text-primary, #111827); border-color: var(--text-primary, #111827);
      color: var(--nd-card-bg, #fff);
    }
    .pf-call-round--lg { width: 64px; height: 64px; }
    .pf-call-round--sm { width: 40px; height: 40px; box-shadow: none; }
    .pf-call-round--danger { background: var(--call-danger-fill); border-color: var(--call-danger-fill); color: #fff; }
    .pf-call-round--danger:hover:not(:disabled) { background: var(--call-danger-hover); }
    .pf-call-round--primary { background: var(--call-primary); border-color: transparent; color: #fff; }
    .pf-call-round--primary:hover:not(:disabled) { background: var(--call-primary); filter: brightness(1.05); }
    /* Circular focus ring on the round button itself. */
    .pf-call-round:focus-visible, .pf-call-icon:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px var(--nd-card-bg, #fff), 0 0 0 5px var(--call-violet);
    }

    .pf-call-ctl { display: flex; flex-direction: column; align-items: center; gap: 8px; min-width: 64px; }
    .pf-call-ctl__lbl { font-family: var(--call-font); font-size: 12.5px; font-weight: 500; color: var(--text-secondary); }

    /* ── Ring card (incoming + outgoing) ─────────────────────────────── */
    .pf-call-ring {
      position: fixed; inset: 0; z-index: 80;
      display: flex; align-items: center; justify-content: center; padding: 16px;
      font-family: var(--call-font);
    }
    .pf-call-ring__backdrop, .pf-call-screen__backdrop {
      position: absolute; inset: 0;
      background: rgba(15, 23, 42, 0.42);
      backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
    }
    .pf-call-ring__card {
      position: relative; width: min(360px, 100%);
      display: flex; flex-direction: column; align-items: center; text-align: center;
      padding: 28px 24px 28px;
      background: var(--nd-card-bg, #fff); border: 1px solid var(--nd-line, #e5e7eb);
      border-radius: var(--nd-radius-card, 16px);
      box-shadow: var(--nd-shadow-sm), 0 24px 60px rgba(15, 23, 42, 0.18);
      animation: pf-call-rise var(--nd-dur, 320ms) var(--nd-spring, cubic-bezier(0.32, 0.72, 0, 1)) both;
    }
    @keyframes pf-call-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
    .pf-call-ring__eyebrow { margin: 0 0 20px; font-size: 13px; font-weight: 500; color: var(--text-muted); }
    .pf-call-ring__avatar-wrap {
      position: relative; width: 88px; height: 88px; margin-bottom: 18px;
      display: flex; align-items: center; justify-content: center;
      --pf-pdot-size: 18px; --pf-pdot-ring: var(--nd-card-bg, #fff);
    }
    .pf-call-ring__avatar-wrap pf-presence-dot { right: 3px; bottom: 3px; z-index: 2; }
    /* Gentle pulse ring (violet hairline) — no glow. */
    .pf-call-ring__pulse {
      position: absolute; inset: 0; border-radius: 9999px;
      border: 2px solid color-mix(in srgb, var(--call-violet) 45%, transparent);
      animation: pf-call-pulse 2.4s var(--nd-spring, ease-out) infinite;
    }
    .pf-call-ring__pulse--late { animation-delay: 1.2s; }
    @keyframes pf-call-pulse { from { opacity: 0.9; transform: scale(1); } to { opacity: 0; transform: scale(1.45); } }
    .pf-call-ring__name {
      margin: 0; font-size: 20px; font-weight: 600; line-height: 1.3; color: var(--text-primary);
      overflow-wrap: anywhere;
    }
    .pf-call-ring__sub { margin: 6px 0 0; font-size: 14px; color: var(--text-secondary); }
    .pf-call-ring__actions { display: flex; justify-content: center; gap: 56px; margin-top: 28px; }

    /* ── In-call screen ──────────────────────────────────────────────── */
    .pf-call-screen {
      position: fixed; inset: 0; z-index: 75;
      display: flex; align-items: center; justify-content: center; padding: 16px;
      font-family: var(--call-font);
    }
    .pf-call-screen__card {
      position: relative; width: min(560px, 100%); max-height: calc(100dvh - 32px);
      display: flex; flex-direction: column;
      background: var(--nd-card-bg, #fff); border: 1px solid var(--nd-line, #e5e7eb);
      border-radius: var(--nd-radius-card, 16px);
      box-shadow: var(--nd-shadow-sm), 0 24px 60px rgba(15, 23, 42, 0.18);
      animation: pf-call-rise var(--nd-dur, 320ms) var(--nd-spring, cubic-bezier(0.32, 0.72, 0, 1)) both;
    }
    .pf-call-screen__card--with-chat { width: min(900px, 100%); }
    .pf-call-screen__hdr {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 12px 12px 12px; border-bottom: 1px solid var(--nd-line, #e5e7eb);
    }
    .pf-call-screen__hdr-info { flex: 1; min-width: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
    .pf-call-screen__error {
      display: flex; align-items: center; gap: 8px; margin: 12px 16px 0;
      padding: 8px 12px; border-radius: var(--nd-radius-sm, 10px);
      background: color-mix(in srgb, var(--call-danger) 8%, var(--nd-card-bg, #fff));
      color: var(--call-danger); font-size: 13px;
    }
    .pf-call-screen__body { flex: 1; min-height: 0; display: flex; }
    .pf-call-screen__participants {
      flex: 1; min-width: 0; overflow-y: auto;
      display: grid; gap: 12px; padding: 20px;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      align-content: center;
    }
    .pf-call-tile {
      --pf-pdot-ring: var(--nd-chip-bg, #f3f4f6);
      display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center;
      padding: 22px 14px 18px; border-radius: var(--nd-radius, 12px);
      background: var(--nd-chip-bg, #f3f4f6);
    }
    .pf-call-tile__name { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.3; color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-call-tile__meta { margin: 0; display: flex; align-items: center; gap: 6px; min-height: 22px; }
    .pf-call-tile__you, .pf-call-tile__quiet { font-size: 12.5px; color: var(--text-muted); }
    .pf-call-tile .pf-call-chip--sm { background: var(--nd-card-bg, #fff); border: 1px solid var(--nd-line, #e5e7eb); }

    .pf-call-screen__ctrls {
      display: flex; justify-content: center; gap: 20px; flex-wrap: wrap;
      padding: 16px 16px 20px; border-top: 1px solid var(--nd-line, #e5e7eb);
    }

    /* In-call chat (right column). */
    .pf-call-chat {
      width: 320px; flex: none; display: flex; flex-direction: column; min-height: 320px;
      border-left: 1px solid var(--nd-line, #e5e7eb);
    }
    .pf-call-chat__hdr { display: flex; align-items: center; justify-content: space-between; padding: 10px 10px 10px 14px; }
    .pf-call-chat__title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .pf-call-chat__scroller { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 12px 12px; display: flex; flex-direction: column; gap: 6px; }
    .pf-call-chat__empty { margin: auto; font-size: 12.5px; color: var(--text-muted); text-align: center; }
    .pf-call-chat__row { display: flex; }
    .pf-call-chat__row--mine { justify-content: flex-end; }
    .pf-call-chat__bubble {
      max-width: 85%; padding: 7px 10px; border-radius: 12px;
      background: var(--nd-chip-bg, #f3f4f6); color: var(--text-primary); font-size: 13px;
    }
    .pf-call-chat__bubble--mine { background: var(--nd-in-tint, #f5f3ff); }
    .pf-call-chat__body { white-space: pre-wrap; overflow-wrap: anywhere; }
    .pf-call-chat__time { margin-top: 2px; font-size: 11px; color: var(--text-muted); text-align: right; }
    .pf-call-chat__composer { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--nd-line, #e5e7eb); }
    .pf-call-chat__input {
      flex: 1; min-width: 0; height: 40px; padding: 0 12px;
      border: 1px solid var(--nd-line, #e5e7eb); border-radius: var(--nd-radius-sm, 10px);
      background: var(--nd-card-bg, #fff); color: var(--text-primary); font: inherit; font-size: 14px;
    }
    .pf-call-chat__input:focus-visible { outline: 2px solid var(--call-violet); outline-offset: 0; }

    /* Invite list (screen + pill). */
    .pf-call-invite {
      position: absolute; right: 0; bottom: calc(100% + 8px); z-index: 2;
      width: 280px; max-height: 320px; display: flex; flex-direction: column;
      background: var(--nd-card-bg, #fff); border: 1px solid var(--nd-line, #e5e7eb);
      border-radius: var(--nd-radius, 12px); box-shadow: var(--nd-shadow-sm), 0 16px 40px rgba(15, 23, 42, 0.16);
      overflow: hidden;
    }
    .pf-call-invite--screen { left: 50%; right: auto; transform: translateX(-50%); bottom: 96px; }
    .pf-call-invite__hdr { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--nd-line, #e5e7eb); }
    .pf-call-invite__title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .pf-call-invite__count { font-size: 12px; color: var(--text-muted); }
    .pf-call-invite__empty { margin: 0; padding: 16px 14px; font-size: 13px; color: var(--text-muted); }
    .pf-call-invite__list { list-style: none; margin: 0; padding: 6px; overflow-y: auto; }
    .pf-call-invite__item {
      width: 100%; display: flex; align-items: center; gap: 10px; min-height: 48px;
      padding: 6px 8px; border: 0; border-radius: var(--nd-radius-sm, 10px);
      background: transparent; color: var(--text-secondary); cursor: pointer; text-align: left; font: inherit;
    }
    .pf-call-invite__item:hover { background: var(--nd-chip-bg, #f3f4f6); color: var(--text-primary); }
    .pf-call-invite__item:focus-visible { outline: 2px solid var(--call-violet); outline-offset: -2px; }
    .pf-call-invite__name { flex: 1; min-width: 0; font-size: 14px; color: var(--text-primary); overflow-wrap: anywhere; }

    /* ── Minimised pill ──────────────────────────────────────────────── */
    .pf-call-pill {
      position: fixed; z-index: 70;
      right: 16px; bottom: calc(var(--pf-botbar-h, 0px) + 16px + env(safe-area-inset-bottom, 0px));
      display: flex; align-items: center; gap: 6px;
      padding: 6px 6px 6px 8px; border-radius: 9999px;
      background: var(--nd-card-bg, #fff); border: 1px solid var(--nd-line, #e5e7eb);
      box-shadow: var(--nd-shadow-sm), 0 12px 32px rgba(15, 23, 42, 0.14);
      font-family: var(--call-font);
    }
    .pf-call-pill__meta { display: flex; flex-direction: column; min-width: 0; max-width: 180px; margin: 0 6px 0 4px; }
    .pf-call-pill__label { font-size: 13.5px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pf-call-pill__status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); }

    /* ── Phones: full-screen sheets, safe areas, 44px+ targets ───────── */
    @media (max-width: 640px) {
      .pf-call-ring, .pf-call-screen { padding: 0; }
      .pf-call-ring__card, .pf-call-screen__card, .pf-call-screen__card--with-chat {
        width: 100%; height: 100dvh; max-height: none; border-radius: 0; border: 0;
        padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px);
      }
      .pf-call-ring__card { justify-content: center; padding-left: 24px; padding-right: 24px; }
      .pf-call-ring__actions { gap: 72px; margin-top: 48px; }
      .pf-call-screen__hdr { padding-left: 8px; padding-right: 8px; }
      .pf-call-icon { width: 44px; height: 44px; }
      .pf-call-screen__participants { grid-template-columns: 1fr 1fr; padding: 16px; }
      .pf-call-screen__body { flex-direction: column; }
      .pf-call-chat { width: auto; border-left: 0; border-top: 1px solid var(--nd-line, #e5e7eb); flex: 1; }
      .pf-call-screen__card--with-chat .pf-call-screen__participants { display: none; }
      .pf-call-screen__ctrls { gap: 14px; padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px)); }
      .pf-call-pill { left: 12px; right: 12px; }
      .pf-call-pill__meta { flex: 1; max-width: none; }
      .pf-call-invite, .pf-call-invite--screen { left: 12px; right: 12px; width: auto; transform: none; }
    }
    @media (max-width: 380px) {
      .pf-call-pill__add { display: none; }
    }

    @media (prefers-reduced-motion: reduce) {
      .pf-call-ring__card, .pf-call-screen__card { animation: none; }
      .pf-call-ring__pulse { animation: none; opacity: 0.5; transform: scale(1.12); }
      .pf-call-ring__pulse--late { display: none; }
      .pf-call-chip__dot--pulse { animation: none; }
      .pf-call-round, .pf-call-icon { transition: none; }
    }
  `]
})
export class CallOverlayComponent {
  /** Handset glyph (rotated 135° for hang-up). */
  protected readonly PHONE = 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z';

  protected readonly webrtc = inject(WebrtcService);
  protected readonly chat = inject(ChatService);
  private readonly toast = inject(ToastService);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly signaling = inject(SignalingService);

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

  /** Callee (or group) shown on the outgoing card — never the placeholder
   *  "Calling". Falls back to a neutral "Colleague" only while the name is
   *  still being looked up. */
  protected readonly outgoingName = computed(() => this.webrtc.outgoingPeer()?.name || 'Colleague');

  /** Direct (1:1) vs Group, for the header chip. */
  protected readonly isGroupCall = computed(() =>
    !!this.webrtc.incomingCall()?.isGroup || !!this.webrtc.outgoingPeer()?.isGroup
    || this.webrtc.remoteParticipants().length > 1);

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
    this.webrtc.usingTurnRelay() ? '● Relay' : '● Direct');
  protected readonly routeTitle = computed(() =>
    this.webrtc.usingTurnRelay()
      ? 'Relayed via TURN server'
      : 'Direct peer-to-peer connection');

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

    // Audio cues (ringtone / ringback) are owned by the root CallRingService
    // — an effect here died with the shell and left rings looping.

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
