/**
 * Electron build profile pointed at the deployed DEV backend (desktop test
 * builds, e.g. lab-analyzer connector testing against dev).
 *
 * `environment.electron.ts` stays on localhost:5270 for local backends and
 * `environment.electron-stage.ts` targets stage; this one uses the same API +
 * Supabase project as the dev web app (environment.ts).
 * Build with `--configuration=electron-dev` (npm run electron:build:dev:mac).
 */
export const environment = {
  production: true,
  // Native / local builds keep their baked-in settings; only the web production
  // build fetches /config.json at startup (see runtime-config.ts).
  runtimeConfig: false,
  isElectron: true,
  isMobile: false,
  apiUrl: 'https://med-fetch-dev.prefrontal.health',
  // Public web origin for patient-facing report links (report-share code reads
  // this on every profile; its absence broke the electron builds at compile).
  reportPublicBaseUrl: 'https://med-dev.prefrontal.health',
  auth: {
    bypass: false,
    supabaseUrl: 'https://cottlnsbjnstsgknsgzu.supabase.co',
    supabaseAnonKey: 'sb_publishable_P8V0_uNNHKth6NOF57Ph6A_vjwZRDJY'
  }
};
