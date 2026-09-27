import {
  ACTION_CATALOG,
  KNOWN_ROLES,
  catalogFor,
  WORKAREA_ICONS,
  workAreaIconPath,
  ACTION_POLICY,
  isLocked,
  isMandatory,
  actionHome,
  ACTION_COUPLINGS,
  coupledTypes,
  ACTION_REQUIRES,
  requiresOf,
  dependentsOf,
  SYSTEM_AREA_SCREEN,
  COUNTER_SCREEN,
  workAreaRoute,
  deriveModes,
  COLLECTION_SLOTS,
  isFixedSlotAction,
  frontdeskMenu,
  collectionLocations,
  collectsAtFrontdesk,
  hasDedicatedCollection,
  collectsAtBillingCounter,
  areasWithCollection,
  screenWorkArea,
  BILLING_COUNTER_SCREEN,
  LAB_MENU_ID,
  collectsInLab,
  ProcessCategory,
  ProcessAction,
  ProcessWorkflowConfig,
} from './process-workflow.model';

describe('ACTION_CATALOG', () => {
  it('is a non-empty array of action entries', () => {
    expect(Array.isArray(ACTION_CATALOG)).toBe(true);
    expect(ACTION_CATALOG.length).toBeGreaterThan(0);
  });

  it('contains expected action types with required fields', () => {
    const appointmentEntry = ACTION_CATALOG.find(a => a.type === 'appointment');
    expect(appointmentEntry).toBeDefined();
    expect(appointmentEntry?.label).toBe('Appointments');
    expect(appointmentEntry?.route).toBe('/frontdesk/appointments');
    expect(appointmentEntry?.iconPath).toBeDefined();
    expect(appointmentEntry?.iconPath.length).toBeGreaterThan(0);
  });

  it('includes messages action without permissions (visible to all)', () => {
    const messages = ACTION_CATALOG.find(a => a.type === 'messages');
    expect(messages).toBeDefined();
    expect(messages?.permissions).toBeUndefined();
  });

  it('includes lost_and_found with multiple permissions (OR semantics)', () => {
    const laf = ACTION_CATALOG.find(a => a.type === 'lost_and_found');
    expect(laf?.permissions).toEqual(['receive_sample', 'reject_sample', 'cancel_order', 'manage_users']);
  });
});

