import { fromCanvas, patchAnswer, readAnswer, toCanvas } from './answer';
import { emptyCanvas } from './canvas-model';

/** The stored answer is the API's (fractions 0..1); the canvas works in picture units. */
describe('canvas answer (API shape) ↔ working picture', () => {
  const stored = {
    description: 'Lesion on the dorsum of the hand.',
    photo: '3f2c6c0e-5a1b-4a52-9d0f-2f6d9a1b7c01',
    regions: [{ id: 'abdomen' }, { id: 'right-knee', note: 'with warmth' }],
    pins: [{ id: 'p1', x: 0.38, y: 0.18, label: 'Scar', note: '4 cm' }],
    strokes: [
      { id: 's1', tool: 'pen', color: '#1d4ed8', width: 0.004, points: [[0.2, 0.3, 0.5], [0.4, 0.35, 0.6]] },
      { id: 's2', tool: 'highlighter', color: '#dc2626', width: 0.01, points: [[0.1, 0.1], [0.2, 0.2]] },
    ],
    labels: [{ id: 'l1', x: 0.5, y: 0.8, text: 'Dry skin' }],
    markers: ['forehead'],
  };

  it('serialisation round-trip: answer → picture → answer keeps everything', () => {
    const a = readAnswer(JSON.parse(JSON.stringify(stored)));
    const v = toCanvas(a, 400, 800);
    expect(v.ink[0].points).toEqual([80, 240, 0.5, 160, 280, 0.6]);
    expect(v.ink[0].pen).toBe(true);
    expect(v.ink[0].size).toBe(1.6);
    expect(v.ink[1].tool).toBe('highlighter');
    expect(v.pins[0]).toMatchObject({ x: 152, y: 144, n: 1, label: 'Scar', note: '4 cm' });
    expect(v.regions).toEqual(['abdomen', 'right-knee']);
    const back = fromCanvas(v, a)!;
    expect(back).toEqual(readAnswer(stored));
    // and again (stable)
    expect(fromCanvas(toCanvas(back, 400, 800), back)).toEqual(back);
  });

  it('the same answer at another picture size stays the same fractions', () => {
    const a = readAnswer(stored);
    expect(fromCanvas(toCanvas(a, 1600, 1200), a)).toEqual(a);
  });

  it('points without pressure (finger) are stored as [x, y]; with a pen as [x, y, p]', () => {
    const v = { ...emptyCanvas(1000, 500), ink: [
      { id: 'a', color: '#111827', size: 6, points: [100, 100, 0.5, 200, 150, 0.5] },
      { id: 'b', color: '#111827', size: 6, points: [100, 100, 0.2, 200, 150, 0.9], pen: true },
    ] };
    const out = fromCanvas(v)!;
    expect(out.strokes![0].points).toEqual([[0.1, 0.2], [0.2, 0.3]]);
    expect(out.strokes![1].points).toEqual([[0.1, 0.2, 0.2], [0.2, 0.3, 0.9]]);
    expect(out.strokes![0].width).toBe(0.006);
  });

  it('malformed input is dropped; caps and colours checked; no data: survives', () => {
    const a = readAnswer({
      regions: [{ id: 'a' }, { id: 'a' }, { nope: 1 }],
      pins: [{ x: 'a', y: 1 }, { x: 2, y: -1 }],
      strokes: [{ points: [[0.1, 0.1]], color: 'red' }, { points: 'x' }, { points: [] }],
      labels: [{ x: 0.1, y: 0.1, text: '  ' }],
      photo: 42,
    });
    expect(a.regions).toEqual([{ id: 'a' }]);
    expect(a.pins).toEqual([{ x: 1, y: 0 }]);
    expect(a.strokes).toEqual([{ tool: 'pen', color: '#111827', width: 0.004, points: [[0.1, 0.1]] }]);
    expect(a.labels).toEqual([]);
    expect(a.photo).toBeUndefined();
    const many = readAnswer({ strokes: Array.from({ length: 400 }, () => ({ points: [[0, 0]] })) });
    expect(many.strokes).toHaveLength(300);
  });

  it('nothing drawn and nothing written is no answer; notes of regions still marked are kept', () => {
    expect(fromCanvas(emptyCanvas())).toBeUndefined();
    const a = readAnswer(stored);
    const v = { ...toCanvas(a, 100, 100), regions: ['right-knee'] };
    expect(fromCanvas(v, a)!.regions).toEqual([{ id: 'right-knee', note: 'with warmth' }]);
    expect(patchAnswer({ description: 'x' }, { description: undefined })).toBeUndefined();
    expect(patchAnswer({}, { markers: ['jaw'] })).toEqual({ markers: ['jaw'] });
  });
});
