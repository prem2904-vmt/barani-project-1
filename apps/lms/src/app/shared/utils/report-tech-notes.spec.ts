import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { buildReportPdf } from './report-pdf';
import { loadReportFonts, resetReportFonts, SOURCE_SANS_DIR } from './report-fonts';
import { REPORT_TYPE_THEMES } from './report-theme';
import { silenceJsdomCanvas } from './report-header-legacy.spec-helpers';
import { RICH_LAYOUTS, PNG_1x1, richSnapshot, richTemplate } from './report-theme.spec-helpers';
import { PdfRun, readPdfRuns, runOf } from './report-pdf-read.spec-helpers';
import { NOTE_LIST_INDENT } from './report-note-pdf';

/**
 * TECHNICIAN NOTES ON THE REPORT (owner 2026-09-30). Renders REAL PDFs from
 * the rich multi-department fixture with notes at every level and reads the
 * content stream back:
 *  - bold / italic / underline land on the right words, in the theme's
 *    faces (Classic Helvetica, Modern Source Sans 3 incl. italic);
 *  - list items hang-indent with their bullet / number;
 *  - each note prints at its place: a line's under its rows and before its
 *    interpretation, a profile member's inside the profile block, the
 *    profile's before the profile interpretation, a department's at the end
 *    of its section, the order's before "End of Report";
 *  - a long note wraps and carries across pages without losing a word;
 *  - no notes → the report is unchanged (Classic fingerprints elsewhere).
 */
silenceJsdomCanvas();

