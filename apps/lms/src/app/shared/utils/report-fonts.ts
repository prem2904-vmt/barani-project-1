import type { jsPDF } from 'jspdf';
import { registerUnicodeFont } from './pdf-text';

/**
 * Embedded fonts for the report themes (report-theme.ts).
 *
 * The Classic theme prints in jsPDF's built-in Helvetica / Times / Courier and
 * needs nothing from here. "Modern — Source Sans 3" embeds Adobe's Source Sans
 * 3 (SIL Open Font License 1.1 — the licence ships next to the files in
 * apps/lms/public/fonts/source-sans-3/OFL.txt) as four STATIC TrueType
 * instances: Regular, Italic, Semibold (600) and Bold (700). jsPDF cannot use
 * a variable font, and its Identity-H writer subsets each face to the glyphs a
 * report actually uses, so a PDF carries a few tens of KB of font, not 1.7 MB.
 *
 * "Modern — Inter" (report layout phase 4) embeds Inter 4.0 (also OFL 1.1,
 * apps/lms/public/fonts/inter/, trimmed to Latin / Greek / symbols, ~165 KB a
 * face) the same way, under its own family name. jsPDF applies no OpenType
 * features, so Inter prints its default (proportional) figures.
 *
 * LAZY: the TTFs are static assets fetched only when a report in this theme is
 * rendered (`loadReportFonts`, awaited by preloadReportImages — the async step
 * every report entry point already takes). They never enter the JS bundle, and
 * the default (Classic) path never downloads them.
 */

export type EmbeddedFace = 'normal' | 'italic' | 'semibold' | 'bold';

/** The embedded families a report theme can name. */
export type EmbeddedFamily = 'SourceSans3' | 'Inter';

/** The jsPDF family every Source Sans 3 face is registered under. */
export const SOURCE_SANS_FAMILY = 'SourceSans3';

/** Face → file under public/fonts/source-sans-3 and its PostScript name (the
 *  PDF's /BaseFont, so each embedded face keeps its own name). */
export const SOURCE_SANS_FACES: Readonly<Record<EmbeddedFace, { file: string; postScript: string }>> = {
  normal:   { file: 'SourceSans3-Regular.ttf',  postScript: 'SourceSans3-Regular' },
  italic:   { file: 'SourceSans3-It.ttf',       postScript: 'SourceSans3-It' },
  semibold: { file: 'SourceSans3-Semibold.ttf', postScript: 'SourceSans3-Semibold' },
  bold:     { file: 'SourceSans3-Bold.ttf',     postScript: 'SourceSans3-Bold' },
};

/** Where the font files are served from (relative to the app's base href). */
export const SOURCE_SANS_DIR = 'fonts/source-sans-3/';

/** The jsPDF family every Inter face is registered under. */
export const INTER_FAMILY = 'Inter';
export const INTER_DIR = 'fonts/inter/';
export const INTER_FACES: Readonly<Record<EmbeddedFace, { file: string; postScript: string }>> = {
  normal:   { file: 'Inter-Regular.ttf',  postScript: 'Inter-Regular' },
  italic:   { file: 'Inter-Italic.ttf',   postScript: 'Inter-Italic' },
  semibold: { file: 'Inter-SemiBold.ttf', postScript: 'Inter-SemiBold' },
  bold:     { file: 'Inter-Bold.ttf',     postScript: 'Inter-Bold' },
};

const FAMILIES: Readonly<Record<EmbeddedFamily, { dir: string; faces: typeof SOURCE_SANS_FACES }>> = {
  SourceSans3: { dir: SOURCE_SANS_DIR, faces: SOURCE_SANS_FACES },
  Inter: { dir: INTER_DIR, faces: INTER_FACES },
};

/** Face → the TTF as a binary string (what jsPDF's VFS takes). */
type FaceData = Record<EmbeddedFace, string>;

const DATA: Partial<Record<EmbeddedFamily, FaceData>> = {};
const LOADING: Partial<Record<EmbeddedFamily, Promise<boolean>>> = {};

