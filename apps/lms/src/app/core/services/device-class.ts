import { TouchEnv, isIPadAsMac } from '../../shared/components/numpad/touch-capability';

/**
 * Device class — decides the LAYOUT (desktop vs tablet vs phone) by what the
 * device IS, not only by how wide it is. Pure + unit-testable.
 *
 * Why: the tablet layout used to switch on width alone (≤1279px). A 14"
 * Android tablet (~1280–1500 CSS px in landscape), an iPad Pro in landscape
 * (1366) and the native app on any big tablet are all ≥1280px wide, so they
 * got the DESKTOP layout. Now:
 *   - native app (Capacitor iOS / Android) → ALWAYS touch (tablet or phone);
 *   - web → touch when the device is touch-first:
 *       iPad-as-Mac (Macintosh UA + >1 touch points), iPhone / iPad / Android
 *       UA, Chrome's "desktop site" on an Android tablet (Linux UA + touch
 *       points), a coarse pointer with NO fine pointer anywhere;
 *   - Electron, and any browser with a mouse or trackpad (incl. a Windows
 *     touch laptop) → desktop, exactly as before.
 * Touch devices split into tablet / phone by the SHORT side of the screen
 * (≥600 CSS px = tablet), so rotating never flips the class.
 *
 * `apps/lms/src/index.html` runs a MIRROR of this function inline, before the
 * first paint (no desktop flash); `device-class.spec.ts` keeps the two in
 * lock-step. The CSS side is `shared/styles/_device-tier.scss`.
 */
export type DeviceClass = 'desktop' | 'tablet' | 'phone';

export interface DeviceEnv extends TouchEnv {
  /** `(any-pointer: fine)` — a mouse / trackpad / stylus is attached. */
  anyFine?: boolean;
  /** `(pointer: fine)` — the PRIMARY pointer is fine. */
  fine?: boolean;
  /** Short side of the screen in CSS px (min of screen.width / height). */
  screenShort?: number | null;
  /** The Electron desktop shell (window.electronAPI.isElectron). */
  electron?: boolean;
}

/** Short side (CSS px) from which a touch device counts as a tablet. */
export const TABLET_MIN_SHORT_SIDE = 600;

/** The <html> classes the device class maps to. */
export const DEVICE_CLASSES = ['device-touch', 'device-tablet', 'device-phone', 'device-desktop'] as const;

/** Chrome on an Android tablet in "desktop site" mode (the default on big
 *  tablets) sends a desktop Linux UA — but keeps its touch points. */
export function isAndroidAsDesktop(env: DeviceEnv): boolean {
  const ua = env.userAgent ?? '';
  return /X11; Linux/.test(ua) && !/CrOS/.test(ua) && (env.maxTouchPoints ?? 0) > 1;
}

/** A device whose main input is a finger — gets the tablet / phone layout
 *  at every width. A mouse or trackpad anywhere (any-pointer: fine) keeps a
 *  plain desktop browser on the desktop layout. */
export function isTouchFirst(env: DeviceEnv): boolean {
  if (env.electron) return false;
  if (env.nativePlatform) return true;
  const ua = env.userAgent ?? '';
  const touchPoints = env.maxTouchPoints ?? 0;
  return isIPadAsMac(env)
    || /iPhone|iPad|iPod|Android/.test(ua)
    || isAndroidAsDesktop(env)
    || (!!env.anyCoarse && !env.anyFine)
    || (!!env.coarse && touchPoints > 1 && !env.anyFine);
}

export function detectDeviceClass(env: DeviceEnv): DeviceClass {
  if (!isTouchFirst(env)) return 'desktop';
  const short = env.screenShort ?? 0;
  // Unknown screen size → tablet (the safer of the two touch layouts).
  if (!short) return 'tablet';
  return short >= TABLET_MIN_SHORT_SIDE ? 'tablet' : 'phone';
}

/** The classes to put on <html> for a device class. */
export function deviceClassNames(cls: DeviceClass): string[] {
  return cls === 'desktop' ? ['device-desktop'] : ['device-touch', `device-${cls}`];
}

/** Put the device class on <html> (idempotent; clears the other classes). */
export function applyDeviceClass(root: HTMLElement, cls: DeviceClass): void {
  const on = deviceClassNames(cls);
  for (const c of DEVICE_CLASSES) root.classList.toggle(c, on.includes(c));
  root.setAttribute('data-device', cls);
}

/** Read the device environment from a window. */
export function readDeviceEnv(view: Window): DeviceEnv {
  const mm = (q: string) => {
    try { return typeof view.matchMedia === 'function' && view.matchMedia(q).matches; } catch { return false; }
  };
  let nativePlatform = false;
  try {
    const cap = (view as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    nativePlatform = !!cap?.isNativePlatform?.();
  } catch { /* not native */ }
  let electron = false;
  try {
    electron = !!(view as unknown as { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron;
  } catch { /* not electron */ }
  const s = view.screen;
  const short = s && s.width && s.height ? Math.min(s.width, s.height) : Math.min(view.innerWidth || 0, view.innerHeight || 0);
  return {
    maxTouchPoints: view.navigator?.maxTouchPoints ?? 0,
    userAgent: view.navigator?.userAgent ?? '',
    anyCoarse: mm('(any-pointer: coarse)'),
    coarse: mm('(pointer: coarse)'),
    anyFine: mm('(any-pointer: fine)'),
    fine: mm('(pointer: fine)'),
    screenShort: short,
    nativePlatform,
    electron,
  };
}
