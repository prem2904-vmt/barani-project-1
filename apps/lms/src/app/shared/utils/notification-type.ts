/**
 * One canonical key per notification type (audit M20). The backend's
 * NotificationCatalog key is the bare snake_case form ("report_ready"); rows
 * and pushes written before the fix carry a legacy "lms." prefix
 * ("lms.report_ready"). Everything that matches on a type — the bell's
 * icon / tone / label, a tapped push's route — goes through this first, so
 * both spellings render and route the same until the backfill has run.
 */
export const LEGACY_NOTIFICATION_PREFIX = 'lms.';

export function canonicalNotificationType(type: string | null | undefined): string {
  const t = (type ?? '').trim();
  return t.toLowerCase().startsWith(LEGACY_NOTIFICATION_PREFIX) ? t.slice(LEGACY_NOTIFICATION_PREFIX.length) : t;
}
