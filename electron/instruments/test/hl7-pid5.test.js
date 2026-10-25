'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseHl7 } = require('../core/parsers/hl7');

const msg = (pid) => ['MSH|^~\\&|||||20261024182301||ORU^R01|1|P|2.3.1', pid, 'PV1|1',
  'OBR|1||26703|01001^Automated Count^99MRC||20261024182150|20261024182150',
  'OBX|1|NM|6690-2^WBC^LN||8.26|10*3/uL|||||F'].join('\r');

test('PID-5: tube number typed into the analyzer Name box (given-name part)', () => {
  const [m] = parseHl7(msg('PID|1||||^261000013'), { sampleIdField: 'PID-5' });
  assert.strictEqual(m.sampleId, '261000013');
});
test('PID-5: falls back to PID-3, then OBR-3', () => {
  assert.strictEqual(parseHl7(msg('PID|1||261000013^^^^MR'), { sampleIdField: 'PID-5' })[0].sampleId, '261000013');
  assert.strictEqual(parseHl7(msg('PID|1'), { sampleIdField: 'PID-5' })[0].sampleId, '26703');
});
test('PID-3 behaviour unchanged when PID-3 is empty (no name fallback)', () => {
  assert.strictEqual(parseHl7(msg('PID|1||||^261000013'), { sampleIdField: 'PID-3' })[0].sampleId, '26703');
});
