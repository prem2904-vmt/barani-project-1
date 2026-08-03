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
  /** Which machine-readable code(s) print on a specimen label:
   *  'barcode' (1D only) | 'qr' (2D only) | 'both' | 'datamatrix' (2D, fits a
   *  tiny tube area). Default 'both'. */
  labelCodeMode?: 'barcode' | 'qr' | 'both' | 'datamatrix';
  /** How the lab queues group work. Stored per-branch:
   *  'patient' (rows = patients, tests nested) | 'sample' (rows = sample IDs) |
   *  'auto' (default) → resolved from the branch's lab-space count. */
  queueFocusMode?: 'auto' | 'patient' | 'sample';
  /** Server-resolved focus ('patient'|'sample'). Forced modes pass through;
   *  'auto' resolves to 'sample' when the branch has 2+ lab spaces, else
   *  'patient'. Read this on the queue screens (not queueFocusMode). */
  effectiveQueueFocus?: 'patient' | 'sample';
  metadata?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}
