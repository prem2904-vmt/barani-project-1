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
/**
 * Effective status (server InstrumentService.EffectiveStatus, next-phase
 * contract §4): online = the analyzer is really connected (a session, or
 * bytes in the last 5 min) on a fresh heartbeat; waiting = listening, nobody
 * connected; not_connected = we dial it and aren't connected; running = an
 * older connector without the true link (only "the connector is up").
 */
export type InstrumentStatus = 'never' | 'online' | 'waiting' | 'not_connected' | 'running' | 'offline' | 'error';

/** The connector's true link (electron/instruments/core/connector.js deriveLink). */
export type InstrumentLink = 'connected' | 'waiting' | 'not_connected' | 'error';

/** One open analyzer connection: "192.168.1.21:58561" since <iso>. */
export interface InstrumentSession { remote: string | null; since: string | null; local?: string | null }

/** Heartbeat body the connector last sent (server stores it verbatim). */
export interface InstrumentHeartbeat {
  status?: 'connected' | 'listening' | 'disconnected' | 'error' | string;
  queueLength?: number | null;
  lastMessageAt?: string | null;
  lastError?: string | null;
  connectorVersion?: string | null;
  host?: string | null;
  link?: InstrumentLink | string | null;
  sessions?: InstrumentSession[] | null;
  lastRxAt?: string | null;
  listenPort?: number | null;
  errorDetail?: string | null;
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
  /** True status (contract §4, additive — absent on an older server). */
  link?: InstrumentLink | string | null;
  sessions?: InstrumentSession[] | null;
  lastRxAt?: string | null;
  listenPort?: number | null;
  errorDetail?: string | null;
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
  /** Routed by a "Test with an analyzer ID" session (message metadata
   *  viaTestAlias) — shown with the "via test mapping" badge. Omitted when false. */
  viaTestAlias?: boolean;
  /** The analyzer ID the test mapped (only when viaTestAlias). */
  testAlias?: string | null;
  /** Who ran the test (only when viaTestAlias). */
  testAliasUser?: string | null;
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
  /** Routed by a "Test with an analyzer ID" session (badge "via test mapping"). */
  viaTestAlias?: boolean;
  testAlias?: string | null;
  testAliasUser?: string | null;
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
  /** True status (desktop ≥ 1.1.1; absent on an older desktop build). */
  link?: InstrumentLink;
  sessions?: InstrumentSession[];
  lastRxAt?: string | null;
  listenPort?: number | null;
  errorDetail?: string | null;
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

// ── "Connect an analyzer" (electron/instruments/netdiag.js) ─────────────
export interface DiagAdapter {
  name: string;
  description?: string | null;
  mac?: string | null;
  dhcp?: boolean | null;
  gateway?: string | null;
  up?: boolean;
  ipv4: { address: string; netmask?: string | null; subnet?: string | null }[];
}
export interface DiagProfile { name: string | null; alias: string; index?: number | null; category: string | null; ipv4?: string | null }
export interface DiagProblem {
  code: 'no_network' | 'apipa' | 'two_nics_same_subnet' | 'public_network' | 'firewall_block_rule' | 'firewall_no_rule' | string;
  severity: 'error' | 'warning';
  message: string;
  card?: string;
  cards?: string[];
  subnet?: string;
  /** 'firewall' = the one-permission Windows fix resolves it. */
  fix?: 'firewall';
}
export interface DiagFirewall {
  supported: boolean;
  message?: string;
  enabled?: { domain: boolean | null; private: boolean | null; public: boolean | null };
  profiles?: DiagProfile[];
  blockRules?: number;
  ourRule?: boolean;
  /** Local ports our rule opens ("5599", "5603-5610", "Any"); null / absent = could not be read. */
  ourRulePorts?: string[] | null;
}
export interface DiagSnapshot {
  platform: string;
  hostname: string;
  adapters: DiagAdapter[];
  profiles: DiagProfile[];
  firewall: DiagFirewall;
  problems: DiagProblem[];
  suggestedPort: number | null;
}
export interface DiagFixResult { ok: boolean; cancelled?: boolean; partial?: boolean; unsupported?: boolean; error?: string; firewall?: DiagFirewall }
export interface AnalyzerGuess { make: string | null; model: string | null; profileKey: string | null; label: string | null }
export interface DiagScanEvent {
  scanId: string;
  kind: 'listening' | 'connected' | 'detect' | 'error';
  port: number;
  remote?: string | null;
  local?: string | null;
  detect?: DetectResult;
  guess?: AnalyzerGuess;
  messages?: number;
  error?: string;
}
export type DiagScanSetPortResult =
  | { ok: true; port: number; ports: number[]; warning?: string }
  | { ok: false; error: string; code?: string };
export interface DiagScanStart { scanId: string | null; ports: { port: number; ok: boolean; error?: string }[] }
export interface DiagScanPort {
  port: number; remote: string | null; local: string | null; connectedAt: string | null; messages: number;
  detect: DetectResult | null; guess: AnalyzerGuess | null; raw: string;
}
export interface DiagArpEntry { ip: string; mac: string; type: string; iface: string | null }
export interface DiagProbeResult { subnet?: string; tried?: number; hosts?: number; open?: { host: string; port: number }[]; error?: string; retryInMs?: number }

export interface ElectronInstrumentsDiagApi {
  snapshot(): Promise<DiagSnapshot>;
  ports(ports: number[]): Promise<{ port: number; state: 'free' | 'ours' | 'busy' | 'reserved'; name?: string | null; pid?: number | null; message?: string }[]>;
  nextPort(): Promise<number | null>;
  /** `adapter` = the card the analyzer cable goes into (its name as this PC
   *  reported it). Main re-reads Windows, asks in its own dialog, then
   *  Windows asks once. */
  fixFirewall(p: { ports?: number[]; adapter: string }): Promise<DiagFixResult>;
  arp(): Promise<DiagArpEntry[]>;
  probe(p: { address: string; ports?: number[] }): Promise<DiagProbeResult>;
  scanStart(p: { ports: number[] }): Promise<DiagScanStart | { error: string }>;
  /** The analyzer's host port is FIXED: listen on `port` (the old `previous`
   *  one closes only after the new one really opened; a refusal leaves it). */
  scanPort?(p: { scanId: string; port: number; previous?: number | null }): Promise<DiagScanSetPortResult>;
  scanStop(scanId: string): Promise<{ ports: DiagScanPort[] }>;
  onScan(cb: (e: DiagScanEvent) => void): () => void;
}

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
  /** "Connect an analyzer" helpers — desktop ≥ 1.1.1 only (absent before). */
  diag?: ElectronInstrumentsDiagApi;
  /** "Allow Prefrontal support" (beta) — desktop ≥ 1.1.2 only (absent before). */
  support?: ElectronSupportApi;
}

