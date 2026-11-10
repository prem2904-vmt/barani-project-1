import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CASESHEETS_FLAG_KEY, CASESHEETS_HEADER } from './casesheet-gate';
import { casesheetHeaderInterceptor } from './casesheet-header.interceptor';

/** Case sheets — X-PF-CASESHEETS: 1 rides API calls only after pf.casesheets(). */
let store: Record<string, string> = {};
function setup(flag: boolean) {
  store = flag ? { [CASESHEETS_FLAG_KEY]: '1' } : {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  });
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideHttpClient(withInterceptors([casesheetHeaderInterceptor])), provideHttpClientTesting()],
  });
  return { http: TestBed.inject(HttpClient), ctl: TestBed.inject(HttpTestingController) };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('casesheetHeaderInterceptor', () => {
  it('flag off (everyone by default): API requests are untouched', () => {
    const { http, ctl } = setup(false);
    http.get('/api/orders').subscribe();
    http.get('https://med-fetch-dev.prefrontal.health/api/casesheets/forms').subscribe();
    for (const r of [ctl.expectOne('/api/orders'), ctl.expectOne('https://med-fetch-dev.prefrontal.health/api/casesheets/forms')]) {
      expect(r.request.headers.has(CASESHEETS_HEADER)).toBe(false);
      r.flush({});
    }
    ctl.verify();
  });

  it('flag on: every API request carries X-PF-CASESHEETS: 1', () => {
    const { http, ctl } = setup(true);
    http.get('https://med-fetch-dev.prefrontal.health/api/casesheets/forms').subscribe();
    http.post('/api/orders', {}).subscribe();
    for (const r of [ctl.expectOne('https://med-fetch-dev.prefrontal.health/api/casesheets/forms'), ctl.expectOne('/api/orders')]) {
      expect(r.request.headers.get(CASESHEETS_HEADER)).toBe('1');
      r.flush({});
    }
    ctl.verify();
  });

  it('flag on: third-party URLs never get the header', () => {
    const { http, ctl } = setup(true);
    for (const url of ['https://prefrontal.sgp1.digitaloceanspaces.com/t/r.pdf', 'https://x.supabase.co/auth/v1/token']) {
      http.get(url).subscribe();
      const r = ctl.expectOne(url);
      expect(r.request.headers.has(CASESHEETS_HEADER)).toBe(false);
      r.flush({});
    }
    ctl.verify();
  });
});
