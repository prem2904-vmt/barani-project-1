'use strict';
/**
 * Device-authenticated HTTP client for the LMS instrument endpoints.
 * Uses the global fetch (Node ≥ 18 / Electron). The device key travels in
 * the X-Instrument-Key header — never in a URL, never logged.
 *
 *   GET  {api}/api/instruments/{id}/config
 *   POST {api}/api/instruments/{id}/heartbeat
 *   POST {api}/api/instruments/{id}/messages     (idempotent by idempotencyKey)
 *
 * Error classes for the queue:
 *   ok        2xx
 *   permanent 400/404/409/413/422 → dead-letter (retrying can't help)
 *   auth      401/403 → keep the message, back off (the key may be rotated
 *             and re-paired; the data must not be lost)
 *   transient network / timeout / 408 / 429 / 5xx → retry with backoff
 */

class ApiError extends Error {
  constructor(message, { status = 0, kind = 'transient', body = null } = {}) {
    super(message);
    this.status = status;
    this.kind = kind;
    this.body = body;
  }
}

function classify(status) {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401 || status === 403) return 'auth';
  if (status === 408 || status === 429 || status >= 500) return 'transient';
  return 'permanent';
}

const QUERY_TIMEOUT_MS = 4000;

class Uploader {
  constructor({ apiUrl, instrumentId, deviceKey, fetchImpl, timeoutMs = 15000, userAgent = 'prefrontal-instrument-connector' } = {}) {
    if (!apiUrl) throw new Error('Uploader: apiUrl is required');
    this.base = String(apiUrl).replace(/\/+$/, '');
    this.instrumentId = instrumentId;
    this.deviceKey = deviceKey;
    this.fetch = fetchImpl || globalThis.fetch;
    this.timeoutMs = timeoutMs;
    this.userAgent = userAgent;
  }

  _url(suffix) { return `${this.base}/api/instruments/${encodeURIComponent(this.instrumentId)}${suffix}`; }

  async _req(method, suffix, body, timeoutMs) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs || this.timeoutMs);
    let res;
    try {
      res = await this.fetch(this._url(suffix), {
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Instrument-Key': this.deviceKey,
          'User-Agent': this.userAgent,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctl.signal,
      });
    } catch (e) {
      throw new ApiError(`network: ${e && e.name === 'AbortError' ? 'timeout' : (e && e.message) || e}`, { kind: 'transient' });
    } finally {
      clearTimeout(t);
    }
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    const kind = classify(res.status);
    if (kind !== 'ok' || (json && json.success === false)) {
      const msg = (json && (json.message || json.error)) || `HTTP ${res.status}`;
      throw new ApiError(msg, { status: res.status, kind: kind === 'ok' ? 'permanent' : kind, body: json });
    }
    return json && Object.prototype.hasOwnProperty.call(json, 'data') ? json.data : json;
  }

  getConfig() { return this._req('GET', '/config'); }
  heartbeat(body) { return this._req('POST', '/heartbeat', body); }
  postMessage(payload) { return this._req('POST', '/messages', payload); }

  /**
   * Two-way interfacing (see bidi/): the analyzer is WAITING on these, so a
   * query has a hard 4 s ceiling — enforced with a race as well as an abort,
   * so a fetch that ignores its AbortSignal can never hang the analyzer.
   *   GET {id}/orders?sampleId=<barcode>   → DeviceOrdersDto
   *   GET {id}/worklist?since=<iso>        → { items: DeviceOrdersDto[], serverTime }
   */
  getOrders(sampleId, { timeoutMs = QUERY_TIMEOUT_MS } = {}) {
    return this._hard(this._req('GET', `/orders?sampleId=${encodeURIComponent(sampleId)}`, undefined, timeoutMs), timeoutMs);
  }

  getWorklist({ since, timeoutMs = 10000 } = {}) {
    const q = since ? `?since=${encodeURIComponent(since)}` : '';
    return this._hard(this._req('GET', `/worklist${q}`, undefined, timeoutMs), timeoutMs);
  }

  _hard(p, ms) {
    let timer;
    const guard = new Promise((_r, rej) => { timer = setTimeout(() => rej(new ApiError('network: timeout', { kind: 'transient' })), ms + 100); if (timer.unref) timer.unref(); });
    p.catch(() => {});
    return Promise.race([p, guard]).finally(() => clearTimeout(timer));
  }
}

module.exports = { Uploader, ApiError, classify, QUERY_TIMEOUT_MS };
