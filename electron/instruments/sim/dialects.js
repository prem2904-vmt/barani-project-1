'use strict';
/**
 * Generic CBC analyzer "dialects" for the simulators. These are NOT vendor
 * formats — they are standards-shaped generic outputs used to prove the
 * connector end to end:
 *
 *   astm-5part  ASTM E1381 frames carrying E1394 H/P/O/R/C/L records
 *   hl7-5part   HL7 v2.3.1 ORU^R01 over MLLP (expects an ACK back)
 *   text-3part  a plain printed ticket (raw text, form-feed terminated)
 */
const { generateCbc } = require('./cbc-data');
const { generateChem } = require('./chem-data');

function ts(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** A long morphology comment (> 240 chars) forces ASTM ETB multi-frame records. */
const LONG_COMMENT = 'Peripheral smear review suggested: RBCs show mild anisocytosis with occasional microcytes and hypochromic cells; '
  + 'WBC morphology within normal limits, no blasts or atypical lymphocytes seen; platelets adequate on smear with no clumping; '
  + 'correlate clinically with iron studies if indicated.';

/**
 * @param {{sampleId:string, run?:number, qc?:boolean, serial?:string, at?:Date, variant?:string}} job
 */
function astmMessage(job) {
  const t = ts(job.at);
  const serial = job.serial || 'SIM5P0001';
  const results = generateCbc({ sampleId: job.sampleId, run: job.run, variant: '5part', profile: job.qc ? 'qc' : undefined });
  const recs = [
    `H|\\^&|||SIM-5P^1.0^${serial}|||||||${job.qc ? 'Q' : 'P'}|LIS2-A2|${t}`,
    job.qc ? 'P|1' : 'P|1||||^^||||||||||||||||||||||||||',
    `O|1|${job.sampleId}||^^^CBC\\^^^DIFF|R|${t}|||||${job.qc ? 'Q' : 'N'}||||||||||||||F`,
  ];
  results.forEach((r, i) => {
    recs.push(`R|${i + 1}|^^^${r.code}|${r.value}|${r.unit}||${r.flag || 'N'}||F||||${t}`);
    if (i === 0 && job.longComment !== false) recs.push(`C|1|I|${LONG_COMMENT}|G`);
  });
  recs.push('L|1|N');
  return { text: recs.join('\r') + '\r', results };
}

function hl7Message(job) {
  const t = ts(job.at);
  const ctrl = `SIM${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}`;
  const results = generateCbc({ sampleId: job.sampleId, run: job.run, variant: '5part', profile: job.qc ? 'qc' : undefined });
  const segs = [
    `MSH|^~\\&|SIM-HL7-5P|HAEM-${job.serial || '01'}|PREFRONTAL|LAB|${t}||ORU^R01|${ctrl}|P|2.3.1`,
    job.qc ? null : 'PID|1||||^',
    `OBR|1||${job.sampleId}|CBC^Complete Blood Count^L|||${t}`,
    job.qc ? `SPM|1|${job.sampleId}||BLD|||||||Q` : `SPM|1|${job.sampleId}||BLD`,
  ].filter(Boolean);
  results.forEach((r, i) => {
    // HL7 units are UCUM-style (10*3/uL): a literal '^' would split the CE field.
    segs.push(`OBX|${i + 1}|NM|${r.code}^${r.code}^L||${r.value}|${r.unit.replace('^', '*')}||${r.flag || 'N'}|||F|||${t}`);
  });
  return { text: segs.join('\r') + '\r', results, controlId: ctrl };
}

function textMessage(job) {
  const d = job.at || new Date();
  const results = generateCbc({ sampleId: job.sampleId, run: job.run, variant: '3part', profile: job.qc ? 'qc' : undefined });
  const lines = [
    'SIMLAB 3-PART HEMATOLOGY ANALYZER',
    `DATE ${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`,
    job.qc ? 'QC LEVEL 1  LOT 24117' : 'MODE WHOLE BLOOD',
    `SAMPLE ID: ${job.sampleId}`,
    '',
    ...results.map((r) => `${r.code.padEnd(8)}${r.value.padStart(7)}  ${r.unit.padEnd(8)}${r.flag || ''}`.trimEnd()),
    '',
  ];
  return { text: lines.join('\r\n') + '\f', results };
}

/** Chemistry analyzer result message (Autolab / Eurolab 200 style): one tube, many photometric tests. */
function astmChemMessage(job) {
  const t = ts(job.at);
  const results = generateChem({ sampleId: job.sampleId, tests: job.tests });
  const recs = [
    `H|\\^&|||SIM-CHEM^1.0^${job.serial || 'SIMCH0001'}|||||||P|LIS2-A2|${t}`,
    'P|1',
    `O|1|${job.sampleId}||${results.map((r) => `^^^${r.code}`).join('\\')}|R|${t}|||||N||||||||||||||F`,
  ];
  results.forEach((r, i) => recs.push(`R|${i + 1}|^^^${r.code}|${r.value}|${r.unit}||${r.flag || 'N'}||F||||${t}`));
  recs.push('L|1|N');
  return { text: recs.join('\r') + '\r', results };
}

function hl7ChemMessage(job) {
  const t = ts(job.at);
  const ctrl = `SIM${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}`;
  const results = generateChem({ sampleId: job.sampleId, tests: job.tests });
  const segs = [
    `MSH|^~\\&|SIM-CHEM|CHEM-${job.serial || '01'}|PREFRONTAL|LAB|${t}||ORU^R01|${ctrl}|P|2.3.1`,
    'PID|1||||^',
    `OBR|1||${job.sampleId}|CHEM^Chemistry^L|||${t}`,
  ];
  results.forEach((r, i) => segs.push(`OBX|${i + 1}|NM|${r.code}^${r.code}^L||${r.value}|${r.unit}||${r.flag || 'N'}|||F|||${t}`));
  return { text: segs.join('\r') + '\r', results, controlId: ctrl };
}

function lifedxHbproMessage(job) {
  const d = job.at || new Date();
  const sampleId = (job.sampleId || '26354').padEnd(16, ' ').slice(0, 16);
  const patient = (job.patient || 'Prem Kumar K').padEnd(20, ' ').slice(0, 20);
  const dateStr = d.toISOString().slice(0, 10).replace(/-/g, '/');
  const timeStr = d.toTimeString().slice(0, 8);
  const val = job.qc ? '5.3' : (job.variant === 'high' ? '13.8' : '7.2');
  const valPad = val.padStart(6, ' ');

  const STX = '\x02';
  const ETX = '\x03';
  const CR = '\r';
  const LF = '\n';

  let text = `${STX}S04${sampleId}${patient}${dateStr} ${timeStr}${CR}${LF}`;
  text += `HbA1c  ${valPad} %   (4.0 - 6.0)   HPLC${CR}${LF}`;
  text += `Peak A1a: 0.8%  Peak A1b: 1.2%  Peak F: 0.5%  Peak LA1c: 1.5%${CR}${LF}`;
  text += `Peak A0: 88.8%  Peak Area: 124500 uV*s${CR}${LF}`;
  text += `${ETX}${CR}${LF}`;

  const results = [
    { code: 'HBA1C', value: val, unit: '%', flag: parseFloat(val) > 6.4 ? 'H' : 'N' },
  ];
  return { text, results };
}

function sinocareFhirMessage(job) {
  const d = job.at || new Date();
  const sampleId = job.sampleId || '26354';
  const fhirPayload = {
    resourceType: 'Observation',
    id: `sim-obs-${sampleId}`,
    status: 'final',
    code: {
      coding: [{ system: 'http://loinc.org', code: '4548-4', display: 'Hemoglobin A1c/Hemoglobin.total in Blood' }],
      text: 'HbA1c',
    },
    subject: { reference: `Patient/${sampleId}`, display: 'Prem Kumar K' },
    effectiveDateTime: d.toISOString(),
    valueQuantity: { value: 7.2, unit: '%', system: 'http://unitsofmeasure.org', code: '%' },
    interpretation: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code: 'H', display: 'High' }] }],
  };

  const jsonStr = JSON.stringify(fhirPayload);
  const text = `SN\x01\x00${String.fromCharCode(jsonStr.length & 0xff)}${jsonStr}\x04`;
  const results = [
    { code: 'HBA1C', value: '7.2', unit: '%', flag: 'H' },
  ];
  return { text, results };
}

const DIALECTS = {
  'astm-chem': { build: astmChemMessage, link: 'astm-e1381', protocol: 'astm' },
  'hl7-chem': { build: hl7ChemMessage, link: 'mllp', protocol: 'hl7' },
  'astm-5part': { build: astmMessage, link: 'astm-e1381', protocol: 'astm' },
  'hl7-5part': { build: hl7Message, link: 'mllp', protocol: 'hl7' },
  'lifedx-hbpro': { build: lifedxHbproMessage, link: 'stx-etx', protocol: 'lifedx-hbpro' },
  'sinocare-fhir': { build: sinocareFhirMessage, link: 'sn-frame', protocol: 'sinocare-fhir' },
  'text-3part': { build: textMessage, link: 'raw', protocol: 'text' },
};

module.exports = { DIALECTS, astmChemMessage, hl7ChemMessage, astmMessage, hl7Message, lifedxHbproMessage, sinocareFhirMessage, textMessage, LONG_COMMENT, ts };
