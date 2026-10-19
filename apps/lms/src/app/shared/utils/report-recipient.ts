/**
 * Who a report is SENT to (share sheet name, WhatsApp greeting + number).
 *
 * The stored PDF is immutable and prints the snapshot taken when it was
 * issued; but a message sent TODAY goes to the patient as they are on file
 * today — a corrected name / mobile must reach it (owner, 2026-09-30:
 * "rename X→Y, regenerate → still X"). The report reads
 * (GET /api/reports/{id}, by-order) carry the CURRENT patient as `patient`;
 * the snapshot is only the fallback for older API responses.
 */
export interface ReportRecipient { name: string | null; phone: string | null }

interface CurrentPatient { displayName?: string | null; firstName?: string | null; fathersName?: string | null; phone?: string | null; guardianPhone?: string | null }
interface SnapshotPatient { displayName?: string | null; name?: string | null; phone?: string | null }

export function currentRecipient(
  report: { patient?: CurrentPatient | null } | null | undefined,
  snapshot: SnapshotPatient | null | undefined,
): ReportRecipient {
  const cur = report?.patient ?? null;
  const curName = cur
    ? (cur.displayName || [cur.firstName, cur.fathersName].filter(s => !!s && s.trim()).join(' ')).trim()
    : '';
  const name = curName || snapshot?.displayName || snapshot?.name || null;
  const phone = (cur ? cur.phone || cur.guardianPhone : null) || snapshot?.phone || null;
  return { name: name || null, phone };
}
