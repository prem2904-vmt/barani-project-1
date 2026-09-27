import { firstValueFrom } from 'rxjs';
import type { ApiService } from './api.service';
import type { SignalingService } from './signaling.service';
import type { WebrtcService } from './webrtc.service';

/*
 * Answer / decline / show a call that a PUSH rang (native ringer, web
 * notification, Electron call window). Plain functions in their own lazy
 * module so they stay off the initial bundle; used by call-push.service,
 * callkit.wiring and the Android foreground-push path in push.service.
 */

/** Answer the call a push rang for. If the in-app ring for it is already up
 *  it's a normal accept; otherwise (cold start from the notification) the
 *  session is accepted by id — the server keeps it for the ring window. */
export async function answerFromPush(webrtc: WebrtcService, sessionId: string): Promise<void> {
  if (webrtc.incomingCall()?.sessionId === sessionId) return webrtc.acceptIncoming();
  if (webrtc.sessionId() === sessionId && webrtc.inCall()) return; // already on it
  return webrtc.acceptBySessionId(sessionId);
}

/** Decline the call a push rang for. Plain HTTP when there's no live in-app
 *  ring — reliable from a background wake, no hub needed. */
export async function declineFromPush(webrtc: WebrtcService, api: ApiService, sessionId: string): Promise<void> {
  if (webrtc.incomingCall()?.sessionId === sessionId) return webrtc.rejectIncoming();
  try { await firstValueFrom(api.post(`/api/calls/${encodeURIComponent(sessionId)}/decline`, {})); }
  catch (err) { console.warn('[calls] decline failed', err); }
}

/** The user opened the app from the ring without choosing: show the in-app
 *  ring if the call is still ringing. False when it is gone (cancelled /
 *  answered elsewhere / timed out) so a native ringer can be dismissed. */
export async function showRingFromPush(webrtc: WebrtcService, signaling: SignalingService, sessionId: string): Promise<boolean> {
  if (webrtc.incomingCall()?.sessionId === sessionId) return true;
  try {
    const info = await signaling.getRingingCall(sessionId);
    if (!info) return false;
    webrtc.receiveIncoming(info);
    return webrtc.incomingCall()?.sessionId === sessionId;
  } catch (err) {
    console.warn('[calls] ring lookup failed', err);
    return false;
  }
}
