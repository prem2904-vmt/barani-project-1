export interface Tenant {
  id: string;
  name: string;
  slug: string;
  type: string;
  vendorCode: string;
  email?: string;
  phone?: string;
  gstNumber?: string;
  registrationNo?: string;
  logoUrl?: string;
  deploymentType: string;
  isActive: boolean;
  isOnboarded: boolean;
  metadata?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Branch {
  id: string;
  tenantId: string;
  regionId?: string;
  name: string;
  code: string;
  type: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  phone?: string;
  email?: string;
  hasPfBox: boolean;
  boxApiUrl?: string;
  timezone: string;
  isActive: boolean;
  createdAt: string;
  subBranches?: SubBranch[];
  departments?: Department[];
}

export interface SubBranch {
  id: string;
  tenantId: string;
  branchId: string;
  name: string;
  code: string;
  type: string;
  address?: string;
  city?: string;
  state?: string;
  stateCode?: string;
  phone?: string;
  email?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
  departments?: Department[];
}

export interface Region {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  isActive: boolean;
  createdAt: string;
}

export interface Department {
  id: string;
  tenantId: string;
  branchId?: string;
  subBranchId?: string;
  name: string;
  code: string;
  isActive: boolean;
  createdAt: string;
}
