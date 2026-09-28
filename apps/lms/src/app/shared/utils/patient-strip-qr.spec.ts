import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import {
  ORDER_QR_KEY, PROFILE_QR_KEY, isPatientStripQrKey, orderReportQrUrl, paintQr,
  patientProfileQrUrl, patientStripPlaces,
} from './patient-strip-qr';
import { buildReportPdf, patientStripQrValue } from './report-pdf';
import { ApiLike, legacyOrderTrackToken } from './report-render-input';
import { toggleStripQrKey } from '../../features/admin/report-template/report-template.component';
import type { ResolvedReportLayout } from '../models/report-layout.model';

/**
 * Patient-strip QR codes (owner, 2026-09-28): "In the Patient Strip — add
 * options to include QR: Patient Profile QR (scan → patient profile) and
 * Order QR (download the soft copy of the report)".
 */

const BASE = 'https://med-dev.prefrontal.health';

describe('patient-strip QR URLs', () => {
  it('Profile QR opens the app\'s patient open-route /p/{id}', () => {
    expect(patientProfileQrUrl(BASE, 'a1b2')).toBe(`${BASE}/p/a1b2`);
    expect(patientProfileQrUrl(BASE + '/', 'a1b2')).toBe(`${BASE}/p/a1b2`);
  });

  it('Order QR opens the public tracking page /track/{token}', () => {
    expect(orderReportQrUrl(BASE, 'tok_-9')).toBe(`${BASE}/track/tok_-9`);
  });

  it('no URL without its data or a base (nothing prints)', () => {
    expect(patientProfileQrUrl(BASE, '')).toBeNull();
    expect(patientProfileQrUrl(BASE, undefined)).toBeNull();
    expect(orderReportQrUrl(BASE, null)).toBeNull();
    expect(orderReportQrUrl('', 'tok')).toBeNull();
  });

  it('knows its two keys', () => {
    expect(isPatientStripQrKey(PROFILE_QR_KEY)).toBe(true);
    expect(isPatientStripQrKey(ORDER_QR_KEY)).toBe(true);
    expect(isPatientStripQrKey('barcode')).toBe(false);
  });

  it('patientStripQrValue maps each key to its URL', () => {
    const snap = { patient: { id: 'p9' }, order: { id: 'o9' } };
    expect(patientStripQrValue(PROFILE_QR_KEY, snap as never, BASE, null)).toBe(`${BASE}/p/p9`);
    expect(patientStripQrValue(ORDER_QR_KEY, snap as never, BASE, 'T')).toBe(`${BASE}/track/T`);
    expect(patientStripQrValue(ORDER_QR_KEY, snap as never, BASE, null)).toBeNull();
    expect(patientStripQrValue('name', snap as never, BASE, 'T')).toBeNull();
  });
});

describe('patientStripPlaces', () => {
  it('finds the key in the tenant default strip', () => {
    expect(patientStripPlaces(ORDER_QR_KEY, JSON.stringify([['name'], [ORDER_QR_KEY]]))).toBe(true);
    expect(patientStripPlaces(ORDER_QR_KEY, JSON.stringify([['name'], ['barcode']]))).toBe(false);
  });
  it('finds the key in a department strip', () => {
    expect(patientStripPlaces(ORDER_QR_KEY, null, [null, { columns: [[], [ORDER_QR_KEY]] }])).toBe(true);
  });
  it('malformed JSON is "not placed", never a throw', () => {
    expect(patientStripPlaces(ORDER_QR_KEY, '{nope')).toBe(false);
  });
});

