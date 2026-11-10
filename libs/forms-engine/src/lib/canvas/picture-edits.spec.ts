import { newField } from '../build/doc';
import { FieldDef } from '../core/types';
import { moveHandle } from './area-editor.component';
import { pictureConfig } from './picture';
import {
  addArea,
  addMarker,
  areaId,
  moveMarker,
  ovalPoints,
  removeArea,
  removeMarker,
  renameArea,
  renameMarker,
  setAreaPoints,
  setAreaSentence,
  setMarkerSays,
  useStarter,
  useUpload,
} from './picture-edits';

const tri: [number, number][] = [
  [0.1, 0.1],
  [0.5, 0.1],
  [0.3, 0.4],
];

describe('picture question edits (Studio, pure)', () => {
  it('a new body map starts on the front body starter (the API default)', () => {
    const f = newField({ pages: [] }, 'bodyMap');
    expect(f.config?.['template']).toBe('body-front');
    expect(f.options).toEqual([]);
  });

  it('areas on an upload: add, reshape, rename, sentence, remove (ids as the API asks)', () => {
    const f: FieldDef = { key: 'x', kind: 'drawing', label: 'X', config: {} };
    useUpload(f, '11111111-2222-4333-8444-555555555555');
    const id = addArea(f, 'Right knee!', tri);
    expect(id).toBe('right-knee');
    expect(areaId(f, 'Right knee')).toBe('right-knee-2');
    expect(addArea(f, '1st toe', tri)).toBe('st-toe');
    setAreaPoints(f, id, [[0.2, 0.2], [0.6, 0.2], [0.4, 0.55555]]);
    renameArea(f, id, 'R knee');
    setAreaSentence(f, id, 'Pain over the {region} {note}');
    const r = pictureConfig(f).regions.find((x) => x.id === id)!;
    expect(r).toEqual({ id, label: 'R knee', sentence: 'Pain over the {region} {note}', points: [[0.2, 0.2], [0.6, 0.2], [0.4, 0.5556]] });
    removeArea(f, id);
    expect(pictureConfig(f).regions.map((x) => x.id)).toEqual(['st-toe']);
  });

  it('on a starter only words are kept; a rewording with nothing left is dropped', () => {
    const f: FieldDef = { key: 'x', kind: 'bodyMap', label: 'X', config: { template: 'body-front' } };
    renameArea(f, 'abdomen', 'Tummy');
    setAreaSentence(f, 'abdomen', 'Tenderness over the {region}');
    expect(pictureConfig(f).regions).toEqual([{ id: 'abdomen', label: 'Tummy', sentence: 'Tenderness over the {region}' }]);
    renameArea(f, 'abdomen', '');
    setAreaSentence(f, 'abdomen', '');
    expect(f.config?.['regions']).toBeUndefined();
  });

  it('switching pictures: drawn areas go with an upload swap to a starter; rewordings go to an upload', () => {
    const f: FieldDef = { key: 'x', kind: 'drawing', label: 'X', config: { template: 'body-front', regions: [{ id: 'abdomen', label: 'Tummy' }] } };
    useUpload(f, 'a');
    expect(f.config).toEqual({ templateAssetId: 'a' });
    addArea(f, 'Wound', tri);
    useStarter(f, 'body-back');
    expect(f.config).toEqual({ template: 'body-back' });
    useStarter(f, null);
    expect(f.config).toEqual({});
  });

  it('markers: each is an option with its words; move and remove keep the two in step', () => {
    const f: FieldDef = { key: 'x', kind: 'bodyMap', label: 'X', config: { template: 'head-face' }, options: [] };
    const k = addMarker(f, 'Forehead', 0.5, 0.25);
    expect(k).toBe('forehead');
    expect(f.options).toEqual([{ key: 'forehead', label: 'Forehead', says: 'forehead', subFields: [] }]);
    moveMarker(f, k, 0.51234, 0.3);
    expect(pictureConfig(f).markers).toEqual([{ key: 'forehead', x: 0.5123, y: 0.3 }]);
    renameMarker(f, k, 'Brow');
    setMarkerSays(f, k, 'pain over the brow');
    expect(f.options![0]).toMatchObject({ label: 'Brow', says: 'pain over the brow' });
    expect(addMarker(f, 'Forehead', 0.1, 0.1)).toBe('forehead2');
    removeMarker(f, k);
    expect(f.options!.map((o) => o.key)).toEqual(['forehead2']);
    expect(pictureConfig(f).markers.map((m) => m.key)).toEqual(['forehead2']);
  });

  it('an oval is stored as a polygon; a corner handle moves one point', () => {
    const o = ovalPoints(0.5, 0.5, 0.2, 0.1);
    expect(o).toHaveLength(24);
    expect(o[0]).toEqual([0.7, 0.5]);
    expect(moveHandle({ type: 'poly', points: [0, 0, 10, 0, 10, 10] }, 1, { x: 20, y: 5 })).toEqual({ type: 'poly', points: [0, 0, 20, 5, 10, 10] });
  });
});
