import { ADMIN_PERMS } from '../../../core/auth/route-access';

/**
 * The OPD work areas, pre-wired ONCE by the foundation (OPD dark build). The
 * OPD home hub renders these tiles; the shell's More menu has a single "OPD"
 * entry (MORE_NAV 'm-opd' → /opd) and doctors get "Consults" (DOCTOR_NAV →
 * /opd/consult) — all behind the OPD gate. Feature agents never edit the
 * shell nav; if an area needs a new entry point, it goes here (foundation /
 * integrator only).
 */
export interface OpdArea {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  iconPath: string;
  /** OR-semantics; empty = any signed-in user who can see OPD. */
  permissions?: string[];
}

const FRONT = ['create_order', 'register_patient', 'view_order'];

export const OPD_AREAS: OpdArea[] = [
  { id: 'desk', title: 'OPD desk', subtitle: "Today's visits, booking and billing", href: '/opd/desk', permissions: FRONT,
    iconPath: 'M3 7h18v12H3zM3 11h18M8 3v4M16 3v4' },
  { id: 'book', title: 'Book a visit', subtitle: 'Patient, doctor, purpose, tests, vitals', href: '/opd/visit/new', permissions: FRONT,
    iconPath: 'M12 5v14M5 12h14' },
  { id: 'queue', title: 'Token queue', subtitle: 'Waiting patients per doctor', href: '/opd/queue', permissions: FRONT,
    iconPath: 'M4 6h16M4 12h10M4 18h6' },
  { id: 'vitals', title: 'Vitals station', subtitle: 'Capture vitals before the doctor', href: '/opd/vitals', permissions: FRONT,
    iconPath: 'M3 12h4l3-7 4 14 3-7h4' },
  { id: 'consult', title: 'Consults', subtitle: "The doctor's patients for today", href: '/opd/consult',
    iconPath: 'M11 2v2M5 2v2M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1M8 15a6 6 0 0 0 12 0v-3M20 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z' },
  { id: 'pharmacy', title: 'Pharmacy', subtitle: 'Dispense prescriptions', href: '/opd/pharmacy',
    iconPath: 'M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7ZM7 7l7 7' },
  { id: 'counter', title: 'Walk-in counter', subtitle: 'Counter sales without a visit', href: '/opd/pharmacy/counter',
    iconPath: 'M3 9h18l-2 11H5L3 9ZM8 9V6a4 4 0 0 1 8 0v3' },
  { id: 'stock', title: 'Pharmacy stock', subtitle: 'Batches, expiry, suppliers, orders', href: '/opd/pharmacy/stock',
    iconPath: 'M21 8 12 3 3 8l9 5 9-5ZM3 8v8l9 5 9-5V8M12 13v8' },
  { id: 'settings', title: 'OPD settings', subtitle: 'Departments, services, forms, flow', href: '/admin/opd', permissions: ADMIN_PERMS,
    iconPath: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4 12h2M18 12h2M12 4v2M12 18v2' },
];
