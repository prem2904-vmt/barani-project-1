import { buildReportPdfWithLayout, computeReportPageLayout, type ReportPdfInput } from './report-pdf';
import {
  BODY_GAP, HeaderLayoutConfig, LEGACY_BODY_TOP, MARGIN_X, MM, PAGE, detectIssues, positionReadout, readHeaderLayout,
  nudgeSnapX, resetItem, setItem, snapBoxX, writeHeaderLayout,
} from './report-header-layout';
import type { ReportTemplate } from '../models/report.model';
import { LEGACY_SNAPSHOT, silenceJsdomCanvas, LONG_ADDRESS } from './report-header-legacy.spec-helpers';

/**
 * The letterhead layout model: storage, defaults-from-old-settings, and that
 * ONE resolved layout drives both the printed PDF and the designer's outlines.
 * PDF assertions read the real content stream back (jsPDF writes text as
 * `x y Td (text) Tj` in PDF space: y grows UP from the page bottom).
 */

const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function tpl(p: Partial<ReportTemplate> = {}, cfg?: HeaderLayoutConfig | null): ReportTemplate {
  const t = {
    id: 't', tenantId: 'x', labName: 'Micro World Diagnostics', tagline: 'Accurate | Caring | Instant',
    address: '14 Gandhi Road, Chennai 600017', phone: '+91 98400 12345', email: 'lab@microworld.in',
    website: 'www.microworld.in', logoUrl: '/uploads/logo.png', nablAccredited: false,
    headerPreset: 'classic', logoPosition: 'left', logoSize: 'md', topAccentBar: true,
    primaryColor: '#1B3A6B', accentColor: '#0066CC', showPatientName: true, showAge: true, showRefDoctor: true,
    showOrderId: true, showAbhaId: false, showQrCode: true, showCollectionDate: true, showReportDate: true,
    showMethod: false, showInstrument: false, groupByDepartment: false, showCriticalFlag: true,
    showPathologistName: true, showSignature: true, showPoweredBy: true,
    disclaimer: 'Test results should be correlated clinically.', footerText: '',
    ...p,
  } as ReportTemplate;
  if (cfg !== undefined) t.metadata = writeHeaderLayout(t, cfg);
  return t;
}

function input(t: ReportTemplate | null): ReportPdfInput {
  return {
    report: { id: 'r1', type: 'final', createdAt: '2026-09-20T06:00:00Z', data: LEGACY_SNAPSHOT },
    template: t, imageCache: { '/uploads/logo.png': PNG_1x1 },
  };
}

function pdfOf(t: ReportTemplate | null): { pdf: string; layout: ReturnType<typeof buildReportPdfWithLayout>['layout'] } {
  const { doc, layout } = buildReportPdfWithLayout(input(t));
  const pdf = Buffer.from(doc.output('arraybuffer')).toString('latin1')
    .replace(/\/CreationDate \([^)]*\)/g, '').replace(/\/ID \[[^\]]*\]/g, '');
  return { pdf, layout };
}

/** Every text run: its PDF-space Td origin, converted back to page space (y down). */
function runs(pdf: string): Array<{ x: number; y: number; t: string }> {
  return [...pdf.matchAll(/(-?[\d.]+) (-?[\d.]+) Td\s*\(((?:[^()\\]|\\.)*)\) Tj/g)]
    .map(m => ({ x: parseFloat(m[1]), y: PAGE.h - parseFloat(m[2]), t: m[3] }));
}
const runOf = (pdf: string, t: string) => runs(pdf).find(r => r.t === t);
const item = (l: { items: Array<{ id: string }> }, id: string) => l.items.find(i => i.id === id) as never as {
  x: number; y: number; box: { x: number; y: number; w: number; h: number }; lines?: string[]; wraps?: boolean;
  hidden?: boolean; align: string; w?: number; h?: number; customized: boolean };


silenceJsdomCanvas();

