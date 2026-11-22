import { KIND_META, NOTIF_GROUPS, NOTIF_ICON_PATHS, groupOf, kindMeta } from './notification-kinds';

/**
 * NotificationCatalog.cs (prefrontal-mw, Prefrontal/Services) is the single source of truth for the kinds. This list is
 * its key list as of 2026-11-19 (62 kinds, 9 modules). When a kind is added to the catalog it MUST be added here AND to
 * KIND_META — otherwise it would render as a generic System bell with no group.
 */
export const CATALOG_KEYS: Record<string, string> = {
  sample_ready_collection: 'frontdesk', stat_order_created: 'frontdesk', order_cancelled: 'frontdesk', order_tests_modified: 'frontdesk',
  package_dispatched: 'frontdesk', dispatch_package_received: 'frontdesk', dispatch_not_received: 'frontdesk', billed_not_collected: 'frontdesk',
  bill_settled: 'billing', refund_owed: 'billing', refund_issued: 'billing', large_discount_applied: 'billing', discount_approval_requested: 'billing',
  day_close_cash_variance: 'billing', balance_overdue: 'billing', refund_overdue: 'billing',
  sample_rejection: 'lab', tests_assigned: 'lab', validation_assigned: 'lab', test_assigned: 'lab', tat_breach: 'lab', culture_stage_overdue: 'lab',
  culture_lock_released: 'lab', instrument_unmatched_result: 'lab',
  critical_value: 'results', result_awaiting_validation: 'results', result_rejected: 'results', result_edit_requested: 'results',
  validation_reassigned: 'results', result_comment_added: 'results', validation_overdue: 'results', critical_unvalidated: 'results',
  report_ready: 'reports', urgent_report_ready: 'reports', report_amended: 'reports', report_blocked: 'reports', report_delivered: 'reports',
  report_viewed_by_patient: 'reports', report_undelivered: 'reports',
  whatsapp_payment_failed: 'whatsapp', whatsapp_spend_threshold: 'whatsapp', whatsapp_low_balance: 'whatsapp', whatsapp_credits_low: 'whatsapp',
  whatsapp_credits_exhausted: 'whatsapp',
  inventory_low_stock: 'inventory', inventory_shortfall_on_collection: 'inventory', inventory_batch_near_expiry: 'inventory', inventory_batch_expired: 'inventory',
  home_collection_assigned: 'appointments', home_collection_unassigned: 'appointments', home_collection_completed: 'appointments',
  appointment_auto_no_show: 'appointments', appointment_marked_urgent: 'appointments', appointment_wait_overdue: 'appointments',
  office_mention: 'team', user_created: 'team', user_access_changed: 'team', password_reset_by_admin: 'team', role_permissions_changed: 'team',
  workflow_activated: 'team', catalog_update_available: 'team', vendor_credit_threshold: 'team',
};

describe('notification kinds — catalog mapping', () => {
  const groups = NOTIF_GROUPS.map(g => g.id);

  it('knows the 62 catalog kinds this table was written against', () => {
    expect(Object.keys(CATALOG_KEYS).length).toBe(62);
  });

  it('maps EVERY catalog kind (an unmapped kind fails here, never renders as an empty tile)', () => {
    const missing = Object.keys(CATALOG_KEYS).filter(k => !KIND_META[k]);
    expect(missing).toEqual([]);
  });

  it('has no entry for a kind the catalog does not have (a typo would be a dead row)', () => {
    const extra = Object.keys(KIND_META).filter(k => !CATALOG_KEYS[k]);
    expect(extra).toEqual([]);
  });

  it('gives every kind a real group, a real icon with path data, a tone and a label', () => {
    for (const key of Object.keys(CATALOG_KEYS)) {
      const m = KIND_META[key];
      expect(groups, key).toContain(m.group);
      expect(NOTIF_ICON_PATHS[m.icon]?.length, `${key} icon ${m.icon}`).toBeGreaterThan(0);
      for (const d of NOTIF_ICON_PATHS[m.icon]) expect(d.trim().length, `${key} path`).toBeGreaterThan(3);
      expect(['rose', 'amber', 'emerald', 'violet', 'sky'], key).toContain(m.tone);
      expect(m.label.trim().length, key).toBeGreaterThan(0);
    }
  });

  it('every icon in the set has path data', () => {
    for (const [name, paths] of Object.entries(NOTIF_ICON_PATHS)) expect(paths.length, name).toBeGreaterThan(0);
  });

  it('files the patient-safety kinds under Critical results and the overdue ones under Running late', () => {
    expect(groupOf('critical_value')).toBe('critical');
    expect(groupOf('critical_unvalidated')).toBe('critical');
    for (const k of ['tat_breach', 'validation_overdue', 'dispatch_not_received', 'billed_not_collected', 'report_undelivered', 'balance_overdue'])
      expect(groupOf(k), k).toBe('late');
    expect(groupOf('report_ready')).toBe('reports');
    expect(groupOf('sample_rejection')).toBe('samples');
    expect(groupOf('result_comment_added')).toBe('messages');
    expect(groupOf('user_created')).toBe('system');
  });

  it('maps the legacy "lms." spelling identically', () => {
    for (const k of Object.keys(CATALOG_KEYS)) expect(kindMeta('lms.' + k), k).toEqual(kindMeta(k));
  });

  it('never throws on an unknown kind: System group, plain bell, a label from the key', () => {
    const m = kindMeta('something_brand_new');
    expect(m.group).toBe('system');
    expect(m.icon).toBe('bell');
    expect(m.label).toBe('something brand new');
    expect(kindMeta(null).group).toBe('system');
  });

  it('keeps the tones the bell has always shown (rose critical, amber late, emerald ready)', () => {
    expect(kindMeta('critical_value').tone).toBe('rose');
    expect(kindMeta('tat_breach').tone).toBe('amber');
    expect(kindMeta('sample_rejection').tone).toBe('amber');
    expect(kindMeta('report_ready').tone).toBe('emerald');
    expect(kindMeta('urgent_report_ready').tone).toBe('amber');
    expect(kindMeta('result_rejected').tone).toBe('rose');
    expect(kindMeta('user_created').tone).toBe('violet');
  });
});
