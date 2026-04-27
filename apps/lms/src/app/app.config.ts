import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
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

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(appRoutes, withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    { provide: APP_BASE_HREF, useValue: '/' },
    {
      provide: LocationStrategy,
      useFactory: locationStrategyFactory,
      deps: [PlatformLocation, APP_BASE_HREF]
    }
  ]
};
