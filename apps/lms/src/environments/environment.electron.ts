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
  isElectron: true,
  isMobile: false,
  apiUrl: 'http://localhost:5270',
  auth: {
    bypass: false,
    supabaseUrl: 'https://cottlnsbjnstsgknsgzu.supabase.co',
    supabaseAnonKey: 'sb_publishable_P8V0_uNNHKth6NOF57Ph6A_vjwZRDJY'
  }
};
