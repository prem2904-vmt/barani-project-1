import { describe, expect, it } from 'vitest';
import type { ReportTemplate } from '../models/report.model';
import { readHeaderLayout, type LayoutItem, type ReportLayoutResult } from './report-header-layout';
import { checkColors, templateColors } from './report-palettes';
import { readReportStyle, writeReportStyle } from './report-style';
import { applyChanges, runTidy, toggleChange, type TidyProbe } from './report-tidy';
import type { SqueezeReport } from './report-density';

let tpl: ReportTemplate;
const base = (over: Partial<ReportTemplate> = {}): ReportTemplate => ({ metadata: '{"keep":"me"}', ...over } as unknown as ReportTemplate);

function text(id: string, x: number, y: number, w: number, h: number, extra: Partial<LayoutItem> = {}): LayoutItem {
  return {
    id, region: 'header', kind: 'text', label: id, x, y: y + h * 0.8, align: 'left', box: { x, y, w, h },
    customized: !!(extra as { customized?: boolean }).customized, sizeValue: 10, sizeUnit: 'pt', size: 10, ...extra,
  } as LayoutItem;
}
function layout(items: LayoutItem[], over: Partial<ReportLayoutResult> = {}): ReportLayoutResult {
  return { preset: 'x', active: false, items, headerBottom: 120, bodyTop: 160, bodyTopAuto: false, backgrounds: [], ...over };
}
const CLEAN = [
  text('labName', 30, 38, 200, 14),
  text('address', 30, 56, 260, 10),
  text('contact', 30, 70, 240, 10),
  { ...text('logo', 480.28, 30, 85, 40), kind: 'logo' } as LayoutItem,
];
const probeOf = (l: ReportLayoutResult, f?: (t: ReportTemplate) => Partial<TidyProbe>) => (t: ReportTemplate): TidyProbe =>
  ({ issues: 0, layout: l, squeeze: null, ...(f?.(t) ?? {}) });

