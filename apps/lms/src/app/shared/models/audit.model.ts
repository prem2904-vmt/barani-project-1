export interface AuditLog {
  id: string;
  tenantId?: string;
  entityType: string;
  entityId: string;
  action: 'create' | 'update' | 'delete' | string;
  /** JSON string — before→after diff. Parse for display. */
  changes?: string;
  userId?: string;
  userName?: string;
  at: string;
}

/** One record an audit page references, named by the server
 *  (`GET /api/audit/logs?enrich=true` → `refs`, keyed by id). Anything the
 *  caller can't see (another branch of a strict lab, a deleted row) is absent;
 *  `patient` only comes with view_patient. */
export interface AuditRef {
  kind: string;
  label?: string;
  orderId?: string;
  sampleId?: string;
  patient?: string;
  sub?: string;
}

export interface AuditLogPage {
  items: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
  /** Only with `enrich=true`. */
  refs?: Record<string, AuditRef>;
}

/** `GET /api/audit/facets` — side-card counts over the same window / search. */
export interface AuditFacets {
  types: { entityType: string; count: number }[];
  users: { userId: string; name?: string; count: number }[];
  total: number;
}

/** Audited entity types (mirrors the backend interceptor allowlist) with
 *  reader-friendly labels for the filter dropdown. */
export const AUDIT_ENTITY_TYPES: { value: string; label: string }[] = [
  { value: '', label: 'All record types' },
  { value: 'Auth', label: 'Sign-in & security' },
  { value: 'OrderTestResultEntity', label: 'Result value' },
  { value: 'OrderTestEntity', label: 'Test (order)' },
  { value: 'OrderSampleEntity', label: 'Sample' },
  { value: 'OrderEntity', label: 'Order' },
  { value: 'PatientEntity', label: 'Patient' },
  { value: 'ReportEntity', label: 'Report' },
  { value: 'TestEntity', label: 'Test catalogue' },
  { value: 'UserEntity', label: 'User' },
  { value: 'RoleEntity', label: 'Role' },
  { value: 'RolePermissionEntity', label: 'Role permission' },
  { value: 'UserRoleEntity', label: 'User role' },
  { value: 'BillEntity', label: 'Bill' },
  { value: 'PaymentEntity', label: 'Payment' },
  { value: 'RefundEntity', label: 'Refund' }
];
