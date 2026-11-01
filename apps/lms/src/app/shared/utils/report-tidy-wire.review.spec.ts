import { describe, expect, it } from 'vitest';
import type { ReportTemplate } from '../models/report.model';
import { TIDY_STYLE_PATHS, applyChanges, type TidyResult } from './report-tidy';
import { buildTidyRequest, cortexChanges } from './report-tidy-wire';
import { readHeaderLayout } from './report-header-layout';

/**
 * Security / privacy review proofs for the Cortex "Tidy up" wire (review 2026-11-01). A test marked GAP fails on the
 * branch as submitted and passes with the review patch to report-tidy-wire.ts.
 */

/** The ONE list both sides must carry; the server pins the same literal in ReportTidyReviewTests.SharedStylePaths. */
const SHARED_STYLE_PATHS = [
  'preset', 'fit.enabled', 'fit.minPt', 'fit.maxLines', 'fit.autoColumns', 'patient.ageSex', 'patient.ageStyle', 'patient.sexStyle',
  'patient.frame', 'patient.continuation', 'patient.showReportStatus', 'pageNumbers', 'density', 'squeeze', 'letterhead.continuation',
  'signatures.placement', 'signatures.show', 'signatures.imageH', 'signatures.maxPerRow', 'charts.trend.style', 'charts.trend.layout',
  'charts.trend.band', 'charts.trend.values', 'charts.rangeBar', 'charts.previous',
];

const tpl = {
  metadata: JSON.stringify({
    reportStyle: { patient: { labels: { orderid: 'Lab No. Sita Raman' }, joiner: ' / ' }, signatures: { verifiedText: 'Verified by Dr. Lakshminarasimhan' } },
    headerLayout: { v: 1, items: { labName: { x: 10.6, y: 15 } }, lines: [{ id: 'k1', text: 'GSTIN 33AAAAA0000A1Z5' }] },
  }),
  patientColumnsJson: '[["name","age"]]',
  primaryColor: '#1B3A6B', tableHeaderBg: '#ffffff', tableHeaderText: '#000000', flagStyle: 'bold_color',
} as unknown as ReportTemplate;

const base: TidyResult['base'] = {
  labName: { id: 'labName', kind: 'text', region: 'header', label: 'Lab name', align: 'left', xMm: 10.58, yMm: 15, wMm: 70, hMm: 5, size: 16, textLen: 22, hidden: false },
  'line:k1': { id: 'line:k1', kind: 'text', region: 'header', label: 'GSTIN 33AAAAA0000A1Z5', align: 'left', xMm: 10.58, yMm: 40, wMm: 60, hMm: 4, size: 8, textLen: 20, hidden: false },
};
const result: TidyResult = { changes: [], issuesBefore: 0, applied: [], findings: [], base, choices: [] };
const ans = (changes: unknown[]) => ({ summary: 's', changes } as never);
const ch = (id: string, path: string, value: unknown) => ({ id, title: 'T', why: 'because', patches: [{ path, value }] });

describe('Tidy wire review - allow-list drift (UI side of the pair)', () => {
  it('TIDY_STYLE_PATHS equals the shared list the server pins', () => {
    expect([...TIDY_STYLE_PATHS].sort()).toEqual([...SHARED_STYLE_PATHS].sort());
    expect(TIDY_STYLE_PATHS.length).toBe(25);
  });
});

