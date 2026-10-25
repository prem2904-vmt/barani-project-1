'use strict';
/**
 * Listen-mode auto-detection. Given bytes captured from an unknown analyzer,
 * work out the link framing (ASTM E1381 / MLLP / raw) and message protocol
 * (ASTM E1394 / HL7 v2 / text), propose a { link, parser } config and show
 * what that config would parse.
 */
const { C, toBuffer } = require('./bytes');
const { decodeFrame } = require('./link/astm-e1381');
const { parseMessage, sniffProtocol, TEXT_DEFAULTS } = require('./parsers');
const { parseAstm } = require('./parsers/astm');
const { StxEtxReceiver } = require('./link/stx-etx');
const { SinocareReceiver, scanSnFrames } = require('./link/sinocare-sn');

/** HBPro-style record: type letter + 2 digits, then a 6-char sample field. */
const HBPRO_RECORD = /^[A-Z]\d{2}[-A-Za-z0-9 ]{6}\S/;

/**
 * Message texts the opt-in links would deliver from a capture, in order
 * ('stx-etx' → record bodies, deduped like the link; 'sinocare-sn' → JSON
 * envelopes with their patient context). Pure — nothing is written back.
 */
function optInFrames(raw, link) {
  const buf = toBuffer(raw);
  const out = [];
  const rx = link === 'sinocare-sn' ? new SinocareReceiver({}) : link === 'stx-etx' ? new StxEtxReceiver({ ack: false }) : null;
  if (!rx) return out;
  rx.on('message', (t) => out.push(t));
  rx.feed(buf);
  return out;
}

/** Bodies of bare <STX>…<ETX> frames with no CR/LF inside (no E1381 FN/checksum trailer). */
function bareStxEtxBodies(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const s = buf.indexOf(C.STX, i);
    if (s < 0) break;
    const e = buf.indexOf(C.ETX, s + 1);
    if (e < 0) break;
    const body = buf.subarray(s + 1, e).toString('latin1');
    const after = buf.subarray(e + 1, e + 5).toString('latin1');
    if (!/[\r\n\x02]/.test(body) && !/^[0-9A-Fa-f]{2}\r\n/.test(after) && body.trim().length >= 8) out.push(body);
    i = e + 1;
  }
  return out;
}

/**
 * The opt-in analyzers (only when the classic detection found nothing):
 * Sinocare SN frames with a valid CRC, or LifeDx HBPro STX/ETX records.
 * Returns null when neither fits — the classic result then stands untouched.
 */
function detectOptIn(buf) {
  if (buf.includes('SN', 0, 'latin1')) {
    const sc = scanSnFrames(buf);
    if (sc.frames.length) {
      const reasons = [`${sc.frames.length} Sinocare SN frame(s) with a valid CRC-16${sc.bad ? `, ${sc.bad} with a bad CRC` : ''}`];
      const texts = optInFrames(buf, 'sinocare-sn');
      const kinds = texts.map((t) => { try { return JSON.parse(t).resource; } catch { return null; } }).filter(Boolean);
      if (kinds.length) reasons.push(`resources: ${[...new Set(kinds)].join(', ')}`);
      const parser = { type: 'sinocare-fhir', sinocare: { sampleIdField: 'medicalRecordNo' } };
      const messages = texts.flatMap((t) => parseMessage(t, parser, { link: 'sinocare-sn' }));
      if (!messages.length) reasons.push('no result (Observation) frame yet — the device waits for a server reply; try reply mode "echo"');
      return { protocol: 'sinocare-fhir', link: 'sinocare-sn', confidence: messages.length ? 0.95 : 0.85, reasons, proposed: { link: { type: 'sinocare-sn', replyMode: 'none' }, parser }, messages, text: texts.join('\n') };
    }
  }
  if (buf.includes(C.STX) && buf.includes(C.ETX)) {
    const bodies = bareStxEtxBodies(buf);
    const hb = bodies.filter((b) => HBPRO_RECORD.test(b));
    if (hb.length) {
      const uniq = new Set(hb).size;
      const reasons = [`${hb.length} <STX>…<ETX> record(s) without frame number / checksum${uniq < hb.length ? ` (${hb.length - uniq} retransmit(s) — the analyzer is waiting for an <ACK>)` : ''}`, 'fixed-width record like the LifeDx HBPro — result positions still need to be set'];
      const parser = { type: 'lifedx-hbpro', hbpro: { fields: [] } };
      const texts = optInFrames(buf, 'stx-etx');
      const messages = texts.flatMap((t) => parseMessage(t, parser, { link: 'stx-etx' }));
      return { protocol: 'lifedx-hbpro', link: 'stx-etx', confidence: 0.7, reasons, proposed: { link: { type: 'stx-etx' }, parser }, messages, text: texts.join('\n') };
    }
  }
  return null;
}

/** Pull E1381 frames out of a raw capture → { text, frames, badChecksums }. */
function unframeAstm(buf) {
  let text = '';
  let frames = 0;
  let bad = 0;
  let i = 0;
  while (i < buf.length) {
    if (buf[i] !== C.STX) { i++; continue; }
    // Frame ends at the first CR LF preceded by ETX/ETB + 2 chars.
    let j = i + 1;
    let end = -1;
    while (j < buf.length - 1) {
      if (buf[j] === C.CR && buf[j + 1] === C.LF && j - 3 > i && (buf[j - 3] === C.ETX || buf[j - 3] === C.ETB)) { end = j + 2; break; }
      j++;
    }
    if (end < 0) break;
    const d = decodeFrame(buf.subarray(i, end));
    frames++;
    if (d.ok) text += d.text; else bad++;
    i = end;
  }
  return { text, frames, bad };
}

