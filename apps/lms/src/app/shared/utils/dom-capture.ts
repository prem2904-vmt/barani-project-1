/**
 * DOM → capture-tree serializer for Design mode's "Capture" button.
 *
 * Walks the visible DOM and produces a JSON layer tree (`.pfcapture.json`)
 * that the companion Figma plugin (tools/figma-capture-plugin) rebuilds as
 * native, editable Figma nodes — frames, rectangles, text, SVG, images.
 * Everything is measured in VIEWPORT pixels: what you see is what lands in
 * Figma, at the breakpoint you captured at.
 *
 * v1 fidelity contract (deliberate):
 * - absolute positions (pixel-accurate), no auto-layout inference
 * - one text layer per element (direct text nodes merged) — mixed inline
 *   formatting inside one element collapses to the element's computed font
 * - first box-shadow only; simple linear-gradients; pseudo-elements skipped
 * - elements under a `[data-pf-capture-ignore]` ancestor (the Design-mode
 *   badge itself) never appear in a capture
 */

export interface CapturedFont {
  family: string;
  size: number;
  weight: number;
  color: string;
  /** CSS background-image when the element used background-clip:text —
   *  the importer paints the TEXT with this gradient (no box behind). */
  gradient?: string;
  lineHeight: number | null;
  letterSpacing: number;
  align: 'left' | 'center' | 'right' | 'justified';
}

export interface CapturedNode {
  type: 'box' | 'text' | 'svg' | 'img';
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  bg?: string;
  gradient?: string;
  radius?: [number, number, number, number];
  borderColor?: string;
  borderWidth?: number;
  shadow?: string;
  /** backdrop-filter blur radius (glass UI) → Figma background blur. */
  blur?: number;
  opacity?: number;
  clips?: boolean;
  text?: string;
  font?: CapturedFont;
  /** True when the text renders on ONE line in the browser — the importer
   *  must auto-size instead of fixing width, or metric drift causes wraps
   *  that never existed on screen. */
  oneLine?: boolean;
  svg?: string;
  src?: string;
  children?: CapturedNode[];
}

export interface ScreenCapture {
  version: 1;
  name: string;
  route: string;
  breakpoint: string;
  width: number;
  height: number;
  theme: 'light' | 'dark';
  capturedAt: string;
  root: CapturedNode;
}

/** rgba(0, 0, 0, 0) / transparent → false; anything with alpha > 0 → true. */
export function isVisibleColor(css: string | null | undefined): boolean {
  if (!css || css === 'transparent' || css === 'none') return false;
  const m = css.match(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (!m) return true; // named/hex colors — assume visible
  return m[1] === undefined || parseFloat(m[1]) > 0;
}

/** "12px" → 12; anything unparsable → 0. */
export function px(v: string | null | undefined): number {
  const n = parseFloat(v ?? '');
  return Number.isFinite(n) ? n : 0;
}

/** blur radius out of a computed backdrop-filter, else 0. */
export function backdropBlurPx(filter: string | null | undefined): number {
  const m = (filter ?? '').match(/blur\(\s*([\d.]+)px\s*\)/);
  return m ? parseFloat(m[1]) : 0;
}

/** Safe cross-platform file stem: "lab/my-work" → "lab-my-work". */
export function fileStem(route: string, breakpoint: string, width: number): string {
  const slug = (route || 'home').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
  return `${slug}-${breakpoint.toLowerCase()}${width}`;
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'TITLE']);

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function nodeName(el: Element): string {
  const cls = (typeof el.className === 'string' ? el.className : '')
    .split(/\s+/).find(c => c.startsWith('pf-'));
  return cls ?? el.tagName.toLowerCase();
}

function directText(el: Element): string {
  let out = '';
  el.childNodes.forEach(n => {
    if (n.nodeType === Node.TEXT_NODE) out += n.textContent ?? '';
  });
  return out.replace(/\s+/g, ' ').trim();
}

