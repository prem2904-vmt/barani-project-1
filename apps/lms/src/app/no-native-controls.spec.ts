import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Owner's standing rule (no-native-browser-controls): never a native
 * `<select>`, `<datalist>`, `type="date"/"time"/"datetime-local"/"month"`
 * input, or `window.confirm/alert/prompt` anywhere in the LMS app — always
 * `pf-select`, the kit date/time/datetime inputs (`pf-nd-date`/`pf-nd-time`/
 * `pf-nd-datetime`), or `DialogService`.
 *
 * This is a grep-style guard over the SOURCE TEXT (inline templates in
 * `.ts` files and `templateUrl` `.html` siblings), not a rendered-DOM check,
 * so it catches a regression anywhere without mounting every screen.
 *
 * Two kinds of input are allowed to keep `type="date"`/`"time"` even though
 * they match the attribute:
 *  1. The kit components themselves (`nd-date`, `nd-time`) — a HIDDEN native
 *     input sits behind the typed box only to open the OS picker
 *     (`showPicker()`); it always carries `aria-hidden="true"` in the SAME
 *     tag, which this guard treats as the sanctioned marker.
 *  2. A couple of existing "jump to date" triggers (appointments calendar)
 *     use the identical hidden-overlay technique directly rather than the
 *     kit component — also `aria-hidden="true"` on the same tag.
 *
 * A few files are OWNED BY OTHER IN-FLIGHT BRANCHES (per the overnight
 * native-controls sweep brief) and are allow-listed here rather than fixed;
 * see the sweep's report for what each still has outstanding.
 */

const APP_ROOT = resolve(process.cwd(), 'apps/lms/src/app');

/** Relative (POSIX-style) paths this guard does not enforce — owned by
 *  other in-flight branches, not touched by the native-controls sweep. */
const ALLOW_LIST = new Set<string>([
  'features/stores/stores.component.ts',
  'features/admin/inventory/inventory.component.ts',
  'features/finance/expenses/expense-tracker.component.ts',
  'layout/top-strip/top-strip.component.ts',
  'layout/top-strip/top-strip.component.html',
  'features/frontdesk/order-create/order-create.component.ts',
]);

/** AG-Grid's own built-in `agSelectCellEditor` renders a native `<select>`
 *  while a cell is being edited (it is the grid library's control, not app
 *  markup) — a separate, already-tracked cleanup (OPD Drug master /
 *  Departments), out of scope for this text-based guard, which only matches
 *  literal `<select` markup. Nothing to allow-list: the string
 *  `'agSelectCellEditor'` never matches that pattern. */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) { walk(full, out); continue; }
    if (/\.(ts|html)$/.test(name) && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const SANCTIONED_HIDDEN = /aria-hidden="true"/;

/** Strip comments before matching, so a docstring EXPLAINING the rule
 *  ("never the native `<select>`", "never window.confirm") never trips the
 *  guard that enforces it. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/(^|[^:\n])\/\/[^\n]*/gm, '$1');
}

function violationsIn(rawText: string): string[] {
  const text = stripComments(rawText);
  const hits: string[] = [];

  // Any input whose type is one of the four native pickers.
  const inputTagRe = /<input\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = inputTagRe.exec(text))) {
    const tag = m[0];
    if (!/type="(date|time|datetime-local|month)"/.test(tag)) continue;
    if (SANCTIONED_HIDDEN.test(tag)) continue; // the hidden-native-overlay pattern
    hits.push(`native date/time input: ${tag.replace(/\s+/g, ' ').slice(0, 120)}`);
  }

  // A native dropdown or a native autocomplete list.
  if (/<select[\s>]/.test(text)) hits.push('native <select>');
  if (/<datalist[\s>]/.test(text)) hits.push('native <datalist>');

  // The blocking browser dialogs — matched as CALLS (an open paren right
  // after), so prose like "never window.confirm" in a comment never trips it.
  for (const fn of ['confirm', 'alert', 'prompt']) {
    const re = new RegExp(`window\\.${fn}\\s*\\(`);
    if (re.test(text)) hits.push(`window.${fn}(…)`);
  }

  return hits;
}

describe('no native browser controls (owner standing rule)', () => {
  const files = walk(APP_ROOT);
  expect(files.length).toBeGreaterThan(100); // sanity: the walk actually found the app

  for (const full of files) {
    const rel = relative(APP_ROOT, full).split('\\').join('/');
    if (ALLOW_LIST.has(rel)) continue;
    // The kit components' own hidden-native-overlay input is exempt by the
    // aria-hidden marker above, so they need no file-level allow-listing.

    it(`${rel}: no native select/datalist/date-time input/window dialog`, () => {
      const text = readFileSync(full, 'utf8');
      const found = violationsIn(text);
      expect(found).toEqual([]);
    });
  }
});