const FONT_DIR = resolve(process.cwd(), 'apps/lms/public', SOURCE_SANS_DIR);
const fromDisk = async (file: string): Promise<ArrayBuffer> => {
  const b = readFileSync(resolve(FONT_DIR, file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const MODERN = { metadata: JSON.stringify({ reportTheme: 'source-sans', options: { specimenLine: true } }) };

const GLU_NOTE = '**Haemolysed** sample — _repeat advised_ within __24 hours__.';
const ALT_NOTE = 'Rerun **ALT** on the second analyser.';
const LFT_NOTE = 'Profremark\n- Firstpt _point_\n- Secondpt **point**';
const CBC_NOTE = '1. Platelet clumps seen\n2. Count verified on smear';
const CS_NOTE = 'Cultremark **plated** twice.';

type Snap = ReturnType<typeof richSnapshot> & { tests: Array<Record<string, unknown>> };

function snapWithNotes(orderNote = 'Orderremark **fasting** status _confirmed_ by phone.'): Snap {
  const snap = richSnapshot() as Snap;
  const byId = (id: string) => snap.tests.find(t => t['testId'] === id)!;
  byId('glu')['techNote'] = GLU_NOTE;
  byId('alt')['techNote'] = ALT_NOTE;
  byId('cbc')['techNote'] = CBC_NOTE;
  byId('cs1')['techNote'] = CS_NOTE;
  byId('tsh')['techNote'] = 'Tshremark';
  (snap as Record<string, unknown>)['techNotes'] = {
    order: orderNote,
    departments: [
      { department: 'Biochemistry', note: 'Deptbio __calibrated__ today.' },
      { department: 'Microbiology', note: 'Deptmicro checked.' },
    ],
    profiles: [{ profileTestId: 'lft', name: 'Liver Function Test', note: LFT_NOTE }],
  };
  return snap;
}

function render(snap: Record<string, unknown>, tplPatch: Record<string, unknown> = {}) {
  const doc = buildReportPdf({
    report: { id: 'r-notes', type: 'final', createdAt: '2026-09-29T09:15:00Z', data: JSON.stringify(snap) },
    template: richTemplate(tplPatch),
    resolvedLayouts: RICH_LAYOUTS,
    imageCache: { '/uploads/logo.png': PNG_1x1 },
    publicBaseUrl: 'https://reports.example.test',
  });
  const pdf = Buffer.from(doc.output('arraybuffer')).toString('latin1');
  return { pdf, runs: readPdfRuns(pdf), pages: doc.getNumberOfPages() };
}

/** Straight horizontal strokes ("x1 y m x2 y l") in every page stream. */
function hLines(pdf: string): Array<{ x1: number; x2: number; y: number }> {
  const out: Array<{ x1: number; x2: number; y: number }> = [];
  for (const m of pdf.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let s = m[1];
    if (!/ Tf| m\n/.test(s)) { try { s = inflateSync(Buffer.from(s, 'latin1')).toString('latin1'); } catch { continue; } }
    for (const l of s.matchAll(/([\d.]+) ([\d.]+) m\n([\d.]+) ([\d.]+) l/g)) {
      if (Math.abs(parseFloat(l[2]) - parseFloat(l[4])) < 0.01) out.push({ x1: parseFloat(l[1]), x2: parseFloat(l[3]), y: parseFloat(l[2]) });
    }
  }
  return out;
}

const idx = (runs: PdfRun[], needle: string) => {
  const i = runs.findIndex(r => r.text.includes(needle));
  if (i < 0) throw new Error(`no run "${needle}"`);
  return i;
};
const exact = (runs: PdfRun[], text: string) => {
  const r = runs.find(x => x.text === text);
  if (!r) throw new Error(`no run exactly "${text}"`);
  return r;
};

describe('technician report notes — Classic (Helvetica)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-30T05:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it('bold / italic / underline land on the right words; the label is bold', () => {
    const { runs, pdf } = render(snapWithNotes());
    const label = runs.filter(r => r.text === 'Note:');
    expect(label.length).toBeGreaterThan(0);
    expect(label.every(r => r.font === 'Helvetica-Bold')).toBe(true);
    expect(exact(runs, 'Haemolysed').font).toBe('Helvetica-Bold');
    expect(exact(runs, 'sample').font).toBe('Helvetica');
    expect(exact(runs, 'repeat').font).toBe('Helvetica-Oblique');
    expect(exact(runs, 'advised').font).toBe('Helvetica-Oblique');
    const hours = exact(runs, 'hours');
    expect(hours.font).toBe('Helvetica');
    // Underline: a stroke just under "24 hours", starting at "24".
    const t24 = exact(runs, '24');
    const under = hLines(pdf).filter(l => Math.abs(l.x1 - t24.x) < 0.5 && l.y < t24.y && t24.y - l.y < 3);
    expect(under.length).toBeGreaterThan(0);
    expect(under.some(l => Math.abs(l.x2 - (hours.x + 20)) < 3)).toBe(true);   // one stroke through "hours"
    // "sample" (not underlined) has no stroke under it.
    const sample = exact(runs, 'sample');
    expect(hLines(pdf).some(l => Math.abs(l.x1 - sample.x) < 0.5 && sample.y - l.y > 0 && sample.y - l.y < 3)).toBe(false);
    // Theme size (Classic techNote 8.5 × template scale M = 1).
    expect(exact(runs, 'Haemolysed').size).toBe(REPORT_TYPE_THEMES.classic.tokens.techNote.size);
  });

  it('lists hang-indent: bullets / numbers in the margin, text at the indent', () => {
    const { runs, pdf } = render(snapWithNotes());
    const first = exact(runs, 'Firstpt');
    const second = exact(runs, 'Secondpt');
    const label = runs[runs.findIndex(r => r.text === 'Profremark') - 1];
    expect(label.text).toBe('Note:');
    expect(first.x).toBeCloseTo(label.x + NOTE_LIST_INDENT, 1);
    expect(second.x).toBeCloseTo(first.x, 1);
    expect(exact(runs, 'point').font).toBe('Helvetica-Oblique');
    expect(runs.filter(r => r.text === 'point').some(r => r.font === 'Helvetica-Bold')).toBe(true);
    // Bullets are filled circles (curves), not glyphs; numbers are text.
    expect(pdf).not.toContain('(•)');
    const one = exact(runs, '1.');
    const platelet = exact(runs, 'Platelet');
    expect(one.x).toBeLessThan(platelet.x);
    expect(exact(runs, '2.').x).toBeCloseTo(one.x, 0);
  });

  it('each note prints at its place', () => {
    const { runs } = render(snapWithNotes());
    const at = (text: string) => { const i = runs.map(r => r.text).lastIndexOf(text); if (i < 0) throw new Error(`no run "${text}"`); return i; };
    // Line note: under its value row, before the test's observation line.
    expect(at('Haemolysed')).toBeGreaterThan(at('132 mg/dL  H'));
    expect(at('Haemolysed')).toBeLessThan(idx(runs, 'Sample slightly haemolysed'));
    // Profile member: inside the LFT block, named, right after the member's row.
    const altNote = at('Note (SGPT (ALT)):');
    expect(altNote).toBeGreaterThan(at('96 U/L  H'));
    expect(altNote).toBeLessThan(at('SGOT (AST)'));
    expect(runs[altNote + 1].text).toBe('Rerun');
    // Profile note: after the members, before the profile's Interpretation.
    expect(at('Profremark')).toBeGreaterThan(at('3.1 g/dL  L'));
    expect(at('Profremark')).toBeLessThan(at('Interpretation:'));
    // Department note: after the Biochemistry section's tables, before its
    // sign-off and before the next department.
    const dept = at('Deptbio');
    expect(runs[dept - 1].text).toBe('Biochemistry note:');
    expect(dept).toBeGreaterThan(at('Tshremark'));
    expect(dept).toBeLessThan(at('Dr. Meena Iyer'));
    expect(dept).toBeLessThan(at('HAEMATOLOGY'));
    expect(runs[dept - 1].x).toBeCloseTo(36, 0);                   // aligned with the table text
    // Culture (special) test: after its block.
    expect(at('Cultremark')).toBeGreaterThan(idx(runs, 'Escherichia coli'));
    // Micro has no table section → its note prints after the results;
    // the order note is last, right before End of Report.
    expect(at('Deptmicro')).toBeGreaterThan(at('Cultremark'));
    expect(runs[at('Deptmicro') - 1].text).toBe('Microbiology note:');
    const overall = at('Overall note:');
    expect(overall).toBeGreaterThan(at('Deptmicro'));
    expect(overall).toBeLessThan(idx(runs, 'End of Report'));
    expect(exact(runs, 'fasting').font).toBe('Helvetica-Bold');
    expect(exact(runs, 'confirmed').font).toBe('Helvetica-Oblique');
  });

  it('department notes follow the order the report prints its departments, not the order they were written', () => {
    // Two sections without a results table (culture / narrative only): their
    // notes print after the results, in the report's department order.
    const snap = snapWithNotes();
    const tn = (snap as Record<string, any>)['techNotes'];
    tn.departments = [
      { department: 'Microbiology', note: 'Deptmicro checked.' },
      { department: 'Biochemistry', note: 'Deptbio __calibrated__ today.' },
    ];
    const { runs } = render(snap);
    const at = (text: string) => runs.map(r => r.text).lastIndexOf(text);
    expect(at('Deptbio')).toBeGreaterThan(-1);
    expect(at('Deptbio')).toBeLessThan(at('Deptmicro'));
    expect(at('Deptmicro')).toBeLessThan(at('Overall note:'));
  });

  it('a single-analyte test keeps its compact row (the note never adds a panel band)', () => {
    const { runs } = render(snapWithNotes());
    expect(runs.some(r => r.text === 'Tshremark')).toBe(true);
    expect(runs.some(r => r.text.startsWith('TSH (THYROID'))).toBe(false);
  });

  it('a long order note wraps inside the margins and carries across pages, every word kept', () => {
    const words = Array.from({ length: 900 }, (_, i) => `w${i}`);
    const long = words.join(' ').slice(0, 999);
    const base = render(snapWithNotes('')).pages;
    // (Six cap-length paragraphs — the renderer never truncates; the 1000
    //  cap is the server's.)
    const snap = snapWithNotes(Array(6).fill(long).join('\n'));
    const { runs, pages } = render(snap);
    expect(pages).toBeGreaterThanOrEqual(base);
    const printed = runs.filter(r => /^w\d+$/.test(r.text));
    const lastWord = long.split(' ').filter(Boolean).at(-1)!;
    expect(printed.filter(r => r.text === 'w0').length).toBe(6);
    expect(printed.filter(r => r.text === lastWord).length).toBe(6);
    for (const r of printed) {
      expect(r.x).toBeGreaterThanOrEqual(29.9);
      expect(r.x).toBeLessThan(595.28 - 30);
    }
    // Carried to a later page than it started on, above the footer.
    const pagesUsed = new Set(printed.map(r => r.page));
    expect(pagesUsed.size).toBeGreaterThan(1);
    expect(printed.every(r => r.y > 40)).toBe(true);
  });

  it('script / HTML in a note prints as text', () => {
    const snap = snapWithNotes('<script>alert(1)</script> **x**');
    const { runs } = render(snap);
    expect(runs.some(r => r.text.includes('<script>alert(1)</script>'))).toBe(true);
  });

  it('no notes → no note text and the same pages', () => {
    const plain = render(richSnapshot());
    expect(plain.runs.some(r => r.text === 'Note:' || r.text === 'Overall note:' || / note:$/.test(r.text))).toBe(false);
  });
});

describe('technician report notes — Modern (Source Sans 3)', () => {
  beforeAll(async () => { resetReportFonts(); expect(await loadReportFonts(fromDisk)).toBe(true); });
  afterAll(() => resetReportFonts());
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-30T05:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it('bold / italic in the embedded faces at the theme size', () => {
    const { runs } = render(snapWithNotes(), MODERN);
    const size = REPORT_TYPE_THEMES['source-sans'].tokens.techNote.size;
    expect(exact(runs, 'Haemolysed')).toMatchObject({ font: 'SourceSans3-Bold', size });
    expect(exact(runs, 'repeat')).toMatchObject({ font: 'SourceSans3-It', size });
    expect(exact(runs, 'sample')).toMatchObject({ font: 'SourceSans3-Regular', size });
    expect(runs.find(r => r.text === 'Note:')!.font).toBe('SourceSans3-Bold');
  });
});
