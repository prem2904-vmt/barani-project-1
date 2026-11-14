import * as zlib from 'node:zlib';

/** One entry of a zip file (stored or deflated), read through the central directory. */
export function zipEntry(zip: Buffer, name: string): Buffer | null {
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) { if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) return null;
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) return null;
    const method = zip.readUInt16LE(p + 10);
    const csize = zip.readUInt32LE(p + 20);
    const nlen = zip.readUInt16LE(p + 28), elen = zip.readUInt16LE(p + 30), clen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const entry = zip.subarray(p + 46, p + 46 + nlen).toString('utf8');
    if (entry === name) {
      const dataAt = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const raw = zip.subarray(dataAt, dataAt + csize);
      return method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw);
    }
    p += 46 + nlen + elen + clen;
  }
  return null;
}

const unescapeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** First sheet of an .xlsx: the width (Excel characters) of each column from `<cols>`, and the longest text in each column. */
export function sheetColumns(xlsx: Buffer): { widths: Map<number, number>; longest: Map<number, number> } {
  const xml = zipEntry(xlsx, 'xl/worksheets/sheet1.xml')?.toString('utf8') ?? '';
  const widths = new Map<number, number>();
  for (const m of xml.matchAll(/<col\b[^>]*>/g)) {
    const min = /\bmin="(\d+)"/.exec(m[0])?.[1], max = /\bmax="(\d+)"/.exec(m[0])?.[1], w = /\bwidth="([\d.]+)"/.exec(m[0])?.[1];
    if (min && max && w) for (let c = Number(min); c <= Number(max); c++) widths.set(c - 1, Number(w));
  }
  const shared = (zipEntry(xlsx, 'xl/sharedStrings.xml')?.toString('utf8') ?? '');
  const sst = [...shared.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => unescapeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));
  const longest = new Map<number, number>();
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = /\br="([A-Z]+)\d+"/.exec(m[1])?.[1];
    if (!ref) continue;
    const col = [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const body = m[2] ?? '';
    let text = '';
    if (/\bt="s"/.test(m[1])) text = sst[Number(/<v>(\d+)<\/v>/.exec(body)?.[1])] ?? '';
    else if (/\bt="inlineStr"/.test(m[1])) text = unescapeXml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''));
    else text = /<v>([^<]*)<\/v>/.exec(body)?.[1] ?? '';
    longest.set(col, Math.max(longest.get(col) ?? 0, text.length));
  }
  return { widths, longest };
}