describe('header layout — storage', () => {
  it('reads nothing from an old template (no metadata) → legacy', () => {
    expect(readHeaderLayout(tpl())).toBeNull();
    expect(readHeaderLayout({ metadata: 'not json' })).toBeNull();
    expect(readHeaderLayout({ metadata: '{"other":1}' })).toBeNull();
  });

  it('round-trips and keeps the other metadata keys', () => {
    const t = { metadata: JSON.stringify({ keepMe: { a: 1 } }) };
    const cfg = setItem(null, 'address', { align: 'right', x: 150.004, y: 20, bold: true });
    const meta = writeHeaderLayout(t, cfg);
    expect(JSON.parse(meta).keepMe).toEqual({ a: 1 });
    expect(readHeaderLayout({ metadata: meta })).toEqual({ v: 1, items: { address: { align: 'right', x: 150, y: 20, bold: true } } });
    expect(JSON.parse(writeHeaderLayout({ metadata: meta }, null))).toEqual({ keepMe: { a: 1 } });
  });

  it('drops junk keys / values and empty overrides', () => {
    const meta = JSON.stringify({ headerLayout: { items: { a: { align: 'diagonal', x: 'far', size: -3 }, b: { hidden: true, fields: ['phone', 'fax'] } } } });
    expect(readHeaderLayout({ metadata: meta })).toEqual({ v: 1, items: { b: { hidden: true, fields: ['phone'] } } });
  });

  it('setItem clears keys set to undefined; resetItem forgets the element', () => {
    let cfg = setItem(null, 'logo', { size: 20, hidden: true });
    cfg = setItem(cfg, 'logo', { hidden: undefined });
    expect(cfg.items['logo']).toEqual({ size: 20 });
    cfg = setItem(cfg, 'logo', { size: undefined });
    expect(cfg.items['logo']).toBeUndefined();
    cfg = resetItem(setItem(cfg, 'name', { y: 9 }), 'name');
    expect(cfg.items).toEqual({});
  });
});

describe('header layout — defaults from the old settings', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-27T05:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  for (const preset of ['classic', 'minimal']) {
    for (const size of ['sm', 'md', 'lg']) {
      it(`${preset}/${size}: an edited-but-untouched layout prints byte-identically to the old header`, () => {
        // Short fields that fit → nothing to wrap, nothing to push down.
        const p = { headerPreset: preset, logoSize: size, nablAccredited: true, nablNumber: 'MC-1234' };
        expect(pdfOf(tpl(p, { v: 1, items: {} })).pdf).toBe(pdfOf(tpl(p)).pdf);
      });
    }
  }

  it('centered: same text positions, but the bar and the patient details move below the contact line (they used to strike through / overprint it)', () => {
    const p = { headerPreset: 'centered', address: '' };
    const old = pdfOf(tpl(p)), edited = pdfOf(tpl(p, { v: 1, items: {} }));
    const head = (pdf: string) => runs(pdf).filter(r => r.y < 105 && r.t !== 'www.microworld.in')
      .map(r => `${r.t}@${r.x.toFixed(2)},${r.y.toFixed(2)}`);
    expect(head(edited.pdf)).toEqual(head(old.pdf));
    expect(detectIssues(old.layout).some(i => i.kind === 'overlap')).toBe(true);
    expect(detectIssues(edited.layout).filter(i => i.level === 'warn')).toEqual([]);
    expect(detectIssues(old.layout).some(i => i.kind === 'body')).toBe(true);
    expect(edited.layout.bodyTop).toBeGreaterThan(old.layout.bodyTop);
    expect(detectIssues(edited.layout).some(i => i.kind === 'body')).toBe(false);
  });

  it('an untouched template reports the legacy patient-details top', () => {
    const { layout } = pdfOf(tpl());
    expect(layout.active).toBe(false);
    expect(layout.bodyTop).toBe(LEGACY_BODY_TOP);
  });
});

