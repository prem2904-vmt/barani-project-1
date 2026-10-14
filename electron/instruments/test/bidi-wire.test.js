'use strict';
/**
 * Canonical wire bytes for two-way replies. test/fixtures/bidi-wire.json maps
 * inputs → exact reply strings (CR = \r). The SAME file is tested by the Pi
 * Bridge, so both hosts must emit identical bytes. Times are rendered in the
 * host's local zone (the fixture pins Asia/Kolkata). To regenerate after a
 * deliberate format change: UPDATE_WIRE=1 node --test test/bidi-wire.test.js
 * (and copy the file to the Bridge repo).
 */
process.env.TZ = 'Asia/Kolkata';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const A = require('../core/bidi/astm');
const H = require('../core/bidi/hl7');

const FILE = path.join(__dirname, 'fixtures', 'bidi-wire.json');
const NOW = new Date('2026-10-14T06:30:00Z');

const PATIENT = { id: 'P-1', name: 'Ann Q|Rs^t&u\\v~w', sex: 'F', dob: '1980-01-31', ageYears: 46 };
const DTO = (over = {}) => ({
  sampleId: '260100001', found: true, priority: 'normal', collectedAt: '2026-10-14T05:10:00Z', specimen: 'Serum', patient: null,
  tests: [{ code: 'GLU', testCatalogKey: 'BIO001', name: 'Glucose' }, { code: 'UREA', testCatalogKey: 'BIO002', name: 'Urea' }], unmapped: [], ...over,
});
const QRY = (app, id) => `MSH|^~\\&|${app}|LAB|LIS|HOST|20261014100000||QRY^Q02|77|P|2.3.1\rQRD|20261014100000|R|D|9|||1^RD|${id}|OTH|||T\rQRF|${app}\r`;
const QBP = 'MSH|^~\\&|AU|LAB|LIS|HOST|20261014100000||QBP^Q11^QBP_Q11|88|P|2.5.1\rQPD|WOS^Work Order Step^IHE_LABTF|TAG7|260100001\rRCP|I||R\r';
const ASTM_Q = 'H|\\^&|||BS^1.0\rQ|1|^260100001||^^^ALL||||||||O\rL|1\r';

/** name → { fn, input } ; `expected` is filled from / compared to the JSON file. */
const CASES = [
  { name: 'astm answer: urgent, patient sent, escaped name, query action A', fn: 'astm_orders', input: { orders: [DTO({ priority: 'urgent', patient: PATIENT })], sendPatient: true, actionCode: 'A' } },
  { name: 'astm answer: no patient (sendPatient off) — no P record', fn: 'astm_orders', input: { orders: [DTO({ patient: PATIENT })], sendPatient: false, actionCode: 'A' } },
  { name: 'astm worklist download: action N, two samples', fn: 'astm_orders', input: { orders: [DTO(), DTO({ sampleId: '260100002', tests: [{ code: 'CHOL', name: 'Cholesterol' }] })], sendPatient: false, actionCode: 'N' } },
  { name: 'astm not found / timeout with no cache: H, L|1|I', fn: 'astm_noinfo', input: { query: ASTM_Q } },
  { name: 'astm server refusal (409): H, Q echo X, L|1|Q', fn: 'astm_refused', input: { query: ASTM_Q } },
  { name: 'hl7 QCK^Q02 found', fn: 'hl7_qck', input: { query: QRY('BS-240', '260100001'), found: true } },
  { name: 'hl7 QCK^Q02 not found', fn: 'hl7_qck', input: { query: QRY('BS-240', '260100001'), found: false } },
  { name: 'hl7 DSR^Q03 mindray (auto from MSH-3 BS-240), patient, urgent', fn: 'hl7_dsr', input: { query: QRY('BS-240', '260100001'), dto: DTO({ priority: 'urgent', patient: PATIENT }), sendPatient: true } },
  { name: 'hl7 DSR^Q03 mindray, no patient', fn: 'hl7_dsr', input: { query: QRY('BS-240', '260100001'), dto: DTO(), sendPatient: false } },
  { name: 'hl7 DSR^Q03 autolab (auto from MSH-3), patient', fn: 'hl7_dsr', input: { query: QRY('Autolab', '260100001'), dto: DTO({ patient: PATIENT }), sendPatient: true } },
  { name: 'hl7 DSR^Q03 generic (unknown analyzer)', fn: 'hl7_dsr', input: { query: QRY('XYZ-1', '260100001'), dto: DTO({ patient: PATIENT }), sendPatient: true } },
  { name: 'hl7 DSR^Q03 dialect override beats auto-pick', fn: 'hl7_dsr', input: { query: QRY('BS-240', '260100001'), dto: DTO(), sendPatient: false, dialect: 'autolab' } },
  { name: 'hl7 RSP^K11 found, patient, urgent', fn: 'hl7_rsp', input: { query: QBP, dto: DTO({ priority: 'urgent', patient: PATIENT }), sendPatient: true } },
  { name: 'hl7 RSP^K11 not found', fn: 'hl7_rsp', input: { query: QBP, dto: null, sendPatient: false } },
  { name: 'hl7 worklist ORM^O01 no patient', fn: 'hl7_worklist', input: { dto: DTO(), type: 'orm_o01', sendPatient: false } },
  { name: 'hl7 worklist OML^O21 patient, urgent', fn: 'hl7_worklist', input: { dto: DTO({ priority: 'urgent', patient: PATIENT }), type: 'oml_o21', sendPatient: true } },
];

