import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiError } from '../../shared/models/api-response.model';
import { STORAGE_ERROR_MESSAGE, storageErrorInterceptor } from './storage-error.interceptor';

/**
 * DigitalOcean App Platform's gateway silently rewrites a bare 502/503/504
 * answer into its own branded HTML error page, so a real object-storage
 * outage never reached the user as our message (2026-10-01 dev incident,
 * memory/spaces-plain-put.md). The backend now answers a real store fault
 * 424 `storage_error`, which passes the gateway untouched — this interceptor
 * is the one place that turns EITHER shape (the normal 424 JSON body, or a
 * masked HTML 502/503/504 page on an upload) into one clear ApiError.
 */
function setup() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideHttpClient(withInterceptors([storageErrorInterceptor])), provideHttpClientTesting()],
  });
  return { http: TestBed.inject(HttpClient), ctl: TestBed.inject(HttpTestingController) };
}

describe('storageErrorInterceptor', () => {
  it('424 storage_error (JSON body): becomes the one clear ApiError message', async () => {
    const { http, ctl } = setup();
    const req = http.post('/api/patients/p1/documents', new FormData());
    const result = new Promise<unknown>((resolve) => req.subscribe({ error: resolve }));
    ctl.expectOne('/api/patients/p1/documents').flush(
      { success: false, error: 'storage_error', message: 'File storage couldn\'t save the file. Try again shortly.' },
      { status: 424, statusText: 'Failed Dependency' },
    );
    const err = await result;
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe(STORAGE_ERROR_MESSAGE);
    expect((err as ApiError).code).toBe('storage_error');
    ctl.verify();
  });

  it('storage_error is recognised by its code alone — not only on an upload-shaped URL', async () => {
    // The body already says unambiguously what failed; no need to also
    // guess from the URL or body shape the way the defensive case must.
    const { http, ctl } = setup();
    const req = http.get('/api/reports/r1/pdf');
    const result = new Promise<unknown>((resolve) => req.subscribe({ error: resolve }));
    ctl.expectOne('/api/reports/r1/pdf').flush(
      { success: false, error: 'storage_error', message: 'File storage failed.' },
      { status: 424, statusText: 'Failed Dependency' },
    );
    const err = await result;
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe(STORAGE_ERROR_MESSAGE);
    ctl.verify();
  });

  it('a masked HTML 504 page on an upload request (FormData body): still becomes the clear message', async () => {
    const { http, ctl } = setup();
    const req = http.post('/api/uploads/external-report', new FormData());
    const result = new Promise<unknown>((resolve) => req.subscribe({ error: resolve }));
    // Flushing a raw string (not an object) simulates DO's branded HTML page —
    // the real-world shape Angular hands back when the body isn't JSON.
    ctl.expectOne('/api/uploads/external-report').flush('<html>504 Gateway Time-out</html>', {
      status: 504, statusText: 'Gateway Time-out',
    });
    const err = await result;
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe(STORAGE_ERROR_MESSAGE);
    expect((err as ApiError).code).toBe('storage_error');
    ctl.verify();
  });

  it('a masked HTML page on a NON-upload request is left alone (no FormData body, no upload-shaped URL)', async () => {
    const { http, ctl } = setup();
    const req = http.get('/api/orders');
    const result = new Promise<unknown>((resolve) => req.subscribe({ error: resolve }));
    ctl.expectOne('/api/orders').flush('<html>503 Service Unavailable</html>', {
      status: 503, statusText: 'Service Unavailable',
    });
    const err = await result;
    expect(err).not.toBeInstanceOf(ApiError);
    expect((err as { status?: number }).status).toBe(503);
    ctl.verify();
  });

  it('an ordinary JSON error (e.g. validation) passes through untouched', async () => {
    const { http, ctl } = setup();
    const req = http.post('/api/uploads/image', new FormData());
    const result = new Promise<unknown>((resolve) => req.subscribe({ error: resolve }));
    ctl.expectOne('/api/uploads/image').flush(
      { success: false, error: 'UNSUPPORTED_TYPE', message: 'Allowed types: image/png' },
      { status: 400, statusText: 'Bad Request' },
    );
    const err = await result;
    expect(err).not.toBeInstanceOf(ApiError);
    expect((err as { error?: { error?: string } }).error?.error).toBe('UNSUPPORTED_TYPE');
    ctl.verify();
  });

  it('410 file_missing on an upload-shaped URL is left alone — only storage_error / a masked gateway page convert', async () => {
    const { http, ctl } = setup();
    const req = http.get('/api/uploads/file?path=x');
    const result = new Promise<unknown>((resolve) => req.subscribe({ error: resolve }));
    ctl.expectOne('/api/uploads/file?path=x').flush(
      { success: false, error: 'file_missing', message: 'This file is no longer available.' },
      { status: 410, statusText: 'Gone' },
    );
    const err = await result;
    expect(err).not.toBeInstanceOf(ApiError);
    ctl.verify();
  });
});
