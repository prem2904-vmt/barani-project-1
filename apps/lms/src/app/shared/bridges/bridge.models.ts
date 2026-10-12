/**
 * Prefrontal Bridge (zero-touch) — the TS side of the cross-repo contract
 * **bridge-api v1** (prefrontal-bridge/docs/ZERO-TOUCH-PLAN.md, sections B.2
 * user API, B.3 Bridge local API, B.4 commands, B.5 mDNS). The server
 * (prefrontal-mw) and the Bridge (prefrontal-bridge) code against the SAME
 * shapes; keep field names in step with the contract, never rename them here.
 *
 * The server omits null fields (`WhenWritingNull`), so every optional key
 * below may be ABSENT — read it as null.
 *
 * Crypto (owner decision): device identity is ECDSA P-256, `alg: "ES256"`.
 * The app never signs or verifies anything — it only relays the Bridge's
 * claim ticket to the server — so `alg` is carried as an opaque string.
 */

// ── B.2 user API (apps → mw, /api/bridges) ─────────────────────────────────

/** Derived on the server: offline when LastSeenAt is older than 3 × heartbeat. */
export type BridgeStatus = 'pending' | 'online' | 'offline' | 'never' | 'error';
export type BridgeNetworkMode = 'client' | 'hotspot' | 'joining' | 'offline';
/** Same set as the Bridge's activity.js. */
export type AnalyzerLinkState = 'listening' | 'connected' | 'connecting' | 'reconnecting' | 'error' | 'stopped';
export type BridgeClaimMethod = 'nearby' | 'secret' | 'local';
/** The identity key algorithm. Owner decision: "ES256" (ECDSA P-256). */
export type BridgeKeyAlg = 'ES256' | (string & {});

export interface BridgeNetworkSummary {
  mode?: BridgeNetworkMode | null;
  ssid?: string | null;
  /** dBm, e.g. -58. */
  signal?: number | null;
  ipv4?: string | null;
}

export interface BridgeAnalyzerSummary {
  instrumentId: string;
  name: string;
  linkState?: AnalyzerLinkState | null;
  lastMessageAt?: string | null;
  queueDepth?: number | null;
}

export interface BridgeDto {
  id: string;
  name: string;
  serial?: string | null;
  serialShort?: string | null;
  model?: string | null;
  version?: string | null;
  latestVersion?: string | null;
  status: BridgeStatus;
  branchId: string;
  branchName?: string | null;
  lastSeenAt?: string | null;
  lastMessageAt?: string | null;
  queueTotal?: number | null;
  quarantineTotal?: number | null;
  network?: BridgeNetworkSummary | null;
  analyzers?: BridgeAnalyzerSummary[] | null;
  newDetectedCount?: number | null;
  claimMethod?: BridgeClaimMethod | null;
  claimedAt?: string | null;
  claimedByName?: string | null;
  serialConflict?: boolean | null;
}

export interface BridgeAnalyzerLanSettings {
  address?: string;
  dhcpStart?: string;
  dhcpEnd?: string;
  /** e.g. ["192.168.1.10/24"] to impersonate an old LIS IP. */
  extraAddresses?: string[];
}

export interface BridgeDetectSettings {
  enabled?: boolean;
  listenPorts?: number[];
  reportLeases?: boolean;
  quarantineMaxMessages?: number;
  quarantineMaxDays?: number;
}

/** Effective settings (bridges.SettingsJson merged over server defaults). */
export interface BridgeSettings {
  fallbackMinutes?: number;
  analyzerLan?: BridgeAnalyzerLanSettings;
  detect?: BridgeDetectSettings;
}

export interface BridgeDetailDto extends BridgeDto {
  settings?: BridgeSettings | null;
  /** State `new` only. */
  detectedSources?: DetectedSourceDto[] | null;
  /** Newest 5. */
  recentCommands?: BridgeCommandDto[] | null;
  tlsFingerprint?: string | null;
}

/** PATCH /api/bridges/{id}. */
export interface BridgePatch {
  name?: string;
  branchId?: string;
  settings?: {
    fallbackMinutes?: number;
    analyzerLan?: { extraAddresses?: string[] };
    detect?: { enabled?: boolean; listenPorts?: number[] };
  };
}

export interface BridgeRemoveResult { ok: boolean; discardedQueue: number }

export interface NearbyBridgeDto {
  announcementId: string;
  serial: string;
  serialShort: string;
  model?: string | null;
  version?: string | null;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  matchedBy?: 'ipv4' | 'ipv6' | (string & {}) | null;
}

export interface ClaimNonceDto { nonce: string; expiresAt: string }

