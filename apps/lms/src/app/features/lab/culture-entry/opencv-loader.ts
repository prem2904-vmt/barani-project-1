/**
 * Lazy OpenCV.js loader for the plate-measure modal.
 *
 * Choice (documented in ND-PATTERN §13): OpenCV.js 4.10 from the jsDelivr
 * npm CDN (@techstark/opencv-js — the official build, single file, WASM
 * inlined). It is ~10 MB (~3.4 MB gzipped), so it is NEVER in the app
 * bundle: the script tag is injected the first time the Measure modal needs
 * it, then cached by the browser. One in-flight promise is shared.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CV = any;

export const OPENCV_URL = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js';

let pending: Promise<CV> | null = null;

export function loadOpenCv(timeoutMs = 90_000): Promise<CV> {
  if (pending) return pending;
  pending = new Promise<CV>((resolve, reject) => {
    const w = window as unknown as { cv?: CV };
    // The Emscripten module is a THENABLE whose then() hands back itself:
    // resolving a promise with it (or awaiting it) loops forever. Strip
    // `then` before handing it on.
    const timer = setTimeout(() => reject(new Error('OpenCV load timed out')), timeoutMs);
    const done = (cv: CV) => { clearTimeout(timer); try { delete cv.then; } catch { /* */ } resolve(cv); };
    const settle = (cv: CV) => {
      if (!cv) { reject(new Error('OpenCV unavailable')); return; }
      if (cv.Mat) { done(cv); return; }
      if (typeof cv.then === 'function') { cv.then((c: CV) => done(c)); return; }
      cv.onRuntimeInitialized = () => done(cv);
    };
    if (w.cv) { settle(w.cv); return; }
    const s = document.createElement('script');
    s.src = OPENCV_URL;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.onload = () => settle(w.cv);
    s.onerror = () => { clearTimeout(timer); reject(new Error('OpenCV failed to load')); };
    document.head.appendChild(s);
  }).catch(e => { pending = null; throw e; });
  return pending;
}
