/**
 * Capacitor build profile (iOS + Android).
 *
 * Mobile devices CANNOT reach localhost:5270 — the API URL has to be
 * a real reachable host. Default points at the deployed backend; for
 * dev-on-device, change this to your machine's LAN IP (e.g.
 * http://192.168.1.42:5270) before running `cap sync`.
 */
export const environment = {
  production: true,
  isElectron: false,
  isMobile: true,
  apiUrl: 'https://lab-fetch.prefrontal.health',
  // Public web origin for patient-facing report links (window.location.origin is
  // capacitor://localhost in the native app, which can't be opened externally).
  reportPublicBaseUrl: 'https://lab.prefrontal.health',
  auth: {
    bypass: false,
    supabaseUrl: 'https://cottlnsbjnstsgknsgzu.supabase.co',
    supabaseAnonKey: 'sb_publishable_P8V0_uNNHKth6NOF57Ph6A_vjwZRDJY'
  }
};
