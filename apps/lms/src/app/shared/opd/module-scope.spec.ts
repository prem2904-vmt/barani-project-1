import { canUseModule, cartMode } from './module-scope';

describe('canUseModule (tenant ∧ user)', () => {
  it('is usable only when BOTH tenant-enabled and user-scoped', () => {
    expect(canUseModule(true, true)).toBe(true);
    expect(canUseModule(true, false)).toBe(false);
    expect(canUseModule(false, true)).toBe(false);
    expect(canUseModule(false, false)).toBe(false);
  });
});

describe('cartMode', () => {
  // The production-safety cases: OPD off ⇒ behaviour is exactly today's 'lab'.
  it('is lab when only lab is usable (pre-OPD behaviour preserved)', () => {
    expect(cartMode(true, false)).toBe('lab');
  });
  it('is lab when OPD is off even if lab is on — never conditional on OPD', () => {
    expect(cartMode(true, false)).toBe('lab');
  });

  it('is opd when only OPD is usable', () => {
    expect(cartMode(false, true)).toBe('opd');
  });
  it('is choose when both are usable (dropdown)', () => {
    expect(cartMode(true, true)).toBe('choose');
  });
  it('is none when neither is usable', () => {
    expect(cartMode(false, false)).toBe('none');
  });
});
