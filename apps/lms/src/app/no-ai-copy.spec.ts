import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Owner's standing rule (PF Sense naming): the product never says "AI" to a
 * user — the assistant, the disk reader and every other smart feature is
 * "PF Sense" ("Ask PF Sense", "PF Sense is thinking…", "Read by PF Sense").
 * The ONE exception is the AI connector feature (MCP connector pages and
 * settings), which keeps the word because that is what people search for.
 *
 * A grep-style guard over the SOURCE TEXT (inline templates in `.ts`,
 * `templateUrl` `.html` siblings, string literals), comments stripped so a
 * docstring explaining the rule never trips it. Code identifiers are not
 * affected: `AI_CAP`, `aiGlow`, `pf-ai-glow`, `ai_cap_reached` never match
 * the whole-word, upper-case `AI`.
 */

const APP_ROOT = resolve(process.cwd(), 'apps/lms/src/app');

/** No folder is exempt any more (owner, 2026-11-01): even the connector's own screens say "AI" only in
 *  "AI connector" — the apps it lets in are "apps" / "connected apps", never "AI apps". */
const ALLOWED_DIRS: string[] = [];

/** The ONE allowed wording, anywhere: the feature's name. */
const ALLOWED_PHRASES: RegExp[] = [
  /\bAI[- ]connectors?\b/g,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { walk(full, out); continue; }
    if (/\.(ts|html)$/.test(name) && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/(^|[^:\n])\/\/[^\n]*/gm, '$1');
}

function aiMentions(rawText: string): string[] {
  let text = stripComments(rawText);
  for (const re of ALLOWED_PHRASES) text = text.replace(re, ' ');
  return text.split('\n').filter((l) => /\bAI\b/.test(l)).map((l) => l.trim().slice(0, 140));
}

describe('no user-facing "AI" — it is Cortex (owner standing rule)', () => {
  it('the guard itself: flags "Ask AI", ignores identifiers, comments and the connector', () => {
    expect(aiMentions(`label = input('Ask AI');`)).toHaveLength(1);
    expect(aiMentions(`<span>AI is thinking…</span>`)).toHaveLength(1);
    expect(aiMentions(`const AI_CAP = 1; aiGlow(); class="pf-ai-glow"; 'ai_cap_reached'`)).toEqual([]);
    expect(aiMentions(`// the AI call\n/* AI */\n<!-- AI -->`)).toEqual([]);
    expect(aiMentions(`title: 'AI connectors', 'Turn on AI connector'`)).toEqual([]);
    expect(aiMentions(`subtitle: 'Let AI apps like Claude read your lab’s numbers'`)).toHaveLength(1);
  });

  it('no file in apps/lms/src/app says "AI" outside the AI connector', () => {
    const files = walk(APP_ROOT);
    expect(files.length).toBeGreaterThan(100); // sanity: the walk found the app
    const hits: string[] = [];
    for (const full of files) {
      const rel = relative(APP_ROOT, full).split('\\').join('/');
      if (ALLOWED_DIRS.some((d) => rel.startsWith(d))) continue;
      for (const line of aiMentions(readFileSync(full, 'utf8'))) hits.push(`${rel}: ${line}`);
    }
    expect(hits).toEqual([]);
  });
});
