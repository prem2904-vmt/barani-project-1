import { describe, expect, it } from 'vitest';
import {
  KNOWN_BRIDGE_ERROR_CODES, agoText, bridgeErrorText, bridgeStatusWord, commandLine, commandStateWord, detectedSourceHeadline,
  isCommandDone, linkStateWord, networkModeWord, signalWord, versionText, wifiSummary,
} from './bridge-status';
import { FX_SOURCE_XN350 } from './testing/bridge-fixtures';

/** Every error code bridge-api v1 can hand the app (B.2 user API, B.3 local API, B.4 commands). */
const CONTRACT_CODES = [
  // B.2
  'bridge_not_found', 'invalid_name', 'branch_not_allowed', 'bridge_has_instruments', 'invalid_settings', 'invalid_command',
  'bridge_not_active', 'command_in_progress', 'port_in_use', 'branch_mismatch', 'source_not_new', 'transport_not_supported_on_bridge',
  'port_reserved', 'claim_code_not_found', 'too_many_pending', 'nonce_expired', 'bridge_already_claimed', 'claim_locked',
  'invalid_ticket_signature', 'rate_limited', 'command_not_found', 'serial_conflict',
  // B.3
  'already_claimed', 'invalid_nonce', 'server_not_allowed', 'hotspot_only', 'invalid_wifi', 'managed_by_server',
  // B.4
  'scan_failed', 'auth_failed', 'not_found', 'no_ip', 'captive_portal', 'timeout', 'last_network', 'manifest_unreachable',
];

describe('bridge-status — one home for every word', () => {
  it.each(CONTRACT_CODES)('%s has plain-words copy (no snake_case leaks)', (code) => {
    expect(KNOWN_BRIDGE_ERROR_CODES).toContain(code);
    const t = bridgeErrorText(code);
    expect(t).not.toMatch(/_/);
    expect(t.length).toBeGreaterThan(10);
  });

  it('unknown code → the server message, then a generic line', () => {
    expect(bridgeErrorText('weird_code', 'Server says no')).toBe('Server says no');
    expect(bridgeErrorText(null)).toBe('Something went wrong. Try again.');
  });

  it('the claim-code copy is the contract text', () => {
    expect(bridgeErrorText('claim_code_not_found')).toBe("Check the code. If the Bridge isn't online yet, scan its QR.");
  });

  it('status / link / mode / command words', () => {
    expect(bridgeStatusWord('online')).toEqual({ label: 'Online', tone: 'green' });
    expect(bridgeStatusWord('offline').tone).toBe('amber');
    expect(bridgeStatusWord('pending').label).toBe('Waiting for the Bridge');
    expect(bridgeStatusWord(undefined).label).toBe('Never connected');
    expect(linkStateWord('listening')).toEqual({ label: 'Waiting for analyzer', tone: 'amber' });
    expect(linkStateWord('reconnecting').tone).toBe('amber');
    expect(networkModeWord('hotspot')).toBe('Setup hotspot on');
    expect(commandStateWord('delivered').label).toBe('In progress');
    expect(isCommandDone('queued')).toBe(false);
    expect(isCommandDone('expired')).toBe(true);
    expect(commandLine({ type: 'wifi.set', summary: { ssid: 'LabWiFi' } })).toBe('Change Wi-Fi: LabWiFi');
    expect(commandLine({ type: 'reboot', summary: {} })).toBe('Restart');
  });

  it('signal: nmcli 0–100 or dBm', () => {
    expect(signalWord(80)).toBe('Strong signal');
    expect(signalWord(-58)).toBe('Strong signal'); // -58 dBm ≈ 84 %
    expect(signalWord(-75)).toBe('Good signal');
    expect(signalWord(-85)).toBe('Weak signal');
    expect(signalWord(-95)).toBe('Very weak signal');
    expect(signalWord(null)).toBe('');
    expect(wifiSummary({ network: { mode: 'client', ssid: 'LabWiFi', signal: 72 } })).toBe('LabWiFi · Strong signal');
    expect(wifiSummary({ network: { mode: 'hotspot' } })).toBe('Setup hotspot on');
    expect(wifiSummary({ network: null })).toBe('—');
  });

  it('"Sysmex XN-350 connected on port 6662" — the detected-source headline', () => {
    expect(detectedSourceHeadline(FX_SOURCE_XN350)).toBe('Sysmex XN-350 connected on port 6662');
    expect(detectedSourceHeadline({ ...FX_SOURCE_XN350, guess: null, header: null })).toBe('An analyzer connected on port 6662');
    expect(detectedSourceHeadline({ ...FX_SOURCE_XN350, kind: 'lease', port: null })).toBe('Sysmex XN-350 joined the analyzer network at 192.168.50.101');
  });

  it('ago + version', () => {
    const now = Date.parse('2026-10-11T09:00:00Z');
    expect(agoText('2026-10-11T08:59:50Z', now)).toBe('Just now');
    expect(agoText('2026-10-11T08:55:00Z', now)).toBe('5 min ago');
    expect(agoText('2026-10-10T08:00:00Z', now)).toBe('Yesterday');
    expect(agoText(null, now)).toBe('');
    expect(versionText({ version: '0.2.0', latestVersion: '0.2.1' })).toBe('0.2.0 (update 0.2.1)');
    expect(versionText({ version: null })).toBe('—');
  });
});
