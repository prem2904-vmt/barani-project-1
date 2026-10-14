/**
 * Pure logic for the Instruments screens (no Angular DI): the wizard form ⇄
 * contract config JSON, validation, detect-proposal apply, CBC default code
 * maps, unmapped-code merge, raw-capture rendering and list summaries.
 * Everything here is spec'd in instrument-config.spec.ts.
 */
import { formatDate } from '@angular/common';
import { LAB_TIME_ZONE } from '../utils/lab-clock';
import type {
  CodeMapDto, CodeMapUpsert, DetectResult, Hl7SampleIdField, InstrumentConfig, InstrumentDto, InstrumentMessage,
  InstrumentStatus, InstrumentUpsert, LinkConfig, LinkType, LoincCandidateDto, LoincSuggestionDto, ParserConfig,
  ParserType, TransportConfig, TransportType,
} from './instrument.models';
import { TwoWayForm, buildBidirectional, emptyTwoWayForm, twoWayFromConfig, validateTwoWay } from './instrument-two-way';

// ── Defaults (from the contract) ─────────────────────────────────────────
// Text-template defaults — MUST equal the connector core's TEXT_DEFAULTS
// (electron/instruments/core/parsers/text.js), the parser that actually runs
// them (case-insensitive). electron/instruments/test/text-defaults-sync.test.js
// fails when they drift (a drifted sample-ID default once read the ticket
// line "SAMPLE ID: 2609-00013" as the sample "ID:").
export const DEFAULT_TEXT_LINE_PATTERN = '^\\s*(?<code>[A-Za-z][A-Za-z0-9#%\\-_/]*)\\s+(?<value>[<>]?-?\\d+(?:\\.\\d+)?)\\s*(?<unit>(?![HL*]{1,2}\\s*$)\\S+)?\\s*(?<flag>[HL*]{0,2})\\s*$';
export const DEFAULT_TEXT_SAMPLE_ID_PATTERN = '^\\s*(?:SAMPLE|SPECIMEN|SAMPLE\\s*ID|ID)\\s*(?:NO\\.?)?\\s*[:#]?\\s*(?<id>[A-Za-z0-9\\-]+)\\s*$';
export const DEFAULT_TEXT_QC_PATTERN = '^\\s*(?:QC|CONTROL)\\b';
export const DEFAULT_ACK_TIMEOUT_MS = 15000;
export const DEFAULT_FRAME_TIMEOUT_MS = 30000;
export const DEFAULT_IDLE_MS = 1500;
export const DEFAULT_RECONNECT_MS = 5000;
export const DEFAULT_POLL_MS = 2000;

export type FlowControl = 'none' | 'rtscts' | 'xonxoff';

/** The wizard's editable model — flat, form-friendly. */
export interface InstrumentForm {
  name: string;
  make: string;
  model: string;
  serialNumber: string;
  isActive: boolean;
  transport: TransportType;
  serial: { path: string; baudRate: number; dataBits: number; parity: 'none' | 'even' | 'odd'; stopBits: number; flow: FlowControl };
  tcpServer: { port: number | null };
  tcpClient: { host: string; port: number | null };
  folder: { path: string; pattern: string; moveTo: string };
  protocol: ParserType;
  astm: { sampleIdField: number; sampleIdComponent: number };
  hl7: { sampleIdField: Hl7SampleIdField };
  text: { linePattern: string; sampleIdPattern: string; qcPattern: string };
  /** Two-way with the analyzer (ConfigJson `bidirectional`, instrument-two-way.ts). */
  twoWay: TwoWayForm;
}

export function emptyInstrumentForm(): InstrumentForm {
  return {
    name: '', make: '', model: '', serialNumber: '', isActive: true,
    transport: 'serial',
    serial: { path: '', baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, flow: 'none' },
    tcpServer: { port: 5001 },
    tcpClient: { host: '', port: 5100 },
    folder: { path: '', pattern: '*.txt', moveTo: '' },
    protocol: 'auto',
    astm: { sampleIdField: 3, sampleIdComponent: 1 },
    hl7: { sampleIdField: 'OBR-3' },
    text: { linePattern: DEFAULT_TEXT_LINE_PATTERN, sampleIdPattern: DEFAULT_TEXT_SAMPLE_ID_PATTERN, qcPattern: DEFAULT_TEXT_QC_PATTERN },
    twoWay: emptyTwoWayForm(),
  };
}

