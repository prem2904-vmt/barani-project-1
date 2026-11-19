/**
 * What every notification kind LOOKS like and where it files — one table.
 *
 * The backend's NotificationCatalog.cs is the single source of truth for the kinds (key + module). This file only
 * adds the presentation each kind needs: which inbox group it files under, a real SVG icon, a tone and a short label.
 * `notification-kinds.spec.ts` carries the catalog's key list and FAILS when a catalog kind has no entry here, so a
 * new backend kind can never render as an empty tile.
 *
 * Both spellings of a kind ("lms.report_ready" and "report_ready") map identically (canonicalNotificationType).
 */
import { canonicalNotificationType } from '../../utils/notification-type';

export type NotifTone = 'rose' | 'amber' | 'emerald' | 'violet' | 'sky';

/** The inbox groups, in the order the side card lists them (after "All"). */
export type NotifGroup = 'critical' | 'late' | 'reports' | 'samples' | 'messages' | 'system';
export type NotifFilter = 'all' | NotifGroup;

export interface NotifGroupDef { id: NotifGroup; label: string; tone: NotifTone | 'slate'; }

export const NOTIF_GROUPS: readonly NotifGroupDef[] = [
  { id: 'critical', label: 'Critical results',  tone: 'rose' },
  { id: 'late',     label: 'Running late',      tone: 'amber' },
  { id: 'reports',  label: 'Reports & sharing', tone: 'emerald' },
  { id: 'samples',  label: 'Samples',           tone: 'sky' },
  { id: 'messages', label: 'Messages',          tone: 'violet' },
  { id: 'system',   label: 'System',            tone: 'slate' },
];

export const NOTIF_GROUP_LABEL: Record<NotifFilter, string> = {
  all: 'All', critical: 'Critical results', late: 'Running late', reports: 'Reports & sharing',
  samples: 'Samples', messages: 'Messages', system: 'System',
};

export type NotifIcon =
  | 'alert' | 'clock' | 'report' | 'report-x' | 'report-edit' | 'send' | 'eye' | 'tube' | 'tube-x' | 'box' | 'truck' | 'undo'
  | 'check' | 'message' | 'at' | 'user' | 'user-plus' | 'user-x' | 'wallet' | 'percent' | 'shield' | 'stock' | 'home'
  | 'calendar' | 'cpu' | 'refresh' | 'tasks' | 'ban' | 'edit' | 'unlock' | 'sliders' | 'bell';

