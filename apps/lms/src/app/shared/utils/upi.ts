/**
 * UPI deep-link builder.
 *
 * `upi://pay?...` is the standard UPI intent understood by Google Pay, PhonePe,
 * Paytm, BHIM and every UPI app. Opening it (a tap on a phone) launches the
 * user's UPI app with the payee address + amount prefilled — the same idea as
 * the wa.me WhatsApp link opening WhatsApp. The same string encoded as a QR is
 * scannable from another device to pay.
 *
 * Only the payee address (`pa`) is required. When an amount is given it's fixed
 * in the app; omit it to let the payer type the amount.
 */
export function upiLink(
  vpa: string,
  payeeName?: string | null,
  amount?: number | null,
  note?: string | null,
): string {
  const params = new URLSearchParams();
  params.set('pa', vpa.trim());
  if (payeeName && payeeName.trim()) params.set('pn', payeeName.trim());
  if (amount != null && amount > 0) params.set('am', amount.toFixed(2));
  if (note && note.trim()) params.set('tn', note.trim());
  params.set('cu', 'INR');
  return `upi://pay?${params.toString()}`;
}

/** Basic sanity check for a UPI VPA (handle@bank). Not exhaustive — the UPI
 *  app does the real validation — just catches obvious typos before we build a
 *  link/QR the payer can't use. */
export function isLikelyVpa(vpa: string | null | undefined): boolean {
  return !!vpa && /^[a-z0-9._-]{2,}@[a-z][a-z0-9.]{1,}$/i.test(vpa.trim());
}
