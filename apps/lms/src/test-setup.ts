import { afterEach } from 'vitest';
import { setPrefetchLoadsForTests } from './app/shared/utils/prefetch';

/**
 * Unit-test setup (project.json → test.options.setupFiles), run before every spec file.
 *
 * 1. No background chunk loads: Test Master / Users & access warm their lazy editors with an idle (or hover) dynamic
 *    import. In a unit test that import can still be loading when the spec file's environment is torn down, which
 *    fails the whole run with "EnvironmentTeardownError: Cannot load chunk … after the environment was torn down"
 *    (seen on test-editor / range-entry under full-suite load). Prefetch still records the key, so specs can assert
 *    that a warm-up was asked for; prefetch.spec turns real loads back on for itself.
 * 2. matchMedia never leaks: a spec that stubs window.matchMedia gets the real one back after every test (the global
 *    twin of the per-file restores), so a stubbed "reduce" / "pointer: coarse" can't flip rules in the next file.
 */
setPrefetchLoadsForTests(false);

const realMatchMedia = window.matchMedia;
afterEach(() => {
  if (window.matchMedia !== realMatchMedia) {
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: realMatchMedia });
  }
});
