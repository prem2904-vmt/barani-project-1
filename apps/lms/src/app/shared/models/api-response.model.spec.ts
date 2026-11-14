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

describe('ApiError.from() — a failure with no server words is said in plain language', () => {
  const plain = (status: number, error: unknown = null) => ApiError.from(new HttpErrorResponse({ status, error, statusText: 'x', url: 'https://x.test/api/a' })).message;

  it('never shows Angular\'s "Http failure response" text', () => {
    for (const s of [0, 401, 403, 404, 408, 429, 500, 502, 503, 504]) {
      expect(plain(s)).not.toMatch(/Http failure|Unknown Error|\b\d{3}\b/);
    }
  });

  it('a dropped connection (status 0) says to check the connection', () => {
    expect(plain(0)).toMatch(/connection/i);
  });

  it('429 says to try again later; 5xx says it is on our side; 403 says no permission', () => {
    expect(plain(429)).toMatch(/try again later/i);
    expect(plain(500)).toMatch(/on our side/i);
    expect(plain(502)).toMatch(/on our side/i);
    expect(plain(403)).toMatch(/permission/i);
    expect(plain(504)).toMatch(/too long/i);
  });

  it('the server\'s own words always win over the plain fallback', () => {
    expect(plain(429, { success: false, message: 'Wait 30 seconds' })).toBe('Wait 30 seconds');
    expect(plain(500, { success: false, error: 'smtp_failed' })).toBe('smtp_failed');
  });

  it('a dropped connection whose body is the browser\'s TypeError ("Failed to fetch") is still said plainly', () => {
    const e = ApiError.from(new HttpErrorResponse({ status: 0, error: new TypeError('Failed to fetch'), url: 'https://x.test/api/a' }));
    expect(e.message).toMatch(/connection/i);
    expect(e.message).not.toMatch(/Failed to fetch/);
  });

  it('keeps the HTTP status on the error so callers never parse the message for it', () => {
    expect(ApiError.from(new HttpErrorResponse({ status: 404, error: null })).status).toBe(404);
    expect(ApiError.from(new HttpErrorResponse({ status: 0, error: new TypeError('Failed to fetch') })).status).toBe(0);
    expect(ApiError.from(new HttpErrorResponse({ status: 409, error: { success: false, error: 'dup', message: 'Already there' } })).status).toBe(409);
  });

  it('a plain Error (a timeout) keeps its own message', () => {
    expect(ApiError.from(new Error('Request timed out — check your connection')).message).toBe('Request timed out — check your connection');
  });
});
