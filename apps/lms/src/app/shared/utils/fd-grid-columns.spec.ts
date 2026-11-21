import {
  FD_COLUMNS, FD_MODULES, addFdColumn, columnHasData, defaultFdColumns, fdColumn, fdConfigOf, fdHiddenKey, fdPalette, insertFdColumn,
  isDefaultFdColumns, loadFdHidden, mergeFdColumns, moveFdColumn, readyFdColumns, removeFdColumn, saveFdHidden, visibleFdColumns,
} from './fd-grid-columns';

/** Frontdesk Work grid columns (owner mock grid-settings-v3, 2026-11-21): the ONE catalogue + its rules. Fake data only. */

describe('catalogue invariants', () => {
  for (const m of FD_MODULES) {
    describe(m, () => {
      const cols = FD_COLUMNS[m];
      it('Token · Patient · Where now first, Waiting · Next last, and only those five are locked (no Journey column)', () => {
        expect(cols.slice(0, 3).map(c => c.id)).toEqual(['token', 'patient', 'where']);
        expect(cols.slice(-2).map(c => c.id)).toEqual(['waiting', 'next']);
        expect(cols.filter(c => c.locked).map(c => c.id)).toEqual(['token', 'patient', 'where', 'waiting', 'next']);
        expect(cols.some(c => c.id === 'journey')).toBe(false);
      });
      it('ids are unique and fit the server rule (lower-case, ≤ 32)', () => {
        const ids = cols.map(c => c.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9_-]{0,31}$/);
      });
      it('every column says what it is, has a width, and an alignment', () => {
        for (const c of cols) {
          expect(c.label.trim()).not.toBe('');
          expect(c.description.trim()).not.toBe('');
          expect(c.min).toBeGreaterThan(40);
          expect(['left', 'center', 'right']).toContain(c.align);
        }
      });
      it('defaults = the default-on columns, never a needs-data one, locked ones included', () => {
        const d = defaultFdColumns(m);
        expect(d[0]).toBe('token');
        expect(d[1]).toBe('patient');
        expect(d.slice(-2)).toEqual(['waiting', 'next']);
        for (const id of d) expect(fdColumn(m, id)?.needsData).toBeUndefined();
        expect(mergeFdColumns(m, d)).toEqual(d);
      });
    });
  }
  it('no Lab "Tests" column (house rule: long test lists made rows 6–8 lines)', () => {
    expect(FD_COLUMNS.lab.some(c => /test/i.test(c.id) || /^tests?$/i.test(c.label))).toBe(false);
  });
  it('the mock\'s defaults, Waiting fixed before Next: Lab Token · Patient · Where now · Samples · Payment · Waiting · Next', () => {
    expect(defaultFdColumns('lab')).toEqual(['token', 'patient', 'where', 'samples', 'payment', 'waiting', 'next']);
    expect(defaultFdColumns('opd')).toEqual(['token', 'patient', 'where', 'doctor', 'vitals', 'payment', 'waiting', 'next']);
  });
  it('needs-data columns are the ones no feed carries today', () => {
    const nd = (m: typeof FD_MODULES[number]) => FD_COLUMNS[m].filter(c => c.needsData).map(c => c.id);
    expect(nd('lab')).toEqual(['due']);
    expect(nd('opd')).toEqual(['appt', 'room']);
    expect(nd('ipd')).toEqual(['ward', 'discharge']);
    expect(nd('er')).toEqual(['triage', 'bay']);
    expect(nd('scan')).toEqual(['study', 'prep', 'radiologist']);
  });
});

describe('merging the saved list', () => {
  it('nothing saved (null / not a list) = defaults', () => {
    expect(mergeFdColumns('lab', null)).toEqual(defaultFdColumns('lab'));
    expect(mergeFdColumns('lab', undefined)).toEqual(defaultFdColumns('lab'));
  });
  it('unknown / removed / duplicate ids are ignored; locked ones are put back in place', () => {
    expect(mergeFdColumns('lab', ['priority', 'gone', 'next', 'waiting', 'priority', 'token', 7, 'samples'])).toEqual(['token', 'patient', 'where', 'priority', 'samples', 'waiting', 'next']);
  });
  it('a saved legacy "journey" id is Where now (the Journey column merged in)', () => {
    expect(mergeFdColumns('lab', ['journey', 'priority'])).toEqual(['token', 'patient', 'where', 'priority', 'waiting', 'next']);
  });
  it('a catalogue column the admin never added stays OFF (new columns never appear by themselves)', () => {
    const saved = ['token', 'patient', 'where', 'waiting', 'next'];
    const out = mergeFdColumns('lab', saved);
    expect(out).toEqual(saved);
    expect(out).not.toContain('samples');
  });
  it('an empty saved list = just the locked columns', () => {
    expect(mergeFdColumns('opd', [])).toEqual(['token', 'patient', 'where', 'waiting', 'next']);
  });
  it('a column of another module is unknown here', () => {
    expect(mergeFdColumns('lab', ['doctor', 'ward'])).toEqual(['token', 'patient', 'where', 'waiting', 'next']);
  });
  it('config: staff may hide by default', () => {
    expect(fdConfigOf('lab', null)).toEqual({ columns: defaultFdColumns('lab'), staffMayHide: true });
    expect(fdConfigOf('lab', { columns: ['refdoc'], staffMayHide: false })).toEqual({ columns: ['token', 'patient', 'where', 'refdoc', 'waiting', 'next'], staffMayHide: false });
  });
});

