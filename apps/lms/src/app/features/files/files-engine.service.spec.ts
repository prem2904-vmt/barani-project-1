import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { FilesEngineService, engineMissingMessage } from './files-engine.service';
import { FILES_APPS } from './files-registry';

const res = (ok: boolean, body: string) => ({ ok, text: async () => body }) as unknown as Response;

describe('FilesEngineService: is the engine part of this build?', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a real engine page (it names its wasm) is available, once, and the answer is remembered', async () => {
    const f = vi.fn(async () => res(true, '<link rel="preload" href="neuron-1_bg.wasm">'));
    vi.stubGlobal('fetch', f);
    const svc = TestBed.inject(FilesEngineService);
    expect(await svc.available(FILES_APPS[0], 'http://app.test/')).toBe(true);
    expect(await svc.available(FILES_APPS[0], 'http://app.test/')).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledWith('http://app.test/neuron-engine/index.html', { cache: 'no-store' });
  });

  it('a missing folder (404) or the app\'s own page served as a fallback is NOT an engine', async () => {
    const svc = TestBed.inject(FilesEngineService);
    vi.stubGlobal('fetch', vi.fn(async () => res(false, '')));
    expect(await svc.available(FILES_APPS[1], 'http://app.test/')).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => res(true, '<app-root></app-root><script src="main.js"></script>')));
    expect(await svc.available(FILES_APPS[2], 'http://app.test/')).toBe(false);
  });

  it('a network error never claims the engine is missing (the editor shows its normal states)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    expect(await TestBed.inject(FilesEngineService).available(FILES_APPS[3], 'http://app.test/')).toBe(true);
  });

  it('the plain words name the app', () => {
    expect(engineMissingMessage(FILES_APPS[1])).toBe("Synapse isn't available in this build yet. Ask your admin, or try again after the next update.");
  });
});
