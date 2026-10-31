// Used only by the local Nx dev server (`pnpm start` / `nx serve lms`).
// Swapped in via the `development` configuration's fileReplacements in
// apps/lms/project.json. Production / electron / capacitor builds keep
// pointing to the deployed API.
export const environment = {
  production: false,
  // Native / local builds keep their baked-in settings; only the web production
  // build fetches /config.json at startup (see runtime-config.ts).
  runtimeConfig: false,
  // Local dev server → local backend (dotnet run on :5270). Point this back
  // at the deployed API only if you intentionally want the dev UI to drive prod.
  apiUrl: "https://med-fetch-dev.prefrontal.health",
  // Public web origin for patient-facing report links (window.location.origin is
  // capacitor://localhost in the native app, which can't be opened externally).
  reportPublicBaseUrl: "https://lab.prefrontal.health",
  auth: {
    bypass: false,
    supabaseUrl: "https://cottlnsbjnstsgknsgzu.supabase.co",
    supabaseAnonKey: "sb_publishable_P8V0_uNNHKth6NOF57Ph6A_vjwZRDJY",
    // Passkeys (WebAuthn) RP ID of the DEV Supabase project. Passkey UI shows
    // only on this host or its subdomains (passkey-webauthn.ts); other servers
    // set their own via /config.json `auth.passkeyRpId` (none = no passkeys).
    passkeyRpId: "med-dev.prefrontal.health",
  },
};
