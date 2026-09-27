import { buildReportPdf } from './report-pdf';
import type { ReportTemplate } from '../models/report.model';
import { LEGACY_HEADER_GOLDEN } from './report-header-legacy.golden';

/**
 * OLD TEMPLATES PRINT EXACTLY AS BEFORE (owner, 2026-09-27).
 *
 * The letterhead / footer renderer was rebuilt around a layout model so the
 * report designer can move, resize, align and hide each element. A template
 * saved BEFORE that (no `metadata.headerLayout`) must produce a byte-identical
 * PDF. The golden hashes below were captured from the pre-refactor renderer
 * (commit 132d054c) over a matrix of every header preset × logo position ×
 * logo size, with/without NABL, contact fields, accent bar, font scale, long
 * address, disclaimer and footer text. If this fails, an untouched template
 * changed on paper — fix the renderer, never the hashes.
 *
 * Regenerate ONLY for an intentional legacy change: run with
 * PF_PRINT_GOLDEN=1 and paste the printed map into the .golden.ts file.
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

function hash(s: string): string {
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

describe('report header — untouched templates print exactly as before', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-27T05:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it('every legacy header matches its golden render', () => {
    const got: Record<string, string> = {};
    for (const [name, patch] of legacyMatrix()) got[name] = hash(renderLegacy(name, patch));
    if ((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.['PF_PRINT_GOLDEN']) {
      console.log('LEGACY_HEADER_GOLDEN=' + JSON.stringify(got, null, 2));
    }
    const mismatched = Object.keys(LEGACY_HEADER_GOLDEN).filter(k => got[k] !== LEGACY_HEADER_GOLDEN[k]);
    expect(mismatched).toEqual([]);
    expect(Object.keys(got).sort()).toEqual(Object.keys(LEGACY_HEADER_GOLDEN).sort());
  });
});
