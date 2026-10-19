/**
 * Workflow field types. Superset of the shared FormFieldType so the workflow
 * field-editor can use the shared field-type picker directly. Legacy names
 * (button_select, numeric_with_range) are retained for round-trip stability
 * with previously saved workflow configs.
 */
export type FieldType =
  // ── Shared FormFieldType literals ──
  | 'text'
  | 'number'
  | 'textarea'
  | 'voice-text'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'radio'
  | 'duration'
  | 'duration-time'
  | 'duration-period'
  | 'date'
  | 'time'
  | 'datetime'
  | 'buttonSelect'
  | 'imageSelect'
  | 'yesno'
  | 'yesNoNa'
  | 'toggle'
  | 'phone'
  | 'email'
  | 'multiTextbox'
  | 'imageGallery'
  | 'scribblePad'
  | 'imageInfo'
  | 'signature'
  | 'file-upload'
  | 'section-header'
  | 'info-text'
  | 'size'
  | 'measure'
  | 'table'
  | 'recursive'
  | 'recursivePages'
  // ── Legacy workflow-only literals kept for backward compatibility ──
  | 'button_select'
  | 'multi_button_select'
  | 'file'
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
  sublabel?: string;
}

export interface ValidationRule {
  type: ValidationType;
  value?: unknown;
  message: string;
}

// Canonical reference-range type (segment label + min/max + structured
// sex/age selectors) lives in the form-field model. Re-exported here so the
// many workflow/dynamic-input consumers keep importing it from one place.
import type { ReferenceRange } from '../forms/form-field.model';
export type { ReferenceRange };

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
  /** How multiple showWhen rules combine. Defaults to 'AND' (legacy behaviour). */
  showWhenLogic?: ConditionLogic;
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
  /** Whole years (workflow rules: "age < 18"). */
  patientAge?: number;
  /** Fractional years (days / 365.25) for reference-band picks — the
   *  server's flagging metric (shared/utils/patient-age). */
  patientBandAge?: number;
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