/** Signed by the Bridge (`POST /local/v1/claim-ticket`); the app relays it verbatim. */
export interface BridgeClaimTicket {
  v: 1;
  serial: string;
  publicKey: string;
  alg: BridgeKeyAlg;
  nonce: string;
  issuedAt: string;
  claimState: 'unclaimed' | 'pending' | (string & {});
  signature: string;
}

export interface ClaimRequest {
  method: BridgeClaimMethod;
  /** nearby */
  announcementId?: string;
  /** secret — the code as typed / scanned (the server normalises). */
  claimSecret?: string;
  /** secret — present when it came from the QR. */
  serial?: string;
  /** local */
  ticket?: BridgeClaimTicket;
  /** Optional; default "Bridge ABCD-1234". */
  name?: string;
  /** Optional; default = the active branch. */
  branchId?: string;
}

/** Non-secret hints the app hands the Bridge over the local API (D6). */
export interface BridgeActivation {
  v: 1;
  serverUrl: string;
  bridgeId: string;
  bridgeName: string;
  tenantName: string;
  branchName: string;
}

export interface ClaimResultDto {
  state: 'claimed' | 'pending_device';
  bridge: BridgeDto;
  activation?: BridgeActivation | null;
}

// ── B.4 commands (server → Bridge through the heartbeat) ───────────────────

export type BridgeCommandType =
  | 'refresh' | 'reboot' | 'wifi.scan' | 'wifi.set' | 'wifi.forget'
  | 'hotspot.start' | 'logs.collect' | 'update.check';
export type BridgeCommandState = 'queued' | 'delivered' | 'succeeded' | 'failed' | 'expired' | 'cancelled';

export interface BridgeCommandResult {
  error?: string | null;
  message?: string | null;
  detail?: Record<string, unknown> | null;
}

export interface BridgeCommandDto {
  id: string;
  type: BridgeCommandType | (string & {});
  state: BridgeCommandState;
  /** Never the password — e.g. `{ ssid }` for wifi.set. */
  summary?: Record<string, unknown> | null;
  result?: BridgeCommandResult | null;
  issuedAt: string;
  issuedByName?: string | null;
  completedAt?: string | null;
}

export type WifiSecurity = 'open' | 'wpa2-psk' | 'wpa3-sae' | 'wpa2-eap';

export interface WifiNetwork {
  ssid: string;
  /** dBm or 0–100 as the Bridge reports it (nmcli SIGNAL is 0–100). */
  signal: number;
  security: WifiSecurity;
  inUse?: boolean;
}

export interface WifiEap {
  method: 'peap';
  identity: string;
  password: string;
  anonymousIdentity?: string;
  domainSuffixMatch?: string;
  caCertPem?: string;
}

/** Same body for the local `POST /local/v1/wifi` and the `wifi.set` command. */
export interface WifiCredentials {
  ssid: string;
  security: WifiSecurity;
  psk?: string;
  eap?: WifiEap;
  hidden?: boolean;
}

export interface WifiSetPayload extends WifiCredentials { keepPrevious: true }
export interface WifiScanDetail { networks: WifiNetwork[] }

// ── Detected sources (unknown analyzers that talked to the Bridge) ─────────

export type DetectedSourceKind = 'listen' | 'lease' | 'connect';
export type DetectedFraming = 'mllp' | 'astm' | 'raw' | 'unknown';
export type DetectedProtocol = 'hl7' | 'astm' | 'text' | 'unknown';
export type DetectedSourceState = 'new' | 'linked' | 'ignored';

export interface DetectedSourceGuess {
  make?: string | null;
  model?: string | null;
  profileKey?: string | null;
  label?: string | null;
}

export interface DetectedSourceDto {
  id: string;
  sourceKey: string;
  kind: DetectedSourceKind;
  port?: number | null;
  peerIp?: string | null;
  peerMac?: string | null;
  framing: DetectedFraming;
  protocol: DetectedProtocol;
  header?: {
    hl7?: { sendingApp?: string; sendingFacility?: string; version?: string };
    astm?: { sender?: string; version?: string };
  } | null;
  guess?: DetectedSourceGuess | null;
  messageCount: number;
  quarantined: number;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  state: DetectedSourceState;
  linkedInstrumentId?: string | null;
}

export type DetectedSourceLinkRequest =
  | { instrumentId: string }
  | { create: { name: string; make?: string; model?: string; profileKey?: string } };

/** `{ source, instrument }` — the instrument is the standard InstrumentDto. */
export interface DetectedSourceLinkResult<TInstrument = unknown> {
  source: DetectedSourceDto;
  instrument: TInstrument;
}

