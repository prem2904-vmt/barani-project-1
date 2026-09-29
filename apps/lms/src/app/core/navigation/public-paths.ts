/** Public, no-login patient pages (see app.routes: reports/public/:token,
 *  track/:token) — opened in a phone browser by someone who is not a user of
 *  the app. The root component skips the staff-only boot (idle lock, push,
 *  calling hand-offs) on these. */
export function isPublicPatientPath(pathname: string): boolean {
  return /^\/(reports\/public|track)\/[^/]+\/?$/.test(pathname || '');
}
