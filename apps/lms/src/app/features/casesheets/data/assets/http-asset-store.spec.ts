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

  const tick = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

  it('asset(): a template picture → its details, then its BYTES with the session (blob → object URL, once per id)', async () => {
    const p = store.asset('a1');
    http.expectOne(`${B}/api/casesheets/assets/a1`).flush({
      id: 'a1', purpose: 'template_image', mime: 'image/png', width: 8, height: 6, bytes: 10, createdAt: 'x', url: '/api/casesheets/assets/a1/file',
    });
    await tick();
    const file = http.expectOne(`${B}/api/casesheets/assets/a1/file`);
    expect(file.request.responseType).toBe('blob');
    file.flush(new Blob(['png'], { type: 'image/png' }));
    const link = await p;
    expect(link).toEqual({ assetId: 'a1', width: 8, height: 6, mime: 'image/png', url: 'blob:svg-1' });
    expect(await store.asset('a1')).toBe(link);   // cached: no second fetch
    store.ngOnDestroy();
    expect(revoked).toContain('blob:svg-1');
  });

  it('asset(): a photo of the open sheet (not a template) → /photos/{id}/info, then its bytes', async () => {
    store.forSheet('s1');
    const p = store.asset('ph1');
    http.expectOne(`${B}/api/casesheets/assets/ph1`).flush({ status: 404, code: 'not_found' }, { status: 404, statusText: 'Not Found' });
    await tick();
    http.expectOne(`${B}/api/casesheets/sheets/s1/photos/ph1/info`).flush({ id: 'ph1', mime: 'image/jpeg', width: 4, height: 3, url: '/api/casesheets/sheets/s1/photos/ph1' });
    await tick();
    http.expectOne(`${B}/api/casesheets/sheets/s1/photos/ph1`).flush(new Blob(['jpg'], { type: 'image/jpeg' }));
    expect((await p).url).toMatch(/^blob:/);
  });

  it('an uploaded photo is shown from its bytes without another lookup; never an anonymous /files link', async () => {
    store.forSheet('s1');
    const up = store.uploadPhoto(new Blob(['x'], { type: 'image/jpeg' }));
    http.expectOne(`${B}/api/casesheets/sheets/s1/photos`).flush({ id: 'ph2', mime: 'image/jpeg', width: 4, height: 3, url: '/api/casesheets/sheets/s1/photos/ph2' });
    await up;
    const p = store.asset('ph2');
    await tick();
    http.expectOne(`${B}/api/casesheets/sheets/s1/photos/ph2`).flush(new Blob(['x'], { type: 'image/jpeg' }));
    expect((await p).url).toMatch(/^blob:/);
    http.expectNone((r) => r.url.includes('/api/casesheets/files'));
  });
});