function fontOf(style: CSSStyleDeclaration): CapturedFont {
  const family = style.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  const alignRaw = style.textAlign;
  const align: CapturedFont['align'] =
    alignRaw === 'center' ? 'center'
    : alignRaw === 'right' || alignRaw === 'end' ? 'right'
    : alignRaw === 'justify' ? 'justified'
    : 'left';
  const lh = style.lineHeight;
  return {
    family,
    size: px(style.fontSize) || 13,
    weight: parseInt(style.fontWeight, 10) || 400,
    color: style.color,
    lineHeight: lh && lh !== 'normal' ? px(lh) : null,
    letterSpacing: style.letterSpacing === 'normal' ? 0 : px(style.letterSpacing),
    align,
  };
}

function serialize(el: Element, vw: number, vh: number): CapturedNode | null {
  if (SKIP_TAGS.has(el.tagName) || el.hasAttribute('data-pf-capture-ignore')) return null;

  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || px(style.opacity) === 0) return null;

  const r = el.getBoundingClientRect();
  // Entirely off-viewport → not part of what the capturer sees.
  if (r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) return null;

  const base = { x: round(r.left), y: round(r.top), w: round(r.width), h: round(r.height) };

  // Whole inline SVGs travel as raw markup — createNodeFromSvg keeps our
  // stroked icons as true vectors.
  if (el instanceof SVGSVGElement) {
    if (base.w <= 0 || base.h <= 0) return null;
    // currentColor means "inherited CSS color" — resolve it NOW, or the
    // importer guesses and faint decorative strokes turn loud and solid.
    const svg = el.outerHTML
      .replace(/\scurrentColor/g, ' ' + style.color)
      .replace(/"currentColor"/g, '"' + style.color + '"')
      .replace(/ _ng[a-z]+-[\w-]+=""/g, '');
    return { type: 'svg', name: nodeName(el), ...base, svg, opacity: px(style.opacity) };
  }
  if (el.tagName === 'svg') {
    return null; // non-root svg edge case — handled above in browsers
  }

  if (el instanceof HTMLImageElement) {
    if (base.w <= 0 || base.h <= 0) return null;
    let src = el.currentSrc || el.src;
    try {
      // Same-origin images inline as data URLs so the capture file is
      // self-contained; cross-origin (canvas-tainting) ones keep their URL
      // and the plugin fetches them.
      const canvas = document.createElement('canvas');
      canvas.width = el.naturalWidth || Math.max(1, Math.round(base.w));
      canvas.height = el.naturalHeight || Math.max(1, Math.round(base.h));
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
        src = canvas.toDataURL('image/png');
      }
    } catch { /* tainted canvas — plugin will fetch by URL */ }
    const radius = px(style.borderTopLeftRadius);
    return {
      type: 'img', name: nodeName(el), ...base, src,
      radius: [radius, px(style.borderTopRightRadius), px(style.borderBottomRightRadius), px(style.borderBottomLeftRadius)],
      opacity: px(style.opacity),
    };
  }

  // Children first — a styleless wrapper still needs its subtree carried up.
  const children: CapturedNode[] = [];
  el.childNodes.forEach(c => {
    if (c.nodeType === Node.ELEMENT_NODE) {
      const child = serialize(c as Element, vw, vh);
      if (child) children.push(child);
    }
  });

  const text = directText(el);
  const bgImage = style.backgroundImage;
  const clipsText = ((style as unknown as Record<string, string>)['webkitBackgroundClip'] || style.backgroundClip) === 'text';
  const hasGradient = bgImage.includes('gradient(') && !clipsText;
  const hasBg = isVisibleColor(style.backgroundColor);
  const hasBorder = px(style.borderTopWidth) > 0 && isVisibleColor(style.borderTopColor);
  const hasShadow = style.boxShadow !== 'none' && !!style.boxShadow;
  const blur = backdropBlurPx(style.backdropFilter || (style as unknown as Record<string, string>)['webkitBackdropFilter']);
  const clips = style.overflow !== 'visible' || style.overflowY !== 'visible' || style.overflowX !== 'visible';
  const visual = hasBg || hasGradient || hasBorder || hasShadow || blur > 0;

  // Text-bearing element: the text becomes a child layer so a styled element
  // ("chip with a label") stays one box + one text in Figma.
  if (text) {
    const font = fontOf(style);
    if (clipsText && bgImage.includes('gradient(')) font.gradient = bgImage;
    const innerH = Math.max(1, base.h - px(style.paddingTop) - px(style.paddingBottom) - px(style.borderTopWidth) - px(style.borderBottomWidth));
    children.unshift({
      type: 'text', name: text.slice(0, 40) || 'text',
      x: base.x + px(style.paddingLeft) + px(style.borderLeftWidth),
      y: base.y + px(style.paddingTop) + px(style.borderTopWidth),
      w: Math.max(1, base.w - px(style.paddingLeft) - px(style.paddingRight) - px(style.borderLeftWidth) - px(style.borderRightWidth)),
      h: innerH,
      text, font,
      // On screen this fit one line — the importer must not let it wrap.
      oneLine: innerH < font.size * 1.9,
    });
  }

  // Inputs: surface the value/placeholder the user actually sees.
  if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.type !== 'checkbox' && el.type !== 'radio') {
    const shown = el.value || el.placeholder;
    if (shown) {
      children.unshift({
        type: 'text', name: shown.slice(0, 40),
        x: base.x + px(style.paddingLeft), y: base.y + px(style.paddingTop),
        w: Math.max(1, base.w - px(style.paddingLeft) - px(style.paddingRight)),
        h: Math.max(1, base.h - px(style.paddingTop) - px(style.paddingBottom)),
        text: shown,
        font: el.value ? fontOf(style) : { ...fontOf(style), color: 'rgba(148, 155, 170, 0.8)' },
        oneLine: el instanceof HTMLInputElement,
      });
    }
  }

  if (!visual && children.length === 0) return null;
  if (!visual && children.length === 1) return children[0]; // collapse pass-through wrappers

  const node: CapturedNode = { type: 'box', name: nodeName(el), ...base };
  if (hasBg) node.bg = style.backgroundColor;
  if (hasGradient) node.gradient = bgImage;
  if (hasBorder) { node.borderColor = style.borderTopColor; node.borderWidth = px(style.borderTopWidth); }
  if (hasShadow) node.shadow = style.boxShadow;
  if (blur > 0) node.blur = blur;
  const op = px(style.opacity);
  if (op < 1) node.opacity = op;
  if (clips && (base.w > 0 && base.h > 0)) node.clips = true;
  node.radius = [
    px(style.borderTopLeftRadius), px(style.borderTopRightRadius),
    px(style.borderBottomRightRadius), px(style.borderBottomLeftRadius),
  ];
  if (children.length) node.children = children;
  return node;
}

/** Capture the current viewport into a self-contained layer tree. */
export function captureScreen(meta: { route: string; breakpoint: string; theme: 'light' | 'dark' }): ScreenCapture {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const root = serialize(document.body, vw, vh) ?? { type: 'box' as const, name: 'body', x: 0, y: 0, w: vw, h: vh };
  return {
    version: 1,
    name: `${meta.route || 'home'} · ${meta.breakpoint} ${vw}`,
    route: meta.route,
    breakpoint: meta.breakpoint,
    width: vw,
    height: vh,
    theme: meta.theme,
    capturedAt: new Date().toISOString(),
    root,
  };
}

/** Trigger a browser download of the capture file. */
export function downloadCapture(capture: ScreenCapture): void {
  const blob = new Blob([JSON.stringify(capture)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileStem(capture.route, capture.breakpoint, capture.width)}.pfcapture.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
