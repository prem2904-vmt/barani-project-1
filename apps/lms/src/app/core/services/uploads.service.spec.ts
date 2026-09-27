import { HttpClient } from '@angular/common/http';
import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { UploadsService, brandingSrc } from './uploads.service';
import { PlatformService } from './platform.service';
import {
  absoluteApiUrl, fetchAssetBlob, isPrivateUploadPath, registerUploadFetcher, uploadPathOf,
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

  it('open(): opens the tab inside the click, then points it at the signed URL', async () => {
    const tab = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    try {
      const { svc } = setup();
      await svc.open(PATH);
      expect(open).toHaveBeenCalledWith('', '_blank');
      expect(tab.opener).toBeNull();
      expect(tab.location.href).toBe(`https://api.test${PATH}?exp=1&sig=s`);
    } finally {
      open.mockRestore();
    }
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