describe('header layout — the model drives the PDF', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-27T05:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it('the designer layout equals the layout the PDF was drawn with', () => {
    const t = tpl({}, setItem(setItem(null, 'address', { align: 'right' }), 'logo', { size: 18 }));
    const drawn = buildReportPdfWithLayout(input(t)).layout;
    expect(computeReportPageLayout(input(t))).toEqual(drawn);
  });

  it('every drawn text item starts where its box says (left, centre, right)', () => {
    const cfg = setItem(setItem(null, 'address', { align: 'center' }), 'email', { align: 'left', x: 40 });
    const { pdf, layout } = pdfOf(tpl({}, cfg));
    for (const id of ['address', 'phone', 'email']) {
      const it = item(layout, id);
      const text = (layout.items.find(i => i.id === id) as { text: string }).text;
      const r = runOf(pdf, text)!;
      expect(r).toBeTruthy();
      expect(r.x).toBeCloseTo(it.box.x, 1);
      expect(r.y).toBeCloseTo(it.y, 1);
    }
  });

  it('alignment moves the address: left margin → centre → right margin', () => {
    const at = (align?: 'left' | 'center' | 'right') => {
      const { pdf, layout } = pdfOf(tpl({}, align ? setItem(null, 'address', { align }) : { v: 1, items: {} }));
      const it = item(layout, 'address');
      return { r: runOf(pdf, '14 Gandhi Road, Chennai 600017')!, it };
    };
    const left = at(), centre = at('center'), right = at('right');
    expect(left.r.x).toBeCloseTo(MARGIN_X, 1);
    expect(centre.r.x + centre.it.box.w / 2).toBeCloseTo(PAGE.w / 2, 1);
    expect(right.r.x + right.it.box.w).toBeCloseTo(PAGE.w - MARGIN_X, 1);
    expect(right.it.align).toBe('right');
  });

  it('a nudge moves the drawn text by exactly that many mm', () => {
    const base = pdfOf(tpl({}, { v: 1, items: {} }));
    const y0 = item(base.layout, 'phone').y;
    const moved = pdfOf(tpl({}, setItem(null, 'phone', { y: y0 / MM + 2.5 })));
    expect(runOf(moved.pdf, '+91 98400 12345')!.y - runOf(base.pdf, '+91 98400 12345')!.y).toBeCloseTo(2.5 * MM, 1);
  });

  it('logo size (mm) is the drawn image height; "natural" keeps proportions', () => {
    const { pdf, layout } = pdfOf(tpl({}, setItem(null, 'logo', { size: 20 })));
    const h = 20 * MM;
    expect(item(layout, 'logo').h).toBeCloseTo(h, 3);
    expect(pdf).toMatch(new RegExp(`${h.toFixed(2).slice(0, 5)}\\d* 0 0 ${h.toFixed(2).slice(0, 5)}\\d* [\\d.]+ [\\d.]+ cm`));
    // The name slides right to stay beside the bigger logo.
    const name = item(layout, 'name');
    expect(name.x).toBeCloseTo(MARGIN_X + h + 6, 3);
  });

  it('hidden elements are listed but not drawn', () => {
    const { pdf, layout } = pdfOf(tpl({}, setItem(null, 'email', { hidden: true })));
    expect(item(layout, 'email').hidden).toBe(true);
    expect(runOf(pdf, 'lab@microworld.in')).toBeUndefined();
  });

  it('font size + bold apply to the drawn run', () => {
    const { pdf } = pdfOf(tpl({}, setItem(null, 'address', { size: 11, bold: true })));
    const i = pdf.indexOf('(14 Gandhi Road, Chennai 600017) Tj');
    const block = pdf.slice(pdf.lastIndexOf('BT', i), i);
    expect(block).toMatch(/\/F2 11 Tf/);   // F2 = Helvetica-Bold
  });
});

