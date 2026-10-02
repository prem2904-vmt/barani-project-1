// node --test electron/test/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { formatDiagnostics, redact } = require('../diagnostics');

test('redact: device keys (both safeStorage prefixes), bearer/JWT tokens and HL7 PID segments never survive', () => {
  const dirty = [
    'Authorization: Bearer abc123.def456-ghi',
    'key=ss:U2FsdGVkX1+AbCdEfGhIjKlMnOpQrStUvWxYz==',
    'key=plain:super-secret-device-key-123',
    'X-Instrument-Key: pfi_live_abcDEF123',
    'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    'PID|1||MRN123456^^^HOSP||DOE^JOHN||19800101|M',
    'raw dump: MSH|^~\\&|...\rPID|1||A1^^^B||SMITH^JANE',
  ].join('\n');
  const out = redact(dirty);
  assert.ok(!out.includes('abc123.def456-ghi'));
  assert.ok(!out.includes('U2FsdGVkX1'));
  assert.ok(!out.includes('super-secret-device-key-123'));
  assert.ok(!out.includes('pfi_live_abcDEF123'));
  assert.ok(!out.includes('eyJhbGciOiJIUzI1NiJ9'));
  assert.ok(!out.includes('DOE^JOHN'));
  assert.ok(!out.includes('SMITH^JANE'));
  assert.ok(!out.includes('MRN123456'));
  assert.ok(!out.includes('A1^^^B'));
  // The redaction markers themselves are fine to see.
  assert.ok(out.includes('[redacted'));
});

test('redact: plain operational text (no secrets) passes through unchanged', () => {
  const clean = 'upload: HTTP 503\nconfig: network: timeout\nheartbeat: network: timeout';
  assert.equal(redact(clean), clean);
});

test('redact: never throws on null/undefined/non-string input', () => {
  assert.equal(redact(null), '');
  assert.equal(redact(undefined), '');
  assert.doesNotThrow(() => redact(42));
});

test('formatDiagnostics: no instruments configured', () => {
  const text = formatDiagnostics({
    appVersion: '1.4.0', platform: 'darwin', osRelease: '24.0.0', hostname: 'lab-pc-1',
    generatedAt: '2026-10-02T12:00:00.000Z', instruments: [], serverStatus: 'unknown',
  });
  assert.match(text, /^Prefrontal 1\.4\.0 \(darwin 24\.0\.0\)/);
  assert.match(text, /Host: lab-pc-1/);
  assert.match(text, /Instruments: none configured/);
  assert.match(text, /Server: unknown/);
});

test('formatDiagnostics: instrument counters + recent errors, NEVER a sample id / patient field', () => {
  const text = formatDiagnostics({
    appVersion: '1.4.0', platform: 'win32', osRelease: '10.0.19045', hostname: 'reception-pc',
    generatedAt: '2026-10-02T12:00:00.000Z',
    instruments: [{
      instrumentId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      name: 'Sysmex XN', state: 'connected',
      queueLength: 3, unmatchedToday: 1, messagesToday: 12,
      lastMessageAt: '2026-10-02T11:58:00.000Z',
      serverOnline: false, serverOfflineSince: '2026-10-02T11:30:00.000Z',
      recentErrors: [
        { at: '2026-10-02T11:40:00.000Z', message: 'upload: HTTP 503' },
        { at: '2026-10-02T11:45:00.000Z', message: 'heartbeat: network: timeout' },
      ],
    }],
    serverStatus: 'Offline since 11:30 AM',
  });
  assert.match(text, /Sysmex XN \(aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\): state=connected, queue=3, unmatchedToday=1, messagesToday=12/);
  assert.match(text, /lastMessage=2026-10-02T11:58:00\.000Z/);
  assert.match(text, /serverOfflineSince=2026-10-02T11:30:00\.000Z/);
  assert.match(text, /upload: HTTP 503/);
  assert.match(text, /heartbeat: network: timeout/);
  assert.match(text, /Server: Offline since 11:30 AM/);
  // No field here is ever patient/sample content, but assert the shape has
  // no sampleId/patient key at all as a tripwire against a future regression.
  assert.ok(!/sampleId/i.test(text));
  assert.ok(!/patient/i.test(text));
});

test('formatDiagnostics: recent errors are capped to the last 10 even if more are passed in', () => {
  const recentErrors = Array.from({ length: 15 }, (_, i) => ({ at: `t${i}`, message: `err ${i}` }));
  const text = formatDiagnostics({
    appVersion: '1.0.0', platform: 'darwin', osRelease: '1', hostname: 'h',
    instruments: [{ instrumentId: 'i1', name: 'X', state: 'error', recentErrors }],
  });
  assert.ok(!text.includes('err 4'));  // only the last 10 (err 5..err 14) show
  assert.ok(text.includes('err 14'));
  assert.ok(text.includes('err 5'));
});

test('formatDiagnostics: a diagnostics dump containing an accidentally-embedded secret is still redacted end to end', () => {
  const text = formatDiagnostics({
    appVersion: '1.0.0', platform: 'darwin', osRelease: '1', hostname: 'h',
    instruments: [{
      instrumentId: 'i1', name: 'X', state: 'error',
      recentErrors: [{ at: 't', message: 'upload: Bearer sk_live_abc123 rejected' }],
    }],
  });
  assert.ok(!text.includes('sk_live_abc123'));
});