describe('catalogFor', () => {
  it('finds an action by type', () => {
    const result = catalogFor('appointment');
    expect(result?.type).toBe('appointment');
    expect(result?.label).toBe('Appointments');
  });

  it('returns undefined for unknown type', () => {
    expect(catalogFor('unknown_type')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(catalogFor('')).toBeUndefined();
  });

  it('is case-sensitive', () => {
    expect(catalogFor('Appointment')).toBeUndefined();
    expect(catalogFor('APPOINTMENT')).toBeUndefined();
  });
});

describe('KNOWN_ROLES', () => {
  it('is a non-empty array of role names', () => {
    expect(Array.isArray(KNOWN_ROLES)).toBe(true);
    expect(KNOWN_ROLES.length).toBeGreaterThan(0);
  });

  it('includes standard lab roles', () => {
    expect(KNOWN_ROLES).toContain('Receptionist');
    expect(KNOWN_ROLES).toContain('Lab Technician');
    expect(KNOWN_ROLES).toContain('Pathologist');
  });
});

describe('WORKAREA_ICONS', () => {
  it('is a non-empty array of icon definitions', () => {
    expect(Array.isArray(WORKAREA_ICONS)).toBe(true);
    expect(WORKAREA_ICONS.length).toBeGreaterThan(0);
  });

  it('has folder as the first icon (default)', () => {
    expect(WORKAREA_ICONS[0].key).toBe('folder');
    expect(WORKAREA_ICONS[0].label).toBe('Folder');
  });

  it('contains expected icon keys', () => {
    const keys = WORKAREA_ICONS.map(i => i.key);
    expect(keys).toContain('folder');
    expect(keys).toContain('clipboard');
    expect(keys).toContain('calendar');
    expect(keys).toContain('flask');
  });

  it('each icon has a path array', () => {
    WORKAREA_ICONS.forEach(icon => {
      expect(Array.isArray(icon.path)).toBe(true);
      expect(icon.path.length).toBeGreaterThan(0);
    });
  });
});

describe('workAreaIconPath', () => {
  it('returns path array for a known key', () => {
    const path = workAreaIconPath('folder');
    expect(Array.isArray(path)).toBe(true);
    expect(path.length).toBeGreaterThan(0);
  });

  it('returns folder path (default) for unknown key', () => {
    const defaultPath = WORKAREA_ICONS[0].path;
    expect(workAreaIconPath('unknown_icon')).toEqual(defaultPath);
  });

  it('returns folder path (default) for null', () => {
    const defaultPath = WORKAREA_ICONS[0].path;
    expect(workAreaIconPath(null)).toEqual(defaultPath);
  });

  it('returns folder path (default) for undefined', () => {
    const defaultPath = WORKAREA_ICONS[0].path;
    expect(workAreaIconPath(undefined)).toEqual(defaultPath);
  });

  it('returns folder path (default) for empty string', () => {
    const defaultPath = WORKAREA_ICONS[0].path;
    expect(workAreaIconPath('')).toEqual(defaultPath);
  });

  it('returns calendar path for calendar key', () => {
    const calendarIcon = WORKAREA_ICONS.find(i => i.key === 'calendar');
    expect(workAreaIconPath('calendar')).toEqual(calendarIcon?.path);
  });
});

describe('ACTION_POLICY', () => {
  it('is an object with action type keys', () => {
    expect(typeof ACTION_POLICY).toBe('object');
    expect(Object.keys(ACTION_POLICY).length).toBeGreaterThan(0);
  });

  it('has patient_registration as locked and mandatory', () => {
    const policy = ACTION_POLICY['patient_registration'];
    expect(policy.home).toBe('frontdesk');
    expect(policy.locked).toBe(true);
    expect(policy.mandatory).toBe(true);
  });

  it('has appointment as locked but not mandatory', () => {
    const policy = ACTION_POLICY['appointment'];
    expect(policy.home).toBe('frontdesk');
    expect(policy.locked).toBe(true);
    expect(policy.mandatory).toBeUndefined();
  });

  it('has validate as locked and in validate home', () => {
    const policy = ACTION_POLICY['validate'];
    expect(policy.home).toBe('validate');
    expect(policy.locked).toBe(true);
  });

  it('has result_entry in lab home and locked', () => {
    const policy = ACTION_POLICY['result_entry'];
    expect(policy.home).toBe('lab');
    expect(policy.locked).toBe(true);
  });
});

describe('isLocked', () => {
  it('returns true for locked actions', () => {
    expect(isLocked('patient_registration')).toBe(true);
    expect(isLocked('appointment')).toBe(true);
    expect(isLocked('result_entry')).toBe(true);
    expect(isLocked('validate')).toBe(true);
  });

  it('returns false for unlocked actions', () => {
    expect(isLocked('billing')).toBe(false);
    expect(isLocked('queue')).toBe(false);
    // sample_collection IS locked — every copy sits in a fixed slot
    // (Collect / Frontdesk / Lab, see process-workflow.collect-area.spec).
    expect(isLocked('sample_collection')).toBe(true);
  });

  it('returns false for unknown actions', () => {
    expect(isLocked('unknown_action')).toBe(false);
  });
});

describe('isMandatory', () => {
  it('returns true for mandatory actions', () => {
    expect(isMandatory('patient_registration')).toBe(true);
  });

  it('returns false for non-mandatory actions', () => {
    expect(isMandatory('appointment')).toBe(false);
    expect(isMandatory('billing')).toBe(false);
    expect(isMandatory('queue')).toBe(false);
  });

  it('returns false for unknown actions', () => {
    expect(isMandatory('unknown_action')).toBe(false);
  });
});

describe('actionHome', () => {
  it('returns home category for an action', () => {
    expect(actionHome('patient_registration')).toBe('frontdesk');
    expect(actionHome('result_entry')).toBe('lab');
    expect(actionHome('validate')).toBe('validate');
  });

  it('returns null for actions without a policy', () => {
    expect(actionHome('billing')).toBeNull();
    expect(actionHome('queue')).toBeNull();
  });

  it('returns null for unknown actions', () => {
    expect(actionHome('unknown_action')).toBeNull();
  });
});

describe('ACTION_COUPLINGS', () => {
  it('is an array of coupling groups', () => {
    expect(Array.isArray(ACTION_COUPLINGS)).toBe(true);
  });

  it('contains dispatch and lab_intake coupling', () => {
    const coupling = ACTION_COUPLINGS.find(g => g.includes('dispatch'));
    expect(coupling).toEqual(['dispatch', 'lab_intake']);
  });
});

describe('coupledTypes', () => {
  it('returns coupled types for dispatch', () => {
    const coupled = coupledTypes('dispatch');
    expect(coupled).toContain('lab_intake');
  });

  it('returns coupled types for lab_intake', () => {
    const coupled = coupledTypes('lab_intake');
    expect(coupled).toContain('dispatch');
  });

  it('returns empty array for uncoupled action', () => {
    expect(coupledTypes('billing')).toEqual([]);
    expect(coupledTypes('queue')).toEqual([]);
  });

  it('returns empty array for unknown action', () => {
    expect(coupledTypes('unknown_action')).toEqual([]);
  });
});

describe('ACTION_REQUIRES', () => {
  it('is an object mapping actions to their requirements', () => {
    expect(typeof ACTION_REQUIRES).toBe('object');
  });

  it('dispatch requires sample_collection', () => {
    expect(ACTION_REQUIRES['dispatch']).toContain('sample_collection');
  });

  it('validate requires result_entry', () => {
    expect(ACTION_REQUIRES['validate']).toContain('result_entry');
  });

  it('results requires validate', () => {
    expect(ACTION_REQUIRES['results']).toContain('validate');
  });

  it('billing requires patient_registration', () => {
    expect(ACTION_REQUIRES['billing']).toContain('patient_registration');
  });
});

describe('requiresOf', () => {
  it('returns requirements for an action', () => {
    expect(requiresOf('dispatch')).toContain('sample_collection');
    expect(requiresOf('validate')).toContain('result_entry');
    expect(requiresOf('results')).toContain('validate');
  });

  it('returns empty array for actions with no requirements', () => {
    expect(requiresOf('sample_collection')).toEqual([]);
    expect(requiresOf('queue')).toEqual([]);
  });

  it('returns empty array for unknown actions', () => {
    expect(requiresOf('unknown_action')).toEqual([]);
  });
});

describe('dependentsOf', () => {
  it('returns actions that depend on sample_collection', () => {
    const deps = dependentsOf('sample_collection');
    expect(deps).toContain('dispatch');
  });

  it('returns actions that depend on result_entry', () => {
    const deps = dependentsOf('result_entry');
    expect(deps).toContain('validate');
  });

  it('returns actions that depend on validate', () => {
    const deps = dependentsOf('validate');
    expect(deps).toContain('results');
  });

  it('returns empty array when no actions depend on it', () => {
    expect(dependentsOf('appointment')).toEqual([]);
    expect(dependentsOf('billing')).toEqual([]);
  });

  it('returns empty array for unknown actions', () => {
    expect(dependentsOf('unknown_action')).toEqual([]);
  });
});

describe('SYSTEM_AREA_SCREEN', () => {
  it('is an object mapping area ids to routes', () => {
    expect(typeof SYSTEM_AREA_SCREEN).toBe('object');
  });

  it('maps frontdesk to /frontdesk', () => {
    expect(SYSTEM_AREA_SCREEN['frontdesk']).toBe('/frontdesk');
  });

  it('maps lab to /lab/my-work', () => {
    expect(SYSTEM_AREA_SCREEN['lab']).toBe('/lab/my-work');
  });

  it('maps validate to /pathologist', () => {
    expect(SYSTEM_AREA_SCREEN['validate']).toBe('/pathologist');
  });

  it('maps results to /reports', () => {
    expect(SYSTEM_AREA_SCREEN['results']).toBe('/reports');
  });

  it('has homecoll and messages mappings', () => {
    expect(SYSTEM_AREA_SCREEN['homecoll']).toBe('/home-collections');
    expect(SYSTEM_AREA_SCREEN['messages']).toBe('/messages');
  });
});

describe('COUNTER_SCREEN', () => {
  it('is an object mapping action types to counter screens', () => {
    expect(typeof COUNTER_SCREEN).toBe('object');
  });

  it('maps billing to /billing-counter', () => {
    expect(COUNTER_SCREEN['billing']).toBe('/billing-counter');
  });

  it('maps sample_collection to /sample-collection', () => {
    expect(COUNTER_SCREEN['sample_collection']).toBe('/sample-collection');
  });

  it('maps queue to /frontdesk/queue', () => {
    expect(COUNTER_SCREEN['queue']).toBe('/frontdesk/queue');
  });

  it('maps lost_and_found to /lost-and-found', () => {
    expect(COUNTER_SCREEN['lost_and_found']).toBe('/lost-and-found');
  });
});

describe('workAreaRoute', () => {
  const cfg: ProcessWorkflowConfig = {
    categories: [
      { id: 'frontdesk', name: 'Front Desk', icon: 'folder', color: '#000', order: 0 },
      { id: 'lab', name: 'Lab', icon: 'flask', color: '#000', order: 1 },
      { id: 'custom', name: 'Custom', icon: 'folder', color: '#000', order: 2 },
    ],
    actions: [
      { id: 'reg', type: 'patient_registration', categoryId: 'frontdesk', order: 0, enabled: true },
      { id: 'bill', type: 'billing', categoryId: 'frontdesk', order: 1, enabled: true },
      { id: 'queue1', type: 'queue', categoryId: 'custom', order: 0, enabled: true },
      { id: 'queue2', type: 'queue', categoryId: 'lab', order: 0, enabled: false },
    ],
  };

  it('returns system screen route for system area', () => {
    const frontdesk: ProcessCategory = cfg.categories[0];
    expect(workAreaRoute(frontdesk, cfg)).toBe('/frontdesk');
  });

  it('returns system screen route for lab area', () => {
    const lab: ProcessCategory = cfg.categories[1];
    expect(workAreaRoute(lab, cfg)).toBe('/lab/my-work');
  });

  it('returns counter screen for single enabled counter action', () => {
    const custom: ProcessCategory = cfg.categories[2];
    expect(workAreaRoute(custom, cfg)).toBe('/frontdesk/queue');
  });

  it('returns generic host route for multi-action custom area', () => {
    const multiCfg: ProcessWorkflowConfig = {
      categories: cfg.categories,
      actions: [
        ...cfg.actions,
        { id: 'bill2', type: 'billing', categoryId: 'custom', order: 1, enabled: true },
      ],
    };
    const custom: ProcessCategory = multiCfg.categories[2];
    expect(workAreaRoute(custom, multiCfg)).toBe('/w/custom');
  });

  it('returns generic host route when no actions in area', () => {
    const emptyCfg: ProcessWorkflowConfig = {
      categories: cfg.categories,
      actions: [cfg.actions[0]],
    };
    const custom: ProcessCategory = emptyCfg.categories[2];
    expect(workAreaRoute(custom, emptyCfg)).toBe('/w/custom');
  });
});

describe('deriveModes', () => {
  it('returns null when config is null', () => {
    expect(deriveModes(null)).toBeNull();
  });

  it('returns null when config is undefined', () => {
    expect(deriveModes(undefined)).toBeNull();
  });

  it('returns null when config has no actions', () => {
    expect(deriveModes({ categories: [], actions: [] })).toBeNull();
  });

  it('derives front_desk collection mode when sample_collection is in frontdesk', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [{ id: 'frontdesk', name: 'FD', icon: 'folder', color: '#000', order: 0 }],
      actions: [
        { id: 'reg', type: 'patient_registration', categoryId: 'frontdesk', order: 0, enabled: true },
        { id: 'coll', type: 'sample_collection', categoryId: 'frontdesk', order: 1, enabled: true },
      ],
    };
    const modes = deriveModes(cfg);
    expect(modes?.collectionMode).toBe('front_desk');
  });

  it('derives dedicated_counter collection mode when sample_collection is not in frontdesk', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [
        { id: 'frontdesk', name: 'FD', icon: 'folder', color: '#000', order: 0 },
        { id: 'collect', name: 'Collect', icon: 'folder', color: '#000', order: 1 },
      ],
      actions: [
        { id: 'reg', type: 'patient_registration', categoryId: 'frontdesk', order: 0, enabled: true },
        { id: 'coll', type: 'sample_collection', categoryId: 'collect', order: 0, enabled: true },
      ],
    };
    const modes = deriveModes(cfg);
    expect(modes?.collectionMode).toBe('dedicated_counter');
  });

  it('derives separate_counter billing mode when billing is in different menu from registration', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [
        { id: 'frontdesk', name: 'FD', icon: 'folder', color: '#000', order: 0 },
        { id: 'billing', name: 'Billing', icon: 'billing', color: '#000', order: 1 },
      ],
      actions: [
        { id: 'reg', type: 'patient_registration', categoryId: 'frontdesk', order: 0, enabled: true },
        { id: 'bill', type: 'billing', categoryId: 'billing', order: 0, enabled: true },
      ],
    };
    const modes = deriveModes(cfg);
    expect(modes?.billingMode).toBe('separate_counter');
  });

  it('derives front_desk billing mode when billing is in same menu as registration', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [{ id: 'frontdesk', name: 'FD', icon: 'folder', color: '#000', order: 0 }],
      actions: [
        { id: 'reg', type: 'patient_registration', categoryId: 'frontdesk', order: 0, enabled: true },
        { id: 'bill', type: 'billing', categoryId: 'frontdesk', order: 1, enabled: true },
      ],
    };
    const modes = deriveModes(cfg);
    expect(modes?.billingMode).toBe('front_desk');
  });
});

