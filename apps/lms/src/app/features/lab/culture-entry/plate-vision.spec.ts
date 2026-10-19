import {
  Gray, classifyDisk, consensusShape, diskFeatures, fitDiskEllipse, localDisk, measureZone, mosaicLayout,
  readingOrder, reconcileScale, scaleWarning, tiltCheck,
} from './plate-vision';
import { classifyCandidates } from './plate-detect';
import { buildMosaic, CanvasLike } from './disk-read';

/** Plate vision — the pure (no OpenCV) measuring half, on synthetic plates. */

const PX_PER_MM = 5;

/** A synthetic plate image: lawn, optional zone, the paper disk (with a
 *  printed "code" — two dark strokes), all optionally squashed along y
 *  (a tilted photo). Blurred a little like the real pipeline. */
function plate(opts: { zoneMm?: number; zone?: number; lawn?: number; squash?: number; w?: number; noise?: number } = {}): { g: Gray; cx: number; cy: number } {
  const w = opts.w ?? 240, h = w, cx = w / 2, cy = h / 2;
  const lawn = opts.lawn ?? 150, zone = opts.zone ?? 100, sq = opts.squash ?? 1;
  const dR = 3 * PX_PER_MM, zR = ((opts.zoneMm ?? 0) / 2) * PX_PER_MM;
  const d = new Float32Array(w * h);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x - cx, dy = (y - cy) / sq;
    const r = Math.hypot(dx, dy);
    let v = lawn + (rnd() - 0.5) * (opts.noise ?? 4);
    if (r < zR) v = zone + (rnd() - 0.5) * 2;
    if (r < dR) {
      v = 225;
      if (Math.abs(dx) < dR * 0.5 && (Math.abs(dy - 3) < 1 || Math.abs(dy + 3) < 1)) v = 60;   // printed text
    }
    d[y * w + x] = v;
  }
  return { g: blur({ w, h, d }), cx, cy };
}
function blur(g: Gray): Gray {
  const out = new Float32Array(g.d.length);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    let s = 0, n = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const xx = x + i, yy = y + j;
      if (xx < 0 || yy < 0 || xx >= g.w || yy >= g.h) continue;
      s += g.d[yy * g.w + xx]; n++;
    }
    out[y * g.w + x] = s / n;
  }
  return { w: g.w, h: g.h, d: out };
}
const disk = (cx: number, cy: number, sq = 1) => {
  const r = 3 * PX_PER_MM;
  return { cx, cy, rx: r, ry: r * sq, angle: 0 };
};

describe('mosaic', () => {
  it('lays out numbered 256px tiles, 4 per row, row-major', () => {
    const m = mosaicLayout(14);
    expect(m.width).toBe(1024);
    expect(m.height).toBe(1024);
    expect(m.tiles.length).toBe(14);
    expect(m.tiles[0]).toEqual({ n: 1, x: 0, y: 0 });
    expect(m.tiles[3]).toEqual({ n: 4, x: 768, y: 0 });
    expect(m.tiles[4]).toEqual({ n: 5, x: 0, y: 256 });
    expect(m.tiles[13]).toEqual({ n: 14, x: 256, y: 768 });
    expect(mosaicLayout(3).width).toBe(768);          // fewer than 4 → narrower
  });

  it('builds the JPEG: one crop per disk in order, badge = the disk number, base64 without the data: prefix', () => {
    const draws: number[][] = [], texts: string[] = [];
    let quality = 0, type = '';
    const canvas: CanvasLike = {
      width: 0, height: 0,
      getContext: () => ({
        fillStyle: '', font: '', textBaseline: 'alphabetic', textAlign: 'start',
        fillRect() { /* */ },
        drawImage(_i: unknown, sx: number, sy: number, sw: number, _sh: number, dx: number, dy: number) { draws.push([sx, sy, sw, dx, dy]); },
        fillText(t: string) { texts.push(t); },
      }),
      toDataURL(t: string, q: number) { type = t; quality = q; return 'data:image/jpeg;base64,QUJD'; },
    };
    const disks = [{ cx: 100, cy: 100, r: 10, n: 1 }, { cx: 200, cy: 100, r: 10, n: 2 }, { cx: 50, cy: 300, r: 10, n: 5 },
      { cx: 60, cy: 60, r: 10, n: 6 }, { cx: 70, cy: 70, r: 10, n: 7 }];
    const m = buildMosaic({} as CanvasImageSource, disks, () => canvas);
    expect(draws.length).toBe(5);
    expect(draws[0]).toEqual([84, 84, 32, 0, 0]);       // 1.6 × r around the disk
    expect(draws[4].slice(3)).toEqual([0, 256]);        // 5th tile starts row 2
    expect(texts).toEqual(['1', '2', '5', '6', '7']);
    expect(m.tiles).toEqual([1, 2, 5, 6, 7]);
    expect(m.base64).toBe('QUJD');
    expect(type).toBe('image/jpeg');
    expect(quality).toBeCloseTo(0.9);
    expect(canvas.width).toBe(1024);
    expect(canvas.height).toBe(512);
  });

  it('reading order: rows top→bottom, then left→right', () => {
    const pts = [{ cx: 300, cy: 102 }, { cx: 100, cy: 98 }, { cx: 200, cy: 300 }, { cx: 50, cy: 305 }];
    expect(readingOrder(pts, 20)).toEqual([1, 0, 3, 2]);
  });
});

