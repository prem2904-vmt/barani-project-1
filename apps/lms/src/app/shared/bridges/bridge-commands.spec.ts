import { describe, expect, it, vi } from 'vitest';
import { clampHotspotMinutes, scanNetworks, waitForCommand } from './bridge-commands';
import type { BridgeCommandDto } from './bridge.models';

const cmd = (state: BridgeCommandDto['state'], extra: Partial<BridgeCommandDto> = {}): BridgeCommandDto =>
  ({ id: 'c1', type: 'wifi.scan', state, issuedAt: 't', ...extra });

function clock() { let t = 0; return { sleep: vi.fn(async (ms: number) => { t += ms; }), now: () => t }; }

describe('waitForCommand', () => {
  it('polls until terminal and reports each answer', async () => {
    const seq = [cmd('queued'), cmd('delivered'), cmd('succeeded', { result: { detail: { networks: [{ ssid: 'A', signal: 50, security: 'open' }] } } })];
    const updates: string[] = [];
    const c = clock();
    const r = await waitForCommand(async () => seq.shift()!, { intervalMs: 1000, timeoutMs: 60_000, ...c, onUpdate: (x) => updates.push(x.state) });
    expect(r.timedOut).toBe(false);
    expect(r.command?.state).toBe('succeeded');
    expect(updates).toEqual(['queued', 'delivered', 'succeeded']);
    expect(scanNetworks(r.command)).toHaveLength(1);
  });

  it('times out with the last answer; transient errors keep waiting', async () => {
    const c = clock();
    let n = 0;
    const r = await waitForCommand(async () => { if (n++ === 0) throw new Error('blip'); return cmd('delivered'); }, { intervalMs: 1000, timeoutMs: 5000, ...c });
    expect(r).toEqual({ command: cmd('delivered'), timedOut: true });
  });

  it('stops when cancelled', async () => {
    const r = await waitForCommand(async () => cmd('queued'), { intervalMs: 1, timeoutMs: 1e9, ...clock(), cancelled: () => true });
    expect(r).toEqual({ command: null, timedOut: false });
  });

  it('helpers', () => {
    expect(scanNetworks(null)).toEqual([]);
    expect(clampHotspotMinutes(1)).toBe(5);
    expect(clampHotspotMinutes(500)).toBe(120);
    expect(clampHotspotMinutes(Number.NaN)).toBe(30);
  });
});
