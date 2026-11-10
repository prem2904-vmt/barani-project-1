import { FieldDef, OptionDef } from '../core/types';
import { MarkerConfig, RegionConfig, pictureConfig } from './picture';

/**
 * Pure Studio edits on a picture question's settings (the shared canvas
 * settings of `drawing`, `bodyMap`, `photoMarkup`; API "Image kinds").
 * Each takes the field clone `updateField` hands over and changes it.
 *  - The picture: a starter (`template`), an upload (`templateAssetId`) or a blank sheet.
 *  - Areas (`config.regions`): on a starter, only their words (label, sentence);
 *    on an upload or a blank sheet, their shape too (`points`, fractions).
 *  - bodyMap's fixed markers (`config.markers`), each one of the field's options (same key).
 */

const f4 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000;

function cfg(f: FieldDef): Record<string, unknown> {
  f.config = { ...(f.config ?? {}) };
  return f.config;
}

/** Use a starter picture (null = a blank sheet). Areas drawn for an upload no longer fit: they go. */
export function useStarter(f: FieldDef, id: string | null): void {
  const c = cfg(f);
  delete c['templateAssetId'];
  if (id) c['template'] = id;
  else delete c['template'];
  // a starter's areas are its own: keep only rewordings (no points)
  const regions = pictureConfig(f).regions.filter((r) => !r.points).map(({ points: _p, ...r }) => r);
  if (regions.length) c['regions'] = regions;
  else delete c['regions'];
}

/** Use an uploaded template picture. Areas with a shape are kept (redraw them if the picture changed); starter rewordings go. */
export function useUpload(f: FieldDef, assetId: string): void {
  const c = cfg(f);
  delete c['template'];
  c['templateAssetId'] = assetId;
  const regions = pictureConfig(f).regions.filter((r) => r.points?.length);
  if (regions.length) c['regions'] = regions;
  else delete c['regions'];
}

/** An area id from its name: lower-case letters, digits and hyphens, unique, ≤ 40. */
export function areaId(f: FieldDef, label: string, taken: readonly string[] = []): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^[^a-z]+/, '')
      .replace(/-+$/, '')
      .slice(0, 34) || 'area';
  const used = new Set([...pictureConfig(f).regions.map((r) => r.id), ...taken]);
  let id = base;
  for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
  return id;
}

function setRegions(f: FieldDef, regions: RegionConfig[]): void {
  const c = cfg(f);
  if (regions.length) c['regions'] = regions;
  else delete c['regions'];
}

function upsert(f: FieldDef, id: string, change: (r: RegionConfig) => RegionConfig): void {
  const list = pictureConfig(f).regions.map((r) => ({ ...r }));
  const i = list.findIndex((r) => r.id === id);
  const next = change(i >= 0 ? list[i] : { id });
  // a starter rewording with nothing left in it is dropped
  const empty = !next.points && !next.label?.trim() && !next.sentence?.trim();
  if (i >= 0) {
    if (empty) list.splice(i, 1);
    else list[i] = next;
  } else if (!empty) list.push(next);
  setRegions(f, list);
}

/** Add an area with its shape (fractions, ≥ 3 points). Returns its id. */
export function addArea(f: FieldDef, label: string, points: [number, number][], taken: readonly string[] = []): string {
  const id = areaId(f, label, taken);
  setRegions(f, [...pictureConfig(f).regions, { id, label: label.trim().slice(0, 80), points: points.map(([x, y]) => [f4(x), f4(y)]) }]);
  return id;
}

export function setAreaPoints(f: FieldDef, id: string, points: [number, number][]): void {
  upsert(f, id, (r) => ({ ...r, points: points.map(([x, y]) => [f4(x), f4(y)]) }));
}

/** Rename an area ('' on a starter = back to the starter's own name). */
export function renameArea(f: FieldDef, id: string, label: string): void {
  const name = label.trim().slice(0, 80);
  upsert(f, id, (r) => {
    const { label: _l, ...rest } = r;
    return name ? { ...rest, label: name } : rest;
  });
}

/** The area's own sentence when it is marked ('' = the field's shared "Marked over {regions}."). */
export function setAreaSentence(f: FieldDef, id: string, sentence: string): void {
  const s = sentence.trim().slice(0, 200);
  upsert(f, id, (r) => {
    const { sentence: _s, ...rest } = r;
    return s ? { ...rest, sentence: s } : rest;
  });
}

export function removeArea(f: FieldDef, id: string): void {
  setRegions(
    f,
    pictureConfig(f).regions.filter((r) => r.id !== id),
  );
}

// ---- bodyMap markers: config.markers (position) + an option of the same key (words, follow-ups) ----

function setMarkers(f: FieldDef, markers: MarkerConfig[]): void {
  const c = cfg(f);
  if (markers.length) c['markers'] = markers;
  else delete c['markers'];
}

/** A marker key from its name (unique among the field's options). */
export function markerKey(f: FieldDef, label: string): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+(.)?/g, (_m, ch: string | undefined) => (ch ? ch.toUpperCase() : ''))
      .replace(/^[^a-z]+/, '') || 'marker';
  const used = new Set([...(f.options ?? []).map((o) => o.key), ...pictureConfig(f).markers.map((m) => m.key)]);
  let key = base;
  for (let i = 2; used.has(key); i++) key = `${base}${i}`;
  return key;
}

export function addMarker(f: FieldDef, label: string, x: number, y: number): string {
  const key = markerKey(f, label);
  setMarkers(f, [...pictureConfig(f).markers, { key, x: f4(x), y: f4(y) }]);
  const name = label.trim();
  const opt: OptionDef = { key, label: name, says: name.charAt(0).toLowerCase() + name.slice(1), subFields: [] };
  f.options = [...(f.options ?? []), opt];
  return key;
}

export function moveMarker(f: FieldDef, key: string, x: number, y: number): void {
  setMarkers(
    f,
    pictureConfig(f).markers.map((m) => (m.key === key ? { ...m, x: f4(x), y: f4(y) } : m)),
  );
}

export function removeMarker(f: FieldDef, key: string): void {
  setMarkers(
    f,
    pictureConfig(f).markers.filter((m) => m.key !== key),
  );
  f.options = (f.options ?? []).filter((o) => o.key !== key);
}

export function renameMarker(f: FieldDef, key: string, label: string): void {
  const name = label.trim();
  if (!name) return;
  f.options = (f.options ?? []).map((o) => (o.key === key ? { ...o, label: name } : o));
}

export function setMarkerSays(f: FieldDef, key: string, says: string): void {
  const words = says.trim();
  f.options = (f.options ?? []).map((o) => {
    if (o.key !== key) return o;
    const { says: _s, ...rest } = o;
    return words ? { ...rest, says: words } : rest;
  });
}

/** A 24-point polygon for an oval (the API stores areas as polygons). */
export function ovalPoints(cx: number, cy: number, rx: number, ry: number, n = 24): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)] as [number, number];
  });
}
