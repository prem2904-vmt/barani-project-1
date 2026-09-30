import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { filterOrdersByWorkQuery } from '../../../features/frontdesk/frontdesk-landing/work-search';
import { filterOutsourced, OutsourcedTube } from '../../../features/frontdesk/outsourced/outsourced-view';
import { matchesQuery } from '../../../features/pathologist/pending-validation/pending-validation.logic';
import { Order, OrderTest } from '../../models/order.model';
import { labToday } from '../../utils/lab-clock';

/** The daily patient number on every lab screen (owner 2026-09-30): the
 *  "#12" chip sits before the patient's name, list searches find today's #12,
 *  and it is an on-screen aid ONLY — no print / PDF / label / message path
 *  ever reads it. */

const APP = 'apps/lms/src/app';
const src = (p: string) => readFileSync(`${APP}/${p}`, 'utf8');

/** Screen → [template source, the name markup the chip must precede]. */
const SCREENS: Array<[string, string, RegExp]> = [
  ['front desk work rows', 'features/frontdesk/frontdesk-landing/frontdesk-landing.component.html', /<p class="pf-wrow__name"><pf-daily-no \[of\]="o" \/>/g],
  ['front desk order drawer', 'features/frontdesk/frontdesk-landing/frontdesk-landing.component.html', /id="pf-od-name"><pf-daily-no/],
  ['order & payments', 'features/frontdesk/order-create/order-create.component.html', /<pf-daily-no \[of\]="order\(\)" \/>/],
  ['post-payment', 'features/frontdesk/post-payment/post-payment.component.html', /pf-sb-patient__name"><pf-daily-no/],
  ['billing counter queue', 'features/billing-counter/billing-counter.component.html', /pf-bc-qrow__name"><pf-daily-no/],
  ['outsourced', 'features/frontdesk/outsourced/outsourced-list.component.ts', /pf-out__who"><pf-daily-no/],
  ['collect queue', 'features/lab/sample-collection/sample-collection.component.html', /pf-sc__who-name"><pf-daily-no/],
  ['collect drawer', 'features/lab/sample-collection/sample-collection.component.html', /pf-sc-chip__name"><pf-daily-no/],
  ['lab intake', 'features/lab/receive-samples/receive-samples.component.ts', /pf-rs-row__patient"><pf-daily-no/],
  ['my work', 'features/lab/my-work/my-work.component.ts', /pf-tq__who"><pf-daily-no/],
  ['result entry', 'features/lab/result-entry/result-entry.component.ts', /pf-patient-bar__name"><pf-daily-no/],
  ['sample result entry', 'features/lab/sample-result-entry/sample-result-entry.component.html', /pf-sre-chip__name"><pf-daily-no/],
  ['culture bench', 'features/lab/culture-workbench/culture-workbench.component.ts', /title="Patient"><pf-daily-no/],
  ['pending validation', 'features/pathologist/pending-validation/pending-validation.component.ts', /pv-tile__who"><pf-daily-no/],
  ['validate result', 'features/pathologist/validate-result/validate-result.component.ts', /pf-railpat__name"><pf-daily-no/],
  ['report queue', 'features/reports/report-queue/report-queue.component.html', /pf-rq-card__name"><pf-daily-no/],
];

describe('daily patient number — on every lab screen', () => {
  it.each(SCREENS)('%s shows the chip before the name', (_n, file, re) => {
    expect(src(file)).toMatch(re);
  });

  it('every screen that uses the chip imports DailyNoComponent', () => {
    const tsOf = (f: string) => f.replace(/\.html$/, '.ts');
    for (const [, file] of SCREENS) expect(src(tsOf(file)), file).toMatch(/DailyNoComponent/);
  });

  it('the chip is the kit class: quiet, rounded, tabular — never violet or monospace', () => {
    const kit = src('shared/styles/_nd-kit.scss');
    const body = kit.slice(kit.indexOf('.nd-dayno {'), kit.indexOf('}', kit.indexOf('.nd-dayno {')));
    expect(body).toMatch(/border-radius: 999px/);
    expect(body).toMatch(/tabular-nums/);
    expect(body).toMatch(/var\(--nd-chip-bg\)/);
    expect(body).not.toMatch(/violet|mono/i);
  });
});

describe('daily patient number — list search finds today\'s #N', () => {
  const today = labToday();
  const order = (id: string, dailyNo: number, day = today) =>
    ({ id, dailyNo, dailyNoDay: day, patient: { displayName: 'Mr. P ' + id }, samples: [] } as unknown as Order);

  it('front desk work list', () => {
    const a = order('a', 12), b = order('b', 3), old = order('c', 12, '2020-01-01');
    expect(filterOrdersByWorkQuery([a, b, old], '12')).toEqual([a]);
    expect(filterOrdersByWorkQuery([a, b, old], '#3')).toEqual([b]);
  });

  it('outsourced tab', () => {
    const r = { sampleId: 's', orderId: 'o', patientId: 'p', patientName: 'Ms. Bhavna', status: 'outsourced',
      tests: [], dailyNo: 7, dailyNoDay: today } as unknown as OutsourcedTube;
    expect(filterOutsourced([r], { query: '7' } as never)).toEqual([r]);
    expect(filterOutsourced([r], { query: '8' } as never)).toEqual([]);
  });

  it('pending validation', () => {
    const t = { subOrder: { barcode: '26259', order: { dailyNo: 4, dailyNoDay: today, patient: { displayName: 'Mr. Arun' } } } } as unknown as OrderTest;
    expect(matchesQuery(t, '4')).toBe(true);
    expect(matchesQuery(t, '7')).toBe(false);   // (not in 26259 either)
  });
});

describe('daily patient number — never printed', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) files.push(p);
    }
  };
  walk(APP);
  const printing = files.filter(f => /jspdf|jsPDF|window\.print|\bTSPL\b|label-render|wa\.me|navigator\.share/.test(readFileSync(f, 'utf8'))
    || /printer|pdf|print|invoice|token-slip|export-csv|whatsapp/i.test(f));

  it('no print / PDF / label / share / export source reads dailyNo', () => {
    expect(printing.length).toBeGreaterThan(10);
    for (const f of printing) {
      // Screens that also print keep the chip in their TEMPLATE only; their
      // print code must not read the number.
      const code = readFileSync(f, 'utf8').replace(/<pf-daily-no[^>]*\/>/g, '');
      expect(code, f).not.toMatch(/dailyNo\b|dailyNoDay|dailyNoLabel|dailyNoHtml/);
    }
  });
});
