/**
 * Lab-analyzer (instrument connector) DTOs — the TS side of the cross-repo
 * contract (instrument-contract v1). The backend (prefrontal-mw) and the
 * Electron connector (electron/instruments) code against the SAME shapes;
 * keep field names in step with the contract, never rename them here.
 *
 * All HTTP responses ride the standard envelope (ApiService unwraps it).
 */

// ── Instrument config JSON (`config`) ────────────────────────────────────
export type TransportType = 'serial' | 'tcp-server' | 'tcp-client' | 'folder';

export interface SerialTransport {
  type: 'serial';
  path: string;
  baudRate: number;
  dataBits: number;
  parity: 'none' | 'even' | 'odd';
  stopBits: number;
  rtscts: boolean;
  xon: boolean;
}
export interface TcpServerTransport { type: 'tcp-server'; port: number; host: string }
export interface TcpClientTransport { type: 'tcp-client'; host: string; port: number; reconnectMs: number }
export interface FolderTransport { type: 'folder'; path: string; pattern: string; pollMs: number; moveTo?: string | null }
export type TransportConfig = SerialTransport | TcpServerTransport | TcpClientTransport | FolderTransport;

export type LinkType = 'auto' | 'astm-e1381' | 'mllp' | 'raw' | 'stx-etx' | 'sinocare-sn';
export interface LinkConfig {
  type: LinkType;
  ackTimeoutMs?: number;
  frameTimeoutMs?: number;
  terminator?: string;
  idleMs?: number;
  [k: string]: unknown;
}

export type ParserType = 'auto' | 'astm' | 'hl7' | 'text' | 'lifedx-hbpro' | 'sinocare-fhir';
export type SinocareReplyMode = 'none' | 'echo';
export type SinocareSampleIdField = 'medicalRecordNo' | 'position';
export type Hl7SampleIdField = 'OBR-3' | 'OBR-2' | 'SPM-2' | 'PID-3' | 'PID-5';
export interface ParserConfig {
  type: ParserType;
  // `sampleIdPath` (optional, every block): a custom sample-number location
  // picked from a real message — overrides the standard field, which stays
  // the fallback (core/parsers/sample-id-path.js, TS mirror sample-id-path.ts).
  astm?: { sampleIdField: number; sampleIdComponent: number; sampleIdPath?: string };
  hl7?: { sampleIdField: Hl7SampleIdField | string; sampleIdPath?: string };
  text?: {
    linePattern: string;
    sampleIdPattern: string;
    qcPattern: string;
    fixedColumns?: unknown;
    sampleIdPath?: string;
  };
  /** LifeDx HBPro: fixed-width result positions (0-based, end exclusive) — core/parsers/lifedx-hbpro.js. */
  hbpro?: { fields: { code: string; start: number; end: number; unit: string | null }[]; sampleIdPath?: string };
  /** Sinocare iCARE: which Patient field is the sample ID — core/parsers/sinocare-fhir.js. */
  sinocare?: { sampleIdField: SinocareSampleIdField; sampleIdPath?: string };
  [k: string]: unknown;
}

export interface InstrumentConfig {
  transport: TransportConfig;
  link: LinkConfig;
  parser: ParserConfig;
  [k: string]: unknown;
}

// ── Admin DTOs ───────────────────────────────────────────────────────────
export type InstrumentStatus = 'never' | 'online' | 'offline' | 'error';

/** Heartbeat body the connector last sent (server stores it verbatim). */
export interface InstrumentHeartbeat {
  status?: 'connected' | 'listening' | 'disconnected' | 'error' | string;
  queueLength?: number | null;
  lastMessageAt?: string | null;
  lastError?: string | null;
  connectorVersion?: string | null;
  host?: string | null;
}

export interface InstrumentDto {
  id: string;
  branchId?: string | null;
  name: string;
  make?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  profileKey?: string | null;
  transport: TransportType;
  config: InstrumentConfig;
  isActive: boolean;
  status: InstrumentStatus;
  lastSeenAt?: string | null;
  lastMessageAt?: string | null;
  lastStatus?: InstrumentHeartbeat | null;
  hasDeviceKey: boolean;
  deviceKeyPrefix?: string | null;
  deviceKeyRotatedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  unmatchedCount?: number;
  /** Prefrontal Bridge this analyzer is connected through (bridge-api v1,
   *  additive; absent = this computer / a paired desktop). */
  bridgeId?: string | null;
  bridgeName?: string | null;
}

