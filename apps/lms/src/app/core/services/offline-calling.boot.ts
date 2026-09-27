import { Injector } from '@angular/core';
import { CallPushService } from './call-push.service';
import { ElectronCallService } from './electron-call.service';
import { WebPushService } from './web-push.service';

/**
 * Lazy entry for the OFFLINE CALLING hand-offs (kept off the initial bundle;
 * App imports this after boot). Constructing the services wires them:
 *   CallPushService     — push-ringer Answer / Decline / show routing;
 *   ElectronCallService — desktop call window while minimised / in the tray;
 *   WebPushService      — browser Web Push subscription for the ring.
 */
export function bootOfflineCalling(injector: Injector, bootHref: string): Promise<void> {
  injector.get(ElectronCallService);
  injector.get(WebPushService);
  return injector.get(CallPushService).init(bootHref);
}
