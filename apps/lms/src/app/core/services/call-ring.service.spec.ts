import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { CallRingService } from './call-ring.service';
import { RingtoneService } from './ringtone.service';
import { WebrtcService } from './webrtc.service';
import { SessionScopeService } from '../auth/session-scope.service';
import { IncomingCallInfo } from '../../shared/models/call.model';

/** Messages RCA §5: one root ring controller, stopped by every terminal
 *  state and by an account switch — independent of which screen is mounted. */
function setup() {
  const incomingCall = signal<IncomingCallInfo | null>(null);
  const status = signal<string>('idle');
  let tone: string | null = null;
  const ringtone = {
    play: vi.fn((t: string) => { tone = t; }),
    stop: vi.fn(() => { tone = null; }),
    activeTone: () => tone,
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: WebrtcService, useValue: { incomingCall, status } },
      { provide: RingtoneService, useValue: ringtone },
    ],
  });
  const scope = TestBed.inject(SessionScopeService);
  scope.changed({ userId: 'a', tenantId: 't', authId: 'sa' });
  const svc = TestBed.inject(CallRingService);
  const flush = () => TestBed.tick();
  return { svc, scope, incomingCall, status, ringtone, flush, tone: () => tone };
}

const CALL: IncomingCallInfo = { sessionId: 's1', callerId: 'x', callerName: 'Admin User', callType: 'audio', participants: [] };

describe('CallRingService', () => {
  afterEach(() => vi.useRealTimers());

  it('rings on incoming and stops the moment the call is answered / declined / cancelled', () => {
    const t = setup();
    t.flush();
    t.incomingCall.set(CALL); t.status.set('incoming'); t.flush();
    expect(t.tone()).toBe('ringtone');
    t.incomingCall.set(null); t.status.set('connecting'); t.flush();
    expect(t.tone()).toBeNull();
  });

  it('ringback while outgoing, silence once active', () => {
    const t = setup();
    t.status.set('outgoing'); t.flush();
    expect(t.tone()).toBe('ringback');
    t.status.set('active'); t.flush();
    expect(t.tone()).toBeNull();
  });

  it('an account switch stops a live ring', () => {
    const t = setup();
    t.incomingCall.set(CALL); t.status.set('incoming'); t.flush();
    expect(t.tone()).toBe('ringtone');
    t.scope.changed({ userId: 'b', tenantId: 't', authId: 'sb' });
    expect(t.tone()).toBeNull();
  });

  it('never rings past the hard cap even if the end event is lost', () => {
    vi.useFakeTimers();
    const t = setup();
    t.incomingCall.set(CALL); t.status.set('incoming'); t.flush();
    vi.advanceTimersByTime(CallRingService.RING_CAP_MS + 10);
    expect(t.tone()).toBeNull();
  });
});
