import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Owner 2026-11-13: each desktop channel talks to its own backend — prod desktop must never be built from stage settings. */
describe('desktop release channels', () => {
  const src = readFileSync(resolve(process.cwd(), 'tools/desktop-release.mjs'), 'utf8');
  it('dev, stage and prod each build from their own electron configuration', () => {
    expect(src).toMatch(/NX_CONFIG_BY_CHANNEL = \{ dev: 'electron-dev', stage: 'electron-stage', prod: 'electron-prod' \}/);
  });
  it('the prod configuration points at the prod API, not stage', () => {
    const env = readFileSync(resolve(process.cwd(), 'apps/lms/src/environments/environment.electron-prod.ts'), 'utf8');
    expect(env).toMatch(/apiUrl: 'https:\/\/med-fetch\.prefrontal\.health'/);
    expect(env).not.toMatch(/-stg\.|-dev\./);
  });
});
