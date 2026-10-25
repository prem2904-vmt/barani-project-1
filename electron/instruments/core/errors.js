'use strict';
/**
 * Plain-words connection problems for the status card, the tray and the
 * heartbeat's `errorDetail` (the server shows it as-is). Pure, host-agnostic:
 * WHO holds a busy port is looked up by the host (Windows: netstat + tasklist,
 * electron/instruments/netdiag.js) and passed in as `owner` — the core never
 * shells out.
 *
 * Never echoes analyzer traffic; only the OS error code + the configured
 * port / host / path.
 */

/**
 * @param {Error & {code?: string}} err
 * @param {object} [transport]  the effective transport config ({ type, port, host, path })
 * @param {{ pid?: number, name?: string, ours?: boolean } | null} [owner]  who holds the port, if known
 * @returns {string}
 */
function friendlyTransportError(err, transport = {}, owner = null) {
  const code = (err && err.code) || '';
  const msg = String((err && err.message) || err || '');
  const t = transport || {};
  const port = t.port != null ? Number(t.port) : null;
  const where = t.host && port ? `${t.host}:${port}` : t.host || (port ? `port ${port}` : 'the analyzer');

  if (t.type === 'tcp-server' || (!t.type && port)) {
    if (code === 'EADDRINUSE') {
      if (owner && owner.ours) return `Port ${port} is already used by another analyzer in Prefrontal on this PC. Give this analyzer its own port.`;
      if (owner && owner.name) return `Port ${port} is used by ${owner.name}${owner.pid ? ` (PID ${owner.pid})` : ''}. Close that program, or pick another port for this analyzer.`;
      return `Port ${port} is already used by another program on this PC. Close it, or pick another port.`;
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return `Port ${port} can't be used on this PC (access denied — Windows may have reserved it). Pick another port.`;
    }
    if (code === 'EADDRNOTAVAIL') return `This PC doesn't have the address ${t.host || ''} any more. Use 0.0.0.0 (all network cards).`;
  }
  if (t.type === 'tcp-client') {
    if (code === 'ECONNREFUSED') return `The analyzer at ${where} refused the connection. Check its LIS port and that its LIS / host mode is on.`;
    if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'EHOSTDOWN') {
      return `Can't reach the analyzer at ${where}. Check the cable and the analyzer's IP address.`;
    }
    if (code === 'ECONNRESET') return `The analyzer at ${where} dropped the connection.`;
  }
  if (t.type === 'serial') {
    if (/access denied|EBUSY|resource busy|cannot lock/i.test(msg) || code === 'EBUSY' || code === 'EACCES') {
      return `${t.path || 'The serial port'} is open in another program. Close it and try again.`;
    }
    if (/file not found|no such file|ENOENT|cannot find/i.test(msg) || code === 'ENOENT') {
      return `${t.path || 'The serial port'} was not found. Check the cable (USB-serial adapters can change COM number).`;
    }
  }
  if (t.type === 'folder' && (code === 'ENOENT' || /no such file/i.test(msg))) {
    return `The folder ${t.path || ''} was not found.`;
  }
  return msg || 'Connection problem';
}

module.exports = { friendlyTransportError };
