import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { FILE_MISSING_MESSAGE, UploadsService, brandingSrc } from './uploads.service';
import { ToastService } from './toast.service';
import { PlatformService } from './platform.service';
import {
  absoluteApiUrl, fetchAssetBlob, isAuthedApiFilePath, isOpdMediaPath, isPrivateUploadPath, registerUploadFetcher, uploadPathOf,
} from '../../shared/utils/upload-fetch';

/** Private uploads: "/uploads/…" is served only to the session (GET
 *  /api/uploads/file) or via a signed URL — never a bare public link. */
const PATH = '/uploads/0b8f5f4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b/abc.png';

function setup(get = vi.fn(() => of(new Blob(['png'], { type: 'image/png' }))),
               post = vi.fn(() => of({ success: true, data: { [PATH]: `${PATH}?exp=1&sig=s` } }))) {
  TestBed.configureTestingModule({
    providers: [
      { provide: HttpClient, useValue: { get, post } },
      { provide: PlatformService, useValue: { getApiUrl: () => 'https://api.test' } },
    ],
  });
  return { svc: TestBed.inject(UploadsService), get, post };
}

describe('upload-fetch utils', () => {
  it('only unsigned /uploads paths are private', () => {
    expect(isPrivateUploadPath(PATH)).toBe(true);
    expect(isPrivateUploadPath(`${PATH}?exp=1&sig=x`)).toBe(false);
    expect(isPrivateUploadPath('https://cdn/x.png')).toBe(false);
    expect(isPrivateUploadPath('data:image/png;base64,AA==')).toBe(false);
    expect(isPrivateUploadPath(null)).toBe(false);
  });

  it('absoluteApiUrl prefixes server-relative URLs only', () => {
    expect(absoluteApiUrl('/uploads/a.png', 'https://api.test/')).toBe('https://api.test/uploads/a.png');
    expect(absoluteApiUrl('blob:x', 'https://api.test')).toBe('blob:x');
    expect(absoluteApiUrl('https://cdn/x', 'https://api.test')).toBe('https://cdn/x');
  });

  it('fetchAssetBlob: signed map wins, private paths use the session fetcher, never a bare /uploads GET', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Blob(['x'])));
    const authedBlob = new Blob(['authed']);
    const authed = vi.fn(async () => authedBlob);
    registerUploadFetcher(authed);
    try {
      await fetchAssetBlob(PATH, 'https://api.test', { [PATH]: `${PATH}?exp=1&sig=s` });
      expect(fetchSpy).toHaveBeenCalledWith(`https://api.test${PATH}?exp=1&sig=s`, { mode: 'cors' });
      expect(authed).not.toHaveBeenCalled();

      fetchSpy.mockClear();
      const b = await fetchAssetBlob(PATH, 'https://api.test');
      expect(authed).toHaveBeenCalledWith(PATH);
      expect(b).toBe(authedBlob);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      registerUploadFetcher(null);
      fetchSpy.mockRestore();
    }
  });
});

