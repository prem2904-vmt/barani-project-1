import {
  STOCK_LEVEL_LABEL, STOCK_LEVEL_TONE, dotCell, expiryView, itemCell, ledgerWord, linkBarcodeBody, linkableCode,
  qty, signedQty, stockLevel, testsCovered,
} from './inventory-view';

describe('inventory-view', () => {
  it('stockLevel: out at 0, low at / under reorder (or server flag), else in stock', () => {
    expect(stockLevel({ onHand: 0, reorderLevel: 10 })).toBe('out');
    expect(stockLevel({ onHand: 10, reorderLevel: 10 })).toBe('low');
    expect(stockLevel({ onHand: 50, reorderLevel: 10, lowStock: true })).toBe('low');
    expect(stockLevel({ onHand: 11, reorderLevel: 10 })).toBe('ok');
  });

  it('levels read as neutral words; colour only as the dot tone (no green for "in stock")', () => {
    expect(STOCK_LEVEL_LABEL).toEqual({ ok: 'In stock', low: 'Low', out: 'Out of stock' });
    expect(STOCK_LEVEL_TONE).toEqual({ ok: '', low: 'warn', out: 'bad' });
  });

  it('expiryView: expired red, otherwise days left in amber', () => {
    expect(expiryView(-3)).toEqual({ label: 'Expired', tone: 'bad' });
    expect(expiryView(0)).toEqual({ label: 'Expires today', tone: 'warn' });
    expect(expiryView(1)).toEqual({ label: '1 day left', tone: 'warn' });
    expect(expiryView(12)).toEqual({ label: '12 days left', tone: 'warn' });
  });

  it('ledgerWord + signedQty put the server transaction types into words', () => {
    expect(ledgerWord('receipt')).toBe('Received');
    expect(ledgerWord('consumption')).toBe('Used');
    expect(ledgerWord('wastage')).toBe('Written off');
    expect(ledgerWord('count')).toBe('Counted');
    expect(ledgerWord('transfer')).toBe('Transfer');
    expect(ledgerWord(null)).toBe('Change');
    expect(signedQty(500)).toBe('+500');
    expect(signedQty(-2.5)).toBe('−2.5');
    expect(signedQty(0)).toBe('0');
  });

  it('testsCovered: whole tests the stock still covers; null when it cannot be said', () => {
    expect(testsCovered(500, 2)).toBe(250);
    expect(testsCovered(5, 2)).toBe(2);
    expect(testsCovered(0, 1)).toBe(0);
    expect(testsCovered(undefined, 1)).toBeNull();
    expect(testsCovered(10, 0)).toBeNull();
  });

  it('linkableCode: a GS1 scan links its GTIN (what the server matches first), else the raw code', () => {
    expect(linkableCode('0108901234567890172703311010AB', { gtin: '08901234567890' })).toBe('08901234567890');
    expect(linkableCode(' ABC123 ', { gtin: null })).toBe('ABC123');
    expect(linkableCode('XYZ')).toBe('XYZ');
  });

  it('linkBarcodeBody keeps every item field and only sets the barcode (the server upsert)', () => {
    expect(linkBarcodeBody({ id: 'i1', sku: 'S', barcode: 'OLD', name: 'N', category: 'kit', uom: 'test', reorderLevel: 5, nearExpiryDays: 45, isActive: false }, 'NEW'))
      .toEqual({ id: 'i1', sku: 'S', barcode: 'NEW', name: 'N', category: 'kit', uom: 'test', reorderLevel: 5, nearExpiryDays: 45, isActive: false });
    expect(linkBarcodeBody({ id: 'i2', sku: 'S2', name: 'N2', uom: 'piece', reorderLevel: 0 }, 'C'))
      .toEqual({ id: 'i2', sku: 'S2', barcode: 'C', name: 'N2', category: 'consumable', uom: 'piece', reorderLevel: 0, nearExpiryDays: 30, isActive: true });
  });

  it('grid cells are built with textContent (no HTML injection) and use the kit dot', () => {
    const c = itemCell('<b>x</b>', 'SKU · kit');
    expect(c.querySelector('b')).toBeNull();
    expect(c.querySelector('.inv-cell__name')!.textContent).toBe('<b>x</b>');
    expect(c.querySelector('.inv-cell__meta')!.textContent).toBe('SKU · kit');
    expect(itemCell('A', '').querySelector('.inv-cell__meta')).toBeNull();
    const d = dotCell('Low', 'warn');
    expect(d.className).toBe('nd-sdot');
    expect(d.getAttribute('data-tone')).toBe('warn');
    expect(dotCell('In stock', '').hasAttribute('data-tone')).toBe(false);
  });

  it('qty trims to two decimals', () => {
    expect(qty(12.5)).toBe('12.5');
    expect(qty(3)).toBe('3');
    expect(qty(null)).toBe('0');
  });
});
