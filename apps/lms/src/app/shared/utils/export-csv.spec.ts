import { toCsv } from './export-csv';

describe('toCsv', () => {
  it('serializes a simple header and data row', () => {
    const rows = [
      ['Name', 'Age', 'City'],
      ['Alice', '30', 'NYC'],
    ];
    expect(toCsv(rows)).toBe('Name,Age,City\r\nAlice,30,NYC');
  });

  it('preserves field order in the output', () => {
    const rows = [
      ['Z', 'A', 'M'],
      ['1', '2', '3'],
    ];
    expect(toCsv(rows)).toBe('Z,A,M\r\n1,2,3');
  });

  it('escapes commas by wrapping cells in quotes', () => {
    const rows = [
      ['Name', 'Address'],
      ['Smith, John', '123 Main St, USA'],
    ];
    expect(toCsv(rows)).toBe('Name,Address\r\n"Smith, John","123 Main St, USA"');
  });

  it('escapes double quotes by doubling them (RFC 4180)', () => {
    const rows = [
      ['Title', 'Quote'],
      ['Test', 'He said "hello"'],
    ];
    expect(toCsv(rows)).toBe('Title,Quote\r\nTest,"He said ""hello"""');
  });

  it('escapes newlines by wrapping cells in quotes', () => {
    const rows = [
      ['Line1', 'Line2'],
      ['First line\nSecond line', 'Normal'],
    ];
    expect(toCsv(rows)).toBe('Line1,Line2\r\n"First line\nSecond line",Normal');
  });

  it('escapes carriage returns by wrapping cells in quotes', () => {
    const rows = [
      ['Text'],
      ['Line\rReturn'],
    ];
    expect(toCsv(rows)).toBe('Text\r\n"Line\rReturn"');
  });

  it('handles empty rows (empty string for each cell)', () => {
    const rows = [
      ['', '', ''],
      ['Data', 'More', 'Data'],
    ];
    expect(toCsv(rows)).toBe(',,\r\nData,More,Data');
  });

  it('converts null to empty string and does not quote', () => {
    const rows = [
      ['Name', 'Value'],
      [null, 'Present'],
    ];
    expect(toCsv(rows)).toBe('Name,Value\r\n,Present');
  });

  it('converts undefined to empty string and does not quote', () => {
    const rows = [
      ['ID', 'Optional'],
      [undefined, 'Data'],
    ];
    expect(toCsv(rows)).toBe('ID,Optional\r\n,Data');
  });

  it('handles unicode characters (₹, emoji, accents) without escaping', () => {
    const rows = [
      ['Currency', 'Emoji', 'Accent'],
      ['₹500', '✓', 'Café'],
    ];
    expect(toCsv(rows)).toBe('Currency,Emoji,Accent\r\n₹500,✓,Café');
  });

  it('combines multiple escaping scenarios in one row', () => {
    const rows = [
      ['Name', 'Note', 'Price', 'Multiline'],
      ['Smith, Jr.', 'He said "yes"', '₹1,000', 'Line1\nLine2'],
    ];
    expect(toCsv(rows)).toBe(
      'Name,Note,Price,Multiline\r\n' +
      '"Smith, Jr.","He said ""yes""","₹1,000","Line1\nLine2"'
    );
  });

  it('serializes multiple data rows with consistent row separators', () => {
    const rows = [
      ['A', 'B'],
      ['1', '2'],
      ['3', '4'],
      ['5', '6'],
    ];
    expect(toCsv(rows)).toBe('A,B\r\n1,2\r\n3,4\r\n5,6');
  });

  it('converts non-string primitives to string (numbers, booleans)', () => {
    const rows = [
      ['ID', 'Active', 'Score'],
      [42, true, 3.14],
    ];
    expect(toCsv(rows)).toBe('ID,Active,Score\r\n42,true,3.14');
  });
});

// needs-harness: downloadCsv (DOM download)
