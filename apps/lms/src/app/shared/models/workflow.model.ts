export type FieldType =
  | 'text'
  | 'number'
  | 'textarea'
  | 'select'
  | 'multiselect'
  | 'radio'
  | 'checkbox'
  | 'date'
  | 'phone'
  | 'email'
  | 'toggle'
  | 'yesno'
  | 'button_select'
  | 'multi_button_select'
  | 'file'
  | 'signature'
  | 'numeric_with_range'
  | 'critical_numeric'
  /** Runtime-only: expanded by WorkflowRenderer from resources.testParameters. */
  | 'test_parameters'
  /** Runtime-only: sample tube list in the collection workflow. */
  | 'tube_collection';

export type StepType = 'entry' | 'summary' | 'payment' | 'confirmation';

export type ConditionOperator =
  | 'equals'
  | 'notEquals'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterThanOrEqual'
  | 'lessThanOrEqual'
  | 'contains'
  | 'isEmpty'
  | 'isNotEmpty';

export type ConditionLogic = 'AND' | 'OR';

export type FieldWidth = 'full' | 'half' | 'third' | 'quarter';

export type ActionType =
  | 'navigate_to_step'
  | 'create_record'
  | 'send_notification'
  | 'open_workflow'
  | 'show_message'
  | 'skip_step';

export type ValidationType =
  | 'required' | 'min' | 'max'
  | 'minLength' | 'maxLength'
  | 'pattern' | 'email' | 'phone';

export interface FieldOption {
  value: string;
  label: string;
}

export interface ValidationRule {
  type: ValidationType;
  value?: unknown;
  message: string;
}

export interface ReferenceRange {
  segment: string;
  min?: number;
  max?: number;
}

export interface ConditionRule {
  field: string;
  operator: ConditionOperator;
  value?: unknown;
  conditionLogic?: ConditionLogic;
}

export interface ConditionalRoute {
  conditions: ConditionRule[];
  conditionLogic: ConditionLogic;
  goToStep: string;
}

export interface WorkflowTransition {
  defaultNextStep: string | null;
  conditionalRoutes?: ConditionalRoute[];
}

export interface WorkflowAction {
  type: ActionType;
  target?: string;
  message?: string;
}

export interface WorkflowCondition {
  id: string;
  conditions: ConditionRule[];
  conditionLogic: ConditionLogic;
  actions: WorkflowAction[];
}

export interface WorkflowField {
  id: string;
  name: string;
  title: string;
  type: FieldType;
  isStandard: boolean;
  isRequired: boolean;
  isEditable: boolean;
  width?: FieldWidth;
  showWhen?: ConditionRule[];
  validation?: ValidationRule[];
  options?: FieldOption[];
  dataSource?: string;
  storageKey: string;
  unit?: string;
  referenceRanges?: ReferenceRange[];
  criticalLow?: number;
  criticalHigh?: number;
  normalValue?: unknown;
  defaultValue?: unknown;
  placeholder?: string;
  helperText?: string;
}

export interface WorkflowStep {
  id: string;
  name: string;
  title: string;
  type: StepType;
  isRequired: boolean;
  canSkip: boolean;
  isStandard: boolean;
  showWhen?: ConditionRule[];
  skipWhen?: ConditionRule[];
  fields: WorkflowField[];
  afterStep: WorkflowTransition;
}

export interface WorkflowConfig {
  id: string;
  name: string;
  title: string;
  module: string;
  screenName: string;
  version: number;
  status: 'draft' | 'published';
  steps: WorkflowStep[];
  globalConditions: WorkflowCondition[];
  actions: WorkflowAction[];
}

/** Flat values with namespaced keys: `step_name::field_name`. */
export type WorkflowFormValues = Record<string, unknown>;

export interface WorkflowContext {
  patientId?: string;
  orderId?: string;
  tenantId?: string;
  branchId?: string;
  userId?: string;
  patientAge?: number;
  patientSex?: string;
  [key: string]: unknown;
}

/** Wire shape from GET /api/workflows — matches WorkflowConfigEntity. */
export interface WorkflowConfigRecord {
  id: string;
  tenantId: string;
  module: string;
  screenName: string;
  configJson: string;
  version: number;
  status: 'draft' | 'published';
  publishedAt?: string;
  updatedAt: string;
}
