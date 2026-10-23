/**
 * Capacitor build profile pointed at PRODUCTION (iOS + Android release builds).
 *
 * Identical to environment.capacitor.ts except for what prod changes:
 * the API host, the public report origin, and the Supabase project (prod
 * has its own user pool — a dev login is not valid here).
 * Build with `--configuration=capacitor-prod`, then `cap sync` as usual.
 */
export const environment = {
  production: true,
  // Native / local builds keep their baked-in settings; only the web production
  // build fetches /config.json at startup (see runtime-config.ts).
  runtimeConfig: false,
  isElectron: false,
  isMobile: true,
  apiUrl: 'https://med-fetch.prefrontal.health',
  // Public web origin for patient-facing report links (window.location.origin is
  // capacitor://localhost in the native app, which can't be opened externally).
  reportPublicBaseUrl: 'https://med.prefrontal.health',
  auth: {
    bypass: false,
    supabaseUrl: 'https://hslcncwhgqezbqkdowyy.supabase.co',
    supabaseAnonKey: 'sb_publishable_4RfhdnIaff3CzDwVkh7XEw_Rw8lfgVR'
  }
};
