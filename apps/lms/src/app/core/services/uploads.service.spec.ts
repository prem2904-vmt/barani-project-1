import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { UploadsService } from './uploads.service';
import { PlatformService } from './platform.service';
import {
  absoluteApiUrl, fetchAssetBlob, isPrivateUploadPath, registerUploadFetcher,
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
