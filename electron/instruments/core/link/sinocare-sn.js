'use strict';
/**
 * Sinocare "SN" binary frames (iCARE-2100 POCT immunofluorescence, TCP):
 *
 *   'S' 'N' | len uint16 BE | type uint16 BE | UTF-8 JSON payload | CRC16 BE
 *
 *   len  = 2 (type) + payload bytes + 2 (crc)
 *   CRC  = CRC-16/MODBUS (poly 0x8005 reflected = 0xA001, init 0xFFFF) over
 *          type + payload, written big-endian.
 *
 * Types seen on the wire: 0x0001 = resource upload
 * {"fhir":{…},"url":"https://example.com/path/Device|Patient|Observation"},
 * 0x0008 = {"id":""}. The device waits for a server reply after each frame
 * (E59 "No server feedback" without one); the reply format is not documented,
 * so `replyMode` is configurable: 'none' (default) or 'echo' — a frame of the
 * SAME type carrying `ackJson` ({{id}} → the frame's id, JSON-escaped).
 *
 * Every good frame is delivered as ONE message: a JSON envelope the
 * 'sinocare-fhir' parser reads —
 *   { "sinocare": 1, "type": 1, "resource": "Patient", "body": {…},
 *     "context": { "patient": {…}|null, "device": {…}|null } }
 * `context` carries the last Device / Patient seen on this connection, so an
 * Observation frame can be matched to its sample.
 *
 * A bad CRC is logged ('frame' ok:false) and the frame is ignored (no reply —
 * the device retries). Only used when the link type is 'sinocare-sn'.
 */
const { EventEmitter } = require('events');
const { toBuffer } = require('../bytes');

const DEFAULT_ACK_JSON = '{"code":0,"msg":"success","id":"{{id}}"}';
const CONTEXT_TTL_MS = 2 * 60 * 60 * 1000;
const MAGIC0 = 0x53; // 'S'

function newContext() { return { patient: null, patientAt: 0, patients: {}, device: null }; }
const MAGIC1 = 0x4e; // 'N'

/** CRC-16/MODBUS. */
function crc16modbus(buf) {
  let c = 0xffff;
  for (const x of buf) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1;
  }
  return c & 0xffff;
}

/** type + payload (Buffer|string, UTF-8) → a complete SN frame. */
function encodeSnFrame(type, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload ?? ''), 'utf8');
  const tp = Buffer.alloc(2); tp.writeUInt16BE(type & 0xffff, 0);
  const crcBuf = Buffer.alloc(2); crcBuf.writeUInt16BE(crc16modbus(Buffer.concat([tp, body])), 0);
  const len = Buffer.alloc(2); len.writeUInt16BE(2 + body.length + 2, 0);
  return Buffer.concat([Buffer.from([MAGIC0, MAGIC1]), len, tp, body, crcBuf]);
}

/**
 * Decode ONE frame at the start of `buf`.
 * @returns {null | {need:true} | {ok:boolean, size:number, type?:number, payload?:Buffer, reason?:string}}
 *   null = no frame starts here; need = incomplete.
 */
function decodeSnFrame(buf, maxLen = 65535) {
  if (buf.length < 2) return { need: true };
  if (buf[0] !== MAGIC0 || buf[1] !== MAGIC1) return null;
  if (buf.length < 4) return { need: true };
  const len = buf.readUInt16BE(2);
  if (len < 4 || len > maxLen) return { ok: false, size: 2, reason: `implausible length ${len}` };
  if (buf.length < 4 + len) return { need: true };
  const type = buf.readUInt16BE(4);
  const payload = buf.subarray(6, 4 + len - 2);
  const want = buf.readUInt16BE(4 + len - 2);
  const got = crc16modbus(buf.subarray(4, 4 + len - 2));
  if (want !== got) return { ok: false, size: 2, type, reason: `bad CRC (got ${hex4(got)}, frame says ${hex4(want)})` };
  return { ok: true, size: 4 + len, type, payload };
}

function hex4(n) { return `0x${n.toString(16).padStart(4, '0')}`; }

/** Every whole, CRC-valid SN frame in a capture (detect / file input). */
function scanSnFrames(buf) {
  const b = toBuffer(buf);
  const out = [];
  let bad = 0;
  let i = 0;
  while (i < b.length - 1) {
    if (b[i] !== MAGIC0 || b[i + 1] !== MAGIC1) { i++; continue; }
    const d = decodeSnFrame(b.subarray(i));
    if (d && d.ok) { out.push({ type: d.type, payload: d.payload }); i += d.size; continue; }
    if (d && d.ok === false && d.type !== undefined) bad++;
    i++;
  }
  return { frames: out, bad };
}

