import { bankDetailsLine } from './bank-details';

describe('bankDetailsLine — the ONE bank line a bill prints', () => {
  it('joins the filled fields of the structured card in a fixed order', () => {
    expect(bankDetailsLine({ bankAccountName: 'Arun Labs', bankAccountNumber: '1234567890', bankIfsc: 'HDFC0001234', bankName: 'HDFC Bank' }))
      .toBe('Arun Labs · A/c 1234567890 · IFSC HDFC0001234 · HDFC Bank');
  });
  it('skips empty and blank fields', () => {
    expect(bankDetailsLine({ bankAccountNumber: ' 99 ', bankName: '  ' })).toBe('A/c 99');
  });
  it('is empty when nothing is filled (the bill then keeps its saved text)', () => {
    expect(bankDetailsLine({})).toBe('');
    expect(bankDetailsLine(null)).toBe('');
  });
});
