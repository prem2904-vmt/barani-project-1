/**
 * Lazy OpenCV.js loader for the plate-measure modal.
 *
 * Choice (owner, documented in ND-PATTERN §13): OpenCV.js 4.10 is BUNDLED
 * with the app as a static asset — the unmodified single-file build of
 * @techstark/opencv-js@4.10.0-release.1, vendored at
 * apps/lms/public/assets/vendor/opencv/opencv.js and served same-origin as
 * `assets/vendor/opencv/opencv.js` (web, Electron, the Capacitor app,
 * offline). It is ~10 MB (~3.4 MB gzipped), so it is NEVER in the app
 * bundle: the script tag is injected the first time the Measure modal
 * needs it. No CDN fallback. One in-flight promise is shared; a failed
 * load can be retried.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CV = any;

/** Relative to the document base, so it resolves under any base href
 *  (web, the Capacitor webview, Electron's file://). */
export const OPENCV_ASSET = 'assets/vendor/opencv/opencv.js';

export function openCvUrl(base: string = typeof document !== 'undefined' ? document.baseURI : ''): string {
  try { return new URL(OPENCV_ASSET, base).href; } catch { return OPENCV_ASSET; }
}

let pending: Promise<CV> | null = null;

export function loadOpenCv(timeoutMs = 90_000): Promise<CV> {
  if (pending) return pending;
  pending = new Promise<CV>((resolve, reject) => {
    const w = window as unknown as { cv?: CV };
    const timer = setTimeout(() => reject(new Error('OpenCV load timed out')), timeoutMs);
    // The Emscripten module is a THENABLE whose then() hands back itself:
    // resolving a promise with it (or awaiting it) loops forever. Strip
    // `then` before handing it on.
    const done = (cv: CV) => { clearTimeout(timer); try { delete cv.then; } catch { /* */ } resolve(cv); };
    const settle = (cv: CV) => {
      if (!cv) { clearTimeout(timer); reject(new Error('OpenCV unavailable')); return; }
      if (cv.Mat) { done(cv); return; }
      if (typeof cv.then === 'function') { cv.then((c: CV) => done(c)); return; }
      cv.onRuntimeInitialized = () => done(cv);
    };
    if (w.cv) { settle(w.cv); return; }
    const s = document.createElement('script');
    s.src = openCvUrl();
    s.async = true;
    s.onload = () => settle(w.cv);
    s.onerror = () => { clearTimeout(timer); s.remove(); reject(new Error('OpenCV failed to load')); };
    document.head.appendChild(s);
  }).catch(e => { pending = null; throw e; });
  return pending;
}

/** Tests only: forget the cached load. */
export function resetOpenCvLoader(): void { pending = null; }
