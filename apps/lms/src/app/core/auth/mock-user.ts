export interface CurrentUser {
  id: string;
  /** Supabase auth uid — same id SignalR addresses every connection by.
   *  Use this (not `id`) when targeting another user via chat/call. */
  authId?: string;
  firstName: string;
  fathersName: string;
  displayName: string;
  email?: string;
  tenantId: string;
  branchId: string;
  subBranchId?: string | null;
  tenantName: string;
  branchName: string;
  subBranchName?: string | null;
  roles: string[];
  permissions: string[];
  /** Branches this user may switch between (from their role grants). */
  branches?: BranchRef[];
  /** Whether a quick-switch/unlock PIN is set for this account. */
  hasPin?: boolean;
  /** The user's saved digital signature (PNG data URL), drawn on invoices/
   *  reports they sign. Set on My signature; follows the user across stations. */
  signatureDataUrl?: string;
}

export interface BranchRef {
  id: string;
  name: string;
}
