import { buildBleJob, DP27_BLE } from './dp27';
import { PackedBitmap } from './label-render';

const packedBitmapOf = (widthDots: number, heightDots: number, bytes: number[]): PackedBitmap => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return { widthDots, heightDots, packed: btoa(bin) };
};

describe('DP27_BLE', () => {
  it('exports BLE service and write characteristic UUIDs', () => {
    expect(DP27_BLE.service).toBe(0xae30);
    expect(DP27_BLE.writeChar).toBe(0xae01);
  });
});

describe('buildBleJob', () => {
  it('emits reset, empty feed, and form-feed for all-white 8x8 bitmap', () => {
    const bmp = packedBitmapOf(8, 8, [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const result = buildBleJob(bmp);

    // All-white 8 rows → feedLines(8) emits [0x1b, 0x4a, 8]
    const expected = [0x1b, 0x40, 0x1b, 0x4a, 0x08, 0x0c];
    expect(Array.from(result)).toEqual(expected);
  });

  it('emits reset, single printable line, and form-feed for 8x1 solid line', () => {
    // 1 row of 8 solid black pixels = one byte 0xff
    const bmp = packedBitmapOf(8, 1, [0xff]);
    const result = buildBleJob(bmp);

    // printLine(8, [true, true, true, true, true, true, true, true])
    // → [0x1f, 0x2a, width_lo, width_hi, ...bytes]
    // width=8, width_lo=0x08, width_hi=0x00, bytes=[0xff]
    const expected = [0x1b, 0x40, 0x1f, 0x2a, 0x08, 0x00, 0xff, 0x0c];
    expect(Array.from(result)).toEqual(expected);
  });

  it('emits host command for density option (0x1f43)', () => {
    const bmp = packedBitmapOf(8, 1, [0xff]);
    const result = buildBleJob(bmp, { density: 5 });

    // hostCommand(0x1f43, [5]) → [0x1f, 0x43, varlen(1), 5, checksum]
    // varlen(1) = [1], checksum of [0x43, 0x01, 0x05] XOR 0xff = 0xb6
    // Then reset + bitmap + formfeed
    const expected = [
      0x1f, 0x43, 0x01, 0x05, 0xb6,
      0x1b, 0x40,
      0x1f, 0x2a, 0x08, 0x00, 0xff,
      0x0c,
    ];
    expect(Array.from(result)).toEqual(expected);
  });

  it('emits host command for speed option (0x1f44)', () => {
    const bmp = packedBitmapOf(8, 1, [0xff]);
    const result = buildBleJob(bmp, { speed: 3 });

    // hostCommand(0x1f44, [3]) → [0x1f, 0x44, varlen(1), 3, checksum]
    // checksum of [0x44, 0x01, 0x03] XOR 0xff = 0xb7
    const expected = [
      0x1f, 0x44, 0x01, 0x03, 0xb7,
      0x1b, 0x40,
      0x1f, 0x2a, 0x08, 0x00, 0xff,
      0x0c,
    ];
    expect(Array.from(result)).toEqual(expected);
  });

  it('emits both density and speed commands when both options provided', () => {
    const bmp = packedBitmapOf(8, 1, [0xff]);
    const result = buildBleJob(bmp, { density: 5, speed: 3 });

    // hostCommand(0x1f43, [5]) then hostCommand(0x1f44, [3])
    const expected = [
      0x1f, 0x43, 0x01, 0x05, 0xb6,
      0x1f, 0x44, 0x01, 0x03, 0xb7,
      0x1b, 0x40,
      0x1f, 0x2a, 0x08, 0x00, 0xff,
      0x0c,
    ];
    expect(Array.from(result)).toEqual(expected);
  });

  it('ignores null/undefined density and speed', () => {
    const bmp = packedBitmapOf(8, 1, [0xff]);
    const result = buildBleJob(bmp, { density: undefined, speed: undefined });

    // Should emit only reset, bitmap, formfeed (no host commands)
    const expected = [0x1b, 0x40, 0x1f, 0x2a, 0x08, 0x00, 0xff, 0x0c];
    expect(Array.from(result)).toEqual(expected);
  });

  it('handles 16-bit width encoding (width > 255)', () => {
    // 256-dot line: width_lo=0x00, width_hi=0x01
    const bmp = packedBitmapOf(256, 1, new Array(32).fill(0xff));
    const result = buildBleJob(bmp);

    // printLine(256, ...) → [0x1f, 0x2a, 0x00, 0x01, ...32 bytes of 0xff]
    const expected = [
      0x1b, 0x40,
      0x1f, 0x2a, 0x00, 0x01,
      ...new Array(32).fill(0xff),
      0x0c,
    ];
    expect(Array.from(result)).toEqual(expected);
  });

  it('handles multiple feed commands for line counts > 255', () => {
    // 300 empty lines: feedLines(300) should emit multiple [0x1b, 0x4a, count]
    // First chunk: [0x1b, 0x4a, 255], then [0x1b, 0x4a, 45]
    const bmp = packedBitmapOf(8, 300, new Array(300).fill(0x00));
    const result = buildBleJob(bmp);

    // feedLines(300): r=300
    // First iteration: x=255, emit [0x1b, 0x4a, 255], r=45
    // Second iteration: x=45, emit [0x1b, 0x4a, 45], r=0
    const expected = [
      0x1b, 0x40,
      0x1b, 0x4a, 0xff,
      0x1b, 0x4a, 0x2d,
      0x0c,
    ];
    expect(Array.from(result)).toEqual(expected);
  });

  it('handles repeated line detection (same line pattern)', () => {
    // 3-row bitmap: row 0 and row 1 are identical, row 2 is white
    // Row 0: 0xff (black), Row 1: 0xff (black), Row 2: 0x00 (white)
    const bmp = packedBitmapOf(8, 3, [0xff, 0xff, 0x00]);
    const result = buildBleJob(bmp);

    // y=0: printLine for first row → [0x1f, 0x2a, 0x08, 0x00, 0xff]
    // y=1: sameLine(0, 1) = true, rep=1 → repeatLine(1)
    //   repeatLine(1): [0x1f, 0x2e, 0] (count 1 → emit count-1=0)
    // y=2: lineEmpty(2) = true, empty=1 → feedLines(1) → [0x1b, 0x4a, 1]
    const expected = [
      0x1b, 0x40,
      0x1f, 0x2a, 0x08, 0x00, 0xff,
      0x1f, 0x2e, 0x00,
      0x1b, 0x4a, 0x01,
      0x0c,
    ];
    expect(Array.from(result)).toEqual(expected);
  });

  it('handles skipPrintLine when first black pixel is not at column 0', () => {
    // 8-wide, 1-row bitmap: pixels are [false, false, false, true, true, true, true, true]
    // This creates a skipPrintLine starting at column 3
    // skipBytes = 0 (3 < 8), skipOffset = 3, bytesToPrint = 1 + ceil(5/8) = 2
    // off = [false, false, false, true, true, true, true, true]
    // take = 3 + 5 = 8, fill from bit 3 through bit 7 of first byte
    const bmp = packedBitmapOf(8, 1, [0x1f]); // 00011111 in binary
    const result = buildBleJob(bmp);

    // Row starts with 3 false, then 5 true pixels
    // firstBlack(0) = 3, lastBlack(0) = 7
    // skipPrintLine(8, 3, [true, true, true, true, true])
    // → [0x1f, 0x2b, skipBytes, bytesToPrint, ...data]
    // skipBytes=0, bytesToPrint=2
    // off = [false, false, false, true, true, true, true, true]
    // After fill: bits 3-7 are set in b[0], no bits set in b[1]
    // b[0] = 00011111 = 0x1f, b[1] = 00000000 = 0x00
    const expected = [
      0x1b, 0x40,
      0x1f, 0x2b, 0x00, 0x02, 0x1f, 0x00,
      0x0c,
    ];
    expect(Array.from(result)).toEqual(expected);
  });

  it('emits single form-feed at end of job', () => {
    const bmp = packedBitmapOf(8, 8, [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const result = buildBleJob(bmp);

    // Last byte should always be 0x0c
    expect(result[result.length - 1]).toBe(0x0c);
  });

  it('returns Uint8Array type', () => {
    const bmp = packedBitmapOf(8, 1, [0xff]);
    const result = buildBleJob(bmp);

    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('handles large density/speed values with variable-length encoding', () => {
    const bmp = packedBitmapOf(8, 1, [0xff]);
    const result = buildBleJob(bmp, { density: 200 });

    // hostCommand(0x1f43, [200])
    // varlen(1) = [1], data=[200]
    // buf = [0x1f, 0x43, 0x01, 200, 0]
    // checksum([0x43, 0x01, 200]) = (0x43 + 0x01 + 0xc8) XOR 0xff = 0x0c ^ 0xff = 0xf3
    // Actually: (0x43 + 1 + 0xc8) & 0xff = 0x0c, XOR 0xff = 0xf3
    const cmd = Array.from(result).slice(0, 5);
    expect(cmd[0]).toBe(0x1f);
    expect(cmd[1]).toBe(0x43);
    expect(cmd[2]).toBe(0x01); // varlen for data length 1
    expect(cmd[3]).toBe(200);  // density value
    // Checksum: (0x43 + 0x01 + 200) & 0xff = 0x0c, XOR 0xff = 0xf3
    expect(cmd[4]).toBe(0xf3);
  });

  it('handles mixed empty and printed lines in sequence', () => {
    // 4-row bitmap: white, black, white, black
    // Rows: [0x00, 0xff, 0x00, 0xff]
    const bmp = packedBitmapOf(8, 4, [0x00, 0xff, 0x00, 0xff]);
    const result = buildBleJob(bmp);

    // y=0: lineEmpty(0) = true, empty=1 → feedLines(1)
    // y=1: printLine → [0x1f, 0x2a, 0x08, 0x00, 0xff]
    // y=2: lineEmpty(2) = true, empty=1 → feedLines(1)
    // y=3: printLine → [0x1f, 0x2a, 0x08, 0x00, 0xff]
    const expected = [
      0x1b, 0x40,
      0x1b, 0x4a, 0x01,
      0x1f, 0x2a, 0x08, 0x00, 0xff,
      0x1b, 0x4a, 0x01,
      0x1f, 0x2a, 0x08, 0x00, 0xff,
      0x0c,
    ];
    expect(Array.from(result)).toEqual(expected);
  });

  it('always starts with reset command', () => {
    const bmp = packedBitmapOf(8, 1, [0xff]);
    const result = buildBleJob(bmp);
    const arr = Array.from(result);

    // If no density/speed, should start with reset [0x1b, 0x40]
    expect(arr[0]).toBe(0x1b);
    expect(arr[1]).toBe(0x40);
  });

  it('starts with host commands when options present, reset comes after', () => {
    const bmp = packedBitmapOf(8, 1, [0xff]);
    const result = buildBleJob(bmp, { density: 5 });
    const arr = Array.from(result);

    // Should start with host command (0x1f, 0x43, ...)
    expect(arr[0]).toBe(0x1f);
    expect(arr[1]).toBe(0x43);
    // Reset comes later, after checksum byte
    expect(arr[5]).toBe(0x1b);
    expect(arr[6]).toBe(0x40);
  });
});