describe('COLLECTION_SLOTS / isFixedSlotAction', () => {
  it('Sample Collection sits only in Collect, Frontdesk and Lab', () => {
    expect(COLLECTION_SLOTS).toEqual(['collect', 'frontdesk', 'lab']);
  });

  it('only sample_collection is a fixed-slot action', () => {
    expect(isFixedSlotAction('sample_collection')).toBe(true);
    expect(isFixedSlotAction('billing')).toBe(false);
    expect(isFixedSlotAction('queue')).toBe(false);
    expect(isFixedSlotAction('unknown_action')).toBe(false);
  });
});

describe('frontdeskMenu', () => {
  it('returns categoryId of menu with patient_registration', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [{ id: 'frontdesk', name: 'FD', icon: 'folder', color: '#000', order: 0 }],
      actions: [
        { id: 'reg', type: 'patient_registration', categoryId: 'frontdesk', order: 0, enabled: true },
      ],
    };
    expect(frontdeskMenu(cfg)).toBe('frontdesk');
  });

  it('falls back to walk_in_order when patient_registration not found', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [{ id: 'desk', name: 'Desk', icon: 'folder', color: '#000', order: 0 }],
      actions: [
        { id: 'order', type: 'walk_in_order', categoryId: 'desk', order: 0, enabled: true },
      ],
    };
    expect(frontdeskMenu(cfg)).toBe('desk');
  });

  it('falls back to appointment when registration and walk_in_order not found', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [{ id: 'desk', name: 'Desk', icon: 'folder', color: '#000', order: 0 }],
      actions: [
        { id: 'apt', type: 'appointment', categoryId: 'desk', order: 0, enabled: true },
      ],
    };
    expect(frontdeskMenu(cfg)).toBe('desk');
  });

  it('returns undefined when none of the three actions exist', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [{ id: 'lab', name: 'Lab', icon: 'flask', color: '#000', order: 0 }],
      actions: [{ id: 'result', type: 'result_entry', categoryId: 'lab', order: 0, enabled: true }],
    };
    expect(frontdeskMenu(cfg)).toBeUndefined();
  });

  it('returns undefined when config is null', () => {
    expect(frontdeskMenu(null)).toBeUndefined();
  });

  it('ignores disabled actions', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [{ id: 'desk', name: 'Desk', icon: 'folder', color: '#000', order: 0 }],
      actions: [
        { id: 'reg', type: 'patient_registration', categoryId: 'desk', order: 0, enabled: false },
      ],
    };
    expect(frontdeskMenu(cfg)).toBeUndefined();
  });
});

