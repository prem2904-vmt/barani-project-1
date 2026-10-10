import { describe, expect, it } from 'vitest';
import { eapWithoutCaValidation, emptyWifiForm, toWifiCredentials, toWifiSetPayload, validateWifi } from './bridge-wifi';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';

describe('Wi-Fi credentials — one validator for the relay and wifi.set', () => {
  it('PSK 8–63, SSID 1–32 bytes (UTF-8)', () => {
    expect(validateWifi({ ...emptyWifiForm('LabWiFi'), psk: 'secret12' })).toEqual([]);
    expect(validateWifi({ ...emptyWifiForm('LabWiFi'), psk: 'short' }).map((i) => i.field)).toEqual(['psk']);
    expect(validateWifi({ ...emptyWifiForm('LabWiFi'), psk: 'x'.repeat(64) }).map((i) => i.field)).toEqual(['psk']);
    expect(validateWifi({ ...emptyWifiForm(''), psk: 'secret12' }).map((i) => i.field)).toEqual(['ssid']);
    expect(validateWifi({ ...emptyWifiForm('é'.repeat(17)), psk: 'secret12' }).map((i) => i.field)).toEqual(['ssid']); // 34 bytes
    expect(validateWifi(emptyWifiForm('Guest', 'open'))).toEqual([]);
  });

  it('enterprise: username + password required; a CA must be PEM', () => {
    const eap = emptyWifiForm('Hospital-Staff', 'wpa2-eap');
    expect(validateWifi(eap).map((i) => i.field)).toEqual(['identity', 'password']);
    expect(validateWifi({ ...eap, identity: 'lab', password: 'p', caCertPem: 'nope' }).map((i) => i.field)).toEqual(['caCertPem']);
    expect(validateWifi({ ...eap, identity: 'lab', password: 'p', caCertPem: PEM })).toEqual([]);
  });

  it('no CA and no server domain → the evil-twin warning', () => {
    const eap = { ...emptyWifiForm('H', 'wpa2-eap'), identity: 'a', password: 'b' };
    expect(eapWithoutCaValidation(eap)).toBe(true);
    expect(eapWithoutCaValidation({ ...eap, domainSuffixMatch: 'radius.h.in' })).toBe(false);
    expect(eapWithoutCaValidation({ ...eap, caCertPem: PEM })).toBe(false);
    expect(eapWithoutCaValidation(emptyWifiForm('X'))).toBe(false);
  });

  it('wire body: empty optionals omitted; wifi.set keeps the previous network', () => {
    expect(toWifiCredentials({ ...emptyWifiForm('LabWiFi'), psk: 'secret12' })).toEqual({ ssid: 'LabWiFi', security: 'wpa2-psk', psk: 'secret12' });
    expect(toWifiCredentials({ ...emptyWifiForm('Guest', 'open'), hidden: true })).toEqual({ ssid: 'Guest', security: 'open', hidden: true });
    expect(toWifiCredentials({ ...emptyWifiForm('H', 'wpa2-eap'), identity: ' lab ', password: 'p', domainSuffixMatch: 'r.h.in' }))
      .toEqual({ ssid: 'H', security: 'wpa2-eap', eap: { method: 'peap', identity: 'lab', password: 'p', domainSuffixMatch: 'r.h.in' } });
    expect(toWifiSetPayload({ ...emptyWifiForm('LabWiFi'), psk: 'secret12' }).keepPrevious).toBe(true);
  });
});
