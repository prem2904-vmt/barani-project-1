'use strict';
/**
 * ONE text-template default: the wizard (apps/lms …/instrument-config.ts)
 * must write exactly the patterns the connector core runs by default
 * (core/parsers/text.js TEXT_DEFAULTS). A drift once made every wizard-created
 * instrument read the ticket line "SAMPLE ID: 2609-00013" as the sample "ID:".
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { TEXT_DEFAULTS, parseText } = require('../core/parsers/text');
const { textMessage } = require('../sim/dialects');

const TS = path.join(__dirname, '../../../apps/lms/src/app/shared/instruments/instrument-config.ts');

function uiConst(name) {
  const src = fs.readFileSync(TS, 'utf8');
  const m = new RegExp(`export const ${name} = ('(?:[^'\\\\]|\\\\.)*');`).exec(src);
  assert.ok(m, `${name} not found in instrument-config.ts`);
  return Function(`"use strict"; return ${m[1]};`)();   // evaluate the TS string literal
}

const UI = {
  linePattern: uiConst('DEFAULT_TEXT_LINE_PATTERN'),
  sampleIdPattern: uiConst('DEFAULT_TEXT_SAMPLE_ID_PATTERN'),
  qcPattern: uiConst('DEFAULT_TEXT_QC_PATTERN'),
};

test('wizard text defaults are identical to the connector core defaults', () => {
  assert.deepEqual(UI, { linePattern: TEXT_DEFAULTS.linePattern, sampleIdPattern: TEXT_DEFAULTS.sampleIdPattern, qcPattern: TEXT_DEFAULTS.qcPattern });
});

test('wizard defaults read "SAMPLE ID: 2609-00013" tickets (sim 3-part + hand-written variants)', () => {
  const sim = parseText(textMessage({ sampleId: '2609-00013', run: 1 }).text.replace(/\f$/, ''), UI);
  assert.equal(sim.length, 1);
  assert.equal(sim[0].sampleId, '2609-00013');
  assert.ok(sim[0].results.some((r) => r.code === 'WBC'), 'results parsed');
  assert.equal(sim[0].qc, false);

  for (const [line, id] of [['SAMPLE ID: 2609-00013', '2609-00013'], ['Sample ID 2609-00013', '2609-00013'],
    ['SAMPLE NO. 2609-00013', '2609-00013'], ['ID# 2609-00013', '2609-00013'], ['SPECIMEN: ABC-7', 'ABC-7']]) {
    const [m] = parseText(`${line}\r\nWBC 7.8 10^3/uL H\r\nHGB 14.2 g/dL\r\n`, UI);
    assert.equal(m.sampleId, id, line);
    assert.deepEqual(m.results.map((r) => [r.code, r.value, r.flags]), [['WBC', '7.8', ['H']], ['HGB', '14.2', []]], line);
  }

  const [qc] = parseText(textMessage({ sampleId: 'QC-L1-24117', run: 1, qc: true }).text.replace(/\f$/, ''), UI);
  assert.equal(qc.qc, true);
});
