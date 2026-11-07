/** A scanned QR that names an in-app record: the patient ID card encodes
 *  `<origin>/p/<patientId>`, an invoice's order QR `<origin>/o/<orderId>`.
 *  ONE parser for every scanner (top-strip scan in the shell, the front
 *  desk's Scan QR) so a code is understood the same wherever it is scanned
 *  (OPS-95: the desk's scanner only knew /o/ and said "No patient matches"
 *  to a patient card). Returns the route segments, or null when the text is
 *  not an app record link. */
const APP_RECORD = /\/(p|o)\/([0-9a-f]{8}-[0-9a-f-]{27,})/i;

export function appRecordRoute(code: string | null | undefined): [string, string] | null {
  const m = APP_RECORD.exec((code ?? '').trim());
  return m ? [`/${m[1].toLowerCase()}`, m[2]] : null;
}
