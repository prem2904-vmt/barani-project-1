import { describe, expect, it } from 'vitest';
import { MD_MAX_CHARS, parseAssistantMarkdown, parseInline, safeHref } from './assistant-markdown';

/**
 * The model's text is untrusted: the parser only ever produces TEXT tokens
 * (rendered with bindings, never innerHTML) and http(s) links.
 */
describe('assistant markdown — sanitising', () => {
  it('safeHref keeps http(s) only, never credentials / control chars / other schemes', () => {
    expect(safeHref('https://prefrontal.health/help')).toBe('https://prefrontal.health/help');
    expect(safeHref('http://192.168.1.8:5599/')).toBe('http://192.168.1.8:5599/');
    for (const bad of [
      'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd',
      'vbscript:x', '//evil.example', '/relative', 'https://user:pw@evil.example', 'https://evil.example/\u0000x',
      'https://evil .example', '', null, undefined, 'ftp://x.example',
    ]) expect(safeHref(bad as string)).toBeNull();
  });

  it('a markdown link with an unsafe target keeps its words and drops the link', () => {
    expect(parseInline('[click](javascript:void0)')).toEqual([{ kind: 'text', text: 'click' }]);
    expect(parseInline('[docs](https://example.com/a)')).toEqual([{ kind: 'link', text: 'docs', href: 'https://example.com/a' }]);
  });

  it('raw HTML stays literal text — no element tokens exist at all', () => {
    const blocks = parseAssistantMarkdown('<img src=x onerror="alert(1)"> and <script>alert(2)</script>');
    expect(blocks).toEqual([{ kind: 'p', inlines: [{ kind: 'text', text: '<img src=x onerror="alert(1)"> and <script>alert(2)</script>' }] }]);
  });

  it('bare URLs become links without trailing punctuation; non-http stays text', () => {
    expect(parseInline('See https://example.com/x.')).toEqual([
      { kind: 'text', text: 'See ' }, { kind: 'link', text: 'https://example.com/x', href: 'https://example.com/x' }, { kind: 'text', text: '.' },
    ]);
    expect(parseInline('mailto:a@b.c')).toEqual([{ kind: 'text', text: 'mailto:a@b.c' }]);
  });

  it('inline: `code`, **bold**, *italic*; snake_case words are not italic', () => {
    expect(parseInline('Set **Host IP** to `192.168.1.8` *now*')).toEqual([
      { kind: 'text', text: 'Set ' }, { kind: 'strong', text: 'Host IP' }, { kind: 'text', text: ' to ' },
      { kind: 'code', text: '192.168.1.8' }, { kind: 'text', text: ' ' }, { kind: 'em', text: 'now' },
    ]);
    expect(parseInline('sample_id_path stays')).toEqual([{ kind: 'text', text: 'sample_id_path stays' }]);
  });

  it('blocks: heading, bullets, numbered (with start), fenced code, paragraphs', () => {
    const md = '# Check the cable\n\nFirst:\n\n- one\n- two\n  continued\n\n3. three\n4. four\n\n```\nMSH|^~\\&|\n```\nDone.';
    const b = parseAssistantMarkdown(md);
    expect(b.map((x) => x.kind)).toEqual(['h', 'p', 'ul', 'ol', 'code', 'p']);
    expect(b[2]).toEqual({ kind: 'ul', items: [[{ kind: 'text', text: 'one' }], [{ kind: 'text', text: 'two continued' }]] });
    expect(b[3]).toMatchObject({ kind: 'ol', start: 3 });
    expect(b[4]).toEqual({ kind: 'code', text: 'MSH|^~\\&|' });
  });

  it('never throws on junk; huge replies are cut', () => {
    expect(parseAssistantMarkdown(undefined)).toEqual([]);
    expect(parseAssistantMarkdown({ reply: 'x' })).toEqual([]);
    expect(parseAssistantMarkdown('   ')).toEqual([]);
    const big = parseAssistantMarkdown('a'.repeat(MD_MAX_CHARS + 500));
    expect((big[0] as { inlines: { text: string }[] }).inlines[0].text.length).toBe(MD_MAX_CHARS + 1);
  });
});
