import { Pipe, PipeTransform } from '@angular/core';

/**
 * Formats a credit-wallet `outstanding` figure (charged − settled) into a
 * human phrase instead of a bare, confusing negative number:
 *   > 0  → "₹500 due"        (the partner owes us)
 *   < 0  → "₹200 in credit"  (the partner has prepaid / is in advance)
 *   = 0  → "Settled"
 * Used everywhere the wallet balance is shown (admin, cart, billing, finance).
 */
@Pipe({ name: 'walletOutstanding', standalone: true })
export class WalletOutstandingPipe implements PipeTransform {
  private readonly fmt = new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 2,
  });

  transform(outstanding: number | null | undefined): string {
    const n = typeof outstanding === 'number' ? outstanding : 0;
    if (Math.abs(n) < 0.005) return 'Settled';
    return n > 0 ? `${this.fmt.format(n)} due` : `${this.fmt.format(-n)} in credit`;
  }
}
