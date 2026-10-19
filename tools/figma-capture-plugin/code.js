// Prefrontal Capture — Figma plugin main thread.
// Rebuilds a .pfcapture.json layer tree (produced by the app's Design mode
// Capture button, apps/lms/.../shared/utils/dom-capture.ts) as native Figma
// nodes. Runs entirely locally: no accounts, no servers, no cost.

figma.showUI(__html__, { width: 380, height: 260 });

// ── color / style parsing ──────────────────────────────────────────────

/** "rgb(1, 2, 3)" | "rgba(1, 2, 3, .5)" | "#a855f7" → {r,g,b,a} in 0..1 */
function parseColor(css) {
  if (!css) return null;
  let m = css.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (m) {
    return { r: +m[1] / 255, g: +m[2] / 255, b: +m[3] / 255, a: m[4] === undefined ? 1 : +m[4] };
  }
  m = css.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return {
      r: parseInt(h.slice(0, 2), 16) / 255,
      g: parseInt(h.slice(2, 4), 16) / 255,
      b: parseInt(h.slice(4, 6), 16) / 255,
      a: 1,
    };
  }
  return null;
}

function solidFill(css) {
  const c = parseColor(css);
  if (!c || c.a === 0) return null;
  return { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a };
}

/** First linear-gradient in a computed background-image → Figma gradient
 *  fill. Unparseable gradients fall back to their first color stop. */
function gradientFill(css) {
  const m = css.match(/linear-gradient\(([^)]*(?:\([^)]*\)[^)]*)*)\)/);
  if (!m) return null;
  const body = m[1];
  let angle = 180; // CSS default: "to bottom"
  const angleMatch = body.match(/^\s*(-?[\d.]+)deg/);
  const toMatch = body.match(/^\s*to\s+([a-z ]+)/);
  if (angleMatch) angle = parseFloat(angleMatch[1]);
  else if (toMatch) {
    const dir = toMatch[1].trim();
    angle = { top: 0, right: 90, bottom: 180, left: 270 }[dir] ??
            { 'top right': 45, 'right top': 45, 'bottom right': 135, 'right bottom': 135,
              'bottom left': 225, 'left bottom': 225, 'top left': 315, 'left top': 315 }[dir] ?? 180;
  }
  const stopRe = /(rgba?\([^)]+\)|#[0-9a-f]{3,8})\s*([\d.]+%)?/gi;
  const stops = [];
  let sm;
  while ((sm = stopRe.exec(body)) !== null) {
    const c = parseColor(sm[1]);
    if (c) stops.push({ color: c, pos: sm[2] !== undefined ? parseFloat(sm[2]) / 100 : null });
  }
  if (stops.length < 2) {
    return stops.length === 1
      ? { type: 'SOLID', color: { r: stops[0].color.r, g: stops[0].color.g, b: stops[0].color.b }, opacity: stops[0].color.a }
      : null;
  }
  // Distribute positionless stops evenly.
  stops.forEach((s, i) => { if (s.pos === null) s.pos = i / (stops.length - 1); });
  // Rotate the gradient axis around the shape center.
  const rad = ((angle - 90) * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return {
    type: 'GRADIENT_LINEAR',
    gradientTransform: [
      [cos, sin, 0.5 - 0.5 * cos - 0.5 * sin],
      [-sin, cos, 0.5 + 0.5 * sin - 0.5 * cos],
    ],
    gradientStops: stops.map(s => ({
      position: Math.min(1, Math.max(0, s.pos)),
      color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a },
    })),
  };
}

/** Computed box-shadow (possibly multiple, possibly inset) → Figma effects. */
function shadowEffects(css) {
  const effects = [];
  const re = /(rgba?\([^)]+\)|#[0-9a-f]{3,8})\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px(?:\s+(-?[\d.]+)px)?(\s+inset)?/gi;
  let m;
  while ((m = re.exec(css)) !== null) {
    const c = parseColor(m[1]);
    if (!c) continue;
    effects.push({
      type: m[6] ? 'INNER_SHADOW' : 'DROP_SHADOW',
      color: { r: c.r, g: c.g, b: c.b, a: c.a },
      offset: { x: parseFloat(m[2]), y: parseFloat(m[3]) },
      radius: parseFloat(m[4]),
      spread: m[5] ? parseFloat(m[5]) : 0,
      visible: true,
      blendMode: 'NORMAL',
    });
  }
  return effects;
}

// ── fonts ──────────────────────────────────────────────────────────────

const WEIGHT_STYLES = {
  100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular',
  500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black',
};
const loadedFonts = new Set();

async function loadFont(family, weight) {
  const style = WEIGHT_STYLES[Math.round((weight || 400) / 100) * 100] || 'Regular';
  const candidates = [
    { family, style },
    { family, style: 'Regular' },
    { family: 'Inter', style },
    { family: 'Inter', style: 'Regular' },
  ];
  for (const f of candidates) {
    const key = f.family + '::' + f.style;
    try {
      if (!loadedFonts.has(key)) {
        await figma.loadFontAsync(f);
        loadedFonts.add(key);
      }
      return f;
    } catch (e) { /* try next candidate */ }
  }
  return { family: 'Inter', style: 'Regular' };
}

// ── node building ──────────────────────────────────────────────────────

