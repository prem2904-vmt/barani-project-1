/**
 * Studio's keyboard shortcuts: ONE table, read by the editor (what a key
 * does), the "Keyboard shortcuts" panel (`?`) and the tooltips. Pure, so the
 * mapping is tested without a browser.
 *
 * ⌘ on a Mac is Ctrl elsewhere; both are accepted on every computer.
 */
export type StudioCommand =
  | 'undo'
  | 'redo'
  | 'save'
  | 'add'
  | 'search'
  | 'duplicate'
  | 'remove'
  | 'moveUp'
  | 'moveDown'
  | 'prev'
  | 'next'
  | 'extendUp'
  | 'extendDown'
  | 'selectAll'
  | 'rename'
  | 'escape'
  | 'prevPage'
  | 'nextPage'
  | 'preview'
  | 'help';

export interface KeyLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export interface ShortcutRow {
  command: StudioCommand;
  /** What it does, in plain words. */
  words: string;
  /** Keys as shown ("mod" becomes ⌘ or Ctrl). */
  keys: string[][];
  group: 'Questions' | 'Moving around' | 'The case sheet';
}

export const SHORTCUTS: ShortcutRow[] = [
  { command: 'add', words: 'Add a question after the selected one', keys: [['N']], group: 'Questions' },
  { command: 'search', words: 'Search the kinds of question', keys: [['/']], group: 'Questions' },
  { command: 'rename', words: 'Rename the selected question', keys: [['Enter']], group: 'Questions' },
  { command: 'duplicate', words: 'Make a copy', keys: [['mod', 'D']], group: 'Questions' },
  { command: 'remove', words: 'Remove (you can undo it)', keys: [['Delete'], ['Backspace']], group: 'Questions' },
  { command: 'moveUp', words: 'Move up', keys: [['Alt', '↑']], group: 'Questions' },
  { command: 'moveDown', words: 'Move down', keys: [['Alt', '↓']], group: 'Questions' },
  { command: 'prev', words: 'Select the question above / below', keys: [['↑'], ['↓']], group: 'Moving around' },
  { command: 'extendDown', words: 'Select more questions', keys: [['Shift', '↑'], ['Shift', '↓']], group: 'Moving around' },
  { command: 'selectAll', words: 'Select every question on the page', keys: [['mod', 'A']], group: 'Moving around' },
  { command: 'prevPage', words: 'Previous / next page', keys: [['['], [']']], group: 'Moving around' },
  { command: 'escape', words: 'Close, or clear the selection', keys: [['Esc']], group: 'Moving around' },
  { command: 'undo', words: 'Undo', keys: [['mod', 'Z']], group: 'The case sheet' },
  { command: 'redo', words: 'Redo', keys: [['mod', 'Shift', 'Z'], ['mod', 'Y']], group: 'The case sheet' },
  { command: 'save', words: 'Save now', keys: [['mod', 'S']], group: 'The case sheet' },
  { command: 'preview', words: 'Preview', keys: [['P']], group: 'The case sheet' },
  { command: 'help', words: 'Show these shortcuts', keys: [['?']], group: 'The case sheet' },
];

/**
 * The command for a key press, or null. `typing` = the press is inside a
 * text box: then only ⌘S (save now) and Esc act; everything else is the
 * text box's own (its undo, its arrows, its letters).
 */
export function commandFor(e: KeyLike, typing: boolean): StudioCommand | null {
  const mod = !!(e.metaKey || e.ctrlKey);
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (mod && !e.altKey && key === 's') return 'save';
  if (key === 'Escape') return 'escape';
  if (typing) return null;
  if (mod && !e.altKey) {
    if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
    if (key === 'y') return 'redo';
    if (key === 'd') return 'duplicate';
    if (key === 'a') return 'selectAll';
    return null;
  }
  if (e.altKey) {
    if (key === 'ArrowUp') return 'moveUp';
    if (key === 'ArrowDown') return 'moveDown';
    return null;
  }
  if (key === 'ArrowUp') return e.shiftKey ? 'extendUp' : 'prev';
  if (key === 'ArrowDown') return e.shiftKey ? 'extendDown' : 'next';
  if (key === 'Delete' || key === 'Backspace') return 'remove';
  if (key === 'Enter') return 'rename';
  if (key === '?') return 'help';
  if (e.shiftKey) return null;
  if (key === 'n') return 'add';
  if (key === '/') return 'search';
  if (key === '[') return 'prevPage';
  if (key === ']') return 'nextPage';
  if (key === 'p') return 'preview';
  return null;
}

/** "mod" → ⌘ / Ctrl, for the panel and the tooltips. */
export function keyWords(keys: string[], mac: boolean): string {
  return keys.map((k) => (k === 'mod' ? (mac ? '⌘' : 'Ctrl') : k === 'Alt' && mac ? '⌥' : k === 'Shift' && mac ? '⇧' : k)).join(mac ? '' : '+');
}

/** A tooltip: "Make a copy (⌘D)". */
export function tip(command: StudioCommand, words: string, mac: boolean): string {
  const row = SHORTCUTS.find((r) => r.command === command);
  return row ? `${words} (${keyWords(row.keys[0], mac)})` : words;
}