describe('paintQr', () => {
  it('paints a white quiet square then black module runs inside it', () => {
    const rects: Array<[number, number, number, number]> = [];
    const fills: string[] = [];
    const ok = paintQr({ setFillColor: c => fills.push(c), rect: (x, y, w, h) => rects.push([x, y, w, h]) },
      `${BASE}/p/0b8f3c52-1111-4222-8333-944455556666`, 100, 200, 58);
    expect(ok).toBe(true);
    expect(fills).toEqual(['#ffffff', '#000000']);
    expect(rects[0]).toEqual([100, 200, 58, 58]);
    expect(rects.length).toBeGreaterThan(50);
    for (const [x, y, w, h] of rects.slice(1)) {
      expect(x).toBeGreaterThanOrEqual(100); expect(x + w).toBeLessThanOrEqual(158 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(200); expect(y + h).toBeLessThanOrEqual(258 + 1e-6);
    }
  });
  it('an unencodable value draws nothing', () => {
    const rect = vi.fn();
    expect(paintQr({ setFillColor: vi.fn(), rect }, '', 0, 0, 58)).toBe(false);
    expect(rect).not.toHaveBeenCalled();
  });
});

describe('report PDF patient strip with QR codes', () => {
  const cols = (c: string[][]) => ({ patientColumnsJson: JSON.stringify(c), patientLayout: 'three-col' });
  function render(snap: object, template: object | null, extra: object = {}): string {
    const doc = buildReportPdf({
      report: { id: 'r1', type: 'final', createdAt: '2026-09-28T00:00:00Z', data: JSON.stringify(snap) },
      template: template as never, resolvedLayouts: {}, publicBaseUrl: BASE, ...extra,
    });
    return Buffer.from(doc.output('arraybuffer')).toString('latin1');
  }
  const SNAP = {
    type: 'final',
    patient: { id: 'p1', displayName: 'Sita Raman', age: 37, sex: 'Female' },
    order: { id: 'o1', orderNumber: 'LAB-2609-000001', createdAt: '2026-09-28T00:00:00Z', trackToken: 'tok123' },
    tests: [],
  };

  it('prints both QRs (with captions) where the lab placed them', () => {
    const text = render(SNAP, cols([['name'], ['age'], [PROFILE_QR_KEY, ORDER_QR_KEY]]));
    expect(text).toContain('Patient profile');
    expect(text).toContain('Scan for report');
  });

  it('unplaced QRs never print (opt-in)', () => {
    const text = render(SNAP, cols([['name'], ['age'], ['barcode']]));
    expect(text).not.toContain('Patient profile');
    expect(text).not.toContain('Scan for report');
  });

  it('a QR whose data is missing is skipped, not drawn as a placeholder', () => {
    const snap = { ...SNAP, patient: { ...SNAP.patient, id: undefined }, order: { ...SNAP.order, trackToken: undefined } };
    const text = render(snap, cols([['name'], [PROFILE_QR_KEY], [ORDER_QR_KEY]]));
    expect(text).not.toContain('Patient profile');
    expect(text).not.toContain('Scan for report');
  });

  it('older snapshots print the Order QR from the fetched tracking token', () => {
    const snap = { ...SNAP, order: { ...SNAP.order, trackToken: undefined } };
    const text = render(snap, cols([['name'], [], [ORDER_QR_KEY]]), { orderTrackToken: 'legacy' });
    expect(text).toContain('Scan for report');
  });
});

describe('legacyOrderTrackToken (reports older than snapshot.order.trackToken)', () => {
  const placed = { patientColumnsJson: JSON.stringify([[ORDER_QR_KEY]]) } as never;
  const api = (impl: () => unknown) => ({ get: vi.fn(impl) }) as unknown as ApiLike & { get: ReturnType<typeof vi.fn> };

  it('fetches the order\'s tracking token when the Order QR is placed and the snapshot lacks it', async () => {
    const a = api(() => of({ token: 'T1' }));
    expect(await legacyOrderTrackToken(a, { id: 'o1' }, placed, {})).toBe('T1');
    expect(a.get).toHaveBeenCalledWith('/api/orders/o1/track-token');
  });

  it('no call when the snapshot already carries the token', async () => {
    const a = api(() => of({ token: 'T1' }));
    expect(await legacyOrderTrackToken(a, { id: 'o1', trackToken: 'S' }, placed, {})).toBeNull();
    expect(a.get).not.toHaveBeenCalled();
  });

  it('no call when no strip places the Order QR', async () => {
    const a = api(() => of({ token: 'T1' }));
    expect(await legacyOrderTrackToken(a, { id: 'o1' }, { patientColumnsJson: '[["name"]]' } as never, {})).toBeNull();
    expect(a.get).not.toHaveBeenCalled();
  });

  it('a department strip placing it counts too', async () => {
    const a = api(() => of({ token: 'T2' }));
    const layouts = { t1: { patientStrip: { columns: [[ORDER_QR_KEY]] } } as unknown as ResolvedReportLayout };
    expect(await legacyOrderTrackToken(a, { id: 'o1' }, null, layouts)).toBe('T2');
  });

  it('a 403 / failure prints the report without the QR (no throw)', async () => {
    const a = api(() => throwError(() => new Error('forbidden')));
    expect(await legacyOrderTrackToken(a, { id: 'o1' }, placed, {})).toBeNull();
  });
});

describe('toggleStripQrKey (report designer switches)', () => {
  it('switching on appends to the last column', () => {
    expect(toggleStripQrKey([['name'], ['age'], ['barcode']], PROFILE_QR_KEY))
      .toEqual([['name'], ['age'], ['barcode', PROFILE_QR_KEY]]);
  });
  it('switching on beside the other QR keeps Profile before Order', () => {
    expect(toggleStripQrKey([['name'], [ORDER_QR_KEY, 'x']], PROFILE_QR_KEY))
      .toEqual([['name'], [PROFILE_QR_KEY, ORDER_QR_KEY, 'x']]);
    expect(toggleStripQrKey([[PROFILE_QR_KEY, 'x'], []], ORDER_QR_KEY))
      .toEqual([[PROFILE_QR_KEY, ORDER_QR_KEY, 'x'], []]);
  });
  it('switching off removes it wherever it was dragged', () => {
    expect(toggleStripQrKey([[ORDER_QR_KEY, 'name'], ['age']], ORDER_QR_KEY)).toEqual([['name'], ['age']]);
  });
  it('does not mutate its input', () => {
    const cols = [['name']];
    toggleStripQrKey(cols, ORDER_QR_KEY);
    expect(cols).toEqual([['name']]);
  });
});
