import { AppMode } from '../../../core/app-mode';

/**
 * What the root component (app.ts) and app.config.ts start at boot (plan §4.4: "LMS bootstrap doesn't start in
 * casesheets mode"). Pure, so the spec can prove every LMS piece is off for the public case-sheet site.
 *
 * The LMS shell's own bootstrap (SignalR hubs — signaling / chat / work events — entitlements-driven nav loaders,
 * presence, people drawer, call overlay) lives in layout/shell and the LMS bottom nav, which casesheets mode can
 * never route to (withAppModes). What is left at the ROOT is listed here.
 */
export interface BootPlan {
  /** 15-minute idle PIN lock (shared lab machines). */
  idleLock: boolean;
  /** Native push registration (APNs / FCM / web push tokens to the LMS). */
  push: boolean;
  /** Offline calling hand-offs (push-rung calls, call window, Web Push call ring). */
  offlineCalling: boolean;
  /** Temp-password gate → /set-password (an LMS route). */
  passwordGate: boolean;
  /** GET /api/beta-features prefetch (LMS beta switches). */
  betaPrefetch: boolean;
  /** Root LMS overlays: lock screen, profile switch, WhatsApp dock. */
  lmsOverlays: boolean;
}

export function bootPlan(i: { mode: AppMode; publicPatientPage: boolean }): BootPlan {
  if (i.mode === 'casesheets') {
    return { idleLock: false, push: false, offlineCalling: false, passwordGate: false, betaPrefetch: false, lmsOverlays: false };
  }
  // The LMS, unchanged: public patient pages (report link, tracking) skip lock / push / calls as before.
  const app = !i.publicPatientPage;
  return { idleLock: app, push: app, offlineCalling: app, passwordGate: true, betaPrefetch: true, lmsOverlays: true };
}
