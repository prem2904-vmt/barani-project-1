import { HttpErrorResponse } from '@angular/common/http';
import { ApiError } from './api-response.model';

/**
 * ApiError.from() is the ONE place every storage-visible screen turns a
 * failed HTTP call into a message it can toast (report PDF view/download/
 * print, result-entry attachments, chat attachments, patient documents,
 * expenses/vendor proof uploads, OPD/pharmacy media, culture-plate photos —
 * grep for `ApiError.from(` across apps/lms/src/app).
 *
 * Storage failures answer 503 with a friendly server-authored `message`
 * (never the SDK/exception text — see docs/ENGINEERING-RULES.md "A storage
 * write failure is never a bare 500") for storage_error / storage_unavailable
 * / storage_unconfigured, and 410 file_missing for a vanished object. These
 * specs pin that ApiError.from() surfaces the server's friendly message for
 * every one of those codes and NEVER falls back to raw SDK/exception text —
 * the dev incident this suite exists for was
 * "Amazon.Runtime.Internal.HttpErrorResponseException" reaching the UI.
 */
describe('ApiError.from() — storage failure codes never leak raw exception text', () => {
  const cases: Array<{ code: string; serverMessage: string }> = [
    { code: 'storage_error', serverMessage: "File storage couldn't save the file. Try again shortly." },
    { code: 'storage_unavailable', serverMessage: 'File storage is unavailable. Try again shortly.' },
    { code: 'storage_unconfigured', serverMessage: 'File storage is not configured.' },
    { code: 'file_missing', serverMessage: 'This file is no longer available. Upload it again.' },
  ];

  for (const { code, serverMessage } of cases) {
    it(`maps a ${code} ApiResponse.Fail body to its friendly server message`, () => {
      const resp = new HttpErrorResponse({
        status: code === 'file_missing' ? 410 : 503,
        error: { success: false, error: code, message: serverMessage },
      });
      const err = ApiError.from(resp);
      expect(err.message).toBe(serverMessage);
      expect(err.code).toBe(code);
      // Back-compat shim used by un-migrated handlers reading e.error.message.
      expect(err.error.message).toBe(serverMessage);
    });
  }

  it('a bare 500 with a raw SDK/exception-text body still surfaces only a generic fallback, never the exception text', () => {
    // The dev incident: before the backend fix (commit 6302d89, "a storage
    // write failure answers 503 storage_error, never a bare 500"), an
    // unhandled AmazonServiceException produced ASP.NET's default developer
    // exception response — plain text, not the { success, error, message }
    // shape. ApiError.from() must never surface that text to a toast.
    const raw = 'Amazon.Runtime.Internal.HttpErrorResponseException: The service is unavailable.\n   at Amazon.S3...';
    const resp = new HttpErrorResponse({ status: 500, error: raw, statusText: 'Internal Server Error',
      url: 'https://med-fetch-dev.prefrontal.health/api/uploads/result-file' });
    const err = ApiError.from(resp);
    expect(err.message).not.toContain('Amazon.');
    expect(err.message).not.toContain('HttpErrorResponseException');
    expect(err.message).not.toContain(raw);
    // Angular's own synthesized message ("Http failure response for ...")
    // is the only acceptable fallback here — still not the SDK text.
    expect(err.message.length).toBeGreaterThan(0);
  });

  it('a body that is a string (non-JSON error page) never has its text quoted back at the user', () => {
    const resp = new HttpErrorResponse({ status: 502, error: '<html><body>502 Bad Gateway</body></html>' });
    const err = ApiError.from(resp);
    expect(err.message).not.toContain('<html>');
    expect(err.message).not.toContain('Bad Gateway');
  });

  it('an ApiError instance passes through unchanged', () => {
    const original = new ApiError('File storage is unavailable. Try again shortly.', 'storage_unavailable');
    expect(ApiError.from(original)).toBe(original);
  });
});
