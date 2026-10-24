export const environment = {
  production: true,
  // Native / local builds keep their baked-in settings; only the web production
  // build fetches /config.json at startup (see runtime-config.ts).
  runtimeConfig: false,
  apiUrl: 'https://med-fetch-stg.prefrontal.health',
  // Public web origin for patient-facing report links (window.location.origin is
  // capacitor://localhost in the native app, which can't be opened externally).
  reportPublicBaseUrl: 'https://med-stg.prefrontal.health',
  auth: {
    bypass: false,
    // Stage's OWN Supabase project — separate user pool and JWT keys, so a
    // dev login is not valid here. Users exist only once a tenant is
    // provisioned on stage.
    supabaseUrl: 'https://gxmbbjmcfuxqzdfczrma.supabase.co',
    supabaseAnonKey: 'sb_publishable_JlVCH60t9KrOXF9oH63yIQ_9hX7vwyR'
  }
};
