import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { hasStaleSupabaseSession, purgeSupabaseLocalStorage } from './supabase-storage';

// Drop any lingering auth token from a different Supabase project BEFORE the
// client initialises — otherwise the SDK tries to refresh that stale token and
// the login button hangs. Safe on first boot (no-op when nothing matches).
if (hasStaleSupabaseSession()) {
  console.warn('[auth] stale Supabase session detected — purging');
  purgeSupabaseLocalStorage();
}

// Singleton Supabase JS client used for sign-in / sign-out and session polling.
// Tokens flow out through AuthService.getAccessToken(); everything else in the
// app should go through the AuthService facade.
export const supabase: SupabaseClient = createClient(
  environment.auth.supabaseUrl,
  environment.auth.supabaseAnonKey,
  {
    auth: {
      persistSession: true,
      // OFF (RCA 2026-09-27, "profile's session has expired" on switch): the
      // SDK keeps ONE session in ONE storage key for every profile on the
      // device and background-refreshed whichever profile it last held —
      // rotating that profile's refresh token behind our back, so the copy in
      // the accounts registry became a revoked token and switching back to it
      // failed. AuthService owns refresh (single-flight, on demand, written
      // to the registry row of the account the tab actually holds).
      autoRefreshToken: false,
      detectSessionInUrl: false,
      // Don't phone home on a 60s tick for refresh — our watchdog and the
      // on-demand refresh in getAccessToken() cover staleness.
      flowType: 'pkce'
    },
    // We don't use Supabase Realtime. The default client opens a WebSocket on
    // init; when that fails (corporate proxy, some extensions), we've seen
    // auth calls hang waiting on the lib's internal locking. Disable it.
    realtime: { params: { eventsPerSecond: 0 } },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' })
    }
  }
);
