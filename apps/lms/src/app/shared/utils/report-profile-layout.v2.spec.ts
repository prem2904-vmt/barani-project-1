import type { PageLayoutBox } from '../models/report-layout.model';
import { PAGE, ptToMm } from './report-header-layout';
import {
  addPaletteBox, analyzerSampleAsset, bodyArea, buildDefaultLayout, graphGrid, detectLayoutIssues, dragBox, findFreeSpot, isCbcFamily,
  KNOWN_ANALYZER_IMAGES, printableBoxes, resizeFromHandle, setBoxHidden,
} from './report-profile-layout';

/**
 * Profile one-page layout v2 (owner review 2026-10-02): a default for ANY
 * profile, CBC-family matching (mirror of mw ProfileLayoutDefaults), 2-D
 * snapping to the body AND the other boxes, 8 resize handles, palette adds
 * into free space, and Hide (kept, never printed).
 */
const BODY = bodyArea(200, PAGE.h - 64); // ≈188.8 × 203.9 mm
const H = ptToMm(BODY.h);
const W = 188.8;

const box = (id: string, x: number, y: number, w: number, h: number, kind: PageLayoutBox['kind'] = 'chart'): PageLayoutBox =>
  ({ id, kind, x, y, w, h });

describe('isCbcFamily — CBC however the lab keyed or named it', () => {
  it('by the profile key (HEM001 / HEM002)', () => {
    expect(isCbcFamily({ catalogKey: 'HEM001' })).toBe(true);
    expect(isCbcFamily({ catalogKey: 'hem002' })).toBe(true);
  });
  it('by its members: three of Hb / RBC / TLC / PLT', () => {
    expect(isCbcFamily({ catalogKey: 'LAB-9', name: 'Blood panel', memberKeys: ['HEM011', 'HEM019', 'HEM030'] })).toBe(true);
    expect(isCbcFamily({ catalogKey: 'LAB-9', name: 'Blood panel', memberKeys: ['HEM011', 'HEM019'] })).toBe(false);
  });
  it('by name as the last resort', () => {
    expect(isCbcFamily({ name: 'CBC Basic' })).toBe(true);
    expect(isCbcFamily({ name: 'Haemogram' })).toBe(true);
    expect(isCbcFamily({ name: 'Complete Blood Count' })).toBe(true);
    expect(isCbcFamily({ name: 'Lipid Profile', memberKeys: ['BIO001'] })).toBe(false);
  });
});

describe('buildDefaultLayout — a sensible start for ANY profile', () => {
  it('no graphs or charts: the table takes the full width, signatures below, nothing overlaps', () => {
    const boxes = buildDefaultLayout({ body: BODY, rowCount: 6, analyzerCodes: [] });
    const table = boxes.find(b => b.kind === 'table')!;
    const sig = boxes.find(b => b.kind === 'signatures')!;
    expect(table.w).toBeCloseTo(W, 0);
    expect(sig.y).toBeGreaterThan(table.y + table.h);
    expect(detectLayoutIssues(boxes, BODY)).toEqual([]);
  });

  it('CBC with the 4 graphs beside a TALL table: one column of large graphs filling the table height, signatures below, no overlap', () => {
    const boxes = buildDefaultLayout({ body: BODY, rowCount: 20, analyzerCodes: KNOWN_ANALYZER_IMAGES.map(i => i.code), tableHeightMm: 150 });
    const table = boxes.find(b => b.kind === 'table')!;
    const graphs = boxes.filter(b => b.kind === 'analyzer');
    expect(graphs.map(g => g.ref)).toEqual(['12003', '12053', '12103', '12153']);
    expect(graphs.every(g => g.x >= table.x + table.w)).toBe(true);
    expect(new Set(graphs.map(g => g.x)).size).toBe(1);
    const last = graphs[3];
    expect(last.y + last.h).toBeGreaterThan(table.h * 0.85);   // fills the table's height
    expect(last.y + last.h).toBeLessThanOrEqual(table.h + 0.5);
    expect(graphs[0].label).toBe('WBC histogram');
    expect(detectLayoutIssues(boxes, BODY)).toEqual([]);
  });

  it('places a box for each of the profile\'s chart blocks (turning the layout on never drops a chart)', () => {
    const boxes = buildDefaultLayout({ body: BODY, rowCount: 5, analyzerCodes: [], chartIds: [{ id: 'sec-1', label: 'Trend' }] });
    expect(boxes.find(b => b.kind === 'chart')).toMatchObject({ ref: 'sec-1', label: 'Trend' });
  });

  it('the table is sized to its rows, never past the body', () => {
    const small = buildDefaultLayout({ body: BODY, rowCount: 4, analyzerCodes: [] }).find(b => b.kind === 'table')!;
    const big = buildDefaultLayout({ body: BODY, rowCount: 400, analyzerCodes: [] }).find(b => b.kind === 'table')!;
    expect(small.h).toBeLessThan(big.h);
    expect(big.h).toBeLessThanOrEqual(H);
  });
});

