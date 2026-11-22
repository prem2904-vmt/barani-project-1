import { signal } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { EditLedger, dirtySnapshot, formSnapshot, sameValue, stableJson } from './dirty-snapshot';
import { NO_CHANGES_TITLE, ariaDisabled, saveTitle } from './save-state';

/** Owner 2026-11-19: Save enabled ONLY when something changed — a compare with the last SAVED snapshot. */
describe('dirty snapshot — Save only when something changed', () => {
  it('stableJson / sameValue: key order and undefined keys never matter; values do', () => {
    expect(stableJson({ b: 1, a: [1, { y: 2, x: undefined, z: null }] })).toBe(stableJson({ a: [1, { z: null, y: 2 }], b: 1 }));
    expect(sameValue({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(sameValue({ a: 1 }, { a: '1' })).toBe(false);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
    expect(sameValue(new Set(['b', 'a']), new Set(['a', 'b']))).toBe(true);
    expect(sameValue(new Date('2026-11-19T00:00:00Z'), new Date('2026-11-19T00:00:00Z'))).toBe(true);
    expect(sameValue(NaN, NaN)).toBe(true);
  });

  it('edit → dirty; revert to the original → clean again', () => {
    const form = signal({ name: 'Main', gst: false });
    const s = dirtySnapshot(() => form());
    expect(s.dirty()).toBe(false);                   // no snapshot yet: never dirty
    s.mark();
    expect(s.ready()).toBe(true);
    expect(s.dirty()).toBe(false);
    form.set({ name: 'Main lab', gst: false });
    expect(s.dirty()).toBe(true);
    form.set({ gst: false, name: 'Main' });          // same value, other key order
    expect(s.dirty()).toBe(false);
  });

  it('save success re-takes the snapshot (clean); save failure keeps it (still dirty)', () => {
    const form = signal({ n: 1 });
    const s = dirtySnapshot(() => form());
    s.mark();
    form.set({ n: 2 });
    // A failed save: nothing marks → Save stays enabled.
    expect(s.dirty()).toBe(true);
    // A successful save: mark → Save disables.
    s.mark();
    expect(s.dirty()).toBe(false);
    form.set({ n: 3 });
    expect(s.dirty()).toBe(true);
    // Mark with what the SERVER holds (an edit made mid-flight stays dirty).
    s.mark({ n: 2 });
    expect(s.dirty()).toBe(true);
  });

  it('saved() is a deep copy for Discard; clear() forgets the snapshot', () => {
    const form = signal({ list: [1, 2] });
    const s = dirtySnapshot(() => form());
    s.mark();
    const copy = s.saved()!;
    copy.list.push(3);
    expect(s.saved()).toEqual({ list: [1, 2] });
    form.set({ list: [9] });
    form.set(s.saved()!);
    expect(s.dirty()).toBe(false);
    s.clear();
    expect(s.saved()).toBeUndefined();
    expect(s.dirty()).toBe(false);
  });

  it('reactive form: dirty follows the VALUE (Angular\'s own dirty flag stays true after a revert)', () => {
    const fg = new FormGroup({ name: new FormControl('A'), n: new FormControl(1) });
    const s = formSnapshot(fg);
    s.mark();
    fg.controls.name.setValue('B');
    fg.controls.name.markAsDirty();
    expect(s.dirty()).toBe(true);
    fg.controls.name.setValue('A');
    expect(fg.dirty).toBe(true);                     // "touched" — the wrong signal for Save
    expect(s.dirty()).toBe(false);                   // value back → Save disabled
    fg.controls.n.setValue(2);
    expect(s.dirty()).toBe(true);
    s.mark();
    expect(s.dirty()).toBe(false);
    expect(fg.pristine).toBe(true);
  });

  it('EditLedger (batch grids): a cell edited back to its first value is no longer pending', () => {
    const l = new EditLedger<unknown>();
    l.set('t1', 'name', 'Hb', 'Hgb');
    l.set('t1', 'unit', 'g/dL', 'g/L');
    expect(l.count()).toBe(1);
    l.set('t1', 'name', 'Hgb', 'Haemoglobin');       // second edit keeps the FIRST original
    expect(l.original('t1', 'name')).toBe('Hb');
    l.set('t1', 'name', 'Haemoglobin', 'Hb');
    expect(l.edits().get('t1')).toEqual({ unit: 'g/L' });
    l.set('t1', 'unit', 'g/L', 'g/dL');
    expect(l.count()).toBe(0);
    expect(l.dirty()).toBe(false);
    l.set('t2', 'price', 100, 120);
    l.drop('t2');
    expect(l.count()).toBe(0);
    l.set('t3', 'price', 100, 120);
    l.clear();
    expect(l.count()).toBe(0);
  });

  it('the disabled Save words: "No changes to save", aria-disabled only while disabled', () => {
    expect(saveTitle(false)).toBe(NO_CHANGES_TITLE);
    expect(NO_CHANGES_TITLE).toBe('No changes to save');
    expect(saveTitle(true, 'Save changes')).toBe('Save changes');
    expect(ariaDisabled(true)).toBe('true');
    expect(ariaDisabled(false)).toBeNull();
  });
});