// ── Option lists (pf-select) ─────────────────────────────────────────────
export const TRANSPORT_OPTIONS: { value: TransportType; label: string; hint: string }[] = [
  { value: 'serial', label: 'Serial (RS-232 / USB)', hint: 'A cable from the analyzer to this PC' },
  { value: 'tcp-server', label: 'TCP server', hint: 'The analyzer connects to us' },
  { value: 'tcp-client', label: 'TCP client', hint: 'We connect to the analyzer' },
  { value: 'folder', label: 'Folder watch', hint: 'The analyzer writes result files to a folder' },
];
export const BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];
export const DATA_BITS = [7, 8];
export const PARITIES: { value: 'none' | 'even' | 'odd'; label: string }[] = [
  { value: 'none', label: 'None' }, { value: 'even', label: 'Even' }, { value: 'odd', label: 'Odd' },
];
export const STOP_BITS = [1, 2];
export const FLOW_CONTROLS: { value: FlowControl; label: string }[] = [
  { value: 'none', label: 'None' }, { value: 'rtscts', label: 'RTS/CTS (hardware)' }, { value: 'xonxoff', label: 'XON/XOFF (software)' },
];
export const PROTOCOL_OPTIONS: { value: ParserType; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto-detect', hint: 'Work it out from the first message' },
  { value: 'astm', label: 'ASTM (E1381 + E1394)', hint: 'Most haematology / chemistry analyzers' },
  { value: 'hl7', label: 'HL7 v2 (MLLP)', hint: 'Newer analyzers and middleware' },
  { value: 'text', label: 'Text template', hint: 'Plain printouts — one result per line' },
];
export const HL7_SAMPLE_ID_FIELDS: { value: Hl7SampleIdField; label: string }[] = [
  { value: 'OBR-3', label: 'OBR-3 · Filler order number' },
  { value: 'OBR-2', label: 'OBR-2 · Placer order number' },
  { value: 'SPM-2', label: 'SPM-2 · Specimen ID' },
  { value: 'PID-3', label: 'PID-3 · Patient ID' },
];

/** The link layer that goes with each parser choice. */
export function linkForProtocol(p: ParserType): LinkType {
  switch (p) {
    case 'astm': return 'astm-e1381';
    case 'hl7': return 'mllp';
    case 'text': return 'raw';
    default: return 'auto';
  }
}

// ── Form → contract config JSON ──────────────────────────────────────────
function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function buildTransport(f: InstrumentForm): TransportConfig {
  switch (f.transport) {
    case 'serial':
      return {
        type: 'serial', path: f.serial.path.trim(), baudRate: num(f.serial.baudRate, 9600),
        dataBits: num(f.serial.dataBits, 8), parity: f.serial.parity, stopBits: num(f.serial.stopBits, 1),
        rtscts: f.serial.flow === 'rtscts', xon: f.serial.flow === 'xonxoff',
      };
    case 'tcp-server':
      return { type: 'tcp-server', port: num(f.tcpServer.port, 0), host: '0.0.0.0' };
    case 'tcp-client':
      return { type: 'tcp-client', host: f.tcpClient.host.trim(), port: num(f.tcpClient.port, 0), reconnectMs: DEFAULT_RECONNECT_MS };
    case 'folder': {
      const out: TransportConfig = { type: 'folder', path: f.folder.path.trim(), pattern: f.folder.pattern.trim() || '*', pollMs: DEFAULT_POLL_MS };
      if (f.folder.moveTo.trim()) out.moveTo = f.folder.moveTo.trim();
      return out;
    }
  }
}

export function buildLink(f: InstrumentForm, base?: Partial<LinkConfig> | null): LinkConfig {
  const type = linkForProtocol(f.protocol);
  // Keep tuned timings from the saved config / an applied detect proposal.
  const keep = base && base.type === type ? base : {};
  return {
    ...keep,
    type,
    ackTimeoutMs: num(keep.ackTimeoutMs, DEFAULT_ACK_TIMEOUT_MS),
    frameTimeoutMs: num(keep.frameTimeoutMs, DEFAULT_FRAME_TIMEOUT_MS),
    idleMs: num(keep.idleMs, DEFAULT_IDLE_MS),
  };
}

export function buildParser(f: InstrumentForm): ParserConfig {
  return {
    type: f.protocol,
    astm: { sampleIdField: num(f.astm.sampleIdField, 3), sampleIdComponent: num(f.astm.sampleIdComponent, 1) },
    hl7: { sampleIdField: f.hl7.sampleIdField },
    text: {
      linePattern: f.text.linePattern || DEFAULT_TEXT_LINE_PATTERN,
      sampleIdPattern: f.text.sampleIdPattern || DEFAULT_TEXT_SAMPLE_ID_PATTERN,
      qcPattern: f.text.qcPattern || DEFAULT_TEXT_QC_PATTERN,
      fixedColumns: null,
    },
  };
}

/** The `config` object the contract stores (transport + link + parser).
 *  `base` = the saved config: link timings / unknown keys survive an edit. */
/** A saved config (or a detect proposal's link) the build keeps extras from. */
export type ConfigBase = Partial<Omit<InstrumentConfig, 'link'>> & { link?: Partial<LinkConfig> | null };

