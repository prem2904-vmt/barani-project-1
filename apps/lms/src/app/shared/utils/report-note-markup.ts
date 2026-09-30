/**
 * TECHNICIAN REPORT NOTES — the note's markup (owner 2026-09-30).
 *
 * A note is PLAIN TEXT in a tiny, strict markup — the formatting the Cortex
 * editor offers, nothing more:
 *
 *   **bold**   _italic_   __underline__
 *   - bullet item        (also "• " / "* ")
 *   1. numbered item     (also "1) ")
 *   \*  \_  \\           a literal * _ \
 *
 * It is never HTML. Every renderer works from the parsed runs below — the
 * screens bind them as text (no innerHTML), the PDF draws them with jsPDF —
 * so a note can never inject markup or script, whatever the tech types
 * (`<script>` prints as those characters). The server stores the text
 * verbatim after normalising whitespace (ReportNoteRules.Clean, mirrored by
 * {@link cleanNote}).
 */

/** Longest note (characters of markup) — mirrors ReportNoteRules.MaxLength. */
export const REPORT_NOTE_MAX = 1000;

export interface NoteRun {
  text: string;
  b?: true;
  i?: true;
  u?: true;
}

/** One printed line of runs. */
export type NoteLine = NoteRun[];

export type NoteBlock =
  | { kind: 'p'; lines: NoteLine[] }
  | { kind: 'ul'; items: NoteLine[] }
  | { kind: 'ol'; start: number; items: NoteLine[] };

const BULLET = /^\s*(?:[-•*])\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;

/** Normalise like the server: CRLF → LF, tab → space, control characters
 *  dropped, trailing spaces and blank edge lines trimmed. Blank → ''. */
export function cleanNote(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = raw.replace(/\r\n?/g, '\n').replace(/\t/g, ' ');
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u2028\u2029]/g, '');
  const lines = s.split('\n').map(l => l.replace(/\s+$/, ''));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join('\n');
}

/** Parse a note into blocks (paragraphs keep the tech's line breaks; runs of
 *  list lines of one kind form one list; a blank line ends a paragraph). */
export function parseNote(src: string | null | undefined): NoteBlock[] {
  const text = cleanNote(src);
  if (!text) return [];
  const blocks: NoteBlock[] = [];
  let para: NoteLine[] | null = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) { para = null; continue; }
    const bullet = BULLET.exec(line);
    const num = bullet ? null : NUMBERED.exec(line);
    if (bullet) {
      para = null;
      const last = blocks[blocks.length - 1];
      const item = parseInline(bullet[1]);
      if (last?.kind === 'ul') last.items.push(item); else blocks.push({ kind: 'ul', items: [item] });
      continue;
    }
    if (num) {
      para = null;
      const last = blocks[blocks.length - 1];
      const item = parseInline(num[2]);
      if (last?.kind === 'ol') last.items.push(item);
      else blocks.push({ kind: 'ol', start: Math.max(0, parseInt(num[1], 10)), items: [item] });
      continue;
    }
    if (!para) { para = []; blocks.push({ kind: 'p', lines: para }); }
    para.push(parseInline(line));
  }
  return blocks;
}

type Delim = '**' | '__' | '_';
type Tok =
  | { kind: 'text'; text: string }
  | { kind: 'delim'; d: Delim; open: boolean; close: boolean; role?: 'open' | 'close' };

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** Inline runs of one line. Emphasis needs a matching pair on the SAME line;
 *  an unmatched marker prints as the characters typed. Underscores inside a
 *  word (snake_case, A_1) are literal. */
export function parseInline(line: string): NoteLine {
  const toks: Tok[] = [];
  let buf = '';
  const flush = () => { if (buf) { toks.push({ kind: 'text', text: buf }); buf = ''; } };
  for (let i = 0; i < line.length;) {
    const c = line[i];
    if (c === '\\' && (line[i + 1] === '*' || line[i + 1] === '_' || line[i + 1] === '\\')) {
      buf += line[i + 1]; i += 2; continue;
    }
    let d: Delim | null = null;
    if (line.startsWith('**', i)) d = '**';
    else if (line.startsWith('__', i)) d = '__';
    else if (c === '_') d = '_';
    if (!d) { buf += c; i++; continue; }
    const before = line[i - 1];
    const after = line[i + d.length];
    let open = !isSpace(after);
    let close = !isSpace(before);
    if (d !== '**') {
      // Underscore markers never open / close inside a word.
      if (isWord(before)) open = false;
      if (isWord(after)) close = false;
    }
    if (!open && !close) { buf += d; i += d.length; continue; }
    flush();
    toks.push({ kind: 'delim', d, open, close });
    i += d.length;
  }
  flush();

  // Pair delimiters: a closer matches the nearest open opener of its kind;
  // openers left inside the pair are dropped from the stack (literal).
  const stack: number[] = [];
  toks.forEach((t, idx) => {
    if (t.kind !== 'delim') return;
    if (t.close) {
      for (let s = stack.length - 1; s >= 0; s--) {
        const o = toks[stack[s]] as Extract<Tok, { kind: 'delim' }>;
        if (o.d === t.d) {
          o.role = 'open';
          t.role = 'close';
          stack.length = s;
          return;
        }
      }
    }
    if (t.open) stack.push(idx);
  });

  const runs: NoteLine = [];
  const on = { b: 0, i: 0, u: 0 };
  const key = (d: Delim): 'b' | 'i' | 'u' => (d === '**' ? 'b' : d === '__' ? 'u' : 'i');
  for (const t of toks) {
    if (t.kind === 'text') { pushText(runs, t.text, on); continue; }
    if (!t.role) { pushText(runs, t.d, on); continue; }
    on[key(t.d)] += t.role === 'open' ? 1 : -1;
  }
  return runs;
}

