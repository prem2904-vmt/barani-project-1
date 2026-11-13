/**
 * Email sharing (owner 2026-11-13): the SERVER sends the report / invoice PDF
 * by email (POST /api/reports/by-order/{orderId}/email, POST /api/billing/{billId}/email)
 * and answers who it went to and who it skipped. The toasts say exactly that —
 * never a "sent" the server did not confirm.
 */
export type EmailRecipient = 'patient' | 'doctor' | 'both';
export type EmailKind = 'patient' | 'doctor';

export interface EmailSendResult {
  sent: { kind: EmailKind; address: string }[];
  skipped: { kind: EmailKind; reason: string }[];
}

export interface EmailToast { tone: 'success' | 'warning' | 'error'; text: string }

/** Plain words for a server skip reason (codes or words — words pass through). */
export function emailSkipReason(reason: string | null | undefined): string {
  const r = (reason ?? '').trim();
  switch (r.toLowerCase()) {
    case '': return 'it could not be sent';
    case 'no_email': case 'no_address': case 'missing_email': case 'no-email': return 'no email address on file';
    case 'invalid_email': case 'invalid_address': return 'the email address on file is not valid';
    case 'opted_out': case 'opt_out': case 'optout': return 'they asked not to get messages';
    case 'not_ready': case 'no_report': return 'the report is not ready yet';
    case 'not_configured': return 'email is not set up for this lab yet';
    case 'disabled': case 'module_disabled': return 'email sharing is turned off';
    default: return /^[a-z_]+$/.test(r) ? r.replace(/_/g, ' ') : r;
  }
}

const who = (k: EmailKind) => (k === 'doctor' ? 'the referral doctor' : 'the patient');

/**
 * The toasts for one server answer. `asked` is what the person picked: with
 * 'both', a doctor without an email is not news (the doctor copy is only "when
 * they have one"), so that skip stays quiet as long as the patient got it.
 */
export function emailOutcomeToasts(res: EmailSendResult | null | undefined, asked: EmailRecipient, what: 'report' | 'invoice' = 'report'): EmailToast[] {
  const sent = res?.sent ?? [];
  const skipped = res?.skipped ?? [];
  const out: EmailToast[] = [];
  const noun = what === 'invoice' ? 'Invoice' : 'Report';
  if (sent.length) {
    const p = sent.find(s => s.kind === 'patient');
    const d = sent.find(s => s.kind === 'doctor');
    const parts: string[] = [];
    if (p) parts.push(p.address || 'the patient');
    if (d) parts.push(p ? `the referral doctor (${d.address})` : `the referral doctor${d.address ? ` (${d.address})` : ''}`);
    out.push({ tone: 'success', text: `${noun} emailed to ${parts.join(' and ')}` });
  }
  for (const s of skipped) {
    const quietDoctor = asked === 'both' && s.kind === 'doctor' && sent.length > 0 && /^(no_email|no_address|missing_email|no-email)$/i.test(s.reason ?? '');
    if (quietDoctor) continue;
    out.push({ tone: sent.length ? 'warning' : 'error', text: `Not emailed to ${who(s.kind)}: ${emailSkipReason(s.reason)}` });
  }
  if (!out.length) out.push({ tone: 'error', text: `The ${noun.toLowerCase()} was not emailed` });
  return out;
}