/** Fetches one font file → its bytes. Injected in tests. The file is the bare
 *  file name; the default fetcher resolves it inside the family's folder. */
export type FontFetcher = (file: string, family?: EmbeddedFamily) => Promise<ArrayBuffer>;

const defaultFetcher: FontFetcher = async (file, family = 'SourceSans3') => {
  const base = typeof document !== 'undefined' ? document.baseURI : '/';
  const res = await fetch(new URL(FAMILIES[family].dir + file, base).toString());
  if (!res.ok) throw new Error(`font ${file}: HTTP ${res.status}`);
  return res.arrayBuffer();
};

/** Bytes → binary string, in chunks (a 430 KB spread would blow the stack). */
function toBinaryString(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return out;
}

/** True once the family's faces are in memory (Source Sans 3 unless named). */
export function reportFontsLoaded(family: EmbeddedFamily = 'SourceSans3'): boolean {
  return !!DATA[family];
}

/**
 * Load the four Source Sans 3 faces once (cached for the session). Resolves
 * false — never throws — when a file can't be fetched: the renderer then
 * prints the theme's sizes in Helvetica rather than failing the report.
 */
export function loadReportFonts(fetcher: FontFetcher = defaultFetcher, family: EmbeddedFamily = 'SourceSans3'): Promise<boolean> {
  if (DATA[family]) return Promise.resolve(true);
  const pending = LOADING[family];
  if (pending) return pending;
  const faceTable = FAMILIES[family].faces;
  const p = (async () => {
    try {
      const faces = Object.keys(faceTable) as EmbeddedFace[];
      const bufs = await Promise.all(faces.map(f => fetcher(faceTable[f].file, family)));
      const data = {} as FaceData;
      faces.forEach((f, i) => { data[f] = toBinaryString(bufs[i]); });
      DATA[family] = data;
      return true;
    } catch (e) {
      console.warn(`[report-fonts] ${family} could not be loaded — the report prints in Helvetica`, e);
      return false;
    } finally {
      delete LOADING[family];
    }
  })();
  LOADING[family] = p;
  return p;
}

/** Test seam: forget the loaded faces. */
export function resetReportFonts(): void {
  delete DATA['SourceSans3']; delete DATA['Inter'];
  delete LOADING['SourceSans3']; delete LOADING['Inter'];
}

/**
 * Register the loaded faces on ONE document (jsPDF keeps fonts per document).
 * Returns false when they are not loaded — the caller falls back to Helvetica.
 *
 * All four faces live under ONE family (`SourceSans3` + style normal / italic /
 * semibold / bold) so autotable's `fontStyle` keeps working. jsPDF writes a
 * TTF's /BaseFont from that family name, which would give all four embedded
 * faces the same name; for the duration of the PDF build each face carries its
 * PostScript name instead (SourceSans3-Semibold …) — viewers, pdffonts and
 * accessibility tools then see four distinct fonts.
 */
export function installReportFonts(doc: jsPDF, family: EmbeddedFamily = 'SourceSans3'): boolean {
  const data = DATA[family];
  if (!data) return false;
  const faceTable = FAMILIES[family].faces;
  const jsFamily = family === 'Inter' ? INTER_FAMILY : SOURCE_SANS_FAMILY;
  const faces = Object.keys(faceTable) as EmbeddedFace[];
  for (const f of faces) {
    const { file } = faceTable[f];
    doc.addFileToVFS(file, data[f]);
    doc.addFont(file, jsFamily, f, 'Identity-H');
  }
  registerUnicodeFont(doc, jsFamily);
  type FontObj = { fontName: string };
  const internal = doc.internal as unknown as {
    getFont(name: string, style: string): FontObj;
    events: { subscribe(topic: string, cb: () => void): unknown };
  };
  const objs = faces.map(f => ({ obj: internal.getFont(jsFamily, f), ps: faceTable[f].postScript }));
  internal.events.subscribe('buildDocument', () => { for (const o of objs) o.obj.fontName = o.ps; });
  internal.events.subscribe('postPutResources', () => { for (const o of objs) o.obj.fontName = jsFamily; });
  return true;
}
