/**
 * Words for every Bridge state and error code (bridge-api v1). Pure — the ONE
 * home for this copy, so the list, the detail, the add flow and the Wi-Fi
 * dialog never phrase the same code two ways. No raw snake_case reaches the
 * screen (ENGINEERING-RULES §6, line-status precedent).
 */
import type {
  AnalyzerLinkState, BridgeCommandDto, BridgeCommandState, BridgeDto, BridgeNetworkMode, BridgeStatus,
  DetectedSourceDto, WifiSecurity,
} from './bridge.models';

export type BridgeTone = 'green' | 'amber' | 'red' | 'neutral';
export interface BridgeWord { label: string; tone: BridgeTone }

/** Row status: a 7px dot + a coloured word (ND §6 list rows). */
export function bridgeStatusWord(s: BridgeStatus | string | null | undefined): BridgeWord {
  switch (s) {
    case 'online': return { label: 'Online', tone: 'green' };
    case 'offline': return { label: 'Offline', tone: 'amber' };
    case 'error': return { label: 'Error', tone: 'red' };
    case 'pending': return { label: 'Waiting for the Bridge', tone: 'neutral' };
    default: return { label: 'Never connected', tone: 'neutral' };
  }
}

export function linkStateWord(s: AnalyzerLinkState | string | null | undefined): BridgeWord {
  switch (s) {
    case 'connected': return { label: 'Connected', tone: 'green' };
    // A Bridge port with nobody on it yet — amber, never green (next-phase §4,
    // same rule as the desktop connector's "Waiting for analyzer").
    case 'listening': return { label: 'Waiting for analyzer', tone: 'amber' };
    case 'connecting': return { label: 'Connecting', tone: 'amber' };
    case 'reconnecting': return { label: 'Reconnecting', tone: 'amber' };
    case 'error': return { label: 'Error', tone: 'red' };
    case 'stopped': return { label: 'Stopped', tone: 'neutral' };
    default: return { label: 'No report yet', tone: 'neutral' };
  }
}

export function networkModeWord(m: BridgeNetworkMode | string | null | undefined): string {
  switch (m) {
    case 'client': return 'On Wi-Fi';
    case 'hotspot': return 'Setup hotspot on';
    case 'joining': return 'Joining Wi-Fi';
    case 'offline': return 'No network';
    default: return 'Unknown';
  }
}

/** Signal as words. nmcli reports 0–100; some builds send dBm (negative). */
export function signalWord(signal: number | null | undefined): string {
  if (signal == null || Number.isNaN(signal)) return '';
  const pct = signal < 0 ? Math.max(0, Math.min(100, 2 * (signal + 100))) : Math.min(100, signal);
  if (pct >= 70) return 'Strong signal';
  if (pct >= 45) return 'Good signal';
  if (pct >= 25) return 'Weak signal';
  return 'Very weak signal';
}

/** One line for the list's Wi-Fi column: "LabWiFi · Good signal". */
export function wifiSummary(b: Pick<BridgeDto, 'network'>): string {
  const n = b.network;
  if (!n) return '—';
  if (n.mode && n.mode !== 'client') return networkModeWord(n.mode);
  const parts = [n.ssid, signalWord(n.signal)].filter(Boolean);
  return parts.length ? parts.join(' · ') : networkModeWord(n.mode);
}

export function securityWord(s: WifiSecurity | string | null | undefined): string {
  switch (s) {
    case 'open': return 'Open';
    case 'wpa2-psk': return 'WPA2';
    case 'wpa3-sae': return 'WPA3';
    case 'wpa2-eap': return 'Enterprise';
    default: return '';
  }
}

export function commandStateWord(s: BridgeCommandState | string | null | undefined): BridgeWord {
  switch (s) {
    case 'queued': return { label: 'Waiting for the Bridge', tone: 'neutral' };
    case 'delivered': return { label: 'In progress', tone: 'amber' };
    case 'succeeded': return { label: 'Done', tone: 'green' };
    case 'failed': return { label: 'Failed', tone: 'red' };
    case 'expired': return { label: 'Expired', tone: 'neutral' };
    case 'cancelled': return { label: 'Cancelled', tone: 'neutral' };
    default: return { label: 'Unknown', tone: 'neutral' };
  }
}

export function isCommandDone(s: BridgeCommandState | string | null | undefined): boolean {
  return s === 'succeeded' || s === 'failed' || s === 'expired' || s === 'cancelled';
}

export function commandTypeWord(t: string | null | undefined): string {
  switch (t) {
    case 'refresh': return 'Refresh settings';
    case 'reboot': return 'Restart';
    case 'wifi.scan': return 'Scan Wi-Fi';
    case 'wifi.set': return 'Change Wi-Fi';
    case 'wifi.forget': return 'Forget Wi-Fi';
    case 'hotspot.start': return 'Start setup hotspot';
    case 'logs.collect': return 'Collect logs';
    case 'update.check': return 'Check for updates';
    default: return 'Command';
  }
}

/** "Change Wi-Fi to LabWiFi" — never the password (the summary has none). */
export function commandLine(c: Pick<BridgeCommandDto, 'type' | 'summary'>): string {
  const ssid = typeof c.summary?.['ssid'] === 'string' ? (c.summary['ssid'] as string) : '';
  const base = commandTypeWord(c.type);
  return ssid && (c.type === 'wifi.set' || c.type === 'wifi.forget') ? `${base}: ${ssid}` : base;
}

/**
 * Every error code of bridge-api v1 → plain words: the user API (B.2), the
 * commands (B.4), the Bridge local API (B.3) and the app's own local-transport
 * failures. Unknown codes fall back to the server's message, then a generic.
 */
