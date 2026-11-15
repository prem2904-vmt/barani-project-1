/**
 * THE registry of Files apps. Adding an app is ONE entry here (plus its engine folder and a fetch script): the Start menu section,
 * pins, Files screen tabs, Settings → Files, editor route, bridge prefix and logo all read this list and nothing else.
 *
 * Names: the place that holds the apps is called "Files" (one constant, owner 2026-11-15; no suite brand).
 */
export const FILES_NAME = 'Files';

/** Kinds the server stores (`office_files.Kind`). */
export type FileKind = 'sheet' | 'doc' | 'slides' | 'pdf' | 'image';
export type FilesAppId = 'neuron' | 'synapse' | 'axon' | 'myelin' | 'retina';

/** One SVG child of the 48x48 logo: a `<path>`, `<circle>` or `<rect>` described as plain data (no markup strings). */
export type LogoPart =
  | { t: 'path'; d: string; stroke?: number; opacity?: number; dash?: string; fill?: boolean; join?: boolean }
  | { t: 'circle'; cx: number; cy: number; r: number }
  | { t: 'rect'; x: number; y: number; w: number; h: number; rx: number; stroke?: number; opacity?: number };

export interface FilesApp {
  id: FilesAppId;
  kind: FileKind;
  /** Product name shown everywhere. */
  name: string;
  /** What a file of this app is called ("sheet"). */
  noun: string;
  nounPlural: string;
  /** One line on the Settings page / tiles. */
  blurb: string;
  /** Allowed file extensions (lower-case, no dot); the first is the default. */
  exts: readonly string[];
  mime: string;
  /** Window-message prefix of the engine (`neuron:`), the JS global (`window.neuron`) and the static folder. */
  prefix: string;
  global: string;
  enginePath: string;
  /** Tile colour, light and dark. */
  color: string;
  colorDark: string;
  /** Logo at normal size (outline + thin strokes) and at 24px and below (no outline, thick strokes). */
  logo: readonly LogoPart[];
  logoSmall: readonly LogoPart[];
  /** New-file button label and the default name of a new file. */
  newLabel: string;
  newName: string;
  /** Route segment of the editor (`/files/<kind>/:id`). */
  route: FileKind;
  /** Start-menu / bar item id. */
  navId: string;
  /** Filter-tab label on the Files screen. */
  tab: string;
  /** Engine templates offered under "Start from a template" (the engine builds them; `cmd` runs once it is ready). */
  templates: readonly { id: string; name: string; cmd?: { cmd: string; params: Record<string, unknown> } }[];
  /** Which file types the editor accepts when opening bytes (magic check; the server checks again). */
  magic: 'zip' | 'pdf' | 'image';
  /** The role may use the app at all (UI hint; the server decides). */
  needsResultsAccess: boolean;
}

const P = (d: string, o: Partial<Extract<LogoPart, { t: 'path' }>> = {}): LogoPart => ({ t: 'path', d, ...o });
const C = (cx: number, cy: number, r: number): LogoPart => ({ t: 'circle', cx, cy, r });

