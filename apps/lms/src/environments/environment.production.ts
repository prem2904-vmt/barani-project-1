import { environment as stageEnvironment } from './environment.stage';

const devEnvironment = {
  production: true,
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

/** The stage website (med-stg.*) runs the stage backend + Supabase. Every
 *  branch's hosting runs the same `npm run build` (production config), and a
 *  dev → stage promotion carries dev's package.json — so the web build picks
 *  its backend from the host it is served on, not from the branch. */
export function isStageHost(hostname: string | null | undefined): boolean {
  return /^med-stg\./i.test(hostname ?? '');
}

export const environment = isStageHost(typeof location !== 'undefined' ? location.hostname : null)
  ? stageEnvironment
  : devEnvironment;
