/**
 * Teams-style presence status presets — the single source of truth for the
 * status picker, avatar dots and people/messages presence labels.
 *
 * These are the CUSTOM statuses a user sets on themselves (persisted via
 * PATCH /api/auth/me/status and broadcast over SignalR's
 * `UserPresenceChanged`). They coexist with the hub's automatic
 * connection presence ('active' | 'away' | 'in-a-call' | 'offline'):
 * the connection presence says whether someone is reachable at all,
 * the custom status says what they're doing.
 *
 * 'dnd' and 'surgery' are DND-grade: the server blocks incoming calls
 * (the caller is told why) and silences device pushes while set. The
 * bell + unread counters still accumulate.
 */
export type PresenceKey =
  | 'available'
  | 'busy'
  | 'with_patient'
  | 'rounds'
  | 'surgery'
  | 'dnd'
  | 'away';

export interface PresenceOption {
  key: PresenceKey;
  label: string;
  color: string;
  /** DND-grade: calls blocked + pushes silenced while this status is set. */
  dnd: boolean;
}

export const PRESENCE_OPTIONS: PresenceOption[] = [
  { key: 'available',    label: 'Available',      color: '#34d399', dnd: false },
  { key: 'busy',         label: 'Busy',           color: '#f87171', dnd: false },
  { key: 'with_patient', label: 'With a patient', color: '#f87171', dnd: false },
  { key: 'rounds',       label: 'On rounds',      color: '#fbbf24', dnd: false },
  { key: 'surgery',      label: 'In surgery',     color: '#dc2626', dnd: true },
  { key: 'dnd',          label: 'Do not disturb', color: '#dc2626', dnd: true },
  { key: 'away',         label: 'Away',           color: '#9ca3af', dnd: false },
];

const BY_KEY = new Map<string, PresenceOption>(PRESENCE_OPTIONS.map(o => [o.key, o]));

/** Type guard — true when `s` is one of the 7 custom status keys. */
export function isPresenceKey(s: string | null | undefined): s is PresenceKey {
  return !!s && BY_KEY.has(s);
}

/** Human label for a preset key ('' for unknown keys). */
export function presenceLabel(key: string | null | undefined): string {
  return (key && BY_KEY.get(key)?.label) || '';
}

/** Dot color for a preset key (neutral grey for unknown keys). */
export function presenceColor(key: string | null | undefined): string {
  return (key && BY_KEY.get(key)?.color) || '#9ca3af';
}

/** True when the key is DND-grade (calls blocked, pushes silenced). */
export function presenceIsDnd(key: string | null | undefined): boolean {
  return !!key && (BY_KEY.get(key)?.dnd ?? false);
}

// ── Display presence (one resolver for every avatar) ─────────────────────
/** What an avatar dot shows: hub connection presence where it decides
 *  reachability ('offline' / 'away' / 'in-a-call'), otherwise the person's
 *  custom status, otherwise plain 'active'. */
export type DisplayPresence = PresenceKey | 'active' | 'in-a-call' | 'offline';

/** Dot tone (ND palette): violet = reachable, slate = busy / on a call /
 *  away, muted red = calls blocked, hollow = offline. */
export type PresenceTone = 'on' | 'busy' | 'away' | 'dnd' | 'off';

export function presenceTone(p: DisplayPresence | string | null | undefined): PresenceTone {
  if (p === 'active' || p === 'available') return 'on';
  if (!p || p === 'offline') return 'off';
  if (p === 'away') return 'away';
  if (p === 'dnd' || p === 'surgery') return 'dnd';
  return 'busy';
}

/** Human label for any display presence ("Online", "In surgery", …). */
export function presenceText(p: DisplayPresence | string | null | undefined): string {
  if (p === 'active') return 'Online';
  if (p === 'in-a-call') return 'On a call';
  if (!p || p === 'offline') return 'Offline';
  return presenceLabel(p) || 'Offline';
}
