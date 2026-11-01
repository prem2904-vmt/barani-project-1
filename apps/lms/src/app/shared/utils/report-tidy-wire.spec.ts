import { describe, expect, it } from 'vitest';
import type { ReportTemplate } from '../models/report.model';
import { buildTidyRequest, cortexChanges } from './report-tidy-wire';
import type { TidyResult } from './report-tidy';

const tpl = { metadata: '{}', patientColumnsJson: '[["name","age"],["orderid"]]', primaryColor: '#123456' } as unknown as ReportTemplate;
const result: TidyResult = {
  changes: [], issuesBefore: 0, applied: ['fit'], findings: [{ code: 'overlap', target: 'labName' }],
  base: {
    labName: { id: 'labName', kind: 'text', region: 'header', label: 'Lab name', align: 'left', xMm: 10.58, yMm: 15, wMm: 70, hMm: 5, size: 16, textLen: 22, hidden: false },
    logo: { id: 'logo', kind: 'logo', region: 'header', label: 'Logo', align: 'right', xMm: 170, yMm: 10, wMm: 30, hMm: 14, size: null, textLen: 0, hidden: false },
  },
  choices: [{ id: 'preset', title: 'Style preset', options: [{ key: 'modern', label: 'Modern', patches: [{ kind: 'style', path: 'density', to: 'compact' }, { kind: 'move', id: 'labName', dx: 1, dy: 1 }] }] }],
};

describe('Tidy wire - what leaves the browser', () => {
  it('sends geometry, settings and field keys only', () => {
    const body = buildTidyRequest('gemini', tpl, result);
    const json = JSON.stringify(body);
    expect(Object.keys(body).sort()).toEqual(['applied', 'choices', 'fields', 'findings', 'items', 'provider', 'style']);
    expect(json).not.toMatch(/Lab name/);                 // no item label / text
    expect(json).not.toContain('#123456');                // no template colour column
    expect(json).not.toMatch(/tenant|user/i);
    expect((body['items'] as Array<Record<string, unknown>>)[0]).toEqual({ id: 'labName', kind: 'text', region: 'header', align: 'left', x: 10.6, y: 15, w: 70, h: 5, size: 16, textLen: 22, hidden: false });
    expect(body['fields']).toEqual({ patient: ['name', 'age', 'orderid'], columns: [] });
    // a deterministic move is never part of an option the model sees
    expect((body['choices'] as Array<{ options: Array<{ patches: unknown[] }> }>)[0].options[0].patches).toEqual([{ path: 'style.density', value: 'compact' }]);
  });
});

describe('Tidy wire - what comes back is re-validated', () => {
  const ans = (changes: unknown[]) => ({ summary: 's', changes } as never);
  const ch = (id: string, path: string, value: unknown) => ({ id, title: 'T', why: 'because', patches: [{ path, value }] });

  it('accepts valid style, colour, palette and item patches', () => {
    const r = cortexChanges(ans([
      ch('cortex:set:style.density', 'style.density', 'compact'),
      ch('cortex:set:color.abnormalColor', 'color.abnormalColor', '#B91C1C'),
      ch('cortex:set:palette', 'palette', 'teal'),
      ch('cortex:set:item.labName.size', 'item.labName.size', 14),
      ch('cortex:set:item.labName.x', 'item.labName.x', 12),
    ]), tpl, result);
    expect(r.dropped).toEqual([]);
    expect(r.changes.map(c => c.patches[0])).toEqual([
      { kind: 'style', path: 'density', to: 'compact' },
      { kind: 'color', key: 'abnormalColor', to: '#b91c1c' },
      { kind: 'palette', id: 'teal' },
      { kind: 'item', id: 'labName', key: 'size', to: 14 },
      { kind: 'item', id: 'labName', key: 'x', to: 12 },
    ]);
    expect(r.changes.every(c => c.source === 'cortex')).toBe(true);
  });

  it('drops anything off the allow-list, invalid, off the paper or for an unknown item - and says so', () => {
    const r = cortexChanges(ans([
      ch('cortex:a', 'style.patient.joiner', 'x'),
      ch('cortex:b', 'style.fit.minPt', 2),
      ch('cortex:c', 'style.density', 'huge'),
      ch('cortex:d', 'color.abnormalColor', 'red'),
      ch('cortex:e', 'palette', 'neon'),
      ch('cortex:f', 'item.ghost.x', 10),
      ch('cortex:g', 'item.labName.x', 400),
      ch('cortex:h', 'item.labName.x', 2),                 // would start left of the margin
      ch('cortex:i', 'item.logo.size', 12),                // not a text item
      ch('cortex:j', 'item.labName.size', 2),              // under the floor
      ch('notcortex', 'style.density', 'compact'),
      { id: 'cortex:k', title: 'T', why: 'w', patches: 'nope' },
    ]), tpl, result);
    expect(r.changes).toEqual([]);
    expect(r.dropped.length).toBe(12);
  });

  it('a change that sets what is already set is not shown', () => {
    const r = cortexChanges(ans([ch('cortex:x', 'style.density', 'normal')]), tpl, result);
    expect(r.changes).toEqual([]);
  });

  it('survives garbage', () => {
    expect(cortexChanges({ summary: '', changes: undefined as never }, tpl, result)).toEqual({ changes: [], dropped: [] });
    const g = cortexChanges(ans([null as never, 5 as never, {}]), tpl, result);
    expect(g.changes).toEqual([]);
    expect(g.dropped.length).toBe(3);
  });
});