describe('collectionLocations', () => {
  it('returns empty array when no sample_collection actions', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [],
      actions: [{ id: 'bill', type: 'billing', categoryId: 'frontdesk', order: 0, enabled: true }],
    };
    expect(collectionLocations(cfg)).toEqual([]);
  });

  it('returns single menu id when collection placed in one menu', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [{ id: 'frontdesk', name: 'FD', icon: 'folder', color: '#000', order: 0 }],
      actions: [
        { id: 'coll', type: 'sample_collection', categoryId: 'frontdesk', order: 0, enabled: true },
      ],
    };
    expect(collectionLocations(cfg)).toEqual(['frontdesk']);
  });

  it('returns multiple menu ids when collection placed in several menus', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [
        { id: 'frontdesk', name: 'FD', icon: 'folder', color: '#000', order: 0 },
        { id: 'lab', name: 'Lab', icon: 'flask', color: '#000', order: 1 },
      ],
      actions: [
        { id: 'coll1', type: 'sample_collection', categoryId: 'frontdesk', order: 0, enabled: true },
        { id: 'coll2', type: 'sample_collection', categoryId: 'lab', order: 0, enabled: true },
      ],
    };
    const locs = collectionLocations(cfg);
    expect(locs.length).toBe(2);
    expect(locs).toContain('frontdesk');
    expect(locs).toContain('lab');
  });

  it('ignores copies outside the fixed slots (billing counter / custom)', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [],
      actions: [
        { id: 'c1', type: 'sample_collection', categoryId: 'billdesk', order: 0, enabled: true },
        { id: 'c2', type: 'sample_collection', categoryId: 'custom1', order: 0, enabled: true },
        { id: 'c3', type: 'sample_collection', categoryId: 'collect', order: 0, enabled: true },
      ],
    };
    expect(collectionLocations(cfg)).toEqual(['collect']);
  });

  it('ignores disabled sample_collection actions', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [{ id: 'frontdesk', name: 'FD', icon: 'folder', color: '#000', order: 0 }],
      actions: [
        { id: 'coll', type: 'sample_collection', categoryId: 'frontdesk', order: 0, enabled: false },
      ],
    };
    expect(collectionLocations(cfg)).toEqual([]);
  });

  it('deduplicates menu ids', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [{ id: 'frontdesk', name: 'FD', icon: 'folder', color: '#000', order: 0 }],
      actions: [
        { id: 'coll1', type: 'sample_collection', categoryId: 'frontdesk', order: 0, enabled: true },
        { id: 'coll2', type: 'sample_collection', categoryId: 'frontdesk', order: 1, enabled: true },
      ],
    };
    const locs = collectionLocations(cfg);
    expect(locs.length).toBe(1);
    expect(locs[0]).toBe('frontdesk');
  });

  it('returns empty array when config is null', () => {
    expect(collectionLocations(null)).toEqual([]);
  });
});

