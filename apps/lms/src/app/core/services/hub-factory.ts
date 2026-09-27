import { InjectionToken } from '@angular/core';
import * as signalR from '@microsoft/signalr';

/** Builds one SignalR hub connection. A DI seam so the chat / signaling
 *  services can be tested against a fake hub (account-switch disposal,
 *  stale-handler isolation, presence snapshot + deltas) without a server. */
export type HubFactory = (
  url: string,
  accessTokenFactory: () => Promise<string>,
  retry: signalR.IRetryPolicy,
) => signalR.HubConnection;

export const defaultHubFactory: HubFactory = (url, accessTokenFactory, retry) =>
  new signalR.HubConnectionBuilder()
    .withUrl(url, {
      accessTokenFactory,
      transport: signalR.HttpTransportType.WebSockets,
      skipNegotiation: true,
    })
    .withAutomaticReconnect(retry)
    .configureLogging(signalR.LogLevel.Warning)
    .build();

export const HUB_FACTORY = new InjectionToken<HubFactory>('HUB_FACTORY', {
  providedIn: 'root',
  factory: () => defaultHubFactory,
});

/** Retry forever with capped backoff. The old fixed list
 *  `[0, 2000, 5000, 10000, 30000]` gave up after ~47s, so a laptop sleep,
 *  Wi-Fi drop or deploy left the socket dead for the rest of the session. */
export const FOREVER_RETRY: signalR.IRetryPolicy = {
  nextRetryDelayInMilliseconds: (ctx) => [0, 2000, 5000, 10000][ctx.previousRetryCount] ?? 30000,
};
