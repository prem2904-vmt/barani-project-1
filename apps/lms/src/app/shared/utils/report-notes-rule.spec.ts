import { buildReportPdf } from './report-pdf';
import type { ResolvedReportLayout } from '../models/report-layout.model';

/**
 * Notes follow what was ORDERED, not what a test happens to belong to.
 *
 * Order a profile → only the PROFILE's notes print; its members' own notes are
 * suppressed. Order one of those members on its own → that member's notes do
 * print. So the same test reads differently depending on how it arrived.
 *
 * Two mechanisms had to agree for this to work, and the first fix only covered
 * one of them: merged grid rows (handled in the panel merge) AND paragraph
 * sections (what the Test Master notes editor actually writes). Paragraphs were
 * routed out of the columnar table before the merge ever saw them, so a member
 * carrying a note escaped the profile panel and printed standalone with its own
 * note — exactly what the rule forbids. These tests render real PDFs and read
 * the text back, so they cover both paths whichever way a note is authored.
 */
const layout = (testId: string, testName: string, note: string): ResolvedReportLayout => ({
  testId, testName, departmentName: 'Biochemistry', columns: [], configured: true,
  sections: [{ id: 's1', type: 'paragraph', order: 1, isVisible: true, content: note }],
} as unknown as ResolvedReportLayout);

const LAYOUTS: Record<string, ResolvedReportLayout> = {
  member1: layout('member1', 'Total Cholesterol', 'MEMBERNOTE'),
  prof1: layout('prof1', 'Lipid Profile', 'PROFILENOTE'),
};

/** The OTHER shape a note can be authored in: a merged row INSIDE a grid
 *  section (`isMerged`/`mergeContent`), as written by the test editor's
 *  rows view rather than the paragraph narrative editor. `buildPanelGroup`
 *  reaches this shape through a completely different branch (the grid-rows
 *  loop, not `sentenceRow`), so it needs its own render-and-grep coverage —
 *  see the module doc above: "the first fix only covered one of them". */
const gridLayout = (testId: string, testName: string, note: string): ResolvedReportLayout => ({
  testId, testName, departmentName: 'Biochemistry', columns: [], configured: true,
  sections: [{
    id: 'g1', type: 'grid', order: 1, isVisible: true,
    rows: [{ id: 'row1', isMerged: true, mergeContent: note, cells: {}, isBold: false }],
  }],
} as unknown as ResolvedReportLayout);

const GRID_LAYOUTS: Record<string, ResolvedReportLayout> = {
  member1: gridLayout('member1', 'Total Cholesterol', 'MEMBERNOTE'),
  prof1: gridLayout('prof1', 'Lipid Profile', 'PROFILENOTE'),
};

/** Render a report for Total Cholesterol, ordered via `packageTestId` (a
 *  profile) or standalone when null, and return the PDF's raw text. */
function renderText(packageTestId: string | null, layouts: Record<string, ResolvedReportLayout> = LAYOUTS): string {
  const snap = {
    patient: { displayName: 'Test Patient', age: 30, sex: 'M' },
    order: { id: 'o1', orderNumber: 'LAB-2608-000001', createdAt: '2026-08-08T00:00:00Z' },
    type: 'final',
    tests: [{
      testId: 'member1', packageTestId, packageName: 'Lipid Profile',
      name: 'Total Cholesterol', department: 'Biochemistry', sampleType: 'Serum',
      result: { values: { 'Total Cholesterol': { value: '210', unit: 'mg/dL', range: '<200' } } },
    }],
  };
  const doc = buildReportPdf({
    report: { id: 'r1', createdAt: '2026-08-08T00:00:00Z', data: JSON.stringify(snap) },
    resolvedLayouts: layouts,
    template: null,
  } as never);
  // Standard-14 fonts write literal text into the content stream, so latin1
  // decoding is enough to assert on what the page says.
  return Buffer.from(doc.output('arraybuffer')).toString('latin1');
}

describe('report notes follow what was ordered', () => {
  it("prints the profile's notes when the profile was ordered", () => {
    expect(renderText('prof1')).toContain('PROFILENOTE');
  });

  it("suppresses a member's own notes when it arrived through a profile", () => {
    expect(renderText('prof1')).not.toContain('MEMBERNOTE');
  });

  it("prints the test's own notes when it was ordered standalone", () => {
    expect(renderText(null)).toContain('MEMBERNOTE');
  });

  it("does not leak a profile's notes onto a standalone test", () => {
    expect(renderText(null)).not.toContain('PROFILENOTE');
  });
});

describe('report notes follow what was ordered — the grid-merged-row shape', () => {
  // Same four assertions, but the note is authored as a merged row inside a
  // grid section (`isMerged`/`mergeContent`) rather than a paragraph section.
  // `buildPanelGroup` reaches this through its grid-rows loop, a different
  // code path from `sentenceRow` — both must independently obey the rule.
  it("prints the profile's notes when the profile was ordered", () => {
    expect(renderText('prof1', GRID_LAYOUTS)).toContain('PROFILENOTE');
  });

  it("suppresses a member's own notes when it arrived through a profile", () => {
    expect(renderText('prof1', GRID_LAYOUTS)).not.toContain('MEMBERNOTE');
  });

  it("prints the test's own notes when it was ordered standalone", () => {
    expect(renderText(null, GRID_LAYOUTS)).toContain('MEMBERNOTE');
  });

  it("does not leak a profile's notes onto a standalone test", () => {
    expect(renderText(null, GRID_LAYOUTS)).not.toContain('PROFILENOTE');
  });
});
