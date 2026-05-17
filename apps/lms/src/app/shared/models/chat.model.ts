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
  /** Replying to another message — denormalised snippet survives edits. */
  replyToMessageId?: string | null;
  replyPreview?: string | null;
  replyFromName?: string | null;
  /** Set when the sender edited the body. Renders "(edited)" in the meta. */
  editedAt?: string | null;
  /** Soft-delete flag — body is blanked server-side, bubble shows placeholder. */
  deleted?: boolean;
  /** Optional single attachment — image inline, PDF as download chip. */
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentMime?: string | null;
  attachmentSize?: number | null;
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
  /** AuthId of the group creator (drives "can I remove others" UX). */
  createdById: string;
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
