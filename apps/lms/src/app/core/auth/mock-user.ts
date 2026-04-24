export interface CurrentUser {
  id: string;
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