const ERROR_TEXT: Record<string, string> = {
  // B.2 — user API
  bridge_not_found: 'This Bridge was not found. It may have been removed.',
  invalid_name: 'Give the Bridge a name of 1 to 120 characters.',
  branch_not_allowed: "You can't add or move a Bridge to that branch.",
  bridge_has_instruments: 'Move its analyzers off this Bridge first, then change the branch.',
  invalid_settings: 'Some settings are not valid. Check them and try again.',
  invalid_command: "The Bridge can't run that command.",
  bridge_not_active: 'The Bridge is not set up yet. Wait for it to come online.',
  command_in_progress: 'A Wi-Fi change is already running on this Bridge. Wait for it to finish.',
  command_not_found: 'That command was not found.',
  port_in_use: 'Another analyzer on this Bridge already uses that port.',
  branch_mismatch: 'The analyzer and the Bridge belong to different branches.',
  source_not_new: 'This connection was already linked or ignored.',
  transport_not_supported_on_bridge: 'A Bridge connects analyzers over the network only (listen or connect), not serial or folder.',
  port_reserved: 'That port is reserved on the Bridge. Pick another port.',
  claim_code_not_found: "Check the code. If the Bridge isn't online yet, scan its QR.",
  too_many_pending: 'Too many Bridges are waiting to come online. Finish setting those up first.',
  nonce_expired: 'That took too long. Try adding the Bridge again.',
  bridge_already_claimed: 'This Bridge already belongs to a lab. Ask its admin to remove it first, or factory-reset it.',
  claim_locked: 'Too many wrong codes. Try again in an hour.',
  invalid_ticket_signature: "The Bridge's answer could not be verified. Try again.",
  rate_limited: 'Too many tries. Wait a minute and try again.',
  serial_conflict: 'Another Bridge reports the same serial number.',
  // B.4 — commands
  scan_failed: "The Bridge couldn't scan for Wi-Fi networks.",
  auth_failed: 'Wrong Wi-Fi password. The Bridge kept its previous network.',
  not_found: "The Bridge can't see that network.",
  no_ip: 'The network accepted the Bridge but gave it no address (DHCP). Ask IT to check it.',
  captive_portal: 'This network needs a sign-in page (guest Wi-Fi). Ask IT to allow the Bridge by its MAC address.',
  timeout: 'The Bridge could not join in time. It kept its previous network.',
  invalid_wifi: 'Check the network name (1–32 characters) and password (8–63 characters).',
  last_network: "This is the Bridge's only working network, so it can't be forgotten.",
  manifest_unreachable: "The Bridge couldn't reach the update server.",
  // B.3 — Bridge local API
  already_claimed: 'This Bridge already belongs to a lab.',
  invalid_nonce: 'The setup code expired. Try again.',
  server_not_allowed: "This Bridge doesn't recognise this Prefrontal server. Update the Bridge.",
  hotspot_only: 'Connect to the Bridge\'s own setup Wi-Fi to do this.',
  managed_by_server: 'This Bridge is managed from the Prefrontal app.',
  // App-side local transport
  local_unavailable: 'Only the Prefrontal phone and desktop apps can reach a Bridge directly.',
  hotspot_unavailable: 'Joining the Bridge\'s Wi-Fi works in the Prefrontal phone app only.',
  hotspot_join_failed: "Couldn't join the Bridge's setup Wi-Fi. Make sure it is close by and its hotspot is on.",
  pin_mismatch: 'This is not the Bridge from the QR (its security pin does not match).',
  serial_mismatch: 'A different Bridge answered. Make sure you joined the right setup Wi-Fi.',
  local_unreachable: "Couldn't reach the Bridge on this network.",
  local_permission_denied: 'Allow Local Network access for Prefrontal in Settings to find Bridges.',
};

export function bridgeErrorText(code: string | null | undefined, fallback?: string | null): string {
  if (code && ERROR_TEXT[code]) return ERROR_TEXT[code];
  if (fallback && fallback.trim()) return fallback;
  return 'Something went wrong. Try again.';
}

/** The codes this file knows (spec checks every contract code has copy). */
export const KNOWN_BRIDGE_ERROR_CODES: readonly string[] = Object.keys(ERROR_TEXT);

/** "Sysmex XN-350 connected on port 6661" — the detected-source headline. */
export function detectedSourceHeadline(s: Pick<DetectedSourceDto, 'guess' | 'kind' | 'port' | 'peerIp' | 'header'>): string {
  const who = s.guess?.label
    || [s.guess?.make, s.guess?.model].filter(Boolean).join(' ')
    || s.header?.hl7?.sendingApp
    || 'An analyzer';
  if (s.kind === 'listen' && s.port) return `${who} connected on port ${s.port}`;
  if (s.kind === 'connect' && s.peerIp) return `${who} is listening at ${s.peerIp}${s.port ? ':' + s.port : ''}`;
  if (s.kind === 'lease' && s.peerIp) return `${who} joined the analyzer network at ${s.peerIp}`;
  return `${who} found`;
}

/** Framing words for a detected source / analyzer link. */
export function framingWord(f: string | null | undefined): string {
  switch (f) {
    case 'mllp': return 'HL7 (MLLP)';
    case 'astm': case 'astm-e1381': return 'ASTM';
    case 'raw': return 'Plain text';
    case 'auto': return 'Auto-detect';
    default: return 'Unknown';
  }
}

/** "3 min ago" style, for last-seen / last-message cells. */
export function agoText(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'Just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'Yesterday' : `${d} days ago`;
}

/** Newer-version hint for the list / detail ("0.2.0 → 0.2.1"). */
export function versionText(b: Pick<BridgeDto, 'version' | 'latestVersion'>): string {
  if (!b.version) return '—';
  return b.latestVersion && b.latestVersion !== b.version ? `${b.version} (update ${b.latestVersion})` : b.version;
}