describe('header layout — address as typed, wrap & overflow', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-27T05:00:00Z')); });
  afterEach(() => vi.useRealTimers());
  const ML = 'No. 12, 3rd Floor, Sri Krishna Towers\n145 Anna Salai, Teynampet\nChennai, Tamil Nadu 600018';

  it('keeps the typed line breaks: one run per line, stacked', () => {
    const { pdf, layout } = pdfOf(tpl({ address: ML }, { v: 1, items: {} }));
    const it = item(layout, 'address');
    expect(it.lines).toEqual(ML.split('\n'));
    const ys = ML.split('\n').map(l => runOf(pdf, l)!.y);
    expect(ys[1] - ys[0]).toBeCloseTo(ys[2] - ys[1], 3);
    expect(ys[1]).toBeGreaterThan(ys[0]);
  });

  it('a tall letterhead pushes the patient details down instead of printing under them', () => {
    const { pdf, layout } = pdfOf(tpl({ address: ML }, { v: 1, items: {} }));
    expect(layout.bodyTop).toBeGreaterThan(LEGACY_BODY_TOP);
    expect(layout.bodyTop).toBeCloseTo(layout.headerBottom + BODY_GAP, 3);
    expect(runOf(pdf, 'Sita Raman')!.y).toBeGreaterThan(layout.headerBottom);
    // The accent bar moved under the address instead of striking through it.
    expect(item(layout, 'accentBar').y).toBeGreaterThan(item(layout, 'address').box.y + item(layout, 'address').box.h);
    expect(detectIssues(layout).filter(i => i.level === 'warn')).toEqual([]);
  });

  it('the accent bar moves under text placed above it, but not under text dragged below it', () => {
    const under = pdfOf(tpl({ address: LONG_ADDRESS }, setItem(null, 'address', { x: 24, y: 25, wrap: 105 }))).layout;
    const a = item(under, 'address');
    expect(a.lines!.length).toBe(2);
    expect(item(under, 'accentBar').y).toBeGreaterThanOrEqual(a.box.y + a.box.h);
    const below = pdfOf(tpl({}, setItem(null, 'address', { y: 40 }))).layout;
    expect(item(below, 'accentBar').y).toBeCloseTo(28 + 54, 3);
    expect(item(below, 'address').box.y).toBeGreaterThan(item(below, 'accentBar').y);
  });

  it('OPS-81: a taller logo pushes the accent bar and the body below it; a normal logo moves nothing', () => {
    const normal = pdfOf(tpl({}, { v: 1, items: {} })).layout;
    expect(item(normal, 'accentBar').y).toBeCloseTo(28 + 54, 3);
    const tall = pdfOf(tpl({}, setItem(null, 'logo', { size: 30 }))).layout;
    const logo = item(tall, 'logo');
    expect(logo.box.h).toBeGreaterThan(80);
    expect(item(tall, 'accentBar').y).toBeGreaterThanOrEqual(logo.box.y + logo.box.h);
    expect(tall.bodyTop).toBeGreaterThan(item(tall, 'accentBar').y);
    expect(detectIssues(tall).filter(i => i.level === 'warn')).toEqual([]);
    // A logo the lab dragged BELOW the bar's spot stays below it (same rule as text).
    const dragged = pdfOf(tpl({}, setItem(null, 'logo', { size: 30, y: 40 }))).layout;
    expect(item(dragged, 'accentBar').y).toBeCloseTo(28 + 54, 3);
  });

  it('a fixed patient-details top that the letterhead crosses is flagged', () => {
    const cfg: HeaderLayoutConfig = { v: 1, items: {}, bodyTop: 30 };
    const { layout } = pdfOf(tpl({ address: ML }, cfg));
    expect(layout.bodyTopAuto).toBe(false);
    expect(detectIssues(layout).some(i => i.kind === 'body')).toBe(true);
  });

  it('a long address wraps inside the page instead of running off it', () => {
    const { layout } = pdfOf(tpl({ address: LONG_ADDRESS + ', Opp. City Centre Mall, Next to Metro Station Gate 2' }, { v: 1, items: {} }));
    const it = item(layout, 'address');
    expect(it.wraps).toBe(true);
    expect(it.lines!.length).toBeGreaterThan(1);
    expect(it.box.x + it.box.w).toBeLessThanOrEqual(PAGE.w - MARGIN_X + 0.01);
    const issues = detectIssues(layout);
    expect(issues.find(i => i.itemId === 'address' && i.kind === 'wrap')?.level).toBe('info');
    expect(issues.find(i => i.itemId === 'address' && i.kind === 'overflow')).toBeUndefined();
  });

  it('a set wrap width is honoured; "never wrap" flags the overflow', () => {
    const narrow = pdfOf(tpl({ address: LONG_ADDRESS }, setItem(null, 'address', { wrap: 60 }))).layout;
    expect(item(narrow, 'address').box.w).toBeLessThanOrEqual(60 * MM + 0.01);
    const never = pdfOf(tpl({ address: LONG_ADDRESS + ', Opp. City Centre Mall, Next to the metro' }, setItem(null, 'address', { wrap: 0 }))).layout;
    expect(item(never, 'address').lines!.length).toBe(1);
    expect(detectIssues(never).some(i => i.itemId === 'address' && i.kind === 'overflow' && i.level === 'warn')).toBe(true);
  });

  it('the old Centered header is flagged: the bar crosses the tagline, the contact lines sit on the patient details', () => {
    const { layout } = pdfOf(tpl({ headerPreset: 'centered', address: LONG_ADDRESS }));
    const issues = detectIssues(layout);
    expect(issues.some(i => i.kind === 'overlap')).toBe(true);
    expect(issues.some(i => i.kind === 'body')).toBe(true);
  });
});

