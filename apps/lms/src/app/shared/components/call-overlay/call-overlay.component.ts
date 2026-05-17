import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { RingtoneService } from '../../../core/services/ringtone.service';
import { SignalingService } from '../../../core/services/signaling.service';
import { WebrtcService } from '../../../core/services/webrtc.service';
import { ToastService } from '../../../core/services/toast.service';

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
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Hidden audio sinks for each remote peer's stream. data-remote-call
         is the discovery marker for the effect that programmatically sets
         srcObject + calls .play() — see the effect in the constructor for
         why we don't rely on Angular's [srcObject] binding. -->
    @for (entry of audioEntries(); track entry.userId) {
      <audio data-remote-call="1"
             [attr.data-user]="entry.userId"
             autoplay
             playsinline></audio>
    }

    @if (webrtc.incomingCall(); as ic) {
      <div class="pf-call-ring" role="dialog" aria-modal="true" aria-label="Incoming call">
        <div class="pf-call-ring__backdrop"></div>
        <div class="pf-call-ring__card">
          <div class="pf-call-ring__avatar">{{ initials(ic.callerName) }}</div>
          <p class="pf-call-ring__eyebrow">Incoming {{ ic.callType }} call</p>
          <h2 class="pf-call-ring__name">{{ ic.callerName }}</h2>
          @if (ic.source) {
            <p class="pf-call-ring__source">{{ sourceLabel(ic.source) }}</p>
          }
          <div class="pf-call-ring__pulse" aria-hidden="true">
            <span></span><span></span><span></span>
          </div>
          <div class="pf-call-ring__actions">
            <button type="button" class="pf-call-ring__btn pf-call-ring__btn--reject"
                    (click)="reject()" aria-label="Decline">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15.5C21 16.6 19.8 17.7 17.5 17.7C12 17.7 7 12.7 7 7.2C7 4.9 8.1 3.7 9.2 3.7"
                      transform="rotate(135 12 12)"/>
              </svg>
              Decline
            </button>
            <button type="button" class="pf-call-ring__btn pf-call-ring__btn--accept"
                    (click)="accept()" aria-label="Accept">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/>
              </svg>
              Accept
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Full-screen call view (toggleable with the minimise button on the
         pill). Same controls as the pill but with caller avatars + much
         more breathing room. Click the minimise icon to return to the
         floating pill; click End to leave. -->
    @if (showInCallPanel() && callExpanded()) {
      <div class="pf-call-screen" role="dialog" aria-modal="true" aria-label="Active call">
        <div class="pf-call-screen__backdrop"></div>
        <div class="pf-call-screen__card">
          <header class="pf-call-screen__hdr">
            <button type="button" class="pf-call-screen__min press"
                    (click)="minimise()" aria-label="Minimise to floating pill">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 14h5v5M19 10h-5V5"/>
              </svg>
              Minimise
            </button>
            <span class="pf-call-screen__title">
              {{ webrtc.status() === 'active' ? 'On call' : 'Connecting…' }}
            </span>
            <span class="pf-call-screen__time">{{ duration() }}</span>
          </header>

          <div class="pf-call-screen__participants">
            @for (p of participants(); track p.id) {
              <div class="pf-call-screen__pcard">
                <div class="pf-call-screen__avatar">{{ initials(p.name) }}</div>
                <p class="pf-call-screen__pname">{{ p.name }}</p>
                <p class="pf-call-screen__pmeta">
                  @if (p.isMe) { you }
                  @else if (p.muted) { muted }
                  @else { speaking }
                </p>
              </div>
            }
          </div>

          <!-- Media-path billing tag — explicit on the full-screen view. -->
          <div class="pf-call-screen__route" [attr.data-cost]="routeCost()">
            <span class="pf-call-screen__route-dot"></span>
            <span>{{ routeLabel() }}</span>
          </div>

          <footer class="pf-call-screen__ctrls">
            <button type="button" class="pf-call-screen__ctrl"
                    [class.pf-call-screen__ctrl--on]="webrtc.micMuted()"
                    (click)="toggleMute()"
                    [attr.aria-label]="webrtc.micMuted() ? 'Unmute' : 'Mute'">
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
              <span class="pf-call-screen__ctrl-lbl">{{ webrtc.micMuted() ? 'Unmute' : 'Mute' }}</span>
            </button>
            <button type="button" class="pf-call-screen__ctrl"
                    (click)="toggleInvite()" aria-label="Add participant">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="8.5" cy="7" r="4"/>
                <line x1="20" y1="8" x2="20" y2="14"/>
                <line x1="23" y1="11" x2="17" y2="11"/>
              </svg>
              <span class="pf-call-screen__ctrl-lbl">Add</span>
            </button>
            <button type="button" class="pf-call-screen__ctrl pf-call-screen__ctrl--end"
                    (click)="leave()" aria-label="End call">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"
                        transform="rotate(135 12 12)"/>
              </svg>
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
        <div class="pf-call-pill__dot" [class.pf-call-pill__dot--muted]="webrtc.micMuted()"></div>
        <div class="pf-call-pill__meta">
          <span class="pf-call-pill__label">{{ webrtc.status() === 'active' ? 'On call' : 'Connecting…' }}</span>
          <span class="pf-call-pill__time">{{ duration() }}</span>
        </div>
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
        <div class="pf-call-pill__dot pf-call-pill__dot--ring"></div>
        <div class="pf-call-pill__meta">
          <span class="pf-call-pill__label">Ringing…</span>
          <span class="pf-call-pill__time">{{ webrtc.localCallerName() ?? 'Calling' }}</span>
        </div>
        <button type="button" class="pf-call-pill__btn pf-call-pill__btn--end"
                (click)="cancelOutgoing()" aria-label="Cancel call">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6 6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }

    /* ── Incoming-call full-screen ringer ────────────────────────── */
    .pf-call-ring { position: fixed; inset: 0; z-index: 100;
      display: flex; align-items: center; justify-content: center; padding: 16px; }
    .pf-call-ring__backdrop { position: absolute; inset: 0;
      background: rgba(8, 8, 20, 0.78); backdrop-filter: blur(10px); }
    .pf-call-ring__card { position: relative; width: 100%; max-width: 360px;
      padding: 32px 28px 24px; border-radius: 24px;
      background: linear-gradient(180deg, rgba(20,20,40,0.95), rgba(8,8,20,0.95));
      border: 1px solid rgba(168, 85, 247, 0.32);
      box-shadow: 0 20px 60px rgba(168, 85, 247, 0.35), 0 0 0 1px rgba(255,255,255,0.05) inset;
      text-align: center; color: #fff;
      animation: pf-call-ring-in 0.25s cubic-bezier(0.16, 1, 0.3, 1); }
    @keyframes pf-call-ring-in {
      from { opacity: 0; transform: translateY(20px) scale(0.96); }
      to   { opacity: 1; transform: none; }
    }
    .pf-call-ring__avatar {
      width: 72px; height: 72px; border-radius: 50%;
      margin: 0 auto 20px;
      background: linear-gradient(135deg, #a78bfa, #ec4899);
      display: flex; align-items: center; justify-content: center;
      font-size: 26px; font-weight: 600; color: #fff;
      box-shadow: 0 0 30px rgba(168, 85, 247, 0.5);
    }
    .pf-call-ring__eyebrow { font-size: 10.5px; font-weight: 600;
      letter-spacing: 0.18em; text-transform: uppercase;
      color: rgba(255,255,255,0.55); margin: 0 0 6px; }
    .pf-call-ring__name { font-size: 22px; font-weight: 600; margin: 0;
      letter-spacing: -0.01em; }
    .pf-call-ring__source { font-size: 12px; color: rgba(255,255,255,0.55);
      margin: 4px 0 0; }
    .pf-call-ring__pulse {
      display: flex; gap: 6px; justify-content: center; margin: 24px 0 28px;
    }
    .pf-call-ring__pulse span {
      width: 8px; height: 8px; border-radius: 50%;
      background: #a78bfa;
      animation: pf-call-pulse 1.4s ease-in-out infinite;
    }
    .pf-call-ring__pulse span:nth-child(2) { animation-delay: 0.2s; }
    .pf-call-ring__pulse span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes pf-call-pulse {
      0%, 100% { opacity: 0.3; transform: scale(0.8); }
      50%      { opacity: 1;   transform: scale(1.3); box-shadow: 0 0 12px rgba(168, 85, 247, 0.9); }
    }
    .pf-call-ring__actions { display: flex; gap: 14px; justify-content: center; }
    .pf-call-ring__btn { display: inline-flex; align-items: center; gap: 8px;
      padding: 12px 22px; border-radius: 999px; border: none;
      font-size: 14px; font-weight: 600; cursor: pointer;
      transition: transform 80ms, box-shadow 150ms; }
    .pf-call-ring__btn:active { transform: scale(0.96); }
    .pf-call-ring__btn--reject { background: #ef4444; color: #fff;
      box-shadow: 0 6px 16px rgba(239, 68, 68, 0.4); }
    .pf-call-ring__btn--reject:hover { box-shadow: 0 8px 22px rgba(239, 68, 68, 0.55); }
    .pf-call-ring__btn--accept { background: #10b981; color: #fff;
      box-shadow: 0 6px 16px rgba(16, 185, 129, 0.4); }
    .pf-call-ring__btn--accept:hover { box-shadow: 0 8px 22px rgba(16, 185, 129, 0.55); }

    /* ── In-call floating pill ───────────────────────────────────── */
    .pf-call-pill { position: fixed; bottom: 88px; right: 16px; z-index: 60;
      display: inline-flex; align-items: center; gap: 10px;
      padding: 8px 8px 8px 14px;
      border-radius: 999px;
      background: rgba(8, 8, 20, 0.85); backdrop-filter: blur(10px);
      border: 1px solid rgba(255,255,255,0.10);
      box-shadow: 0 8px 28px rgba(0,0,0,0.4);
      color: #fff; font-size: 12.5px; line-height: 1.2;
      animation: pf-call-pill-in 0.18s ease-out; }
    @media (min-width: 1024px) { .pf-call-pill { bottom: 16px; } }
    @keyframes pf-call-pill-in {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: none; }
    }
    .pf-call-pill__dot { width: 8px; height: 8px; border-radius: 50%;
      background: #10b981; box-shadow: 0 0 8px #10b981;
      animation: pf-pill-blink 1.6s ease-in-out infinite; }
    .pf-call-pill__dot--muted { background: #94a3b8; box-shadow: none; animation: none; }
    .pf-call-pill__dot--ring  { background: #a78bfa; box-shadow: 0 0 8px #a78bfa; }
    @keyframes pf-pill-blink { 0%,100%{opacity:.6;} 50%{opacity:1;} }
    .pf-call-pill__meta { display: flex; flex-direction: column; gap: 1px; }
    .pf-call-pill__label { font-weight: 600; }
    .pf-call-pill__time { font-size: 11px; color: rgba(255,255,255,0.6);
      font-variant-numeric: tabular-nums;
      font-family: 'JetBrains Mono', ui-monospace, monospace; }
    .pf-call-pill__relay { color: #fbbf24; font-size: 13px; cursor: help; }
    .pf-call-pill__btn { width: 32px; height: 32px; border-radius: 50%;
      background: rgba(255,255,255,0.10); border: none; color: #fff;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; transition: background 120ms, transform 80ms; }
    .pf-call-pill__btn:hover { background: rgba(255,255,255,0.18); }
    .pf-call-pill__btn:active { transform: scale(0.92); }
    .pf-call-pill__btn--on { background: rgba(244, 63, 94, 0.25); color: #fb7185; }
    .pf-call-pill__btn--end { background: #ef4444; color: #fff; }
    .pf-call-pill__btn--end:hover { background: #dc2626; }
    .pf-call-pill__btn--add { background: rgba(168, 85, 247, 0.20); color: #c4b5fd; }
    .pf-call-pill__btn--add:hover { background: rgba(168, 85, 247, 0.35); }

    /* Route badge — Free (peer-to-peer) vs Paid (TURN-relayed) so the user
     * sees the cost implication at a glance. */
    .pf-call-pill__route {
      font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em;
      padding: 3px 8px; border-radius: 999px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      white-space: nowrap; cursor: help;
    }
    .pf-call-pill__route[data-cost='free'] {
      background: rgba(16, 185, 129, 0.18); color: #34d399;
    }
    .pf-call-pill__route[data-cost='paid'] {
      background: rgba(245, 158, 11, 0.22); color: #fbbf24;
    }

    /* ── Full-screen call view ────────────────────────────────── */
    .pf-call-screen { position: fixed; inset: 0; z-index: 90;
      display: flex; align-items: center; justify-content: center; padding: 16px; }
    .pf-call-screen__backdrop {
      position: absolute; inset: 0;
      background: rgba(8, 8, 20, 0.78); backdrop-filter: blur(14px);
    }
    .pf-call-screen__card {
      position: relative;
      width: 100%; max-width: 540px;
      padding: 16px 20px 20px;
      border-radius: 22px;
      background: linear-gradient(180deg, rgba(20,20,40,0.96), rgba(8,8,20,0.96));
      border: 1px solid rgba(168, 85, 247, 0.32);
      box-shadow: 0 30px 80px rgba(168, 85, 247, 0.32);
      color: #fff;
      display: flex; flex-direction: column; gap: 16px;
      animation: pf-call-screen-in 0.22s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes pf-call-screen-in {
      from { opacity: 0; transform: scale(0.96); }
      to   { opacity: 1; transform: none; }
    }
    .pf-call-screen__hdr {
      display: flex; align-items: center; gap: 10px;
      padding-bottom: 10px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .pf-call-screen__min {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 10px; border-radius: 8px;
      background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.85);
      border: 1px solid rgba(255,255,255,0.08);
      font-size: 12px; cursor: pointer;
      transition: background 0.12s;
    }
    .pf-call-screen__min:hover { background: rgba(255,255,255,0.12); }
    .pf-call-screen__title { flex: 1; text-align: center; font-size: 13px; color: rgba(255,255,255,0.85); }
    .pf-call-screen__time {
      font-size: 12.5px; font-variant-numeric: tabular-nums;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: rgba(255,255,255,0.65);
    }

    .pf-call-screen__participants {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 12px;
      padding: 12px 0;
    }
    .pf-call-screen__pcard {
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      padding: 18px 10px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 14px;
    }
    .pf-call-screen__avatar {
      width: 56px; height: 56px; border-radius: 50%;
      background: linear-gradient(135deg, #a78bfa, #ec4899);
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; font-weight: 700; color: #fff;
      box-shadow: 0 0 20px rgba(168, 85, 247, 0.45);
    }
    .pf-call-screen__pname { margin: 0; font-size: 13.5px; font-weight: 600; text-align: center;
      max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pf-call-screen__pmeta { margin: 0; font-size: 11px; color: rgba(255,255,255,0.55); }

    .pf-call-screen__route {
      align-self: center;
      display: inline-flex; align-items: center; gap: 8px;
      padding: 6px 14px; border-radius: 999px;
      font-size: 12px; font-weight: 600; letter-spacing: 0.04em;
    }
    .pf-call-screen__route[data-cost='free'] {
      background: rgba(16, 185, 129, 0.18); color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.35);
    }
    .pf-call-screen__route[data-cost='paid'] {
      background: rgba(245, 158, 11, 0.22); color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.38);
    }
    .pf-call-screen__route::before {
      content: ''; display: inline-block;
      width: 6px; height: 6px; border-radius: 50%;
      background: currentColor;
    }
    .pf-call-screen__route-dot { display: none; }

    .pf-call-screen__ctrls {
      display: flex; align-items: center; justify-content: center; gap: 14px;
      padding-top: 8px;
      border-top: 1px solid rgba(255,255,255,0.08);
    }
    .pf-call-screen__ctrl {
      display: inline-flex; flex-direction: column; align-items: center; gap: 4px;
      padding: 12px 14px;
      min-width: 80px;
      background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.10);
      border-radius: 14px;
      color: #fff; cursor: pointer;
      transition: background 0.15s, transform 0.08s;
    }
    .pf-call-screen__ctrl:hover { background: rgba(255,255,255,0.12); }
    .pf-call-screen__ctrl:active { transform: scale(0.96); }
    .pf-call-screen__ctrl--on { background: rgba(244, 63, 94, 0.22); color: #fb7185;
      border-color: rgba(244, 63, 94, 0.4); }
    .pf-call-screen__ctrl--end { background: #ef4444; color: #fff; border-color: transparent; }
    .pf-call-screen__ctrl--end:hover { background: #dc2626; }
    .pf-call-screen__ctrl-lbl { font-size: 10.5px; font-weight: 500; }

    .pf-call-invite-pop--screen {
      bottom: 100px; right: 50%; transform: translateX(50%);
    }

    /* ── Invite-to-call popover (anchored to the pill) ──────────── */
    .pf-call-invite-pop {
      position: absolute; bottom: calc(100% + 8px); right: 0;
      width: 260px; max-height: 320px;
      display: flex; flex-direction: column;
      background: rgba(8, 8, 20, 0.95); backdrop-filter: blur(12px);
      border: 1px solid rgba(168, 85, 247, 0.32);
      border-radius: 12px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.45);
      overflow: hidden;
      animation: pf-call-pop-in 0.16s ease-out;
    }
    @keyframes pf-call-pop-in {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: none; }
    }
    .pf-call-invite-pop__hdr {
      display: flex; align-items: baseline; justify-content: space-between;
      padding: 10px 14px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .pf-call-invite-pop__title { font-size: 13px; font-weight: 600; color: #fff; }
    .pf-call-invite-pop__count {
      font-size: 10.5px; color: rgba(255,255,255,0.55);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }
    .pf-call-invite-pop__list { list-style: none; padding: 6px; margin: 0; overflow-y: auto; }
    .pf-call-invite-pop__item {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      width: 100%; padding: 8px 10px;
      background: transparent; border: none; border-radius: 8px;
      color: #fff; font-size: 13px; text-align: left; cursor: pointer;
      transition: background 0.12s;
    }
    .pf-call-invite-pop__item:hover { background: rgba(255,255,255,0.08); }
    .pf-call-invite-pop__name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pf-call-invite-pop__empty {
      padding: 18px 14px; text-align: center; font-size: 12.5px;
      color: rgba(255,255,255,0.55);
    }
  `]
})
export class CallOverlayComponent {
  protected readonly webrtc = inject(WebrtcService);
  private readonly toast = inject(ToastService);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly signaling = inject(SignalingService);
  private readonly ringtone = inject(RingtoneService);

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

  /** Self + remote participants, with names resolved from the directory cache. */
  protected readonly participants = computed(() => {
    const me = this.auth.user();
    const meId = me?.authId ?? me?.id ?? '';
    const dir = this.directoryUsers();
    const byId = new Map(dir.map(d => [d.id, d.displayName]));
    const mutedRemote = this.webrtc.remoteMuted();
    const remote = this.webrtc.remoteParticipants().map(rid => ({
      id: rid,
      name: byId.get(rid) ?? this.webrtc.localCallerName() ?? 'Caller',
      isMe: false,
      muted: mutedRemote.get(rid) ?? false
    }));
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

    // Voice playback hardening: every time the remote-stream map changes,
    // walk the rendered <audio> elements and (a) re-assign srcObject via
    // property, (b) call .play() explicitly. The Angular template binding
    // `[srcObject]="..."` works in some browsers and silently no-ops in
    // others; explicit assignment + play() is the reliable path. This was
    // the actual reason "call connects but no voice" — the audio elements
    // existed but their srcObject was never wired to the MediaStream.
    effect(() => {
      const _ = this.webrtc.remoteAudio();   // dependency: react to changes
      queueMicrotask(() => {
        const els = document.querySelectorAll<HTMLAudioElement>('audio[data-remote-call]');
        const map = this.webrtc.remoteAudio();
        els.forEach(el => {
          const userId = el.getAttribute('data-user');
          if (!userId) return;
          const stream = map.get(userId);
          if (stream && el.srcObject !== stream) el.srcObject = stream;
          if (stream) {
            const p = el.play();
            if (p && typeof (p as Promise<void>).catch === 'function') {
              (p as Promise<void>).catch(() => {
                this.toast.info('Tap anywhere to enable call audio');
              });
            }
          }
        });
      });
    });
  }

  protected duration = computed(() => {
    const started = this.webrtc.callStartedAt();
    if (!started) return '00:00';
    const sec = Math.max(0, Math.floor((this._now() - started) / 1000));
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  });

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
