import base from './playwright.offline.config';
import { defineConfig } from '@playwright/test';
// PC runner for the offline specs: the cached Playwright Chromium instead of system Chrome.
export default defineConfig({ ...base, use: { ...base.use, channel: undefined, launchOptions: { executablePath: process.env['PW_CHROME_PATH'] } } });
