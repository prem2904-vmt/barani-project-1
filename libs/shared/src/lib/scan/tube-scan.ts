/**
 * Tube QR payload → the Sample ID.
 *
 * A tube label's QR carries `MRN|SampleID` (label-print.service.ts
 * `labelData().qrValue`, label-card.component.ts `qrValue`) while the 1D
 * barcode carries the bare Sample ID. Every scan path compares / looks up the
 * Sample ID, so a QR read is reduced to the part after the LAST `|`, trimmed.
 *
 * Only a tube-shaped payload is touched: one or more `|`-separated parts with
 * no spaces and no JSON / XML / URL characters. Anything else (an ABHA JSON
 * card, an Aadhaar XML QR, an order `/o/…` or `/track/…` URL, a plain
 * barcode) comes back trimmed and otherwise unchanged, so URL routing and the
 * patient-QR flows keep working exactly as before.
 */
const TUBE_QR = /^[^\s|{}<>"]+(\|[^\s|{}<>"]+)+$/;

export function normalizeTubeScan(raw: string | null | undefined): string {
  const v = (raw ?? '').trim();
  if (!v || !v.includes('|') || v.includes('://') || !TUBE_QR.test(v)) return v;
  return v.slice(v.lastIndexOf('|') + 1).trim();
}