export function buildInstrumentConfig(f: InstrumentForm, base?: ConfigBase | null): InstrumentConfig {
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base ?? {})) if (!['transport', 'link', 'parser'].includes(k)) extra[k] = v;
  // Two-way: no block on an old instrument whose section is untouched (byte-identical save).
  const bidi = buildBidirectional(f.twoWay ?? emptyTwoWayForm(), base?.['bidirectional']);
  if (bidi) extra['bidirectional'] = bidi; else delete extra['bidirectional'];
  return { ...extra, transport: buildTransport(f), link: buildLink(f, base?.link ?? null), parser: buildParser(f) };
}

export function buildUpsert(f: InstrumentForm, base?: ConfigBase | null, profileKey?: string | null): InstrumentUpsert {
  const opt = (s: string) => (s.trim() ? s.trim() : null);
  return {
    name: f.name.trim(), make: opt(f.make), model: opt(f.model), serialNumber: opt(f.serialNumber),
    profileKey: profileKey ?? null, config: buildInstrumentConfig(f, base), isActive: f.isActive,
  };
}

// ── Config JSON → form (edit) ────────────────────────────────────────────
export function formFromInstrument(dto: Pick<InstrumentDto, 'name' | 'make' | 'model' | 'serialNumber' | 'isActive' | 'config' | 'transport'>): InstrumentForm {
  const f = emptyInstrumentForm();
  f.name = dto.name ?? '';
  f.make = dto.make ?? '';
  f.model = dto.model ?? '';
  f.serialNumber = dto.serialNumber ?? '';
  f.isActive = dto.isActive !== false;
  const t = (dto.config?.transport ?? { type: dto.transport }) as Partial<TransportConfig> & { type?: TransportType };
  f.transport = (t.type ?? dto.transport ?? 'serial') as TransportType;
  if (t.type === 'serial') {
    const s = t as Partial<Extract<TransportConfig, { type: 'serial' }>>;
    f.serial = {
      path: s.path ?? '', baudRate: num(s.baudRate, 9600), dataBits: num(s.dataBits, 8),
      parity: (s.parity ?? 'none'), stopBits: num(s.stopBits, 1),
      flow: s.rtscts ? 'rtscts' : s.xon ? 'xonxoff' : 'none',
    };
  } else if (t.type === 'tcp-server') {
    f.tcpServer = { port: num((t as { port?: number }).port, 5001) };
  } else if (t.type === 'tcp-client') {
    const c = t as { host?: string; port?: number };
    f.tcpClient = { host: c.host ?? '', port: num(c.port, 5100) };
  } else if (t.type === 'folder') {
    const d = t as { path?: string; pattern?: string; moveTo?: string | null };
    f.folder = { path: d.path ?? '', pattern: d.pattern ?? '*.txt', moveTo: d.moveTo ?? '' };
  }
  applyParser(f, dto.config?.parser);
  f.twoWay = twoWayFromConfig(dto.config?.['bidirectional']);
  return f;
}

function applyParser(f: InstrumentForm, p: Partial<ParserConfig> | null | undefined): void {
  if (!p) return;
  if (p.type && ['auto', 'astm', 'hl7', 'text'].includes(p.type)) f.protocol = p.type;
  if (p.astm) f.astm = { sampleIdField: num(p.astm.sampleIdField, 3), sampleIdComponent: num(p.astm.sampleIdComponent, 1) };
  if (p.hl7?.sampleIdField) f.hl7 = { sampleIdField: p.hl7.sampleIdField as Hl7SampleIdField };
  if (p.text) {
    f.text = {
      linePattern: p.text.linePattern || DEFAULT_TEXT_LINE_PATTERN,
      sampleIdPattern: p.text.sampleIdPattern || DEFAULT_TEXT_SAMPLE_ID_PATTERN,
      qcPattern: p.text.qcPattern || DEFAULT_TEXT_QC_PATTERN,
    };
  }
}

/** "Use this" on a detect result: the proposed parser lands in the protocol
 *  step (a copy — the input form is untouched). An `unknown` detection
 *  leaves the form as it was. Returns the proposed link too, so the caller
 *  can keep its timings as the config base. */
export function applyDetectProposal(f: InstrumentForm, d: DetectResult | null | undefined): { form: InstrumentForm; link: Partial<LinkConfig> | null } {
  const next: InstrumentForm = structuredCloneForm(f);
  if (!d || d.protocol === 'unknown') return { form: next, link: null };
  const parser: Partial<ParserConfig> = { ...(d.proposed?.parser ?? {}) };
  if (!parser.type) parser.type = d.protocol;
  applyParser(next, parser);
  return { form: next, link: d.proposed?.link ? { ...d.proposed.link, type: d.proposed.link.type ?? d.link } : { type: d.link } };
}

function structuredCloneForm(f: InstrumentForm): InstrumentForm {
  return JSON.parse(JSON.stringify(f)) as InstrumentForm;
}

// ── Validation (per wizard step) ─────────────────────────────────────────
export type WizardStep = 'basics' | 'connection' | 'protocol' | 'listen' | 'mapping' | 'twoway' | 'device';

