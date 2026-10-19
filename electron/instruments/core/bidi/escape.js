'use strict';
/**
 * Delimiter escaping for text we SEND to an analyzer (names, ids, test
 * names can contain ^ | & \ ~ and line breaks). Receiving-side unescape lives
 * in the parsers.
 *
 *   ASTM E1394 (§6.? "escape delimiter"): field | repeat \ component ^ escape &
 *     value escapes: &F& field, &R& repeat, &S& component, &E& escape.
 *   HL7 v2 (ch. 2 "Escape sequences"): \F\ field, \S\ component, \T\
 *     sub-component, \R\ repeat, \E\ escape; line break → \.br\.
 * In both, CR/LF/other control characters can never appear inside a value —
 * they would end a record/segment — so they are folded to a space.
 */

const CTRL = /[\u0000-\u001f\u007f]/g;

/** @param {{field:string,repeat:string,component:string,escape:string}} d */
function astmEscape(value, d = { field: '|', repeat: '\\', component: '^', escape: '&' }) {
  if (value == null) return '';
  const s = String(value).replace(CTRL, ' ');
  let out = '';
  for (const ch of s) {
    if (ch === d.escape) out += `${d.escape}E${d.escape}`;
    else if (ch === d.field) out += `${d.escape}F${d.escape}`;
    else if (ch === d.repeat) out += `${d.escape}R${d.escape}`;
    else if (ch === d.component) out += `${d.escape}S${d.escape}`;
    else out += ch;
  }
  return out;
}

/** @param {{field:string,component:string,repeat:string,escape:string,sub:string}} e */
function hl7Escape(value, e = { field: '|', component: '^', repeat: '~', escape: '\\', sub: '&' }) {
  if (value == null) return '';
  const s = String(value).replace(/\r\n|\r|\n/g, `${e.escape}.br${e.escape}`).replace(CTRL, ' ');
  let out = '';
  // The \.br\ sequences we just inserted must survive: walk and skip them.
  const br = `${e.escape}.br${e.escape}`;
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith(br, i)) { out += br; i += br.length - 1; continue; }
    const ch = s[i];
    if (ch === e.escape) out += `${e.escape}E${e.escape}`;
    else if (ch === e.field) out += `${e.escape}F${e.escape}`;
    else if (ch === e.component) out += `${e.escape}S${e.escape}`;
    else if (ch === e.sub) out += `${e.escape}T${e.escape}`;
    else if (ch === e.repeat) out += `${e.escape}R${e.escape}`;
    else out += ch;
  }
  return out;
}

module.exports = { astmEscape, hl7Escape };