describe('UploadsService', () => {
  it('src(): empty while loading, then a blob: URL fetched from the authenticated endpoint', async () => {
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    try {
      const { svc, get } = setup();
      expect(svc.src(PATH)).toBe('');
      await svc.objectUrl(PATH);
      expect(get).toHaveBeenCalledWith('https://api.test/api/uploads/file',
        { params: { path: PATH }, responseType: 'blob' });
      expect(svc.src(PATH)).toBe('blob:mock');
      // Cached: no second request.
      await svc.objectUrl(PATH);
      expect(get).toHaveBeenCalledTimes(1);
    } finally {
      createUrl.mockRestore();
    }
  });

  it('src(): non-upload URLs pass through (resolved against the API)', () => {
    const { svc, get } = setup();
    expect(svc.src('https://cdn/x.png')).toBe('https://cdn/x.png');
    expect(svc.src('data:image/png;base64,AA==')).toBe('data:image/png;base64,AA==');
    expect(svc.src(`${PATH}?exp=1&sig=s`)).toBe(`https://api.test${PATH}?exp=1&sig=s`);
    expect(get).not.toHaveBeenCalled();
  });

  it('a failed fetch yields no URL (the view keeps its placeholder)', async () => {
    const { svc } = setup(vi.fn(() => throwError(() => new Error('404'))));
    expect(await svc.objectUrl(PATH)).toBeNull();
    expect(svc.src(PATH)).toBe('');
  });

  it('signed(): asks the server for own paths only and returns absolute URLs', async () => {
    const { svc, post } = setup();
    const map = await svc.signed([PATH, 'https://cdn/x.png']);
    expect(post).toHaveBeenCalledWith('https://api.test/api/uploads/sign', { paths: [PATH] });
    expect(map[PATH]).toBe(`https://api.test${PATH}?exp=1&sig=s`);
  });

  it('open(): opens the tab inside the click, then shows the bytes from the AUTHENTICATED fetch — no signed link, no HEAD probe', async () => {
    const tab = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:file');
    try {
      const { svc, get, post } = setup();
      expect(await svc.open(PATH)).toBe('opened');
      expect(open).toHaveBeenCalledWith('', '_blank');
      expect(get).toHaveBeenCalledWith('https://api.test/api/uploads/file', { params: { path: PATH }, responseType: 'blob' });
      expect(post).not.toHaveBeenCalled();        // no bearer (signed) URL for patient files
      expect(fetchSpy).not.toHaveBeenCalled();    // no HEAD pre-check
      expect(tab.opener).toBeNull();
      expect(tab.location.href).toBe('blob:file');
    } finally {
      open.mockRestore();
      fetchSpy.mockRestore();
      createUrl.mockRestore();
    }
  });

  it('open(): a file the server no longer has (410) closes the tab and asks for a re-upload', async () => {
    const tab = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const gone = new HttpErrorResponse({ status: 410, error: { error: 'file_missing' } });
    try {
      const { svc, get } = setup(vi.fn(() => throwError(() => gone)));
      const toasts = TestBed.inject(ToastService);
      const err = vi.spyOn(toasts, 'error');
      expect(await svc.open(PATH)).toBe('missing');
      expect(tab.close).toHaveBeenCalled();
      expect(tab.location.href).toBe('');
      expect(err).toHaveBeenCalledWith(FILE_MISSING_MESSAGE, 6000);
      expect(svc.isMissing(PATH)).toBe(true);
      expect(svc.isMissing(`https://api.test${PATH}`)).toBe(true);
      // Known gone: a second click answers at once, without a request or a tab.
      open.mockClear();
      expect(await svc.open(PATH)).toBe('missing');
      expect(open).not.toHaveBeenCalled();
      expect(get).toHaveBeenCalledTimes(1);
    } finally {
      open.mockRestore();
    }
  });

  it('open(): a network failure closes the tab and says so (the file is not marked missing)', async () => {
    const tab = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    try {
      const { svc } = setup(vi.fn(() => throwError(() => new HttpErrorResponse({ status: 0 }))));
      expect(await svc.open(PATH)).toBe('failed');
      expect(tab.close).toHaveBeenCalled();
      expect(svc.isMissing(PATH)).toBe(false);
    } finally {
      open.mockRestore();
    }
  });

  it('blob(): one request per file per session — concurrent and later callers share it (PDF renders re-use logos / signatures)', async () => {
    const { svc, get } = setup();
    const [a, b] = await Promise.all([svc.blob(PATH), svc.blob(PATH)]);
    const c = await svc.blob(`https://api.test${PATH}`);
    expect(get).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(c).toBe(a);
  });

  it('blob(): a 410 is never re-requested; a failure is not retried on every re-render', async () => {
    const gone = new HttpErrorResponse({ status: 410, error: { error: 'file_missing' } });
    const { svc, get } = setup(vi.fn(() => throwError(() => gone)));
    await svc.blob(PATH);
    await svc.blob(PATH);
    expect(svc.src(PATH)).toBe('');
    expect(get).toHaveBeenCalledTimes(1);

    TestBed.resetTestingModule();
    const flaky = setup(vi.fn(() => throwError(() => new HttpErrorResponse({ status: 503 }))));
    await flaky.svc.blob(PATH);
    await flaky.svc.blob(PATH);
    expect(flaky.svc.src(PATH)).toBe('');
    expect(flaky.get).toHaveBeenCalledTimes(1);
  });

  it('blob(): 410 file_missing marks the file missing; other errors do not', async () => {
    const gone = new HttpErrorResponse({ status: 410, error: { error: 'file_missing' } });
    const { svc } = setup(vi.fn(() => throwError(() => gone)));
    expect(await svc.blob(PATH)).toBeNull();
    expect(svc.isMissing(PATH)).toBe(true);

    TestBed.resetTestingModule();
    const other = setup(vi.fn(() => throwError(() => new HttpErrorResponse({ status: 503 }))));
    expect(await other.svc.blob(PATH)).toBeNull();
    expect(other.svc.isMissing(PATH)).toBe(false);
  });
});

