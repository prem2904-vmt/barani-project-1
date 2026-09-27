export interface User {
  id: string;
  tenantId: string;
  /** Honorific printed before the name ("Dr.", "Mr.", "Mrs.", "Ms.").
   *  Optional; server DisplayName already includes it. */
  title?: string | null;
  firstName: string;
  fathersName: string;
  /** Server computes this (now WITH the title). Falls back to
   *  `title + firstName + fathersName`. */
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

/** Prefers the server displayName (which already carries the title), so the
 *  manual fallback prefixing here can never double up. */
export function userDisplayName(
  u: Pick<User, 'firstName' | 'fathersName' | 'displayName'> & { title?: string | null } | null | undefined
): string {
  if (!u) return '';
  if (u.displayName) return u.displayName;
  return [u.title, u.firstName, u.fathersName].filter(Boolean).join(' ');
}

export interface Role {
  id: string;
  tenantId?: string;
  name: string;
  scope: string;
  isPreSeeded: boolean;
  isActive: boolean;
  createdAt: string;
  /** Product module scope (OPD build): 'lab' | 'opd' | null. */
  module?: string | null;
  /** Role type (OPD build): 'doctor' marks a clinician role; else null/general. */
  kind?: string | null;
  /** GET /api/roles only: may the CALLER assign this role to another user /
   *  to themselves? Computed server-side by the same rule POST /api/users and
   *  PUT /api/users/{id}/roles enforce (see role-assignability.ts). */
  assignable?: boolean;
  assignableToSelf?: boolean;
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
