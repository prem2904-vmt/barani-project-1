import { PageLayoutBox, ReportSection } from '../models/report-layout.model';
import {
  KNOWN_ANALYZER_IMAGES, MIN_BODY_FONT_PT, bodyArea, collapseMissingAnalyzerBoxes, defaultCbcLayout,
  detectLayoutIssues, fitMeter, missingAnalyzerWarning, moveBox, nudgeBox, readPageLayout, removeBox, resizeBox,
  setColumnVisible, setColumnWidth, writePageLayout,
} from './report-profile-layout';
import { MM, MARGIN_X, PAGE } from './report-header-layout';

// A realistic A4 body area: letterhead ends ~140pt down, footer/signature
// band reserves the last 64pt (report-header-layout.FOOTER_AREA_H).
const BODY = bodyArea(140, PAGE.h - 64);

describe('report-profile-layout — storage (shared sections array, no migration)', () => {
  it('a profile never edited in the designer has no section — reads null', () => {
    expect(readPageLayout([])).toBeNull();
    expect(readPageLayout([{ id: 's1', type: 'grid', order: 1, rows: [] } as unknown as ReportSection])).toBeNull();
  });

  it('round-trips through the SAME sections array other blocks use', () => {
    const boxes = defaultCbcLayout(BODY);
    const sections: ReportSection[] = [{ id: 'g1', type: 'grid', order: 1, rows: [] } as unknown as ReportSection];
    const next = writePageLayout(sections, { enabled: true, boxes });
    expect(next).toHaveLength(2);
    const read = readPageLayout(next);
    expect(read?.enabled).toBe(true);
    expect(read?.boxes).toHaveLength(boxes.length);
    // The grid section is untouched.
    expect(next[0]).toEqual(sections[0]);
  });

  it('writing twice REPLACES the one section rather than appending another', () => {
    let sections: ReportSection[] = [];
    sections = writePageLayout(sections, { enabled: false, boxes: [] });
    sections = writePageLayout(sections, { enabled: true, boxes: defaultCbcLayout(BODY) });
    expect(sections.filter(s => (s as { type: string }).type === 'page_layout')).toHaveLength(1);
    expect(readPageLayout(sections)?.enabled).toBe(true);
  });

  it('tolerates a junk / malformed section instead of throwing', () => {
    const junk = [{ type: 'page_layout', boxes: 'not-an-array' } as unknown as ReportSection];
    expect(readPageLayout(junk)?.boxes).toEqual([]);
  });
});

describe('report-profile-layout — geometry: drag snap / arrow nudge (reuses the letterhead editor math)', () => {
  it('dragging a box near the left margin snaps its left edge onto it', () => {
    const boxes: PageLayoutBox[] = [{ id: 'table', kind: 'table', x: 0.3 / MM, y: 0, w: 100, h: 100 }];
    // 0.3pt off the margin, well inside the snap tolerance (1.5mm).
    const { boxes: moved, guide } = moveBox(boxes, 'table', 0.3, 5, BODY);
    expect(guide).toBe(MARGIN_X);
    expect(moved[0].x).toBeCloseTo(0, 2);
  });

  it('nudging across the centre guide stops exactly on it, not past it', () => {
    const centreMm = (PAGE.w / 2 - MARGIN_X) / MM;
    const boxes: PageLayoutBox[] = [{ id: 'b', kind: 'table', x: centreMm - 0.2, y: 0, w: 0, h: 10 }];
    const { boxes: nudged, guide } = nudgeBox(boxes, 'b', 1, 0, BODY); // 1mm step would cross centre
    expect(guide).toBe(PAGE.w / 2);
    expect(nudged[0].x).toBeCloseTo(centreMm, 2);
  });

  it('a box can never be dragged outside the body area', () => {
    const boxes: PageLayoutBox[] = [{ id: 'b', kind: 'table', x: 0, y: 0, w: 50, h: 50 }];
    const { boxes: moved } = moveBox(boxes, 'b', 9999, 9999, BODY);
    const bodyWmm = (BODY.w / MM), bodyHmm = (BODY.h / MM);
    expect(moved[0].x).toBeLessThanOrEqual(bodyWmm - 50 + 0.01);
    expect(moved[0].y).toBeLessThanOrEqual(bodyHmm - 50 + 0.01);
  });

  it('resize clamps to the body and never shrinks below the floor', () => {
    const boxes: PageLayoutBox[] = [{ id: 'b', kind: 'analyzer', ref: '12003', x: 0, y: 0, w: 20, h: 20 }];
    const resized = resizeBox(boxes, 'b', 1, 1, BODY);
    expect(resized[0].w).toBeGreaterThanOrEqual(10);
    expect(resized[0].h).toBeGreaterThanOrEqual(8);
  });

  it('remove drops the box by id, leaving the others untouched', () => {
    const boxes = defaultCbcLayout(BODY);
    const left = removeBox(boxes, 'analyzer-12003');
    expect(left.some(b => b.id === 'analyzer-12003')).toBe(false);
    expect(left).toHaveLength(boxes.length - 1);
  });
});

