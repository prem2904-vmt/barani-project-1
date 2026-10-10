/**
 * The Bridge QR as a LINK (`https://lab.prefrontal.health/b#1.S.C.P.F`,
 * bridge-api v1 B.6): a phone camera opens it in the browser (the public `/b`
 * page) or, once App Links / Universal Links list `/b`, in the app. Either
 * way the payload is handed to the add screen through sessionStorage — never
 * a query param, so the claim secret stays out of history, logs and
 * Referer headers.
 */
import type { Router } from '@angular/router';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { BRIDGE_QR_HANDOFF_KEY, BRIDGE_QR_PATH } from './bridge-qr';

/** True for any URL whose path is `/b` and that carries a fragment. */
export function isBridgeLink(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.pathname === BRIDGE_QR_PATH && u.hash.length > 1;
  } catch { return false; }
}

/** Stash the raw link/payload for the add screen. Never throws. */
export function stashBridgeQr(raw: string): boolean {
  try { sessionStorage.setItem(BRIDGE_QR_HANDOFF_KEY, raw); return true; } catch { return false; }
}

/** Hand a scanned link to the add screen (the guard sends a signed-out user to login first). */
export function openBridgeLink(router: Router, raw: string): void {
  stashBridgeQr(raw);
  void router.navigateByUrl('/admin/bridges/add', { replaceUrl: true });
}

/** Native deep links (`appUrlOpen`) to the QR URL. Returns the unsubscribe. */
export function listenForBridgeLinks(router: Router): () => void {
  let isNative = false;
  try { isNative = Capacitor.isNativePlatform(); } catch { isNative = false; }
  if (!isNative) return () => undefined;
  let handle: { remove: () => Promise<void> } | null = null;
  let gone = false;
  App.addListener('appUrlOpen', (e) => { if (isBridgeLink(e?.url)) openBridgeLink(router, e.url); })
    .then((h) => { if (gone) void h.remove(); else handle = h; })
    .catch(() => undefined);
  return () => { gone = true; if (handle) void handle.remove(); };
}