export const FILES_APPS: readonly FilesApp[] = [
  {
    id: 'neuron', kind: 'sheet', name: 'Neuron', noun: 'sheet', nounPlural: 'sheets', blurb: 'Sheets: results lists, QC logs, stock counts',
    exts: ['xlsx'], mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    prefix: 'neuron:', global: 'neuron', enginePath: 'neuron-engine/', color: '#0e8a5f', colorDark: '#16a372',
    logo: [P('M12 15h24M12 24h24M12 33h24M20 11v26M30 11v26', { opacity: 0.45, stroke: 2 }), C(25, 24, 4.5), P('M25 24l9-7M25 24l-8 8M25 24l9 8', { stroke: 2.2 })],
    logoSmall: [C(25, 24, 6), P('M25 24l9-7M25 24l-8 8M25 24l9 8', { stroke: 4 })],
    newLabel: 'New sheet', newName: 'Untitled sheet', route: 'sheet', navId: 'files-neuron', tab: 'Sheets', magic: 'zip', needsResultsAccess: true,
    templates: [
      { id: 'neuron:results', name: 'Daily results log', cmd: { cmd: 'file.new', params: { sample: 'results' } } },
      { id: 'neuron:qc', name: 'QC log', cmd: { cmd: 'file.new', params: { sample: 'qc' } } },
      { id: 'neuron:stock', name: 'Reagent stock', cmd: { cmd: 'file.new', params: { sample: 'stock' } } },
    ],
  },
  {
    id: 'synapse', kind: 'doc', name: 'Synapse', noun: 'document', nounPlural: 'documents', blurb: 'Documents: letters, SOPs, case notes',
    exts: ['docx'], mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    prefix: 'synapse:', global: 'synapse', enginePath: 'synapse-engine/', color: '#2563eb', colorDark: '#3b7bf6',
    logo: [P('M14 13h14l6 6v16H14z', { opacity: 0.5, stroke: 2, join: true }), C(19, 27, 3.5), C(30, 27, 3.5), P('M22.5 27h4', { stroke: 2.2, dash: '1.5 2' })],
    logoSmall: [C(18, 25, 6), C(31, 25, 6)],
    newLabel: 'New document', newName: 'Untitled document', route: 'doc', navId: 'files-synapse', tab: 'Documents', magic: 'zip', needsResultsAccess: false,
    templates: [
      { id: 'synapse:letter', name: "Letter on the lab's letterhead", cmd: { cmd: 'file.new', params: { template: 'letter' } } },
      { id: 'synapse:sop', name: 'Standard operating procedure', cmd: { cmd: 'file.new', params: { template: 'sop' } } },
    ],
  },
  {
    id: 'axon', kind: 'slides', name: 'Axon', noun: 'slide deck', nounPlural: 'slide decks', blurb: 'Slides: case presentations, training, reviews',
    exts: ['pptx'], mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    prefix: 'axon:', global: 'axon', enginePath: 'axon-engine/', color: '#d9480f', colorDark: '#ef5a1c',
    logo: [{ t: 'rect', x: 11, y: 13, w: 26, h: 18, rx: 2.5, stroke: 2, opacity: 0.5 }, C(17, 22, 3.5), P('M20.5 22h10M30.5 22l3-3M30.5 22l3 3M24 31v5M19 36h10', { stroke: 2.2 })],
    logoSmall: [C(16, 22, 6), P('M22 22h12', { stroke: 4 })],
    newLabel: 'New slides', newName: 'Untitled slides', route: 'slides', navId: 'files-axon', tab: 'Slides', magic: 'zip', needsResultsAccess: false,
    templates: [
      { id: 'axon:case', name: 'Case presentation', cmd: { cmd: 'file.new', params: { template: 'case' } } },
      { id: 'axon:review', name: 'Monthly quality review', cmd: { cmd: 'file.new', params: { template: 'review' } } },
    ],
  },
  {
    id: 'myelin', kind: 'pdf', name: 'Myelin', noun: 'PDF', nounPlural: 'PDFs', blurb: 'PDFs: view, print, merge, fill and sign, redact',
    exts: ['pdf'], mime: 'application/pdf',
    prefix: 'myelin:', global: 'myelin', enginePath: 'myelin-engine/', color: '#b4235a', colorDark: '#d6336c',
    logo: [P('M14 13h14l6 6v16H14z', { opacity: 0.5, stroke: 2, join: true }), P('M17 28h3M22 28h3M27 28h3', { stroke: 3 }), C(32, 28, 2)],
    logoSmall: [P('M12 24h6M21 24h6M30 24h5', { stroke: 5 }), C(39, 24, 3)],
    newLabel: 'Open a PDF', newName: 'Untitled', route: 'pdf', navId: 'files-myelin', tab: 'PDFs', magic: 'pdf', needsResultsAccess: false,
    templates: [],
  },
  {
    id: 'retina', kind: 'image', name: 'Retina', noun: 'image', nounPlural: 'images', blurb: 'Clinical images: crop, enhance, annotate, blur faces',
    exts: ['png', 'jpg', 'jpeg', 'webp'], mime: 'image/png',
    prefix: 'retina:', global: 'retina', enginePath: 'retina-engine/', color: '#0f766e', colorDark: '#14b8a6',
    logo: [{ t: 'rect', x: 11, y: 13, w: 26, h: 22, rx: 3, stroke: 2, opacity: 0.5 }, C(32, 20, 2.5), P('M13 33l8-9 6 6 4-4 6 7', { stroke: 2.2, join: true })],
    logoSmall: [C(24, 24, 9), P('M24 24h.01', { stroke: 6 })],
    newLabel: 'Open an image', newName: 'Untitled', route: 'image', navId: 'files-retina', tab: 'Images', magic: 'image', needsResultsAccess: false,
    templates: [],
  },
];

