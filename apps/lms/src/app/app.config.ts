import {
  ApplicationConfig,
  ErrorHandler,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withNavigationErrorHandler, withRouterConfig } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  HashLocationStrategy,
  LocationStrategy,
  PathLocationStrategy,
  PlatformLocation
} from '@angular/common';
import { APP_BASE_HREF } from '@angular/common';
import { appRoutes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';

/**
 * Pick the location strategy at boot. Electron loads the bundle
 * off disk via file://, where the server can't resolve deep paths,
 * so hash routing is the right call there. Browser + Capacitor
 * keep PathLocationStrategy (clean URLs).
 */
function locationStrategyFactory(
  platformLocation: PlatformLocation,
  baseHref: string
): LocationStrategy {
  const w = typeof window !== 'undefined'
    ? (window as unknown as { electronAPI?: { isElectron?: boolean } })
    : undefined;
  if (w?.electronAPI?.isElectron) {
    return new HashLocationStrategy(platformLocation, baseHref);
  }
  return new PathLocationStrategy(platformLocation, baseHref);
}

/**
 * A failed lazy-chunk import means THIS TAB is running a stale build: the
 * server was redeployed, the hashed chunk files it references are gone, and
 * every navigation into a not-yet-loaded route dies silently ("the click
 * does nothing", console: "Importing a module script failed"). The only
 * cure is picking up the new index.html — reload once, guarded per URL so
 * a genuinely broken deploy can't put the tab in a reload loop.
 */
function isChunkLoadError(err: unknown): boolean {
  const m = err instanceof Error ? `${err.name} ${err.message}` : String(err ?? '');
  return /Importing a module script failed|Failed to fetch dynamically imported module|ChunkLoadError|error loading dynamically imported module/i.test(m);
}
function reloadOnceForStaleBuild(): void {
  try {
    const key = 'pf-chunk-reload:' + location.pathname;
    if (sessionStorage.getItem(key)) return;   // already tried — don't loop
    sessionStorage.setItem(key, '1');
    location.reload();
  } catch { /* storage unavailable — let the error surface instead */ }
}

class ChunkAwareErrorHandler extends ErrorHandler {
  override handleError(error: unknown): void {
    const inner = (error as { rejection?: unknown })?.rejection ?? error;
    if (isChunkLoadError(inner)) { reloadOnceForStaleBuild(); return; }
    super.handleError(error);
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    { provide: ErrorHandler, useClass: ChunkAwareErrorHandler },
    // onSameUrlNavigation: 'reload' fixes the "click Frontdesk twice
    // to load" bug — when reception is already on /frontdesk and taps
    // the nav button again, the router re-fires NavigationEnd events
    // so subscribers (refresh effects, queryParam handlers) re-run
    // instead of silently no-op'ing.
    provideRouter(appRoutes,
      withComponentInputBinding(),
      // Lazy-route load failures land here (not in ErrorHandler) — same
      // stale-build cure.
      withNavigationErrorHandler(e => {
        if (isChunkLoadError(e.error)) reloadOnceForStaleBuild();
      }),
      withRouterConfig({ onSameUrlNavigation: 'reload' })),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    { provide: APP_BASE_HREF, useValue: '/' },
    {
      provide: LocationStrategy,
      useFactory: locationStrategyFactory,
      deps: [PlatformLocation, APP_BASE_HREF]
    }
  ]
};