describe('header layout — additions, footer, helpers', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-27T05:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it('a free text line (e.g. GSTIN) prints under the letterhead', () => {
    const cfg: HeaderLayoutConfig = { v: 1, items: {}, lines: [{ id: 'g', text: 'GSTIN 33ABCDE1234F1Z5' }] };
    const { pdf, layout } = pdfOf(tpl({}, cfg));
    const it = item(layout, 'line:g');
    expect(runOf(pdf, 'GSTIN 33ABCDE1234F1Z5')!.y).toBeCloseTo(it.y, 1);
    expect(it.y).toBeGreaterThan(item(layout, 'accentBar').y);
  });

  it('a field the style joins into one line can move to its own line', () => {
    // Banner prints "address · phone · email" as one line.
    const base = { headerPreset: 'banner' };
    let cfg = setItem(null, 'contact', { fields: ['phone', 'email'] });
    cfg = setItem(cfg, 'address', { added: true });
    const { pdf, layout } = pdfOf(tpl(base, cfg));
    expect(runOf(pdf, '14 Gandhi Road, Chennai 600017')).toBeTruthy();
    expect(runOf(pdf, '+91 98400 12345  ·  lab@microworld.in')).toBeTruthy();
    expect(item(layout, 'address')).toBeTruthy();
  });

  it('footer text wraps at the margin in an edited layout (it used to run off the page)', () => {
    const long = 'Reg. No. TN/1234 · GSTIN 33ABCDE1234F1Z5 · Registered office: 14 Gandhi Road, T. Nagar, Chennai 600017, Tamil Nadu, India · CIN U85100TN2019PTC123456';
    const old = pdfOf(tpl({ footerText: long })).layout;
    expect(detectIssues(old).some(i => i.itemId === 'footerText' && i.kind === 'overflow')).toBe(true);
    const edited = pdfOf(tpl({ footerText: long }, { v: 1, items: {} })).layout;
    const it = item(edited, 'footerText');
    expect(it.lines!.length).toBeGreaterThan(1);
    expect(it.box.x + it.box.w).toBeLessThanOrEqual(PAGE.w - MARGIN_X + 0.01);
  });

  it('snaps a moved box onto the centre line and margins', () => {
    const w = 100;
    expect(snapBoxX(PAGE.w / 2 - w / 2 + 2, w)).toEqual({ left: PAGE.w / 2 - w / 2, guide: PAGE.w / 2 });
    expect(snapBoxX(MARGIN_X + 3, w).guide).toBe(MARGIN_X);
    expect(snapBoxX(150, w).guide).toBeNull();
  });

  it('a nudge that would cross a guide stops on it; the next one moves on', () => {
    const w = 40;
    const first = nudgeSnapX(MARGIN_X + 1, MARGIN_X - 4, w);          // left edge crosses the margin
    expect(first).toEqual({ left: MARGIN_X, guide: MARGIN_X });
    expect(nudgeSnapX(MARGIN_X, MARGIN_X - 5, w).guide).toBeNull();   // from ON the guide: free to leave
    expect(nudgeSnapX(100, 105, w)).toEqual({ left: 105, guide: null });
  });

  it('reads out a position in plain words', () => {
    const { layout } = pdfOf(tpl({}, setItem(null, 'address', { align: 'center' })));
    expect(positionReadout(item(layout, 'address') as never).h).toBe('Centred on the page');
    expect(positionReadout(item(layout, 'phone') as never).h).toMatch(/mm in from the right margin/);
  });
});

describe('report options in template metadata', () => {
  it('writes and reads specimenLine without touching the header layout', async () => {
    const { readReportOption, writeReportOption } = await import('./report-header-layout');
    const tpl = { metadata: JSON.stringify({ headerLayout: { keep: 1 } }) };
    const on = writeReportOption(tpl, 'specimenLine', true);
    expect(readReportOption({ metadata: on }, 'specimenLine')).toBe(true);
    expect(JSON.parse(on).headerLayout).toEqual({ keep: 1 });
    const off = writeReportOption({ metadata: on }, 'specimenLine', false);
    expect(readReportOption({ metadata: off }, 'specimenLine')).toBe(false);
    expect(JSON.parse(off).options).toBeUndefined();
    expect(readReportOption({ metadata: 'not json' }, 'specimenLine')).toBe(false);
  });
});
