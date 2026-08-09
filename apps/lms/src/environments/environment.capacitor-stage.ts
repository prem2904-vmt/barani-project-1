/**
 * Capacitor build profile pointed at STAGE (iOS + Android UAT builds).
 *
 * Identical to environment.capacitor.ts except for what stage changes:
 * the API host, the public report origin, and the Supabase project (stage
 * has its own user pool — a dev login is not valid here).
 * Build with `--configuration=capacitor-stage`, then `cap sync` as usual.
 */
export const environment = {
  production: true,
  isElectron: false,
  isMobile: true,
  apiUrl: 'https://med-fetch-stg.prefrontal.health',
  // Public web origin for patient-facing report links (window.location.origin is
  // capacitor://localhost in the native app, which can't be opened externally).
  reportPublicBaseUrl: 'https://med-stg.prefrontal.health',
  auth: {
    bypass: false,
    supabaseUrl: 'https://gxmbbjmcfuxqzdfczrma.supabase.co',
    supabaseAnonKey: 'sb_publishable_JlVCH60t9KrOXF9oH63yIQ_9hX7vwyR'
  }
};
