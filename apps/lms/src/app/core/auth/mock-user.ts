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
}