export interface FormIssue { step: WizardStep; field: string; message: string }

function validPort(p: number | null | undefined): boolean {
  return typeof p === 'number' && Number.isInteger(p) && p >= 1 && p <= 65535;
}
function validRegex(src: string): boolean {
  try { new RegExp(src); return true; } catch { return false; }
}

export function validateInstrumentForm(f: InstrumentForm): FormIssue[] {
  const out: FormIssue[] = [];
  if (!f.name.trim()) out.push({ step: 'basics', field: 'name', message: 'Give the instrument a name' });
  switch (f.transport) {
    case 'serial':
      if (!f.serial.path.trim()) out.push({ step: 'connection', field: 'serial.path', message: 'Pick the serial port' });
      break;
    case 'tcp-server':
      if (!validPort(f.tcpServer.port)) out.push({ step: 'connection', field: 'tcpServer.port', message: 'Port must be 1–65535' });
      break;
    case 'tcp-client':
      if (!f.tcpClient.host.trim()) out.push({ step: 'connection', field: 'tcpClient.host', message: 'Enter the analyzer’s IP address or host name' });
      if (!validPort(f.tcpClient.port)) out.push({ step: 'connection', field: 'tcpClient.port', message: 'Port must be 1–65535' });
      break;
    case 'folder':
      if (!f.folder.path.trim()) out.push({ step: 'connection', field: 'folder.path', message: 'Enter the folder the analyzer writes to' });
      break;
  }
  if (f.protocol === 'text') {
    for (const [k, label] of [['linePattern', 'Line pattern'], ['sampleIdPattern', 'Sample ID pattern'], ['qcPattern', 'QC pattern']] as const) {
      if (!validRegex(f.text[k])) out.push({ step: 'protocol', field: `text.${k}`, message: `${label} is not a valid regular expression` });
    }
  }
  if (f.protocol === 'astm' && !(f.astm.sampleIdField >= 1)) {
    out.push({ step: 'protocol', field: 'astm.sampleIdField', message: 'Field must be 1 or more' });
  }
  for (const i of validateTwoWay(f.twoWay ?? emptyTwoWayForm())) {
    out.push({ step: 'twoway', field: i.index === undefined ? `twoWay.${i.field}` : `twoWay.code.${i.index}`, message: i.message });
  }
  return out;
}

// ── Code mapping rows ────────────────────────────────────────────────────
export interface CodeMapRow {
  analyzerCode: string;
  testCatalogKey: string;
  parameterName: string;
  factor: number;
  offset: number;
  decimals: number | null;
  unit: string;
  /** Display only (server-resolved or picked). */
  testName?: string | null;
  /** True when this row's test was auto-filled from a single unambiguous
   *  LOINC match (server GET {id}/code-map-suggestions) — drives the
   *  "Matched by LOINC" chip. Cleared once the human changes the test. */
  loincMatched?: boolean;
  /** Set when the row's code matched MORE THAN ONE active test ("no
   *  auto-pick") — the editor renders a picker limited to just these
   *  candidates instead of the full Test Master list. Cleared once a
   *  candidate is chosen. */
  loincCandidates?: LoincCandidateDto[];
}

export function emptyCodeMapRow(code = ''): CodeMapRow {
  return { analyzerCode: code, testCatalogKey: '', parameterName: '', factor: 1, offset: 0, decimals: null, unit: '' };
}

export function rowFromDto(d: CodeMapDto): CodeMapRow {
  return {
    analyzerCode: d.analyzerCode ?? '', testCatalogKey: d.testCatalogKey ?? '', parameterName: d.parameterName ?? '',
    factor: num(d.factor, 1), offset: num(d.offset, 0), decimals: d.decimals ?? null, unit: d.unit ?? '', testName: d.testName ?? null,
  };
}

const codeKey = (c: string) => c.trim().toUpperCase();

/** Standard CBC analyzer codes → the CBC member tests' CatalogKeys.
 *  Counts come from analyzers in 10^3/µL → the catalogue's cells/µL (×1000). */
