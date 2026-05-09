// Used only by the local Nx dev server (`pnpm start` / `nx serve lms`).
// Swapped in via the `development` configuration's fileReplacements in
// apps/lms/project.json. Production / electron / capacitor builds keep
// pointing to the deployed API.
export const environment = {
  production: false,
  apiUrl: 'https://lab-fetch.prefrontal.health',
  auth: {
    bypass: false,
    supabaseUrl: 'https://cottlnsbjnstsgknsgzu.supabase.co',
    supabaseAnonKey: 'sb_publishable_P8V0_uNNHKth6NOF57Ph6A_vjwZRDJY'
  }
};
