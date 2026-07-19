export type TenantBrandingMode = 'logo' | 'name' | 'both';

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
  /** Short (≤10 chars) label rendered next to the logo in the top strip. */
  brandingName?: string;
  /** Which parts to render in the top strip. Defaults to 'both'. */
  brandingMode?: TenantBrandingMode;
  /** Admin-toggled: if true, supervisors can claim a sample without a
   * physical scan (broken barcode workaround, audit-logged). Default false. */
  allowNoScanClaim?: boolean;
  /** Tenant-wide: number of digits in the running part of the short sample
   * barcode (DD + YY + this many digits). Valid 1–9. Default 5 → 00001. */
  sampleNumberWidth?: number;
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
  /** How departments are physically organised: 'integrated' (all depts share
   *  one lab) or 'individual' (each dept is its own lab). Drives tube counting. */
  labStructure?: 'integrated' | 'individual';
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
  /** The lab space this department is assigned to (null = unassigned). */
  spaceId?: string | null;
  name: string;
  code: string;
  /** 2-digit department code (01–99) that prefixes the short sample barcode
   * (DD + YY + running number). Optional; null/undefined when unset. */
  sampleCode?: number;
  /** Sample container/tube colour (hex) shown in collection. */
  containerColor?: string | null;
  /** Human label for the container (e.g. "EDTA · Lavender"). */
  containerLabel?: string | null;
  isActive: boolean;
  createdAt: string;
}