describe('Tidy up - deterministic rules', () => {
  it('an untouched clean template gets no changes', () => {
    tpl = base();   // flags print bold, no colour: nothing to check
    const r = runTidy(tpl, probeOf(layout(CLEAN)));
    expect(r.changes).toEqual([]);
    expect(r.findings).toEqual([]);
  });

  it('clamp: an item past the margin moves back inside', () => {
    tpl = base();
    const r = runTidy(tpl, probeOf(layout([...CLEAN.slice(0, 3), text('tagline', 14, 90, 120, 10)])));
    const c = r.changes.find(x => x.rule === 'clamp')!;
    expect(c).toBeTruthy();
    expect(c.why).toMatch(/tagline/);
    expect(c.patches).toEqual([{ kind: 'move', id: 'tagline', dx: 5.64, dy: 0 }]);   // (30 - 14) pt in mm
  });

  it('clamp: a line wider than the page wraps at the printable width', () => {
    tpl = base();
    const r = runTidy(tpl, probeOf(layout([text('wide', 20, 90, 580, 10)])));
    const c = r.changes.find(x => x.rule === 'clamp')!;
    expect(c.patches).toContainEqual({ kind: 'item', id: 'wide', key: 'wrap', to: 188 });
  });

  it('snap: a hair off the margin goes onto it', () => {
    tpl = base();
    const r = runTidy(tpl, probeOf(layout([...CLEAN.slice(0, 2), text('contact', 30.9, 70, 240, 10, { customized: true }), CLEAN[3]])));
    const c = r.changes.find(x => x.rule === 'snap')!;
    expect(c.patches).toEqual([{ kind: 'move', id: 'contact', dx: -0.32, dy: 0 }]);
  });

  it('align: left edges within 2 mm become one edge, side-by-side baselines become one row', () => {
    tpl = base();
    const l = layout([text('a', 100, 100, 120, 10), text('b', 103, 114, 120, 10, { customized: true }), text('c', 330, 100, 60, 10), text('d', 330, 102, 40, 10, { box: { x: 400, y: 102, w: 40, h: 10 }, customized: true })]);
    const r = runTidy(tpl, probeOf(l));
    const c = r.changes.find(x => x.rule === 'align')!;
    expect(c).toBeTruthy();
    expect(c.patches).toContainEqual({ kind: 'move', id: 'b', dx: -1.06, dy: 0 });
  });

  it('overlap: the lower item moves clear and keeps its reading order', () => {
    tpl = base();
    const r = runTidy(tpl, probeOf(layout([text('labName', 30, 38, 200, 14), text('address', 30, 44, 260, 10)])));
    const c = r.changes.find(x => x.rule === 'overlap')!;
    expect(c.why).toMatch(/address/);
    const p = c.patches[0] as { kind: 'move'; id: string; dy: number };
    expect(p.id).toBe('address');
    expect(p.dy).toBeCloseTo((38 + 14 + 2 - 44) / (72 / 25.4), 1);
    expect(r.findings.find(f => f.code === 'overlap')).toBeUndefined();   // resolved
  });

  it('overlap: side-by-side items push the right one right, not down', () => {
    tpl = base();
    const r = runTidy(tpl, probeOf(layout([text('a', 30, 40, 200, 12), text('b', 200, 40, 100, 12)])));
    const c = r.changes.find(x => x.rule === 'overlap')!;
    expect(c.patches[0]).toMatchObject({ kind: 'move', id: 'b', dy: 0 });
    expect((c.patches[0] as { dx: number }).dx).toBeGreaterThan(0);
  });

  it('overlap that cannot move clear becomes a question for Cortex', () => {
    tpl = base();
    // The body starts at 160; the second line cannot go down any further.
    const l = layout([text('a', 30, 140, 520, 14), text('b', 30, 146, 260, 12, { sizeValue: 10 })], { bodyTop: 158 });
    const r = runTidy(tpl, probeOf(l));
    expect(r.findings).toContainEqual({ code: 'overlap', target: 'b' });
    const q = r.choices.find(x => x.id === 'overlap:b')!;
    expect(q.options.map(o => o.key)).toEqual(['shrink', 'wrap']);
  });

  it('spacing: a column of lines with uneven gaps gets even gaps', () => {
    tpl = base();
    const l = layout([text('l1', 30, 40, 200, 10), text('l2', 30, 52, 200, 10, { customized: true }), text('l3', 30, 78, 200, 10, { customized: true }), text('l4', 30, 90, 200, 10)]);
    const r = runTidy(tpl, probeOf(l));
    const c = r.changes.find(x => x.rule === 'spacing')!;
    expect(c).toBeTruthy();
    const moves = c.patches as Array<{ id: string; dy: number }>;
    expect(moves.map(m => m.id)).toEqual(['l2', 'l3']);
  });

  it('size: an odd custom text size goes to the nearest half point, never under the floor', () => {
    tpl = base();
    const l = layout([text('a', 30, 40, 200, 10, { customized: true, sizeValue: 11.3 }), text('b', 30, 56, 200, 10, { customized: true, sizeValue: 9 })]);
    const r = runTidy(tpl, probeOf(l));
    const c = r.changes.find(x => x.rule === 'size')!;
    expect(c.patches).toEqual([{ kind: 'item', id: 'a', key: 'size', to: 11.5 }]);
  });

  it('fit: long names that overlap turn text fitting on, then widen the name column, each only if still needed', () => {
    tpl = base();
    const probe = probeOf(layout(CLEAN), t => {
      const f = readReportStyle(t).fit;
      return { issues: !f.enabled ? 4 : !f.autoColumns ? 2 : 0 };
    });
    const r = runTidy(tpl, probe);
    const ids = r.changes.filter(c => c.rule.startsWith('fit')).map(c => c.id);
    expect(ids).toEqual(['rule:fit', 'rule:fit-columns']);
    expect(r.changes.find(c => c.id === 'rule:fit-columns')!.requires).toEqual(['rule:fit']);
    expect(r.changes[0].why).toMatch(/4 places/);
    // already clean: nothing
    const fine = runTidy(tpl, probeOf(layout(CLEAN)));
    expect(fine.changes.some(c => c.rule.startsWith('fit'))).toBe(false);
  });

  it('fit: one fix is enough when it works', () => {
    tpl = base();
    const probe = probeOf(layout(CLEAN), t => ({ issues: readReportStyle(t).fit.enabled ? 0 : 3 }));
    expect(runTidy(tpl, probe).changes.map(c => c.id)).toEqual(['rule:fit']);
  });

  it('squeeze: proposed only when it really saves a page', () => {
    tpl = base();
    const saves: SqueezeReport = { applied: true, pagesBefore: 2, pagesAfter: 1, overflow: 0.08, by: 'compact' };
    const probe = probeOf(layout(CLEAN), t => ({ squeeze: readReportStyle(t).squeeze ? saves : null }));
    const c = runTidy(tpl, probe).changes.find(x => x.rule === 'squeeze')!;
    expect(c.patches).toEqual([{ kind: 'style', path: 'squeeze', to: true }]);
    const none = probeOf(layout(CLEAN), t => ({ squeeze: readReportStyle(t).squeeze ? { ...saves, applied: false, pagesAfter: 2 } : null }));
    expect(runTidy(tpl, none).changes.some(x => x.rule === 'squeeze')).toBe(false);
  });

  it('flags: High and Low that look alike in greyscale are nudged until they pass', () => {
    tpl = base({ flagStyle: 'bold_color', abnormalColor: '#d93025', abnormalLowColor: '#b5651d' } as Partial<ReportTemplate>);
    expect(checkColors(templateColors(tpl)).some(c => c.id === 'flags-grey' && !c.ok)).toBe(true);
    const r = runTidy(tpl, probeOf(layout(CLEAN)));
    const c = r.changes.find(x => x.rule === 'flags')!;
    expect(c).toBeTruthy();
    const out = applyChanges(tpl, [c], r.base);
    const after = { ...tpl, ...out } as ReportTemplate;
    const checks = checkColors(templateColors(after), true);
    expect(checks.find(x => x.id === 'flags-grey')!.ok).toBe(true);
    expect(checks.find(x => x.id === 'flags-text')!.ok).toBe(true);
  });

  it('flags: colours that already pass are left alone', () => {
    tpl = base({ flagStyle: 'bold_color', abnormalColor: '#450a0a', abnormalLowColor: '#b91c1c' } as Partial<ReportTemplate>);
    const checks = checkColors(templateColors(tpl));
    const r = runTidy(tpl, probeOf(layout(CLEAN)));
    expect(checks.every(c => c.ok)).toBe(true);
    expect(r.changes.some(x => x.rule === 'flags')).toBe(false);
  });

  it('signature: every-page images cost room, so print once at the end', () => {
    tpl = base({ metadata: writeReportStyle(base(), { signatures: { placement: 'every-page' } }) });
    const c = runTidy(tpl, probeOf(layout(CLEAN))).changes.find(x => x.rule === 'signature')!;
    expect(c.patches).toEqual([{ kind: 'style', path: 'signatures.placement', to: 'end' }]);
    const dept = runTidy(base(), probeOf(layout(CLEAN)));
    expect(dept.changes.some(x => x.rule === 'signature')).toBe(false);
  });

  it('items the lab never touched keep the header style\'s own rhythm (no snap / align / spacing for them)', () => {
    tpl = base();
    const l = layout([text('a', 30.9, 40, 200, 10), text('b', 33, 52, 200, 10), text('c', 30, 78, 200, 10), text('d', 30, 90, 200, 10)]);
    const r = runTidy(tpl, probeOf(l));
    expect(r.changes).toEqual([]);
  });

  it('every change has a named rule and a plain-words reason, and never says AI', () => {
    tpl = base({ flagStyle: 'bold_color', abnormalColor: '#d93025', abnormalLowColor: '#b5651d' } as Partial<ReportTemplate>);
    const l = layout([text('a', 14, 38, 200, 14), text('b', 14, 44, 260, 10), text('c', 30.8, 70, 240, 10, { customized: true, sizeValue: 11.3 })]);
    const r = runTidy(tpl, probeOf(l, t => ({ issues: readReportStyle(t).fit.enabled ? 0 : 2 })));
    expect(r.changes.length).toBeGreaterThan(3);
    for (const c of r.changes) {
      expect(c.source).toBe('rule');
      expect(c.title.length).toBeGreaterThan(5);
      expect(c.why.length).toBeGreaterThan(20);
      expect(`${c.title} ${c.why}`).not.toMatch(/\bAI\b/);
      expect(c.patches.length).toBeGreaterThan(0);
    }
  });
});