/** SVG path data per icon (24 grid, stroked). Real elements, rendered by <pf-notif-icon> — never innerHTML. */
export const NOTIF_ICON_PATHS: Record<NotifIcon, readonly string[]> = {
  alert: ['M12 9v4', 'M12 17h.01', 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'],
  clock: ['M12 7v5l3 2', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z'],
  report: ['M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z', 'M14 3v6h6', 'M9 15l2 2 4-4'],
  'report-x': ['M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z', 'M14 3v6h6', 'M10 13l4 4', 'M14 13l-4 4'],
  'report-edit': ['M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z', 'M14 3v6h6', 'M9 17h6', 'M9 13h3'],
  send: ['M22 2 11 13', 'M22 2l-7 20-4-9-9-4z'],
  eye: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  tube: ['M9 3h6', 'M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3'],
  'tube-x': ['M9 3h6', 'M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3', 'M9.5 15l5 4'],
  box: ['M21 8 12 3 3 8v8l9 5 9-5z', 'M3 8l9 5 9-5', 'M12 13v8'],
  truck: ['M1 6h13v10H1z', 'M14 9h4l3 3v4h-7', 'M5.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', 'M17.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z'],
  undo: ['M3 7v6h6', 'M21 17a9 9 0 0 0-15-6.7L3 13'],
  check: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M8.5 12.5l2.5 2.5 4.5-5'],
  message: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  at: ['M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8'],
  user: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  'user-plus': ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M19 8v6', 'M22 11h-6'],
  'user-x': ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M17 8l5 5', 'M22 8l-5 5'],
  wallet: ['M3 7a2 2 0 0 1 2-2h13v4', 'M3 7v11a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z', 'M16 14h.01'],
  percent: ['M19 5 5 19', 'M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'],
  stock: ['M20 7H4a1 1 0 0 0-1 1v3h18V8a1 1 0 0 0-1-1z', 'M5 11v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8', 'M10 15h4'],
  home: ['M3 11 12 3l9 8', 'M5 10v10h14V10', 'M10 20v-6h4v6'],
  calendar: ['M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M16 3v4', 'M8 3v4', 'M3 11h18'],
  cpu: ['M6 6h12v12H6z', 'M9 9h6v6H9z', 'M9 2v4', 'M15 2v4', 'M9 18v4', 'M15 18v4', 'M2 9h4', 'M2 15h4', 'M18 9h4', 'M18 15h4'],
  refresh: ['M21 12a9 9 0 0 0-15-6.7L3 8', 'M3 3v5h5', 'M3 12a9 9 0 0 0 15 6.7L21 16', 'M21 21v-5h-5'],
  tasks: ['M9 6h12', 'M9 12h12', 'M9 18h12', 'M3 6l1.5 1.5L7 5', 'M3 12l1.5 1.5L7 11', 'M3 18l1.5 1.5L7 17'],
  ban: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M5.6 5.6l12.8 12.8'],
  edit: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
  unlock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 7.5-2'],
  sliders: ['M4 6h10', 'M18 6h2', 'M4 12h4', 'M12 12h8', 'M4 18h12', 'M14 4v4', 'M8 10v4', 'M16 16v4'],
  bell: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'],
};

export interface NotifKindMeta {
  group: NotifGroup;
  icon: NotifIcon;
  tone: NotifTone;
  /** Short plain label ("Report ready"); also the screen-reader name of the icon tile. */
  label: string;
}

const m = (group: NotifGroup, icon: NotifIcon, tone: NotifTone, label: string): NotifKindMeta => ({ group, icon, tone, label });

/**
 * EVERY kind in NotificationCatalog.cs (62 on 2026-11-19). Grouped:
 *  - Critical results: the two patient-safety kinds (Critical flag).
 *  - Running late:     every "overdue" / waiting-too-long alert about work or money that is behind.
 *  - Reports & sharing: reports and what happens to them (ready, amended, blocked, delivered, viewed).
 *  - Samples:          the tube / order / bench workflow (collect, dispatch, reject, assign, validate, home visits).
 *  - Messages:         people talking to you (a test's comment thread, a mention in Files).
 *  - System:           billing, stock, WhatsApp account, staff and platform notices.
 */
export const KIND_META: Readonly<Record<string, NotifKindMeta>> = {
  // Critical results
  critical_value:                    m('critical', 'alert', 'rose', 'Critical result'),
  critical_unvalidated:              m('critical', 'alert', 'rose', 'Critical result unvalidated'),
  // Running late
  dispatch_not_received:             m('late', 'truck', 'amber', 'Dispatched, not received'),
  billed_not_collected:              m('late', 'tube', 'amber', 'Billed, not collected'),
  tat_breach:                        m('late', 'clock', 'amber', 'TAT breach'),
  culture_stage_overdue:             m('late', 'clock', 'amber', 'Culture stage overdue'),
  validation_overdue:                m('late', 'clock', 'amber', 'Validation overdue'),
  report_undelivered:                m('late', 'report', 'amber', 'Report awaiting delivery'),
  balance_overdue:                   m('late', 'wallet', 'amber', 'Unpaid balance'),
  refund_overdue:                    m('late', 'wallet', 'amber', 'Refund pending'),
  appointment_wait_overdue:          m('late', 'clock', 'amber', 'Patient waiting'),
  // Reports & sharing
  report_ready:                      m('reports', 'report', 'emerald', 'Report ready'),
  urgent_report_ready:               m('reports', 'report', 'amber', 'Urgent report ready'),
  report_amended:                    m('reports', 'report-edit', 'sky', 'Amended report'),
  report_blocked:                    m('reports', 'report-x', 'rose', 'Report blocked'),
  report_delivered:                  m('reports', 'send', 'emerald', 'Report delivered'),
  report_viewed_by_patient:          m('reports', 'eye', 'emerald', 'Report viewed'),
  // Samples
  sample_ready_collection:           m('samples', 'tube', 'sky', 'New sample to collect'),
  stat_order_created:                m('samples', 'alert', 'rose', 'STAT order'),
  order_cancelled:                   m('samples', 'ban', 'rose', 'Order cancelled'),
  order_tests_modified:              m('samples', 'edit', 'sky', 'Order changed'),
  package_dispatched:                m('samples', 'box', 'sky', 'Package on its way'),
  dispatch_package_received:         m('samples', 'box', 'emerald', 'Package received'),
  sample_rejection:                  m('samples', 'tube-x', 'amber', 'Sample rejected'),
  tests_assigned:                    m('samples', 'tasks', 'sky', 'Work assigned'),
  validation_assigned:               m('samples', 'tasks', 'sky', 'Validation assigned'),
  test_assigned:                     m('samples', 'tasks', 'sky', 'Test delegated'),
  culture_lock_released:             m('samples', 'unlock', 'sky', 'Culture lock released'),
  instrument_unmatched_result:       m('samples', 'cpu', 'sky', 'Analyzer result unmatched'),
  result_awaiting_validation:        m('samples', 'check', 'sky', 'Awaiting validation'),
  result_rejected:                   m('samples', 'undo', 'rose', 'Result rejected'),
  result_edit_requested:             m('samples', 'undo', 'sky', 'Sent back for correction'),
  validation_reassigned:             m('samples', 'refresh', 'sky', 'Validation reassigned'),
  home_collection_assigned:          m('samples', 'home', 'sky', 'Home collection assigned'),
  home_collection_unassigned:        m('samples', 'home', 'amber', 'Home collection needs an agent'),
  home_collection_completed:         m('samples', 'home', 'emerald', 'Home visit completed'),
  appointment_auto_no_show:          m('samples', 'user-x', 'sky', 'No-show'),
  appointment_marked_urgent:         m('samples', 'alert', 'rose', 'Patient flagged urgent'),
  inventory_shortfall_on_collection: m('samples', 'stock', 'amber', 'Stock ran out'),
  // Messages
  result_comment_added:              m('messages', 'message', 'violet', 'Comment on a test'),
  office_mention:                    m('messages', 'at', 'violet', 'Mention'),
  // System
  bill_settled:                      m('system', 'wallet', 'emerald', 'Bill paid'),
  refund_owed:                       m('system', 'wallet', 'amber', 'Refund owed'),
  refund_issued:                     m('system', 'wallet', 'violet', 'Refund issued'),
  large_discount_applied:            m('system', 'percent', 'violet', 'Large discount'),
  discount_approval_requested:       m('system', 'percent', 'violet', 'Discount approval'),
  day_close_cash_variance:           m('system', 'wallet', 'amber', 'Cash variance'),
  whatsapp_payment_failed:           m('system', 'message', 'rose', 'WhatsApp payment'),
  whatsapp_spend_threshold:          m('system', 'message', 'amber', 'WhatsApp spend limit'),
  whatsapp_low_balance:              m('system', 'message', 'amber', 'WhatsApp budget'),
  whatsapp_credits_low:              m('system', 'message', 'amber', 'WhatsApp credits low'),
  whatsapp_credits_exhausted:        m('system', 'message', 'rose', 'WhatsApp credits used up'),
  inventory_low_stock:               m('system', 'stock', 'amber', 'Low stock'),
  inventory_batch_near_expiry:       m('system', 'stock', 'amber', 'Batch near expiry'),
  inventory_batch_expired:           m('system', 'stock', 'rose', 'Batch expired'),
  user_created:                      m('system', 'user-plus', 'violet', 'New staff account'),
  user_access_changed:               m('system', 'shield', 'violet', 'Access changed'),
  password_reset_by_admin:           m('system', 'shield', 'violet', 'Password reset'),
  role_permissions_changed:          m('system', 'shield', 'violet', 'Role updated'),
  workflow_activated:                m('system', 'sliders', 'violet', 'Workflow changed'),
  catalog_update_available:          m('system', 'refresh', 'violet', 'Catalogue update'),
  vendor_credit_threshold:           m('system', 'wallet', 'amber', 'Partner credit limit'),
};

/** A kind the catalog doesn't know yet (never throws): System group, plain bell, label from the key. */
const FALLBACK: NotifKindMeta = m('system', 'bell', 'violet', '');

export function kindMeta(type: string | null | undefined): NotifKindMeta {
  const key = canonicalNotificationType(type);
  return KIND_META[key] ?? { ...FALLBACK, label: key.replace(/_/g, ' ') };
}

export function groupOf(type: string | null | undefined): NotifGroup { return kindMeta(type).group; }
