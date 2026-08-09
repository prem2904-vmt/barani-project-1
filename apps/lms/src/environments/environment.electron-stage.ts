/**
 * Electron build profile pointed at STAGE (desktop UAT builds).
 *
 * The dev electron profile talks to localhost:5270; this one talks to the
 * deployed stage backend and stage's own Supabase project.
 * Build with `--configuration=electron-stage`.
 */
export const environment = {
  production: true,
  isElectron: true,
  isMobile: false,
  apiUrl: 'https://med-fetch-stg.prefrontal.health',
  // Public web origin for patient-facing report links (report-share code reads
  // this on every profile; its absence broke the electron builds at compile).
  reportPublicBaseUrl: 'https://med-stg.prefrontal.health',
  auth: {
    bypass: false,
    supabaseUrl: 'https://gxmbbjmcfuxqzdfczrma.supabase.co',
    supabaseAnonKey: 'sb_publishable_JlVCH60t9KrOXF9oH63yIQ_9hX7vwyR'
  }
};