function applyBoxStyles(shape, node) {
  const fills = [];
  const grad = node.gradient ? gradientFill(node.gradient) : null;
  const bg = node.bg ? solidFill(node.bg) : null;
  if (bg) fills.push(bg);
  if (grad) fills.push(grad);
  shape.fills = fills;
  if (node.borderColor && node.borderWidth) {
    const stroke = solidFill(node.borderColor);
    if (stroke) {
      shape.strokes = [stroke];
      shape.strokeWeight = node.borderWidth;
      shape.strokeAlign = 'INSIDE';
    }
  }
  if (node.radius) {
    shape.topLeftRadius = node.radius[0];
    shape.topRightRadius = node.radius[1];
    shape.bottomRightRadius = node.radius[2];
    shape.bottomLeftRadius = node.radius[3];
  }
  const effects = node.shadow ? shadowEffects(node.shadow) : [];
  if (node.blur) {
    effects.push({ type: 'BACKGROUND_BLUR', radius: node.blur, visible: true });
  }
  if (effects.length) shape.effects = effects;
  if (node.opacity !== undefined && node.opacity < 1) shape.opacity = node.opacity;
}

async function buildNode(node, parent, ox, oy) {
  try {
    const w = Math.max(1, node.w);
    const h = Math.max(1, node.h);

    if (node.type === 'svg') {
      const el = figma.createNodeFromSvg(node.svg);
      el.name = node.name;
      el.x = node.x - ox;
      el.y = node.y - oy;
      if (el.width > 0 && el.height > 0) el.resize(w, h);
      if (node.opacity !== undefined && node.opacity < 1) el.opacity = node.opacity;
      parent.appendChild(el);
      return;
    }

    if (node.type === 'text') {
      const t = figma.createText();
      const f = node.font || {};
      t.fontName = await loadFont(f.family || 'Inter', f.weight);
      t.characters = node.text || '';
      t.fontSize = f.size || 13;
      // background-clip:text gradients ride ON the text itself.
      const grad = f.gradient ? gradientFill(f.gradient) : null;
      const fill = grad || solidFill(f.color || 'rgb(230, 230, 239)');
      if (fill) t.fills = [fill];
      if (f.lineHeight) t.lineHeight = { value: f.lineHeight, unit: 'PIXELS' };
      if (f.letterSpacing) t.letterSpacing = { value: f.letterSpacing, unit: 'PIXELS' };
      t.textAlignHorizontal = (f.align || 'left').toUpperCase();
      t.textAlignVertical = 'CENTER';
      t.name = node.name;
      parent.appendChild(t);
      if (node.oneLine) {
        // Single line on screen: let Figma size it (font metric drift must
        // never introduce wraps), then honor the alignment inside the slot.
        t.textAutoResize = 'WIDTH_AND_HEIGHT';
        const align = f.align || 'left';
        const dx = align === 'center' ? (w - t.width) / 2 : align === 'right' ? (w - t.width) : 0;
        t.x = node.x - ox + dx;
        t.y = node.y - oy + (h - t.height) / 2;
      } else {
        t.textAutoResize = 'NONE';
        t.x = node.x - ox;
        t.y = node.y - oy;
        t.resize(w, h);
      }
      return;
    }

    if (node.type === 'img') {
      const r = figma.createRectangle();
      r.name = node.name;
      r.x = node.x - ox;
      r.y = node.y - oy;
      r.resize(w, h);
      if (node.radius) {
        r.topLeftRadius = node.radius[0];
        r.topRightRadius = node.radius[1];
        r.bottomRightRadius = node.radius[2];
        r.bottomLeftRadius = node.radius[3];
      }
      if (node.bytes) {
        const image = figma.createImage(new Uint8Array(node.bytes));
        r.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: 'FILL' }];
      } else {
        r.fills = [{ type: 'SOLID', color: { r: 0.45, g: 0.45, b: 0.5 } }];
      }
      if (node.opacity !== undefined && node.opacity < 1) r.opacity = node.opacity;
      parent.appendChild(r);
      return;
    }

    // box
    if (node.children && node.children.length) {
      const frame = figma.createFrame();
      frame.name = node.name;
      frame.x = node.x - ox;
      frame.y = node.y - oy;
      frame.resize(w, h);
      frame.clipsContent = !!node.clips;
      frame.fills = [];
      applyBoxStyles(frame, node);
      parent.appendChild(frame);
      for (const child of node.children) {
        await buildNode(child, frame, node.x, node.y);
      }
    } else {
      const rect = figma.createRectangle();
      rect.name = node.name;
      rect.x = node.x - ox;
      rect.y = node.y - oy;
      rect.resize(w, h);
      applyBoxStyles(rect, node);
      parent.appendChild(rect);
    }
  } catch (e) {
    // One bad node must never kill the whole import.
    console.error('Prefrontal Capture: skipped node', node && node.name, e);
  }
}

figma.ui.onmessage = async (msg) => {
  if (!msg || msg.type !== 'import') return;
  try {
    const cap = msg.capture;
    const frame = figma.createFrame();
    frame.name = cap.name;
    frame.resize(Math.max(1, cap.width), Math.max(1, cap.height));
    frame.x = Math.round(figma.viewport.center.x - cap.width / 2);
    frame.y = Math.round(figma.viewport.center.y - cap.height / 2);
    frame.clipsContent = true;
    // Page backdrop: the root (body) box's own fill, else theme default.
    frame.fills = [{
      type: 'SOLID',
      color: cap.theme === 'dark' ? { r: 0.05, g: 0.05, b: 0.08 } : { r: 1, g: 1, b: 1 },
    }];
    const rootChildren = cap.root.children || [];
    if (cap.root.bg) {
      const fill = solidFill(cap.root.bg);
      if (fill) frame.fills = [fill];
    }
    for (const child of rootChildren) {
      await buildNode(child, frame, 0, 0);
    }
    figma.currentPage.appendChild(frame);
    figma.currentPage.selection = [frame];
    figma.viewport.scrollAndZoomIntoView([frame]);
    figma.ui.postMessage({ type: 'done', name: cap.name });
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: 'Import failed: ' + String(e && e.message || e) });
  }
};
