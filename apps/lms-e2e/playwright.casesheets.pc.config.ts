import base from './playwright.casesheets.config';

/** The case-sheet stack on a box without Google Chrome (the dev PC): the same config on a local Chromium (PW_CHROMIUM). */
export default {
  ...base,
  use: {
    ...base.use,
    channel: undefined,
    launchOptions: { ...base.use?.launchOptions, executablePath: process.env['PW_CHROMIUM'] || undefined },
  },
};