describe('scale: plate rim vs the 6 mm disk ruler', () => {
  it('agree within 8% → plate scale, no warning', () => {
    const s = reconcileScale(450, 90, [30, 30.5, 29.5]);      // 0.2 vs 0.2 mm/px
    expect(s.mismatch).toBe(false);
    expect(s.source).toBe('plate');
    expect(s.mmPerPx).toBeCloseTo(0.2);
    expect(scaleWarning(s)).toBeNull();
  });

  it('a 100 mm plate set as 90 → mismatch, disks win, "is it 100 mm?"', () => {
    // Rim 500 px; the disks say 0.2 mm/px → the rim is 100 mm.
    const s = reconcileScale(500, 90, [30, 30, 30, 31, 29]);
    expect(s.mismatch).toBe(true);
    expect(s.source).toBe('disk');
    expect(s.mmPerPx).toBeCloseTo(0.2);
    expect(s.suggestedDishMm).toBe(100);
    expect(scaleWarning(s)).toBe('Plate size looks different — is it 100 mm?');
  });

  it('mismatch with no matching size → the generic line', () => {
    const s = reconcileScale(500, 90, [40, 40, 40]);
    expect(s.mismatch).toBe(true);
    expect(s.suggestedDishMm).toBeNull();
    expect(scaleWarning(s)).toMatch(/measuring with the disks/);
  });

  it('no plate → disks; one disk → plate', () => {
    expect(reconcileScale(null, 90, [30, 30]).source).toBe('disk');
    expect(reconcileScale(450, 90, [30]).source).toBe('plate');
    expect(reconcileScale(null, 90, []).source).toBe('none');
  });
});

describe('tilt', () => {
  it('round disks → no warning; a shared 1.25 ellipse → "retake"', () => {
    expect(tiltCheck([{ rx: 15, ry: 15, angle: 0 }, { rx: 15, ry: 15, angle: 1 }]).warn).toBe(false);
    const t = tiltCheck([{ rx: 15, ry: 12, angle: 0.3 }, { rx: 15.2, ry: 12.1, angle: 0.32 }, { rx: 14.8, ry: 11.9, angle: 0.28 }]);
    expect(t.warn).toBe(true);
    expect(t.ratio).toBeGreaterThan(1.2);
  });

  it('edge noise pointing every which way cancels (no false warning)', () => {
    const c = consensusShape([{ rx: 17, ry: 14, angle: 0 }, { rx: 17, ry: 14, angle: Math.PI / 2 }]);
    expect(c.ratio).toBeCloseTo(1, 2);
    expect(tiltCheck([{ rx: 17, ry: 14, angle: 0 }, { rx: 17, ry: 14, angle: Math.PI / 2 }]).warn).toBe(false);
  });

  it('local ruler: own centre, neighbours\' size and shape', () => {
    const ds = [
      { cx: 0, cy: 0, rx: 16, ry: 16, angle: 0, r: 16 },
      { cx: 50, cy: 0, rx: 14, ry: 14, angle: 0, r: 14 },
      { cx: 0, cy: 50, rx: 15, ry: 15, angle: 0, r: 15 },
      { cx: 900, cy: 900, rx: 30, ry: 30, angle: 0, r: 30 },   // far away, ignored
    ];
    const l = localDisk(ds, 0);
    expect(l.cx).toBe(0);
    expect((l.rx + l.ry) / 2).toBeCloseTo(15);
  });
});