describe('collectsAtFrontdesk', () => {
  it('returns true when collection is in frontdesk menu', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [{ id: 'frontdesk', name: 'FD', icon: 'folder', color: '#000', order: 0 }],
      actions: [
        { id: 'reg', type: 'patient_registration', categoryId: 'frontdesk', order: 0, enabled: true },
        { id: 'coll', type: 'sample_collection', categoryId: 'frontdesk', order: 1, enabled: true },
      ],
    };
    expect(collectsAtFrontdesk(cfg)).toBe(true);
  });

  it('returns false when collection is not in frontdesk menu', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [
        { id: 'frontdesk', name: 'FD', icon: 'folder', color: '#000', order: 0 },
        { id: 'collect', name: 'Collect', icon: 'folder', color: '#000', order: 1 },
      ],
      actions: [
        { id: 'reg', type: 'patient_registration', categoryId: 'frontdesk', order: 0, enabled: true },
        { id: 'coll', type: 'sample_collection', categoryId: 'collect', order: 0, enabled: true },
      ],
    };
    expect(collectsAtFrontdesk(cfg)).toBe(false);
  });

  it('returns false when no frontdesk menu exists', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [{ id: 'lab', name: 'Lab', icon: 'flask', color: '#000', order: 0 }],
      actions: [{ id: 'coll', type: 'sample_collection', categoryId: 'lab', order: 0, enabled: true }],
    };
    expect(collectsAtFrontdesk(cfg)).toBe(false);
  });

  it('returns false when no collection actions exist', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [{ id: 'frontdesk', name: 'FD', icon: 'folder', color: '#000', order: 0 }],
      actions: [
        { id: 'reg', type: 'patient_registration', categoryId: 'frontdesk', order: 0, enabled: true },
      ],
    };
    expect(collectsAtFrontdesk(cfg)).toBe(false);
  });

  it('returns false when config is null', () => {
    expect(collectsAtFrontdesk(null)).toBe(false);
  });
});

