import { addDays, istDateOf, labToday } from './lab-clock';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** The day heading for a notification: TODAY · YESTERDAY · 18 NOV (IST business day, the lab's one clock). */
export function notificationDayLabel(createdAt: string, now: Date = new Date()): string {
  const day = istDateOf(createdAt);
  const today = labToday(now);
  if (day === today) return 'TODAY';
  const [, m, d] = day.split('-').map(Number);
  const stamp = `${d} ${MONTHS[m - 1]}`;
  return day === addDays(today, -1) ? `YESTERDAY · ${stamp}` : stamp;
}
