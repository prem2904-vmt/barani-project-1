# OpenCV.js (vendored)

`opencv.js` is the unmodified single-file build of
`@techstark/opencv-js@4.10.0-release.1` (OpenCV 4.10, WASM inlined),
from https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js
— Apache-2.0, see `LICENSE`.

Served same-origin as `assets/vendor/opencv/opencv.js` (web, Electron and
the Capacitor app, offline). Loaded LAZILY by
`apps/lms/src/app/features/lab/culture-entry/opencv-loader.ts` only when the
"Measure zones from plate" modal first needs it — never in the app bundle.