describe('absolute links to our own /uploads (older stored rows)', () => {
  it('uploadPathOf maps only unsigned API-host upload links to the stored path', () => {
    expect(uploadPathOf(`https://api.test${PATH}`, 'https://api.test')).toBe(PATH);
    expect(uploadPathOf(`https://api.test${PATH}?exp=1&sig=s`, 'https://api.test')).toBe(`https://api.test${PATH}?exp=1&sig=s`);
    expect(uploadPathOf(`https://cdn.example${PATH}`, 'https://api.test')).toBe(`https://cdn.example${PATH}`);
    expect(uploadPathOf('https://api.test/logo.png', 'https://api.test')).toBe('https://api.test/logo.png');
    expect(uploadPathOf(PATH, 'https://api.test')).toBe(PATH);
    expect(uploadPathOf('data:image/png;base64,AA==', 'https://api.test')).toBe('data:image/png;base64,AA==');
    expect(uploadPathOf(`https://api.test${PATH}`, '')).toBe(`https://api.test${PATH}`);
  });

  it('fetchAssetBlob sends an absolute API upload link through the session, not a bare GET', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Blob(['x'])));
    const authed = vi.fn(async () => new Blob(['authed']));
    registerUploadFetcher(authed);
    try {
      await fetchAssetBlob(`https://api.test${PATH}`, 'https://api.test');
      expect(authed).toHaveBeenCalledWith(PATH);
      expect(fetchSpy).not.toHaveBeenCalled();

      // Public report page: the signed map is keyed by the stored path.
      authed.mockClear();
      await fetchAssetBlob(`https://api.test${PATH}`, 'https://api.test', { [PATH]: `${PATH}?exp=1&sig=s` });
      expect(fetchSpy).toHaveBeenCalledWith(`https://api.test${PATH}?exp=1&sig=s`, { mode: 'cors' });
      expect(authed).not.toHaveBeenCalled();
    } finally {
      registerUploadFetcher(null);
      fetchSpy.mockRestore();
    }
  });

  it('src(): an absolute API upload link loads via the authenticated endpoint', async () => {
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:abs');
    try {
      const { svc, get } = setup();
      expect(svc.src(`https://api.test${PATH}`)).toBe('');
      await svc.objectUrl(`https://api.test${PATH}`);
      expect(get).toHaveBeenCalledWith('https://api.test/api/uploads/file',
        { params: { path: PATH }, responseType: 'blob' });
      expect(svc.src(`https://api.test${PATH}`)).toBe('blob:abs');
    } finally {
      createUrl.mockRestore();
    }
  });
});