export const CBC_DEFAULT_MAPS: ReadonlyArray<Omit<CodeMapRow, 'parameterName' | 'offset' | 'testName'>> = [
  { analyzerCode: 'WBC', testCatalogKey: 'HEM019', factor: 1000, decimals: 0, unit: 'cells/µL' },
  { analyzerCode: 'RBC', testCatalogKey: 'HEM012', factor: 1, decimals: 2, unit: 'million/µL' },
  { analyzerCode: 'HGB', testCatalogKey: 'HEM011', factor: 1, decimals: 1, unit: 'g/dL' },
  { analyzerCode: 'HCT', testCatalogKey: 'HEM013', factor: 1, decimals: 1, unit: '%' },
  { analyzerCode: 'MCV', testCatalogKey: 'HEM014', factor: 1, decimals: 1, unit: 'fL' },
  { analyzerCode: 'MCH', testCatalogKey: 'HEM015', factor: 1, decimals: 1, unit: 'pg' },
  { analyzerCode: 'MCHC', testCatalogKey: 'HEM016', factor: 1, decimals: 1, unit: 'g/dL' },
  { analyzerCode: 'RDW-CV', testCatalogKey: 'HEM017', factor: 1, decimals: 1, unit: '%' },
  { analyzerCode: 'PLT', testCatalogKey: 'HEM030', factor: 1000, decimals: 0, unit: 'cells/µL' },
  { analyzerCode: 'MPV', testCatalogKey: 'HEM031', factor: 1, decimals: 1, unit: 'fL' },
  { analyzerCode: 'NEUT%', testCatalogKey: 'HEM020', factor: 1, decimals: 1, unit: '%' },
  { analyzerCode: 'LYMPH%', testCatalogKey: 'HEM021', factor: 1, decimals: 1, unit: '%' },
  { analyzerCode: 'MONO%', testCatalogKey: 'HEM022', factor: 1, decimals: 1, unit: '%' },
  { analyzerCode: 'EOS%', testCatalogKey: 'HEM023', factor: 1, decimals: 1, unit: '%' },
  { analyzerCode: 'BASO%', testCatalogKey: 'HEM024', factor: 1, decimals: 1, unit: '%' },
  { analyzerCode: 'NEUT#', testCatalogKey: 'HEM025', factor: 1, decimals: 2, unit: '×10⁹/L' },
  { analyzerCode: 'LYMPH#', testCatalogKey: 'HEM026', factor: 1, decimals: 2, unit: '×10⁹/L' },
  { analyzerCode: 'MONO#', testCatalogKey: 'HEM027', factor: 1, decimals: 2, unit: '×10⁹/L' },
  { analyzerCode: 'EOS#', testCatalogKey: 'HEM028', factor: 1, decimals: 2, unit: '×10⁹/L' },
  { analyzerCode: 'BASO#', testCatalogKey: 'HEM029', factor: 1, decimals: 2, unit: '×10⁹/L' },
];

/** "Load CBC defaults": adds the standard rows whose analyzer code is not
 *  mapped yet. Existing rows (and their edits) always win. A blank row with
 *  a CBC code is filled in place. */
export function withCbcDefaults(rows: readonly CodeMapRow[]): CodeMapRow[] {
  return withPreset(rows, CBC_DEFAULT_MAPS);
}

function withPreset(rows: readonly CodeMapRow[], preset: ReadonlyArray<Omit<CodeMapRow, 'parameterName' | 'offset' | 'testName'>>): CodeMapRow[] {
  const out = rows.map((r) => ({ ...r }));
  for (const d of preset) {
    const hit = out.find((r) => codeKey(r.analyzerCode) === codeKey(d.analyzerCode));
    if (hit) {
      if (!hit.testCatalogKey) Object.assign(hit, { ...d, analyzerCode: hit.analyzerCode, parameterName: hit.parameterName ?? '', offset: hit.offset ?? 0 });
      continue;
    }
    out.push({ ...d, parameterName: '', offset: 0 });
  }
  return out;
}

/** Medonic M51 (Boule) / Mindray-style HL7: OBX-3 component 1 is the LOINC
 *  code (99MRC for PCT), so the rows map those codes. Units as the M51 sends
 *  them: counts in 10^3/µL (→ ×1000 for cells/µL), RBC 10^6/µL. First
 *  installed at Arun lab (2026-10-01). */