describe('hasDedicatedCollection', () => {
  it('returns false when collection is only in frontdesk', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [{ id: 'frontdesk', name: 'FD', icon: 'folder', color: '#000', order: 0 }],
      actions: [
        { id: 'reg', type: 'patient_registration', categoryId: 'frontdesk', order: 0, enabled: true },
        { id: 'coll', type: 'sample_collection', categoryId: 'frontdesk', order: 1, enabled: true },
      ],
    };
    expect(hasDedicatedCollection(cfg)).toBe(false);
  });

  it('returns true when collection is in non-frontdesk menu', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [
        { id: 'frontdesk', name: 'FD', icon: 'folder', color: '#000', order: 0 },
        { id: 'collect', name: 'Collect', icon: 'folder', color: '#000', order: 1 },
      ],
      actions: [
        { id: 'reg', type: 'patient_registration', categoryId: 'frontdesk', order: 0, enabled: true },
        { id: 'coll', type: 'sample_collection', categoryId: 'collect', order: 0, enabled: true },
      ],
    };
    expect(hasDedicatedCollection(cfg)).toBe(true);
  });

  it('returns true when collection is in both frontdesk and another menu', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [
        { id: 'frontdesk', name: 'FD', icon: 'folder', color: '#000', order: 0 },
        { id: 'collect', name: 'Collect', icon: 'folder', color: '#000', order: 1 },
      ],
      actions: [
        { id: 'reg', type: 'patient_registration', categoryId: 'frontdesk', order: 0, enabled: true },
        { id: 'coll1', type: 'sample_collection', categoryId: 'frontdesk', order: 1, enabled: true },
        { id: 'coll2', type: 'sample_collection', categoryId: 'collect', order: 0, enabled: true },
      ],
    };
    expect(hasDedicatedCollection(cfg)).toBe(true);
  });

  it('returns false when no collection actions exist', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [{ id: 'frontdesk', name: 'FD', icon: 'folder', color: '#000', order: 0 }],
      actions: [
        { id: 'reg', type: 'patient_registration', categoryId: 'frontdesk', order: 0, enabled: true },
      ],
    };
    expect(hasDedicatedCollection(cfg)).toBe(false);
  });

  it('returns false when config is null', () => {
    expect(hasDedicatedCollection(null)).toBe(false);
  });
});