export const filesApp = (id: string): FilesApp | undefined => FILES_APPS.find(a => a.id === id);
export const filesAppForKind = (kind: string): FilesApp | undefined => FILES_APPS.find(a => a.kind === kind);
/** The app whose editor route segment is `seg` (`doc`, `sheet`…). */
export const filesAppForRoute = (seg: string): FilesApp | undefined => FILES_APPS.find(a => a.route === seg);
export const filesAppForNavId = (navId: string): FilesApp | undefined => FILES_APPS.find(a => a.navId === navId);

/** Bar / Start-menu id of the Files home. */
export const FILES_NAV_ID = 'files';
export const isFilesNavId = (id: string): boolean => id === FILES_NAV_ID || FILES_APPS.some(a => a.navId === id);

/** The file's extension in lower-case without the dot ('' when none). */
export function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name ?? '');
  return m ? m[1].toLowerCase() : '';
}
/** A name this app may store: its extension, or (images) any picture one. */
export function extensionAllowed(app: FilesApp, name: string): boolean {
  return app.exts.includes(extOf(name));
}
/** `Name` → `Name.xlsx` (keeps a valid extension, otherwise the app's default). */
export function withAppExtension(app: FilesApp, name: string): string {
  const base = (name || app.newName).trim().replace(/\.[A-Za-z0-9]{1,8}$/, (m) => (app.exts.includes(m.slice(1).toLowerCase()) ? '' : m));
  return extensionAllowed(app, name) ? name.trim() : `${base}.${app.exts[0]}`;
}
/** The name without its extension, for display. */
export const stemOf = (name: string): string => (name ?? '').replace(/\.[A-Za-z0-9]{1,8}$/, '');

/** Byte sniffing for the editor's open check (the server checks again). */
export type Sniff = 'zip' | 'pdf' | 'png' | 'jpg' | 'webp' | 'other';
export function sniff(bytes: ArrayBuffer | ArrayBufferView | null | undefined): Sniff {
  if (!bytes) return 'other';
  const v = ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes);
  const at = (i: number) => v[i];
  if (v.length >= 4 && at(0) === 0x50 && at(1) === 0x4b && at(2) === 0x03 && at(3) === 0x04) return 'zip';
  if (v.length >= 5 && at(0) === 0x25 && at(1) === 0x50 && at(2) === 0x44 && at(3) === 0x46 && at(4) === 0x2d) return 'pdf';
  if (v.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'png';
  if (v.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'jpg';
  if (v.length >= 12 && at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return 'webp';
  return 'other';
}
/** Do these bytes look like a file of this app? */
export function bytesFit(app: FilesApp, bytes: ArrayBuffer | ArrayBufferView | null | undefined): boolean {
  const s = sniff(bytes);
  return app.magic === 'zip' ? s === 'zip' : app.magic === 'pdf' ? s === 'pdf' : s === 'png' || s === 'jpg' || s === 'webp';
}
export const MAX_DEVICE_BYTES = 25 * 1024 * 1024;
