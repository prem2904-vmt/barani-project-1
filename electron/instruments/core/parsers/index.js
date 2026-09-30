'use strict';
/**
 * Parser dispatch. Every parser returns InstrumentMessage[]:
 *   { sampleId, instrumentSerial?, runAt?, qc, results: [{ code, value, unit, flags[], rawRecord }], raw, protocol }
 */
const { parseAstm } = require('./astm');
const { parseHl7, buildAck } = require('./hl7');
const { parseText, TEXT_DEFAULTS } = require('./text');

/** Guess the message protocol from reassembled text (no link framing). */
function sniffProtocol(text) {
  const t = String(text);
  if (/(^|[\r\n\x0b])MSH\|/.test(t)) return 'hl7';
  if (/(^|[\r\n])[0-7]?H\|[^\r\n]{3}/.test(t) && /(^|[\r\n])[0-7]?[RO]\|/.test(t)) return 'astm';
  return 'text';
}

/**
 * @param {string} text        reassembled message text
 * @param {object} parserCfg   { type: 'auto'|'astm'|'hl7'|'text', astm?, hl7?, text? }
 * @param {{link?:string}} [hint]  link that delivered it (astm-e1381 ⇒ astm, mllp ⇒ hl7)
 */
function parseMessage(text, parserCfg = {}, hint = {}) {
  let type = (parserCfg && parserCfg.type) || 'auto';
  if (type === 'auto') {
    if (hint.link === 'astm-e1381') type = 'astm';
    else if (hint.link === 'mllp') type = 'hl7';
    else type = sniffProtocol(text);
  }
  const shared = parserCfg && parserCfg.qcPattern ? { qcPattern: parserCfg.qcPattern } : {};
  switch (type) {
    case 'astm': return parseAstm(text, { ...shared, ...(parserCfg.astm || {}) });
    case 'hl7': return parseHl7(text, { ...shared, ...(parserCfg.hl7 || {}) });
    default: return parseText(text, { ...(parserCfg.text || {}) });
  }
}

module.exports = { parseMessage, sniffProtocol, buildAck, TEXT_DEFAULTS };
