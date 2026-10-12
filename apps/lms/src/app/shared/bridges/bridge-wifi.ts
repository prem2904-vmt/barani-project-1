/**
 * Wi-Fi credentials for a Bridge — ONE validator shared by the phone relay
 * (local `POST /local/v1/wifi`) and the remote `wifi.set` command (B.3/B.4
 * carry the same body). Mirrors the Bridge's own 400 `invalid_wifi` rule:
 * SSID 1–32 bytes, PSK 8–63 characters.
 */
import type { WifiCredentials, WifiSecurity, WifiSetPayload } from './bridge.models';

export interface WifiForm {
  ssid: string;
  security: WifiSecurity;
  hidden: boolean;
  psk: string;
  identity: string;
  password: string;
  anonymousIdentity: string;
  domainSuffixMatch: string;
  caCertPem: string;
}

export function emptyWifiForm(ssid = '', security: WifiSecurity = 'wpa2-psk'): WifiForm {
  return { ssid, security, hidden: false, psk: '', identity: '', password: '', anonymousIdentity: '', domainSuffixMatch: '', caCertPem: '' };
}

export type WifiField = 'ssid' | 'psk' | 'identity' | 'password' | 'caCertPem';
export interface WifiIssue { field: WifiField; message: string }

function utf8Len(s: string): number {
  try { return new TextEncoder().encode(s).length; } catch { return s.length; }
}

export function validateWifi(f: WifiForm): WifiIssue[] {
  const out: WifiIssue[] = [];
  const n = utf8Len(f.ssid);
  if (n < 1 || n > 32) out.push({ field: 'ssid', message: 'Network name must be 1 to 32 characters.' });
  if (f.security === 'wpa2-psk' || f.security === 'wpa3-sae') {
    if (f.psk.length < 8 || f.psk.length > 63) out.push({ field: 'psk', message: 'The Wi-Fi password is 8 to 63 characters.' });
  }
  if (f.security === 'wpa2-eap') {
    if (!f.identity.trim()) out.push({ field: 'identity', message: 'Enter the username for this network.' });
    if (!f.password) out.push({ field: 'password', message: 'Enter the password for this network.' });
    const ca = f.caCertPem.trim();
    if (ca && !/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(ca)) {
      out.push({ field: 'caCertPem', message: 'Paste the certificate in PEM form (BEGIN/END CERTIFICATE).' });
    }
  }
  return out;
}

/**
 * Enterprise Wi-Fi with neither a CA certificate nor a server domain: the
 * Bridge can't tell the real network from an impostor ("evil twin") that
 * collects the password (plan E.6). The UI warns and asks to confirm.
 */
export function eapWithoutCaValidation(f: Pick<WifiForm, 'security' | 'caCertPem' | 'domainSuffixMatch'>): boolean {
  return f.security === 'wpa2-eap' && !f.caCertPem.trim() && !f.domainSuffixMatch.trim();
}

/** The wire body (local API + wifi.set). Empty optionals are omitted. */
export function toWifiCredentials(f: WifiForm): WifiCredentials {
  const c: WifiCredentials = { ssid: f.ssid, security: f.security };
  if (f.hidden) c.hidden = true;
  if (f.security === 'wpa2-psk' || f.security === 'wpa3-sae') c.psk = f.psk;
  if (f.security === 'wpa2-eap') {
    c.eap = { method: 'peap', identity: f.identity.trim(), password: f.password };
    if (f.anonymousIdentity.trim()) c.eap.anonymousIdentity = f.anonymousIdentity.trim();
    if (f.domainSuffixMatch.trim()) c.eap.domainSuffixMatch = f.domainSuffixMatch.trim();
    if (f.caCertPem.trim()) c.eap.caCertPem = f.caCertPem.trim();
  }
  return c;
}

/** `wifi.set` payload: the previous network is always kept for rollback. */
export function toWifiSetPayload(f: WifiForm): WifiSetPayload {
  return { ...toWifiCredentials(f), keepPrevious: true };
}