function render(c) {
  const i = c.input;
  switch (c.fn) {
    case 'astm_orders': return A.buildAstmOrders(i.orders, A.DEFAULT_DELIMS, { sendPatient: i.sendPatient, actionCode: i.actionCode, now: NOW, sender: 'PrefrontalLIS', receiver: '' });
    case 'astm_noinfo': return A.buildAstmNoInfo(A.parseAstmQueries(i.query).queries[0], A.DEFAULT_DELIMS, { now: NOW, sender: 'PrefrontalLIS', receiver: 'BS' });
    case 'astm_refused': return A.buildAstmRefused(A.parseAstmQueries(i.query).queries[0], A.DEFAULT_DELIMS, { now: NOW, sender: 'PrefrontalLIS', receiver: 'BS' });
    case 'hl7_qck': return H.buildQck(H.classifyHl7(i.query), i.found, { now: NOW, ctrl: 'CTRL1' });
    case 'hl7_dsr': return H.buildDsr(H.classifyHl7(i.query), i.dto, { now: NOW, ctrl: 'CTRL2', sendPatient: i.sendPatient, dialect: i.dialect });
    case 'hl7_rsp': return H.buildRsp(H.classifyHl7(i.query), i.dto, { now: NOW, ctrl: 'CTRL3', sendPatient: i.sendPatient });
    case 'hl7_worklist': return H.buildWorklistMessage(i.dto, { now: NOW, ctrl: 'CTRL4', type: i.type, sendPatient: i.sendPatient }).text;
    default: throw new Error(c.fn);
  }
}

if (process.env.UPDATE_WIRE) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({
    note: 'Canonical two-way reply bytes. CR is \\r. Local-time fields use TZ=Asia/Kolkata; now = 2026-10-14T06:30:00Z. Shared with the Pi Bridge tests.',
    tz: 'Asia/Kolkata', now: NOW.toISOString(),
    cases: CASES.map((c) => ({ ...c, expected: render(c) })),
  }, null, 2) + '\n');
}

const fixture = JSON.parse(fs.readFileSync(FILE, 'utf8'));

test('wire fixture covers every case the code defines', () => {
  assert.deepEqual(fixture.cases.map((c) => c.name), CASES.map((c) => c.name));
});

for (const c of fixture.cases) {
  test(`wire bytes: ${c.name}`, () => {
    const live = CASES.find((x) => x.name === c.name);
    assert.deepEqual(live.input, c.input, 'fixture inputs unchanged');
    assert.equal(render(c), c.expected);
  });
}
