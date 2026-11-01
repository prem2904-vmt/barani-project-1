import type { ReportTemplate } from '../models/report.model';
import { MARGIN_X, MM, PAGE, boxLeft } from './report-header-layout';
import { PALETTE_KEYS, checkColors, normalizeHex, paletteById, templateColors, type PaletteId } from './report-palettes';
import { readReportStyle, validateReportStyle, type ReportStyle, type ReportStylePatch } from './report-style';
import { TIDY_STYLE_PATHS, flattenStylePatch, type TidyChange, type TidyPatch, type TidyResult } from './report-tidy';

/**
 * The Cortex "Tidy up" wire (browser side). Two directions, both strict:
 *
 *  OUT  `buildTidyRequest` sends layout settings and geometry ONLY - the report style, the letterhead items'
 *       id / kind / region / alignment / position / size / TEXT LENGTH, field KEY names, finding code words, and the
 *       fixed questions with their options. No names, no results, no tenant ids, no text of any item, no template colour.
 *  IN   `cortexChanges` re-validates everything the server returned (it already filtered by its own allow-list):
 *       styles through `validateReportStyle`, colours as hex, items against the letterhead the tidy actually read and
 *       the printable area. Anything that fails is dropped and listed, never shown as a change.
 */

export type TidyProvider = 'gemini' | 'claude';

const r1 = (n: number) => Math.round(n * 10) / 10;

const patchPath = (p: TidyPatch): { path: string; value: unknown } | null => {
  switch (p.kind) {
    case 'style': return { path: `style.${p.path}`, value: p.to };
    case 'color': return { path: `color.${p.key}`, value: p.to };
    case 'palette': return { path: 'palette', value: p.id };
    case 'item': return { path: `item.${p.id}.${p.key}`, value: p.to };
    default: return null;   // a deterministic move is never sent
  }
};

/** The style with ONLY the allow-listed leaves (the same list the server keeps): a lab's own words - custom labels, the
 *  joiner, the "verified by" line - never leave the browser, whatever the server would strip later. */
export function tidyStyleOut(tpl: ReportTemplate): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [path, v] of flattenStylePatch(readReportStyle(tpl) as unknown as ReportStylePatch)) {
    const parts = path.split('.');
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) cur = (cur[parts[i]] ??= {}) as Record<string, unknown>;
    cur[parts[parts.length - 1]] = v;
  }
  return out;
}

export function buildTidyRequest(provider: TidyProvider, tpl: ReportTemplate, result: TidyResult): Record<string, unknown> {
  const style = tidyStyleOut(tpl);
  let cols: string[] = [];
  try { cols = (JSON.parse(tpl.patientColumnsJson ?? '[]') as unknown[][]).flat().filter((k): k is string => typeof k === 'string'); } catch { /* none */ }
  return {
    provider,
    style,
    items: Object.values(result.base).map(b => ({
      id: b.id, kind: b.kind, region: b.region, align: b.align, x: r1(b.xMm), y: r1(b.yMm), w: r1(b.wMm), h: r1(b.hMm),
      ...(b.size != null ? { size: b.size } : {}), textLen: b.textLen, hidden: b.hidden,
    })),
    fields: { patient: cols, columns: [] },
    findings: result.findings,
    applied: result.applied,
    choices: result.choices.map(c => ({
      id: c.id,
      options: c.options.map(o => ({ key: o.key, patches: o.patches.map(patchPath).filter((x): x is { path: string; value: unknown } => !!x) })),
    })),
  };
}

export interface CortexAnswer {
  summary: string;
  changes: Array<{ id?: unknown; title?: unknown; why?: unknown; patches?: Array<{ path?: unknown; value?: unknown }> }>;
}

export interface CortexChanges { changes: TidyChange[]; dropped: string[] }

const isNum = (v: unknown): v is number => typeof v === 'number' && isFinite(v);

