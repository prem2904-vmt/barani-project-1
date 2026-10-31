import type { PfSelectOption } from '../../primitives/select.component';
import type { Order } from '../../models/order.model';

/** GET /api/orders/{id}/referral — the order's referral for "Edit referral". */
export interface OrderReferral {
  orderId: string;
  orderNumber?: string | null;
  status?: string | null;
  patientName?: string | null;
  refDoctorId?: string | null;
  refDoctorName?: string | null;
  refHospitalName?: string | null;
  referralSourceType?: string | null;
  /** Allowed source types (server list — the one home is ReferralSourceTypes). */
  sourceTypes?: string[];
  /** The live released final, when one is out (saving re-issues it amended). */
  releasedReportId?: string | null;
  releasedReportDelivered?: boolean;
}

/** PATCH /api/orders/{id}/referral response. */
export interface ReferralSaveResult {
  order?: Order | null;
  /** False when the values were already the same (nothing written). */
  changed: boolean;
  /** A released final now prints a different referrer ⇒ re-issued amended. */
  reportAmended: boolean;
  amendedReportId?: string | null;
  /** The referral saved but the amended report could not be issued. */
  amendError?: string | null;
}

/** One referring-doctor match from GET /api/test-picker/doctors/options. */
export interface ReferralDoctorOption {
  doctorId?: string | null;
  name: string;
  hospitalName?: string | null;
}

/** The edit form's state. `doctorId` is set only when a directory doctor was
 *  picked (a typed name links nothing — the server keeps the old link only
 *  when the name is unchanged). */
export interface ReferralForm {
  doctorId: string | null;
  doctor: string;
  hospital: string;
  sourceType: string;
}

/** Fallback when an older server sends no list (mirror of ReferralSourceTypes.All). */
export const REFERRAL_SOURCE_TYPES = ['Doctor', 'Hospital', 'Walk-in', 'Corporate', 'Camp', 'Online'] as const;

/** Sentinel option values (an empty string means "none" for every field). */
export const NONE = '';
const DOC_KEY = 'doc:';

export function formFrom(r: OrderReferral | null | undefined): ReferralForm {
  return {
    doctorId: r?.refDoctorId ?? null,
    doctor: (r?.refDoctorName ?? '').trim(),
    hospital: (r?.refHospitalName ?? '').trim(),
    sourceType: (r?.referralSourceType ?? '').trim(),
  };
}

const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ');

/** True when the form differs from what the order carries now — Save is
 *  disabled otherwise (the server treats a same-value save as a no-op too). */
export function referralChanged(before: ReferralForm, now: ReferralForm): boolean {
  return norm(before.doctor) !== norm(now.doctor)
    || norm(before.hospital) !== norm(now.hospital)
    || norm(before.sourceType) !== norm(now.sourceType)
    || (now.doctorId != null && now.doctorId !== before.doctorId);
}

/** The PATCH body. The source type is always sent ('' clears it); the
 *  doctor id only for a directory pick. */
export function referralPayload(f: ReferralForm, reason: string): Record<string, unknown> {
  return {
    refDoctorId: f.doctorId || null,
    refDoctorName: norm(f.doctor) || null,
    refHospitalName: norm(f.hospital) || null,
    referralSourceType: norm(f.sourceType),
    reason: reason.trim() || null,
  };
}

/** Option value of a doctor row: one per (doctor, hospital) affiliation. */
export function doctorKey(o: ReferralDoctorOption): string {
  return DOC_KEY + [o.doctorId ?? '', o.name, o.hospitalName ?? ''].map(encodeURIComponent).join('|');
}

/** Read a doctor option value back. A value without the prefix is a TYPED
 *  name (the select's "Add …" row) — a new referring doctor, no directory id. */
export function parseDoctorKey(v: string): ReferralDoctorOption | null {
  if (v === NONE) return null;
  if (!v.startsWith(DOC_KEY)) return { doctorId: null, name: v.trim(), hospitalName: null };
  const [id, name, hospital] = v.slice(DOC_KEY.length).split('|').map(decodeURIComponent);
  return { doctorId: id || null, name: name ?? '', hospitalName: hospital || null };
}

/** The doctor select's options: "No referring doctor", the current doctor
 *  (so the trigger always shows it, even when the search list doesn't have
 *  it), then the server matches labelled "Dr X · Hospital Y". */
export function doctorOptions(list: ReadonlyArray<ReferralDoctorOption | string> | null | undefined,
                              current: ReferralForm): PfSelectOption<string>[] {
  const rows = (list ?? [])
    .map(x => (typeof x === 'string' ? { name: x, hospitalName: null, doctorId: null } : x))
    .filter(x => !!x?.name?.trim());
  const opts: PfSelectOption<string>[] = [{ value: NONE, label: 'No referring doctor', hint: 'Self referral' }];
  const cur = currentDoctorValue(current);
  if (cur !== NONE && !rows.some(r => doctorKey(r) === cur)) opts.push({ value: cur, label: current.doctor });
  for (const r of rows) {
    const h = r.hospitalName?.trim();
    opts.push({ value: doctorKey(r), label: h ? `${r.name} · ${h}` : r.name });
  }
  return opts;
}

/** The doctor select's value for the form: the exact directory row when the
 *  form holds one, else the typed name. */
export function currentDoctorValue(f: ReferralForm): string {
  if (!f.doctor.trim()) return NONE;
  return f.doctorId ? doctorKey({ doctorId: f.doctorId, name: f.doctor, hospitalName: f.hospital || null }) : f.doctor;
}

/** Hospital options: "No hospital", the current one, then the matches. */
export function hospitalOptions(names: ReadonlyArray<string> | null | undefined, current: string): PfSelectOption<string>[] {
  const list = (names ?? []).filter(n => !!n?.trim());
  const opts: PfSelectOption<string>[] = [{ value: NONE, label: 'No hospital' }];
  const cur = current.trim();
  if (cur && !list.some(n => n.trim().toLowerCase() === cur.toLowerCase())) opts.push({ value: cur, label: cur });
  for (const n of list) opts.push({ value: n, label: n });
  return opts;
}

export function sourceOptions(types: ReadonlyArray<string> | null | undefined): PfSelectOption<string>[] {
  const list = types?.length ? types : REFERRAL_SOURCE_TYPES;
  return [{ value: NONE, label: 'Not set' }, ...list.map(t => ({ value: t, label: t }))];
}

/** "Dr X · City Hospital" / "Self referral" — the one-line summary. */
export function referralSummary(f: Pick<ReferralForm, 'doctor' | 'hospital'>): string {
  const d = f.doctor.trim();
  const h = f.hospital.trim();
  if (!d && !h) return 'Self referral';
  return [d || 'No doctor', h].filter(Boolean).join(' · ');
}

/** Who may edit a referral — the server's gate (modify_order). */
export const EDIT_REFERRAL_PERM = 'modify_order';
