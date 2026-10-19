import * as signalR from '@microsoft/signalr';
import { HubFactory } from './hub-factory';

type Fn = (...a: unknown[]) => unknown;

/**
 * In-memory stand-in for a SignalR HubConnection (spec-only helper). Records
 * the token it was opened with, every invoke, and whether it was stopped;
 * `emit()` plays a server event into the handlers registered on THIS
 * connection — exactly how a stale socket from a previous account would.
 */
export class FakeHub {
  static all: FakeHub[] = [];
  static reset(): void { FakeHub.all = []; }
  static last(pathPart: string): FakeHub | undefined {
    return [...FakeHub.all].reverse().find(h => h.url.includes(pathPart));
  }

  state: signalR.HubConnectionState = signalR.HubConnectionState.Disconnected;
  token = '';
  stopped = false;
  readonly invoked: Array<{ method: string; args: unknown[] }> = [];
  /** Canned results per hub method. */
  readonly responses: Record<string, Fn> = {};
  private readonly handlers = new Map<string, Fn[]>();
  private readonly closeCbs: Fn[] = [];
  private readonly reconnectedCbs: Fn[] = [];
  private readonly reconnectingCbs: Fn[] = [];

  constructor(readonly url: string, private readonly tokenFactory: () => Promise<string>) {}

  on(name: string, fn: Fn): void {
    const list = this.handlers.get(name) ?? [];
    list.push(fn);
    this.handlers.set(name, list);
  }
  handlerCount(name: string): number { return this.handlers.get(name)?.length ?? 0; }
  onclose(cb: Fn): void { this.closeCbs.push(cb); }
  onreconnected(cb: Fn): void { this.reconnectedCbs.push(cb); }
  onreconnecting(cb: Fn): void { this.reconnectingCbs.push(cb); }

  async start(): Promise<void> {
    this.token = await this.tokenFactory();
    this.state = signalR.HubConnectionState.Connected;
  }
  async stop(): Promise<void> {
    this.stopped = true;
    this.state = signalR.HubConnectionState.Disconnected;
    for (const cb of this.closeCbs) cb();
  }
  async invoke<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    this.invoked.push({ method, args });
    const r = this.responses[method];
    return (r ? r(...args) : undefined) as T;
  }
  /** Server → client event on THIS socket. */
  emit(name: string, ...args: unknown[]): void {
    for (const fn of this.handlers.get(name) ?? []) fn(...args);
  }
  /** Simulate the socket dropping into auto-reconnect. */
  drop(): void {
    this.state = signalR.HubConnectionState.Reconnecting;
    for (const cb of this.reconnectingCbs) cb();
  }
  /** Simulate an auto-reconnect completing. */
  async reconnect(): Promise<void> {
    this.state = signalR.HubConnectionState.Connected;
    for (const cb of this.reconnectedCbs) await cb();
  }
}

export const fakeHubFactory: HubFactory = (url, tokenFactory) => {
  const h = new FakeHub(url, tokenFactory);
  FakeHub.all.push(h);
  return h as unknown as signalR.HubConnection;
};
