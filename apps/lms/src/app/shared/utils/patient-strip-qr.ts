import QRCode from 'qrcode';

/**
 * Patient-strip QR codes on the printed report (owner, 2026-09-28):
 *
 *  • Patient Profile QR (`profileqr`) — `<web>/p/<patientId>`, the app's
 *    existing patient open-route (same value as the patient ID card). Staff
 *    scan it (phone camera or the in-app scanner) and land on the patient's
 *    profile; the normal login / RBAC / branch rules apply, so an outsider who
 *    scans it only ever reaches the login screen.
 *  • Order QR (`orderqr`) — `<web>/track/<token>`, the order's public tracking
 *    page (same token as the invoice QR). The patient confirms DOB / phone /
 *    invoice no. and downloads the soft copy of the report; until the report
 *    is ready (or while a balance is due) the page shows the order's status.
 *
 * Both are opt-in patient-strip fields: they start in "Unused" and print only
 * where the lab places them.
 */
export const PROFILE_QR_KEY = 'profileqr';
export const ORDER_QR_KEY = 'orderqr';
export const PATIENT_STRIP_QR_KEYS: readonly string[] = [PROFILE_QR_KEY, ORDER_QR_KEY];

export function isPatientStripQrKey(key: string): boolean {
  return PATIENT_STRIP_QR_KEYS.includes(key);
}

/** Captions printed under each QR on the report. */
export const PATIENT_STRIP_QR_CAPTIONS: Record<string, string> = {
  [PROFILE_QR_KEY]: 'Patient profile',
  [ORDER_QR_KEY]: 'Scan for report',
};

function trimBase(base: string): string {
  return (base ?? '').trim().replace(/\/+$/, '');
}

/** `<base>/p/<patientId>` — null when either part is missing. */
export function patientProfileQrUrl(base: string, patientId: string | null | undefined): string | null {
  const b = trimBase(base);
  const id = (patientId ?? '').trim();
  return b && id ? `${b}/p/${encodeURIComponent(id)}` : null;
}

/** `<base>/track/<token>` — null when either part is missing. */
export function orderReportQrUrl(base: string, trackToken: string | null | undefined): string | null {
  const b = trimBase(base);
  const t = (trackToken ?? '').trim();
  return b && t ? `${b}/track/${encodeURIComponent(t)}` : null;
}

/** Does any patient strip that could print — the tenant default
 *  (`patientColumnsJson`) or a department's own strip — place `key`? */
export function patientStripPlaces(
  key: string,
  patientColumnsJson: string | null | undefined,
  deptStrips: Array<{ columns?: string[][] } | null | undefined> = [],
): boolean {
  const has = (cols: unknown) => Array.isArray(cols) && cols.some(c => Array.isArray(c) && c.includes(key));
  if (patientColumnsJson) {
    try { if (has(JSON.parse(patientColumnsJson))) return true; } catch { /* malformed → not placed */ }
  }
  return deptStrips.some(s => has(s?.columns));
}

/** Minimal jsPDF surface the QR painter needs (keeps this file jsPDF-free). */
export interface QrPainter {
  setFillColor(color: string): unknown;
  rect(x: number, y: number, w: number, h: number, style?: string): unknown;
}

/**
 * Paint `value` as a vector QR (filled squares) at (x, y), `size` pt square,
 * with a white quiet zone. Synchronous — the report renderer is sync. Returns
 * false when the value can't be encoded (nothing is drawn).
 */
export function paintQr(doc: QrPainter, value: string, x: number, y: number, size: number): boolean {
  let qr: ReturnType<typeof QRCode.create>;
  try { qr = QRCode.create(value, { errorCorrectionLevel: 'M' }); } catch { return false; }
  const n = qr.modules.size;
  const bits = qr.modules.data;
  const mod = size / n;
  doc.setFillColor('#ffffff');
  doc.rect(x, y, size, size, 'F');
  doc.setFillColor('#000000');
  // Rows overlap the next row by a hair: abutting rects otherwise rasterise
  // with white anti-aliased seams between rows, which scanners read as gaps.
  const bleed = mod * 0.12;
  for (let r = 0; r < n; r++) {
    // Merge horizontal runs into one rect: fewer PDF ops, no vertical seams.
    const h = r < n - 1 ? mod + bleed : mod;
    let c = 0;
    while (c < n) {
      if (!bits[r * n + c]) { c++; continue; }
      const start = c;
      while (c < n && bits[r * n + c]) c++;
      doc.rect(x + start * mod, y + r * mod, (c - start) * mod, h, 'F');
    }
  }
  return true;
}