describe('LAB_MENU_ID', () => {
  it('is the string lab', () => {
    expect(LAB_MENU_ID).toBe('lab');
  });
});

describe('collectsInLab', () => {
  it('returns true when sample_collection is in lab menu', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [{ id: 'lab', name: 'Lab', icon: 'flask', color: '#000', order: 0 }],
      actions: [
        { id: 'coll', type: 'sample_collection', categoryId: 'lab', order: 0, enabled: true },
      ],
    };
    expect(collectsInLab(cfg)).toBe(true);
  });

  it('returns false when sample_collection is not in lab menu', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [{ id: 'frontdesk', name: 'FD', icon: 'folder', color: '#000', order: 0 }],
      actions: [
        { id: 'coll', type: 'sample_collection', categoryId: 'frontdesk', order: 0, enabled: true },
      ],
    };
    expect(collectsInLab(cfg)).toBe(false);
  });

  it('returns false when no collection actions exist', () => {
    const cfg: ProcessWorkflowConfig = {
      categories: [{ id: 'lab', name: 'Lab', icon: 'flask', color: '#000', order: 0 }],
      actions: [{ id: 'result', type: 'result_entry', categoryId: 'lab', order: 0, enabled: true }],
    };
    expect(collectsInLab(cfg)).toBe(false);
  });

  it('returns false when config is null', () => {
    expect(collectsInLab(null)).toBe(false);
  });
});

