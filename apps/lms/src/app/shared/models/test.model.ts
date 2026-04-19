export interface Test {
  id: string;
  tenantId: string;
  branchId?: string;
  departmentId?: string;
  name: string;
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
  department?: { id: string; name: string; code: string };
  createdAt: string;
}

export interface TestParameter {
  id: string;
  name: string;
  title: string;
  type: 'numeric' | 'text' | 'textarea' | 'select' | 'multiselect' | 'radio' | 'button_select' | 'yesno' | 'toggle' | 'date' | 'numeric_with_range';
  unit?: string;
  options?: string[];
  referenceRanges?: { segment: string; min: number; max: number }[];
  normalValue?: string;
  criticalLow?: number;
  criticalHigh?: number;
}

export interface TestParametersBlob {
  sampleType?: string;
  tatHours?: number;
  parameters: TestParameter[];
}

export interface TestCondition {
  if: { parameter: string; operator: string; value: unknown };
  then: { action: string; additional?: string };
}