describe('report-profile-layout — issue detection (overlap / out-of-body)', () => {
  it('two boxes placed on top of each other flag an overlap', () => {
    const boxes: PageLayoutBox[] = [
      { id: 'a', kind: 'table', x: 0, y: 0, w: 60, h: 60 },
      { id: 'b', kind: 'analyzer', ref: '12003', x: 10, y: 10, w: 60, h: 60 },
    ];
    const issues = detectLayoutIssues(boxes, BODY);
    expect(issues.some(i => i.kind === 'overlap' && i.boxId === 'b')).toBe(true);
  });

  it('a box dragged past the body bottom (into the footer) is flagged out_of_body', () => {
    const bodyHmm = BODY.h / MM;
    const boxes: PageLayoutBox[] = [{ id: 'sig', kind: 'signatures', x: 0, y: bodyHmm - 5, w: 100, h: 40 }];
    const issues = detectLayoutIssues(boxes, BODY);
    expect(issues.some(i => i.kind === 'out_of_body' && i.boxId === 'sig')).toBe(true);
  });

  it('the CBC default layout has no overlaps and stays inside the body', () => {
    const boxes = defaultCbcLayout(BODY);
    expect(detectLayoutIssues(boxes, BODY)).toEqual([]);
  });
});

describe('report-profile-layout — missing analyzer graph collapse (owner decision 2)', () => {
  it('an analyzer box with no attached image is hidden, never an empty frame', () => {
    const boxes = defaultCbcLayout(BODY);
    const { boxes: collapsed, hiddenIds } = collapseMissingAnalyzerBoxes(boxes, new Set(), BODY);
    expect(hiddenIds).toHaveLength(KNOWN_ANALYZER_IMAGES.length);
    expect(collapsed.some(b => b.kind === 'analyzer')).toBe(false);
  });

  it('full collapse (no analyzer images at all) expands the table to the full body width', () => {
    const boxes = defaultCbcLayout(BODY);
    const table = boxes.find(b => b.kind === 'table')!;
    const { boxes: collapsed } = collapseMissingAnalyzerBoxes(boxes, new Set(), BODY);
    const newTable = collapsed.find(b => b.kind === 'table')!;
    expect(newTable.w).toBeGreaterThan(table.w);
    expect(newTable.w).toBeCloseTo(BODY.w / MM, 1);
  });

  it('a PARTIAL set (some images present) leaves the surviving boxes exactly where the lab put them', () => {
    const boxes = defaultCbcLayout(BODY);
    const table = boxes.find(b => b.kind === 'table')!;
    const { boxes: collapsed, hiddenIds } = collapseMissingAnalyzerBoxes(boxes, new Set(['12003']), BODY);
    expect(hiddenIds).toHaveLength(KNOWN_ANALYZER_IMAGES.length - 1);
    expect(collapsed.find(b => b.kind === 'table')!.w).toBe(table.w);
    expect(collapsed.some(b => b.ref === '12003')).toBe(true);
  });

  it('validation warns "not received" for an expected-but-missing analyzer graph', () => {
    const boxes = defaultCbcLayout(BODY);
    const warnings = missingAnalyzerWarning(boxes, new Set(['12003']));
    expect(warnings).toHaveLength(KNOWN_ANALYZER_IMAGES.length - 1);
    expect(warnings[0].message).toContain('not received');
  });
});

describe('report-profile-layout — column visibility / width', () => {
  it('hiding Methodology does not touch other columns', () => {
    const boxes = defaultCbcLayout(BODY);
    const next = setColumnVisible(boxes, 'table', 'method', false);
    const cols = next.find(b => b.id === 'table')!.columns!;
    expect(cols.find(c => c.name === 'method')!.visible).toBe(false);
    expect(cols.find(c => c.name === 'result')!.visible).toBe(true);
  });

  it('adding a never-before-seen column name appends it (does not throw)', () => {
    const boxes = defaultCbcLayout(BODY);
    const next = setColumnVisible(boxes, 'table', 'flag', true);
    expect(next.find(b => b.id === 'table')!.columns!.some(c => c.name === 'flag' && c.visible)).toBe(true);
  });

  it('widths clamp to a sane floor', () => {
    const boxes = defaultCbcLayout(BODY);
    const next = setColumnWidth(boxes, 'table', 'result', -5);
    expect(next.find(b => b.id === 'table')!.columns!.find(c => c.name === 'result')!.width).toBeGreaterThanOrEqual(5);
  });
});

describe('report-profile-layout — fit meter (owner decision 1: shrink to 8pt, else flow to page 2)', () => {
  it('a short CBC (≈20 rows) fits at the default size in a typical table box', () => {
    const m = fitMeter(20, 380, 9);
    expect(m.fits).toBe(true);
    expect(m.shrinkToPt).toBe(9);
    expect(m.overflowsToPage2).toBe(false);
  });

  it('too many rows for the box: the meter proposes a smaller (but ≥ 8pt) font', () => {
    const m = fitMeter(40, 200, 9);
    expect(m.shrinkToPt).toBeLessThan(9);
    expect(m.shrinkToPt).toBeGreaterThanOrEqual(MIN_BODY_FONT_PT);
  });

  it('even at the 8pt floor it still will not fit: flows to a second page, never "fits" falsely', () => {
    const m = fitMeter(500, 100, 9);
    expect(m.overflowsToPage2).toBe(true);
    expect(m.fits).toBe(false);
    expect(m.shrinkToPt).toBe(MIN_BODY_FONT_PT);
  });

  it('CBC default: its table box fits CBC-sized data (≈20 parameters) at the default font', () => {
    const boxes = defaultCbcLayout(BODY);
    const table = boxes.find(b => b.kind === 'table')!;
    const m = fitMeter(20, table.h * MM, table.fontSize ?? 9);
    expect(m.fits).toBe(true);
  });
});