describe('collectsAtBillingCounter', () => {
  const cats = [
    { id: 'frontdesk', name: 'FD', icon: 'folder', color: '#000', order: 0 },
    { id: 'billdesk', name: 'Billing', icon: 'folder', color: '#000', order: 1 },
    { id: 'collect', name: 'Collection', icon: 'folder', color: '#000', order: 2 },
  ];
  const cfg = (collIn: string[], billIn = 'billdesk', billOn = true): ProcessWorkflowConfig => ({
    categories: cats,
    actions: [
      { id: 'reg', type: 'patient_registration', categoryId: 'frontdesk', order: 0, enabled: true },
      { id: 'bill', type: 'billing', categoryId: billIn, order: 0, enabled: billOn },
      ...collIn.map((c, i) => ({ id: 'coll' + i, type: 'sample_collection', categoryId: c, order: 1, enabled: true })),
    ],
  });

  it('is RETIRED (fixed slots): false even with a copy in the billing counter menu', () => {
    expect(collectsAtBillingCounter(cfg(['billdesk']))).toBe(false);
    expect(collectsAtBillingCounter(cfg(['collect', 'billdesk']))).toBe(false);
  });
  it('is false when collection lives elsewhere', () => {
    expect(collectsAtBillingCounter(cfg(['collect']))).toBe(false);
    expect(collectsAtBillingCounter(cfg(['frontdesk']))).toBe(false);
    expect(collectsAtBillingCounter(cfg([]))).toBe(false);
  });
  it('is false when billing is not a separate counter, disabled, or no workflow', () => {
    expect(collectsAtBillingCounter(cfg(['frontdesk'], 'frontdesk'))).toBe(false);
    expect(collectsAtBillingCounter(cfg(['billdesk'], 'billdesk', false))).toBe(false);
    expect(collectsAtBillingCounter(null)).toBe(false);
  });
});

describe('areasWithCollection / screenWorkArea (band Collect entry point)', () => {
  const act = (id: string, type: string, categoryId: string, enabled = true) =>
    ({ id, type, categoryId, enabled, order: 0 });
  const cfg = {
    categories: [],
    actions: [
      act('r', 'patient_registration', 'frontdesk'),
      act('b', 'billing', 'billdesk'),
      act('c1', 'sample_collection', 'frontdesk'),
      act('c2', 'sample_collection', 'billdesk'),
      act('c3', 'sample_collection', 'lab', false),
      act('c4', 'sample_collection', 'custom1'),
    ],
  };

  it('lists only the Frontdesk / Lab slots whose copy is ENABLED (strays ignored)', () => {
    expect(areasWithCollection(cfg).sort()).toEqual(['frontdesk']);
    const labOn = { ...cfg, actions: cfg.actions.map(a => a.id === 'c3' ? { ...a, enabled: true } : a) };
    expect(areasWithCollection(labOn).sort()).toEqual(['frontdesk', 'lab']);
  });

  it('no workflow configured → []', () => {
    expect(areasWithCollection(null)).toEqual([]);
    expect(areasWithCollection(undefined)).toEqual([]);
    expect(areasWithCollection({ categories: [], actions: [] })).toEqual([]);
  });

  it('the billing counter never collects', () => {
    expect(collectsAtBillingCounter(cfg)).toBe(false);
  });

  it('maps screens to their work-area like the nav', () => {
    expect(screenWorkArea('frontdesk', cfg)).toBe('frontdesk');
    expect(screenWorkArea(BILLING_COUNTER_SCREEN, cfg)).toBe('billdesk');
    expect(screenWorkArea('lab', cfg)).toBe('lab');
    expect(screenWorkArea('custom1', cfg)).toBe('custom1');
    expect(screenWorkArea('', cfg)).toBeNull();
  });

  it('billing counter with billing off → no area', () => {
    const off = { ...cfg, actions: cfg.actions.map(a => a.type === 'billing' ? { ...a, enabled: false } : a) };
    expect(screenWorkArea(BILLING_COUNTER_SCREEN, off)).toBeNull();
  });

  it('frontdesk follows the registration menu', () => {
    const moved = { categories: [], actions: [act('r', 'patient_registration', 'reception')] };
    expect(screenWorkArea('frontdesk', moved)).toBe('reception');
    expect(screenWorkArea('frontdesk', null)).toBe('frontdesk');
  });
});
