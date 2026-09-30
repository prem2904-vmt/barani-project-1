import { describe, expect, it } from 'vitest';
import {
  REPORT_NOTE_MAX, cleanNote, continueList, noteToPlain, parseInline, parseNote, toggleInline, toggleList,
} from './report-note-markup';

/** Technician report notes — the markup is the one format every renderer
 *  (entry preview, validation, PDF) reads, so its parse is pinned here. */
describe('report note markup — inline', () => {
  it('bold / italic / underline, and nesting', () => {
    expect(parseInline('a **b** _c_ __d__ e')).toEqual([
      { text: 'a ' }, { text: 'b', b: true }, { text: ' ' }, { text: 'c', i: true }, { text: ' ' },
      { text: 'd', u: true }, { text: ' e' },
    ]);
    expect(parseInline('**bold _both_**')).toEqual([
      { text: 'bold ', b: true }, { text: 'both', b: true, i: true },
    ]);
    expect(parseInline('__**x**__')).toEqual([{ text: 'x', b: true, u: true }]);
  });

  it('an unmatched marker prints as typed; snake_case and A_1 stay literal', () => {
    expect(parseInline('2 ** 3')).toEqual([{ text: '2 ** 3' }]);
    expect(parseInline('**open only')).toEqual([{ text: '**open only' }]);
    expect(parseInline('see snake_case and A_1_B')).toEqual([{ text: 'see snake_case and A_1_B' }]);
    expect(parseInline('_ spaced _')).toEqual([{ text: '_ spaced _' }]);
  });

  it('backslash escapes a marker', () => {
    expect(parseInline('\\*\\*not bold\\*\\* \\_x\\_ \\\\')).toEqual([{ text: '**not bold** _x_ \\' }]);
  });

  it('HTML / script is just text — never interpreted (XSS-safe by construction)', () => {
    const runs = parseInline('<img src=x onerror=alert(1)> **<b>hi</b>**');
    expect(runs).toEqual([{ text: '<img src=x onerror=alert(1)> ' }, { text: '<b>hi</b>', b: true }]);
    expect(noteToPlain('<script>alert(1)</script>')).toBe('<script>alert(1)</script>');
  });
});

describe('report note markup — blocks', () => {
  it('paragraph lines, bullets and numbered lists', () => {
    const blocks = parseNote('Haemolysed sample.\nRepeat advised.\n\n- one\n• two\n* three\n3. c\n4) d\nafter');
    expect(blocks.map(b => b.kind)).toEqual(['p', 'ul', 'ol', 'p']);
    expect(blocks[0]).toEqual({ kind: 'p', lines: [[{ text: 'Haemolysed sample.' }], [{ text: 'Repeat advised.' }]] });
    expect(blocks[1]).toEqual({ kind: 'ul', items: [[{ text: 'one' }], [{ text: 'two' }], [{ text: 'three' }]] });
    expect(blocks[2]).toEqual({ kind: 'ol', start: 3, items: [[{ text: 'c' }], [{ text: 'd' }]] });
  });

  it('"-5 mg" or "1.5 g" are not list items', () => {
    expect(parseNote('-5 mg/dL\n1.5 g').map(b => b.kind)).toEqual(['p']);
  });

  it('cleans like the server (CRLF, tabs, controls, blank edges)', () => {
    expect(cleanNote('\r\n  \r\n**a**\tb\u0007\r\nc  \n\n')).toBe('**a** b\nc');
    expect(cleanNote('   \n ')).toBe('');
    expect(parseNote(null)).toEqual([]);
  });

  it('plain text for previews', () => {
    expect(noteToPlain('**Hb** low\n- repeat\n2. call')).toBe('Hb low\n• repeat\n2. call');
  });

  it('cap mirrors the server', () => expect(REPORT_NOTE_MAX).toBe(1000));
});

describe('report note markup — editor operations', () => {
  it('wraps / unwraps a selection (either side of the markers)', () => {
    expect(toggleInline('Hb low', 3, 6, 'bold')).toEqual({ text: 'Hb **low**', start: 5, end: 8 });
    expect(toggleInline('Hb **low**', 5, 8, 'bold')).toEqual({ text: 'Hb low', start: 3, end: 6 });
    expect(toggleInline('Hb **low**', 3, 10, 'bold')).toEqual({ text: 'Hb low', start: 3, end: 6 });
    expect(toggleInline('a b', 2, 3, 'underline')).toEqual({ text: 'a __b__', start: 4, end: 5 });
    expect(toggleInline('a b', 2, 3, 'italic')).toEqual({ text: 'a _b_', start: 3, end: 4 });
  });

  it('keeps edge spaces outside the marks; empty selection inserts a pair', () => {
    expect(toggleInline('say  hi  now', 3, 9, 'bold').text).toBe('say  **hi**  now');
    expect(toggleInline('ab', 1, 1, 'italic')).toEqual({ text: 'a__b', start: 2, end: 2 });
  });

  it('list toggle on the selected lines, and back', () => {
    const on = toggleList('one\ntwo', 0, 7, 'ol');
    expect(on.text).toBe('1. one\n2. two');
    expect(toggleList(on.text, 0, on.text.length, 'ol').text).toBe('one\ntwo');
    expect(toggleList('x\n1. y', 0, 6, 'ul').text).toBe('- x\n- y');
  });

  it('Enter continues a list; Enter on an empty item ends it', () => {
    expect(continueList('- a', 3)).toEqual({ text: '- a\n- ', start: 6, end: 6 });
    expect(continueList('2. a', 4)).toEqual({ text: '2. a\n3. ', start: 8, end: 8 });
    expect(continueList('- a\n- ', 6)).toEqual({ text: '- a\n', start: 4, end: 4 });
    expect(continueList('plain', 5)).toBeNull();
  });
});