export const M51_HL7_MAPS: ReadonlyArray<Omit<CodeMapRow, 'parameterName' | 'offset' | 'testName'>> = [
  { analyzerCode: '6690-2', testCatalogKey: 'HEM019', factor: 1000, decimals: 0, unit: 'cells/µL' },   // WBC
  { analyzerCode: '789-8', testCatalogKey: 'HEM012', factor: 1, decimals: 2, unit: 'million/µL' },    // RBC
  { analyzerCode: '718-7', testCatalogKey: 'HEM011', factor: 1, decimals: 1, unit: 'g/dL' },          // HGB
  { analyzerCode: '4544-3', testCatalogKey: 'HEM013', factor: 1, decimals: 1, unit: '%' },            // HCT
  { analyzerCode: '787-2', testCatalogKey: 'HEM014', factor: 1, decimals: 1, unit: 'fL' },            // MCV
  { analyzerCode: '785-6', testCatalogKey: 'HEM015', factor: 1, decimals: 1, unit: 'pg' },            // MCH
  { analyzerCode: '786-4', testCatalogKey: 'HEM016', factor: 1, decimals: 1, unit: 'g/dL' },          // MCHC
  { analyzerCode: '788-0', testCatalogKey: 'HEM017', factor: 1, decimals: 1, unit: '%' },             // RDW-CV
  { analyzerCode: '777-3', testCatalogKey: 'HEM030', factor: 1000, decimals: 0, unit: 'cells/µL' },   // PLT
  { analyzerCode: '32623-1', testCatalogKey: 'HEM031', factor: 1, decimals: 1, unit: 'fL' },          // MPV
  { analyzerCode: '32207-3', testCatalogKey: 'HEM032', factor: 1, decimals: 1, unit: 'fL' },          // PDW
  { analyzerCode: '11003', testCatalogKey: 'HEM033', factor: 1, decimals: 3, unit: '%' },             // PCT
  { analyzerCode: '770-8', testCatalogKey: 'HEM020', factor: 1, decimals: 1, unit: '%' },             // NEU%
  { analyzerCode: '736-9', testCatalogKey: 'HEM021', factor: 1, decimals: 1, unit: '%' },             // LYM%
  { analyzerCode: '5905-5', testCatalogKey: 'HEM022', factor: 1, decimals: 1, unit: '%' },            // MON%
  { analyzerCode: '713-8', testCatalogKey: 'HEM023', factor: 1, decimals: 1, unit: '%' },             // EOS%
  { analyzerCode: '706-2', testCatalogKey: 'HEM024', factor: 1, decimals: 1, unit: '%' },             // BAS%
  { analyzerCode: '751-8', testCatalogKey: 'HEM025', factor: 1, decimals: 2, unit: '×10⁹/L' },        // NEU#
  { analyzerCode: '731-0', testCatalogKey: 'HEM026', factor: 1, decimals: 2, unit: '×10⁹/L' },        // LYM#
  { analyzerCode: '742-7', testCatalogKey: 'HEM027', factor: 1, decimals: 2, unit: '×10⁹/L' },        // MON#
  { analyzerCode: '711-2', testCatalogKey: 'HEM028', factor: 1, decimals: 2, unit: '×10⁹/L' },        // EOS#
  { analyzerCode: '704-7', testCatalogKey: 'HEM029', factor: 1, decimals: 2, unit: '×10⁹/L' },        // BAS#
];

/** "Load Medonic M51": same merge rule as {@link withCbcDefaults}. */
export function withM51Defaults(rows: readonly CodeMapRow[]): CodeMapRow[] {
  return withPreset(rows, M51_HL7_MAPS);
}

/** "Add unmapped codes": one blank row per code not already on the grid
 *  (case-insensitive, blanks + duplicates dropped, first-seen order). */
export function mergeUnmappedCodes(rows: readonly CodeMapRow[], codes: Iterable<string | null | undefined>): { rows: CodeMapRow[]; added: number } {
  const out = rows.map((r) => ({ ...r }));
  const seen = new Set(out.map((r) => codeKey(r.analyzerCode)).filter(Boolean));
  let added = 0;
  for (const c of codes) {
    const k = codeKey(c ?? '');
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(emptyCodeMapRow((c ?? '').trim()));
    added++;
  }
  return { rows: out, added };
}

export interface LoincSkip { code: string; reason: string }

export interface LoincApplyResult {
  rows: CodeMapRow[];
  /** New rows actually added (matched + ambiguous + plain "is a test but no
   *  candidate" blanks) — mirrors mergeUnmappedCodes's `added`. */
  added: number;
  /** Of `added`, how many got a full single-candidate auto-fill. */
  matched: number;
  /** Ignore-list codes (age/sex/height/weight…) — never added as a row. */
  skipped: LoincSkip[];
}

/**
 * Merge per-code LOINC suggestions (GET {id}/code-map-suggestions) into the
 * code-map grid — the "Add unmapped codes" button's server-assisted fill,
 * and the same logic a typed-code debounced lookup applies to one row.
 *
 * Per suggestion: a non-analyte skip is never added as a row (reported in
 * `skipped` for the quiet note instead); a single candidate fills the test +
 * the suggested factor/decimals/unit (falling back to the candidate's own
 * unit when there's no special-case conversion) and sets `loincMatched`; two
 * or more candidates add the row with `loincCandidates` set (no test picked
 * — "no auto-pick") for a picker limited to just those tests; a LOINC code
 * that is a real analyte but matches no test adds a plain blank row (same as
 * `mergeUnmappedCodes`). An EXISTING blank row for the same code (case
 * insensitive) is filled in place rather than duplicated; an existing row
 * that already has a test is left untouched.
 */
