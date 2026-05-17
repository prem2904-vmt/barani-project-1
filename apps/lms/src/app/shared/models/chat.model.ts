/**
 * Chat models — conversation-based (1:1 or group). All `userId` strings
 * are Supabase AuthIds (sub), matching SignalR `Clients.User()` keying
 * and what /api/directory/users returns.
 */

export interface ChatMessage {
  id: string;
  conversationId: string;
  fromUserId: string;
  body: string;
  sentAt: string;
  /** Local-only flag for optimistic sends; cleared when server echo arrives. */
  pending?: boolean;
}

export interface ConversationParticipant {
  userId: string;
  displayName: string;
  email: string;
}

export interface ConversationLastMessage {
  id: string;
  fromUserId: string;
  body: string;
  sentAt: string;
}

export interface Conversation {
  id: string;
  isGroup: boolean;
  name: string | null;
  lastMessageAt: string;
  participants: ConversationParticipant[];
  lastMessage: ConversationLastMessage | null;
  unreadCount: number;
}

export interface CallLogPeer {
  userId: string;
  displayName: string;
}

export interface CallLog {
  id: string;
  roomId: string;
  /** initiated | ringing | active | ended | cancelled | rejected | missed */
  status: string;
  callType: string;
  source: string | null;
  /** "incoming" if I was the callee, "outgoing" if I started it. */
  direction: 'incoming' | 'outgoing';
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  peer: CallLogPeer;
}
