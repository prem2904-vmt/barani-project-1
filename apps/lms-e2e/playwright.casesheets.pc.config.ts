import base from './playwright.casesheets.config';
import { formFactorProjects } from './src/support/form-factor';

/**
 * The case-sheet stack on a box without Google Chrome (the dev PC): the same config on a local Chromium (PW_CHROMIUM).
 * Form factors: `desktop` runs every case-sheet spec (as before); `phone`, `tablet` and `desktop-app` (Electron preload
 * stubbed in-page, never launched) run the bar specs (src/casesheets/bar-*.screens.spec.ts), which shape their contexts
 * from the project (src/support/form-factor.ts). `--project=desktop` = the old single run.
 */
const launch = { launchOptions: { ...base.use?.launchOptions, executablePath: process.env['PW_CHROMIUM'] || undefined } };
const extraUse = { ...base.use, channel: undefined, viewport: undefined };

export default {
  ...base,
  use: { ...base.use, channel: undefined, launchOptions: launch.launchOptions },
  projects: [
    ...formFactorProjects({ names: ['desktop'], launch, extraUse }),
    ...formFactorProjects({ names: ['phone', 'tablet', 'desktop-app'], launch, extraUse }).map(p => ({ ...p, testMatch: /bar-.*\.screens\.spec\.ts/ })),
  ],
};
