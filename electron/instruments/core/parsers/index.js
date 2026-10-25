'use strict';
/**
 * Parser dispatch. Every parser returns InstrumentMessage[]:
 *   { sampleId, instrumentSerial?, runAt?, qc, results: [{ code, value, unit, flags[], rawRecord }],
 *     images: [{ code, label, format, base64 }], raw, protocol }
 */
const { parseAstm } = require('./astm');
const { parseHl7, buildAck, redactEdImages } = require('./hl7');
const { parseText, TEXT_DEFAULTS } = require('./text');
const { parseHbpro } = require('./lifedx-hbpro');
const { parseSinocare } = require('./sinocare-fhir');

/** Guess the message protocol from reassembled text (no link framing). */
function sniffProtocol(text) {
  const t = String(text);
  if (/(^|[\r\n\x0b])MSH\|/.test(t)) return 'hl7';
  if (/(^|[\r\n])[0-7]?H\|[^\r\n]{3}/.test(t) && /(^|[\r\n])[0-7]?[RO]\|/.test(t)) return 'astm';
  return 'text';
}

/**
 * @param {string} text        reassembled message text
 * @param {object} parserCfg   { type: 'auto'|'astm'|'hl7'|'text'|'lifedx-hbpro'|'sinocare-fhir', astm?, hl7?, text?, hbpro?, sinocare? }
 * @param {{link?:string}} [hint]  link that delivered it (astm-e1381 ⇒ astm, mllp ⇒ hl7)
 */
function parseMessage(text, parserCfg = {}, hint = {}) {
  let type = (parserCfg && parserCfg.type) || 'auto';
  if (type === 'auto') {
    if (hint.link === 'astm-e1381') type = 'astm';
    else if (hint.link === 'mllp') type = 'hl7';
    else if (hint.link === 'sinocare-sn') type = 'sinocare-fhir';
    else type = sniffProtocol(text);
  }
  const shared = parserCfg && parserCfg.qcPattern ? { qcPattern: parserCfg.qcPattern } : {};
  switch (type) {
    case 'astm': return parseAstm(text, { ...shared, ...(parserCfg.astm || {}) });
    case 'hl7': return parseHl7(text, { ...shared, ...(parserCfg.hl7 || {}) });
    // Opt-in presets (explicit parser.type only — sniffing never returns these).
    case 'lifedx-hbpro': return parseHbpro(text, { ...(parserCfg.hbpro || {}) });
    case 'sinocare-fhir': return parseSinocare(text, { ...(parserCfg.sinocare || {}) });
    default: return parseText(text, { ...(parserCfg.text || {}) });
  }
}

/**
 * The text that should actually be forwarded to mw as `raw`: every embedded
 * image's base64 payload redacted to a short placeholder, so a message with
 * images never blows past the server's raw-size cap (images travel in
 * message.images instead). Protocol-specific — only HL7 has ED segments
 * today; ASTM/text pass through unchanged — but dispatched the same way
 * parseMessage is, so a future embedded-document protocol plugs in here too.
 * @param {string} text
 * @param {string} protocol  'hl7' | 'astm' | 'text'
 */
function redactForUpload(text, protocol) {
  if (protocol === 'hl7') return redactEdImages(text);
  return text;
}

module.exports = { parseMessage, sniffProtocol, buildAck, redactForUpload, TEXT_DEFAULTS };
