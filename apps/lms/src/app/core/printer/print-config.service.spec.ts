import { TestBed } from '@angular/core/testing';
import { PrintConfigService } from './print-config.service';
import { BranchLabConfigService } from '../services/branch-lab-config.service';

describe('PrintConfigService - ID card size', () => {
  const make = () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: BranchLabConfigService, useValue: { config: () => null } }] });
    return TestBed.inject(PrintConfigService);
  };
  beforeEach(() => { try { localStorage.removeItem('pf.printConfig'); } catch { /* ignore */ } });
  afterEach(() => { try { localStorage.removeItem('pf.printConfig'); } catch { /* ignore */ } });

  it('defaults to 92 x 62 mm', () => {
    const s = make();
    expect(s.config().idCardWidthMm).toBe(92);
    expect(s.config().idCardHeightMm).toBe(62);
    expect(s.idCardSize()).toEqual({ w: 92, h: 62 });
  });

  it('clamps to 50-220 x 30-300 and keeps 0.1 mm', () => {
    const s = make();
    s.setIdCardSize(10, 5);
    expect(s.idCardSize()).toEqual({ w: 50, h: 30 });
    s.setIdCardSize(999, 999);
    expect(s.idCardSize()).toEqual({ w: 220, h: 300 });
    s.setIdCardSize(148.04, 210.26);
    expect(s.idCardSize()).toEqual({ w: 148, h: 210.3 });
    s.setIdCardSize(NaN, 0);
    expect(s.idCardSize()).toEqual({ w: 92, h: 62 });
  });

  it('persists per station and does not touch the tube label size', () => {
    const s = make();
    s.setIdCardSize(148, 210);
    expect(JSON.parse(localStorage.getItem('pf.printConfig')!).idCardWidthMm).toBe(148);
    const again = make();
    expect(again.idCardSize()).toEqual({ w: 148, h: 210 });
    expect(again.config().labelWidthMm).toBe(50);
  });

  it('an older stored config without the fields (or garbage) falls back to the default', () => {
    localStorage.setItem('pf.printConfig', JSON.stringify({ labelWidthMm: 40, idCardWidthMm: 'x', idCardHeightMm: 9999 }));
    const s = make();
    expect(s.idCardSize()).toEqual({ w: 92, h: 62 });
    expect(s.config().labelWidthMm).toBe(40);
  });
});
