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

export type LinkType = 'auto' | 'astm-e1381' | 'mllp' | 'raw';
export interface LinkConfig {
  type: LinkType;
  ackTimeoutMs?: number;
  frameTimeoutMs?: number;
  terminator?: string;
  idleMs?: number;
  [k: string]: unknown;
}

export type ParserType = 'auto' | 'astm' | 'hl7' | 'text';
export type Hl7SampleIdField = 'OBR-3' | 'OBR-2' | 'SPM-2' | 'PID-3';
export interface ParserConfig {
  type: ParserType;
  astm?: { sampleIdField: number; sampleIdComponent: number };
  hl7?: { sampleIdField: Hl7SampleIdField | string };
  text?: {
    linePattern: string;
    sampleIdPattern: string;
    qcPattern: string;
    fixedColumns?: unknown;
  };
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
}

export interface MessageDetailDto extends MessageSummaryDto {
  raw: string;
  normalized: InstrumentMessage;
  mapped: MappedValue[];
}

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
  protocol: 'astm' | 'hl7' | 'text' | 'unknown';
  link: 'astm-e1381' | 'mllp' | 'raw';
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