describe('dragBox — 2-D snapping to the body and to the other boxes', () => {
  it('a left edge dropped within 1.6 mm of another box\'s right edge lands exactly on it, with a guide', () => {
    const boxes = [box('a', 0, 0, 60, 40), box('b', 100, 80, 30, 30)];
    const r = dragBox(boxes, 'b', 61.2, 80, BODY);
    expect(r.boxes.find(b => b.id === 'b')!.x).toBe(60);
    expect(r.guides.v).toContain(60);
  });
  it('tops snap too (horizontal guide)', () => {
    const boxes = [box('a', 0, 10, 60, 40), box('b', 100, 80, 30, 30)];
    const r = dragBox(boxes, 'b', 100, 11, BODY);
    expect(r.boxes.find(b => b.id === 'b')!.y).toBe(10);
    expect(r.guides.h).toContain(10);
  });
  it('snap off (Alt) = free placement', () => {
    const boxes = [box('a', 0, 0, 60, 40), box('b', 100, 80, 30, 30)];
    expect(dragBox(boxes, 'b', 61.2, 80, BODY, false).boxes.find(b => b.id === 'b')!.x).toBe(61.2);
  });
  it('never leaves the body', () => {
    const r = dragBox([box('a', 0, 0, 60, 40)], 'a', -50, 9999, BODY);
    const a = r.boxes[0];
    expect(a.x).toBe(0);
    expect(a.y + a.h).toBeLessThanOrEqual(H + 0.01);
  });
  it('hidden boxes are not snap targets', () => {
    const boxes = [{ ...box('a', 0, 0, 60, 40), hidden: true }, box('b', 100, 80, 30, 30)];
    expect(dragBox(boxes, 'b', 61.2, 80, BODY).boxes.find(b => b.id === 'b')!.x).toBe(61.2);
  });
});

describe('resizeFromHandle — 8 handles, opposite edges stay put', () => {
  const start = box('a', 50, 50, 40, 30);
  it('se grows width and height from the top-left anchor', () => {
    const a = resizeFromHandle([start], start, 'se', 10, 5, BODY, false).boxes[0];
    expect(a).toMatchObject({ x: 50, y: 50, w: 50, h: 35 });
  });
  it('nw moves the top-left and keeps the bottom-right', () => {
    const a = resizeFromHandle([start], start, 'nw', -10, -5, BODY, false).boxes[0];
    expect(a).toMatchObject({ x: 40, y: 45, w: 50, h: 35 });
  });
  it('w alone changes only the left edge', () => {
    const a = resizeFromHandle([start], start, 'w', 5, 99, BODY, false).boxes[0];
    expect(a).toMatchObject({ x: 55, y: 50, w: 35, h: 30 });
  });
  it('never below the minimum size, even dragged past the opposite edge', () => {
    const a = resizeFromHandle([start], start, 'e', -200, 0, BODY, false).boxes[0];
    expect(a.w).toBe(10);
    expect(a.x).toBe(50);
  });
  it('the moving edge snaps to a neighbour', () => {
    const other = box('b', 100, 0, 20, 20);
    const a = resizeFromHandle([start, other], start, 'e', 9, 0, BODY).boxes.find(b => b.id === 'a')!;
    expect(a.x + a.w).toBe(100);
  });
});

describe('graphGrid — graphs as large as the column allows', () => {
  it('a short table keeps a 2×2 grid; a tall one stacks them', () => {
    expect(graphGrid(4, 68, 60, 4, 200).cols).toBe(2);
    expect(graphGrid(4, 68, 150, 4, 200).cols).toBe(1);
  });
  it('boxes keep the graph aspect (no tall letterboxed frames)', () => {
    const g = graphGrid(4, 68, 400, 4, 400);
    expect(g.cellH).toBeLessThanOrEqual(g.cellW / 1.4 + 3.6);
  });
});

describe('palette adds + hide', () => {
  it('a new box drops into the first free spot, not on top of the table', () => {
    const boxes = buildDefaultLayout({ body: BODY, rowCount: 10, analyzerCodes: [] });
    const r = addPaletteBox(boxes, 'notes', BODY, { text: 'Kindly correlate clinically.' });
    const n = r.boxes.find(b => b.id === r.id)!;
    expect(n.kind).toBe('notes');
    expect(n.text).toBe('Kindly correlate clinically.');
    expect(detectLayoutIssues(r.boxes, BODY).filter(i => i.kind === 'overlap')).toEqual([]);
  });
  it('adding an analyzer graph already on the page re-shows it instead of a duplicate', () => {
    const boxes = setBoxHidden([box('analyzer-12003', 0, 0, 30, 30, 'analyzer')].map(b => ({ ...b, ref: '12003' })), 'analyzer-12003', true);
    const r = addPaletteBox(boxes, 'analyzer', BODY, { ref: '12003' });
    expect(r.boxes).toHaveLength(1);
    expect(r.boxes[0].hidden).toBeFalsy();
  });
  it('findFreeSpot falls back to the origin when the page is full', () => {
    expect(findFreeSpot([box('a', 0, 0, W, H)], 50, 50, BODY)).toEqual({ x: 0, y: 0 });
  });
  it('hidden boxes never print and never raise overlap warnings', () => {
    const boxes = [box('a', 0, 0, 60, 40), { ...box('b', 10, 10, 30, 30), hidden: true }];
    expect(printableBoxes(boxes).map(b => b.id)).toEqual(['a']);
    expect(detectLayoutIssues(boxes, BODY)).toEqual([]);
  });
  it('sample graph assets: the M51 look-alikes, a neutral stand-in for unknown codes', () => {
    expect(analyzerSampleAsset('12003')).toBe('assets/analyzer-samples/m51-12003.png');
    expect(analyzerSampleAsset('99999')).toBe('assets/analyzer-samples/generic.png');
  });
});
