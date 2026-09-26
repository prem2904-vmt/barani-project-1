export type CollectionMode = 'front_desk' | 'dedicated_counter';
export type BillingMode    = 'front_desk' | 'separate_counter';

export interface BranchLabConfig {
  id: string;
  tenantId: string;
  branchId: string;
  assignmentMode: string;
  autoAssignBy: string;
  allowManualOverride: boolean;
  collectionMode: CollectionMode;
  billingMode: BillingMode;
  /** Per-branch master switch for the inventory/Stores work area. When false
   *  the Stores nav entry is hidden even for users holding inventory perms. */
  inventoryEnabled?: boolean;
  /** Whether the front-desk "Payments due" tab is shown (In Progress + Completed
   *  are always shown). Default true when absent. */
  showPaymentsDueTab?: boolean;
  /** The SINGLE machine-readable code that prints on a specimen label — a small
   *  tube label can't fit more than one. 'barcode' (1D) | 'qr' (2D) |
   *  'datamatrix' (2D, tiny). Default 'barcode'. (Legacy 'both' maps to
   *  'barcode' server-side.) */
  labelCodeMode?: 'barcode' | 'qr' | 'datamatrix';
  /** How the lab queues group work. Stored per-branch:
   *  'patient' (rows = patients, tests nested) | 'sample' (rows = sample IDs) |
   *  'auto' (default) → resolved from the branch's lab-space count. */
  queueFocusMode?: 'auto' | 'patient' | 'sample';
  /** Server-resolved focus ('patient'|'sample'). Forced modes pass through;
   *  'auto' resolves to 'sample' when the branch has 2+ lab spaces, else
   *  'patient'. Read this on the queue screens (not queueFocusMode). */
  effectiveQueueFocus?: 'patient' | 'sample';
  /** Sample-ID prefix for departments in the default "Lab" space (no dedicated
   *  space). Null → falls back to "LAB". Editable on the Branches board. */
  defaultLabCode?: string | null;
  /** Branch lab structure, copied from the branch: 'integrated' (all departments
   *  run as one lab) hides the department on lab tubes; 'standalone' shows it. */
  labStructure?: 'integrated' | 'standalone' | string | null;
  /** Server-resolved payment gate: where an unpaid (e.g. pay-later) order is
   *  held — 'dispatch' | 'report' | 'none'. Enforced server-side. */
  paymentGateStage?: 'none' | 'dispatch' | 'report';
  metadata?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}
