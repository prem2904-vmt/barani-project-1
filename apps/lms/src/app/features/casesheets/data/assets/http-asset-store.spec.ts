import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../../../environments/environment';
import { HttpAssetStore } from './http-asset-store';

const B = environment.apiUrl.replace(/\/+$/, '');

describe('HttpAssetStore starter pictures', () => {
  let store: HttpAssetStore;
  let http: HttpTestingController;
  let created: string[];
  let revoked: string[];

  beforeEach(() => {
    created = [];
    revoked = [];
    let n = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const u = `blob:svg-${++n}`;
      created.push(u);
      return u;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => void revoked.push(u));
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), HttpAssetStore] });
    store = TestBed.inject(HttpAssetStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => vi.restoreAllMocks());

  it('the SVG is fetched through HttpClient as a blob and svgUrl is an object URL, never the API URL', async () => {
    const p = store.starters();
    http.expectOne(`${B}/api/casesheets/canvas/templates`).flush({
      items: [{ id: 'hand', title: 'Hand', width: 10, height: 10, regionCount: 6, svgUrl: '/api/casesheets/canvas/templates/hand.svg' }],
    });
    await Promise.resolve();
    await Promise.resolve();
    const svg = http.expectOne(`${B}/api/casesheets/canvas/templates/hand.svg`);
    expect(svg.request.responseType).toBe('blob');
    svg.flush(new Blob(['<svg/>'], { type: 'image/svg+xml' }));
    const list = await p;
    expect(list[0].svgUrl).toBe('blob:svg-1');
  });

  it('a starter picture detail uses the same helper (one fetch per id) and the object URLs are revoked on destroy', async () => {
    const p = store.starter('foot');
    http.expectOne(`${B}/api/casesheets/canvas/templates/foot`).flush({
      id: 'foot', title: 'Foot', width: 4, height: 4, svgUrl: '/api/casesheets/canvas/templates/foot.svg', regions: [],
    });
    await Promise.resolve();
    await Promise.resolve();
    http.expectOne(`${B}/api/casesheets/canvas/templates/foot.svg`).flush(new Blob(['<svg/>'], { type: 'image/svg+xml' }));
    expect((await p).svgUrl).toBe('blob:svg-1');
    store.ngOnDestroy();
    await Promise.resolve();
    await Promise.resolve();
    expect(revoked).toEqual(['blob:svg-1']);
  });

  it('asset(): GET /api/casesheets/assets/{id} → a fresh absolute signed link', async () => {
    const p = store.asset('a1');
    http.expectOne(`${B}/api/casesheets/assets/a1`).flush({
      id: 'a1', purpose: 'template_image', mime: 'image/png', width: 8, height: 6, bytes: 10, createdAt: 'x',
      url: '/api/casesheets/files/a1?exp=1&sig=2', expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    expect((await p).url).toBe(`${B}/api/casesheets/files/a1?exp=1&sig=2`);
  });
});
