export interface ChatMessage {
  id: string;
  fromUserId: string;
  toUserId: string;
  body: string;
  sentAt: string;
  readAt?: string | null;
}

export interface ConversationSummary {
  otherUserId: string;
  lastMessage: { id: string; fromUserId: string; body: string; sentAt: string; readAt?: string | null };
  unread: number;
}