export function applyLoincSuggestions(rows: readonly CodeMapRow[], suggestions: readonly LoincSuggestionDto[]): LoincApplyResult {
  const out = rows.map((r) => ({ ...r }));
  let added = 0;
  let matched = 0;
  const skipped: LoincSkip[] = [];

  const indexOf = (code: string) => out.findIndex((r) => codeKey(r.analyzerCode) === codeKey(code));
  const fill = (idx: number, code: string, patch: Partial<CodeMapRow>) => {
    if (idx >= 0) {
      if (!out[idx].testCatalogKey) Object.assign(out[idx], patch);
    } else {
      out.push({ ...emptyCodeMapRow(code), ...patch });
      added++;
    }
  };

  for (const s of suggestions) {
    if (!s.code?.trim()) continue;
    if (!s.isTest) { skipped.push({ code: s.code, reason: s.skipReason || 'not a test' }); continue; }
    const idx = indexOf(s.code);
    if (s.candidates.length === 1) {
      const c = s.candidates[0];
      fill(idx, s.code, {
        analyzerCode: s.code, testCatalogKey: c.catalogKey, testName: c.testName,
        factor: s.suggestedFactor ?? 1, decimals: s.suggestedDecimals ?? null,
        unit: s.suggestedUnit ?? c.unit ?? '', loincMatched: true, loincCandidates: undefined,
      });
      matched++;
    } else if (s.candidates.length > 1) {
      fill(idx, s.code, { analyzerCode: s.code, loincCandidates: [...s.candidates], loincMatched: false });
    } else {
      fill(idx, s.code, { analyzerCode: s.code });
    }
  }
  return { rows: out, added, matched, skipped };
}

/** Codes the listen session saw that are not on the grid yet. */
export function codesFromMessages(msgs: readonly InstrumentMessage[]): string[] {
  const out: string[] = [];
  for (const m of msgs) for (const r of m.results ?? []) if (r.code) out.push(r.code);
  return out;
}

export interface CodeMapIssue { index: number; message: string }

/** Rows the server would reject. Fully blank rows are ignored (dropped on save). */
export function validateCodeMaps(rows: readonly CodeMapRow[]): CodeMapIssue[] {
  const out: CodeMapIssue[] = [];
  const seen = new Map<string, number>();
  rows.forEach((r, i) => {
    const code = codeKey(r.analyzerCode);
    if (!code && !r.testCatalogKey) return;
    if (!code) out.push({ index: i, message: 'Analyzer code is missing' });
    else if (seen.has(code)) out.push({ index: i, message: `${r.analyzerCode.trim()} is mapped twice` });
    else seen.set(code, i);
    if (!r.testCatalogKey) out.push({ index: i, message: `Pick the test for ${r.analyzerCode.trim() || 'this row'}` });
    if (!Number.isFinite(Number(r.factor)) || Number(r.factor) === 0) out.push({ index: i, message: 'Factor must be a non-zero number' });
    if (r.decimals != null && !(Number.isInteger(Number(r.decimals)) && Number(r.decimals) >= 0 && Number(r.decimals) <= 6)) {
      out.push({ index: i, message: 'Decimals must be 0–6' });
    }
  });
  return out;
}

/** PUT body (replace-all): blank rows dropped, text trimmed. */
export function toCodeMapUpserts(rows: readonly CodeMapRow[]): CodeMapUpsert[] {
  return rows
    .filter((r) => r.analyzerCode.trim() && r.testCatalogKey)
    .map((r) => ({
      analyzerCode: r.analyzerCode.trim(),
      testCatalogKey: r.testCatalogKey,
      parameterName: r.parameterName?.trim() ? r.parameterName.trim() : null,
      factor: Number.isFinite(Number(r.factor)) ? Number(r.factor) : 1,
      offset: Number.isFinite(Number(r.offset)) ? Number(r.offset) : 0,
      decimals: r.decimals == null || (r.decimals as unknown) === '' ? null : Number(r.decimals),
      unit: r.unit?.trim() ? r.unit.trim() : null,
    }));
}

// ── Raw capture rendering ────────────────────────────────────────────────
const CONTROL_NAMES: Record<number, string> = {
  0x00: 'NUL', 0x01: 'SOH', 0x02: 'STX', 0x03: 'ETX', 0x04: 'EOT', 0x05: 'ENQ', 0x06: 'ACK', 0x07: 'BEL',
  0x08: 'BS', 0x09: 'TAB', 0x0a: 'LF', 0x0b: 'VT', 0x0c: 'FF', 0x0d: 'CR', 0x0e: 'SO', 0x0f: 'SI',
  0x10: 'DLE', 0x11: 'DC1', 0x12: 'DC2', 0x13: 'DC3', 0x14: 'DC4', 0x15: 'NAK', 0x16: 'SYN', 0x17: 'ETB',
  0x18: 'CAN', 0x19: 'EM', 0x1a: 'SUB', 0x1b: 'ESC', 0x1c: 'FS', 0x1d: 'GS', 0x1e: 'RS', 0x1f: 'US', 0x7f: 'DEL',
};

export interface RawSegment { text: string; ctrl: boolean }

/** Split raw text into plain runs and visible control tokens (<STX>, <CR>…).
 *  A line break follows <LF> and a lone <CR> so frames read one per line. */