// ── B.3 Bridge local API (apps → Bridge, HTTPS :8443, pinned) ──────────────

export type LocalClaimState = 'unclaimed' | 'pending' | 'claimed';

export interface LocalIdentity {
  v: 1;
  serial: string;
  serialShort: string;
  model?: string;
  version?: string;
  publicKey: string;
  alg: BridgeKeyAlg;
  tlsFingerprint: string;
  claimState: LocalClaimState;
  network?: { mode?: BridgeNetworkMode; ssid?: string | null };
  serverUrl?: string | null;
  serverReachable?: boolean;
  iface: 'hotspot' | 'lan';
}

export interface LocalWifiNetworks { networks: WifiNetwork[]; scannedAt?: string; cached?: boolean }
export interface LocalWifiAccepted { accepted: boolean; willDisconnect: boolean; retryAfterSec: number }
export interface LocalWifiStatus {
  state?: string;
  mode?: BridgeNetworkMode;
  ssid?: string | null;
  lastJoinError?: string | null;
  lastJoinAt?: string | null;
  wlanMac?: string | null;
}
export interface LocalActivateResult { ok: boolean; claimState: LocalClaimState }

/** The local API envelope (same as the Bridge's setup page). */
export interface LocalEnvelope<T> { success: boolean; data?: T; message?: string; error?: string }

/** Where to reach a Bridge locally. `fingerprint` = the TLS pin (B.0 `fp`). */
export interface LocalTarget {
  host: string;
  port: number;
  fingerprint: string;
  /** Route the request through the joined hotspot network (Android). */
  viaHotspot: boolean;
}

/** Hotspot address of every Bridge (NetworkManager shared mode). */
export const BRIDGE_HOTSPOT_HOST = '10.42.0.1';
export const BRIDGE_LOCAL_HTTPS_PORT = 8443;

// ── B.5 mDNS ───────────────────────────────────────────────────────────────

export const BRIDGE_MDNS_TYPE = '_prefrontal-bridge._tcp';

/** A raw discovery event as the native plugin / Electron main emit it. */
export interface BridgeMdnsEvent {
  name: string;
  host?: string | null;
  port?: number | null;
  txt?: Record<string, string> | null;
  addresses?: string[] | null;
}

/** A discovered Bridge, parsed from its TXT record (B.5). TOFU: `fingerprint`
 *  comes from unauthenticated TXT and is re-verified through /identity. */
export interface DiscoveredBridge {
  serial: string;
  serialShort: string;
  name: string;
  host: string;
  port: number;
  claimState: LocalClaimState;
  version?: string;
  model?: string;
  fingerprint: string;
}

// ── Native / Electron transports ───────────────────────────────────────────

/** `request()` input — the native side pins `pinFingerprint` against the
 *  leaf certificate's SPKI SHA-256 (first 10 bytes, Crockford). */
export interface LocalHttpRequest {
  url: string;
  method: 'GET' | 'POST';
  body?: string;
  pinFingerprint: string;
  viaHotspot?: boolean;
  timeoutMs?: number;
}
export interface LocalHttpResponse { status: number; body: string }

export interface PluginListenerHandleLike { remove: () => Promise<void> | void }

/**
 * Capacitor plugin `PfBridgeLocal` (Android Kotlin / iOS Swift). The names
 * here must match the native method names exactly.
 */
export interface PfBridgeLocalPlugin {
  /** What this device can do: mDNS browse and hotspot auto-join. */
  capabilities(): Promise<{ discovery: boolean; hotspot: boolean }>;
  startDiscovery(): Promise<void>;
  stopDiscovery(): Promise<void>;
  /** Join the Bridge's hotspot (Android WifiNetworkSpecifier, iOS
   *  NEHotspotConfiguration joinOnce). Empty psk = open hotspot. */
  joinHotspot(options: { ssid: string; psk?: string }): Promise<{ joined: boolean }>;
  leaveHotspot(): Promise<void>;
  request(options: LocalHttpRequest): Promise<LocalHttpResponse>;
  addListener(event: 'bridgeFound' | 'bridgeLost', cb: (e: BridgeMdnsEvent) => void): Promise<PluginListenerHandleLike>;
}

/** `window.electronAPI.bridges` (electron/preload.js). No hotspot on desktop. */
export interface ElectronBridgesApi {
  discoverStart(): Promise<{ ok: boolean; error?: string }>;
  discoverStop(): Promise<{ ok: boolean }>;
  onFound(cb: (e: BridgeMdnsEvent) => void): () => void;
  onLost(cb: (e: BridgeMdnsEvent) => void): () => void;
  localRequest(req: LocalHttpRequest): Promise<LocalHttpResponse>;
}
