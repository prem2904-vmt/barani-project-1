import { registerPlugin } from '@capacitor/core';
import type { PfBridgeLocalPlugin } from './bridge.models';

/**
 * PfBridgeLocal — the app-embedded Capacitor plugin that reaches a Prefrontal
 * Bridge on the local network (bridge-api v1, B.3 / B.5):
 *  - Android (`android/app/src/main/java/health/prefrontal/lab/bridge/`,
 *    Kotlin): NsdManager discovery, WifiNetworkSpecifier hotspot join, a
 *    pinned HttpsURLConnection bound to the hotspot Network.
 *  - iOS (`ios/App/App/bridge/`, Swift): NWBrowser Bonjour, NEHotspot-
 *    Configuration joinOnce, a URLSession with an SPKI-pin delegate.
 * The native side is a transport only; every rule lives in TypeScript.
 */
export const PfBridgeLocal = registerPlugin<PfBridgeLocalPlugin>('PfBridgeLocal');
