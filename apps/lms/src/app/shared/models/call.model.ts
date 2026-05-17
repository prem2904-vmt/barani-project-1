/** Voice-consult call types — audio only for v1. */
export type CallType = 'audio';

/** Surface that triggered the call; used for analytics + per-source UX. */
export type CallSource = 'pathologist_validation' | 'frontdesk_patient' | 'admin_internal' | 'other';

/** Live call status (mirrors backend SignalingHub state machine). */
export type CallStatus = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ending';

/** Mirrors RTCIceServer dictionary — fed straight to RTCPeerConnection. */
export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface TurnCredentials {
  iceServers: IceServer[];
  ttl: number;
  /** "cloudflare" | "pfbox" | "static" — for diagnostics. */
  provider: string;
}

export interface IncomingCallInfo {
  sessionId: string;
  callerId: string;
  callerName: string;
  callType: CallType;
  source?: CallSource | string;
  participants: string[];
  /** Set when the call was started from a group conversation — drives
   *  the ringer to show the group name + "calling from group" subline. */
  conversationId?: string;
  conversationName?: string;
  isGroup?: boolean;
}

export interface ActiveSession {
  sessionId: string;
  callType: CallType;
  participants: string[];
  createdAt: string;
}
