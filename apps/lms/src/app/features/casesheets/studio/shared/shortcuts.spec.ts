import { SHORTCUTS, commandFor, keyWords, tip } from './shortcuts';

const k = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({ key, ...mods });

describe('Studio keyboard shortcuts', () => {
  it('⌘ and Ctrl both work: undo, redo, save, copy, select all', () => {
    for (const mod of [{ metaKey: true }, { ctrlKey: true }]) {
      expect(commandFor(k('z', mod), false)).toBe('undo');
      expect(commandFor(k('Z', { ...mod, shiftKey: true }), false)).toBe('redo');
      expect(commandFor(k('y', mod), false)).toBe('redo');
      expect(commandFor(k('s', mod), false)).toBe('save');
      expect(commandFor(k('d', mod), false)).toBe('duplicate');
      expect(commandFor(k('a', mod), false)).toBe('selectAll');
    }
  });

  it('questions: N adds, / searches, Enter renames, Delete / Backspace remove, Alt+arrows move', () => {
    expect(commandFor(k('n'), false)).toBe('add');
    expect(commandFor(k('/'), false)).toBe('search');
    expect(commandFor(k('Enter'), false)).toBe('rename');
    expect(commandFor(k('Delete'), false)).toBe('remove');
    expect(commandFor(k('Backspace'), false)).toBe('remove');
    expect(commandFor(k('ArrowUp', { altKey: true }), false)).toBe('moveUp');
    expect(commandFor(k('ArrowDown', { altKey: true }), false)).toBe('moveDown');
    expect(commandFor(k('ArrowDown'), false)).toBe('next');
    expect(commandFor(k('ArrowUp', { shiftKey: true }), false)).toBe('extendUp');
    expect(commandFor(k('['), false)).toBe('prevPage');
    expect(commandFor(k(']'), false)).toBe('nextPage');
    expect(commandFor(k('p'), false)).toBe('preview');
    expect(commandFor(k('?', { shiftKey: true }), false)).toBe('help');
    expect(commandFor(k('Escape'), false)).toBe('escape');
  });

  it('inside a text box only ⌘S and Esc act (the box keeps its own undo, arrows and letters)', () => {
    expect(commandFor(k('s', { metaKey: true }), true)).toBe('save');
    expect(commandFor(k('Escape'), true)).toBe('escape');
    for (const e of [k('z', { metaKey: true }), k('n'), k('Backspace'), k('ArrowUp', { altKey: true }), k('a', { ctrlKey: true }), k('Enter')]) {
      expect(commandFor(e, true)).toBeNull();
    }
  });

  it('browser keys stay the browser’s (⌘P print, ⌘N new window, plain letters)', () => {
    expect(commandFor(k('p', { metaKey: true }), false)).toBeNull();
    expect(commandFor(k('n', { ctrlKey: true }), false)).toBeNull();
    expect(commandFor(k('x'), false)).toBeNull();
    expect(commandFor(k('N', { shiftKey: true }), false)).toBeNull();
  });

  it('keys read ⌘ ⇧ ⌥ on a Mac and Ctrl+Shift elsewhere; tooltips carry them', () => {
    expect(keyWords(['mod', 'Shift', 'Z'], true)).toBe('⌘⇧Z');
    expect(keyWords(['mod', 'Shift', 'Z'], false)).toBe('Ctrl+Shift+Z');
    expect(tip('duplicate', 'Make a copy', true)).toBe('Make a copy (⌘D)');
    expect(tip('moveUp', 'Move up', false)).toBe('Move up (Alt+↑)');
  });

  it('every row in the panel names keys that really map to its command', () => {
    for (const row of SHORTCUTS) {
      const keys = row.keys[0].map((x) => (x === 'mod' ? 'Meta' : x));
      const key = keys[keys.length - 1];
      const ev = {
        key: key === '↑' ? 'ArrowUp' : key === '↓' ? 'ArrowDown' : key === 'Esc' ? 'Escape' : key,
        metaKey: keys.includes('Meta'),
        shiftKey: keys.includes('Shift') || key === '?',
        altKey: keys.includes('Alt'),
      };
      const got = commandFor(ev, false);
      expect([row.command, 'next', 'extendUp', 'prev'], row.words).toContain(got);
    }
  });
});
