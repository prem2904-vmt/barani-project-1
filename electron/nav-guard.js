/**
 * Pure decision for the `will-navigate` handler (no Electron).
 * Exact-origin allow list; anything else is blocked and, only for a few safe
 * schemes, handed to the OS. The call window (file://) never navigates after
 * its first load, so file:// is not allowed here.
 */
const OPEN_EXTERNAL_SCHEMES = ['https:', 'http:', 'mailto:', 'tel:'];

function decideNavigation(url, { isDev, appOrigin }) {
  const allowed = isDev ? ['http://localhost:4200', appOrigin] : [appOrigin];
  let u;
  try { u = new URL(url); } catch { return { allow: false, openExternal: false }; }
  // Node reports origin 'null' for non-special schemes (app://), so build it.
  const origin = u.origin !== 'null' ? u.origin : `${u.protocol}//${u.host}`;
  if (allowed.includes(origin)) return { allow: true, openExternal: false };
  return { allow: false, openExternal: OPEN_EXTERNAL_SCHEMES.includes(u.protocol) };
}

module.exports = { decideNavigation, OPEN_EXTERNAL_SCHEMES };
