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
  metadata?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}