/** Pull MLLP blocks out → joined text of every VT…FS block. */
function unframeMllp(buf) {
  const parts = [];
  let i = 0;
  while (i < buf.length) {
    const s = buf.indexOf(C.VT, i);
    if (s < 0) break;
    const e = buf.indexOf(C.FS, s + 1);
    if (e < 0) { parts.push(buf.subarray(s + 1).toString('latin1')); break; }
    parts.push(buf.subarray(s + 1, e).toString('latin1'));
    i = e + 1;
  }
  return parts;
}

/**
 * @param {Buffer|string} raw  captured bytes
 * @returns {{ protocol, link, confidence, reasons: string[], proposed: {link, parser}, messages: object[], text: string }}
 */
function detect(raw) {
  const buf = toBuffer(raw);
  const reasons = [];
  let link = 'raw';
  let text = buf.toString('latin1');
  let linkScore = 0;
  let mllpBlocks = null;

  const hasEnq = buf.includes(C.ENQ);
  const hasStx = buf.includes(C.STX);
  const hasVt = buf.includes(C.VT);
  const hasFs = buf.includes(C.FS);

  if (hasStx) {
    const u = unframeAstm(buf);
    if (u.frames > 0) {
      link = 'astm-e1381';
      text = u.text;
      linkScore = u.bad === 0 ? 0.5 : 0.35;
      reasons.push(`${u.frames} ASTM E1381 frame(s)${u.bad ? `, ${u.bad} with a bad checksum` : ', checksums valid'}`);
      if (hasEnq) { linkScore += 0.1; reasons.push('ENQ/EOT handshake seen'); }
    }
  }
  if (link === 'raw' && hasVt && hasFs) {
    mllpBlocks = unframeMllp(buf);
    link = 'mllp';
    text = mllpBlocks.join('\r');
    linkScore = 0.5;
    reasons.push(`${mllpBlocks.length} MLLP block(s) (VT … FS CR)`);
  }
  if (link === 'raw') reasons.push('no link framing — plain text stream');

  const protocol = sniffProtocol(text);
  let protoScore = 0;
  const parser = { type: protocol };
  if (protocol === 'hl7') {
    protoScore = 0.4;
    reasons.push('MSH segment found (HL7 v2)');
    const withObr3 = /(^|\r|\n)OBR\|[^|\r\n]*\|[^|\r\n]*\|[^|\r\n]+/.test(text);
    parser.hl7 = { sampleIdField: withObr3 ? 'OBR-3' : (/(^|\r|\n)SPM\|/.test(text) ? 'SPM-2' : 'OBR-2') };
    reasons.push(`sample ID in ${parser.hl7.sampleIdField}`);
  } else if (protocol === 'astm') {
    protoScore = 0.4;
    reasons.push('H/O/R records found (ASTM E1394)');
    // Which O field holds the barcode? Prefer O.3, fall back to O.4.
    const o3 = parseAstm(text, { sampleIdField: 3 }).find((m) => m.sampleId);
    parser.astm = { sampleIdField: 3, sampleIdComponent: 1 };
    const oLine = String(text).split(/\r|\n/).find((l) => /^[0-7]?O\|/.test(l));
    if (oLine) {
      const f = oLine.replace(/^[0-7]/, '').split('|');
      if (!(f[2] || '').split('^')[0].trim() && (f[3] || '').trim()) parser.astm.sampleIdField = 4;
    }
    if (!o3) reasons.push('no sample ID in O.3 — using O.4');
  } else {
    parser.text = { ...TEXT_DEFAULTS };
    const msgs = parseMessage(text, parser);
    const n = msgs.reduce((a, m) => a + m.results.length, 0);
    protoScore = n >= 5 ? 0.35 : n >= 2 ? 0.2 : 0;
    reasons.push(n ? `${n} line(s) match the default text template` : 'no line matches the default text template');
    if (!msgs.some((m) => m.sampleId)) reasons.push('no sample-ID line recognised — adjust the sample-ID pattern');
  }

  const unknown = protoScore === 0;
  // Nothing classic fits → maybe one of the opt-in analyzers (suggest only).
  if (unknown && link === 'raw') { const o = detectOptIn(buf); if (o) return o; }
  const messages = protoScore > 0 ? parseMessage(text, parser, { link }) : [];
  const confidence = unknown ? 0 : Math.min(0.99, +(linkScore + protoScore + (messages.some((m) => m.results.length) ? 0.1 : 0)).toFixed(2));
  const linkCfg = { type: link };
  if (link === 'raw') { linkCfg.idleMs = 1500; }

  return {
    protocol: unknown ? 'unknown' : protocol,
    link,
    confidence,
    reasons,
    proposed: { link: linkCfg, parser },
    messages,
    text,
  };
}

module.exports = { detect, unframeAstm, unframeMllp, optInFrames };
