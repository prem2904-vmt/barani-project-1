/**
 * Background report work (store the final PDF after validation, archive the PDF
 * before a WhatsApp send) renders through report-blob, whose lazy imports can
 * still be loading when a unit spec's environment is torn down — that fails the
 * WHOLE run with EnvironmentTeardownError, blamed on whichever specs shared the
 * worker (release gate 2026-11-22). test-setup.ts switches it off; specs that
 * test these paths pass their own `store` and are unaffected. Always on in the app.
 */
let on = true;

export function backgroundReportLoadsOn(): boolean { return on; }

export function setBackgroundReportLoadsForTests(value: boolean): void { on = value; }