/** "https://example.com/path/Patient" → "Patient"; else fhir.resourceType. */
function resourceName(json) {
  if (!json || typeof json !== 'object') return null;
  const u = typeof json.url === 'string' ? json.url.split(/[?#]/)[0].replace(/\/+$/, '') : '';
  const seg = u ? u.slice(u.lastIndexOf('/') + 1) : '';
  if (seg) return seg;
  const f = json.fhir || json.resource || json;
  return (f && typeof f.resourceType === 'string' && f.resourceType) || null;
}

function frameId(json) {
  if (!json || typeof json !== 'object') return '';
  const v = json.id ?? (json.fhir && json.fhir.id);
  return v == null ? '' : String(v);
}

class SinocareReceiver extends EventEmitter {
  /**
   * @param {object} o
   * @param {(b:Buffer)=>void} [o.write]
   * @param {'none'|'echo'} [o.replyMode]
   * @param {string} [o.ackJson]   reply payload template ({{id}} placeholder)
   */
  constructor({ write, replyMode = 'none', ackJson = DEFAULT_ACK_JSON, maxBytes = 256 * 1024, context = null, now = () => Date.now() } = {}) {
    super();
    this.write = write;
    this.replyMode = replyMode === 'echo' ? 'echo' : 'none';
    this.ackJson = typeof ackJson === 'string' && ackJson.trim() ? ackJson : DEFAULT_ACK_JSON;
    this.maxBytes = maxBytes;
    this.buf = Buffer.alloc(0);
    // Shared across this instrument's connections when the caller passes one
    // (the iCARE opens a fresh TCP connection between frames).
    this.context = context || newContext();
    this.now = now;
  }

  feed(data) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, toBuffer(data)]) : Buffer.from(toBuffer(data));
    for (;;) {
      const s = this.buf.indexOf('SN', 0, 'latin1');
      if (s < 0) {
        // Keep a trailing 'S' — the 'N' may be in the next chunk.
        this.buf = this.buf.length && this.buf[this.buf.length - 1] === MAGIC0 ? this.buf.subarray(this.buf.length - 1) : Buffer.alloc(0);
        return;
      }
      if (s > 0) this.buf = this.buf.subarray(s);
      const d = decodeSnFrame(this.buf);
      if (!d || d.need) {
        if (this.buf.length > this.maxBytes) { this.buf = Buffer.alloc(0); this.emit('overflow'); }
        return;
      }
      if (!d.ok) {
        this.emit('frame', { kind: 'sinocare-sn', ok: false, reason: d.reason, type: d.type });
        this.buf = this.buf.subarray(d.size);   // resync past this "SN"
        continue;
      }
      this.buf = this.buf.subarray(d.size);
      this._deliver(d.type, d.payload);
    }
  }

  _deliver(type, payload) {
    const text = payload.toString('utf8');
    let body = null;
    try { body = JSON.parse(text); } catch { /* keep null — still shown */ }
    const resource = body ? resourceName(body) : null;
    this.emit('frame', { kind: 'sinocare-sn', ok: true, type, resource, length: payload.length, json: body !== null, replied: this.replyMode === 'echo' && !!this.write });
    if (this.replyMode === 'echo' && this.write) {
      const id = JSON.stringify(frameId(body)).slice(1, -1);
      this.write(encodeSnFrame(type, this.ackJson.split('{{id}}').join(id)));
    }
    const ctx = this.context;
    const t = this.now();
    // A Patient older than CONTEXT_TTL_MS is stale — never pair it with a result.
    if (ctx.patientAt && t - ctx.patientAt > CONTEXT_TTL_MS) { ctx.patient = null; ctx.patients = {}; ctx.patientAt = 0; }
    const env = { sinocare: 1, type, resource, body, context: { patient: ctx.patient, patients: { ...ctx.patients }, device: ctx.device } };
    if (body === null) env.text = text;
    // Remember context for the frames that follow (Observation after Patient).
    const r = (resource || '').toLowerCase();
    const res = (body && body.fhir) || body;
    if (r === 'patient' && res && typeof res === 'object') {
      ctx.patient = res; ctx.patientAt = t;
      const pos = res.extension && res.extension.position;
      if (pos != null && String(pos) !== '') ctx.patients[String(pos)] = res;
    } else if (r === 'device') ctx.device = res;
    this.emit('message', JSON.stringify(env));
  }

  /** New connection: drop a half frame; the patient context stays. */
  reset() { this.buf = Buffer.alloc(0); }
  close() { this.buf = Buffer.alloc(0); }
}

module.exports = { SinocareReceiver, newContext, crc16modbus, encodeSnFrame, decodeSnFrame, scanSnFrames, resourceName, DEFAULT_ACK_JSON };
