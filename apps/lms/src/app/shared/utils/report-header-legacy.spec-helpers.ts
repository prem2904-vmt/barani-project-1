import { buildReportPdf } from './report-pdf';
import type { ReportTemplate } from '../models/report.model';

/**
 * Shared fixtures for the report-header specs (legacy fingerprint, layout,
 * backgrounds). A NON-spec module on purpose: importing a *.spec.ts from
 * another spec re-registers its describe blocks there — the 146-render
 * fingerprint then ran three times per suite.
 */

const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export const LEGACY_SNAPSHOT = JSON.stringify({
  patient: { displayName: 'Sita Raman', age: 37, sex: 'Female', phone: '9080706050' },
  order: { id: 'o1', orderNumber: 'LAB-2609-000042', createdAt: '2026-09-20T04:30:00Z', refDoctorName: 'Dr. A. Sharma' },
  type: 'final',
  tests: [{
    testId: 'd1', name: 'Hemoglobin', department: 'Haematology', sampleType: 'EDTA Whole Blood',
    result: { values: { Hemoglobin: { value: '11.4', unit: 'g/dL', range: '12.0 – 16.0', flag: 'L' } } },
  }],
});

export const LONG_ADDRESS =
  'No. 12, 3rd Floor, Sri Krishna Towers, 145 Anna Salai, Near Gemini Flyover, Teynampet, Chennai, Tamil Nadu 600018, India';

function baseTemplate(): ReportTemplate {
  return {
    id: 't', tenantId: 'x', labName: 'Micro World Diagnostics', tagline: 'Accurate | Caring | Instant',
    address: '14 Gandhi Road, Chennai 600017', phone: '+91 98400 12345', email: 'lab@microworld.in',
    website: 'www.microworld.in', logoUrl: '/uploads/logo.png',
    nablAccredited: false, nablNumber: '', nablLogoUrl: '',
    headerPreset: 'drlogy', logoPosition: 'left', logoSize: 'md', topAccentBar: true,
    primaryColor: '#1B3A6B', accentColor: '#0066CC', fontFamily: 'helvetica', fontSize: 'md',
    showPatientName: true, showAge: true, showRefDoctor: true, showOrderId: true, showAbhaId: false,
    showQrCode: true, showCollectionDate: true, showReportDate: true, showMethod: false,
    showInstrument: false, groupByDepartment: false, showCriticalFlag: true,
    showPathologistName: true, showSignature: true, showPoweredBy: true,
    disclaimer: 'Test results should be correlated clinically.', footerText: 'Reg. No. TN/1234 · GSTIN 33ABCDE1234F1Z5',
  } as ReportTemplate;
}

/** The legacy matrix — name → template patch. */
export function legacyMatrix(): Array<[string, Partial<ReportTemplate>]> {
  const out: Array<[string, Partial<ReportTemplate>]> = [];
  for (const preset of ['drlogy', 'centered', 'banner', 'minimal']) {
    for (const pos of ['left', 'center', 'right']) {
      for (const size of ['sm', 'md', 'lg']) {
        out.push([`${preset}/${pos}/${size}`, { headerPreset: preset, logoPosition: pos, logoSize: size }]);
      }
    }
    out.push([`${preset}/nabl-img`, { headerPreset: preset, nablAccredited: true, nablNumber: 'MC-1234', nablLogoUrl: '/uploads/nabl.png' }]);
    out.push([`${preset}/nabl-chip`, { headerPreset: preset, nablAccredited: true, nablNumber: 'MC-1234' }]);
    out.push([`${preset}/bare`, { headerPreset: preset, address: '', phone: '', email: '', website: '', logoUrl: '', tagline: '' }]);
    out.push([`${preset}/no-bar`, { headerPreset: preset, topAccentBar: false }]);
    out.push([`${preset}/font-lg`, { headerPreset: preset, fontSize: 'lg', fontFamily: 'times' }]);
    out.push([`${preset}/font-sm`, { headerPreset: preset, fontSize: 'sm' }]);
    out.push([`${preset}/long-address`, { headerPreset: preset, address: LONG_ADDRESS }]);
    out.push([`${preset}/one-word`, { headerPreset: preset, labName: 'Metropolis', tagline: 'Plain tagline, no pipes' }]);
    out.push([`${preset}/footer-off`, { headerPreset: preset, disclaimer: '', footerText: '', showPoweredBy: false, showSampleCollectionBand: false }]);
  }
  out.push(['null-template', {}]);
  return out;
}

export function hash(s: string): string {
  // FNV-1a 32-bit ×2 (different offsets) — plenty for a regression guard.
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0') + ':' + s.length;
}

/** Render one matrix entry; strip the per-file ids/dates. */
export function renderLegacy(name: string, patch: Partial<ReportTemplate>, extra: Partial<ReportTemplate> = {}): string {
  const template = name === 'null-template' ? null : { ...baseTemplate(), ...patch, ...extra };
  const doc = buildReportPdf({
    report: { id: 'r1', type: 'final', createdAt: '2026-09-20T06:00:00Z', data: LEGACY_SNAPSHOT },
    template,
    imageCache: { '/uploads/logo.png': PNG_1x1, '/uploads/nabl.png': PNG_1x1 },
  });
  return Buffer.from(doc.output('arraybuffer')).toString('latin1')
    .replace(/\/CreationDate \([^)]*\)/g, '')
    .replace(/\/ID \[[^\]]*\]/g, '');
}


/** jsdom has no canvas: every JsBarcode call logs "Not implemented:
 *  HTMLCanvasElement's getContext()" (one per render → hundreds per run,
 *  flooding the worker's console channel). Returning undefined — exactly what
 *  jsdom returns — keeps the renderer on the same path, silently. */
export function silenceJsdomCanvas(): void {
  let spy: { mockRestore(): void } | null = null;
  beforeAll(() => {
    spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => undefined as never);
  });
  afterAll(() => spy?.mockRestore());
}
