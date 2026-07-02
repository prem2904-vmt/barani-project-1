/**
 * Bundled client version. Bump alongside package.json when shipping.
 *
 * Compared on boot against the API's `minClientVersion` (GET /api/version):
 * an installed Capacitor/Electron bundle can't hot-update, so breaking API
 * changes raise the server minimum and the app shows a blocking
 * "Update required" gate instead of failing in odd ways.
 */
export const APP_VERSION = '0.1.0';
