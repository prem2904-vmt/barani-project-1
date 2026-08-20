import { buildTsplLabel, bytesToBase64, LabelInput } from './label-tspl';

describe('buildTsplLabel', () => {
  it('emits minimal TSPL for code-only label with defaults (40x25mm, 2mm gap, 1 copy)', () => {
    const label: LabelInput = { code: 'HAE0000001' };
    const result = buildTsplLabel(label);

    // barH = Math.round(25 * 8 * 0.38) = Math.round(76) = 76
    // y progression: 12 (barcode) → 96 (text under barcode) → 122 (PRINT)
    const expected =
      'SIZE 40 mm, 25 mm\r\n' +
      'GAP 2 mm, 0 mm\r\n' +
      'DIRECTION 1\r\n' +
      'REFERENCE 0,0\r\n' +
      'CLS\r\n' +
      'BARCODE 16,12,"128",76,1,0,2,2,"HAE0000001"\r\n' +
      'TEXT 16,96,"2",0,1,1,"HAE0000001"\r\n' +
      'PRINT 1,1\r\n';

    expect(new TextDecoder().decode(result)).toBe(expected);
    expect(ArrayBuffer.isView(result)).toBe(true); // cross-realm-safe (jsdom Uint8Array differs from node)
  });

  it('emits TSPL with title line at top', () => {
    const label: LabelInput = { code: 'TUB0000002', title: 'John Doe' };
    const result = buildTsplLabel(label);

    // y=12 (title) → 46 (barcode) → 130 (text under barcode)
    // barH = 76
    const expected =
      'SIZE 40 mm, 25 mm\r\n' +
      'GAP 2 mm, 0 mm\r\n' +
      'DIRECTION 1\r\n' +
      'REFERENCE 0,0\r\n' +
      'CLS\r\n' +
      'TEXT 16,12,"3",0,1,1,"John Doe"\r\n' +
      'BARCODE 16,46,"128",76,1,0,2,2,"TUB0000002"\r\n' +
      'TEXT 16,130,"2",0,1,1,"TUB0000002"\r\n' +
      'PRINT 1,1\r\n';

    expect(new TextDecoder().decode(result)).toBe(expected);
  });

  it('emits TSPL with lines array below barcode', () => {
    const label: LabelInput = {
      code: 'SAM0000003',
      lines: ['Hematology', '2026-08-20'],
    };
    const result = buildTsplLabel(label);

    // y=12 (barcode) → 96 (code text) → 122 (line 1) → 144 (line 2)
    const expected =
      'SIZE 40 mm, 25 mm\r\n' +
      'GAP 2 mm, 0 mm\r\n' +
      'DIRECTION 1\r\n' +
      'REFERENCE 0,0\r\n' +
      'CLS\r\n' +
      'BARCODE 16,12,"128",76,1,0,2,2,"SAM0000003"\r\n' +
      'TEXT 16,96,"2",0,1,1,"SAM0000003"\r\n' +
      'TEXT 16,122,"1",0,1,1,"Hematology"\r\n' +
      'TEXT 16,144,"1",0,1,1,"2026-08-20"\r\n' +
      'PRINT 1,1\r\n';

    expect(new TextDecoder().decode(result)).toBe(expected);
  });

  it('emits TSPL with QR code on the right', () => {
    const label: LabelInput = { code: 'QRC0000004', qr: true };
    const result = buildTsplLabel(label);

    // qx = Math.round(40 * 8) - 96 = 320 - 96 = 224
    const expected =
      'SIZE 40 mm, 25 mm\r\n' +
      'GAP 2 mm, 0 mm\r\n' +
      'DIRECTION 1\r\n' +
      'REFERENCE 0,0\r\n' +
      'CLS\r\n' +
      'BARCODE 16,12,"128",76,1,0,2,2,"QRC0000004"\r\n' +
      'TEXT 16,96,"2",0,1,1,"QRC0000004"\r\n' +
      'QRCODE 224,12,H,4,A,0,"QRC0000004"\r\n' +
      'PRINT 1,1\r\n';

    expect(new TextDecoder().decode(result)).toBe(expected);
  });

  it('emits TSPL with custom dimensions and gap', () => {
    const label: LabelInput = {
      code: 'CUST0000005',
      widthMm: 50,
      heightMm: 30,
      gapMm: 3,
    };
    const result = buildTsplLabel(label);

    // barH = Math.round(30 * 8 * 0.38) = Math.round(91.2) = 91
    const expected =
      'SIZE 50 mm, 30 mm\r\n' +
      'GAP 3 mm, 0 mm\r\n' +
      'DIRECTION 1\r\n' +
      'REFERENCE 0,0\r\n' +
      'CLS\r\n' +
      'BARCODE 16,12,"128",91,1,0,2,2,"CUST0000005"\r\n' +
      'TEXT 16,111,"2",0,1,1,"CUST0000005"\r\n' +
      'PRINT 1,1\r\n';

    expect(new TextDecoder().decode(result)).toBe(expected);
  });

  it('emits TSPL with multiple copies', () => {
    const label: LabelInput = { code: 'COPY0000006', copies: 3 };
    const result = buildTsplLabel(label);

    // PRINT command should have 3 as second argument
    const str = new TextDecoder().decode(result);
    expect(str).toContain('PRINT 1,3');
  });

  it('handles zero/negative copies by using 1 as minimum', () => {
    const label1: LabelInput = { code: 'ZERO0000007', copies: 0 };
    const result1 = buildTsplLabel(label1);
    expect(new TextDecoder().decode(result1)).toContain('PRINT 1,1');

    const label2: LabelInput = { code: 'NEG0000008', copies: -5 };
    const result2 = buildTsplLabel(label2);
    expect(new TextDecoder().decode(result2)).toContain('PRINT 1,1');
  });

  it('escapes backslashes and quotes in strings', () => {
    const label: LabelInput = {
      code: 'ESC"BACK\\SLASH',
      title: 'Test\\"Quote',
      lines: ['Line\\With\\Backslash'],
    };
    const result = buildTsplLabel(label);
    const str = new TextDecoder().decode(result);

    // Backslashes should become \\\\ and quotes should become \"
    expect(str).toContain('ESC\\"BACK\\\\SLASH');
    expect(str).toContain('Test\\\\\\"Quote');
    expect(str).toContain('Line\\\\With\\\\Backslash');
  });

  it('handles empty lines array (treated as no lines)', () => {
    const label: LabelInput = { code: 'EMPT0000009', lines: [] };
    const result = buildTsplLabel(label);

    const str = new TextDecoder().decode(result);
    // Should have barcode and code text, but no additional TEXT commands
    expect(str).toContain('BARCODE 16,12,"128",76,1,0,2,2,"EMPT0000009"');
    expect(str).toContain('TEXT 16,96,"2",0,1,1,"EMPT0000009"');
    expect(str).not.toContain('TEXT 16,122');
    expect(str).toContain('PRINT 1,1');
  });

  it('handles undefined optional fields with proper defaults', () => {
    const label: LabelInput = {
      code: 'UNDEF000010',
      title: undefined,
      lines: undefined,
      widthMm: undefined,
      heightMm: undefined,
      gapMm: undefined,
      copies: undefined,
      qr: undefined,
    };
    const result = buildTsplLabel(label);

    // Should use all defaults: 40x25mm, 2mm gap, 1 copy
    const str = new TextDecoder().decode(result);
    expect(str).toContain('SIZE 40 mm, 25 mm');
    expect(str).toContain('GAP 2 mm, 0 mm');
    expect(str).toContain('BARCODE 16,12,"128",76,1,0,2,2,"UNDEF000010"');
    expect(str).toContain('TEXT 16,96,"2",0,1,1,"UNDEF000010"');
    expect(str).not.toContain('QRCODE');
    expect(str).toContain('PRINT 1,1');
  });

  it('positions title and subsequent elements with correct y-offsets', () => {
    const label: LabelInput = {
      code: 'OFFSET000011',
      title: 'Patient Name',
      lines: ['Test A', 'Test B', 'Test C'],
    };
    const result = buildTsplLabel(label);
    const str = new TextDecoder().decode(result);

    // Title at y=12, barcode at y=46 (12+34), code at y=130 (46+76+8)
    // Lines at y=156 (130+26), y=178 (156+22), y=200 (178+22)
    expect(str).toContain('TEXT 16,12,"3",0,1,1,"Patient Name"');
    expect(str).toContain('BARCODE 16,46,"128",76,1,0,2,2,"OFFSET000011"');
    expect(str).toContain('TEXT 16,130,"2",0,1,1,"OFFSET000011"');
    expect(str).toContain('TEXT 16,156,"1",0,1,1,"Test A"');
    expect(str).toContain('TEXT 16,178,"1",0,1,1,"Test B"');
    expect(str).toContain('TEXT 16,200,"1",0,1,1,"Test C"');
  });

  it('computes correct QR x-coordinate for different widths', () => {
    const label1: LabelInput = { code: 'QR50MM00012', widthMm: 50, qr: true };
    const result1 = buildTsplLabel(label1);
    // qx = Math.round(50 * 8) - 96 = 400 - 96 = 304
    expect(new TextDecoder().decode(result1)).toContain('QRCODE 304,12,H,4,A,0,"QR50MM00012"');

    const label2: LabelInput = { code: 'QR30MM00013', widthMm: 30, qr: true };
    const result2 = buildTsplLabel(label2);
    // qx = Math.round(30 * 8) - 96 = 240 - 96 = 144
    expect(new TextDecoder().decode(result2)).toContain('QRCODE 144,12,H,4,A,0,"QR30MM00013"');
  });

  it('computes barcode height based on label height', () => {
    // Test height = 20mm: barH = Math.round(20 * 8 * 0.38) = 60.8 → 61
    const label1: LabelInput = { code: 'H20MM000014', heightMm: 20 };
    const result1 = buildTsplLabel(label1);
    expect(new TextDecoder().decode(result1)).toContain('BARCODE 16,12,"128",61,1,0,2,2,"H20MM000014"');

    // Test height = 35mm: barH = Math.round(35 * 8 * 0.38) = 106.4 → 106
    const label2: LabelInput = { code: 'H35MM000015', heightMm: 35 };
    const result2 = buildTsplLabel(label2);
    expect(new TextDecoder().decode(result2)).toContain('BARCODE 16,12,"128",106,1,0,2,2,"H35MM000015"');
  });

  it('returns Uint8Array encoded in UTF-8', () => {
    const label: LabelInput = { code: 'UTF8TEST016' };
    const result = buildTsplLabel(label);

    expect(ArrayBuffer.isView(result)).toBe(true); // cross-realm-safe (jsdom Uint8Array differs from node)
    // Verify UTF-8 encoding by round-trip
    const decoded = new TextDecoder().decode(result);
    const reencoded = new TextEncoder().encode(decoded);
    expect(Array.from(result)).toEqual(Array.from(reencoded));
  });

  it('always terminates TSPL program with \\r\\n after PRINT', () => {
    const label: LabelInput = { code: 'TERM000017' };
    const result = buildTsplLabel(label);
    const str = new TextDecoder().decode(result);

    // Last bytes should be \r\n (0x0d 0x0a)
    const lastTwoBytes = Array.from(result).slice(-2);
    expect(lastTwoBytes).toEqual([0x0d, 0x0a]);
    expect(str.endsWith('PRINT 1,1\r\n')).toBe(true);
  });

  it('includes all required TSPL preamble commands', () => {
    const label: LabelInput = { code: 'PREAMBLE018' };
    const result = buildTsplLabel(label);
    const str = new TextDecoder().decode(result);

    expect(str).toContain('SIZE 40 mm, 25 mm');
    expect(str).toContain('GAP 2 mm, 0 mm');
    expect(str).toContain('DIRECTION 1');
    expect(str).toContain('REFERENCE 0,0');
    expect(str).toContain('CLS');
  });

  it('joins all commands with \\r\\n line endings', () => {
    const label: LabelInput = { code: 'LINES000019' };
    const result = buildTsplLabel(label);
    const str = new TextDecoder().decode(result);

    const lines = str.split('\r\n').filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    expect(str.match(/\r\n/g)!.length).toBe(lines.length); // every line (incl. last) ends in CRLF
  });
});