export function renderControlChars(raw: string | null | undefined): RawSegment[] {
  const out: RawSegment[] = [];
  const s = raw ?? '';
  let buf = '';
  const flush = () => { if (buf) { out.push({ text: buf, ctrl: false }); buf = ''; } };
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const name = CONTROL_NAMES[code];
    if (!name) { buf += s[i]; continue; }
    flush();
    out.push({ text: `<${name}>`, ctrl: true });
    const nextIsLf = s.charCodeAt(i + 1) === 0x0a;
    if (code === 0x0a || (code === 0x0d && !nextIsLf)) out.push({ text: '\n', ctrl: false });
  }
  flush();
  return out;
}

/** Plain-text form of renderControlChars (tests / copy). */
export function controlCharsText(raw: string | null | undefined): string {
  return renderControlChars(raw).map((s) => s.text).join('');
}

// ── Parsed preview ───────────────────────────────────────────────────────
export interface PreviewRow { sampleId: string; code: string; value: string; unit: string; flags: string; qc: boolean }

export function previewRows(msgs: readonly InstrumentMessage[]): PreviewRow[] {
  const out: PreviewRow[] = [];
  for (const m of msgs) {
    for (const r of m.results ?? []) {
      out.push({
        sampleId: m.sampleId ?? '', code: r.code ?? '', value: r.value ?? '', unit: r.unit ?? '',
        flags: (r.flags ?? []).filter(Boolean).join(' '), qc: !!m.qc,
      });
    }
  }
  return out;
}

/** "Sample 26123 · WBC 7.8 10^3/µL · H" */
export function previewLine(r: Pick<PreviewRow, 'sampleId' | 'code' | 'value' | 'unit' | 'flags' | 'qc'>): string {
  const head = r.qc ? 'QC' : `Sample ${r.sampleId || '—'}`;
  const val = [r.code, r.value, r.unit].filter(Boolean).join(' ');
  return [head, val, r.flags].filter(Boolean).join(' · ');
}

// ── List summaries ───────────────────────────────────────────────────────
export function connectionSummary(cfg: Partial<InstrumentConfig> | null | undefined, fallback?: TransportType): string {
  const t = (cfg?.transport ?? (fallback ? { type: fallback } : null)) as (Partial<TransportConfig> & { type?: TransportType }) | null;
  if (!t?.type) return '—';
  switch (t.type) {
    case 'serial': {
      const s = t as Partial<Extract<TransportConfig, { type: 'serial' }>>;
      const parity = (s.parity ?? 'none').charAt(0).toUpperCase();
      return `Serial ${s.path || '(port not set)'} · ${s.baudRate ?? 9600} ${s.dataBits ?? 8}${parity}${s.stopBits ?? 1}`;
    }
    case 'tcp-server': return `TCP server · port ${(t as { port?: number }).port ?? '—'}`;
    case 'tcp-client': {
      const c = t as { host?: string; port?: number };
      return `TCP client · ${c.host || '—'}:${c.port ?? '—'}`;
    }
    case 'folder': {
      const d = t as { path?: string; pattern?: string };
      return `Folder · ${d.path || '—'} (${d.pattern || '*'})`;
    }
    default: return String(t.type);
  }
}

export function protocolLabel(cfg: Partial<InstrumentConfig> | null | undefined): string {
  const p = cfg?.parser?.type ?? 'auto';
  return PROTOCOL_OPTIONS.find((o) => o.value === p)?.label ?? String(p);
}

/** The ONE status word per instrument: dot + tone (list rows). */
export function statusWord(s: InstrumentStatus | string | null | undefined): { label: string; tone: 'green' | 'amber' | 'red' | 'neutral' } {
  switch (s) {
    case 'online': return { label: 'Online', tone: 'green' };
    case 'offline': return { label: 'Offline', tone: 'amber' };
    case 'error': return { label: 'Error', tone: 'red' };
    default: return { label: 'Never connected', tone: 'neutral' };
  }
}

/** The live connector state word (Electron onStatus). */
export function connectorStateWord(s: string | null | undefined): { label: string; tone: 'green' | 'amber' | 'red' | 'neutral' } {
  switch (s) {
    case 'connected': return { label: 'Connected', tone: 'green' };
    case 'listening': return { label: 'Listening', tone: 'green' };
    case 'starting': return { label: 'Starting', tone: 'neutral' };
    case 'disconnected': return { label: 'Disconnected', tone: 'amber' };
    case 'stopped': return { label: 'Stopped', tone: 'neutral' };
    case 'error': return { label: 'Error', tone: 'red' };
    default: return { label: 'Unknown', tone: 'neutral' };
  }
}

/** ISO instant → "30 Sep, 10:42 AM" (or just the time) in the lab's IST day. */
export function fmtIst(iso: string | null | undefined, pattern = 'd MMM, h:mm a'): string {
  if (!iso) return '';
  try { return formatDate(iso, pattern, 'en-US', LAB_TIME_ZONE); } catch { return ''; }
}
