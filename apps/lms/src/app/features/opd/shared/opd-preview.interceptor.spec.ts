import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { OPD_FLAG_KEY, OPD_PREVIEW_HEADER } from './opd-gate';
import { opdPreviewInterceptor } from './opd-preview.interceptor';

/** OPD dark build — X-PF-OPD: 1 rides API calls only after pf.opd(). */
let store: Record<string, string> = {};
function setup(flag: boolean) {
  store = flag ? { [OPD_FLAG_KEY]: '1' } : {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  });
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideHttpClient(withInterceptors([opdPreviewInterceptor])), provideHttpClientTesting()],
  });
  return { http: TestBed.inject(HttpClient), ctl: TestBed.inject(HttpTestingController) };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('opdPreviewInterceptor', () => {
  it('flag off (everyone by default): API requests are untouched', () => {
    const { http, ctl } = setup(false);
    http.get('/api/orders').subscribe();
    http.get('https://med-fetch-dev.prefrontal.health/api/opd/visits').subscribe();
    for (const r of [ctl.expectOne('/api/orders'), ctl.expectOne('https://med-fetch-dev.prefrontal.health/api/opd/visits')]) {
      expect(r.request.headers.has(OPD_PREVIEW_HEADER)).toBe(false);
      r.flush({});
    }
    ctl.verify();
  });

  it('flag on: every API request carries X-PF-OPD: 1', () => {
    const { http, ctl } = setup(true);
    http.get('https://med-fetch-dev.prefrontal.health/api/opd/visits').subscribe();
    http.post('/api/orders', {}).subscribe();
    for (const r of [ctl.expectOne('https://med-fetch-dev.prefrontal.health/api/opd/visits'), ctl.expectOne('/api/orders')]) {
      expect(r.request.headers.get(OPD_PREVIEW_HEADER)).toBe('1');
      r.flush({});
    }
    ctl.verify();
  });

  it('flag on: third-party URLs never get the header', () => {
    const { http, ctl } = setup(true);
    http.get('https://prefrontal.sgp1.digitaloceanspaces.com/t/r.pdf').subscribe();
    const r = ctl.expectOne('https://prefrontal.sgp1.digitaloceanspaces.com/t/r.pdf');
    expect(r.request.headers.has(OPD_PREVIEW_HEADER)).toBe(false);
    r.flush({});
    ctl.verify();
  });
});
