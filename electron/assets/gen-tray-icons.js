#!/usr/bin/env node
'use strict';
/**
 * Generates the Electron tray icon PNGs from the app's own "pf" glyph
 * (apps/lms/public/logo.svg) — ONE visual source, rendered three ways:
 *
 *   - iconTemplate.png / @2x   macOS Template image: the glyph in solid
 *     black on a transparent background. electron/tray.js loads this and
 *     calls nativeImage#setTemplateImage(true) — macOS then recolours it
 *     itself for the light/dark menu bar, and it must stay monochrome (no
 *     dot baked in: a template image can't show red).
 *   - icon.png / @2x           the full-colour glyph (same gradient as the
 *     app/dock icon) — the quiet Windows tray icon, and the macOS "attention"
 *     base before the dot is added.
 *   - icon-attention.png / @2x the colour glyph plus a small red dot (top
 *     right), baked in ahead of time rather than composited at runtime —
 *     shown on either platform whenever electron/tray.js decides the tray
 *     needs attention (an instrument disconnected, something is queued or
 *     unmatched, the server looks offline, or there's unread chat/bell —
 *     see tray-model.js `hasAttention`). Same red as the existing unread-dot
 *     (electron/notify-core.js `dotBitmap`, rgb 220,38,38 = #DC2626) so the
 *     tray dot and the dock/taskbar unread dot read as the same signal.
 *
 * Electron's nativeImage.createFromPath() auto-picks the "@2x" file sitting
 * next to the one it's given (by filename convention) for Retina / high-DPI
 * displays — no manual scale-factor wiring needed in tray.js.
 *
 * One-off: the output PNGs are committed to the repo; re-run this only when
 * the glyph (apps/lms/public/logo.svg) changes.
 *
 * Needs `sharp` — not a direct dependency of this repo today, but already
 * resolved in node_modules as a transitive dep of @capacitor/assets (used
 * for Capacitor's own icon/splash generation). If that package ever drops
 * sharp, `npm i -D sharp` first.
 *
 * Run: node electron/assets/gen-tray-icons.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SRC_SVG = path.join(__dirname, '../../apps/lms/public/logo.svg');
const OUT_DIR = path.join(__dirname, 'tray');
const DOT_COLOR = '#DC2626'; // electron/notify-core.js dotBitmap's rgb(220,38,38)
const RENDER_DENSITY = 400; // rasterize the (non-square) vector at high-res before downsizing, for crisp edges

async function renderGlyph(svgText, size) {
  return sharp(Buffer.from(svgText), { density: RENDER_DENSITY })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function withDot(baseBuffer, size) {
  const dotSize = Math.max(6, Math.round(size * 0.45));
  const dotSvg = `<svg width="${dotSize}" height="${dotSize}" xmlns="http://www.w3.org/2000/svg">` +
    `<circle cx="${dotSize / 2}" cy="${dotSize / 2}" r="${dotSize / 2}" fill="${DOT_COLOR}"/></svg>`;
  return sharp(baseBuffer)
    .composite([{ input: Buffer.from(dotSvg), top: 0, left: size - dotSize }])
    .png()
    .toBuffer();
}

async function main() {
  const raw = fs.readFileSync(SRC_SVG, 'utf8');
  const mono = raw.replace(/fill="url\(#pfGradient\)"/g, 'fill="#000000"');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const write = (name, buf) => fs.writeFileSync(path.join(OUT_DIR, name), buf);

  for (const [scale, size, suffix] of [[1, 16, ''], [2, 32, '@2x']]) {
    const monoBuf = await renderGlyph(mono, size);
    const colorBuf = await renderGlyph(raw, size);
    const attnBuf = await withDot(colorBuf, size);
    write(`iconTemplate${suffix}.png`, monoBuf);
    write(`icon${suffix}.png`, colorBuf);
    write(`icon-attention${suffix}.png`, attnBuf);
    void scale;
  }

  console.log(`tray icons written to ${path.relative(process.cwd(), OUT_DIR)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
