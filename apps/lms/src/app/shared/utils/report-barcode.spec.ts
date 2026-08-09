import { reportBarcodeValue } from './report-pdf';

/**
 * Guards the report barcode against the regression that kept recurring.
 *
 * The bug was never a single wrong line — it was two silent fall-backs. The
 * renderer would substitute the order GUID (or the report id) when the
 * snapshot had no order number, and a decorative placeholder drew bars that
 * encoded nothing at all. Both produced something that LOOKED like a barcode,
 * so every fix appeared to work while the printed code was still unscannable
 * or meaningless.
 *
 * The rule these tests pin down: the barcode carries the human order number,
 * or it is not drawn. `OrderLookupService.ResolveAsync` matches that value
 * exactly, so a scan opens the visit.
 */
describe('reportBarcodeValue', () => {
  it('encodes the human order number', () => {
    expect(reportBarcodeValue({ order: { orderNumber: 'LAB-2608-000049' } } as never))
      .toBe('LAB-2608-000049');
  });

  it('trims surrounding whitespace', () => {
    expect(reportBarcodeValue({ order: { orderNumber: '  LAB-2608-000049 ' } } as never))
      .toBe('LAB-2608-000049');
  });

  it('returns null rather than falling back to the order GUID', () => {
    // The regression: a GUID scans, so nothing looked broken — but staff saw a
    // random string and it is not the visit's order number.
    expect(reportBarcodeValue({
      order: { id: '5706bdd9-78ab-4c2e-9f10-0f1f2a3b4c5d' },
    } as never)).toBeNull();
  });

  it('returns null for an empty or whitespace-only order number', () => {
    expect(reportBarcodeValue({ order: { orderNumber: '   ' } } as never)).toBeNull();
    expect(reportBarcodeValue({ order: { orderNumber: '' } } as never)).toBeNull();
  });

  it('returns null when the snapshot carries no order at all', () => {
    expect(reportBarcodeValue({} as never)).toBeNull();
  });
});