export interface InstrumentUpsert {
  name: string;
  make?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  profileKey?: string | null;
  config: InstrumentConfig;
  isActive?: boolean;
}

export interface DeviceKeyDto { deviceKey: string; prefix: string; rotatedAt: string }

export interface CodeMapDto {
  id: string;
  analyzerCode: string;
  testCatalogKey: string;
  testId?: string | null;
  testName?: string | null;
  parameterName?: string | null;
  factor: number;
  offset: number;
  decimals?: number | null;
  unit?: string | null;
  isActive?: boolean;
}

export interface CodeMapUpsert {
  analyzerCode: string;
  testCatalogKey: string;
  parameterName?: string | null;
  factor?: number;
  offset?: number;
  decimals?: number | null;
  unit?: string | null;
}

export type MessageState = 'unmatched' | 'qc' | 'matched' | 'superseded' | 'duplicate';

export interface ResultPreview { code: string; value: string; unit?: string | null; flags?: string[] | null }

export interface MessageSummaryDto {
  id: string;
  instrumentId: string;
  instrumentName: string;
  sampleId: string | null;
  state: MessageState | string;
  isQc: boolean;
  protocol: string;
  receivedAt: string;
  runAt?: string | null;
  processedAt?: string | null;
  orderSampleId?: string | null;
  orderId?: string | null;
  resultCount: number;
  mappedCount: number;
  /** The API omits null fields — treat a missing list as empty. */
  unmappedCodes?: string[];
  /** Codes the Instruments:LoincAutoMatch ingest fallback matched with no
   *  code-map row (derived server-side from `mapped[].autoMatched`) — never
   *  set for a code a real code map already resolved. */
  autoMatchedCodes?: string[];
  preview?: ResultPreview[];
}

export interface MessagePage { items: MessageSummaryDto[]; total: number; page: number; pageSize: number }

export interface MappedValue {
  analyzerCode: string;
  orderTestId: string | null;
  testId: string | null;
  catalogKey: string;
  parameterName: string | null;
  /** Converted + rounded (string — non-numeric values pass through). */
  value: string;
  rawValue?: string | null;
  /** Target unit. */
  unit?: string | null;
  rawUnit?: string | null;
  flags?: string[];
  /** Set by the Instruments:LoincAutoMatch ingest fallback (factor 1, no
   *  code-map row) — never set for a code-map-resolved value. */
  autoMatched?: boolean;
}

export interface MessageDetailDto extends MessageSummaryDto {
  raw: string;
  normalized: InstrumentMessage;
  mapped: MappedValue[];
}

/** GET/PUT /api/instruments/{id}/image-maps — an image code the analyzer
 *  sends and the PROFILES (catalogue keys) it is mapped to. `lastUrl` = the
 *  newest received graph (authenticated /uploads path), null before the
 *  first run. */
export interface ImageCodeDto { code: string; label: string | null; seen: number; lastUrl: string | null; lastAt: string | null; profileKeys: string[] }
export interface ImageMapUpsert { code: string; label: string | null; profileKeys: string[] }

export interface RunDto {
  messageId: string;
  instrumentId: string;
  instrumentName: string;
  receivedAt: string;
  runAt?: string | null;
  state: MessageState | string;
  /** Only values that landed on an order line (orderTestId set). */
  values?: MappedValue[];
}

/** GET /api/instruments/results/by-sample/{orderSampleId}. Runs are newest
 *  first, QC excluded, superseded included. */
export interface SamplePrefillDto { orderSampleId: string; barcode: string; runs: RunDto[] }

// ── LOINC auto-match (code-map-suggestions) ──────────────────────────────

/** One of the tenant's active individual tests whose EFFECTIVE StandardCode
 *  (its own override, else the master template's by CatalogKey) matched a
 *  requested code. */
export interface LoincCandidateDto {
  testId: string;
  testName: string;
  catalogKey: string;
  unit: string | null;
}

