import { Conversation } from './chat.model';

/** Group → its name; 1:1 → the OTHER participant's display name. */
export function conversationTitle(c: Conversation, meId: string): string {
  if (c.name) return c.name;
  const peer = c.participants?.find(p => p.userId !== meId);
  return peer?.displayName || 'Conversation';
}

/**
 * Two-letter badge for a conversation: first letter of the first word +
 * first letter of the last word ("Shugandhan Arulvelan" → "SA"). Single
 * word falls back to its first letter.
 */
export function conversationInitials(c: Conversation, meId: string): string {
  const words = conversationTitle(c, meId).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = words[0][0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}
