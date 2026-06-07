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

export interface AuditLogPage {
  items: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
}

/** Audited entity types (mirrors the backend interceptor allowlist) with
 *  reader-friendly labels for the filter dropdown. */
export const AUDIT_ENTITY_TYPES: { value: string; label: string }[] = [
  { value: '', label: 'All record types' },
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
