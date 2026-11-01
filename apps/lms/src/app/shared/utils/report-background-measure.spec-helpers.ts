import type { PixelImage } from './report-background-measure';

/** Synthetic stationery for the measuring specs. An A4 sheet at `pxPerMm` pixels per mm. */
export interface Stationery {
  /** Paper colour (default white). */
  paper?: [number, number, number];
  /** Printed bands: [fromMm, toMm] from the TOP of the sheet. */
  bands?: Array<[number, number]>;
  /** Random scanner noise amplitude (0-255), seeded. */
  noise?: number;
  /** Full-height vertical rules at these x positions (mm). */
  sideRules?: number[];
  /** Isolated specks (dust). */
  specks?: number;
  /** Image width/height in mm (default A4 210 x 297). */
  widthMm?: number;
  heightMm?: number;
  pxPerMm?: number;
  ink?: [number, number, number];
}

export function stationery(o: Stationery = {}): PixelImage {
  const ppm = o.pxPerMm ?? 4, w = Math.round((o.widthMm ?? 210) * ppm), h = Math.round((o.heightMm ?? 297) * ppm);
  const paper = o.paper ?? [255, 255, 255], ink = o.ink ?? [20, 50, 120];
  const data = new Uint8ClampedArray(w * h * 4);
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let y = 0; y < h; y++) {
    const mmY = y / ppm;
    const inBand = (o.bands ?? []).some(([a, b]) => mmY >= a && mmY < b);
    for (let x = 0; x < w; x++) {
      const mmX = x / ppm;
      // a band is a row of logo-like marks across the middle 80 percent of the sheet
      const mark = inBand && mmX > 20 && mmX < 190 && (Math.floor(mmX / 6) % 2 === 0);
      const rule = (o.sideRules ?? []).some(rx => Math.abs(mmX - rx) < 0.4);
      const n = o.noise ? (rnd() - 0.5) * o.noise : 0;
      const c = mark || rule ? ink : paper;
      const i = (y * w + x) * 4;
      data[i] = c[0] + n; data[i + 1] = c[1] + n; data[i + 2] = c[2] + n; data[i + 3] = 255;
    }
  }
  for (let k = 0; k < (o.specks ?? 0); k++) {
    const x = Math.floor(rnd() * w), y = Math.floor(rnd() * h), i = (y * w + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 30;
  }
  return { data, width: w, height: h };
}
