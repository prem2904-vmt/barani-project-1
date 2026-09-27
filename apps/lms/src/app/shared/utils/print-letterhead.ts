import type { ReportTemplate } from '../models/report.model';

/**
 * Pre-printed letterpad — the owner's rule (2026-09-27):
 *
 * - DIGITAL outputs always carry the lab's full header & footer: the on-screen
 *   preview, download, share, WhatsApp, the archived PDF (`StoredPdfKey`) and
 *   the public patient link / QR. They never pass `blankLetterhead`.
 * - PRINTING is the only place the template's `letterpadMode` matters:
 *     off → print with the header & footer, no prompt;
 *     on  → ask once per print job: letterhead paper (header & footer left
 *           blank) — the default — or plain paper (with header & footer).
 *
 * Every print entry point calls `askPrintLetterhead` and passes the answer to
 * `buildReportPdf({ ..., blankLetterhead })`. The choice affects only that job.
 */

export const PRINT_CHOICE_LETTERHEAD = 'letterhead';
export const PRINT_CHOICE_PLAIN = 'plain';

/** The slice of DialogService this needs (kept structural so it stays DI-free). */
export interface PrintChoiceDialog {
  choose(req: {
    title: string;
    message?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    choices: Array<{ value: string; label: string; hint?: string }>;
    initialChoice?: string;
  }): Promise<string | null>;
}

/**
 * Resolve how THIS print job renders. Returns `{ blankLetterhead }`, or null
 * when the user dismissed the question (the caller then prints nothing).
 * No prompt at all when the lab hasn't turned the letterpad setting on.
 */
export async function askPrintLetterhead(
  template: Pick<ReportTemplate, 'letterpadMode'> | null | undefined,
  dialog: PrintChoiceDialog,
): Promise<{ blankLetterhead: boolean } | null> {
  if (!template?.letterpadMode) return { blankLetterhead: false };
  const pick = await dialog.choose({
    title: 'Print this report on…',
    confirmLabel: 'Print',
    cancelLabel: 'Cancel',
    initialChoice: PRINT_CHOICE_LETTERHEAD,
    choices: [
      {
        value: PRINT_CHOICE_LETTERHEAD,
        label: 'Letterhead paper',
        hint: 'Header & footer left blank, for your pre-printed stationery.',
      },
      {
        value: PRINT_CHOICE_PLAIN,
        label: 'Plain paper',
        hint: 'Prints with the lab’s header & footer.',
      },
    ],
  });
  if (pick === null) return null;
  return { blankLetterhead: pick === PRINT_CHOICE_LETTERHEAD };
}
