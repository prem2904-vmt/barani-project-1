import {
  PasskeyHost, base64UrlToBytes, bytesToBase64Url, credentialToJSON, deviceLabel, isBareDomain,
  kindFromAuthError, kindFromDomError, originAllowed, passkeyAvailability, passkeyErrorText,
  toCreationOptions, toRequestOptions,
} from './passkey-webauthn';

const host = (o: Partial<PasskeyHost> = {}): PasskeyHost => ({
  hasWebAuthn: true, secure: true, hostname: 'med-dev.prefrontal.health',
  isElectron: false, isCapacitor: false, rpId: 'med-dev.prefrontal.health', ...o,
});

describe('passkey availability (where the passkey UI may show)', () => {
  it('shows in a secure browser on the RP ID host or a subdomain', () => {
    expect(passkeyAvailability(host())).toEqual({ ok: true, reason: null });
    expect(passkeyAvailability(host({ hostname: 'lab.med-dev.prefrontal.health' })).ok).toBe(true);
  });
  it('hides in the phone apps (Capacitor) and the desktop lab app (Electron)', () => {
    expect(passkeyAvailability(host({ isCapacitor: true })).reason).toBe('native');
    expect(passkeyAvailability(host({ isElectron: true })).reason).toBe('desktop');
  });
  it('hides without WebAuthn, on an insecure page, without an RP ID, or on another host', () => {
    expect(passkeyAvailability(host({ hasWebAuthn: false })).reason).toBe('no-webauthn');
    expect(passkeyAvailability(host({ secure: false })).reason).toBe('insecure');
    expect(passkeyAvailability(host({ rpId: null })).reason).toBe('not-configured');
    expect(passkeyAvailability(host({ rpId: 'https://med-dev.prefrontal.health' })).reason).toBe('not-configured');
    // stage / prod / localhost never borrow the dev RP ID
    expect(passkeyAvailability(host({ hostname: 'med-stage.prefrontal.health' })).reason).toBe('origin');
    expect(passkeyAvailability(host({ hostname: 'localhost' })).reason).toBe('origin');
    expect(passkeyAvailability(host({ hostname: 'evilmed-dev.prefrontal.health' })).reason).toBe('origin');
  });
  it('validates RP IDs as bare domains', () => {
    expect(isBareDomain('prefrontal.health')).toBe(true);
    expect(isBareDomain('med-dev.prefrontal.health:443')).toBe(false);
    expect(isBareDomain('')).toBe(false);
    expect(originAllowed('A.Prefrontal.Health', 'prefrontal.health')).toBe(true);
  });
});

describe('WebAuthn JSON codec', () => {
  it('round-trips base64url', () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
    const s = bytesToBase64Url(bytes);
    expect(s).not.toMatch(/[+/=]/);
    expect(Array.from(base64UrlToBytes(s))).toEqual(Array.from(bytes));
  });

  it('decodes request options (challenge + allowCredentials) to buffers', () => {
    const o = toRequestOptions({ challenge: 'AQID', rpId: 'med-dev.prefrontal.health', allowCredentials: [{ id: 'BAU', type: 'public-key' }], userVerification: 'preferred' });
    expect(Array.from(new Uint8Array(o.challenge as ArrayBuffer))).toEqual([1, 2, 3]);
    expect(Array.from(new Uint8Array(o.allowCredentials![0].id as ArrayBuffer))).toEqual([4, 5]);
    expect(o.rpId).toBe('med-dev.prefrontal.health');
  });

  it('discoverable sign-in: no allowCredentials stays absent', () => {
    const o = toRequestOptions({ challenge: 'AQID' });
    expect(o.allowCredentials).toBeUndefined();
  });

  it('decodes creation options (challenge + user.id + excludeCredentials)', () => {
    const o = toCreationOptions({
      challenge: 'AQID', rp: { id: 'med-dev.prefrontal.health', name: 'Prefrontal' },
      user: { id: 'CQo', name: 'u@x', displayName: 'U' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      excludeCredentials: [{ id: 'Cw', type: 'public-key' }],
    });
    expect(Array.from(new Uint8Array(o.user.id as ArrayBuffer))).toEqual([9, 10]);
    expect(Array.from(new Uint8Array(o.excludeCredentials![0].id as ArrayBuffer))).toEqual([11]);
    expect(o.rp.name).toBe('Prefrontal');
  });

  it('serialises an assertion manually when toJSON is missing', () => {
    const cred = {
      id: 'cred-1', type: 'public-key',
      response: {
        clientDataJSON: new Uint8Array([1]).buffer, authenticatorData: new Uint8Array([2]).buffer,
        signature: new Uint8Array([3]).buffer, userHandle: new Uint8Array([4]).buffer,
      },
      getClientExtensionResults: () => ({}),
      authenticatorAttachment: 'platform',
    } as unknown as PublicKeyCredential;
    expect(credentialToJSON(cred)).toEqual({
      id: 'cred-1', rawId: 'cred-1', type: 'public-key',
      response: { clientDataJSON: 'AQ', authenticatorData: 'Ag', signature: 'Aw', userHandle: 'BA' },
      clientExtensionResults: {}, authenticatorAttachment: 'platform',
    });
  });

  it('prefers the browser’s own toJSON()', () => {
    const cred = { toJSON: () => ({ id: 'native' }) } as unknown as PublicKeyCredential;
    expect(credentialToJSON(cred)).toEqual({ id: 'native' });
  });
});

describe('passkey errors in plain words', () => {
  it('maps browser rejections', () => {
    expect(kindFromDomError({ name: 'NotAllowedError' })).toBe('cancelled');
    expect(kindFromDomError({ name: 'AbortError' })).toBe('cancelled');
    expect(kindFromDomError({ name: 'InvalidStateError' })).toBe('exists');
    expect(kindFromDomError({ name: 'SecurityError' })).toBe('unsupported');
  });
  it('maps Supabase error codes', () => {
    expect(kindFromAuthError(400, { error_code: 'webauthn_credential_not_found' })).toBe('not_found');
    expect(kindFromAuthError(400, { error_code: 'webauthn_challenge_expired' })).toBe('expired');
    expect(kindFromAuthError(422, { error_code: 'passkey_disabled' })).toBe('disabled');
    expect(kindFromAuthError(422, { error_code: 'too_many_passkeys' })).toBe('too_many');
    expect(kindFromAuthError(401, {})).toBe('reauth');
    expect(kindFromAuthError(503, null)).toBe('network');
    expect(kindFromAuthError(400, { code: 400 })).toBe('failed');
  });
  it('never shows jargon', () => {
    for (const k of ['cancelled', 'not_found', 'expired', 'disabled', 'exists', 'too_many', 'reauth', 'banned', 'network', 'unsupported', 'failed'] as const) {
      const t = passkeyErrorText(k) + passkeyErrorText(k, 'add');
      expect(t).not.toMatch(/webauthn|credential|challenge|RP ID|assertion/i);
    }
  });
  it('names the device', () => {
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36')).toBe('Chrome on Mac');
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Version/18.0 Mobile Safari/604.1')).toBe('Safari on iPhone');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('Edge on Windows');
  });
});