/** Validate one server patch against the template as it stands; null + reason when it must not be shown. */
function checkPatch(path: string, value: unknown, tpl: ReportTemplate, result: TidyResult): { patch: TidyPatch } | { reason: string } {
  if (path === 'palette') {
    return typeof value === 'string' && paletteById(value) ? { patch: { kind: 'palette', id: value as PaletteId } } : { reason: 'unknown palette' };
  }
  if (path.startsWith('color.')) {
    const key = path.slice(6) as (typeof PALETTE_KEYS)[number];
    const hex = normalizeHex(value);
    if (!PALETTE_KEYS.includes(key) || !hex) return { reason: 'not a colour' };
    // A colour may not make text vanish: a print-safe check that passes today must still pass with the new colour.
    const now = { ...templateColors(tpl), bodyTextColor: tpl.bodyTextColor };
    const flags = tpl.flagStyle === 'bold_color';
    const okNow = new Set(checkColors(now, flags).filter(c => c.ok).map(c => c.id));
    if (checkColors({ ...now, [key]: hex }, flags).some(c => !c.ok && okNow.has(c.id))) return { reason: 'would be hard to read' };
    return { patch: { kind: 'color', key, to: hex } };
  }
  if (path.startsWith('style.')) {
    const p = path.slice(6);
    if (!TIDY_STYLE_PATHS.includes(p)) return { reason: 'setting not allowed' };
    const cur = readReportStyle(tpl);
    const probe: Record<string, unknown> = JSON.parse(JSON.stringify(cur));
    const parts = p.split('.');
    let o = probe;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] as Record<string, unknown>;
    o[parts[parts.length - 1]] = value;
    const { style, rejected } = validateReportStyle(probe);
    if (rejected.length) return { reason: 'value not valid' };
    const got = parts.reduce<unknown>((c, k) => (c as Record<string, unknown>)[k], style as ReportStyle);
    if (JSON.stringify(got) !== JSON.stringify(value)) return { reason: 'value not valid' };
    return { patch: { kind: 'style', path: p, to: value } };
  }
  if (path.startsWith('item.')) {
    const [, id, key] = path.split('.');
    // Own keys only: "__proto__" / "constructor" are not letterhead items.
    const b = Object.prototype.hasOwnProperty.call(result.base, id) ? result.base[id] : undefined;
    if (!b || b.hidden) return { reason: 'unknown item' };
    if (key === 'align') {
      return value === 'left' || value === 'center' || value === 'right' ? { patch: { kind: 'item', id, key, to: value } } : { reason: 'not an alignment' };
    }
    if (!isNum(value)) return { reason: 'not a number' };
    if (key === 'x' || key === 'y') {
      if (value < 0 || value > (key === 'x' ? 210 : 297)) return { reason: 'off the paper' };
      if (key === 'x') {
        const l = boxLeft(value * MM, b.align, b.wMm * MM);
        if (l < MARGIN_X - 0.5 || l + b.wMm * MM > PAGE.w - MARGIN_X + 0.5) return { reason: 'outside the margins' };
      }
      return { patch: { kind: 'item', id, key, to: Math.round(value * 100) / 100 } };
    }
    if (b.kind !== 'text') return { reason: 'text items only' };
    const minPt = readReportStyle(tpl).fit.minPt;
    if (key === 'size') return value >= Math.max(minPt, 5) && value <= 40 ? { patch: { kind: 'item', id, key, to: value } } : { reason: 'size not allowed' };
    if (key === 'wrap') return value >= 0 && value <= 200 ? { patch: { kind: 'item', id, key, to: value } } : { reason: 'wrap not allowed' };
  }
  return { reason: 'not allowed' };
}

/** The server's answer as reviewable changes (source 'cortex'), re-validated here. */
export function cortexChanges(resp: CortexAnswer, tpl: ReportTemplate, result: TidyResult): CortexChanges {
  const out: TidyChange[] = [];
  const dropped: string[] = [];
  const cur = readReportStyle(tpl);
  const seen = new Set<string>();
  for (const c of Array.isArray(resp.changes) ? resp.changes : []) {
    if (!c || typeof c !== 'object') { dropped.push('a suggestion'); continue; }
    const id = typeof c.id === 'string' && c.id.startsWith('cortex:') && c.id.length < 120 ? c.id : null;
    const title = typeof c.title === 'string' ? c.title.slice(0, 80) : '';
    const why = typeof c.why === 'string' ? c.why.slice(0, 240) : '';
    if (!id || !title || !Array.isArray(c.patches) || seen.has(id)) { dropped.push(title || 'a suggestion'); continue; }
    const patches: TidyPatch[] = [];
    let bad: string | null = null;
    for (const p of c.patches.slice(0, 30)) {
      const chk = typeof p.path === 'string' ? checkPatch(p.path, p.value, tpl, result) : { reason: 'bad path' };
      if ('reason' in chk) { bad = chk.reason; break; }
      // a patch that changes nothing is noise
      if (chk.patch.kind === 'style') {
        const now = chk.patch.path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], cur);
        if (JSON.stringify(now) === JSON.stringify(chk.patch.to)) continue;
      }
      patches.push(chk.patch);
    }
    if (bad) { dropped.push(`${title} (${bad})`); continue; }
    if (!patches.length) continue;
    seen.add(id);
    out.push({ id, source: 'cortex', rule: 'cortex', title, why: why || 'Suggested by Cortex.', patches });
  }
  return { changes: out, dropped };
}

export { flattenStylePatch };
