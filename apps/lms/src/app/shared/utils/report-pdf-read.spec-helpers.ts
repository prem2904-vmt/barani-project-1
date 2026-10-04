/**
 * Read a jsPDF-written PDF back into text RUNS — each with the font it was
 * drawn in (its /BaseFont), the size, the page and the position — so specs
 * can assert typography on the real output. Handles the built-in fonts
 * (literal strings) and embedded Identity-H TTFs (hex glyph ids decoded
 * through the font's /ToUnicode map). Deflated streams are inflated.
 */
import { inflateSync } from 'node:zlib';

export interface PdfRun { page: number; font: string; size: number; text: string; x: number; y: number }

function objBody(pdf: string, id: string): string {
  const m = new RegExp(`\\n${id} 0 obj\\s*([\\s\\S]*?)\\nendobj`).exec(pdf);
  return m ? m[1] : '';
}

/** An object's stream, inflated when it is FlateDecode (jsPDF `compress`). */
function streamOf(pdf: string, id: string): string {
  const body = objBody(pdf, id);
  const raw = /stream\r?\n([\s\S]*?)\r?\nendstream/.exec(body)?.[1] ?? '';
  if (!/\/FlateDecode/.test(body)) return raw;
  try { return inflateSync(Buffer.from(raw, 'latin1')).toString('latin1'); } catch { return ''; }
}

function unescapeLiteral(s: string): string {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, c: string) => {
    if (/^[0-7]+$/.test(c)) return String.fromCharCode(parseInt(c, 8));
    return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' } as Record<string, string>)[c] ?? c;
  });
}

export function readPdfRuns(pdf: string): PdfRun[] {
  // Font resource name → { base, cmap }.
  const fonts = new Map<string, { base: string; cmap: Map<number, string> | null }>();
  for (const m of pdf.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
    if (fonts.has(m[1])) continue;
    const body = objBody(pdf, m[2]);
    const base = /\/BaseFont \/([^\s/>]+)/.exec(body)?.[1] ?? '?';
    let cmap: Map<number, string> | null = null;
    const tu = /\/ToUnicode (\d+) 0 R/.exec(body)?.[1];
    if (tu) {
      cmap = new Map();
      for (const p of streamOf(pdf, tu).matchAll(/<([0-9a-fA-F]{4})><([0-9a-fA-F]{4})>/g)) {
        cmap.set(parseInt(p[1], 16), String.fromCharCode(parseInt(p[2], 16)));
      }
    }
    fonts.set(m[1], { base, cmap });
  }

  // Page content streams, in page order (jsPDF: /Contents N 0 R per page).
  const pageIds = [...pdf.matchAll(/\/Type \/Page\b[\s\S]*?\/Contents (\d+) 0 R/g)].map(m => m[1]);
  const runs: PdfRun[] = [];
  pageIds.forEach((cid, pi) => {
    const stream = streamOf(pdf, cid);
    let font = '?', size = 0, x = 0, y = 0;
    let cmap: Map<number, string> | null = null;
    const re = /\/(F\d+) ([\d.]+) Tf|([-\d.]+) ([-\d.]+) Td|\(((?:\\.|[^\\)])*)\) Tj|<([0-9a-fA-F]*)> Tj/g;
    for (const m of stream.matchAll(re)) {
      if (m[1]) {
        const f = fonts.get(m[1]);
        font = f?.base ?? m[1]; cmap = f?.cmap ?? null; size = parseFloat(m[2]);
      } else if (m[3] !== undefined) {
        x = parseFloat(m[3]); y = parseFloat(m[4]);
      } else if (m[5] !== undefined) {
        runs.push({ page: pi + 1, font, size, text: unescapeLiteral(m[5]), x, y });
      } else if (m[6] !== undefined) {
        let text = '';
        for (let i = 0; i + 4 <= m[6].length; i += 4) text += cmap?.get(parseInt(m[6].slice(i, i + 4), 16)) ?? '�';
        runs.push({ page: pi + 1, font, size, text, x, y });
      }
    }
  });
  return runs;
}

/** The first run whose text contains `needle`. Throws a readable error. */
export function runOf(runs: PdfRun[], needle: string): PdfRun {
  const r = runs.find(x => x.text.includes(needle));
  if (!r) throw new Error(`no run contains "${needle}" — runs: ${runs.slice(0, 60).map(x => x.text).join(' | ')}`);
  return r;
}
