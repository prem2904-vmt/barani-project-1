/**
 * OPD API map (OPD dark build) — the ONE list of OPD endpoint prefixes the UI
 * calls, mirroring prefrontal-mw Controllers/Opd/*. Every one of them answers
 * 404 unless the caller is OPD-allowed (server OpdAccess), so a screen must
 * only call them behind the OPD gate (all OPD routes already are).
 * Agents add their endpoint paths under their own key; call them through the
 * app's ApiService (core/services/api.service.ts) — no second HTTP client.
 */
export const OPD_API = {
  /** Agent A — OPD Master (departments, services, doctor prices, forms, workflow). */
  admin: '/api/opd/admin',
  /** Existing: follow-up policy + (foundation) workflow / queue / pharmacy JSON. */
  settings: '/api/opd/settings',
  /** Existing: doctors with a DoctorProfile (fee grid). */
  doctors: '/api/doctors',
  /** Agent B — visits (book, fee quote, bill, payment, desk lab order). */
  visits: '/api/opd/visits',
  /** Agent B — vitals capture. */
  vitals: '/api/opd/vitals',
  /** Agent B — token queue. */
  queue: '/api/opd/queue',
  /** Agent C — consult record, Rx, investigations, allergies. */
  consult: '/api/opd/consult',
  /** Agent D — drugs, dispensing, counter, stock, suppliers, PO, returns, H1. */
  pharmacy: '/api/opd/pharmacy',
  /** Legacy (pre-dark) consult rows — superseded by visits + consult. */
  legacyConsultations: '/api/opd/consultations',
} as const;
