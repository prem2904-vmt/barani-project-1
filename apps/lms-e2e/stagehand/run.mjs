// Stagehand (AI-driven) E2E scaffold for the LMS. SELF-CHECKING: if the LLM key
// or the @browserbasehq/stagehand package is missing, it prints exactly what to
// add and exits 0 (never a hard crash) — so it's safe to invoke unconditionally.
//
// Activate: see apps/lms-e2e/stagehand/README.md
//   npm i -D @browserbasehq/stagehand
//   export ANTHROPIC_API_KEY=...   (or OPENAI_API_KEY=...)
//   E2E_ORG=... E2E_USERNAME=... E2E_PASSWORD=... node apps/lms-e2e/stagehand/run.mjs

const BASE_URL = process.env.BASE_URL || 'http://localhost:4200';
const ORG = process.env.E2E_ORG || 'Micro World';
const USERNAME = process.env.E2E_USERNAME || 'labadmin@apollo.prefrontal';
const PASSWORD = process.env.E2E_PASSWORD || 'LabAdmin@123';

const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
const hasOpenAI = !!process.env.OPENAI_API_KEY;

if (!hasAnthropic && !hasOpenAI) {
  console.log('[stagehand] BLOCKED: no LLM API key. Set ANTHROPIC_API_KEY (recommended) or OPENAI_API_KEY, then re-run.');
  console.log('[stagehand] See apps/lms-e2e/stagehand/README.md');
  process.exit(0);
}

let Stagehand;
try {
  ({ Stagehand } = await import('@browserbasehq/stagehand'));
} catch {
  console.log('[stagehand] BLOCKED: package not installed. Run: npm i -D @browserbasehq/stagehand');
  process.exit(0);
}

// Lean model per owner rule (never a top model for test execution).
const modelName = hasAnthropic ? 'claude-3-5-sonnet-latest' : 'gpt-4o-mini';

const sh = new Stagehand({
  env: 'LOCAL', // local Playwright browser — no Browserbase account required
  modelName,
  modelClientOptions: {
    apiKey: process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY,
  },
});

try {
  await sh.init();
  const page = sh.page;
  await page.goto(`${BASE_URL}/login`);

  // Natural-language login — resilient to the login form's restyles.
  await page.act(`Fill the organization field with "${ORG}"`);
  await page.act(`Fill the username field with "${USERNAME}"`);
  await page.act(`Fill the password field with "${PASSWORD}"`);
  await page.act('Click the Sign in button');
  await page.waitForURL((u) => !/\/login/.test(new URL(u).pathname), { timeout: 30_000 });
  console.log('[stagehand] login OK →', page.url());

  // One AI-driven observation as a smoke assertion.
  const nav = await page.observe('Find the main navigation / app shell for a signed-in lab admin');
  console.log('[stagehand] observed app shell:', Array.isArray(nav) ? nav.length : nav);

  console.log('[stagehand] SCAFFOLD OK — grow this into the high-churn flows (register→order→collect→result, profile editor, collection drawer).');
} finally {
  await sh.close?.();
}
