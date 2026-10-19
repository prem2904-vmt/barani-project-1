/**
 * Waiting on a Bridge command (bridge-api v1, B.4). Commands ride the
 * Bridge's 30-second heartbeat, so "queued → delivered → done" takes up to a
 * minute or two; `wifi.set` reports only after the Bridge has reconnected (or
 * rolled back). Pure: the clock and the sleep are injected.
 */
import { InjectionToken } from '@angular/core';
import type { BridgeCommandDto, WifiNetwork, WifiScanDetail } from './bridge.models';
import { isCommandDone } from './bridge-status';

export interface CommandWaitOptions {
  intervalMs: number;
  timeoutMs: number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Stop early (dialog closed). */
  cancelled?: () => boolean;
  /** Each poll's answer (progress words). */
  onUpdate?: (c: BridgeCommandDto) => void;
}

export interface CommandClock { sleep: (ms: number) => Promise<void>; now: () => number }
export const BRIDGE_COMMAND_CLOCK = new InjectionToken<CommandClock>('BRIDGE_COMMAND_CLOCK', {
  providedIn: 'root',
  factory: () => ({ sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now() }),
});

/** Poll until the command is terminal. Resolves with the last answer and
 *  `timedOut` when the window ran out first (the command may still finish). */
export async function waitForCommand(
  get: () => Promise<BridgeCommandDto>,
  o: CommandWaitOptions,
): Promise<{ command: BridgeCommandDto | null; timedOut: boolean }> {
  const start = o.now();
  let last: BridgeCommandDto | null = null;
  while (!o.cancelled?.()) {
    try {
      last = await get();
      o.onUpdate?.(last);
      if (isCommandDone(last.state)) return { command: last, timedOut: false };
    } catch { /* transient — keep waiting */ }
    if (o.now() - start >= o.timeoutMs) return { command: last, timedOut: true };
    await o.sleep(o.intervalMs);
  }
  return { command: last, timedOut: false };
}

/** The networks a finished `wifi.scan` reported (absent → empty). */
export function scanNetworks(c: BridgeCommandDto | null | undefined): WifiNetwork[] {
  const d = c?.result?.detail as Partial<WifiScanDetail> | null | undefined;
  return Array.isArray(d?.networks) ? (d!.networks as WifiNetwork[]) : [];
}

/** Hotspot minutes the server accepts (B.4: 5–120). */
export function clampHotspotMinutes(m: number): number {
  return Math.min(120, Math.max(5, Math.round(Number.isFinite(m) ? m : 30)));
}
