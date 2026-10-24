export const environment = {
  production: false,
  // Native / local builds keep their baked-in settings; only the web production
  // build fetches /config.json at startup (see runtime-config.ts).
  runtimeConfig: false,
  apiUrl: 'https://med-fetch-dev.prefrontal.health',
  // Public web origin for patient-facing report links (window.location.origin is
  // capacitor://localhost in the native app, which can't be opened externally).
  reportPublicBaseUrl: 'https://med-dev.prefrontal.health',
  auth: {
    bypass: false,
    supabaseUrl: 'https://cottlnsbjnstsgknsgzu.supabase.co',
    supabaseAnonKey: 'sb_publishable_P8V0_uNNHKth6NOF57Ph6A_vjwZRDJY'
  }
};
