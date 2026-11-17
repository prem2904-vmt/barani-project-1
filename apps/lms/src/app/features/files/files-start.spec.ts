import { FILES_APPS } from './files-registry';
import { filesAppNav } from './files-nav';
import { START_RECENT_MAX, buildHome, filesStartPath, recentFor, startTemplates } from './files-start';
import type { OfficeFile } from './office.service';

const [NEURON, SYNAPSE, , MYELIN] = FILES_APPS;
const f = (id: string, kind: string, updatedAt: string, o: Partial<OfficeFile> = {}): OfficeFile => ({ id, name: `${id}.x`, kind, sizeBytes: 1, version: 1, updatedAt, updatedByName: 'Kavya', ...o });

describe('Files start screen helpers', () => {
  it('every app opens its OWN start route; the Files screen keeps its tabs', () => {
    for (const a of FILES_APPS) { expect(filesStartPath(a)).toBe(`/files/${a.route}/start`); expect(filesAppNav(a).href).toBe(`/files/${a.route}/start`); }
  });

  it('Recent: only this app\'s kind, newest first, trashed ones left out, capped, with the patient-data flag', () => {
    const files = [
      f('a', 'sheet', '2026-11-10T05:00:00Z'), f('b', 'sheet', '2026-11-16T05:00:00Z', { containsPhi: true }), f('c', 'doc', '2026-11-17T05:00:00Z'),
      f('d', 'sheet', '2026-11-12T05:00:00Z', { deletedAt: '2026-11-13T00:00:00Z' }), f('e', 'pdf', '2026-11-17T06:00:00Z'),
    ];
    const r = recentFor(NEURON, files);
    expect(r.map(x => x.id)).toEqual(['b', 'a']);
    expect(r[0]).toEqual({ id: 'b', name: 'b.x', updatedAt: '2026-11-16T05:00:00Z', updatedByName: 'Kavya', containsPhi: true });
    expect(r[1].containsPhi).toBe(false);
    expect(recentFor(SYNAPSE, files).map(x => x.id)).toEqual(['c']);
    const many = Array.from({ length: 30 }, (_, i) => f(`s${i}`, 'sheet', new Date(Date.UTC(2026, 10, 1, i)).toISOString()));
    expect(recentFor(NEURON, many)).toHaveLength(START_RECENT_MAX);
    expect(recentFor(NEURON, many)[0].id).toBe('s29');
  });

  it('templates: built-ins the lab did not hide, then the lab\'s own; an own template of the same name replaces the built-in', () => {
    const own = [{ id: 't1', kind: 'sheet', name: 'QC log', fileId: 'f1' }, { id: 't2', kind: 'sheet', name: 'Our stock sheet', fileId: 'f2' }, { id: 't3', kind: 'doc', name: 'Letter', fileId: 'f3' }];
    const t = startTemplates([NEURON], { hiddenTemplates: ['neuron:stock'], ownTemplates: own });
    expect(t.map(x => x.id)).toEqual(['neuron:results', 'own:t1', 'own:t2']);
    expect(startTemplates([NEURON], null).map(x => x.id)).toEqual(['neuron:results', 'neuron:qc', 'neuron:stock']);
  });

  it('buildHome: View only / no edit rights = no templates and canCreate false; Open from the device stays', () => {
    const settings = { hiddenTemplates: [], ownTemplates: [{ id: 't1', kind: 'doc', name: 'Our letter', fileId: 'f9' }] } as never;
    const ok = buildHome(SYNAPSE, [f('c', 'doc', '2026-11-17T05:00:00Z')], settings, { canCreate: true, placeName: 'Micro World' });
    expect(ok.home).toMatchObject({ canCreate: true, canOpenDevice: true, placeName: 'Micro World' });
    expect(ok.home.templates.map(t => [t.id, t.source])).toEqual([['synapse:letter', 'builtin'], ['synapse:sop', 'builtin'], ['own:t1', 'lab']]);
    expect(ok.templates).toHaveLength(3);
    const ro = buildHome(SYNAPSE, [f('c', 'doc', '2026-11-17T05:00:00Z')], settings, { canCreate: false, placeName: 'Micro World' });
    expect(ro.home.templates).toEqual([]);
    expect(ro.home.canCreate).toBe(false);
    expect(ro.home.canOpenDevice).toBe(true);
    expect(ro.home.recent).toHaveLength(1);
  });

  it('Myelin has no built-in templates (it edits what exists)', () => {
    expect(buildHome(MYELIN, [], null, { canCreate: true, placeName: 'x' }).home.templates).toEqual([]);
  });
});
