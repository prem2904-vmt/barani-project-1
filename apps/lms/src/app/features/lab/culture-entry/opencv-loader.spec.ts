import { OPENCV_ASSET, loadOpenCv, openCvUrl, resetOpenCvLoader } from './opencv-loader';

/** OpenCV.js is BUNDLED (same-origin static asset), lazy, no CDN. */

afterEach(() => {
  resetOpenCvLoader();
  document.querySelectorAll('script[src*="opencv"]').forEach(s => s.remove());
  delete (window as unknown as { cv?: unknown }).cv;
});

describe('OpenCV loader — the bundled asset', () => {
  it('points at the local asset under the document base, never a CDN', () => {
    expect(OPENCV_ASSET).toBe('assets/vendor/opencv/opencv.js');
    expect(openCvUrl('https://lab.example.com/')).toBe('https://lab.example.com/assets/vendor/opencv/opencv.js');
    expect(openCvUrl('capacitor://localhost/')).toContain('assets/vendor/opencv/opencv.js');
    expect(openCvUrl()).not.toMatch(/jsdelivr|cdnjs|unpkg|http[s]?:\/\/cdn/);
  });

  it('is lazy: no script until asked; one tag for concurrent callers; resolves the ready module', async () => {
    expect(document.querySelector('script[src*="opencv"]')).toBeNull();
    const a = loadOpenCv(), b = loadOpenCv();
    const tags = document.querySelectorAll<HTMLScriptElement>('script[src*="opencv"]');
    expect(tags.length).toBe(1);
    expect(tags[0].src).toContain('/assets/vendor/opencv/opencv.js');
    // The Emscripten module: a thenable that becomes ready later.
    const mod: any = { then: (f: (m: unknown) => void) => f(mod) };
    (window as unknown as { cv: unknown }).cv = mod;
    tags[0].dispatchEvent(new Event('load'));
    mod.Mat = function Mat() { /* */ };
    const cv = await a;
    expect(cv).toBe(mod);
    expect(cv.then).toBeUndefined();          // stripped — awaiting it must not loop
    expect(await b).toBe(mod);
  });

  it('a failed local load rejects (the modal falls back to manual) and can be retried', async () => {
    const p = loadOpenCv();
    document.querySelector<HTMLScriptElement>('script[src*="opencv"]')!.dispatchEvent(new Event('error'));
    await expect(p).rejects.toThrow(/failed to load/);
    expect(document.querySelector('script[src*="opencv"]')).toBeNull();
    const again = loadOpenCv();
    expect(document.querySelectorAll('script[src*="opencv"]').length).toBe(1);
    (window as unknown as { cv: unknown }).cv = { Mat: function Mat() { /* */ } };
    document.querySelector<HTMLScriptElement>('script[src*="opencv"]')!.dispatchEvent(new Event('load'));
    await expect(again).resolves.toBeTruthy();
  });
});