describe('zone diameter by radial profile (synthetic plates)', () => {
  it('a 14 mm darker zone reads ≈14 mm', () => {
    const { g, cx, cy } = plate({ zoneMm: 14 });
    const z = measureZone(g, disk(cx, cy), disk(cx, cy));
    expect(z.found).toBe(true);
    expect(z.mm).toBeGreaterThan(13.3);
    expect(z.mm).toBeLessThan(14.7);
  });

  it('a lighter zone works too', () => {
    const { g, cx, cy } = plate({ zoneMm: 20, zone: 200, lawn: 130 });
    const z = measureZone(g, disk(cx, cy), disk(cx, cy));
    expect(z.found).toBe(true);
    expect(Math.abs(z.mm - 20)).toBeLessThan(0.8);
  });

  it('no zone reports 6 mm — never less', () => {
    const { g, cx, cy } = plate({ zoneMm: 0 });
    const z = measureZone(g, disk(cx, cy), disk(cx, cy));
    expect(z.found).toBe(false);
    expect(z.mm).toBe(6);
  });

  it('tilted photo: the oval zone is measured against the oval disk → true size', () => {
    const { g, cx, cy } = plate({ zoneMm: 16, squash: 0.8 });
    const z = measureZone(g, disk(cx, cy, 0.8), disk(cx, cy, 0.8));
    expect(z.found).toBe(true);
    expect(Math.abs(z.mm - 16)).toBeLessThan(0.8);
    // …while a round ruler would read the long and short axis apart.
    expect(Math.abs(z.axes[0] - z.axes[1])).toBeLessThan(1);
  });

  it('a speckled bright "zone" (glare) is refused', () => {
    const { g, cx, cy } = plate({ zoneMm: 0 });
    // Paint speckled glare round the disk.
    let s = 3;
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const r = Math.hypot(x - cx, y - cy);
      if (r > 16 && r < 45) { s = (s * 16807) % 2147483647; g.d[y * g.w + x] = s % 3 === 0 ? 245 : 170; }
    }
    expect(measureZone(g, disk(cx, cy), disk(cx, cy)).found).toBe(false);
  });
});

describe('paper disk vs glare', () => {
  it('fits the disk outline (round → ratio ≈ 1; squashed → the squash)', () => {
    const a = plate({ zoneMm: 12 });
    const e = fitDiskEllipse(a.g, { cx: a.cx, cy: a.cy, r: 15 });
    expect(Math.max(e.rx, e.ry) / Math.min(e.rx, e.ry)).toBeLessThan(1.06);
    expect((e.rx + e.ry) / 2).toBeGreaterThan(14);
    expect((e.rx + e.ry) / 2).toBeLessThan(16.5);
    const b = plate({ zoneMm: 12, squash: 0.8 });
    const e2 = fitDiskEllipse(b.g, { cx: b.cx, cy: b.cy, r: 13.5 });
    expect(Math.max(e2.rx, e2.ry) / Math.min(e2.rx, e2.ry)).toBeGreaterThan(1.18);
  });

  it('a printed disk passes; a speckled glare patch and a wrong-size blob are rejected', () => {
    const { g, cx, cy } = plate({ zoneMm: 0, w: 400 });
    // A glare patch elsewhere: speckle, no crisp rim, no print.
    let s = 11;
    for (let y = 40; y < 110; y++) for (let x = 40; x < 110; x++) {
      if (Math.hypot(x - 75, y - 75) > 30) continue;
      s = (s * 16807) % 2147483647; g.d[y * g.w + x] = s % 2 ? 235 : 175;
    }
    const f = diskFeatures(g, { cx, cy, r: 15 });
    expect(classifyDisk(f, 15, 15).ok).toBe(true);
    const out = classifyCandidates(g, [{ cx: cx + 2, cy: cy - 1, r: 14 }, { cx: 75, cy: 75, r: 15 }], { cx: 200, cy: 200, r: 400 }, 15);
    expect(out.disks.length).toBe(1);
    expect(Math.hypot(out.disks[0].cx - cx, out.disks[0].cy - cy)).toBeLessThan(2);   // refined onto the disk
    expect(out.rejected.length).toBe(1);
    expect(classifyDisk(f, 28, 15)).toMatchObject({ ok: false, reason: 'size' });
  });
});
