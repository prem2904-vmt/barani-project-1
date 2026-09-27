import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { CallOverlayComponent } from './call-overlay.component';
import { WebrtcService } from '../../../core/services/webrtc.service';
import { ChatService } from '../../../core/services/chat.service';
import { SignalingService } from '../../../core/services/signaling.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { PresenceService } from '../../../core/services/presence.service';
import { IncomingCallInfo } from '../../models/call.model';

/**
 * Call UI — new design (owner 2026-09-27). The outgoing card names the
 * callee (it said "Calling" / "C"), palette only (no green / pink, no
 * glow), Noto tabular numbers (no monospace), circular focus rings on the
 * round controls with the label OUTSIDE the button, neutral mute state.
 */
function setup() {
  const status = signal<string>('idle');
  const incomingCall = signal<IncomingCallInfo | null>(null);
  const outgoingPeer = signal<{ id: string; name: string; isGroup: boolean } | null>(null);
  const micMuted = signal(false);
  const remoteParticipants = signal<string[]>([]);
  const webrtc = {
    status, incomingCall, outgoingPeer, micMuted, remoteParticipants,
    inCall: computed(() => status() === 'active' || status() === 'connecting'),
    remoteAudio: signal(new Map()), remoteMuted: signal(new Map<string, boolean>()),
    localCallerName: signal<string | null>(null), callStartedAt: signal<number | null>(Date.now() - 27_000),
    callError: signal<string | null>(null), usingTurnRelay: signal(false), remainingMs: signal(0),
    toggleMute: vi.fn(() => micMuted.update(v => !v)),
    acceptIncoming: vi.fn(async () => undefined), rejectIncoming: vi.fn(async () => undefined),
    cancelOutgoing: vi.fn(async () => undefined), leaveCall: vi.fn(async () => undefined),
    inviteToCall: vi.fn(async () => undefined),
  };
  TestBed.configureTestingModule({
    imports: [CallOverlayComponent],
    providers: [
      { provide: WebrtcService, useValue: webrtc },
      { provide: ChatService, useValue: { activeMessages: signal([]), conversations: signal([]), activeConversationId: signal(null) } },
      { provide: SignalingService, useValue: { onlineUserIds: signal(new Set()), getOnlineUsersWithStatus: vi.fn(async () => ({})) } },
      { provide: AuthService, useValue: { user: signal({ id: 'a', authId: 'me', displayName: 'Admin User' }) } },
      { provide: ApiService, useValue: { get: () => of([{ id: 'u2', displayName: 'Priya Sharma', email: '', isActive: true }]) } },
      { provide: PresenceService, useValue: { displayStatus: (id: string | null) => (id ? 'active' : null) } },
    ],
  });
  const fixture = TestBed.createComponent(CallOverlayComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, webrtc, status, incomingCall, outgoingPeer, micMuted, remoteParticipants };
}

const css = () => (CallOverlayComponent as unknown as { ɵcmp: { styles: string[] } }).ɵcmp.styles.join('\n');

describe('Call overlay — new design', () => {
  it('outgoing: shows the callee name + initials and "Ringing…", never the "Calling" placeholder', () => {
    const t = setup();
    t.outgoingPeer.set({ id: 'u2', name: 'Priya Sharma', isGroup: false });
    t.status.set('outgoing');
    t.fixture.detectChanges();
    const card = t.el.querySelector('[data-testid="call-outgoing"]')!;
    expect(card.querySelector('[data-testid="call-outgoing-name"]')!.textContent!.trim()).toBe('Priya Sharma');
    expect(card.querySelector('.pf-call-avatar')!.textContent!.trim()).toBe('PS');
    // Presence dot on the callee's avatar (shared pf-presence-dot).
    expect(card.querySelector('pf-presence-dot')!.getAttribute('aria-label')).toBe('Online');
    expect(card.textContent).toContain('Ringing…');
    expect(card.querySelector('[data-testid="call-outgoing-name"]')!.textContent).not.toContain('Calling');
  });

  it('incoming: caller name, "Incoming audio call", Decline (danger) and Answer (primary)', () => {
    const t = setup();
    t.incomingCall.set({ sessionId: 's', callerId: 'u2', callerName: 'Admin User', callType: 'audio', participants: [] });
    t.status.set('incoming');
    t.fixture.detectChanges();
    const card = t.el.querySelector('[data-testid="call-incoming"]')!;
    expect(card.textContent).toContain('Admin User');
    expect(card.textContent).toContain('Incoming audio call');
    expect(card.querySelector('[data-testid="call-decline"]')!.classList).toContain('pf-call-round--danger');
    expect(card.querySelector('[data-testid="call-answer"]')!.classList).toContain('pf-call-round--primary');
  });

  it('in call: neutral status chip "On call · 00:27" with tabular timer, full names, quiet "You"', () => {
    const t = setup();
    t.remoteParticipants.set(['u2']);
    t.status.set('active');
    t.fixture.detectChanges();
    const status = t.el.querySelector('[data-testid="call-status"]')!;
    expect(status.textContent!.replace(/\s+/g, ' ')).toMatch(/On call · 00:2\d/);
    expect(t.el.querySelector('[data-testid="call-timer"]')!.classList).toContain('pf-call-num');
    const tiles = Array.from(t.el.querySelectorAll('[data-testid="call-tile"]'));
    expect(tiles[0].textContent).toContain('Admin User');
    expect(tiles[0].querySelector('.pf-call-tile__you')!.textContent).toBe('You');
  });

  it('mute is a pressed neutral control; labels live OUTSIDE the round button', () => {
    const t = setup();
    t.status.set('active');
    t.fixture.detectChanges();
    const mute = t.el.querySelector('[data-testid="call-mute"]') as HTMLButtonElement;
    mute.click();
    t.fixture.detectChanges();
    expect(mute.getAttribute('aria-pressed')).toBe('true');
    expect(mute.getAttribute('aria-label')).toBe('Unmute');
    expect(mute.querySelector('.pf-call-ctl__lbl')).toBeNull();
    expect(t.el.querySelector('[data-testid="call-muted-chip"]')).not.toBeNull();
  });

  it('minimised pill renders', () => {
    const t = setup();
    t.status.set('active');
    t.fixture.detectChanges();
    (t.el.querySelector('button[aria-label="Minimise call"]') as HTMLButtonElement).click();
    t.fixture.detectChanges();
    expect(t.el.querySelector('[data-testid="call-pill"]')).not.toBeNull();
    expect(t.el.querySelector('[data-testid="call-screen"]')).toBeNull();
  });

  it('styles: palette only (no green / pink / glows), no monospace, circular focus ring, reduced motion', () => {
    const s = css();
    expect(/monospace|ui-monospace|Menlo|Consolas|Courier/i.test(s)).toBe(false);
    expect(/#(22c55e|16a34a|10b981|34d399|4ade80|ec4899|f472b6|db2777|f43f5e)\b/i.test(s)).toBe(false);
    expect(/\b(green|pink|emerald|rose)\b/i.test(s)).toBe(false);
    expect(/glow/i.test(s.replace(/no glows?/gi, ''))).toBe(false);
    // Round controls: 9999px radius + a box-shadow focus ring (follows the circle).
    expect(s).toMatch(/\.pf-call-round(\[[^\]]*\])?\s*\{[^}]*border-radius:\s*9999px/);
    expect(s).toMatch(/\.pf-call-round(\[[^\]]*\])?:focus-visible[^{]*\{[^}]*outline:\s*none;[^}]*box-shadow:/);
    expect(s).toContain('font-variant-numeric: tabular-nums');
    expect(s).toContain('prefers-reduced-motion');
  });
});
