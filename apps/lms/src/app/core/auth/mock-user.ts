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
  tenantName: string;
  branchName: string;
  roles: string[];
  permissions: string[];
  /** Branches this user may switch between (from their role grants). */
  branches?: BranchRef[];
  /** Product modules this user is scoped to (OPD build; role.Module ?? 'lab').
   *  Defaults to ['lab'] when absent. Drives the front-desk "new order" fork. */
  modules?: string[];
  /** Whether a quick-switch/unlock PIN is set for this account. */
  hasPin?: boolean;
  /** The user's saved digital signature (PNG data URL), drawn on invoices/
   *  reports they sign. Set on My signature; follows the user across stations. */
  signatureDataUrl?: string;
  registrationId?: string;
  /** Caller has a DoctorProfile — unlocks the OPD Consult Room. */
  isDoctor?: boolean;
  /** OPD dark build (server /me): OPD calls are admitted for this user —
   *  tenant explicitly entitled OR the request carried X-PF-OPD: 1 (pf.opd()).
   *  Informational — the UI gate (OpdGateService) reads opdEntitled + the flag. */
  opdAccess?: boolean;
  /** The tenant EXPLICITLY has OPD on (visible without the console flag). */
  opdEntitled?: boolean;
  /** Case sheets (plan §4.3): 'personal' for a Google user's private case-sheet space; absent / anything else = a
   *  lab. Read only by CasesheetGateService (older servers omit it ⇒ a lab). */
  tenantKind?: string;
}

export interface BranchRef {
  id: string;
  name: string;
}
