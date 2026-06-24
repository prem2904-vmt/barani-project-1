/** An outsourced / referral laboratory we subcontract tests to (e.g. Apollo).
 *  Distinct from the B2B credit `Vendor` (a partner who sends US patients). */
export interface ReferralLab {
  id: string;
  tenantId: string;
  name: string;
  code?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  address?: string | null;
  /** JSON array of department codes this lab handles (e.g. ["BIO","MICRO"]). */
  departmentCodesJson?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string | null;
}
