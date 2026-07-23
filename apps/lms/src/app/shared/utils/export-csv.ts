/**
 * Minimal client-side CSV export. Builds a CSV string from rows and triggers a
 * download via a Blob + anchor (same pattern as the report-pdf blob download).
 * No dependency — Excel/Sheets open .csv natively, which covers the
 * "download as XLSX/CSV" ask without pulling in a spreadsheet library.
 */

/** Escape a single CSV cell per RFC 4180 (quote when it contains a comma,
 *  quote, or newline; double embedded quotes). */
function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize a matrix of rows (first row typically the header) to CSV text. */
export function toCsv(rows: Array<Array<unknown>>): string {
  return rows.map(r => r.map(csvCell).join(',')).join('\r\n');
}

/** Download CSV text as a file. `filename` should end in `.csv`. */
export function downloadCsv(filename: string, rows: Array<Array<unknown>>): void {
  // Prepend a UTF-8 BOM so Excel renders ₹ and other non-ASCII correctly.
  const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
