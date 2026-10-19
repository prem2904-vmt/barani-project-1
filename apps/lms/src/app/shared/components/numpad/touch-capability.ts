/**
 * Is this a touch-capable device (so numeric results get the in-app numpad
 * and the system keyboard is suppressed)? Pure + unit-testable.
 *
 * `(pointer: coarse)` alone is NOT enough: in the Capacitor WKWebView an
 * iPad reports a desktop (Macintosh) user agent, and with a trackpad or
 * Magic Keyboard attached its PRIMARY pointer is `fine` — the old gate
 * switched the numpad off and iOS showed the system keyboard. Any of these
 * means "a finger can tap this field":
 *  - the Capacitor native shell (iOS / Android app);
 *  - `navigator.maxTouchPoints > 0` (covers iPad-as-Mac: Macintosh UA with
 *    maxTouchPoints > 1);
 *  - ANY coarse pointer (`any-pointer: coarse`), or the primary one.
 * A desktop with only a mouse matches none of them and stays unchanged.
 */
export interface TouchEnv {
  maxTouchPoints?: number | null;
  userAgent?: string | null;
  anyCoarse?: boolean;
  coarse?: boolean;
  nativePlatform?: boolean;
}

/** An iPad in desktop-UA mode (iPadOS 13+ Safari / WKWebView). */
export function isIPadAsMac(env: TouchEnv): boolean {
  return /Macintosh/.test(env.userAgent ?? '') && (env.maxTouchPoints ?? 0) > 1;
}

export function isTouchCapable(env: TouchEnv): boolean {
  return !!env.nativePlatform
    || isIPadAsMac(env)
    || (env.maxTouchPoints ?? 0) > 0
    || !!env.anyCoarse
    || !!env.coarse;
}

/** Read the environment from a window (Capacitor exposes `window.Capacitor`
 *  inside the native shell — no import needed, and absent on the web). */
export function readTouchEnv(view: Window): TouchEnv {
  const mm = (q: string) => {
    try { return typeof view.matchMedia === 'function' && view.matchMedia(q).matches; } catch { return false; }
  };
  let nativePlatform = false;
  try {
    const cap = (view as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    nativePlatform = !!cap?.isNativePlatform?.();
  } catch { /* not native */ }
  return {
    maxTouchPoints: view.navigator?.maxTouchPoints ?? 0,
    userAgent: view.navigator?.userAgent ?? '',
    anyCoarse: mm('(any-pointer: coarse)'),
    coarse: mm('(pointer: coarse)'),
    nativePlatform,
  };
}
