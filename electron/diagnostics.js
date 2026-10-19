'use strict';
/**
 * "Copy diagnostic info" (tray menu) — a plain-text support dump built ONLY
 * from operational facts: app/OS identity, each connector's own status()
 * counters, and its last few short error strings (connector.js `errors`,
 * e.g. "upload: HTTP 503", "config: network: timeout") — never a parsed
 * message, a sample id, or anything that reads the raw analyzer traffic
 * (that stays in electron/instruments/core/rawlog.js, which is deliberately
 * NEVER a diagnostics input — see its own header comment: it can contain
 * sample barcodes / results and is never uploaded except as the message's
 * own `raw` field).
 *
 * `redact()` is a defence-in-depth pass over the assembled text regardless —
 * it strips anything that LOOKS like a device key, a bearer/JWT token or an
 * HL7 PID (patient identification) segment, so a future error message that
 * accidentally embeds one still never reaches the clipboard. Covered by
 * electron/test/diagnostics.test.js.
 */

function formatDiagnostics({
  appVersion, platform, osRelease, hostname, generatedAt,
  instruments = [], serverStatus,
} = {}) {
  const lines = [];
  lines.push(`Prefrontal ${appVersion || 'unknown'} (${platform || 'unknown'} ${osRelease || ''})`.trim());
  lines.push(`Host: ${hostname || 'unknown'}`);
  lines.push(`Generated: ${generatedAt || new Date().toISOString()}`);
  lines.push('');

  if (!instruments.length) {
    lines.push('Instruments: none configured');
  } else {
    lines.push('Instruments:');
    for (const i of instruments) {
      const bits = [
        `state=${i.state}`,
        `queue=${Number(i.queueLength) || 0}`,
        `unmatchedToday=${Number(i.unmatchedToday) || 0}`,
        `messagesToday=${Number(i.messagesToday) || 0}`,
      ];
      if (i.lastMessageAt) bits.push(`lastMessage=${i.lastMessageAt}`);
      if (i.serverOnline === false) bits.push(`serverOfflineSince=${i.serverOfflineSince || '?'}`);
      lines.push(`  - ${i.name || i.instrumentId} (${i.instrumentId}): ${bits.join(', ')}`);
      const errs = Array.isArray(i.recentErrors) ? i.recentErrors.slice(-10) : [];
      if (errs.length) {
        lines.push('    recent errors:');
        for (const e of errs) lines.push(`      ${e.at} ${e.message}`);
      }
    }
  }

  lines.push('');
  lines.push(`Server: ${serverStatus || 'unknown'}`);

  return redact(lines.join('\n'));
}

/** Strip anything shaped like a credential or a clinical identifier, even
 *  though none of the fields above are meant to carry one. */
function redact(text) {
  let out = String(text == null ? '' : text);
  out = out.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]');
  out = out.replace(/X-Instrument-Key:?\s*\S+/gi, 'X-Instrument-Key: [redacted]');
  // electron/instruments/host-electron.js's safeStorage codec prefixes:
  // "ss:<base64>" (OS-keychain encrypted) and "plain:<key>" (no keychain).
  out = out.replace(/\bss:[A-Za-z0-9+/=]{8,}/g, '[redacted-key]');
  out = out.replace(/\bplain:\S+/g, '[redacted-key]');
  // JWT-shaped bearer tokens (three dot-separated base64url segments).
  out = out.replace(/\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, '[redacted-token]');
  // HL7 PID (patient identification) segment, however it got here.
  out = out.replace(/PID\|[^\r\n]*/g, 'PID|[redacted]');
  return out;
}

module.exports = { formatDiagnostics, redact };
