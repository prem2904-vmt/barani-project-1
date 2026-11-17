/** The structured bank-account fields of the billing config (the ONE home of the lab's bank details). */
export interface BankFields {
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
  bankIfsc?: string | null;
  bankName?: string | null;
}

/**
 * The one printed line a bill shows for the lab's bank, built from the structured Bank account card
 * ("Name · A/c 1234 · IFSC HDFC0001 · HDFC Bank"). Empty when no field is filled — then the bill keeps whatever
 * text it already printed. Pure, so the bill, its preview and the billing page can never word it two ways.
 */
export function bankDetailsLine(c: BankFields | null | undefined): string {
  if (!c) return '';
  const part = (v: string | null | undefined) => (v ?? '').trim();
  const parts = [
    part(c.bankAccountName),
    part(c.bankAccountNumber) ? `A/c ${part(c.bankAccountNumber)}` : '',
    part(c.bankIfsc) ? `IFSC ${part(c.bankIfsc)}` : '',
    part(c.bankName),
  ].filter(Boolean);
  return parts.join(' · ');
}
