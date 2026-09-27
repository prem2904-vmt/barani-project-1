import { environment as stage } from './environment.stage';
import { isStageHost } from './environment.production';

/**
 * 2026-09-28: the stage website (med-stg) called med-fetch-dev after a
 * dev → stage promotion replaced stage's build script. The production web
 * build now picks the stage backend when served from med-stg.*.
 */
describe('production web build — backend follows the host', () => {
  it('med-stg.* is stage', () => {
    expect(isStageHost('med-stg.prefrontal.health')).toBe(true);
  });

  it('dev, localhost and the native shells stay on dev', () => {
    for (const h of ['med-dev.prefrontal.health', 'localhost', '', null, undefined, 'med-stg-evil.example.com']) {
      expect(isStageHost(h)).toBe(false);
    }
  });

  it('the stage config is the stage backend + stage Supabase', () => {
    expect(stage.apiUrl).toBe('https://med-fetch-stg.prefrontal.health');
    expect(stage.auth.supabaseUrl).toContain('gxmbbjmcfuxqzdfczrma');
  });
});
