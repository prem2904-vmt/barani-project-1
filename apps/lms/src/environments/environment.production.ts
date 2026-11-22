/**
 * Web production build — ONE build for every server (dev, stage, prod).
 *
 * These are the DEV values, kept only as the built-in fallback. The server
 * answers `GET /config.json` with the real per-environment values, which
 * `loadRuntimeConfig` (runtime-config.ts) merges into this object before
 * Angular bootstraps. Replaces the old hostname sniffing (`isStageHost`).
 */
export const environment = {
  production: true,
  runtimeConfig: true,
  enableAnalyzerSimulation: false,
  fallbackHosts: ['med-dev.prefrontal.health', 'localhost', '127.0.0.1'],
  apiUrl: 'https://med-fetch-dev.prefrontal.health',
  // Public web origin for patient-facing report links (window.location.origin is
  // capacitor://localhost in the native app, which can't be opened externally).
  reportPublicBaseUrl: 'https://med-dev.prefrontal.health',
  auth: {
    bypass: false,
    supabaseUrl: 'https://cottlnsbjnstsgknsgzu.supabase.co',
    supabaseAnonKey: 'sb_publishable_P8V0_uNNHKth6NOF57Ph6A_vjwZRDJY',
    // Passkeys (WebAuthn) RP ID of the DEV Supabase project. Passkey UI shows
    // only on this host or its subdomains (passkey-webauthn.ts); other servers
    // set their own via /config.json `auth.passkeyRpId` (none = no passkeys).
    passkeyRpId: 'med-dev.prefrontal.health'
  }
};
