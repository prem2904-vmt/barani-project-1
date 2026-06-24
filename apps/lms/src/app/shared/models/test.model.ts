export interface Test {
  id: string;
  tenantId: string;
  branchId?: string;
  departmentId?: string;
  name: string;
  code?: string;
  description?: string;
  type: 'individual' | 'package';
  flow: 'direct' | 'approval';
  hsnSacCode?: string;
  taxSlab: number;
  price: number;
  discount: number;
  parameters?: string;
  conditions?: string;
  sampleType?: string;
  tatHours: number;
  isActive: boolean;
  /** When set, this test is subcontracted to a referral lab (null = in-house). */
  outsourcedVendorId?: string | null;
  /** Department-at-vendor used for outsourced vial grouping (falls back to departmentId). */
  outsourcedDepartmentId?: string | null;
  department?: { id: string; name: string; code: string };
  createdAt: string;
}

// Canonical reference-range shape (segment label + min/max + structured
// sex/age selectors). Defined once in the form-field model; re-exported here
// so result/report code can import it from the test model too.
export type { ReferenceRange } from '../forms/form-field.model';
import type { ReferenceRange } from '../forms/form-field.model';

export interface TestParameter {
  id: string;
  name: string;
  title: string;
  type: 'numeric' | 'text' | 'textarea' | 'select' | 'multiselect' | 'radio' | 'button_select' | 'yesno' | 'toggle' | 'date' | 'numeric_with_range';
  unit?: string;
  options?: string[];
  referenceRanges?: ReferenceRange[];
  normalValue?: string;
  criticalLow?: number;
  criticalHigh?: number;
  // Plausible / analytically-possible band — wider than the reference and
  // critical ranges. A value outside it is treated as a transcription error
  // and rejected at submit. Optional; unset = no plausibility check.
  validLow?: number;
  validHigh?: number;
}

export interface TestParametersBlob {
  sampleType?: string;
  tatHours?: number;
  /** Microbiology result format hint: 'culture_sensitivity' routes to the
   *  structured culture entry + report; others render generically. */
  microFormat?: string;
  parameters: TestParameter[];
  // New-format parallel array produced by the test editor. Carries richer
  // per-field metadata (id, showWhen, conditional links) that the legacy
  // TestParameter shape can't express. Renderers should prefer this when
  // present and fall back to `parameters` otherwise.
  fields?: import('../forms/form-field.model').FormField[];
}

export interface TestCondition {
  if: { parameter: string; operator: string; value: unknown };
  then: { action: string; additional?: string };
}
