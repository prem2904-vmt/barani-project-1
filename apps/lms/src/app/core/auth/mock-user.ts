export interface CurrentUser {
  id: string;
  name: string;
  email?: string;
  tenantId: string;
  branchId: string;
  tenantName: string;
  branchName: string;
  permissions: string[];
}

export const MOCK_USER: CurrentUser = {
  id: '00000001-0000-0000-0000-000000000001',
  name: 'Admin User',
  email: 'admin.user@apollo.example',
  tenantId: '00000001-0000-0000-0000-000000000010',
  branchId: '00000001-0000-0000-0000-000000000020',
  tenantName: 'Apollo Diagnostics',
  branchName: 'Chennai Main',
  permissions: ['*']
};
