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

/** The other participant of a 1:1 thread (null for groups / notes-to-self). */
export function conversationPeerId(c: Conversation, meId: string): string | null {
  if (c.isGroup || c.contextType === 'self') return null;
  return c.participants?.find(p => p.userId !== meId)?.userId ?? null;
}

/** A readable handle from an email: synthetic tenant logins
 *  (`name@<tenant>.tenant.prefrontal`) → "@name"; real email → as is. */
export function emailHandle(email: string | null | undefined): string {
  const e = (email ?? '').trim();
  if (!e) return '';
  return /\.tenant\.prefrontal$/i.test(e) ? '@' + e.split('@')[0] : e;
}

/**
 * Disambiguator for rows that would otherwise read the same (owner: two
 * "Front Desk" rows under Recent). In order:
 *  - a record-anchored thread (patient / order / report) → its context
 *    label — the same colleague can have a general chat AND per-patient
 *    threads, which all title as the colleague's name;
 *  - a group whose name matches another row → "Group · N members";
 *  - two different people with the same display name → their login handle.
 * Null when the title is already unique and the thread isn't anchored.
 */
export function conversationDisambiguator(c: Conversation, meId: string, all: readonly Conversation[]): string | null {
  if (c.contextLabel && c.contextType && c.contextType !== 'self') return c.contextLabel;
  const title = conversationTitle(c, meId).trim().toLowerCase();
  const clash = all.some(x => x.id !== c.id && conversationTitle(x, meId).trim().toLowerCase() === title);
  if (!clash) return null;
  if (c.isGroup) return `Group · ${c.participants?.length ?? 0} members`;
  const peer = c.participants?.find(p => p.userId !== meId);
  return emailHandle(peer?.email) || null;
}
