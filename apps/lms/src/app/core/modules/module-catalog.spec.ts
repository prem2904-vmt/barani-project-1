import { MODULE_CATALOG, moduleDef, defaultModuleEnabled, catalogDefaults } from './module-catalog';

describe('MODULE_CATALOG', () => {
  it('has 10 modules', () => {
    expect(MODULE_CATALOG.length).toBe(10);
  });

  it('has unique module ids', () => {
    const ids = MODULE_CATALOG.map((m) => m.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('all modules have required fields', () => {
    MODULE_CATALOG.forEach((m) => {
      expect(m.id).toBeDefined();
      expect(m.label).toBeDefined();
      expect(m.iconPath).toBeDefined();
      expect(m.status).toBeDefined();
      expect(m.defaultEnabled).toBeDefined();
      expect(m.route).toBeDefined();
      expect(m.blurb).toBeDefined();
      expect(m.features).toBeDefined();
    });
  });

  it('all modules have valid status (live or coming_soon)', () => {
    MODULE_CATALOG.forEach((m) => {
      expect(['live', 'coming_soon']).toContain(m.status);
    });
  });

  it('lab and inventory default to enabled=true, others false', () => {
    const enabled = MODULE_CATALOG.filter((m) => m.defaultEnabled);
    const disabled = MODULE_CATALOG.filter((m) => !m.defaultEnabled);
    expect(enabled.map((m) => m.id)).toEqual(['lab', 'inventory']);
    expect(disabled.length).toBe(8);
  });

  it('all modules have at least one feature', () => {
    MODULE_CATALOG.forEach((m) => {
      expect(m.features.length).toBeGreaterThan(0);
    });
  });

  it('all features have key and label', () => {
    MODULE_CATALOG.forEach((m) => {
      m.features.forEach((f) => {
        expect(f.key).toBeDefined();
        expect(f.label).toBeDefined();
      });
    });
  });

  it('lab module has reports, messages, homeCollection features', () => {
    const lab = MODULE_CATALOG.find((m) => m.id === 'lab');
    expect(lab).toBeDefined();
    expect(lab?.features.map((f) => f.key)).toContain('reports');
    expect(lab?.features.map((f) => f.key)).toContain('messages');
    expect(lab?.features.map((f) => f.key)).toContain('homeCollection');
  });

  it('inventory module has stores, stockCount, vendors, purchaseOrders, audit features', () => {
    const inv = MODULE_CATALOG.find((m) => m.id === 'inventory');
    expect(inv).toBeDefined();
    const featureKeys = inv?.features.map((f) => f.key);
    expect(featureKeys).toContain('stores');
    expect(featureKeys).toContain('stockCount');
    expect(featureKeys).toContain('vendors');
    expect(featureKeys).toContain('purchaseOrders');
    expect(featureKeys).toContain('audit');
  });
});

describe('moduleDef', () => {
  it('resolves known module ids to their definitions', () => {
    const lab = moduleDef('lab');
    expect(lab?.id).toBe('lab');
    expect(lab?.label).toBe('Lab (Diagnostics)');
    expect(lab?.status).toBe('live');
  });

  it('resolves inventory module', () => {
    const inv = moduleDef('inventory');
    expect(inv?.id).toBe('inventory');
    expect(inv?.defaultEnabled).toBe(true);
  });

  it('resolves opd and other coming_soon modules', () => {
    const opd = moduleDef('opd');
    expect(opd?.id).toBe('opd');
    expect(opd?.status).toBe('coming_soon');
    expect(opd?.defaultEnabled).toBe(false);
  });

  it('returns undefined for unknown module ids', () => {
    expect(moduleDef('unknown')).toBeUndefined();
    expect(moduleDef('invalid_module')).toBeUndefined();
    expect(moduleDef('')).toBeUndefined();
  });
});

describe('defaultModuleEnabled', () => {
  it('returns true for lab', () => {
    expect(defaultModuleEnabled('lab')).toBe(true);
  });

  it('returns true for inventory', () => {
    expect(defaultModuleEnabled('inventory')).toBe(true);
  });

  it('returns false for opd, ipd, pharmacy, payroll, insurance, radiology, emergency, bloodbank', () => {
    expect(defaultModuleEnabled('opd')).toBe(false);
    expect(defaultModuleEnabled('ipd')).toBe(false);
    expect(defaultModuleEnabled('pharmacy')).toBe(false);
    expect(defaultModuleEnabled('payroll')).toBe(false);
    expect(defaultModuleEnabled('insurance')).toBe(false);
    expect(defaultModuleEnabled('radiology')).toBe(false);
    expect(defaultModuleEnabled('emergency')).toBe(false);
    expect(defaultModuleEnabled('bloodbank')).toBe(false);
  });

  it('returns false for unknown module ids', () => {
    expect(defaultModuleEnabled('unknown')).toBe(false);
    expect(defaultModuleEnabled('nonexistent')).toBe(false);
    expect(defaultModuleEnabled('')).toBe(false);
  });
});

describe('catalogDefaults', () => {
  it('returns state for all 10 modules', () => {
    const state = catalogDefaults();
    expect(Object.keys(state).length).toBe(10);
    expect(Object.keys(state)).toContain('lab');
    expect(Object.keys(state)).toContain('opd');
    expect(Object.keys(state)).toContain('inventory');
  });

  it('sets enabled=true for lab and inventory', () => {
    const state = catalogDefaults();
    expect(state['lab'].enabled).toBe(true);
    expect(state['inventory'].enabled).toBe(true);
  });

  it('sets enabled=false for all other modules', () => {
    const state = catalogDefaults();
    expect(state['opd'].enabled).toBe(false);
    expect(state['ipd'].enabled).toBe(false);
    expect(state['pharmacy'].enabled).toBe(false);
    expect(state['payroll'].enabled).toBe(false);
    expect(state['insurance'].enabled).toBe(false);
    expect(state['radiology'].enabled).toBe(false);
    expect(state['emergency'].enabled).toBe(false);
    expect(state['bloodbank'].enabled).toBe(false);
  });

  it('sets all features to true for each module', () => {
    const state = catalogDefaults();
    Object.entries(state).forEach(([moduleId, moduleState]) => {
      const module = MODULE_CATALOG.find((m) => m.id === moduleId);
      expect(module).toBeDefined();
      expect(moduleState.features).toBeDefined();
      module?.features.forEach((f) => {
        expect(moduleState.features![f.key]).toBe(true);
      });
    });
  });

  it('lab features include reports, messages, homeCollection all true', () => {
    const state = catalogDefaults();
    expect(state['lab'].features?.['reports']).toBe(true);
    expect(state['lab'].features?.['messages']).toBe(true);
    expect(state['lab'].features?.['homeCollection']).toBe(true);
  });

  it('inventory features include all 5 features enabled', () => {
    const state = catalogDefaults();
    expect(state['inventory'].features?.['stores']).toBe(true);
    expect(state['inventory'].features?.['stockCount']).toBe(true);
    expect(state['inventory'].features?.['vendors']).toBe(true);
    expect(state['inventory'].features?.['purchaseOrders']).toBe(true);
    expect(state['inventory'].features?.['audit']).toBe(true);
  });
});
