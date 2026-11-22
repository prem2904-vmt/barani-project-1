/**
 * Electron build profile.
 *
 * Used by `electron:build` (file replacement in apps/lms/project.json).
 * Defaults to the same Supabase + API URL the web build uses; if you
 * deploy a different backend for desktop installs, change apiUrl here
 * and rebuild.
 */
export const environment = {
  production: true,
  // Native / local builds keep their baked-in settings; only the web production
  // build fetches /config.json at startup (see runtime-config.ts).
  runtimeConfig: false,
  enableAnalyzerSimulation: true,
  isElectron: true,
  isMobile: false,
  apiUrl: 'http://localhost:5270',
  // Public web origin for patient-facing report links (report-share code reads
  // this on every profile; its absence broke the electron builds at compile).
  reportPublicBaseUrl: 'https://med-dev.prefrontal.health',
  auth: {
    bypass: false,
    supabaseUrl: 'https://cottlnsbjnstsgknsgzu.supabase.co',
    supabaseAnonKey: 'sb_publishable_P8V0_uNNHKth6NOF57Ph6A_vjwZRDJY'
  }
};
