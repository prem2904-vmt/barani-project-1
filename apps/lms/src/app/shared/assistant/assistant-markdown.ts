/**
 * The assistant's "plain-word markdown" → a small token tree the panel
 * renders with Angular bindings (TEXT only — no innerHTML anywhere).
 *
 * The model's text is UNTRUSTED. So:
 *   - raw HTML is never interpreted: `<img onerror=…>` stays visible text;
 *   - a link survives only when its URL is http(s) without credentials —
 *     anything else (javascript:, data:, file:, relative…) becomes text;
 *   - nothing opens on its own: a link is an ordinary anchor the person may
 *     click (new tab, no opener, no referrer).
 * Supported: paragraphs, headings (#), bullet / numbered lists, fenced code,
 * `code`, **bold**, *italic*, [text](https://…) and bare https://… URLs.
 */

export type MdInline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

export type MdBlock =
  | { kind: 'p'; inlines: MdInline[] }
  | { kind: 'h'; inlines: MdInline[] }
  | { kind: 'ul'; items: MdInline[][] }
  | { kind: 'ol'; items: MdInline[][]; start: number }
  | { kind: 'code'; text: string };

/** Longest reply rendered (anything past it is cut with an ellipsis). */
export const MD_MAX_CHARS = 20_000;

/** A link target the panel may render, or null. http(s) only, no
 *  user:password@ part, no control characters / whitespace. */
export function safeHref(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 2048) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(s)) return null;
  if (!/^https?:\/\//i.test(s)) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (!u.hostname) return null;
  return u.href;
}

// `code` | **bold** | __bold__ | [text](url) | bare URL | *em* | _em_
const INLINE = new RegExp(
  [
    '`([^`\\n]+)`',
    '\\*\\*([^*\\n]+?)\\*\\*',
    '__([^_\\n]+?)__',
    '\\[([^\\]\\n]+)\\]\\(([^)\\s]+)\\)',
    '(https?:\\/\\/[^\\s<>()]*[^\\s<>().,;:!?\'"])',
    '(?<![\\w*])\\*([^*\\n]+?)\\*(?![\\w*])',
    '(?<![A-Za-z0-9_])_([^_\\n]+?)_(?![A-Za-z0-9_])',
  ].join('|'),
  'g',
);

/** One line (or paragraph) of inline markdown → tokens. */
export function parseInline(src: string): MdInline[] {
  const out: MdInline[] = [];
  const text = (t: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.kind === 'text') last.text += t; else out.push({ kind: 'text', text: t });
  };
  let i = 0;
  INLINE.lastIndex = 0;
  for (let m = INLINE.exec(src); m; m = INLINE.exec(src)) {
    text(src.slice(i, m.index));
    i = m.index + m[0].length;
    if (m[1] !== undefined) out.push({ kind: 'code', text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: 'strong', text: m[2] });
    else if (m[3] !== undefined) out.push({ kind: 'strong', text: m[3] });
    else if (m[4] !== undefined) {
      const href = safeHref(m[5]);
      if (href) out.push({ kind: 'link', text: m[4], href });
      else text(m[4]);                      // unsafe target: keep the words, drop the link
    } else if (m[6] !== undefined) {
      const href = safeHref(m[6]);
      if (href) out.push({ kind: 'link', text: m[6], href }); else text(m[6]);
    } else if (m[7] !== undefined) out.push({ kind: 'em', text: m[7] });
    else if (m[8] !== undefined) out.push({ kind: 'em', text: m[8] });
  }
  text(src.slice(i));
  return out;
}

const UL = /^\s{0,3}[-*+•]\s+(.*)$/;
const OL = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/;
const H = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s{0,3}```/;

/** The whole reply → blocks. Never throws; empty / non-string → []. */
export function parseAssistantMarkdown(input: unknown): MdBlock[] {
  let src = typeof input === 'string' ? input : '';
  if (!src.trim()) return [];
  if (src.length > MD_MAX_CHARS) src = src.slice(0, MD_MAX_CHARS) + '…';
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  let list: { kind: 'ul' | 'ol'; items: string[]; start: number } | null = null;

  const flushPara = () => {
    if (para.length) blocks.push({ kind: 'p', inlines: parseInline(para.join('\n')) });
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((t) => parseInline(t));
    blocks.push(list.kind === 'ul' ? { kind: 'ul', items } : { kind: 'ol', items, start: list.start });
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE.test(line)) {
      flushPara(); flushList();
      const body: string[] = [];
      for (i++; i < lines.length && !FENCE.test(lines[i]); i++) body.push(lines[i]);
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    const h = H.exec(line);
    if (h) { flushPara(); flushList(); blocks.push({ kind: 'h', inlines: parseInline(h[1]) }); continue; }
    const ul = UL.exec(line);
    const ol = ul ? null : OL.exec(line);
    if (ul || ol) {
      flushPara();
      const kind = ul ? 'ul' : 'ol';
      if (!list || list.kind !== kind) { flushList(); list = { kind, items: [], start: ol ? Number(ol[1]) || 1 : 1 }; }
      list.items.push(ul ? ul[1] : ol![2]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) {           // continuation of the last item
      list.items[list.items.length - 1] += ' ' + line.trim();
      continue;
    }
    flushList();
    para.push(line.replace(/^\s{0,3}>\s?/, ''));    // a quote reads as a paragraph
  }
  flushPara(); flushList();
  return blocks;
}