describe('OPD media paths (consult files, a walk-in prescription — task: authed display)', () => {
  const VISIT = 'a1b2c3d4-0000-0000-0000-000000000001';
  const SALE = 'a1b2c3d4-0000-0000-0000-000000000002';
  const MEDIA = `/api/opd/consult/${VISIT}/media/file?key=tenants%2Ft%2Fopd%2Fconsult%2Fabc.jpg&type=image%2Fjpeg`;
  const RX = `/api/opd/pharmacy/counter/${SALE}/prescription/file`;

  it('isOpdMediaPath recognises the consult and prescription file endpoints only', () => {
    expect(isOpdMediaPath(MEDIA)).toBe(true);
    expect(isOpdMediaPath(RX)).toBe(true);
    expect(isOpdMediaPath(`/api/opd/consult/${VISIT}/media`)).toBe(false);          // the JSON-url endpoint, not the stream
    expect(isOpdMediaPath(`/api/opd/pharmacy/counter/${SALE}/prescription`)).toBe(false);
    expect(isOpdMediaPath('/uploads/x.png')).toBe(false);
    expect(isOpdMediaPath(null)).toBe(false);
  });

  it('isAuthedApiFilePath covers both /uploads/… and the OPD media endpoints', () => {
    expect(isAuthedApiFilePath(MEDIA)).toBe(true);
    expect(isAuthedApiFilePath(RX)).toBe(true);
    expect(isAuthedApiFilePath(PATH)).toBe(true);
    expect(isAuthedApiFilePath('https://cdn/x.png')).toBe(false);
  });

  it('blob(): an OPD media path is fetched at that EXACT url (not wrapped in /api/uploads/file) — HttpClient, so auth interceptors apply', async () => {
    const { svc, get } = setup();
    const b = await svc.blob(MEDIA);
    expect(get).toHaveBeenCalledWith(`https://api.test${MEDIA}`, { responseType: 'blob' });
    expect(b).toBeInstanceOf(Blob);
  });

  it('blob(): one request per OPD media path per session — concurrent and later callers share it', async () => {
    const { svc, get } = setup();
    const [a, b] = await Promise.all([svc.blob(MEDIA), svc.blob(MEDIA)]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('open(): the prescription viewer fetches through the authenticated endpoint, never a bare window.open of the raw path', async () => {
    const tab = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rx');
    try {
      const { svc, get } = setup();
      expect(await svc.open(RX)).toBe('opened');
      expect(get).toHaveBeenCalledWith(`https://api.test${RX}`, { responseType: 'blob' });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(tab.location.href).toBe('blob:rx');
    } finally {
      open.mockRestore();
      fetchSpy.mockRestore();
      createUrl.mockRestore();
    }
  });

  it('a gone (410) consult file is remembered missing, the same as an /uploads/… file', async () => {
    const gone = new HttpErrorResponse({ status: 410, error: { error: 'file_missing' } });
    const { svc } = setup(vi.fn(() => throwError(() => gone)));
    expect(await svc.blob(MEDIA)).toBeNull();
    expect(svc.isMissing(MEDIA)).toBe(true);
  });
});

describe('brandingSrc (tenant logo in the bars / band)', () => {
  it('data: / absolute / signed logos pass through without constructing UploadsService', () => {
    const injector = { get: vi.fn() } as unknown as Injector;
    expect(brandingSrc(injector, 'data:image/png;base64,AA==')).toBe('data:image/png;base64,AA==');
    expect(brandingSrc(injector, 'https://cdn.example/logo.png')).toBe('https://cdn.example/logo.png');
    expect(brandingSrc(injector, `${PATH}?exp=1&sig=s`)).toBe(`${PATH}?exp=1&sig=s`);
    expect(brandingSrc(injector, null)).toBeNull();
    expect(brandingSrc(injector, '')).toBeNull();
    expect(injector.get).not.toHaveBeenCalled();
  });

  it('a private "/uploads/…" logo (bare or absolute) goes through UploadsService.src; null until it lands', () => {
    const src = vi.fn().mockReturnValueOnce('').mockReturnValue('blob:logo');
    const injector = { get: vi.fn(() => ({ src })) } as unknown as Injector;
    expect(brandingSrc(injector, PATH)).toBeNull();
    expect(brandingSrc(injector, `https://api.test${PATH}`)).toBe('blob:logo');
    expect(injector.get).toHaveBeenCalledWith(UploadsService);
    expect(src).toHaveBeenCalledWith(PATH);
    expect(src).toHaveBeenCalledWith(`https://api.test${PATH}`);
  });
});
