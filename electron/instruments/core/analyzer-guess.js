'use strict';
/**
 * "Which analyzer is this?" from the ONE header a message gives up — a JS
 * mirror of prefrontal-mw `Services/Bridges/AnalyzerGuess.cs` (same token
 * table, same order, same OUI table, same first-hit-wins rule; keep the two
 * in step). Pure; never reads results, only header text:
 *   HL7  MSH-3 (sending application), MSH-4 (sending facility)
 *   ASTM H-5 (sender name / id, e.g. "XN-350^00-22^11001^^^^12345678"), H-13 (version)
 * plus a MAC-OUI vendor hint from the ARP table.
 *
 * On top of the mirrored table (desktop only, never sent anywhere): the two
 * opt-in presets are named from the PROTOCOL detect found, since those
 * analyzers carry no HL7/ASTM header at all.
 */

// [token, make, model, profileKey] — matched case-insensitively (contains).
const TABLE = [
  ['XN-350', 'Sysmex', 'XN-350', 'sysmex-xn-cbc'],
  ['XN-1000', 'Sysmex', 'XN-1000', 'sysmex-xn-cbc'],
  ['XN-550', 'Sysmex', 'XN-550', 'sysmex-xn-cbc'],
  ['XT-4000', 'Sysmex', 'XT-4000', 'sysmex-xn-cbc'],
  ['EM-200', 'Erba', 'EM-200', 'erba-em200-biochem'],
  ['EM-360', 'Erba', 'EM-360', 'erba-em200-biochem'],
  ['BS-200', 'Mindray', 'BS-200', 'mindray-bs-biochem'],
  ['BS-240', 'Mindray', 'BS-240', 'mindray-bs-biochem'],
  ['BC-5150', 'Mindray', 'BC-5150', 'mindray-bc-cbc'],
  ['BC-6800', 'Mindray', 'BC-6800', 'mindray-bc-cbc'],
  ['M51', 'Medonic', 'M51', 'medonic-m51-cbc'],
  ['COBAS', 'Roche', 'Cobas', 'roche-cobas'],
  ['ARCHITECT', 'Abbott', 'Architect', 'abbott-architect'],
];

const OUI = {
  '00:1B:2C': { make: 'Sysmex', label: 'Sysmex analyzer' },
  '00:50:C2': { make: 'Mindray', label: 'Mindray analyzer' },
};

const PROTOCOL_NAMES = {
  'lifedx-hbpro': { make: 'LifeDx', model: 'HBPro', label: 'LifeDx HBPro (HbA1c)' },
  'sinocare-fhir': { make: 'Sinocare', model: 'iCARE', label: 'Sinocare iCARE' },
};

const EMPTY = Object.freeze({ make: null, model: null, profileKey: null, label: null });

function matchToken(text) {
  if (!text || !String(text).trim()) return null;
  const up = String(text).toUpperCase();
  for (const [token, make, model, profileKey] of TABLE) if (up.includes(token.toUpperCase())) return { make, model, profileKey };
  return null;
}

/** "a4-2b-b0-1c-2d-3e" / "a4:2b:b0:1c:2d:3e" → "A4:2B:B0:1C:2D:3E". */
function normalizeMac(mac) {
  const hex = String(mac || '').replace(/[^0-9a-f]/gi, '');
  if (hex.length !== 12) return null;
  return hex.toUpperCase().match(/../g).join(':');
}

/**
 * @returns {{ make: string|null, model: string|null, profileKey: string|null, label: string|null }}
 */
function guess({ hl7SendingApp, hl7SendingFacility, astmSender, astmVersion, peerMac, protocol } = {}) {
  for (const c of [hl7SendingApp, hl7SendingFacility, astmSender, astmVersion]) {
    const hit = matchToken(c);
    if (hit) return { ...hit, label: `${hit.make} ${hit.model}` };
  }
  const mac = normalizeMac(peerMac);
  if (mac) {
    const v = OUI[mac.slice(0, 8)];
    if (v) return { make: v.make, model: null, profileKey: null, label: v.label };
  }
  const p = protocol && PROTOCOL_NAMES[protocol];
  if (p) return { make: p.make, model: p.model, profileKey: null, label: p.label };
  return { ...EMPTY };
}

/**
 * The header fields of a captured message text (HL7 or ASTM, already
 * unframed). Field indexes follow the standards: in "MSH|^~\&|APP|FAC|…"
 * MSH-1 is the "|" itself, so MSH-3 is split index 2; in "H|\^&|||SENDER|…"
 * H-5 is split index 4 and H-13 split index 12.
 */
function headerOf(text) {
  const out = { hl7SendingApp: null, hl7SendingFacility: null, astmSender: null, astmVersion: null };
  const lines = String(text || '').split(/\r\n|\r|\n/);
  for (const raw of lines) {
    const l = raw.replace(/^[\x00-\x1f]*[0-7]?(?=[HM])/, '');
    if (!out.hl7SendingApp && l.startsWith('MSH')) {
      const f = l.split(l[3] || '|');
      out.hl7SendingApp = (f[2] || '').split('^')[0].trim() || null;
      out.hl7SendingFacility = (f[3] || '').split('^')[0].trim() || null;
    } else if (!out.astmSender && /^H\|/.test(l)) {
      const f = l.split('|');
      out.astmSender = (f[4] || '').trim() || null;
      out.astmVersion = (f[12] || '').trim() || null;
    }
  }
  return out;
}

module.exports = { guess, headerOf, normalizeMac, TABLE, OUI };