describe('locked rules while editing', () => {
  const base = defaultFdColumns('lab');          // token patient where samples payment waiting next
  it('+ adds at the end of the movable columns (before Waiting · Next)', () => {
    const out = addFdColumn('lab', base, 'priority');
    expect(out.slice(-3)).toEqual(['priority', 'waiting', 'next']);
    expect(addFdColumn('lab', out, 'priority')).toEqual(out);
  });
  it('inserting never lands before Token / Patient / Where now or after Waiting / Next', () => {
    expect(insertFdColumn('lab', base, 'priority', 0).slice(0, 4)).toEqual(['token', 'patient', 'where', 'priority']);
    expect(insertFdColumn('lab', base, 'priority', 99).slice(-3)).toEqual(['priority', 'waiting', 'next']);
  });
  it('moving an existing column accounts for its own slot', () => {
    // Move Payment (index 4) to before Samples (index 3).
    expect(insertFdColumn('lab', base, 'payment', 3)).toEqual(['token', 'patient', 'where', 'payment', 'samples', 'waiting', 'next']);
    // Move Samples (index 3) to before Waiting (index 5) → it ends just before Waiting.
    expect(insertFdColumn('lab', base, 'samples', 5)).toEqual(['token', 'patient', 'where', 'payment', 'samples', 'waiting', 'next']);
    // Asking for a slot before Where now lands right after it.
    expect(insertFdColumn('lab', base, 'payment', 1)).toEqual(['token', 'patient', 'where', 'payment', 'samples', 'waiting', 'next']);
  });
  it('locked or unknown columns cannot be inserted, moved or removed', () => {
    expect(insertFdColumn('lab', base, 'next', 2)).toEqual(base);
    expect(insertFdColumn('lab', base, 'waiting', 2)).toEqual(base);
    expect(insertFdColumn('lab', base, 'where', 5)).toEqual(base);
    expect(removeFdColumn('lab', base, 'where')).toEqual(base);
    expect(removeFdColumn('lab', base, 'waiting')).toEqual(base);
    expect(insertFdColumn('lab', base, 'nope', 2)).toEqual(base);
    expect(removeFdColumn('lab', base, 'token')).toEqual(base);
    expect(removeFdColumn('lab', base, 'patient')).toEqual(base);
    expect(moveFdColumn('lab', base, 'next', -1)).toEqual(base);
  });
  it('remove takes it out; Alt+arrows move one step, never past the locked columns', () => {
    expect(removeFdColumn('lab', base, 'samples')).not.toContain('samples');
    expect(moveFdColumn('lab', base, 'payment', -1)).toEqual(['token', 'patient', 'where', 'payment', 'samples', 'waiting', 'next']);
    expect(moveFdColumn('lab', base, 'samples', -1)).toEqual(base);
    expect(moveFdColumn('lab', base, 'where', 1)).toEqual(base);
    expect(moveFdColumn('lab', base, 'payment', 1)).toEqual(base);
    expect(moveFdColumn('lab', base, 'waiting', -1)).toEqual(base);
  });
  it('the palette = columns not in the grid; needs-data ones wait until their data exists', () => {
    const p = fdPalette('lab', base);
    expect(p.ready.map(c => c.id)).toEqual(['priority', 'refdoc', 'visit', 'orderid', 'branch']);
    expect(p.soon.map(c => c.id)).toEqual(['due']);
    const withData = fdPalette('lab', base, new Set(['due']));
    expect(withData.ready.map(c => c.id)).toContain('due');
    expect(withData.soon).toEqual([]);
  });
  it('isDefault follows the order exactly', () => {
    expect(isDefaultFdColumns('lab', base)).toBe(true);
    expect(isDefaultFdColumns('lab', moveFdColumn('lab', base, 'payment', -1))).toBe(false);
  });
});

describe('needs data becomes available on its own', () => {
  it('a column is ready once any row carries its field', () => {
    const room = fdColumn('opd', 'room')!;
    expect(columnHasData(room, [{ visit: { id: 'v1' } }])).toBe(false);
    expect(columnHasData(room, [{ visit: { id: 'v1', room: '' } }])).toBe(false);
    expect(columnHasData(room, [{ visit: { id: 'v1' } }, { visit: { id: 'v2', room: 'Room 4' } }])).toBe(true);
    expect([...readyFdColumns('opd', [{ visit: { room: 'Room 4' } }])]).toEqual(['room']);
    expect([...readyFdColumns('lab', [{ order: { reportDueAt: '2026-11-21T12:00:00Z' } }])]).toEqual(['due']);
    expect(columnHasData(fdColumn('lab', 'samples')!, [])).toBe(true);
  });
});

describe('staff hide (per person, this browser)', () => {
  const key = fdHiddenKey('t1', 'u1', 'lab');
  afterEach(() => localStorage.removeItem(key));
  it('key is per tenant · user · module', () => {
    expect(key).toBe('pf.fd.hiddenCols.t1.u1.lab');
  });
  it('round-trips; an empty list clears; a broken / blocked store reads as nothing hidden', () => {
    saveFdHidden(key, ['samples']);
    expect(loadFdHidden(key)).toEqual(['samples']);
    saveFdHidden(key, []);
    expect(localStorage.getItem(key)).toBeNull();
    localStorage.setItem(key, '{bad');
    expect(loadFdHidden(key)).toEqual([]);
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('blocked'); };
    try { expect(loadFdHidden(key)).toEqual([]); } finally { Storage.prototype.getItem = orig; }
  });
  it('hidden columns drop out only while the admin allows it, and never a locked one', () => {
    const cfg = fdConfigOf('lab', null);
    expect(visibleFdColumns('lab', cfg, ['samples', 'token', 'waiting'])).toEqual(['token', 'patient', 'where', 'payment', 'waiting', 'next']);
    expect(visibleFdColumns('lab', { ...cfg, staffMayHide: false }, ['samples'])).toEqual(cfg.columns);
  });
});