describe('Tidy wire review - what leaves the browser', () => {
  it('GAP: the lab\'s own free text in the style (custom labels, joiner, verified line) must not leave the browser', () => {
    const json = JSON.stringify(buildTidyRequest('gemini', tpl, result));
    expect(json).not.toContain('Sita Raman');
    expect(json).not.toContain('Lakshminarasimhan');
    expect(json).not.toContain('labels');
    expect(json).not.toContain('joiner');
    expect(json).not.toContain('verifiedText');
    // and the allow-listed settings still go
    expect(json).toContain('"density"');
  });

  it('a custom letterhead line goes out as its id and geometry only (never its text)', () => {
    const body = buildTidyRequest('gemini', tpl, result);
    const line = (body['items'] as Array<Record<string, unknown>>).find(i => i['id'] === 'line:k1')!;
    expect(line).toEqual({ id: 'line:k1', kind: 'text', region: 'header', align: 'left', x: 10.6, y: 40, w: 60, h: 4, size: 8, textLen: 20, hidden: false });
    expect(JSON.stringify(body)).not.toContain('GSTIN');
  });
});

describe('Tidy wire review - what comes back', () => {
  it('GAP: prototype keys are not letterhead items (no Object.prototype lookups)', () => {
    const r = cortexChanges(ans([
      ch('cortex:a', 'item.__proto__.x', 12),
      ch('cortex:b', 'item.constructor.x', 12),
      ch('cortex:c', 'item.toString.align', 'left'),
      ch('cortex:d', 'item.hasOwnProperty.y', 20),
    ]), tpl, result);
    expect(r.changes).toEqual([]);
    expect(r.dropped.length).toBe(4);
    // and nothing could reach the template through apply either
    const patch = applyChanges(tpl, r.changes, base);
    expect(patch).toEqual({});
    expect(Object.keys(readHeaderLayout(tpl)!.items)).toEqual(['labName']);
  });

  it('GAP: a colour that makes text unreadable is dropped, a readable one is kept', () => {
    const r = cortexChanges(ans([
      ch('cortex:a', 'color.tableHeaderText', '#ffffff'),   // white on the white header row
      ch('cortex:b', 'color.primaryColor', '#fefefe'),      // lab name vanishes on paper
      ch('cortex:c', 'color.abnormalColor', '#fde68a'),     // High unreadable
      ch('cortex:d', 'color.primaryColor', '#0f172a'),      // fine
    ]), tpl, result);
    expect(r.changes.map(c => c.id)).toEqual(['cortex:d']);
    expect(r.dropped.length).toBe(3);
  });

  it('a custom letterhead line can be adjusted like any other text item', () => {
    const r = cortexChanges(ans([ch('cortex:a', 'item.line:k1.size', 9), ch('cortex:b', 'item.line:k1.x', 20)]), tpl, result);
    expect(r.changes.map(c => c.patches[0])).toEqual([{ kind: 'item', id: 'line:k1', key: 'size', to: 9 }, { kind: 'item', id: 'line:k1', key: 'x', to: 20 }]);
    const patch = applyChanges(tpl, r.changes, base);
    expect(readHeaderLayout({ metadata: patch.metadata })!.items['line:k1']).toEqual({ size: 9, x: 20 });
  });

  it('NaN, Infinity, negative and huge numbers never become a patch', () => {
    const r = cortexChanges(ans([
      ch('cortex:a', 'item.labName.x', NaN),
      ch('cortex:b', 'item.labName.x', Infinity),
      ch('cortex:c', 'item.labName.size', -3),
      ch('cortex:d', 'item.labName.size', 1e308),
      ch('cortex:e', 'item.labName.wrap', -1),
      ch('cortex:f', 'style.fit.minPt', 1e308),
      ch('cortex:g', 'style.signatures.maxPerRow', -1),
      ch('cortex:h', 'item.labName.x', '12'),
    ]), tpl, result);
    expect(r.changes).toEqual([]);
    expect(r.dropped.length).toBe(8);
  });

  it('hiding is never a patch, whatever the path spelling', () => {
    const r = cortexChanges(ans([
      ch('cortex:a', 'item.labName.hidden', true),
      ch('cortex:b', 'style.patient.showReportStatus', true),    // allowed: a setting, previewed, ticked by the person
      ch('cortex:c', 'item.labName.size', 0),
    ]), tpl, result);
    expect(r.changes.map(c => c.id)).toEqual(['cortex:b']);
  });
});
