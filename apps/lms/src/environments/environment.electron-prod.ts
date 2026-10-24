/**
 * Electron build profile pointed at PRODUCTION (desktop release builds).
 *
 * The dev electron profile talks to localhost:5270; this one talks to the
 * deployed prod backend and prod's own Supabase project.
 * Build with `--configuration=electron-prod`.
 */
export const environment = {
  production: true,
  // Native / local builds keep their baked-in settings; only the web production
  // build fetches /config.json at startup (see runtime-config.ts).
  runtimeConfig: false,
  isElectron: true,
  isMobile: false,
  apiUrl: 'https://med-fetch.prefrontal.health',
  // Public web origin for patient-facing report links (report-share code reads
  // this on every profile; its absence broke the electron builds at compile).
  reportPublicBaseUrl: 'https://med.prefrontal.health',
  auth: {
    bypass: false,
    supabaseUrl: 'https://hslcncwhgqezbqkdowyy.supabase.co',
    supabaseAnonKey: 'sb_publishable_4RfhdnIaff3CzDwVkh7XEw_Rw8lfgVR'
  }
};
