'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseHbpro } = require('../core/parsers/lifedx-hbpro');

const vals = (m) => Object.fromEntries(m.results.map((r) => [r.code, r.value]));

// Real record shape from the analyzer (names replaced). Screen: HbA1a 0.9, HbA1b 1.4,
// HbF 0.9, LA1c+ 3.1, HbA1c 11.0, HbA0 85.6, eAG 14.8 mmol/L / 268.0 mg/dl.
const SHORT = 'S04----14S TESTPAT 29 F032905121102610231140531518253351760.00130.00300.00140.00280.00750.250000.06500.10500.06700.22900.81507.62800.901.400.903.111.085.6096.314.8268.02000.00000.00000.0000';

test('built-in layout reads the screen values (short ID text)', () => {
  const [m] = parseHbpro(SHORT);
  assert.deepStrictEqual(vals(m), { HbA1a: '0.9', HbA1b: '1.4', HbF: '0.9', 'LA1c+': '3.1', HbA1c: '11.0', HbA0: '85.6', 'HbA1c-IFCC': '96.3', 'eAG-mmol': '14.8', eAG: '268.0' });
  assert.strictEqual(m.results.find((r) => r.code === 'HbA1c').unit, '%');
});

test('built-in layout follows a longer ID text (values shift with the name)', () => {
  const rec = fs.readFileSync(path.join(__dirname, 'fixtures', 'lifedx-hbpro-record.txt'), 'utf8');
  const [m] = parseHbpro(rec);
  const v = vals(m);
  assert.strictEqual(v.HbA1c, '5.7');
  assert.strictEqual(v['HbA1c-IFCC'], '38.6');
  assert.strictEqual(v['eAG-mmol'], '6.4');
  assert.strictEqual(v.eAG, '116.4');
});

test('an all-digit ID is the tube number; a name is not', () => {
  const withTube = SHORT.replace('S TESTPAT 29 F', '261000013');
  assert.strictEqual(parseHbpro(withTube)[0].sampleId, '261000013');
  assert.strictEqual(vals(parseHbpro(withTube)[0]).HbA1c, '11.0');
  assert.strictEqual(parseHbpro(SHORT)[0].sampleId, '14');
});

test('lab-entered absolute positions still win over the built-in layout', () => {
  const [m] = parseHbpro(SHORT, { fields: 'X 146 150 %' });
  assert.deepStrictEqual(vals(m), { X: '11.0' });
});