describe('Tidy up - applying', () => {
  const messy = () => {
    const t = base({ flagStyle: 'bold_color', abnormalColor: '#d93025', abnormalLowColor: '#b5651d' } as Partial<ReportTemplate>);
    const l = layout([text('labName', 14, 38, 200, 14), text('address', 30, 44, 260, 10)]);
    return { t, r: runTidy(t, probeOf(l, x => ({ issues: readReportStyle(x).fit.enabled ? 0 : 2 }))) };
  };

  it('moves compose on top of where the item stood, whatever subset is ticked', () => {
    const { t, r } = messy();
    const clamp = r.changes.find(c => c.rule === 'clamp')!;
    const overlap = r.changes.find(c => c.rule === 'overlap')!;
    const both = applyChanges(t, [clamp, overlap], r.base);
    const cfg = readHeaderLayout({ metadata: both.metadata });
    expect(cfg!.items['labName'].x).toBeCloseTo(30 / (72 / 25.4), 1);
    expect(cfg!.items['address'].y).toBeGreaterThan(r.base['address'].yMm);
    const onlyOverlap = readHeaderLayout({ metadata: applyChanges(t, [overlap], r.base).metadata });
    expect(onlyOverlap!.items['labName']).toBeUndefined();   // the clamp was not ticked: the name stays where it was
  });

  it('is ONE patch object, keeps unrelated metadata, and writes colour columns', () => {
    const { t, r } = messy();
    const out = applyChanges(t, r.changes, r.base);
    expect(JSON.parse(out.metadata!)['keep']).toBe('me');
    expect(readReportStyle({ metadata: out.metadata }).fit.enabled).toBe(true);
    expect(out.abnormalColor).toBeTruthy();
    // the input template is never mutated
    expect(t.metadata).toBe('{"keep":"me"}');
    expect(applyChanges(t, [], r.base)).toEqual({});
  });

  it('a palette patch writes the seven colours and remembers the choice', () => {
    const t = base();
    const out = applyChanges(t, [{ id: 'cortex:palette:teal', source: 'cortex', rule: 'cortex', title: 't', why: 'w', patches: [{ kind: 'palette', id: 'teal' }] }], {});
    expect(out.primaryColor).toBeTruthy();
    expect(readReportStyle({ metadata: out.metadata }).colors.palette).toBe('teal');
  });

  it('ticking a dependent ticks its prerequisite; unticking a prerequisite unticks dependants', () => {
    const { r } = messy();
    const all = [{ id: 'a', requires: undefined }, { id: 'b', requires: ['a'] }, { id: 'c', requires: ['b'] }] as never;
    expect([...toggleChange(new Set(), 'c', true, all)].sort()).toEqual(['a', 'b', 'c']);
    expect([...toggleChange(new Set(['a', 'b', 'c']), 'a', false, all)]).toEqual([]);
    expect(r.changes.length).toBeGreaterThan(0);
  });
});