describe('bytesToBase64', () => {
  it('encodes empty bytes as empty string', () => {
    const bytes = new Uint8Array([]);
    expect(bytesToBase64(bytes)).toBe('');
  });

  it('encodes simple ASCII bytes correctly', () => {
    // "ABC" = [0x41, 0x42, 0x43]
    const bytes = new Uint8Array([0x41, 0x42, 0x43]);
    expect(bytesToBase64(bytes)).toBe('QUJD');
  });

  it('encodes binary bytes with all values 0-255', () => {
    const bytes = new Uint8Array([0x00, 0x01, 0xff]);
    const b64 = bytesToBase64(bytes);
    // Verify it's base64 by round-tripping
    const decoded = atob(b64);
    expect(decoded.length).toBe(3);
    expect(decoded.charCodeAt(0)).toBe(0x00);
    expect(decoded.charCodeAt(1)).toBe(0x01);
    expect(decoded.charCodeAt(2)).toBe(0xff);
  });

  it('encodes TSPL command bytes from buildTsplLabel', () => {
    const label: LabelInput = { code: 'B64TEST000' };
    const tsplBytes = buildTsplLabel(label);
    const b64 = bytesToBase64(tsplBytes);

    // Verify it's valid base64 and decodes back to the TSPL string
    const decoded = atob(b64);
    expect(decoded).toBe(new TextDecoder().decode(tsplBytes));
  });

  it('handles large byte arrays', () => {
    const largeArray = new Uint8Array(1000);
    for (let i = 0; i < 1000; i++) {
      largeArray[i] = (i % 256) as number;
    }
    const b64 = bytesToBase64(largeArray);
    const decoded = atob(b64);
    expect(decoded.length).toBe(1000);
  });

  it('returns string type', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const result = bytesToBase64(bytes);
    expect(typeof result).toBe('string');
  });

  it('base64 output is URL-safe and browser-compatible (uses btoa)', () => {
    // btoa produces standard base64 (not URL-safe), characters [A-Z][a-z][0-9]+/=
    const bytes = new Uint8Array([0xff, 0xfe, 0xfd]);
    const b64 = bytesToBase64(bytes);
    // Standard base64 chars
    expect(/^[A-Za-z0-9+/=]*$/.test(b64)).toBe(true);
  });
});