/** GET /api/instruments/{id}/code-map-suggestions?codes=a,b,c&units=…
 *  Per requested code: a non-analyte skip (`isTest` false, `skipReason` set,
 *  no candidates), no match (`isTest` true, empty candidates), a single
 *  match (one candidate + a suggested factor/decimals/unit — never
 *  auto-applied server-side), or ambiguous (several candidates, no suggested
 *  factor — "no auto-pick"). The API omits null fields. */
export interface LoincSuggestionDto {
  code: string;
  isTest: boolean;
  skipReason?: string | null;
  candidates: LoincCandidateDto[];
  suggestedFactor?: number | null;
  suggestedDecimals?: number | null;
  suggestedUnit?: string | null;
  confidence?: string | null;
}

// ── Connector core output ───────────────────────────────────────────────
export interface InstrumentResult { code: string; value: string; unit?: string | null; flags?: string[]; rawRecord?: string }
/** An embedded document the analyzer sent (HL7 ED segment — a histogram /
 *  scattergram BMP). Never a result; additive on the wire contract. */
export interface InstrumentImage { code: string; label: string; format: string | null; base64: string }
export interface InstrumentMessage {
  sampleId: string | null;
  instrumentSerial?: string | null;
  runAt?: string | null;
  results: InstrumentResult[];
  images?: InstrumentImage[];
  qc?: boolean;
  raw?: string;
  protocol?: string;
}

// ── Electron bridge (preload) — window.electronAPI.instruments ──────────
export type ConnectorState = 'starting' | 'connected' | 'listening' | 'disconnected' | 'error' | 'stopped';

export interface ConnectorStatus {
  instrumentId: string;
  name?: string;
  state: ConnectorState;
  transport?: string;
  lastMessageAt?: string | null;
  lastUploadAt?: string | null;
  queueLength?: number;
  lastError?: string | null;
  messagesToday?: number;
}

export interface PairedInstrument {
  instrumentId: string;
  name?: string;
  apiUrl: string;
  pairedAt: string;
  status: ConnectorStatus | null;
}

export interface RawLogEntry { at: string; dir: 'in' | 'out'; text: string; bytes?: number }
export interface SerialPortInfo { path: string; manufacturer?: string; serialNumber?: string }

export interface DetectResult {
  protocol: 'astm' | 'hl7' | 'text' | 'lifedx-hbpro' | 'sinocare-fhir' | 'unknown';
  link: 'astm-e1381' | 'mllp' | 'raw' | 'stx-etx' | 'sinocare-sn';
  confidence: number;
  reasons: string[];
  proposed: { link: Partial<LinkConfig>; parser: Partial<ParserConfig> };
}

export interface ListenEvent {
  sessionId: string;
  kind: 'raw' | 'detect' | 'message' | 'error' | 'status';
  text?: string;
  detect?: DetectResult;
  message?: InstrumentMessage;
  error?: string;
  state?: string;
}

export interface ListenResult { raw: string; detect: DetectResult; messages: InstrumentMessage[] }

export interface ElectronInstrumentsApi {
  list(): Promise<PairedInstrument[]>;
  pair(p: { instrumentId: string; deviceKey: string; apiUrl: string; name?: string }): Promise<{ ok: boolean; error?: string }>;
  unpair(instrumentId: string): Promise<{ ok: boolean }>;
  /** Live reload: the running connector re-pulls its config (after a save).
   *  Optional — an older desktop build without it still polls on heartbeat. */
  reload?(instrumentId: string): Promise<{ ok: boolean; changed?: boolean; restarted?: boolean; error?: string }>;
  status(): Promise<ConnectorStatus[]>;
  onStatus(cb: (s: ConnectorStatus) => void): () => void;
  rawLog(instrumentId: string, limit?: number): Promise<RawLogEntry[]>;
  listSerialPorts(): Promise<SerialPortInfo[]>;
  listenStart(opts: { transport: object; link?: object; parser?: object }): Promise<{ sessionId: string } | { error: string }>;
  listenStop(sessionId: string): Promise<ListenResult>;
  onListen(cb: (e: ListenEvent) => void): () => void;
  preview(raw: string, config?: { link?: object; parser?: object }): Promise<ListenResult>;
}
