export type CollectionMode = 'front_desk' | 'dedicated_counter';

export interface BranchLabConfig {
  id: string;
  tenantId: string;
  branchId: string;
  assignmentMode: string;
  autoAssignBy: string;
  allowManualOverride: boolean;
  collectionMode: CollectionMode;
  metadata?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}
