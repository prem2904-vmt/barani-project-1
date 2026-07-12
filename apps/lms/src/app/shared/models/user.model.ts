export interface User {
  id: string;
  tenantId: string;
  firstName: string;
  fathersName: string;
  /** Server computes this. Falls back to `firstName + ' ' + fathersName`. */
  displayName?: string;
  email: string;
  /** Login handle for username-only accounts (blank email). */
  username?: string | null;
  phone?: string;
  authId?: string;
  /** Teams-style custom status ('available' | 'busy' | 'with_patient' |
   *  'rounds' | 'surgery' | 'dnd' | 'away') — serialized on every user
   *  object by the API. See shared/models/presence.model.ts. */
  presenceStatus?: string;
  isActive: boolean;
  createdAt: string;
}

export function userDisplayName(
  u: Pick<User, 'firstName' | 'fathersName' | 'displayName'> | null | undefined
): string {
  if (!u) return '';
  if (u.displayName) return u.displayName;
  return [u.firstName, u.fathersName].filter(Boolean).join(' ');
}

export interface Role {
  id: string;
  tenantId?: string;
  name: string;
  scope: string;
  isPreSeeded: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface Permission {
  id: string;
  code: string;
  name: string;
  module: string;
  description?: string;
}

export interface Notification {
  id: string;
  tenantId: string;
  recipientId: string;
  type: string;
  title: string;
  body?: string;
  referenceId?: string;
  referenceType?: string;
  isRead: boolean;
  readAt?: string;
  createdAt: string;
}
