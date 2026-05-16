import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { WebrtcService } from '../../../core/services/webrtc.service';
import { ToastService } from '../../../core/services/toast.service';

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
    <!-- Hidden audio sinks for each remote peer's stream -->
    @for (entry of audioEntries(); track entry.userId) {
      <audio #remoteAudio
             [attr.data-user]="entry.userId"
             [srcObject]="entry.stream"
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

    @if (showInCallPanel()) {
      <div class="pf-call-pill" role="region" aria-label="Active call">
        <div class="pf-call-pill__dot" [class.pf-call-pill__dot--muted]="webrtc.micMuted()"></div>
        <div class="pf-call-pill__meta">
          <span class="pf-call-pill__label">{{ webrtc.status() === 'active' ? 'On call' : 'Connecting…' }}</span>
          <span class="pf-call-pill__time">{{ duration() }}</span>
        </div>
        @if (webrtc.usingTurnRelay()) {
          <span class="pf-call-pill__relay" title="Media is relayed via TURN">↻</span>
        }
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
        <button type="button" class="pf-call-pill__btn pf-call-pill__btn--end"
                (click)="leave()" aria-label="End call">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"
                  transform="rotate(135 12 12)"/>
          </svg>
        </button>
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
  `]
})
export class CallOverlayComponent {
  protected readonly webrtc = inject(WebrtcService);
  private readonly toast = inject(ToastService);

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
}