function pushText(runs: NoteLine, text: string, on: { b: number; i: number; u: number }): void {
  if (!text) return;
  const run: NoteRun = { text };
  if (on.b > 0) run.b = true;
  if (on.i > 0) run.i = true;
  if (on.u > 0) run.u = true;
  const last = runs[runs.length - 1];
  if (last && !!last.b === !!run.b && !!last.i === !!run.i && !!last.u === !!run.u) last.text += text;
  else runs.push(run);
}

/** The note as plain words (search, previews, accessible names). */
export function noteToPlain(src: string | null | undefined): string {
  return parseNote(src).map(b => {
    if (b.kind === 'p') return b.lines.map(l => l.map(r => r.text).join('')).join('\n');
    return b.items.map((it, n) => `${b.kind === 'ol' ? `${b.start + n}.` : '•'} ${it.map(r => r.text).join('')}`).join('\n');
  }).join('\n');
}

// ── Editor operations (toolbar + shortcuts) ─────────────────────────────

export interface NoteEdit { text: string; start: number; end: number }

export type InlineMark = 'bold' | 'italic' | 'underline';
const MARK: Record<InlineMark, string> = { bold: '**', italic: '_', underline: '__' };

/** Wrap the selection in a mark — or unwrap it when it is already wrapped
 *  (markers just outside or just inside the selection). An empty selection
 *  inserts the pair with the caret between. */
export function toggleInline(text: string, start: number, end: number, mark: InlineMark): NoteEdit {
  const m = MARK[mark];
  const s = Math.min(start, end), e = Math.max(start, end);
  const sel = text.slice(s, e);
  // Markers just outside the selection.
  if (text.slice(s - m.length, s) === m && text.slice(e, e + m.length) === m
      && !(mark === 'italic' && (text[s - 2] === '_' || text[e + 1] === '_'))) {
    return { text: text.slice(0, s - m.length) + sel + text.slice(e + m.length), start: s - m.length, end: e - m.length };
  }
  // Markers inside the selection.
  if (sel.length >= 2 * m.length && sel.startsWith(m) && sel.endsWith(m)
      && !(mark === 'italic' && (sel.startsWith('__') || sel.endsWith('__')))) {
    const inner = sel.slice(m.length, sel.length - m.length);
    return { text: text.slice(0, s) + inner + text.slice(e), start: s, end: s + inner.length };
  }
  // Keep surrounding spaces outside the marks ("** x**" never parses).
  const lead = sel.length - sel.trimStart().length;
  const trail = sel.length - sel.trimEnd().length;
  const core = sel.trim();
  if (!core) {
    return { text: text.slice(0, s) + m + m + text.slice(e), start: s + m.length, end: s + m.length };
  }
  const a = s + lead, b = e - trail;
  return {
    text: text.slice(0, a) + m + core + m + text.slice(b),
    start: a + m.length, end: b + m.length,
  };
}

/** Turn the selected lines into a bulleted / numbered list, or back into
 *  plain lines when every selected line already is one. */
export function toggleList(text: string, start: number, end: number, kind: 'ul' | 'ol'): NoteEdit {
  const s = Math.min(start, end), e = Math.max(start, end);
  const lineStart = text.lastIndexOf('\n', s - 1) + 1;
  let lineEnd = text.indexOf('\n', e > s && text[e - 1] === '\n' ? e - 1 : e);
  if (lineEnd === -1) lineEnd = text.length;
  const lines = text.slice(lineStart, lineEnd).split('\n');
  const re = kind === 'ul' ? BULLET : NUMBERED;
  const content = (l: string) => {
    const b = BULLET.exec(l); if (b) return b[1];
    const n = NUMBERED.exec(l); if (n) return n[2];
    return l.trimStart();
  };
  const all = lines.filter(l => l.trim()).length > 0 && lines.filter(l => l.trim()).every(l => re.test(l));
  let n = 0;
  const out = lines.map(l => {
    if (!l.trim()) return l;
    if (all) return content(l);
    n++;
    return (kind === 'ul' ? '- ' : `${n}. `) + content(l);
  }).join('\n');
  const next = text.slice(0, lineStart) + out + text.slice(lineEnd);
  return { text: next, start: lineStart, end: lineStart + out.length };
}

/** Enter inside a list item continues the list ("- " / next number); Enter on
 *  an EMPTY item ends the list. null = not in a list (default Enter). */
export function continueList(text: string, caret: number): NoteEdit | null {
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
  const lineEndIdx = text.indexOf('\n', caret);
  const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx;
  const line = text.slice(lineStart, lineEnd);
  const b = /^(\s*)([-•*])\s+(.*)$/.exec(line);
  const n = b ? null : /^(\s*)(\d{1,3})([.)])\s+(.*)$/.exec(line);
  if (!b && !n) {
    // A bare marker the tech just typed ("- " with nothing after) → end it.
    if (/^\s*(?:[-•*]|\d{1,3}[.)])\s*$/.test(line) && line.trim()) return null;
    return null;
  }
  const body = b ? b[3] : n![4];
  if (!body.trim()) {
    // Empty item: drop the marker, leave a plain empty line.
    const next = text.slice(0, lineStart) + text.slice(lineEnd);
    return { text: next, start: lineStart, end: lineStart };
  }
  const marker = b ? `${b[1]}${b[2]} ` : `${n![1]}${parseInt(n![2], 10) + 1}${n![3]} `;
  const insert = '\n' + marker;
  return { text: text.slice(0, caret) + insert + text.slice(caret), start: caret + insert.length, end: caret + insert.length };
}