/** One line of the support session's live log (newest first). */
export interface SupportLogEntry {
  at: string;
  /** Who did it: Prefrontal support, the lab, or this PC. */
  actor: 'support' | 'lab' | 'pc' | string;
  text: string;
  /** ok | approved | denied | refused | failed */
  outcome: string;
}

/** The desktop's support session, as main reports it (never the token). */
export interface SupportSessionState {
  active: boolean;
  /** idle → starting → waiting (for support to join) → connected → ended */
  status: 'idle' | 'starting' | 'waiting' | 'connected' | 'ended';
  sessionId?: string;
  /** The server's code, "WDJB-MJHT", read out to Prefrontal support. */
  code?: string;
  startedAt?: string;
  expiresAt?: string;
  minutes?: number;
  supportJoined?: boolean;
  /** Who joined (the support person's email, from the server). */
  joinedBy?: string | null;
  /** Main's live hub connection to Prefrontal (only while a session runs). */
  connection?: 'connecting' | 'online' | 'reconnecting';
  /** The server's own view of this PC's connection (GET /{id}), null until known. */
  pcConnected?: boolean | null;
  /** A change is waiting for the lab's answer in the PC's own dialog. */
  approval?: { message: string } | null;
  /** The server refused the sign-in token (signed out elsewhere?). */
  signedOut?: boolean;
  endedReason?: 'lab' | 'expired' | 'quit' | 'signed_out' | 'ended' | null;
  log: SupportLogEntry[];
}

/** electron/preload.js → instruments.support (validated again in main). */
export interface ElectronSupportApi {
  start(p: { minutes: number; token: string; apiUrl: string; branchId?: string }): Promise<{ ok: boolean; error?: string; state?: SupportSessionState }>;
  stop(): Promise<{ ok: boolean; state?: SupportSessionState }>;
  status(): Promise<SupportSessionState>;
  setToken(token: string): Promise<{ ok: boolean; error?: string }>;
  onChange(cb: (s: SupportSessionState) => void): () => void;
}
